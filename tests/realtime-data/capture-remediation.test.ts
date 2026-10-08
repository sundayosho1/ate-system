import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

const manifestState = (f: ReturnType<typeof fixture>, id: string) =>
  (JSON.parse(readFileSync(join(f.root!, id, "manifest.json"), "utf8")) as { state: string }).state;
function interleaved(f: ReturnType<typeof fixture>, mode: "success" | "failure" | "throw") {
  const start = f.repository!.start.bind(f.repository),
    abort = f.repository!.abort.bind(f.repository);
  let stopped: ReturnType<RealtimeDataService["stop"]> | undefined,
    attempts = 0;
  f.repository!.abort = (id) => {
    attempts++;
    if (mode === "throw") throw new Error("unsafe repository detail must not leak");
    if (mode === "failure")
      return {
        ok: false,
        error: {
          code: "PERSISTENCE_FAILED",
          scope: "capture",
          timestamp: f.clock.now(),
          message: "storage abort failed",
        },
      };
    return abort(id);
  };
  f.repository!.start = (m) => {
    const result = start(m);
    stopped = f.service.stop();
    return result;
  };
  return { stopped: () => stopped!, attempts: () => attempts };
}
describe("CODEX-002D F04-R1 capture cleanup obligations", () => {
  it("successful creation compensation produces ABORTED manifest and successful shutdown", async () => {
    const f = await active({ captureEnabled: true }, true);
    const hook = interleaved(f, "success");
    expect(f.service.startCapture(sourceId, "success").ok).toBe(false);
    expect((await hook.stopped()).ok).toBe(true);
    expect(manifestState(f, "success")).toBe("ABORTED");
    expect(hook.attempts()).toBe(1);
    expect(f.service.diagnostics().providers[0]!.captureRunning).toBe(false);
    expect(f.service.diagnostics().recoveryRequired).toBe(false);
  });
  it.each(["failure", "throw"] as const)(
    "exact reentrant creation with %s abort cannot report successful shutdown",
    async (mode) => {
      const f = await active({ captureEnabled: true }, true);
      const hook = interleaved(f, mode);
      let created;
      expect(() => {
        created = f.service.startCapture(sourceId, "unresolved");
      }).not.toThrow();
      expect(created).toMatchObject({ ok: false, error: { code: "PERSISTENCE_FAILED" } });
      expect(await hook.stopped()).toMatchObject({
        ok: false,
        error: { code: "PERSISTENCE_FAILED" },
      });
      expect(manifestState(f, "unresolved")).toBe("RUNNING");
      const d = f.service.diagnostics();
      expect(d.state).toBe("FAILED");
      expect(d.recoveryRequired).toBe(true);
      expect(d.providers[0]!.captureRunning).toBe(false);
      expect(d.providers[0]!.captureRecovery).toMatchObject({
        captureId: "unresolved",
        lastKnownManifestState: "RUNNING",
        cleanupConfirmed: false,
        recoveryRequired: true,
        error: { code: "PERSISTENCE_FAILED" },
      });
      expect(hook.attempts()).toBe(1);
      expect(JSON.stringify(d)).not.toContain("unsafe repository detail");
    },
  );
  it.each(["failure", "throw"] as const)(
    "ordinary active capture %s abort is structured and discoverable",
    async (mode) => {
      const f = await active({ captureEnabled: true }, true);
      expect(f.service.startCapture(sourceId, "active").ok).toBe(true);
      let attempts = 0;
      f.repository!.abort = () => {
        attempts++;
        if (mode === "throw") throw Error("private storage detail");
        return {
          ok: false,
          error: {
            code: "PERSISTENCE_FAILED",
            scope: "capture",
            timestamp: f.clock.now(),
            message: "abort failed",
          },
        };
      };
      expect(await f.service.stop()).toMatchObject({
        ok: false,
        error: { code: "PERSISTENCE_FAILED" },
      });
      expect(manifestState(f, "active")).toBe("RUNNING");
      expect(f.service.diagnostics().providers[0]!.captureRecovery!.captureId).toBe("active");
      expect(attempts).toBe(1);
      expect(JSON.stringify(f.service.diagnostics())).not.toContain("private storage detail");
    },
  );
  it("repeated stop retains original unresolved failure without retry or erasure", async () => {
    const f = await active({ captureEnabled: true }, true);
    const hook = interleaved(f, "failure");
    f.service.startCapture(sourceId, "repeat");
    const original = await hook.stopped();
    for (let i = 0; i < 3; i++) expect(await f.service.stop()).toEqual(original);
    expect(hook.attempts()).toBe(1);
    expect(manifestState(f, "repeat")).toBe("RUNNING");
    expect(f.service.diagnostics().recoveryRequired).toBe(true);
  });
  it("repeated stop after confirmed cleanup is successful and idempotent", async () => {
    const f = await active({ captureEnabled: true }, true);
    const hook = interleaved(f, "success");
    f.service.startCapture(sourceId, "repeat-success");
    await hook.stopped();
    expect((await f.service.stop()).ok).toBe(true);
    expect((await f.service.stop()).ok).toBe(true);
    expect(hook.attempts()).toBe(1);
    expect(manifestState(f, "repeat-success")).toBe("ABORTED");
  });
  it("unresolved cleanup blocks all post-shutdown activation", async () => {
    const f = await active({ captureEnabled: true }, true);
    const hook = interleaved(f, "failure");
    f.service.startCapture(sourceId, "blocked");
    await hook.stopped();
    expect(f.service.startCapture(sourceId, "new").ok).toBe(false);
    expect(f.adapter.emit(message()).ok).toBe(false);
    expect(f.service.diagnostics().providers[0]!.captureRunning).toBe(false);
    expect(manifestState(f, "blocked")).toBe("RUNNING");
  });
  it("fresh repository discovery recovers failed cleanup from durable RUNNING manifest", async () => {
    const f = await active({ captureEnabled: true }, true);
    const hook = interleaved(f, "failure");
    f.service.startCapture(sourceId, "restart");
    await hook.stopped();
    const repository = new FilesystemCaptureRepository(f.root!, f.clock, 10485760, 32);
    const next = new RealtimeDataService({
      clock: f.clock,
      scheduler: f.scheduler,
      options: { ...defaultRealtimeOptions, enabled: true, captureEnabled: true },
      configurationFingerprint: fingerprint("restart"),
      captureRepository: repository,
    });
    next.register(new ScriptedAdapter(source));
    expect((await next.start()).ok).toBe(true);
    expect(manifestState(f, "restart")).toBe("ABORTED");
    expect(next.diagnostics().recoveryRequired).toBe(false);
    expect((await next.stop()).ok).toBe(true);
    expect((await f.service.stop()).ok).toBe(false);
  });
  it("failed recovery cannot report healthy startup", async () => {
    const f = await active({ captureEnabled: true }, true);
    const hook = interleaved(f, "failure");
    f.service.startCapture(sourceId, "corrupt");
    await hook.stopped();
    writeFileSync(join(f.root!, "corrupt", "manifest.json"), "corrupt");
    const repository = new FilesystemCaptureRepository(f.root!, f.clock, 10485760, 32);
    const next = new RealtimeDataService({
      clock: f.clock,
      scheduler: f.scheduler,
      options: { ...defaultRealtimeOptions, enabled: true, captureEnabled: true },
      configurationFingerprint: fingerprint("failed recovery"),
      captureRepository: repository,
    });
    next.register(new ScriptedAdapter(source));
    expect((await next.start()).ok).toBe(false);
    expect(next.diagnostics().state).toBe("FAILED");
    expect(next.readiness()).toBe(false);
  });
  it("successful controlled shutdown accounts every active capture manifest", async () => {
    const f = await active({ captureEnabled: true }, true);
    f.service.startCapture(sourceId, "controlled");
    await emit(f);
    expect((await f.service.stop()).ok).toBe(true);
    expect(manifestState(f, "controlled")).toBe("ABORTED");
    expect(
      f.service
        .diagnostics()
        .providers.every(
          (p) => !p.captureRunning && !p.captureCreationPending && !p.captureRecovery,
        ),
    ).toBe(true);
    const result = f.repository!.recover();
    expect(result.ok && result.value.every((m) => m.state !== "RUNNING")).toBe(true);
  });
  it("completed captures retain hashes and committed completion across shutdown", async () => {
    const f = await active({ captureEnabled: true }, true);
    f.service.startCapture(sourceId, "completed");
    await emit(f);
    const complete = f.service.finishCapture(sourceId);
    expect(complete.ok).toBe(true);
    expect((await f.service.stop()).ok).toBe(true);
    expect(manifestState(f, "completed")).toBe("COMPLETED");
    expect(f.repository!.verify("completed")).toEqual(complete);
    expect(
      f.repository!.finish("completed", {
        rejected: 0,
        duplicates: 0,
        late: 0,
        gaps: 0,
        overflow: 0,
      }),
    ).toEqual(complete);
  });
  it("interrupted content remains uncommitted and recoverable rather than completed", async () => {
    const f = await active({ captureEnabled: true }, true);
    f.service.startCapture(sourceId, "partial");
    await emit(f);
    const repository = new FilesystemCaptureRepository(f.root!, f.clock, 10485760, 32);
    expect(repository.verify("partial").ok).toBe(false);
    const recovered = repository.recover();
    expect(recovered.ok && recovered.value[0]!.state).toBe("ABORTED");
    expect(repository.verify("partial").ok).toBe(false);
    await f.service.stop();
  });
  it("late scheduled callbacks cannot create captures after successful shutdown", async () => {
    const f = await active({ captureEnabled: true }, true);
    let accepted = true;
    f.scheduler.scheduleAfter(durationMs(1), () => {
      accepted = f.service.startCapture(sourceId, "late").ok;
    });
    await f.service.stop();
    await advance(f, 1);
    expect(accepted).toBe(false);
    expect(f.repository!.recover()).toMatchObject({ ok: true, value: [] });
  });
  it("creation reservation fences recursive starts before repository returns", async () => {
    const f = await active({ captureEnabled: true }, true);
    const start = f.repository!.start.bind(f.repository);
    let recursive = true,
      calls = 0;
    f.repository!.start = (manifest) => {
      calls++;
      recursive = f.service.startCapture(sourceId, "recursive").ok;
      expect(f.service.diagnostics().providers[0]!.captureCreationPending).toBe("reserved");
      return start(manifest);
    };
    expect(f.service.startCapture(sourceId, "reserved").ok).toBe(true);
    expect(recursive).toBe(false);
    expect(calls).toBe(1);
    expect(f.service.diagnostics().providers[0]!.captureCreationPending).toBeUndefined();
    await f.service.stop();
    expect(manifestState(f, "reserved")).toBe("ABORTED");
  });
  it("reentrant abort stop cannot cause duplicate compensation or recursion", async () => {
    const f = await active({ captureEnabled: true }, true);
    f.service.startCapture(sourceId, "once");
    const abort = f.repository!.abort.bind(f.repository);
    let nested: ReturnType<RealtimeDataService["stop"]> | undefined,
      calls = 0;
    f.repository!.abort = (id) => {
      calls++;
      nested = f.service.stop();
      return abort(id);
    };
    expect((await f.service.stop()).ok).toBe(true);
    expect(await nested).toMatchObject({ ok: false, error: { code: "SHUTDOWN_IN_PROGRESS" } });
    expect(calls).toBe(1);
    expect(manifestState(f, "once")).toBe("ABORTED");
  });
  it("bounded recovery evidence survives unrelated bounded diagnostic eviction", async () => {
    const f = fixture({ captureEnabled: true, maxEvidence: 1 }, true);
    const other = dataSourceRefSchema.parse({
      ...source,
      sourceId: "30000000-0000-4000-8000-000000000003",
    });
    f.service.register(new ScriptedAdapter(other));
    await f.service.start();
    await f.service.subscribe(request);
    await f.service.subscribe({ ...request, sourceId: other.sourceId });
    f.service.startCapture(sourceId, "retained");
    f.service.startCapture(other.sourceId, "other");
    f.repository!.abort = (id) => ({
      ok: false,
      error: {
        code: "PERSISTENCE_FAILED",
        scope: id,
        timestamp: f.clock.now(),
        message: "abort failed",
      },
    });
    expect((await f.service.stop()).ok).toBe(false);
    const d = f.service.diagnostics();
    expect(d.providers[0]!.captureRecovery!.captureId).toBe("retained");
    expect(d.providers[1]!.captureRecovery!.captureId).toBe("other");
    expect(d.errors).toHaveLength(1);
    expect(d.errors[0]!.scope).toBe("other");
    expect(d.metrics.evidenceEvictions).toBeGreaterThan(0);
    expect((await f.service.stop()).ok).toBe(false);
  });
  it("parent shutdown retains cleanup failure while disconnect remains pending", async () => {
    const f = await active({ captureEnabled: true }, true),
      g = gate();
    f.adapter.disconnectGate = () => g.promise;
    const hook = interleaved(f, "failure");
    f.service.startCapture(sourceId, "pending-stop");
    expect(f.service.diagnostics().recoveryRequired).toBe(true);
    expect(manifestState(f, "pending-stop")).toBe("RUNNING");
    g.resolve();
    expect((await hook.stopped()).ok).toBe(false);
    expect((await f.service.stop()).ok).toBe(false);
  });
  it("throwing creation callback cannot hide uncertain durable state from parent stop", async () => {
    const f = await active({ captureEnabled: true }, true);
    const start = f.repository!.start.bind(f.repository);
    let stopped: ReturnType<RealtimeDataService["stop"]> | undefined;
    f.repository!.start = (m) => {
      start(m);
      stopped = f.service.stop();
      throw Error("private creation detail");
    };
    let result;
    expect(() => {
      result = f.service.startCapture(sourceId, "uncertain");
    }).not.toThrow();
    expect(result).toMatchObject({ ok: false, error: { code: "PERSISTENCE_FAILED" } });
    expect((await stopped)!.ok).toBe(false);
    expect(manifestState(f, "uncertain")).toBe("RUNNING");
    expect(f.service.diagnostics().providers[0]!.captureRecovery).toMatchObject({
      captureId: "uncertain",
      lastKnownManifestState: "UNKNOWN",
      recoveryRequired: true,
    });
    expect(JSON.stringify(f.service.diagnostics())).not.toContain("private creation detail");
    const recovered = new FilesystemCaptureRepository(f.root!, f.clock, 10485760, 32).recover();
    expect(recovered.ok && recovered.value[0]!.state).toBe("ABORTED");
  });
  it("structured creation failure during shutdown retains unknown commitment evidence", async () => {
    const f = await active({ captureEnabled: true }, true);
    const start = f.repository!.start.bind(f.repository);
    let stopped: ReturnType<RealtimeDataService["stop"]> | undefined;
    f.repository!.start = (m) => {
      start(m);
      stopped = f.service.stop();
      return {
        ok: false,
        error: {
          code: "PERSISTENCE_FAILED",
          scope: "creation",
          timestamp: f.clock.now(),
          message: "creation failed",
        },
      };
    };
    expect(f.service.startCapture(sourceId, "unknown-result").ok).toBe(false);
    expect((await stopped)!.ok).toBe(false);
    expect(manifestState(f, "unknown-result")).toBe("RUNNING");
    expect(f.service.diagnostics().providers[0]!.captureRecovery!.lastKnownManifestState).toBe(
      "UNKNOWN",
    );
  });
  it("uncertain creation failure blocks readiness without manufacturing capture state", async () => {
    const f = await active({ captureEnabled: true }, true);
    await emit(f);
    expect(f.service.readiness()).toBe(true);
    f.repository!.start = () => {
      throw Error("creation failed before commit");
    };
    expect(f.service.startCapture(sourceId, "uncertain-empty").ok).toBe(false);
    expect(f.service.diagnostics().state).toBe("FAILED");
    expect(f.service.readiness()).toBe(false);
    expect(f.repository!.recover()).toMatchObject({ ok: true, value: [] });
    expect((await f.service.stop()).ok).toBe(false);
  });
});

