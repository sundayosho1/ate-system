import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  dataSourceRefSchema,
  marketObservationSchema,
  marketObservationSemanticFingerprint,
  schemas,
  type UtcTimestamp,
} from "@ate/domain";
import {
  durationMs,
  parseCanonicalUtc,
  type Clock,
  type DeterministicScheduler,
  type ScheduledTaskId,
} from "@ate/time";
import { AdapterRegistry } from "./adapters.js";
import { validateRealtimeOptions, type RealtimeOptions } from "./configuration.js";
import {
  boundedInput,
  BoundedQueue,
  ConsumerChannel,
  failure,
  fingerprint,
  immutable,
  safeId,
} from "./primitives.js";
import type { CaptureRepository } from "./capture.js";
import {
  metricNames,
  type AcceptedObservation,
  type ConnectionSession,
  type ConnectionState,
  type ControlRecord,
  type GapRecord,
  type IngressEnvelope,
  type IntegrityWarning,
  type MaterializationHandoff,
  type Metrics,
  type NativeMessage,
  type ProviderAdapter,
  type RealtimeErrorCode,
  type RealtimeError,
  type RealtimeResult,
  type StreamIntegrityEvidence,
  type SubscriptionRecord,
  type SubscriptionRequest,
} from "./types.js";

const nativeMessageSchema = z
  .object({
    subscriptionId: z.string().min(1).max(128),
    sourceId: schemas.sourceId,
    observationKind: z.enum(["QUOTE", "TICK", "TRADE", "BAR", "MARKET_STATUS"]),
    eventId: z.string().min(1).max(128).optional(),
    sequence: z.string().min(1).max(128).optional(),
    sourceTime: z.string().min(1).max(64).optional(),
    payload: z.unknown(),
  })
  .strict()
  .refine((value) => Object.hasOwn(value, "payload") && value.payload !== undefined);

type StreamState = {
  lastEvent?: UtcTimestamp;
  lastAccepted?: UtcTimestamp;
  lastFresh?: UtcTimestamp;
  sequence?: bigint;
  freshness: "UNKNOWN" | "FRESH" | "AGING" | "STALE";
  seen: Map<string, { at: number; fingerprint: string }>;
  uncertain: boolean;
};
type ProviderState = {
  adapter: ProviderAdapter;
  state: ConnectionState;
  generation: number;
  abort: AbortController;
  session?: ConnectionSession;
  queue: BoundedQueue<IngressEnvelope>;
  subscriptions: Map<string, SubscriptionRecord>;
  streams: Map<string, StreamState>;
  subscriptionAborts: Map<string, AbortController>;
  localSequence: number;
  retry: number;
  retryStarted?: number;
  retryTask?: ScheduledTaskId;
  monitorTask?: ScheduledTaskId;
  heartbeat?: UtcTimestamp;
  activity?: UtcTimestamp;
  captureId?: string;
  captureCreating?: string;
  captureRecovery?: Readonly<{
    captureId: string;
    lastKnownManifestState: "RUNNING" | "UNKNOWN";
    cleanupConfirmed: false;
    recoveryRequired: true;
    error: RealtimeError;
  }>;
  captureStartMetrics?: Pick<Metrics, "rejected" | "duplicates" | "late" | "gaps" | "overflow">;
  evidence: Pick<Metrics, "rejected" | "duplicates" | "late" | "gaps" | "overflow">;
  connectPending?: Promise<RealtimeResult<void>>;
};
const transitions: Record<ConnectionState, readonly ConnectionState[]> = {
  DISCONNECTED: ["CONNECTING"],
  CONNECTING: ["CONNECTED", "DEGRADED", "FAILED", "DISCONNECTING"],
  CONNECTED: ["DEGRADED", "DISCONNECTING"],
  DEGRADED: ["RECONNECTING", "DISCONNECTING", "FAILED"],
  RECONNECTING: ["CONNECTED", "DEGRADED", "FAILED", "DISCONNECTING"],
  DISCONNECTING: ["DISCONNECTED", "FAILED"],
  FAILED: ["CONNECTING", "DISCONNECTING"],
};
export const permittedConnectionTransition = (
  from: ConnectionState,
  to: ConnectionState,
): boolean => transitions[from].includes(to);
export type RealtimeServiceInput = Readonly<{
  clock: Clock;
  scheduler: DeterministicScheduler;
  options: RealtimeOptions;
  configurationFingerprint: string;
  idGenerator?: () => string;
  captureRepository?: CaptureRepository;
  requiredSources?: readonly string[];
  desiredSubscriptions?: readonly SubscriptionRequest[];
}>;

