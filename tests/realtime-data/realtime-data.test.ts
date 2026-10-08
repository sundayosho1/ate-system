import { mkdtempSync, readFileSync, rmSync, writeFileSync, renameSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  dataSourceRefSchema,
  marketObservationSchema,
  stableMarketDataStringify,
} from "@ate/domain";
import { DeterministicScheduler, VirtualClock, durationMs, mustParseUtc } from "@ate/time";
import {
  realtimeConfigurationDefinitions,
  realtimeConfigurationSchemas,
  realtimeSettings,
  ConfigurationRegistry,
  ConfigurationSchemaRegistry,
  registerConfigurationSchemas,
  foundationalConfigurationDefinitions,
  foundationalConfigurationSchemas,
  buildConfigurationSnapshot,
  StaticConfigurationSource,
  configurationSourceId,
  configurationEntry,
  foundationalConfigurationKey,
  ConfigurationResolver,
  CapabilityRegistry,
  registerCapabilityDefinitions,
  capabilityId,
  foundationalFeatureFlagDefinitions,
} from "@ate/configuration";
import { buildRuntime } from "@ate/runtime";
import { StateAuthorityRegistry } from "@ate/persistence";
import { EventRegistry, EventFactory, InternalEventBus } from "@ate/events";
import {
  AdapterRegistry,
  BoundedQueue,
  FilesystemCaptureRepository,
  RealtimeDataService,
  RealtimeRuntimeService,
  ScriptedAdapter,
  boundedInput,
  defaultRealtimeOptions,
  fingerprint,
  permittedConnectionTransition,
  realtimeControlEvent,
  realtimeOptionsFromEffective,
  registerRealtimeStateAuthority,
  flushRealtimeControl,
  scriptedCapabilities,
  validateRealtimeOptions,
  type NativeMessage,
  type RealtimeOptions,
  type RealtimeResult,
  type SubscriptionRequest,
} from "@ate/realtime-data";

const sourceId = "30000000-0000-4000-8000-000000000001",
  instrumentId = "30000000-0000-4000-8000-000000000002";
const source = dataSourceRefSchema.parse({
  sourceId,
  sourceType: "SIMULATION",
  name: "Scripted fixture",
  role: "PRIMARY",
});
const at = "2026-10-08T10:00:00.000Z";
const request: SubscriptionRequest = {
  subscriptionId: "quotes",
  sourceId,
  instrumentId,
  providerSymbol: "EURUSD",
  observationKind: "QUOTE",
  mode: "STREAM",
  expectedActivity: false,
};
const quote = (eventTime = at, price = "1.23") => ({
  eventTime,
  bid: { value: price, instrumentId, quoteCurrency: "USD" },
});
const message = (overrides: Partial<NativeMessage> = {}): NativeMessage => ({
  subscriptionId: "quotes",
  sourceId,
  observationKind: "QUOTE",
  payload: quote(),
  ...overrides,
});
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const unwrap = <T>(r: RealtimeResult<T>): T => {
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
};
const root = () => {
  const r = mkdtempSync(join(tmpdir(), "ate-realtime-"));
  roots.push(r);
  return r;
};
function fixture(options: Partial<RealtimeOptions> = {}, captureRoot?: string) {
  const clock = new VirtualClock(mustParseUtc(at));
  const scheduler = new DeterministicScheduler(clock);
  let sequence = 10;
  const id = () => `30000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`;
  const adapter = new ScriptedAdapter(source);
  const configured = { ...defaultRealtimeOptions, enabled: true, ...options };
  const capture = captureRoot
    ? new FilesystemCaptureRepository(
        captureRoot,
        clock,
        configured.captureMaxFileBytes,
        configured.captureMaxSessions,
      )
    : undefined;
  const service = new RealtimeDataService({
    clock,
    scheduler,
    options: configured,
    configurationFingerprint: fingerprint(configured),
    idGenerator: id,
    ...(capture ? { captureRepository: capture } : {}),
  });
  unwrap(service.register(adapter));
  return { clock, scheduler, adapter, service, capture };
}
async function active(options: Partial<RealtimeOptions> = {}, captureRoot?: string) {
  const f = fixture(options, captureRoot);
  unwrap(await f.service.start());
  unwrap(await f.service.subscribe(request));
  return f;
}
async function advance(f: ReturnType<typeof fixture>, ms: number) {
  expect(f.clock.advanceBy(durationMs(ms)).ok).toBe(true);
  const result = await f.scheduler.runDueTasks();
  expect(result.ok).toBe(true);
  // Retry dispatch is nonblocking: settle the bounded scripted port promise chain,
  // without advancing virtual time or awaiting an unresolved adapter gate.
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
}
const deferred = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