// A failure result does not prove that start had no durable side effects.
const creationFailure = (f: ReturnType<typeof fixture>) => ({
  ok: false as const,
  error: {
    code: "PERSISTENCE_FAILED" as const,
    scope: "capture creation",
    timestamp: f.clock.now(),
    message: "creation commitment unknown",
  },
});
function freshService(f: ReturnType<typeof fixture>, repository: FilesystemCaptureRepository) {
  const service = new RealtimeDataService({
    clock: f.clock,
    scheduler: f.scheduler,
    options: { ...defaultRealtimeOptions, enabled: true, captureEnabled: true },
    configurationFingerprint: fingerprint("creation recovery"),
    requiredSources: [sourceId],
    captureRepository: repository,
  });
  expect(service.register(new ScriptedAdapter(source)).ok).toBe(true);
  return service;
}
describe("CODEX-002F F04-R2 creation commitment obligations", () => {
  it("accounts structured failure after real commitment before shutdown and recovers durably", async () => {
    const f = await active({ captureEnabled: true }, true);
    await emit(f);
    expect(f.service.readiness()).toBe(true);
    const start = f.repository!.start.bind(f.repository);
    let starts = 0,
      aborts = 0;
    f.repository!.start = (m) => {
      starts++;
      expect(start(m).ok).toBe(true);
      return creationFailure(f);
    };
    f.repository!.abort = () => {
      aborts++;
      throw Error("uncertain ownership must not be compensated");
    };
    const created = f.service.startCapture(sourceId, "committed-unknown");
    expect(created).toEqual(creationFailure(f));
    expect(manifestState(f, "committed-unknown")).toBe("RUNNING");
    expect(f.service.diagnostics()).toMatchObject({ state: "FAILED", recoveryRequired: true });
    expect(f.service.diagnostics().providers[0]).toMatchObject({
      captureRunning: false,
      captureRecovery: {
        captureId: "committed-unknown",
        lastKnownManifestState: "UNKNOWN",
        cleanupConfirmed: false,
        recoveryRequired: true,
        error: creationFailure(f).error,
      },
    });
    expect(f.service.diagnostics().providers[0]!.captureCreationPending).toBeUndefined();
    expect(f.service.readiness()).toBe(false);
    expect(f.service.startCapture(sourceId, "forbidden").ok).toBe(false);
    expect(await f.service.stop()).toEqual(created);
    expect(await f.service.stop()).toEqual(created);
    expect(starts).toBe(1);
    expect(aborts).toBe(0);
    expect(manifestState(f, "committed-unknown")).toBe("RUNNING");
    const next = freshService(f, new FilesystemCaptureRepository(f.root!, f.clock, 10485760, 32));
    expect((await next.start()).ok).toBe(true);
    expect(manifestState(f, "committed-unknown")).toBe("ABORTED");
    expect(next.diagnostics().recoveryRequired).toBe(false);
    expect(await f.service.stop()).toEqual(created);
    expect((await next.stop()).ok).toBe(true);
  });
  it("failed durable recovery cannot report healthy startup or a false ABORTED manifest", async () => {
    const f = await active({ captureEnabled: true }, true);
    const start = f.repository!.start.bind(f.repository);
    f.repository!.start = (m) => {
      expect(start(m).ok).toBe(true);
      return creationFailure(f);
    };
    expect(f.service.startCapture(sourceId, "recovery-failed").ok).toBe(false);
    expect((await f.service.stop()).ok).toBe(false);
    const repository = new FilesystemCaptureRepository(f.root!, f.clock, 10485760, 32);
    let aborts = 0;
    repository.abort = () => {
      aborts++;
      return creationFailure(f);
    };
    const next = freshService(f, repository);
    expect(await next.start()).toEqual(creationFailure(f));
    expect(next.diagnostics().state).toBe("FAILED");
    expect(next.readiness()).toBe(false);
    expect(next.startCapture(sourceId, "forbidden").ok).toBe(false);
    expect(manifestState(f, "recovery-failed")).toBe("RUNNING");
    expect(aborts).toBe(1);
  });
  it.each(["structured", "throw"] as const)(
    "%s failure without artifacts retains uncertainty until fresh discovery",
    async (mode) => {
      const f = await active({ captureEnabled: true }, true);
      let calls = 0;
      f.repository!.start = () => {
        calls++;
        if (mode === "throw") throw Error("private creation details");
        return creationFailure(f);
      };
      expect(f.service.startCapture(sourceId, "unknown-empty").ok).toBe(false);
      expect(f.service.diagnostics().providers[0]!.captureRecovery).toMatchObject({
        captureId: "unknown-empty",
        lastKnownManifestState: "UNKNOWN",
        recoveryRequired: true,
      });
      expect(f.service.diagnostics().state).toBe("FAILED");
      expect(f.service.readiness()).toBe(false);
      expect(JSON.stringify(f.service.diagnostics())).not.toContain("private creation details");
      expect(f.repository!.recover()).toEqual({ ok: true, value: [] });
      expect((await f.service.stop()).ok).toBe(false);
      expect((await f.service.stop()).ok).toBe(false);
      expect(calls).toBe(1);
      const next = freshService(f, new FilesystemCaptureRepository(f.root!, f.clock, 10485760, 32));
      expect((await next.start()).ok).toBe(true);
      expect(next.diagnostics().recoveryRequired).toBe(false);
      expect((await next.stop()).ok).toBe(true);
    },
  );
  it("retains structured failure after reentrant shutdown begins", async () => {
    const f = fixture({ captureEnabled: true }, true);
    expect((await f.service.start()).ok).toBe(true);
    const start = f.repository!.start.bind(f.repository);
    let stopped: ReturnType<RealtimeDataService["stop"]> | undefined;
    f.repository!.start = (m) => {
      expect(start(m).ok).toBe(true);
      stopped = f.service.stop();
      return creationFailure(f);
    };
    // The synchronous port reenters stop before delivering the failed creation result.
    expect(f.service.startCapture(sourceId, "after-stop").ok).toBe(false);
    expect((await stopped)!.ok).toBe(false);
    expect(f.service.diagnostics()).toMatchObject({ state: "FAILED", recoveryRequired: true });
    expect(manifestState(f, "after-stop")).toBe("RUNNING");
    expect(await f.service.stop()).toEqual(creationFailure(f));
    expect(await f.service.stop()).toEqual(creationFailure(f));
  });
  it("nested provider failures retain independent identities despite diagnostic eviction", async () => {
    const f = fixture({ captureEnabled: true, maxEvidence: 1 }, true);
    const other = dataSourceRefSchema.parse({
      ...source,
      sourceId: "30000000-0000-4000-8000-000000000003",
    });
    expect(f.service.register(new ScriptedAdapter(other)).ok).toBe(true);
    expect((await f.service.start()).ok).toBe(true);
    const start = f.repository!.start.bind(f.repository);
    let starts = 0,
      aborts = 0;
    f.repository!.abort = () => {
      aborts++;
      return creationFailure(f);
    };
    f.repository!.start = (m) => {
      starts++;
      expect(start(m).ok).toBe(true);
      if (m.source.sourceId === sourceId)
        expect(f.service.startCapture(other.sourceId, "inner-unknown").ok).toBe(false);
      return { ...creationFailure(f), error: { ...creationFailure(f).error, scope: m.captureId } };
    };
    expect(f.service.startCapture(sourceId, "outer-unknown").ok).toBe(false);
    const d = f.service.diagnostics();
    expect(d.providers.map((p) => [p.sourceId, p.captureRecovery?.captureId])).toEqual([
      [sourceId, "outer-unknown"],
      [other.sourceId, "inner-unknown"],
    ]);
    expect(d.providers.every((p) => p.captureRecovery?.lastKnownManifestState === "UNKNOWN")).toBe(
      true,
    );
    expect(d.errors).toHaveLength(1);
    expect(d.metrics.evidenceEvictions).toBeGreaterThan(0);
    expect(d.state).toBe("FAILED");
    expect((await f.service.stop()).ok).toBe(false);
    expect((await f.service.stop()).ok).toBe(false);
    expect(starts).toBe(2);
    expect(aborts).toBe(0);
    expect(manifestState(f, "outer-unknown")).toBe("RUNNING");
    expect(manifestState(f, "inner-unknown")).toBe("RUNNING");
    const recovered = new FilesystemCaptureRepository(f.root!, f.clock, 10485760, 32).recover();
    expect(recovered.ok && recovered.value.map((m) => [m.captureId, m.state])).toEqual([
      ["inner-unknown", "ABORTED"],
      ["outer-unknown", "ABORTED"],
    ]);
  });
  it("late callback cannot activate or retry a capture after uncertain creation", async () => {
    const f = await active({ captureEnabled: true }, true);
    const start = f.repository!.start.bind(f.repository);
    let calls = 0,
      late: boolean | undefined;
    f.repository!.start = (m) => {
      calls++;
      expect(start(m).ok).toBe(true);
      f.scheduler.scheduleAfter(durationMs(1), () => {
        late = f.service.startCapture(sourceId, "late-unknown").ok;
      });
      return creationFailure(f);
    };
    expect(f.service.startCapture(sourceId, "before-late").ok).toBe(false);
    await advance(f, 1);
    expect(late).toBe(false);
    expect(calls).toBe(1);
    expect(f.service.diagnostics().providers[0]!.captureRecovery!.captureId).toBe("before-late");
    expect(manifestState(f, "before-late")).toBe("RUNNING");
    expect((await f.service.stop()).ok).toBe(false);
  });
  it("failure on a preexisting completed identity never aborts or changes completed content", async () => {
    const f = await active({ captureEnabled: true }, true);
    expect(f.service.startCapture(sourceId, "existing-complete").ok).toBe(true);
    await emit(f);
    const complete = f.service.finishCapture(sourceId);
    expect(complete.ok).toBe(true);
    const before = readFileSync(join(f.root!, "existing-complete", "manifest.json"), "utf8");
    const abort = f.repository!.abort.bind(f.repository);
    let aborts = 0;
    f.repository!.abort = (id) => {
      aborts++;
      return abort(id);
    };
    // The real repository refuses the existing directory; the generic result proves no ownership.
    expect(f.service.startCapture(sourceId, "existing-complete").ok).toBe(false);
    expect(f.service.diagnostics().providers[0]!.captureRecovery!.lastKnownManifestState).toBe(
      "UNKNOWN",
    );
    expect((await f.service.stop()).ok).toBe(false);
    expect((await f.service.stop()).ok).toBe(false);
    expect(aborts).toBe(0);
    expect(readFileSync(join(f.root!, "existing-complete", "manifest.json"), "utf8")).toBe(before);
    expect(f.repository!.verify("existing-complete")).toEqual(complete);
    const next = freshService(f, new FilesystemCaptureRepository(f.root!, f.clock, 10485760, 32));
    expect((await next.start()).ok).toBe(true);
    expect(manifestState(f, "existing-complete")).toBe("COMPLETED");
    expect((await next.stop()).ok).toBe(true);
  });
});