export class RealtimeDataService {
  public readonly registry: AdapterRegistry;
  public readonly options: RealtimeOptions;
  private readonly providers = new Map<string, ProviderState>();
  private readonly consumers = new Map<string, ConsumerChannel>();
  private readonly histories: ConnectionSession[] = [];
  private readonly gapHistory: GapRecord[] = [];
  private readonly errors: RealtimeError[] = [];
  private readonly controls: BoundedQueue<ControlRecord>;
  private readonly metrics: Metrics = Object.fromEntries(metricNames.map((n) => [n, 0])) as Metrics;
  private readonly id: () => string;
  private running = false;
  private stopping = false;
  private started = false;
  private initialized = false;
  private drainScheduled = false;
  private failed = false;
  private readonly pending = new Set<Promise<unknown>>();
  private readonly operationCancels = new Set<() => void>();
  public constructor(private readonly input: RealtimeServiceInput) {
    this.options = validateRealtimeOptions(input.options);
    if (!/^sha256:[a-f0-9]{64}$/u.test(input.configurationFingerprint))
      throw new Error("configuration fingerprint required");
    if ((input.requiredSources?.length ?? 0) > this.options.maxProviders)
      throw new Error("required source capacity");
    if (
      (input.desiredSubscriptions?.length ?? 0) >
      this.options.maxProviders * this.options.maxSubscriptions
    )
      throw new Error("desired subscription capacity");
    this.id = input.idGenerator ?? randomUUID;
    this.registry = new AdapterRegistry(input.clock, this.options.maxProviders);
    this.controls = new BoundedQueue(this.options.maxEvidence);
  }
  public register(adapter: ProviderAdapter): RealtimeResult<void> {
    if (this.started) return failure(this.input.clock, "INVALID_ADAPTER", "registry");
    return this.registry.register(adapter);
  }
  public async start(): Promise<RealtimeResult<void>> {
    if (this.started) return failure(this.input.clock, "INVALID_TRANSITION", "service");
    this.started = true;
    if (this.options.captureEnabled && !this.input.captureRepository) {
      this.failed = true;
      return failure(this.input.clock, "CAPTURE_FAILED", "service");
    }
    const recovery = this.input.captureRepository?.recover();
    if (recovery && !recovery.ok) {
      this.failed = true;
      this.record(recovery.error);
      return recovery;
    }
    this.running = true;
    for (const adapter of this.registry.values()) {
      const p: ProviderState = {
        adapter,
        state: "DISCONNECTED",
        generation: 0,
        abort: new AbortController(),
        queue: new BoundedQueue(this.options.queueCapacity),
        subscriptions: new Map(),
        streams: new Map(),
        subscriptionAborts: new Map(),
        evidence: { rejected: 0, duplicates: 0, late: 0, gaps: 0, overflow: 0 },
        localSequence: 0,
        retry: 0,
      };
      this.providers.set(adapter.source.sourceId, p);
    }
    for (const request of this.input.desiredSubscriptions ?? []) {
      const restored = await this.subscribe(request);
      if (!restored.ok) {
        this.failed = true;
        this.record(restored.error);
        await this.stop();
        return restored;
      }
    }
    for (const adapter of this.registry.values())
      if (this.options.enabled) await this.connect(adapter.source.sourceId);
    this.initialized = this.running && !this.stopping && !this.failed;
    return { ok: true, value: undefined };
  }
  private bump(name: keyof Metrics, amount = 1): void {
    this.metrics[name] = Math.min(
      Number.MAX_SAFE_INTEGER,
      this.metrics[name] + Math.max(0, amount),
    );
  }
  private record(error: RealtimeError): void {
    this.errors.push(immutable(error));
    if (this.errors.length > this.options.maxEvidence) {
      this.errors.shift();
      this.bump("evidenceEvictions");
    }
  }
  private control(p: ProviderState, kind: ControlRecord["kind"], state: string): void {
    if (
      !this.controls.push(
        immutable({
          kind,
          sourceId: p.adapter.source.sourceId,
          sessionId: p.session?.sessionId ?? "none",
          state,
          timestamp: this.input.clock.now(),
        }),
      )
    )
      this.bump("controlOverflow");
  }
  private transition(p: ProviderState, next: ConnectionState): void {
    if (!permittedConnectionTransition(p.state, next))
      throw new Error("invalid connection transition");
    p.state = next;
    this.control(p, "CONNECTION", next);
  }
  private valid(p: ProviderState, generation: number): boolean {
    return this.running && !this.stopping && p.generation === generation && !p.abort.signal.aborted;
  }
  private track<T>(operation: Promise<T>): Promise<T> {
    this.pending.add(operation);
    void operation.finally(() => this.pending.delete(operation)).catch(() => undefined);
    return operation;
  }
  // Every asynchronous port operation has a virtual scheduler deadline and abort fencing.
  private async bounded<T>(
    operation: () => Promise<T>,
    signal: AbortSignal,
  ): Promise<RealtimeResult<T>> {
    let settle!: (result: RealtimeResult<T>) => void;
    const result = new Promise<RealtimeResult<T>>((resolve) => {
      settle = resolve;
    });
    let done = false;
    const finish = (value: RealtimeResult<T>) => {
      if (done) return;
      done = true;
      if (task.ok) this.input.scheduler.cancel(task.value);
      signal.removeEventListener("abort", cancel);
      this.operationCancels.delete(cancel);
      settle(value);
    };
    const cancel = () => finish(failure(this.input.clock, "SHUTDOWN_IN_PROGRESS", "adapter"));
    const task = this.input.scheduler.scheduleAfter(
      durationMs(this.options.operationTimeoutMs),
      () => finish(failure(this.input.clock, "OPERATION_TIMEOUT", "adapter")),
    );
    if (!task.ok) return failure(this.input.clock, "OPERATION_TIMEOUT", "scheduler");
    this.operationCancels.add(cancel);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    else {
      try {
        void operation().then(
          (value) => finish({ ok: true, value }),
          () => finish(failure(this.input.clock, "CONNECTION_FAILED", "adapter")),
        );
      } catch {
        finish(failure(this.input.clock, "CONNECTION_FAILED", "adapter"));
      }
    }
    return result;
  }
  public connect(sourceId: string): Promise<RealtimeResult<void>> {
    const p = this.providers.get(sourceId);
    if (!p || !this.running || this.stopping || !this.options.enabled)
      return Promise.resolve(failure(this.input.clock, "INVALID_TRANSITION", "connection"));
    if (p.connectPending) return p.connectPending;
    if (p.retryTask) {
      this.input.scheduler.cancel(p.retryTask);
      delete p.retryTask;
    }
    if (
      p.state === "CONNECTED" ||
      p.state === "CONNECTING" ||
      p.state === "RECONNECTING" ||
      p.state === "DISCONNECTING"
    )
      return Promise.resolve(failure(this.input.clock, "INVALID_TRANSITION", "connection"));
    const operation = this.doConnect(p);
    p.connectPending = operation;
    void operation
      .finally(() => {
        if (p.connectPending === operation) delete p.connectPending;
      })
      .catch(() => undefined);
    return this.track(operation);
  }
  private async doConnect(p: ProviderState): Promise<RealtimeResult<void>> {
    this.transition(p, p.state === "DEGRADED" ? "RECONNECTING" : "CONNECTING");
    p.abort.abort();
    p.abort = new AbortController();
    const generation = ++p.generation;
    p.session = immutable({
      sessionId: this.id(),
      adapterId: p.adapter.adapterId,
      adapterVersion: p.adapter.version,
      sourceId: p.adapter.source.sourceId,
      configurationFingerprint: this.input.configurationFingerprint,
      startedAt: this.input.clock.now(),
      reconnectAttempt: p.retry,
      healthSummary: "CONNECTING",
    });
    const context = {
      sessionId: p.session.sessionId,
      signal: p.abort.signal,
      callbacks: {
        observation: (message: NativeMessage) => {
          if (!this.valid(p, generation)) {
            this.bump("staleCallbacks");
            return failure<string>(this.input.clock, "STALE_SESSION", "callback");
          }
          return this.receive(p, message);
        },
        heartbeat: () => {
          if (this.valid(p, generation)) {
            p.heartbeat = this.input.clock.now();
          }
        },
        disconnected: () => {
          if (this.valid(p, generation)) this.interrupt(p);
        },
        error: () => {
          if (this.valid(p, generation)) this.interrupt(p);
        },
      },
    };
    const result = await this.bounded(() => p.adapter.connect(context), p.abort.signal);
    if (!this.valid(p, generation)) return failure(this.input.clock, "STALE_SESSION", "connection");
    if (!result.ok) {
      p.abort.abort();
      this.record(result.error);
      this.transition(p, "DEGRADED");
      this.finalize(p, "FAILED");
      this.scheduleReconnect(p);
      return result;
    }
    this.transition(p, "CONNECTED");
    p.session = immutable({
      ...p.session,
      connectedAt: this.input.clock.now(),
      healthSummary: "CONNECTED",
    });
    p.heartbeat = this.input.clock.now();
    for (const record of [...p.subscriptions.values()].sort((a, b) =>
      a.request.subscriptionId.localeCompare(b.request.subscriptionId),
    )) {
      if (record.desired === "ACTIVE") await this.apply(p, record.request, generation);
      if (!this.valid(p, generation)) break;
    }
    this.monitor(p, generation);
    return { ok: true, value: undefined };
  }
  private finalize(p: ProviderState, reason: ConnectionSession["healthSummary"]): void {
    if (!p.session || p.session.terminatedAt) return;
    p.session = immutable({
      ...p.session,
      terminatedAt: this.input.clock.now(),
      terminationReason: reason,
      healthSummary: reason,
    });
    this.histories.push(p.session);
    if (this.histories.length > this.options.maxEvidence) {
      this.histories.shift();
      this.bump("evidenceEvictions");
    }
  }
  private gap(
    p: ProviderState,
    kind: GapRecord["kind"],
    expected: string,
    observed: string,
    subscriptionId?: string,
  ): void {
    const gap = immutable({
      gapId: this.id(),
      sourceId: p.adapter.source.sourceId,
      sessionId: p.session?.sessionId ?? "none",
      ...(subscriptionId ? { subscriptionId } : {}),
      kind,
      expected,
      observed,
      detectedAt: this.input.clock.now(),
      status: "UNRESOLVED" as const,
      severity: "WARNING" as const,
    });
    this.gapHistory.push(gap);
    if (this.gapHistory.length > this.options.maxEvidence) {
      this.gapHistory.shift();
      this.bump("evidenceEvictions");
    }
    p.evidence.gaps++;
    this.bump("gaps");
    this.control(p, "GAP", kind);
  }
  private interrupt(p: ProviderState): void {
    if (p.state !== "CONNECTED" && p.state !== "CONNECTING" && p.state !== "RECONNECTING") return;
    this.transition(p, "DEGRADED");
    this.gap(p, "CONNECTION_GAP", "continuous session", "interrupted");
    p.abort.abort();
    ++p.generation;
    this.finalize(p, "INTERRUPTED");
    this.bump("overflow", p.queue.clear());
    for (const [id, s] of p.subscriptions) {
      if (s.desired === "ACTIVE")
        p.subscriptions.set(id, immutable({ ...s, state: "DEGRADED", applied: "UNCERTAIN" }));
    }
    for (const stream of p.streams.values()) {
      stream.uncertain = true;
      delete stream.sequence;
      stream.seen.clear();
    }
    this.scheduleReconnect(p);
  }
  private scheduleReconnect(p: ProviderState): void {
    if (!this.running || this.stopping || p.retryTask) return;
    const now = Date.parse(this.input.clock.now());
    p.retryStarted ??= now;
    const delay = Math.min(
      this.options.reconnectMaxDelayMs,
      this.options.reconnectInitialDelayMs * 2 ** p.retry,
    );
    if (
      p.retry >= this.options.reconnectMaxAttempts ||
      now + delay - p.retryStarted > this.options.reconnectWindowMs
    ) {
      this.transition(p, "FAILED");
      const exhausted = failure(this.input.clock, "RECONNECT_EXHAUSTED", "connection");
      if (!exhausted.ok) this.record(exhausted.error);
      return;
    }
    const generation = p.generation;
    const scheduled = this.input.scheduler.scheduleAfter(durationMs(delay), () => {
      delete p.retryTask;
      if (!this.running || this.stopping || p.generation !== generation) return;
      p.retry++;
      this.bump("reconnectAttempts");
      // Return to the sequential runner so it can execute this attempt's deadline.
      void this.connect(p.adapter.source.sourceId).catch(() => {
        const error = failure(this.input.clock, "CONNECTION_FAILED", "reconnect");
        if (!error.ok) this.record(error.error);
      });
    });
    if (scheduled.ok) p.retryTask = scheduled.value;
    else {
      this.transition(p, "FAILED");
      const error = failure(this.input.clock, "RECONNECT_EXHAUSTED", "scheduler");
      if (!error.ok) this.record(error.error);
    }
  }
  public subscribe(request: SubscriptionRequest): Promise<RealtimeResult<SubscriptionRecord>> {
    if (this.pending.size >= this.options.maxProviders * this.options.maxSubscriptions)
      return Promise.resolve(
        failure(this.input.clock, "QUEUE_OVERFLOW", "adapter operation capacity"),
      );
    return this.track(this.doSubscribe(request));
  }
  private async doSubscribe(
    request: SubscriptionRequest,
  ): Promise<RealtimeResult<SubscriptionRecord>> {
    const p = this.providers.get(request.sourceId);
    if (!p || !this.running || this.stopping)
      return failure(this.input.clock, "SHUTDOWN_IN_PROGRESS", "subscription");
    try {
      boundedInput(request, 2048, 4, 128);
      if (
        !safeId(request.subscriptionId) ||
        !schemas.instrumentId.safeParse(request.instrumentId).success ||
        !p.adapter.capabilities.observationKinds.includes(request.observationKind) ||
        !p.adapter.capabilities.subscriptionModes.includes(request.mode) ||
        (request.depth !== undefined && !Number.isSafeInteger(request.depth)) ||
        (request.depth !== undefined && request.depth < 1)
      )
        throw new Error("invalid subscription");
    } catch {
      return failure(this.input.clock, "SUBSCRIPTION_CONFLICT", "subscription");
    }
    const old = p.subscriptions.get(request.subscriptionId);
    if (old) {
      if (fingerprint(old.request) !== fingerprint(request) || old.desired === "CLOSED")
        return failure(this.input.clock, "SUBSCRIPTION_CONFLICT", "subscription");
      return { ok: true, value: old };
    }
    if (
      [...p.subscriptions.values()].some(
        (s) =>
          s.desired === "ACTIVE" &&
          fingerprint({ ...s.request, subscriptionId: "logical" }) ===
            fingerprint({ ...request, subscriptionId: "logical" }),
      )
    )
      return failure(this.input.clock, "SUBSCRIPTION_CONFLICT", "subscription");
    if (p.captureId)
      return failure(this.input.clock, "SUBSCRIPTION_CONFLICT", "capture provenance");
    if (p.subscriptions.size >= this.options.maxSubscriptions)
      return failure(this.input.clock, "SUBSCRIPTION_LIMIT", "subscription");
    const record: SubscriptionRecord = immutable({
      request: immutable({ ...request }),
      desired: "ACTIVE",
      applied: "NONE",
      state: "REQUESTED",
      configurationFingerprint: this.input.configurationFingerprint,
    });
    p.subscriptions.set(request.subscriptionId, record);
    p.streams.set(request.subscriptionId, {
      freshness: "UNKNOWN",
      seen: new Map(),
      uncertain: p.retry > 0,
    });
    if (p.state === "CONNECTED") return this.apply(p, request, p.generation);
    return { ok: true, value: record };
  }
  private async apply(
    p: ProviderState,
    request: SubscriptionRequest,
    generation: number,
  ): Promise<RealtimeResult<SubscriptionRecord>> {
    const previous = p.subscriptions.get(request.subscriptionId)!;
    p.subscriptions.set(
      request.subscriptionId,
      immutable({
        ...previous,
        state: p.retry > 0 ? "RESUBSCRIBING" : "SUBSCRIBING",
        applied: "NONE",
        sessionId: p.session!.sessionId,
      }),
    );
    const controller = new AbortController();
    p.subscriptionAborts.set(request.subscriptionId, controller);
    const abort = () => controller.abort();
    p.abort.signal.addEventListener("abort", abort, { once: true });
    const result = await this.bounded(
      () => p.adapter.subscribe(request, controller.signal),
      controller.signal,
    );
    p.abort.signal.removeEventListener("abort", abort);
    if (!result.ok) controller.abort();
    if (p.subscriptionAborts.get(request.subscriptionId) === controller)
      p.subscriptionAborts.delete(request.subscriptionId);
    const current = p.subscriptions.get(request.subscriptionId)!;
    if (!this.valid(p, generation) || current.desired !== "ACTIVE")
      return failure(this.input.clock, "STALE_SESSION", "subscription");
    const applied =
      result.ok && p.adapter.capabilities.subscriptionConfirmation ? result.value : "UNCERTAIN";
    const record = immutable({
      ...current,
      applied,
      state: result.ok ? (applied === "CONFIRMED" ? "ACTIVE" : "DEGRADED") : "FAILED",
    }) as SubscriptionRecord;
    p.subscriptions.set(request.subscriptionId, record);
    this.control(p, "SUBSCRIPTION", record.state);
    if (!result.ok) {
      this.bump("subscriptionFailures");
      const f = failure<SubscriptionRecord>(
        this.input.clock,
        "SUBSCRIPTION_FAILED",
        "subscription",
      );
      if (!f.ok) this.record(f.error);
      return f;
    }
    return { ok: true, value: record };
  }
  public unsubscribe(sourceId: string, id: string): Promise<RealtimeResult<void>> {
    if (this.pending.size >= this.options.maxProviders * this.options.maxSubscriptions)
      return Promise.resolve(
        failure(this.input.clock, "QUEUE_OVERFLOW", "adapter operation capacity"),
      );
    return this.track(this.doUnsubscribe(sourceId, id));
  }
  private async doUnsubscribe(sourceId: string, id: string): Promise<RealtimeResult<void>> {
    const p = this.providers.get(sourceId);
    const record = p?.subscriptions.get(id);
    if (!p || !record) return failure(this.input.clock, "SUBSCRIPTION_CONFLICT", "subscription");
    if (record.desired === "CLOSED") return { ok: true, value: undefined };
    if (!this.running || this.stopping)
      return failure(this.input.clock, "SHUTDOWN_IN_PROGRESS", "subscription");
    if (p.captureId)
      return failure(this.input.clock, "SUBSCRIPTION_CONFLICT", "capture provenance");
    p.subscriptionAborts.get(id)?.abort();
    p.subscriptions.set(id, immutable({ ...record, desired: "CLOSED", state: "UNSUBSCRIBING" }));
    const generation = p.generation;
    const result = await this.bounded(
      () => p.adapter.unsubscribe(record.request, p.abort.signal),
      p.abort.signal,
    );
    if (p.generation === generation)
      p.subscriptions.set(
        id,
        immutable({
          ...record,
          desired: "CLOSED",
          state: "CLOSED",
          applied: result.ok ? "NONE" : "UNCERTAIN",
        }),
      );
    this.control(p, "SUBSCRIPTION", "CLOSED");
    return result;
  }
  private receive(p: ProviderState, message: NativeMessage): RealtimeResult<string> {
    this.bump("received");
    const reject = (code: RealtimeErrorCode) => {
      p.evidence.rejected++;
      this.bump("rejected");
      const r = failure<string>(this.input.clock, code, "ingress");
      if (!r.ok) this.record(r.error);
      return r;
    };
    if (p.state !== "CONNECTED") return reject("STALE_SESSION");
    let safe: z.infer<typeof nativeMessageSchema>;
    try {
      safe = nativeMessageSchema.parse(
        boundedInput(
          message,
          this.options.maxMessageBytes,
          this.options.maxDepth,
          this.options.maxStringLength,
        ),
      );
    } catch {
      return reject("MALFORMED_PAYLOAD");
    }
    const subscription = p.subscriptions.get(safe.subscriptionId);
    if (
      !subscription ||
      subscription.desired !== "ACTIVE" ||
      (subscription.state !== "ACTIVE" && subscription.state !== "DEGRADED") ||
      subscription.sessionId !== p.session?.sessionId ||
      safe.sourceId !== p.adapter.source.sourceId ||
      safe.observationKind !== subscription.request.observationKind
    )
      return reject("SUBSCRIPTION_CONFLICT");
    let envelope: IngressEnvelope;
    try {
      envelope = immutable({
        ingressId: this.id(),
        sourceId: p.adapter.source.sourceId,
        adapterId: p.adapter.adapterId,
        adapterVersion: p.adapter.version,
        sessionId: p.session!.sessionId,
        subscriptionId: safe.subscriptionId,
        providerSymbol: subscription.request.providerSymbol,
        observationKind: safe.observationKind,
        ...(safe.eventId ? { eventId: safe.eventId } : {}),
        ...(safe.sequence ? { providerSequence: safe.sequence } : {}),
        ...(safe.sourceTime ? { sourceTime: safe.sourceTime } : {}),
        receivedAt: this.input.clock.now(),
        localSequence: ++p.localSequence,
        payloadFingerprint: fingerprint(safe.payload),
        payload: safe.payload,
        configurationFingerprint: this.input.configurationFingerprint,
      });
    } catch {
      return reject("MALFORMED_PAYLOAD");
    }
    p.activity = this.input.clock.now();
    if (!p.queue.push(envelope)) {
      p.evidence.overflow++;
      this.bump("overflow");
      this.gap(p, "UNKNOWN_GAP", "raw capacity", "rejected newest", safe.subscriptionId);
      const stream = p.streams.get(safe.subscriptionId);
      if (stream) stream.uncertain = true;
      return reject("QUEUE_OVERFLOW");
    }
    if (!this.drainScheduled) {
      this.drainScheduled = true;
      queueMicrotask(() => {
        this.drainScheduled = false;
        if (this.running && !this.stopping)
          void this.drain().catch(() => {
            const result = failure(this.input.clock, "NORMALIZATION_FAILED", "drain");
            if (!result.ok) this.record(result.error);
          });
      });
    }
    return { ok: true, value: envelope.ingressId };
  }
  public receiveBatch(
    sourceId: string,
    messages: readonly NativeMessage[],
    sessionId: string,
  ): readonly RealtimeResult<string>[] {
    const p = this.providers.get(sourceId);
    if (!p || p.session?.sessionId !== sessionId || messages.length > this.options.maxBatchSize) {
      this.bump("rejected", messages.length);
      return [failure(this.input.clock, "MALFORMED_PAYLOAD", "batch")];
    }
    return messages.map((m) => this.receive(p, m));
  }
  public async drain(sourceId?: string): Promise<void> {
    for (const p of this.providers.values()) {
      if (sourceId && sourceId !== p.adapter.source.sourceId) continue;
      let raw;
      while ((raw = p.queue.shift()) !== undefined) this.process(p, raw);
    }
    await Promise.resolve();
  }
  private process(p: ProviderState, raw: IngressEnvelope): void {
    const reject = (code: RealtimeErrorCode) => {
      p.evidence.rejected++;
      this.bump("rejected");
      const r = failure(this.input.clock, code, "normalization");
      if (!r.ok) this.record(r.error);
    };
    if (
      p.session?.sessionId !== raw.sessionId ||
      p.state !== "CONNECTED" ||
      p.subscriptions.get(raw.subscriptionId)?.desired !== "ACTIVE"
    ) {
      reject("STALE_SESSION");
      return;
    }
    const stream = p.streams.get(raw.subscriptionId)!;
    const request = p.subscriptions.get(raw.subscriptionId)!.request;
    let normalized: unknown;
    try {
      normalized = boundedInput(
        p.adapter.normalize(raw.payload),
        this.options.maxMessageBytes,
        this.options.maxDepth,
        this.options.maxStringLength,
      );
    } catch {
      this.bump("normalizationFailures");
      reject("NORMALIZATION_FAILED");
      return;
    }
    if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
      reject("NORMALIZATION_FAILED");
      return;
    }
    const fields = normalized as Record<string, unknown>;
    if (
      [
        "observationId",
        "source",
        "instrumentId",
        "receivedAt",
        "sourceTime",
        "sequence",
        "provenance",
      ].some((key) => key in fields)
    ) {
      reject("NORMALIZATION_FAILED");
      return;
    }
    if (fields.observationKind !== undefined && fields.observationKind !== raw.observationKind) {
      reject("NORMALIZATION_FAILED");
      return;
    }
    const financialValues = [
      fields.bid,
      fields.ask,
      fields.price,
      fields.open,
      fields.high,
      fields.low,
      fields.close,
      ...(fields.quote && typeof fields.quote === "object"
        ? Object.values(fields.quote as Record<string, unknown>)
        : []),
      ...(fields.trade && typeof fields.trade === "object"
        ? Object.values(fields.trade as Record<string, unknown>)
        : []),
    ];
    if (
      financialValues.some(
        (v) =>
          v &&
          typeof v === "object" &&
          "instrumentId" in v &&
          v.instrumentId !== request.instrumentId,
      )
    ) {
      reject("NORMALIZATION_FAILED");
      return;
    }
    const event = parseCanonicalUtc(fields.eventTime);
    if (!event.ok) {
      reject("INVALID_TIMESTAMP");
      return;
    }
    const sourceTime = raw.sourceTime === undefined ? undefined : parseCanonicalUtc(raw.sourceTime);
    if (sourceTime && !sourceTime.ok) {
      reject("INVALID_TIMESTAMP");
      return;
    }
    if (Date.parse(this.input.clock.now()) < Date.parse(raw.receivedAt)) {
      reject("INVALID_TIMESTAMP");
      return;
    }
    const receiveMs = Date.parse(raw.receivedAt);
    const sourceMs = sourceTime?.ok ? Date.parse(sourceTime.value) : undefined;
    const eventMs = Date.parse(event.value);
    if (
      eventMs - receiveMs > this.options.maxFutureSkewMs ||
      (sourceMs !== undefined && sourceMs - receiveMs > this.options.maxFutureSkewMs)
    ) {
      reject("INVALID_TIMESTAMP");
      return;
    }
    const sequence =
      p.adapter.capabilities.sequences !== "NONE" && raw.providerSequence !== undefined
        ? {
            sequence: raw.providerSequence,
            scope: "PROVIDER_STREAM" as const,
            scopeId: raw.subscriptionId,
          }
        : undefined;
    const source = dataSourceRefSchema.parse(p.adapter.source);
    const parsed = marketObservationSchema.safeParse({
      ...fields,
      schemaVersion: 1,
      observationId: raw.ingressId,
      observationKind: raw.observationKind,
      instrumentId: request.instrumentId,
      source,
      providerSymbol: request.providerSymbol,
      eventTime: event.value,
      receivedAt: raw.receivedAt,
      ...(sourceTime?.ok ? { sourceTime: sourceTime.value } : {}),
      ...(sequence ? { sequence } : {}),
      provenance: {
        source,
        providerSymbol: request.providerSymbol,
        ...(p.adapter.capabilities.eventIds && raw.eventId
          ? { sourceObservationId: raw.eventId }
          : {}),
        ...(sourceTime?.ok ? { sourceTime: sourceTime.value } : {}),
        ...(sequence ? { sequence } : {}),
        origin: source.sourceType === "SIMULATION" ? "SIMULATED" : "OBSERVED",
        deliveryMode: source.sourceType === "SIMULATION" ? "SIMULATED" : "LIVE",
        entitlementRef: p.adapter.capabilities.entitlementRef,
        metadata: {},
      },
    });
    if (!parsed.success) {
      this.bump("normalizationFailures");
      reject("NORMALIZATION_FAILED");
      return;
    }
    const warnings: IntegrityWarning[] = [];
    if (p.subscriptions.get(raw.subscriptionId)?.applied === "UNCERTAIN")
      warnings.push("SUBSCRIPTION_UNCERTAIN");
    if (!sourceTime) warnings.push("SOURCE_TIME_MISSING");
    if (stream.uncertain) warnings.push("CONTINUITY_UNCERTAIN");
    const late =
      receiveMs - eventMs > this.options.maxLateAgeMs ||
      (sourceMs !== undefined && receiveMs - sourceMs > this.options.maxLateAgeMs);
    let seq: bigint | undefined;
    if (sequence && p.adapter.capabilities.sequences === "PER_SUBSCRIPTION_CONSECUTIVE") {
      if (!/^\d{1,128}$/u.test(sequence.sequence)) {
        reject("SEQUENCE_REGRESSION");
        return;
      }
      seq = BigInt(sequence.sequence);
    }
    const outOfOrder =
      (stream.lastEvent !== undefined && eventMs < Date.parse(stream.lastEvent)) ||
      (seq !== undefined && stream.sequence !== undefined && seq < stream.sequence);
    if (
      request.timeframe !== undefined &&
      parsed.data.observationKind === "BAR" &&
      parsed.data.timeframe !== request.timeframe
    ) {
      reject("NORMALIZATION_FAILED");
      return;
    }
    if (late) {
      p.evidence.late++;
      this.bump("late");
      warnings.push("LATE");
      if (this.options.rejectLate) {
        reject("INVALID_TIMESTAMP");
        return;
      }
    }
    if (outOfOrder) {
      this.bump("outOfOrder");
      warnings.push("OUT_OF_ORDER");
      if (this.options.rejectOutOfOrder) {
        reject("SEQUENCE_REGRESSION");
        return;
      }
    }
    for (const [key, evidence] of stream.seen)
      if (receiveMs - evidence.at >= this.options.dedupWindowMs) stream.seen.delete(key);
    const identity =
      p.adapter.capabilities.eventIds && raw.eventId
        ? `id:${raw.eventId}`
        : sequence
          ? `seq:${sequence.sequence}`
          : undefined;
    const semantic = marketObservationSemanticFingerprint(parsed.data);
    if (identity) {
      const old = stream.seen.get(identity);
      if (old) {
        if (old.fingerprint !== semantic) {
          reject("IDENTITY_CONFLICT");
          return;
        }
        p.evidence.duplicates++;
        this.bump("duplicates");
        return;
      }
    } else warnings.push("IDENTITY_UNCERTAIN");
    if (seq !== undefined && stream.sequence !== undefined && seq > stream.sequence + 1n) {
      this.gap(
        p,
        "SEQUENCE_GAP",
        (stream.sequence + 1n).toString(),
        seq.toString(),
        raw.subscriptionId,
      );
      warnings.push("SEQUENCE_GAP");
      stream.uncertain = true;
    }
    if (identity) {
      if (stream.seen.size >= this.options.dedupCapacity) {
        stream.seen.delete(stream.seen.keys().next().value!);
        this.bump("evidenceEvictions");
      }
      stream.seen.set(identity, { at: receiveMs, fingerprint: semantic });
    }
    if (seq !== undefined && (stream.sequence === undefined || seq > stream.sequence))
      stream.sequence = seq;
    if (!stream.lastEvent || eventMs > Date.parse(stream.lastEvent)) stream.lastEvent = event.value;
    stream.lastAccepted = event.value;
    this.updateFreshness(p, raw.subscriptionId, stream);
    if (
      Date.parse(this.input.clock.now()) - eventMs <= this.options.staleAfterMs / 2 &&
      (!stream.lastFresh || eventMs > Date.parse(stream.lastFresh))
    )
      stream.lastFresh = event.value;
    const { payload: _payload, ...ingress } = raw;
    const accepted: AcceptedObservation = immutable({
      ingress,
      observation: parsed.data,
      processedAt: this.input.clock.now(),
      warnings,
    });
    this.bump("accepted");
    this.bump("processingLatencyMs", Date.parse(accepted.processedAt) - receiveMs);
    for (const consumer of this.consumers.values())
      if (!consumer.deliver(accepted)) {
        p.evidence.overflow++;
        this.bump("overflow");
        this.gap(
          p,
          "UNKNOWN_GAP",
          "consumer capacity",
          "consumer rejected newest",
          raw.subscriptionId,
        );
      }
    if (p.captureId) {
      const result = this.input.captureRepository!.append(p.captureId, accepted);
      if (result.ok) this.bump("captureWrites");
      else {
        this.bump("captureFailures");
        this.record(result.error);
        this.control(p, "CAPTURE", "FAILED");
        delete p.captureId;
      }
    }
  }
  public consumer(id: string): RealtimeResult<ConsumerChannel> {
    if (
      !safeId(id) ||
      this.consumers.has(id) ||
      this.consumers.size >= this.options.maxConsumers ||
      this.stopping
    )
      return failure(this.input.clock, "QUEUE_OVERFLOW", "consumer");
    const channel = new ConsumerChannel(id, this.options.consumerQueueCapacity);
    this.consumers.set(id, channel);
    return { ok: true, value: channel };
  }
  public removeConsumer(id: string): void {
    const c = this.consumers.get(id);
    if (c) {
      this.bump("overflow", c.close());
      this.consumers.delete(id);
    }
  }
  private monitor(p: ProviderState, generation: number): void {
    if (p.monitorTask) this.input.scheduler.cancel(p.monitorTask);
    const task = this.input.scheduler.scheduleAfter(
      durationMs(this.options.monitorIntervalMs),
      () => {
        delete p.monitorTask;
        if (!this.valid(p, generation) || p.state !== "CONNECTED") return;
        this.checkFreshness(p);
        if (this.valid(p, generation)) this.monitor(p, generation);
      },
    );
    if (task.ok) p.monitorTask = task.value;
    else {
      this.record({
        code: "OPERATION_TIMEOUT",
        scope: "monitor",
        timestamp: this.input.clock.now(),
        message: "monitor scheduler capacity exhausted",
      });
      this.interrupt(p);
    }
  }
  private freshness(stream: StreamState): StreamState["freshness"] {
    if (!stream.lastEvent) return "UNKNOWN";
    const age = Date.parse(this.input.clock.now()) - Date.parse(stream.lastEvent);
    return age > this.options.staleAfterMs
      ? "STALE"
      : age > this.options.staleAfterMs / 2
        ? "AGING"
        : "FRESH";
  }
  private updateFreshness(p: ProviderState, id: string, stream: StreamState): void {
    const next = this.freshness(stream);
    if (next === "STALE" && stream.freshness !== "STALE") {
      this.bump("staleTransitions");
      this.control(p, "HEALTH", "STALE");
      if (p.subscriptions.get(id)?.request.expectedActivity)
        this.gap(p, "TIME_GAP", "configured activity", "no valid observations", id);
    }
    stream.freshness = next;
  }
  private checkFreshness(p: ProviderState): void {
    const now = Date.parse(this.input.clock.now());
    if (
      p.adapter.capabilities.heartbeats &&
      p.heartbeat &&
      now - Date.parse(p.heartbeat) > this.options.heartbeatTimeoutMs
    ) {
      this.bump("heartbeatFailures");
      this.gap(p, "HEARTBEAT_GAP", "provider heartbeat", "timeout");
      this.interrupt(p);
      return;
    }
    for (const [id, s] of p.streams) {
      const request = p.subscriptions.get(id);
      if (!request || request.desired !== "ACTIVE") continue;
      this.updateFreshness(p, id, s);
    }
  }
  public startCapture(sourceId: string, captureId: string): RealtimeResult<void> {
    const p = this.providers.get(sourceId);
    if (
      !p ||
      !this.running ||
      !this.initialized ||
      this.failed ||
      !this.options.captureEnabled ||
      !this.input.captureRepository ||
      p.captureId ||
      p.captureCreating ||
      p.captureRecovery ||
      !safeId(captureId) ||
      this.stopping
    )
      return failure(this.input.clock, "CAPTURE_FAILED", "capture");
    // Reserve before calling the synchronous port: it may reenter lifecycle methods.
    p.captureCreating = captureId;
    let result: RealtimeResult<void>;
    try {
      result = this.input.captureRepository.start(
        immutable({
          captureId,
          source: p.adapter.source,
          adapterId: p.adapter.adapterId,
          adapterVersion: p.adapter.version,
          configurationFingerprint: this.input.configurationFingerprint,
          startedAt: this.input.clock.now(),
          state: "RUNNING",
          sessionIds: p.session ? [p.session.sessionId] : [],
          subscriptions: [...p.subscriptions.values()]
            .filter((s) => s.desired === "ACTIVE")
            .map((s) => s.request),
          count: 0,
          bytes: 0,
          evidence: { rejected: 0, duplicates: 0, late: 0, gaps: 0, overflow: 0 },
          storageReference: `${captureId}/records.ndjson`,
        }),
      );
    } catch {
      result = failure(this.input.clock, "PERSISTENCE_FAILED", "capture creation");
      if (!result.ok) this.retainCaptureFailure(p, captureId, result.error, "UNKNOWN");
    } finally {
      delete p.captureCreating;
    }
    if (!result.ok && this.stopping && !p.captureRecovery)
      this.retainCaptureFailure(p, captureId, result.error, "UNKNOWN");
    if (result.ok && (!this.running || this.stopping || this.failed || !this.initialized)) {
      const aborted = this.cleanupCapture(p, captureId);
      if (!aborted.ok) return aborted;
      return failure(this.input.clock, "CAPTURE_FAILED", "capture lifecycle changed");
    }
    if (result.ok) {
      p.captureId = captureId;
      p.captureStartMetrics = { ...p.evidence };
      this.control(p, "CAPTURE", "RUNNING");
    }
    return result;
  }
  // A failed abort is an unresolved obligation, not an inactive/completed capture.
  // One retained obligation per bounded provider; restart uses durable manifest discovery.
  private cleanupCapture(p: ProviderState, captureId: string): RealtimeResult<void> {
    let result: RealtimeResult<void>;
    try {
      result = this.input.captureRepository!.abort(captureId);
    } catch {
      result = failure(this.input.clock, "PERSISTENCE_FAILED", "capture cleanup");
    }
    if (!result.ok) this.retainCaptureFailure(p, captureId, result.error, "RUNNING");
    return result;
  }
  private retainCaptureFailure(
    p: ProviderState,
    captureId: string,
    error: RealtimeError,
    lastKnownManifestState: "RUNNING" | "UNKNOWN",
  ): void {
    p.captureRecovery = immutable({
      captureId,
      lastKnownManifestState,
      cleanupConfirmed: false,
      recoveryRequired: true,
      error,
    });
    this.failed = true;
    this.bump("captureFailures");
    this.record(error);
    this.control(p, "CAPTURE", "RECOVERY_REQUIRED");
  }
  private captureCleanupFailure(): RealtimeError | undefined {
    for (const p of this.providers.values()) if (p.captureRecovery) return p.captureRecovery.error;
    return undefined;
  }
  public finishCapture(sourceId: string): RealtimeResult<MaterializationHandoff> {
    const p = this.providers.get(sourceId);
    if (!p?.captureId) return failure(this.input.clock, "CAPTURE_FAILED", "capture");
    if (p.queue.depth > 0)
      return failure(this.input.clock, "CAPTURE_FAILED", "pending capture ingress");
    const baseline = p.captureStartMetrics!;
    const result = this.input.captureRepository!.finish(p.captureId, {
      rejected: p.evidence.rejected - baseline.rejected,
      duplicates: p.evidence.duplicates - baseline.duplicates,
      late: p.evidence.late - baseline.late,
      gaps: p.evidence.gaps - baseline.gaps,
      overflow: p.evidence.overflow - baseline.overflow,
    });
    if (result.ok) {
      delete p.captureId;
      this.control(p, "CAPTURE", "COMPLETED");
    } else {
      this.bump("captureFailures");
      this.record(result.error);
    }
    return result;
  }
  public streamIntegrityEvidence(sourceId: string): RealtimeResult<StreamIntegrityEvidence> {
    const p = this.providers.get(sourceId);
    if (!p) return failure(this.input.clock, "INVALID_ADAPTER", "quality evidence");
    return {
      ok: true as const,
      value: immutable({
        sourceId,
        configurationFingerprint: this.input.configurationFingerprint,
        measuredAt: this.input.clock.now(),
        ...(p.session ? { sessionId: p.session.sessionId } : {}),
        evidence: { ...p.evidence },
        gaps: this.gapHistory.filter((g) => g.sourceId === sourceId),
        qualityAssessmentRequired: true as const,
        qualityCertified: false as const,
        tradingAuthorized: false as const,
      }),
    };
  }
  public readControl(): ControlRecord | undefined {
    return this.controls.shift();
  }
  public diagnostics() {
    return immutable({
      state: this.failed
        ? "FAILED"
        : this.stopping
          ? "STOPPING"
          : this.running
            ? "READY"
            : this.started
              ? "STOPPED"
              : "CREATED",
      recoveryRequired: this.captureCleanupFailure() !== undefined,
      metrics: { ...this.metrics },
      errors: [...this.errors],
      gaps: [...this.gapHistory],
      sessions: [...this.histories],
      controlQueue: this.controls.snapshot(),
      providers: [...this.providers.values()].map((p) => ({
        sourceId: p.adapter.source.sourceId,
        state: p.state,
        session: p.session,
        queue: p.queue.snapshot(),
        lastProviderActivity: p.activity,
        lastHeartbeat: p.heartbeat,
        subscriptions: [...p.subscriptions.values()],
        streams: [...p.streams.entries()].map(([id, s]) => ({
          subscriptionId: id,
          freshness: this.freshness(s),
          lastAcceptedEventTime: s.lastAccepted,
          latestAcceptedEventTime: s.lastEvent,
          lastFreshEventTime: s.lastFresh,
          continuityUncertain: s.uncertain,
          identityCacheSize: s.seen.size,
        })),
        captureRunning: p.captureId !== undefined,
        captureCreationPending: p.captureCreating,
        captureRecovery: p.captureRecovery,
      })),
      consumers: [...this.consumers.values()].map((c) => ({
        consumerId: c.consumerId,
        degraded: c.degraded,
        ...c.queue.snapshot(),
      })),
      commercialProviderConfigured: [...this.providers.values()].some(
        (p) => p.adapter.source.sourceType !== "SIMULATION",
      ),
      tradingAuthorized: false,
    });
  }
  public readiness(): boolean {
    return (
      this.running &&
      !this.failed &&
      !this.stopping &&
      (this.input.requiredSources ?? []).every((id) => {
        const p = this.providers.get(id);
        return (
          p?.state === "CONNECTED" &&
          [...p.subscriptions.values()].every(
            (s) => s.desired !== "ACTIVE" || s.state === "ACTIVE",
          ) &&
          [...p.streams.entries()].every(
            ([id, s]) =>
              p.subscriptions.get(id)?.desired !== "ACTIVE" ||
              (this.freshness(s) !== "STALE" && this.freshness(s) !== "UNKNOWN" && !s.uncertain),
          )
        );
      })
    );
  }
  public async stop(): Promise<RealtimeResult<void>> {
    if (!this.running) {
      const unresolved = this.captureCleanupFailure();
      return unresolved ? { ok: false, error: unresolved } : { ok: true, value: undefined };
    }
    if (this.stopping) return failure(this.input.clock, "SHUTDOWN_IN_PROGRESS", "service");
    this.stopping = true;
    const failures: RealtimeError[] = [];
    for (const p of this.providers.values()) {
      if (p.retryTask) this.input.scheduler.cancel(p.retryTask);
      if (p.monitorTask) this.input.scheduler.cancel(p.monitorTask);
      p.abort.abort();
      ++p.generation;
      this.bump("overflow", p.queue.clear());
      if (p.state !== "DISCONNECTED") this.transition(p, "DISCONNECTING");
      if (p.captureId) {
        const result = this.cleanupCapture(p, p.captureId);
        if (!result.ok) failures.push(result.error);
        this.control(p, "CAPTURE", result.ok ? "ABORTED" : "FAILED");
        delete p.captureId;
      }
      this.finalize(p, "STOPPED");
      for (const [id, subscription] of p.subscriptions)
        p.subscriptions.set(
          id,
          immutable({
            ...subscription,
            applied: "UNCERTAIN",
            state: subscription.desired === "CLOSED" ? "CLOSED" : "DEGRADED",
          }),
        );
    }
    for (const cancel of [...this.operationCancels]) cancel();
    await Promise.allSettled([...this.pending]);
    // Disconnects run concurrently, each with the same bounded virtual deadline.
    await Promise.all(
      [...this.providers.values()].map(async (p) => {
        const controller = new AbortController();
        const result = await this.bounded(
          () => p.adapter.disconnect(controller.signal),
          controller.signal,
        );
        if (!result.ok) {
          controller.abort();
          failures.push(result.error);
        }
        if (p.state === "DISCONNECTING") this.transition(p, result.ok ? "DISCONNECTED" : "FAILED");
      }),
    );
    for (const c of this.consumers.values()) this.bump("overflow", c.close());
    this.running = false;
    this.stopping = false;
    for (const error of failures) this.record(error);
    // Synchronous creation compensation finishes before the first awaited stop continuation.
    // Read shared obligations here so reentrant failures cannot escape the shutdown result.
    const unresolved = this.captureCleanupFailure();
    return unresolved
      ? { ok: false, error: unresolved }
      : failures.length
        ? { ok: false, error: failures[0]! }
        : { ok: true, value: undefined };
  }
}
