import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dataSourceRefSchema } from "@ate/domain";
import { DeterministicScheduler, VirtualClock, durationMs, mustParseUtc } from "@ate/time";
import {
  FilesystemCaptureRepository,
  RealtimeDataService,
  ScriptedAdapter,
  defaultRealtimeOptions,
  scriptedCapabilities,
  fingerprint,
  type NativeMessage,
  type RealtimeOptions,
  type SubscriptionRequest,
} from "@ate/realtime-data";
const sourceId = "30000000-0000-4000-8000-000000000001",
  instrumentId = "30000000-0000-4000-8000-000000000002",
  at = "2026-10-08T10:00:00.000Z";
const source = dataSourceRefSchema.parse({
  sourceId,
  sourceType: "SIMULATION",
  name: "Remediation",
  role: "PRIMARY",
});
const request: SubscriptionRequest = {
  subscriptionId: "quotes",
  sourceId,
  instrumentId,
  providerSymbol: "EURUSD",
  observationKind: "QUOTE",
  mode: "STREAM",
  expectedActivity: false,
};
const message = (eventTime = at, eventId?: string): NativeMessage => ({
  sourceId,
  subscriptionId: "quotes",
  observationKind: "QUOTE",
  payload: { eventTime, bid: { value: "1.23", instrumentId, quoteCurrency: "USD" } },
  ...(eventId ? { eventId } : {}),
});
const roots: string[] = [];
afterEach(() => {
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const gate = () => {
  let resolve!: () => void, reject!: (e: Error) => void;
  const promise = new Promise<void>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
function fixture(options: Partial<RealtimeOptions> = {}, capture = false, confirmation = true) {
  const clock = new VirtualClock(mustParseUtc(at)),
    scheduler = new DeterministicScheduler(clock),
    adapter = new ScriptedAdapter(source, {
      ...scriptedCapabilities,
      subscriptionConfirmation: confirmation,
    });
  const root = capture ? mkdtempSync(join(tmpdir(), "ate-remediation-")) : undefined;
  if (root) roots.push(root);
  const repository = root ? new FilesystemCaptureRepository(root, clock, 10485760, 32) : undefined;
  const service = new RealtimeDataService({
    clock,
    scheduler,
    options: { ...defaultRealtimeOptions, enabled: true, ...options },
    configurationFingerprint: fingerprint("remediation"),
    requiredSources: [sourceId],
    ...(repository ? { captureRepository: repository } : {}),
  });
  expect(service.register(adapter).ok).toBe(true);
  return { clock, scheduler, adapter, service, root, repository };
}
async function active(options: Partial<RealtimeOptions> = {}, capture = false) {
  const f = fixture(options, capture);
  expect((await f.service.start()).ok).toBe(true);
  expect((await f.service.subscribe(request)).ok).toBe(true);
  return f;
}
async function advance(f: ReturnType<typeof fixture>, ms: number) {
  expect(f.clock.advanceBy(durationMs(ms)).ok).toBe(true);
  expect((await f.scheduler.runDueTasks()).ok).toBe(true);
  await flush();
}
async function emit(f: ReturnType<typeof fixture>, m = message()) {
  expect(f.adapter.emit(m).ok).toBe(true);
  await f.service.drain();
}

describe("F01 sequential scheduler reconnect regressions", () => {
  it("dispatches a never-resolving reconnect and executes its deadline sequentially", async () => {
    const f = await active({
      operationTimeoutMs: 100,
      reconnectInitialDelayMs: 10,
      reconnectMaxAttempts: 1,
    });
    f.adapter.connectGate = () => new Promise(() => {});
    f.adapter.interrupt();
    await advance(f, 10);
    expect(f.service.diagnostics().providers[0]!.state).toBe("RECONNECTING");
    await advance(f, 100);
    expect(f.service.diagnostics().providers[0]!.state).toBe("FAILED");
    expect(f.service.diagnostics().errors.some((e) => e.code === "OPERATION_TIMEOUT")).toBe(true);
    expect((await f.service.stop()).ok).toBe(true);
  });
  it.each(["success", "failure"])("fences late reconnect %s after timeout", async (outcome) => {
    const f = await active({
      operationTimeoutMs: 100,
      reconnectInitialDelayMs: 10,
      reconnectMaxAttempts: 1,
    });
    const g = gate();
    f.adapter.connectGate = () => g.promise;
    f.adapter.interrupt();
    await advance(f, 10);
    await advance(f, 100);
    const sessions = f.service.diagnostics().sessions;
    if (outcome === "success") g.resolve();
    else g.reject(new Error("late"));
    await flush();
    expect(f.service.diagnostics().providers[0]!.state).toBe("FAILED");
    expect(f.service.diagnostics().sessions).toEqual(sessions);
    expect(f.adapter.emit(message()).ok).toBe(false);
    expect((await f.service.stop()).ok).toBe(true);
  });
  it("cancels pending reconnect during shutdown", async () => {
    const f = await active({ reconnectInitialDelayMs: 10 });
    const g = gate();
    f.adapter.connectGate = () => g.promise;
    f.adapter.interrupt();
    await advance(f, 10);
    expect((await f.service.stop()).ok).toBe(true);
    g.resolve();
    await flush();
    expect(f.service.diagnostics().state).toBe("STOPPED");
    expect(f.adapter.emit(message()).ok).toBe(false);
  });
  it("exhausts bounded failed reconnects", async () => {
    const f = await active({ reconnectInitialDelayMs: 10, reconnectMaxAttempts: 2 });
    f.adapter.failConnectCount = 10;
    f.adapter.interrupt();
    await advance(f, 10);
    await advance(f, 20);
    expect(f.adapter.callbacks).toHaveLength(3);
    expect(f.service.diagnostics().providers[0]!.state).toBe("FAILED");
    expect((await f.service.stop()).ok).toBe(true);
  });
  it("cancels reconnect backoff on stop", async () => {
    const f = await active();
    f.adapter.interrupt();
    expect((await f.service.stop()).ok).toBe(true);
    await advance(f, 10000);
    expect(f.adapter.callbacks).toHaveLength(1);
  });
  it("joins duplicate connects and ignores repeated old disconnect callbacks", async () => {
    const f = await active({ reconnectInitialDelayMs: 10 });
    const g = gate();
    f.adapter.connectGate = () => g.promise;
    f.adapter.interrupt();
    f.adapter.interrupt();
    await advance(f, 10);
    const one = f.service.connect(sourceId),
      two = f.service.connect(sourceId);
    expect(one).toBe(two);
    expect(f.adapter.callbacks).toHaveLength(2);
    g.resolve();
    await one;
    expect(f.service.diagnostics().providers[0]!.state).toBe("CONNECTED");
    expect((await f.service.stop()).ok).toBe(true);
  });
  it("progresses unrelated scheduled work while reconnect remains pending", async () => {
    const f = await active({ reconnectInitialDelayMs: 10 });
    f.adapter.connectGate = () => new Promise(() => {});
    let ran = false;
    f.scheduler.scheduleAfter(durationMs(20), () => {
      ran = true;
    });
    f.adapter.interrupt();
    await advance(f, 10);
    await advance(f, 10);
    expect(ran).toBe(true);
    expect((await f.service.stop()).ok).toBe(true);
  });
  it("times out pending reconnect resubscription without blocking scheduler", async () => {
    const f = await active({ operationTimeoutMs: 100, reconnectInitialDelayMs: 10 });
    f.adapter.subscribeGate = () => new Promise(() => {});
    f.adapter.interrupt();
    await advance(f, 10);
    await advance(f, 100);
    expect(f.service.diagnostics().providers[0]!.subscriptions[0]!.state).toBe("FAILED");
    expect((await f.service.stop()).ok).toBe(true);
  });
});

describe("F02 immediate freshness and readiness regressions", () => {
  it("first already-stale observation is STALE before monitor", async () => {
    const f = await active();
    f.clock.advanceBy(durationMs(120000));
    await emit(f);
    expect(f.service.diagnostics().providers[0]!.streams[0]!.freshness).toBe("STALE");
    expect(f.service.readiness()).toBe(false);
    await f.service.stop();
  });
  it("stale observation immediately after subscription cannot establish readiness", async () => {
    const f = await active();
    await emit(f, message("2026-10-08T09:58:00.000Z"));
    expect(f.service.readiness()).toBe(false);
    await f.service.stop();
  });
  it("stale observation after reconnect cannot restore readiness", async () => {
    const f = await active({ reconnectInitialDelayMs: 10 });
    await emit(f);
    f.adapter.interrupt();
    await advance(f, 10);
    await emit(f, message("2026-10-08T09:58:00.000Z"));
    expect(f.service.readiness()).toBe(false);
    expect(f.service.diagnostics().providers[0]!.streams[0]!.continuityUncertain).toBe(true);
    await f.service.stop();
  });
  it("fresh evidence restores temporal readiness after stale evidence", async () => {
    const f = await active();
    await emit(f, message("2026-10-08T09:58:00.000Z"));
    expect(f.service.readiness()).toBe(false);
    await emit(f);
    expect(f.service.readiness()).toBe(true);
    await f.service.stop();
  });
  it("duplicate stale evidence cannot refresh readiness", async () => {
    const f = await active();
    await emit(f, message(at, "same"));
    f.clock.advanceBy(durationMs(31000));
    await emit(f, message(at, "same"));
    expect(f.service.readiness()).toBe(false);
    expect(f.service.diagnostics().metrics.duplicates).toBe(1);
    await f.service.stop();
  });
  it("excessively future-dated evidence is rejected without readiness", async () => {
    const f = await active();
    await emit(f, message("2026-10-08T10:01:00.000Z"));
    expect(f.service.diagnostics().metrics.accepted).toBe(0);
    expect(f.service.readiness()).toBe(false);
    await f.service.stop();
  });
  it("missing required event time cannot establish readiness", async () => {
    const f = await active();
    await emit(f, {
      ...message(),
      payload: { bid: { value: "1.23", instrumentId, quoteCurrency: "USD" } },
    });
    expect(f.service.readiness()).toBe(false);
    await f.service.stop();
  });
  it("missing optional source time remains explicit canonical evidence", async () => {
    const f = await active();
    const c = f.service.consumer("evidence");
    if (!c.ok) throw Error("consumer");
    await emit(f);
    expect((await c.value.read())!.warnings).toContain("SOURCE_TIME_MISSING");
    expect(f.service.readiness()).toBe(true);
    await f.service.stop();
  });
  it("unconfirmed applied subscriptions cannot establish readiness", async () => {
    const f = fixture({}, false, false);
    await f.service.start();
    await f.service.subscribe(request);
    await emit(f);
    expect(f.service.diagnostics().providers[0]!.subscriptions[0]!.applied).toBe("UNCERTAIN");
    expect(f.service.readiness()).toBe(false);
    await f.service.stop();
  });
  it("freshness boundary and clock-only readiness are evaluated before monitor", async () => {
    const f = await active({ staleAfterMs: 1000 });
    await emit(f);
    f.clock.advanceBy(durationMs(1000));
    expect(f.service.readiness()).toBe(true);
    f.clock.advanceBy(durationMs(1));
    expect(f.service.readiness()).toBe(false);
    await f.service.stop();
  });
  it("readiness remains false after monitor handles stale input", async () => {
    const f = await active({ heartbeatTimeoutMs: 60000 });
    await emit(f, message("2026-10-08T09:58:00.000Z"));
    expect(f.service.readiness()).toBe(false);
    await advance(f, 1000);
    expect(f.service.readiness()).toBe(false);
    await f.service.stop();
  });
  it("one stale required subscription prevents readiness", async () => {
    const f = await active();
    expect(
      (await f.service.subscribe({ ...request, subscriptionId: "other", providerSymbol: "GBPUSD" }))
        .ok,
    ).toBe(true);
    await emit(f);
    await emit(f, { ...message("2026-10-08T09:58:00.000Z"), subscriptionId: "other" });
    expect(f.service.readiness()).toBe(false);
    await f.service.stop();
  });
  it("optional provider stale data cannot degrade required provider readiness", async () => {
    const f = fixture();
    const other = dataSourceRefSchema.parse({
      ...source,
      sourceId: "30000000-0000-4000-8000-000000000003",
    });
    const a = new ScriptedAdapter(other);
    expect(f.service.register(a).ok).toBe(true);
    await f.service.start();
    await f.service.subscribe(request);
    await f.service.subscribe({ ...request, sourceId: other.sourceId });
    await emit(f);
    expect(a.emit({ ...message("2026-10-08T09:58:00.000Z"), sourceId: other.sourceId }).ok).toBe(
      true,
    );
    await f.service.drain();
    expect(f.service.readiness()).toBe(true);
    await f.service.stop();
  });
  it("older arrivals do not erase fresher accepted event evidence", async () => {
    const f = await active();
    await emit(f);
    await emit(f, message("2026-10-08T09:58:00.000Z"));
    expect(f.service.readiness()).toBe(true);
    await f.service.stop();
  });
});

const malformed: Array<[string, () => unknown]> = [
  ["null", () => null],
  ["undefined", () => undefined],
  ["string", () => "bad"],
  ["number", () => 1],
  ["boolean", () => true],
  ["array", () => []],
  ["empty", () => ({})],
  [
    "missing subscription",
    () => {
      const { subscriptionId: _id, ...m } = message();
      return m;
    },
  ],
  ["wrong subscription type", () => ({ ...message(), subscriptionId: 1 })],
  [
    "missing payload",
    () => {
      const { payload: _p, ...m } = message();
      return m;
    },
  ],
  ["wrong kind", () => ({ ...message(), observationKind: 1 })],
  ["invalid provider", () => ({ ...message(), sourceId: "invalid" })],
  [
    "accessor",
    () =>
      Object.defineProperty({ ...message() }, "payload", {
        get: () => {
          throw Error("getter must not run");
        },
        enumerable: true,
      }),
  ],
  [
    "cycle",
    () => {
      const p: Record<string, unknown> = {};
      p.self = p;
      return { ...message(), payload: p };
    },
  ],
  [
    "deep",
    () => {
      let p: unknown = {};
      for (let i = 0; i < 20; i++) p = { nested: p };
      return { ...message(), payload: p };
    },
  ],
  ["oversized", () => ({ ...message(), payload: "x".repeat(100000) })],
];
describe("F03 actual callback malformed envelope regressions", () => {
  it.each(malformed)("rejects %s safely and preserves unrelated streams", async (_name, create) => {
    const f = await active();
    expect(
      (
        await f.service.subscribe({
          ...request,
          subscriptionId: "unrelated",
          providerSymbol: "GBPUSD",
        })
      ).ok,
    ).toBe(true);
    const initialStreams = f.service.diagnostics().providers[0]!.streams;
    const before = f.service.diagnostics().metrics.rejected;
    let result;
    expect(() => {
      result = f.adapter.emit(create() as NativeMessage);
    }).not.toThrow();
    expect(result).toMatchObject({ ok: false });
    expect(f.service.diagnostics().metrics.rejected).toBe(before + 1);
    expect(f.service.readiness()).toBe(false);
    expect(f.service.diagnostics().errors.length).toBeLessThanOrEqual(
      defaultRealtimeOptions.maxEvidence,
    );
    expect(f.service.diagnostics().providers[0]!.streams).toEqual(initialStreams);
    await emit(f, { ...message(), subscriptionId: "unrelated" });
    expect(f.service.diagnostics().metrics.accepted).toBe(1);
    await emit(f);
    expect(f.service.readiness()).toBe(true);
    await f.service.stop();
  });
});

describe("F04 capture lifecycle regressions", () => {
  it("rejects capture before initialization without storage mutation", () => {
    const f = fixture({ captureEnabled: true }, true);
    expect(f.service.startCapture(sourceId, "early").ok).toBe(false);
    expect(f.repository!.recover()).toMatchObject({ ok: true, value: [] });
  });
  it("allows RUNNING initialized capture and accounts it on shutdown", async () => {
    const f = await active({ captureEnabled: true }, true);
    expect(f.service.startCapture(sourceId, "valid").ok).toBe(true);
    expect((await f.service.stop()).ok).toBe(true);
    expect(
      (
        JSON.parse(readFileSync(join(f.root!, "valid", "manifest.json"), "utf8")) as {
          state: string;
        }
      ).state,
    ).toBe("ABORTED");
  });
  it("rejects capture while STOPPING", async () => {
    const f = await active({ captureEnabled: true }, true);
    const g = gate();
    f.adapter.disconnectGate = () => g.promise;
    const stopped = f.service.stop();
    expect(f.service.diagnostics().state).toBe("STOPPING");
    expect(f.service.startCapture(sourceId, "stopping").ok).toBe(false);
    g.resolve();
    expect((await stopped).ok).toBe(true);
  });
  it("rejects capture after STOPPED and repeated stop is idempotent", async () => {
    const f = await active({ captureEnabled: true }, true);
    await f.service.stop();
    expect(f.service.startCapture(sourceId, "stopped").ok).toBe(false);
    expect((await f.service.stop()).ok).toBe(true);
    expect(f.repository!.recover()).toMatchObject({ ok: true, value: [] });
  });
  it("rejects capture in FAILED after failed startup", async () => {
    const f = fixture({ captureEnabled: true });
    expect((await f.service.start()).ok).toBe(false);
    expect(f.service.diagnostics().state).toBe("FAILED");
    expect(f.service.startCapture(sourceId, "failed").ok).toBe(false);
    expect((await f.service.stop()).ok).toBe(true);
  });
  it("rejects capture during incomplete startup", async () => {
    const f = fixture({ captureEnabled: true }, true);
    const g = gate();
    f.adapter.connectGate = () => g.promise;
    const starting = f.service.start();
    expect(f.service.startCapture(sourceId, "initializing").ok).toBe(false);
    g.resolve();
    await starting;
    await f.service.stop();
  });
  it("serializes capture creation immediately before shutdown", async () => {
    const f = await active({ captureEnabled: true }, true);
    expect(f.service.startCapture(sourceId, "before-stop").ok).toBe(true);
    const stopped = f.service.stop();
    expect(f.service.startCapture(sourceId, "race").ok).toBe(false);
    await stopped;
    expect(f.service.diagnostics().providers[0]!.captureRunning).toBe(false);
  });
  it("accounts capture when finalization is rejected for pending ingress", async () => {
    const f = await active({ captureEnabled: true }, true);
    f.service.startCapture(sourceId, "pending");
    f.adapter.emit(message());
    expect(f.service.finishCapture(sourceId).ok).toBe(false);
    await f.service.stop();
    expect(
      (
        JSON.parse(readFileSync(join(f.root!, "pending", "manifest.json"), "utf8")) as {
          state: string;
        }
      ).state,
    ).toBe("ABORTED");
  });
  it("late callback cannot create capture after stop", async () => {
    const f = await active({ captureEnabled: true }, true);
    await f.service.stop();
    const outcome = await Promise.resolve().then(() => f.service.startCapture(sourceId, "late"));
    expect(outcome.ok).toBe(false);
    expect(f.adapter.emit(message()).ok).toBe(false);
  });
  it("restart recovery aborts interrupted capture and preserves integrity", async () => {
    const f = await active({ captureEnabled: true }, true);
    f.service.startCapture(sourceId, "interrupted");
    await emit(f);
    const recovered = new FilesystemCaptureRepository(f.root!, f.clock, 10485760, 32).recover();
    expect(recovered.ok && recovered.value[0]!.state).toBe("ABORTED");
    await f.service.stop();
  });
  it("rejects capture after corrupt recovery fails startup", async () => {
    const f = await active({ captureEnabled: true }, true);
    f.service.startCapture(sourceId, "corrupt");
    await f.service.stop();
    writeFileSync(join(f.root!, "corrupt", "manifest.json"), "invalid");
    const next = new RealtimeDataService({
      clock: f.clock,
      scheduler: f.scheduler,
      options: { ...defaultRealtimeOptions, enabled: true, captureEnabled: true },
      configurationFingerprint: fingerprint("recovery"),
      captureRepository: f.repository!,
    });
    next.register(new ScriptedAdapter(source));
    expect((await next.start()).ok).toBe(false);
    expect(next.diagnostics().state).toBe("FAILED");
    expect(next.startCapture(sourceId, "unauthorized").ok).toBe(false);
  });
  it("aborts capture if repository callback interleaves shutdown with creation", async () => {
    const f = await active({ captureEnabled: true }, true);
    const original = f.repository!.start.bind(f.repository);
    let stopped: ReturnType<RealtimeDataService["stop"]> | undefined;
    f.repository!.start = (manifest) => {
      const result = original(manifest);
      stopped = f.service.stop();
      return result;
    };
    expect(f.service.startCapture(sourceId, "interleaved").ok).toBe(false);
    expect((await stopped)!.ok).toBe(true);
    expect(
      (
        JSON.parse(readFileSync(join(f.root!, "interleaved", "manifest.json"), "utf8")) as {
          state: string;
        }
      ).state,
    ).toBe("ABORTED");
    expect(f.service.diagnostics().providers[0]!.captureRunning).toBe(false);
  });
  it("completed synchronous finalization remains completed through shutdown", async () => {
    const f = await active({ captureEnabled: true }, true);
    f.service.startCapture(sourceId, "completed");
    await emit(f);
    expect(f.service.finishCapture(sourceId).ok).toBe(true);
    await f.service.stop();
    expect(f.repository!.verify("completed").ok).toBe(true);
  });
});
it("F07 freezes registry wrapper and preserves bound adapter methods", async () => {
  const f = fixture();
  const wrapper = f.service.registry.get(sourceId)!;
  expect(Object.isFrozen(wrapper)).toBe(true);
  expect(Reflect.set(wrapper, "version", "changed")).toBe(false);
  expect(Reflect.set(wrapper, "normalize", () => null)).toBe(false);
  expect(wrapper.version).toBe("1.0.0");
  await f.service.start();
  await f.service.subscribe(request);
  await emit(f);
  expect(f.service.readiness()).toBe(true);
  await f.service.stop();
});