describe("Prompt 17 adapters, sessions and subscriptions", () => {
  it("validates capability metadata, capacity and duplicate registration", () => {
    const f = fixture();
    const registry = new AdapterRegistry(f.clock, 1);
    expect(registry.register(f.adapter).ok).toBe(true);
    expect(registry.register(f.adapter).ok).toBe(false);
    const bad = new ScriptedAdapter(source, { ...scriptedCapabilities, observationKinds: [] });
    expect(new AdapterRegistry(f.clock, 2).register(bad).ok).toBe(false);
  });
  it("defines explicit connection transitions and immutable sessions", async () => {
    expect(permittedConnectionTransition("DISCONNECTED", "CONNECTED")).toBe(false);
    expect(permittedConnectionTransition("CONNECTED", "DEGRADED")).toBe(true);
    const f = await active();
    const session = f.service.diagnostics().providers[0]!.session!;
    expect(session.configurationFingerprint).toContain("sha256:");
    expect(Object.isFrozen(session)).toBe(true);
    unwrap(await f.service.stop());
    expect(f.service.diagnostics().sessions[0]!.terminatedAt).toBe(at);
  });
  it("joins duplicate connects and fences a connect/disconnect race", async () => {
    const f = fixture();
    const gate = deferred();
    f.adapter.connectGate = () => gate.promise;
    const start = f.service.start();
    const connect1 = f.service.connect(sourceId),
      connect2 = f.service.connect(sourceId);
    expect(connect1).toBe(connect2);
    const stop = f.service.stop();
    gate.release();
    await Promise.all([start, stop]);
    expect(f.service.diagnostics().providers[0]!.state).toBe("DISCONNECTED");
    expect(f.adapter.emit(message()).ok).toBe(false);
  });
  it("reconciles subscriptions in deterministic order after a new session", async () => {
    const f = await active();
    unwrap(
      await f.service.subscribe({
        ...request,
        subscriptionId: "another",
        providerSymbol: "GBPUSD",
      }),
    );
    const first = f.service.diagnostics().providers[0]!.session!.sessionId;
    f.adapter.interrupt();
    expect(f.service.diagnostics().providers[0]!.subscriptions[0]!.applied).toBe("UNCERTAIN");
    await advance(f, 1000);
    expect(f.service.diagnostics().providers[0]!.session!.sessionId).not.toBe(first);
    expect(f.adapter.applied.size).toBe(2);
    expect([...f.adapter.applied]).toEqual(["another", "quotes"]);
    expect(f.adapter.emit(message(), 0).ok).toBe(false);
    expect(f.service.diagnostics().gaps.some((g) => g.kind === "CONNECTION_GAP")).toBe(true);
    unwrap(await f.service.stop());
  });
  it("makes repeated subscribe/unsubscribe idempotent and rejects logical duplicates", async () => {
    const f = await active();
    expect((await f.service.subscribe(request)).ok).toBe(true);
    expect((await f.service.subscribe({ ...request, subscriptionId: "duplicate" })).ok).toBe(false);
    unwrap(await f.service.unsubscribe(sourceId, "quotes"));
    unwrap(await f.service.unsubscribe(sourceId, "quotes"));
    expect(f.adapter.emit(message()).ok).toBe(false);
    unwrap(await f.service.stop());
  });
  it("isolates subscription failure and enforces record limits", async () => {
    const f = await active({ maxSubscriptions: 2 });
    f.adapter.failSubscriptions.add("bad");
    expect(
      (await f.service.subscribe({ ...request, subscriptionId: "bad", providerSymbol: "bad" })).ok,
    ).toBe(false);
    expect(
      (await f.service.subscribe({ ...request, subscriptionId: "excess", providerSymbol: "other" }))
        .ok,
    ).toBe(false);
    expect(f.adapter.emit(message()).ok).toBe(true);
    unwrap(await f.service.stop());
  });
  it("does not let late subscription acknowledgement reactivate a closed request", async () => {
    const f = fixture();
    unwrap(await f.service.start());
    const gate = deferred();
    f.adapter.subscribeGate = () => gate.promise;
    const subscription = f.service.subscribe(request);
    unwrap(await f.service.unsubscribe(sourceId, "quotes"));
    gate.release();
    expect((await subscription).ok).toBe(false);
    expect(f.adapter.applied.has("quotes")).toBe(false);
    expect(f.service.diagnostics().providers[0]!.subscriptions[0]!.desired).toBe("CLOSED");
    unwrap(await f.service.stop());
  });
  it("represents uncertain applied state when provider cannot confirm", async () => {
    const f = fixture();
    const s = new ScriptedAdapter(
      {
        ...source,
        sourceId: dataSourceRefSchema.parse({
          ...source,
          sourceId: "30000000-0000-4000-8000-000000000003",
        }).sourceId,
      },
      { ...scriptedCapabilities, subscriptionConfirmation: false },
    );
    unwrap(f.service.register(s));
    unwrap(await f.service.start());
    const r = unwrap(await f.service.subscribe({ ...request, sourceId: s.source.sourceId }));
    expect(r.applied).toBe("UNCERTAIN");
    expect(r.state).toBe("DEGRADED");
    unwrap(await f.service.stop());
  });
});
describe("Prompt 17 bounded ingress and canonical evidence", () => {
  it("validates quotes and tick observations through Prompt 13", async () => {
    const f = await active();
    const c = unwrap(f.service.consumer("reader"));
    unwrap(f.adapter.emit(message({ sourceTime: at, eventId: "one", sequence: "1" })));
    unwrap(
      await f.service.subscribe({ ...request, subscriptionId: "ticks", observationKind: "TICK" }),
    );
    unwrap(
      f.adapter.emit(
        message({
          subscriptionId: "ticks",
          observationKind: "TICK",
          payload: {
            eventTime: at,
            tickKind: "QUOTE",
            quote: { bid: { value: "1.1", instrumentId, quoteCurrency: "USD" } },
          },
        }),
      ),
    );
    await f.service.drain();
    const quoteRecord = (await c.read())!;
    const tick = (await c.read())!;
    expect(marketObservationSchema.safeParse(quoteRecord.observation).success).toBe(true);
    expect(tick.observation.observationKind).toBe("TICK");
    expect(quoteRecord.ingress.receivedAt).toBe(at);
    expect(quoteRecord.processedAt).toBe(at);
    expect(quoteRecord.observation.sourceTime).toBe(at);
    expect(quoteRecord.observation.provenance.origin).toBe("SIMULATED");
    unwrap(await f.service.stop());
  });
  it("rejects malformed price, timestamp, excessive future skew and fabricated authority", async () => {
    const f = await active();
    for (const payload of [
      quote(at, "invalid"),
      quote("2026-10-08T10:00:00"),
      quote("2026-10-08T11:00:00Z"),
      { ...quote(), provenance: {} },
    ])
      unwrap(f.adapter.emit(message({ payload })));
    unwrap(f.adapter.emit(message({ sourceTime: "invalid" })));
    await f.service.drain();
    expect(f.service.diagnostics().metrics.accepted).toBe(0);
    expect(f.service.diagnostics().metrics.rejected).toBe(5);
    unwrap(await f.service.stop());
  });
  it("preserves missing source evidence and accepts legitimate equal-time observations", async () => {
    const f = await active();
    const c = unwrap(f.service.consumer("reader"));
    unwrap(f.adapter.emit(message()));
    unwrap(f.adapter.emit(message()));
    await f.service.drain();
    const first = (await c.read())!,
      second = (await c.read())!;
    expect(first.observation.sourceTime).toBeUndefined();
    expect(first.warnings).toContain("SOURCE_TIME_MISSING");
    expect(first.warnings).toContain("IDENTITY_UNCERTAIN");
    expect(second.ingress.localSequence).toBe(first.ingress.localSequence + 1);
    expect(f.service.diagnostics().metrics.duplicates).toBe(0);
    unwrap(await f.service.stop());
  });
  it("rejects unknown sources, oversize messages, accessors, cycles and secret-shaped input without echoing it", async () => {
    const f = await active({ maxMessageBytes: 256 });
    expect(f.adapter.emit(message({ sourceId: "unknown" })).ok).toBe(false);
    expect(f.adapter.emit(message({ payload: "x".repeat(1000) })).ok).toBe(false);
    expect(
      f.adapter.emit(message({ payload: { credential: "REPLACE_WITH_LOCAL_VALUE" } })).ok,
    ).toBe(false);
    const accessor = Object.defineProperty({}, "eventTime", {
      get: () => {
        throw new Error("getter must not run");
      },
      enumerable: true,
    });
    expect(f.adapter.emit(message({ payload: accessor })).ok).toBe(false);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(f.adapter.emit(message({ payload: cyclic })).ok).toBe(false);
    expect(JSON.stringify(f.service.diagnostics())).not.toContain("REPLACE_WITH_LOCAL_VALUE");
    unwrap(await f.service.stop());
  });
  it("rejects prototype pollution, deep nesting, nonfinite numbers and sensitive URL parameters", () => {
    expect(() => boundedInput(JSON.parse('{"__proto__":{}}') as unknown, 1000, 4, 128)).toThrow();
    expect(() => boundedInput({ a: { b: { c: { d: { e: 1 } } } } }, 1000, 3, 128)).toThrow();
    expect(() => boundedInput({ price: Infinity }, 1000, 3, 128)).toThrow();
    expect(() => boundedInput("https://example.test/feed?key=private", 1000, 3, 128)).toThrow();
    let trapped = false;
    const proxy = new Proxy(
      {},
      {
        ownKeys: () => {
          trapped = true;
          return [];
        },
      },
    );
    expect(() => boundedInput(proxy, 1000, 3, 128)).toThrow();
    expect(trapped).toBe(false);
  });
  it("bounds callback batches and preserves deterministic ingress ordering", async () => {
    const f = await active({ maxBatchSize: 2 });
    const c = unwrap(f.service.consumer("reader"));
    expect(
      f.service.receiveBatch(
        sourceId,
        [message(), message(), message()],
        f.service.diagnostics().providers[0]!.session!.sessionId,
      )[0]!.ok,
    ).toBe(false);
    await Promise.all([
      Promise.resolve().then(() => f.adapter.emit(message())),
      Promise.resolve().then(() => f.adapter.emit(message())),
    ]);
    await f.service.drain();
    expect((await c.read())!.ingress.localSequence).toBe(1);
    expect((await c.read())!.ingress.localSequence).toBe(2);
    unwrap(await f.service.stop());
  });
});
describe("Prompt 17 sequence, freshness and resilience", () => {
  it("deduplicates defensible identity and rejects conflicting identity reuse", async () => {
    const f = await active();
    unwrap(f.adapter.emit(message({ eventId: "event" })));
    unwrap(f.adapter.emit(message({ eventId: "event" })));
    unwrap(f.adapter.emit(message({ eventId: "event", payload: quote(at, "1.24") })));
    await f.service.drain();
    expect(f.service.diagnostics().metrics.accepted).toBe(1);
    expect(f.service.diagnostics().metrics.duplicates).toBe(1);
    expect(f.service.diagnostics().errors.some((e) => e.code === "IDENTITY_CONFLICT")).toBe(true);
    unwrap(await f.service.stop());
  });
  it("expires and bounds dedup evidence deterministically", async () => {
    const f = await active({ dedupCapacity: 1, dedupWindowMs: 1 });
    unwrap(f.adapter.emit(message({ eventId: "one" })));
    await f.service.drain();
    f.clock.advanceBy(durationMs(2));
    unwrap(f.adapter.emit(message({ eventId: "one" })));
    unwrap(f.adapter.emit(message({ eventId: "two" })));
    await f.service.drain();
    expect(f.service.diagnostics().metrics.accepted).toBe(3);
    expect(f.service.diagnostics().providers[0]!.streams[0]!.identityCacheSize).toBe(1);
    unwrap(await f.service.stop());
  });
  it("records sequence gaps, regressions and late data without rewriting event time", async () => {
    const f = await active({ maxLateAgeMs: 1 });
    const c = unwrap(f.service.consumer("reader"));
    unwrap(f.adapter.emit(message({ sequence: "1" })));
    unwrap(f.adapter.emit(message({ sequence: "3" })));
    unwrap(f.adapter.emit(message({ sequence: "2", payload: quote("2026-10-08T09:59:59.000Z") })));
    await f.service.drain();
    await c.read();
    expect((await c.read())!.warnings).toContain("SEQUENCE_GAP");
    const late = (await c.read())!;
    expect(late.warnings).toContain("OUT_OF_ORDER");
    expect(late.warnings).toContain("LATE");
    expect(late.observation.eventTime).toBe("2026-10-08T09:59:59.000Z");
    expect(f.service.diagnostics().gaps[0]!.expected).toBe("2");
    unwrap(await f.service.stop());
  });
  it("implements explicit rejection policies and rejects unsupported numeric sequence semantics", async () => {
    const f = await active({ rejectLate: true, maxLateAgeMs: 1 });
    unwrap(f.adapter.emit(message({ payload: quote("2026-10-08T09:59:00.000Z") })));
    unwrap(f.adapter.emit(message({ sequence: "opaque" })));
    await f.service.drain();
    expect(f.service.diagnostics().metrics.accepted).toBe(0);
    unwrap(await f.service.stop());
    const g = await active({ rejectOutOfOrder: true });
    unwrap(g.adapter.emit(message({ sequence: "2" })));
    unwrap(g.adapter.emit(message({ sequence: "1" })));
    await g.service.drain();
    expect(g.service.diagnostics().metrics.accepted).toBe(1);
    unwrap(await g.service.stop());
  });
  it("does not infer consecutive gaps for opaque provider sequences", async () => {
    const f = fixture();
    const otherSource = {
      ...source,
      sourceId: dataSourceRefSchema.parse({
        ...source,
        sourceId: "30000000-0000-4000-8000-000000000003",
      }).sourceId,
    };
    const a = new ScriptedAdapter(otherSource, {
      ...scriptedCapabilities,
      sequences: "PER_SUBSCRIPTION_OPAQUE",
    });
    unwrap(f.service.register(a));
    unwrap(await f.service.start());
    unwrap(await f.service.subscribe({ ...request, sourceId: otherSource.sourceId }));
    unwrap(a.emit(message({ sourceId: otherSource.sourceId, sequence: "abc" })));
    unwrap(a.emit(message({ sourceId: otherSource.sourceId, sequence: "xyz" })));
    await f.service.drain();
    expect(f.service.diagnostics().metrics.gaps).toBe(0);
    unwrap(await f.service.stop());
  });
  it("keeps heartbeat separate from observations and market activity uncertainty", async () => {
    const f = await active({ staleAfterMs: 1000, heartbeatTimeoutMs: 10000 });
    unwrap(f.adapter.emit(message()));
    await f.service.drain();
    f.adapter.heartbeat();
    await advance(f, 2000);
    expect(f.service.diagnostics().providers[0]!.streams[0]!.freshness).toBe("STALE");
    expect(f.service.diagnostics().gaps).toHaveLength(0);
    unwrap(await f.service.stop());
  });
  it("records time gaps only for configured active markets", async () => {
    const f = fixture({ staleAfterMs: 1000 });
    unwrap(await f.service.start());
    unwrap(await f.service.subscribe({ ...request, expectedActivity: true }));
    unwrap(f.adapter.emit(message()));
    await f.service.drain();
    await advance(f, 2000);
    expect(f.service.diagnostics().gaps.some((g) => g.kind === "TIME_GAP")).toBe(true);
    unwrap(await f.service.stop());
  });
  it("detects heartbeat timeout and retries with bounded backoff then exhausts", async () => {
    const f = await active({ heartbeatTimeoutMs: 1000, reconnectMaxAttempts: 2 });
    await advance(f, 2000);
    f.adapter.failConnectCount = 10;
    await advance(f, 1000);
    await advance(f, 2000);
    expect(f.service.diagnostics().providers[0]!.state).toBe("FAILED");
    expect(f.service.diagnostics().metrics.reconnectAttempts).toBe(2);
    expect(f.service.diagnostics().metrics.heartbeatFailures).toBe(1);
    unwrap(await f.service.stop());
  });
  it("cancels scheduled reconnects and ignores stale callbacks after shutdown", async () => {
    const f = await active();
    f.adapter.interrupt();
    unwrap(await f.service.stop());
    await advance(f, 10000);
    expect(f.adapter.callbacks.length).toBe(1);
    expect(f.adapter.emit(message()).ok).toBe(false);
    expect(f.service.diagnostics().metrics.staleCallbacks).toBe(1);
  });
  it("bounds a hung adapter connect through virtual operation deadline", async () => {
    const f = fixture({ operationTimeoutMs: 10, reconnectMaxAttempts: 0 });
    const gate = deferred();
    f.adapter.connectGate = () => gate.promise;
    const started = f.service.start();
    await advance(f, 11);
    await started;
    expect(f.service.diagnostics().providers[0]!.state).toBe("FAILED");
    gate.release();
    unwrap(await f.service.stop());
  });
});
describe("Prompt 17 backpressure and provider isolation", () => {
  it("rejects raw overflow explicitly and bounds memory", async () => {
    const f = await active({ queueCapacity: 1, maxEvidence: 1 });
    unwrap(f.adapter.emit(message()));
    expect(f.adapter.emit(message()).ok).toBe(false);
    expect(f.adapter.emit(message()).ok).toBe(false);
    expect(f.service.diagnostics().providers[0]!.queue.depth).toBe(1);
    expect(f.service.diagnostics().gaps).toHaveLength(1);
    expect(f.service.diagnostics().metrics.overflow).toBe(2);
    await f.service.drain();
    unwrap(await f.service.stop());
  });
  it("isolates slow consumers and reports delivery loss", async () => {
    const f = await active({ consumerQueueCapacity: 1 });
    const slow = unwrap(f.service.consumer("slow")),
      fast = unwrap(f.service.consumer("fast"));
    unwrap(f.adapter.emit(message()));
    await f.service.drain();
    await fast.read();
    unwrap(f.adapter.emit(message()));
    await f.service.drain();
    expect((await fast.read())!.observation).toBeDefined();
    expect(slow.degraded).toBe(true);
    expect(slow.queue.depth).toBe(1);
    expect(f.service.diagnostics().metrics.overflow).toBe(1);
    unwrap(await f.service.stop());
  });
  it("bounds standalone queue and consumer registration", async () => {
    const queue = new BoundedQueue<number>(1);
    expect(queue.push(1)).toBe(true);
    expect(queue.push(2)).toBe(false);
    expect(queue.snapshot().highWater).toBe(1);
    const f = await active({ maxConsumers: 1 });
    unwrap(f.service.consumer("one"));
    expect(f.service.consumer("two").ok).toBe(false);
    unwrap(await f.service.stop());
  });
  it("keeps a second provider operational when the first fails", async () => {
    const f = fixture({ reconnectMaxAttempts: 0 });
    const a = new ScriptedAdapter({
      ...source,
      sourceId: dataSourceRefSchema.parse({
        ...source,
        sourceId: "30000000-0000-4000-8000-000000000003",
      }).sourceId,
      role: "REFERENCE",
    });
    unwrap(f.service.register(a));
    unwrap(await f.service.start());
    unwrap(await f.service.subscribe({ ...request, sourceId: a.source.sourceId }));
    f.adapter.interrupt();
    expect(a.emit(message({ sourceId: a.source.sourceId })).ok).toBe(true);
    await f.service.drain();
    expect(f.service.diagnostics().metrics.accepted).toBe(1);
    unwrap(await f.service.stop());
  });
});
describe("Prompt 17 capture, recovery and integration", () => {
  it("finalizes verifiable capture content with provenance and explicit handoff", async () => {
    const dir = root();
    const f = await active({ captureEnabled: true }, dir);
    unwrap(f.service.startCapture(sourceId, "capture-1"));
    unwrap(f.adapter.emit(message({ eventId: "one" })));
    await f.service.drain();
    const handoff = unwrap(f.service.finishCapture(sourceId));
    expect(handoff.manifest.count).toBe(1);
    expect(handoff.manifest.contentFingerprint).toContain("sha256:");
    expect(handoff.researchQualified).toBe(false);
    expect(handoff.tradingAuthorized).toBe(false);
    expect(handoff.historicalMaterializationRequired).toBe(true);
    expect(handoff.manifest.configurationFingerprint).toBe(
      fingerprint({ ...defaultRealtimeOptions, enabled: true, captureEnabled: true }),
    );
    expect(f.capture!.verify("capture-1").ok).toBe(true);
    unwrap(await f.service.stop());
  });
  it("serializes deterministically and detects tampered content", async () => {
    const dir = root();
    const f = await active({ captureEnabled: true }, dir);
    unwrap(f.service.startCapture(sourceId, "capture"));
    unwrap(f.adapter.emit(message()));
    await f.service.drain();
    unwrap(f.service.finishCapture(sourceId));
    const file = join(dir, "capture", "records.ndjson");
    const content = readFileSync(file, "utf8");
    expect(stableMarketDataStringify(JSON.parse(content) as unknown) + "\n").toBe(content);
    writeFileSync(file, content + "{}\n");
    expect(f.capture!.verify("capture").ok).toBe(false);
    expect(f.capture!.recover().ok).toBe(false);
    unwrap(await f.service.stop());
  });
  it("recovers interrupted writes and content rename without inventing completion", async () => {
    const dir = root();
    const f = await active({ captureEnabled: true }, dir);
    unwrap(f.service.startCapture(sourceId, "capture"));
    unwrap(f.adapter.emit(message()));
    await f.service.drain();
    renameSync(join(dir, "capture", "records.partial"), join(dir, "capture", "records.ndjson"));
    const restarted = new FilesystemCaptureRepository(dir, f.clock, 10000, 32);
    const recovered = unwrap(restarted.recover());
    expect(recovered[0]!.state).toBe("ABORTED");
    expect(restarted.verify("capture").ok).toBe(false);
    unwrap(await f.service.stop());
  });
  it("detects partial records and capture byte limits rather than fabricating success", async () => {
    const dir = root();
    const f = await active({ captureEnabled: true, captureMaxFileBytes: 1024 }, dir);
    unwrap(f.service.startCapture(sourceId, "capture"));
    for (let i = 0; i < 3; i++) {
      unwrap(f.adapter.emit(message()));
      await f.service.drain();
    }
    expect(f.service.diagnostics().metrics.captureFailures).toBe(1);
    expect(f.capture!.verify("capture").ok).toBe(false);
    unwrap(await f.service.stop());
  });
  it("rejects unsafe capture paths and symlinks", async () => {
    const dir = root();
    const f = await active({ captureEnabled: true }, dir);
    expect(f.service.startCapture(sourceId, "../escape").ok).toBe(false);
    symlinkSync(root(), join(dir, "linked"), "dir");
    expect(f.service.startCapture(sourceId, "linked").ok).toBe(false);
    unwrap(await f.service.stop());
  });
  it("freezes subscription provenance during capture and aborts on shutdown", async () => {
    const dir = root();
    const f = await active({ captureEnabled: true }, dir);
    unwrap(f.service.startCapture(sourceId, "capture"));
    expect(
      (await f.service.subscribe({ ...request, subscriptionId: "new", providerSymbol: "new" })).ok,
    ).toBe(false);
    expect((await f.service.unsubscribe(sourceId, "quotes")).ok).toBe(false);
    unwrap(await f.service.stop());
    expect(unwrap(f.capture!.recover())[0]!.state).toBe("ABORTED");
  });
  it("registers governed settings with bounds and restart semantics", () => {
    const f = fixture();
    const definitions = realtimeConfigurationDefinitions(f.clock),
      schema = realtimeConfigurationSchemas(f.clock);
    expect(definitions).toHaveLength(Object.keys(realtimeSettings).length);
    expect(schema).toHaveLength(definitions.length);
    expect(definitions.every((d) => d.metadata?.reloadRequirement === "RESTART")).toBe(true);
    expect(() =>
      validateRealtimeOptions({ ...defaultRealtimeOptions, queueCapacity: 0 }),
    ).toThrow();
    expect(() =>
      validateRealtimeOptions({
        ...defaultRealtimeOptions,
        reconnectInitialDelayMs: 100,
        reconnectMaxDelayMs: 1,
      }),
    ).toThrow();
  });
  it("exposes optional-provider readiness and truthful runtime health", async () => {
    const f = fixture({ enabled: false });
    const runtime = new RealtimeRuntimeService(f.service, f.clock);
    const built = buildRuntime({
      runtimeInstanceId: instrumentId,
      runtimeVersion: "test",
      mode: "SIMULATION",
      clock: f.clock,
      services: [runtime.managedService],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error("runtime build failed");
    expect((await built.runtime.start()).ok).toBe(true);
    expect(built.runtime.snapshot().readiness.status).toBe("READY");
    expect(runtime.diagnostics().commercialProviderConfigured).toBe(false);
    expect((await built.runtime.stop()).ok).toBe(true);
  });
  it("registers only control-plane summaries rather than auditing every tick", async () => {
    const f = await active();
    const registry = new EventRegistry(f.clock);
    expect(registry.register(realtimeControlEvent).ok).toBe(true);
    let before = 0;
    while (f.service.readControl()) before++;
    for (let i = 0; i < 10; i++) unwrap(f.adapter.emit(message()));
    await f.service.drain();
    expect(f.service.readControl()).toBeUndefined();
    expect(before).toBeGreaterThan(0);
    unwrap(await f.service.stop());
  });
  it("guards architecture, clock authority and excluded functionality", () => {
    const files = [
      "adapters.ts",
      "capture.ts",
      "configuration.ts",
      "integration.ts",
      "primitives.ts",
      "service.ts",
      "types.ts",
    ];
    for (const file of files) {
      const content = readFileSync(join(process.cwd(), "packages/realtime-data/src", file), "utf8");
      expect(content).not.toMatch(
        /Date\.now\(|new Date\(|setTimeout\(|setInterval\(|process\.env|eval\(/u,
      );
      const imports = [...content.matchAll(/from\s+["']([^"']+)["']/gu)].map((m) => m[1]!);
      expect(
        imports.every(
          (i) =>
            !/@ate\/(strategy|risk|portfolio|execution|mt5|replay|aggregation|instrument-registry)/u.test(
              i,
            ),
        ),
      ).toBe(true);
    }
  });
});

describe("Prompt 17 additional failure paths", () => {
  it("normalizes trade, supplied bar and market status without implementing aggregation", async () => {
    const f = await active();
    const c = unwrap(f.service.consumer("all"));
    const cases = [
      {
        kind: "TRADE" as const,
        fields: { price: { value: "1.2", instrumentId, quoteCurrency: "USD" } },
      },
      {
        kind: "BAR" as const,
        fields: {
          timeframe: "M1",
          intervalStart: at,
          intervalEnd: "2026-10-08T10:01:00.000Z",
          open: { value: "1.2", instrumentId, quoteCurrency: "USD" },
          high: { value: "1.3", instrumentId, quoteCurrency: "USD" },
          low: { value: "1.1", instrumentId, quoteCurrency: "USD" },
          close: { value: "1.2", instrumentId, quoteCurrency: "USD" },
          completeness: "FINAL",
          volumes: [],
        },
      },
      {
        kind: "MARKET_STATUS" as const,
        fields: { status: "OPEN", statusSource: "PROVIDER_SUPPLIED" },
      },
    ];
    for (const item of cases) {
      const subscriptionId = item.kind.toLowerCase();
      unwrap(await f.service.subscribe({ ...request, subscriptionId, observationKind: item.kind }));
      unwrap(
        f.adapter.emit(
          message({
            subscriptionId,
            observationKind: item.kind,
            payload: { eventTime: at, ...item.fields },
          }),
        ),
      );
    }
    await f.service.drain();
    expect(f.service.diagnostics().metrics.accepted).toBe(3);
    for (const item of cases) expect((await c.read())!.observation.observationKind).toBe(item.kind);
    unwrap(await f.service.stop());
  });
  it("rejects queued observations after unsubscribe and old-session sequence mutation", async () => {
    const f = await active();
    unwrap(f.adapter.emit(message({ sequence: "100" })));
    unwrap(await f.service.unsubscribe(sourceId, "quotes"));
    await f.service.drain();
    expect(f.service.diagnostics().metrics.accepted).toBe(0);
    unwrap(await f.service.stop());
    const g = await active();
    unwrap(g.adapter.emit(message({ sequence: "100" })));
    g.adapter.interrupt();
    await advance(g, 1000);
    unwrap(g.adapter.emit(message({ sequence: "1" })));
    await g.service.drain();
    expect(g.service.diagnostics().metrics.accepted).toBe(1);
    expect(g.service.diagnostics().gaps.filter((x) => x.kind === "SEQUENCE_GAP")).toHaveLength(0);
    unwrap(await g.service.stop());
  });
  it("bounds hung subscribe and shutdown disconnect operations with virtual time", async () => {
    const f = fixture({ operationTimeoutMs: 10 });
    unwrap(await f.service.start());
    const gate = deferred();
    f.adapter.subscribeGate = () => gate.promise;
    const subscribe = f.service.subscribe(request);
    await advance(f, 11);
    expect((await subscribe).ok).toBe(false);
    gate.release();
    const hung = deferred();
    f.adapter.disconnectGate = () => hung.promise;
    const stopping = f.service.stop();
    await Promise.resolve();
    await Promise.resolve();
    await advance(f, 11);
    expect((await stopping).ok).toBe(false);
    hung.release();
    expect(f.service.diagnostics().state).toBe("STOPPED");
  });
  it("marks source-event freshness stale even when old observations keep arriving", async () => {
    const f = await active({ staleAfterMs: 1000 });
    f.clock.advanceBy(durationMs(2000));
    unwrap(f.adapter.emit(message()));
    await f.service.drain();
    await advance(f, 1000);
    expect(f.service.diagnostics().providers[0]!.streams[0]!.freshness).toBe("STALE");
    unwrap(await f.service.stop());
  });
  it("fails startup when capture storage is required but unavailable", async () => {
    const f = fixture({ captureEnabled: true });
    expect((await f.service.start()).ok).toBe(false);
    expect(f.service.diagnostics().state).toBe("FAILED");
  });
  it("detects manifest tampering and incomplete content finalization", async () => {
    const dir = root(),
      f = await active({ captureEnabled: true }, dir);
    unwrap(f.service.startCapture(sourceId, "capture"));
    unwrap(f.adapter.emit(message()));
    await f.service.drain();
    const partial = join(dir, "capture", "records.partial");
    writeFileSync(partial, readFileSync(partial, "utf8") + '{"partial":');
    expect(f.service.finishCapture(sourceId).ok).toBe(false);
    expect(f.capture!.verify("capture").ok).toBe(false);
    unwrap(await f.service.stop());
    const dir2 = root(),
      g = await active({ captureEnabled: true }, dir2);
    unwrap(g.service.startCapture(sourceId, "capture"));
    const manifest = join(dir2, "capture", "manifest.json"),
      data = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, unknown>;
    data.configurationFingerprint = fingerprint("tampered");
    writeFileSync(manifest, JSON.stringify(data));
    expect(g.capture!.recover().ok).toBe(false);
    expect((await g.service.stop()).ok).toBe(false);
  });
  it("does not mix evidence from unrelated providers into a capture", async () => {
    const dir = root(),
      f = fixture({ captureEnabled: true }, dir);
    const a = new ScriptedAdapter(
      dataSourceRefSchema.parse({ ...source, sourceId: "30000000-0000-4000-8000-000000000003" }),
    );
    unwrap(f.service.register(a));
    unwrap(await f.service.start());
    unwrap(await f.service.subscribe(request));
    unwrap(await f.service.subscribe({ ...request, sourceId: a.source.sourceId }));
    unwrap(f.service.startCapture(sourceId, "capture"));
    expect(a.emit(message({ sourceId: "unknown" })).ok).toBe(false);
    const handoff = unwrap(f.service.finishCapture(sourceId));
    expect(handoff.manifest.evidence.rejected).toBe(0);
    unwrap(await f.service.stop());
  });
});

it("keeps integrity handoff separate from quality certification", async () => {
  const f = await active();
  unwrap(f.adapter.emit(message({ sequence: "1" })));
  unwrap(f.adapter.emit(message({ sequence: "3" })));
  await f.service.drain();
  const evidence = unwrap(f.service.streamIntegrityEvidence(sourceId));
  expect(evidence.qualityCertified).toBe(false);
  expect(evidence.qualityAssessmentRequired).toBe(true);
  expect(evidence.gaps).toHaveLength(1);
  unwrap(await f.service.stop());
});
it("restores authorized desired subscriptions before connection and checks required-source readiness", async () => {
  const clock = new VirtualClock(mustParseUtc(at)),
    scheduler = new DeterministicScheduler(clock),
    adapter = new ScriptedAdapter(source);
  const service = new RealtimeDataService({
    clock,
    scheduler,
    options: { ...defaultRealtimeOptions, enabled: true },
    configurationFingerprint: fingerprint("governed"),
    desiredSubscriptions: [request],
    requiredSources: [sourceId],
  });
  unwrap(service.register(adapter));
  unwrap(await service.start());
  expect(service.diagnostics().providers[0]!.subscriptions[0]!.applied).toBe("CONFIRMED");
  expect(service.readiness()).toBe(false);
  unwrap(adapter.emit(message()));
  await service.drain();
  expect(service.readiness()).toBe(true);
  adapter.interrupt();
  expect(service.readiness()).toBe(false);
  unwrap(await service.stop());
});
it("rejects mismatched canonical financial instrument identity", async () => {
  const f = await active();
  unwrap(
    f.adapter.emit(
      message({
        payload: {
          eventTime: at,
          bid: {
            value: "1.2",
            instrumentId: "30000000-0000-4000-8000-000000000003",
            quoteCurrency: "USD",
          },
        },
      }),
    ),
  );
  await f.service.drain();
  expect(f.service.diagnostics().metrics.accepted).toBe(0);
  unwrap(await f.service.stop());
});

it("consumes governed effective configuration, schema validation and capability controls", async () => {
  const f = fixture(),
    registry = new ConfigurationRegistry(f.clock);
  for (const d of foundationalConfigurationDefinitions(f.clock))
    expect(registry.register(d).ok).toBe(true);
  const schemaRegistry = new ConfigurationSchemaRegistry(f.clock);
  expect(
    registerConfigurationSchemas(schemaRegistry, foundationalConfigurationSchemas(f.clock)).ok,
  ).toBe(true);
  const snapshot = await buildConfigurationSnapshot({
    registry,
    clock: f.clock,
    sources: [
      new StaticConfigurationSource({
        clock: f.clock,
        descriptor: {
          sourceId: configurationSourceId("realtime-test"),
          sourceType: "TEST",
          name: "Governed realtime fixture",
          criticality: "REQUIRED",
          failurePolicy: "FAIL_CLOSED",
          priority: 0,
        },
        entries: [
          configurationEntry({
            key: foundationalConfigurationKey("system.runtimeMode", f.clock),
            scopeType: "SYSTEM",
            value: "SIMULATION",
          }),
          configurationEntry({
            key: foundationalConfigurationKey("data.realtime.enabled", f.clock),
            scopeType: "SYSTEM",
            value: true,
          }),
          configurationEntry({
            key: foundationalConfigurationKey("data.realtime.queueCapacity", f.clock),
            scopeType: "SYSTEM",
            value: 17,
          }),
        ],
      }),
    ],
  });
  if (!snapshot.ok) throw new Error(snapshot.error.code);
  const effective = new ConfigurationResolver(registry, snapshot.value, f.clock).resolve({
    runtimeMode: "SIMULATION",
  });
  if (!effective.ok) throw new Error(effective.error.code);
  const options = realtimeOptionsFromEffective(effective.value);
  expect(options.options.queueCapacity).toBe(17);
  expect(options.options.enabled).toBe(true);
  expect(options.configurationFingerprint).toBe(effective.value.fingerprint);
  const capabilities = new CapabilityRegistry(f.clock);
  expect(registerCapabilityDefinitions(capabilities).ok).toBe(true);
  const capability = capabilities.require(capabilityId("data.marketData"));
  expect(capability.ok && capability.value.implementationStatus).toBe("IMPLEMENTED");
  expect(
    foundationalFeatureFlagDefinitions(f.clock).some(
      (d) => d.key === "data.realtime.enabled" && d.defaultEnabled === false,
    ),
  ).toBe(true);
  const authority = new StateAuthorityRegistry(f.clock);
  expect(registerRealtimeStateAuthority(authority).ok).toBe(true);
});
it("publishes bounded control summaries through the existing event bus", async () => {
  const f = await active(),
    registry = new EventRegistry(f.clock);
  expect(registry.register(realtimeControlEvent).ok).toBe(true);
  let n = 100;
  const factory = new EventFactory(registry, {
    runtimeMode: "SIMULATION",
    source,
    actor: { actorType: "SERVICE", displayName: "realtime-test" },
    clock: f.clock,
    idGenerator: () => `30000000-0000-4000-8000-${String(n++).padStart(12, "0")}`,
    maxCausationDepth: 8,
  });
  const bus = new InternalEventBus({ registry, factory, clock: f.clock });
  bus.start();
  const result = await flushRealtimeControl(f.service, factory, bus, 10);
  expect(result.published).toBeGreaterThan(0);
  expect(result.failed).toBe(0);
  unwrap(await f.service.stop());
});