describe("CODEX-002F enforced no-commit evidence", () => {
  it("real symlink rejection certifies no mutation and preserves successful stop", async () => {
    const f = await active({ captureEnabled: true }, true);
    const target = mkdtempSync(join(tmpdir(), "ate-no-commit-"));
    roots.push(target);
    symlinkSync(target, join(f.root!, "linked"), "dir");
    const result = f.service.startCapture(sourceId, "linked");
    expect(result).toMatchObject({ ok: false, commitment: "NOT_CREATED" });
    expect(existsSync(join(target, "manifest.json"))).toBe(false);
    expect(existsSync(join(target, "records.partial"))).toBe(false);
    expect(f.service.diagnostics().recoveryRequired).toBe(false);
    expect(f.service.diagnostics().state).not.toBe("FAILED");
    expect((await f.service.stop()).ok).toBe(true);
    expect((await f.service.stop()).ok).toBe(true);
  });
  it("partial mutation cannot certify no commitment and fresh discovery fails closed", async () => {
    const f = await active({ captureEnabled: true }, true);
    const start = f.repository!.start.bind(f.repository);
    f.repository!.start = (m) => start({ ...m, adapterId: "x".repeat(262144) });
    const result = f.service.startCapture(sourceId, "partial-create");
    expect(result).toMatchObject({ ok: false });
    expect(result).not.toHaveProperty("commitment");
    expect(existsSync(join(f.root!, "partial-create", "records.partial"))).toBe(true);
    expect(existsSync(join(f.root!, "partial-create", "manifest.json"))).toBe(false);
    expect(f.service.diagnostics().providers[0]!.captureRecovery).toMatchObject({
      captureId: "partial-create",
      lastKnownManifestState: "UNKNOWN",
      recoveryRequired: true,
    });
    expect((await f.service.stop()).ok).toBe(false);
    expect((await f.service.stop()).ok).toBe(false);
    const next = freshService(f, new FilesystemCaptureRepository(f.root!, f.clock, 10485760, 32));
    expect((await next.start()).ok).toBe(false);
    expect(next.diagnostics().state).toBe("FAILED");
    expect(next.readiness()).toBe(false);
  });
});
