import { Decimal } from "decimal.js";
import {
  marketObservationSchema,
  deriveMidPrice,
  schemas,
  priceSchema,
  quantitySchema,
  type UtcTimestamp,
} from "@ate/domain";
import type { Clock } from "@ate/time";
import { z } from "zod";
import {
  CalendarBoundaryResolver,
  type TimeframeRegistry,
  type CalendarPolicy,
} from "./calendar.js";
import { defaultOptions, validateOptions, type Options } from "./configuration.js";
import { freeze, hash, instant, utc, ok, failure, safeClone, type Result } from "./primitives.js";
import {
  materialize,
  lineage,
  type AggregationRepository,
  type Stored,
  type WriteResult,
} from "./repository.js";
import type {
  Checkpoint,
  Contribution,
  Input,
  Revision,
  Snapshot,
  SnapshotRequest,
  Stream,
  WindowState,
} from "./types.js";
const D = Decimal.clone({ precision: 128, rounding: Decimal.ROUND_HALF_UP });
const decimal = (s: string): string => {
  schemas.decimal.parse(s);
  if (s.replace(/[-.]/gu, "").length > 60 || (s.split(".")[1]?.length ?? 0) > 18)
    throw Error("DECIMAL_PRECISION");
  return new D(s).toFixed();
};
const idSchema = z.string().min(1).max(128);
const evidenceSchema = z
  .object({
    observation: z.unknown(),
    identity: idSchema,
    sessionId: idSchema,
    channel: idSchema,
    origin: z.enum(["REALTIME", "HISTORICAL", "FIXTURE"]),
    sourceFingerprint: z.string().regex(/^(sha256:)?[a-f0-9]{64}$/u),
    artifactId: idSchema,
    availability: z.enum(["VERIFIED", "UNKNOWN"]),
    sourcePublishedAt: z.string().transform(instant).optional(),
    quality: z
      .object({
        reportId: idSchema,
        reportFingerprint: z.string().regex(/^(sha256:)?[a-f0-9]{64}$/u),
        findings: z
          .array(z.object({ findingId: idSchema, category: idSchema, severity: idSchema }).strict())
          .max(64),
        suppressed: z.number().int().min(0).max(1000000),
      })
      .strict()
      .optional(),
    continuity: z.enum(["CONTINUOUS", "GAP", "UNKNOWN"]),
    orderingSequence: z
      .string()
      .regex(/^\d{1,40}$/u)
      .optional(),
    warnings: z.array(z.string().max(128)).max(64),
  })
  .strict();
export type EngineInput = Readonly<{
  clock: Clock;
  repository: AggregationRepository;
  registry: TimeframeRegistry;
  calendar: CalendarPolicy;
  configurationFingerprint: string;
  options?: Options;
  directTimeframes: readonly string[];
  edges?: readonly Readonly<{ child: string; parent: string }>[];
}>;
export class AggregationEngine {
  private state: "CREATED" | "READY" | "STOPPING" | "STOPPED" | "FAILED" = "CREATED";
  private readonly options: Options;
  private readonly calendar: CalendarBoundaryResolver;
  private readonly policy: string;
  private checkpoint: Checkpoint;
  private busy = false;
  private recovery:
    | Readonly<{
        operationId: string;
        commitment: "UNKNOWN_COMMITMENT" | "COMMITTED";
        code: string;
      }>
    | undefined;
  private readonly errors: string[] = [];
  private readonly controls: Readonly<{
    kind: string;
    timestamp: UtcTimestamp;
    operationId: string;
  }>[] = [];
  private readonly delivery: string[] = [];
  private readonly counters: Record<string, number> = {
    received: 0,
    accepted: 0,
    rejected: 0,
    duplicates: 0,
    corrections: 0,
    finalized: 0,
    limits: 0,
    gaps: 0,
    snapshots: 0,
    snapshotFailures: 0,
    checkpointFailures: 0,
    recoveryFailures: 0,
    evidenceEvictions: 0,
  };
  private readonly input: EngineInput;
  public constructor(input: EngineInput) {
    this.input = {
      ...input,
      directTimeframes: Object.freeze([...input.directTimeframes]),
      edges: Object.freeze((input.edges ?? []).map((e) => freeze({ ...e }))),
    };
    this.options = validateOptions(input.options ?? defaultOptions);
    this.calendar = new CalendarBoundaryResolver(input.calendar);
    if (
      !/^(sha256:)?[a-f0-9]{64}$/u.test(input.configurationFingerprint) ||
      input.registry.values().length > this.options.maxTimeframes ||
      input.directTimeframes.length === 0 ||
      input.directTimeframes.length > this.options.maxTimeframes
    )
      throw Error("CONFIGURATION_INVALID");
    if (new Set(input.directTimeframes).size !== input.directTimeframes.length)
      throw Error("TIMEFRAME_DUPLICATE");
    for (const code of input.directTimeframes) input.registry.get(code);
    const edges = input.edges ?? [];
    if (
      edges.length > this.options.maxTimeframes ||
      new Set(edges.map((e) => e.parent)).size !== edges.length
    )
      throw Error("GRAPH_BOUNDS");
    for (const e of edges) {
      const c = input.registry.get(e.child),
        p = input.registry.get(e.parent);
      const compatible =
        p.kind === "FIXED"
          ? c.kind === "FIXED" &&
            p.durationMs! > c.durationMs! &&
            p.durationMs! % c.durationMs! === 0 &&
            c.anchorRule === p.anchorRule &&
            c.anchor === p.anchor
          : c.kind === "FIXED"
            ? c.durationMs! <= 86400000 && 86400000 % c.durationMs! === 0
            : c.period === "DAY" && (p.period === "WEEK" || p.period === "MONTH");
      if (e.child === e.parent || input.directTimeframes.includes(e.parent) || !compatible)
        throw Error("GRAPH_INCOMPATIBLE");
    }
    const known = new Set(input.directTimeframes);
    for (let i = 0; i < edges.length; i++)
      for (const e of edges) if (known.has(e.child)) known.add(e.parent);
    if (edges.some((e) => !known.has(e.child))) throw Error("GRAPH_UNREACHABLE");
    this.policy = hash({
      algorithm: "aggregation-v1",
      registry: input.registry.values(),
      calendar: this.calendar.policy,
      calendarAuthority: this.calendar.fingerprint,
      direct: input.directTimeframes,
      edges,
      options: this.options,
    });
    this.checkpoint = this.empty();
  }
  private empty(): Checkpoint {
    const body = {
      schemaVersion: 1 as const,
      configurationFingerprint: this.input.configurationFingerprint,
      policyFingerprint: this.policy,
      generation: 0,
      streams: {},
      watermarks: {},
      windows: [],
      revisions: [],
      publishedOperationIds: [],
    };
    return { ...body, fingerprint: hash(body) };
  }
  private bump(key: string) {
    this.counters[key] = Math.min(Number.MAX_SAFE_INTEGER, (this.counters[key] ?? 0) + 1);
  }
  private error(code: string) {
    if (this.errors.length >= this.options.maxEvidence) {
      this.errors.shift();
      this.bump("evidenceEvictions");
    }
    this.errors.push(code);
  }
  private writable() {
    if (this.state !== "READY" || this.busy || !this.options.enabled || this.recovery)
      throw Error("LIFECYCLE_REJECTED");
  }
  public start(): Result<void> {
    if (this.state !== "CREATED") return failure(this.input.clock, "LIFECYCLE_REJECTED");
    try {
      const r = this.input.repository.recover({
        configurationFingerprint: this.input.configurationFingerprint,
        policyFingerprint: this.policy,
      });
      if (!r.ok) {
        this.state = "FAILED";
        this.bump("recoveryFailures");
        return r;
      }
      if (r.value) {
        const state = structuredClone(materialize(r.value));
        this.validateCheckpoint(state);
        for (const m of Object.values(state.watermarks)) m.status = "FENCED";
        const { fingerprint: _fingerprint, ...body } = state;
        state.fingerprint = hash(body);
        this.checkpoint = state;
      }
      this.state = "READY";
      return ok(undefined);
    } catch {
      this.state = "FAILED";
      this.bump("recoveryFailures");
      return failure(this.input.clock, "RECOVERY_REQUIRED");
    }
  }
  private validateCheckpoint(c: Checkpoint): void {
    if (
      c.schemaVersion !== 1 ||
      c.configurationFingerprint !== this.input.configurationFingerprint ||
      c.policyFingerprint !== this.policy
    )
      throw Error("CHECKPOINT_CONTEXT");
    const { fingerprint, ...body } = c;
    if (hash(body) !== fingerprint || !Number.isSafeInteger(c.generation) || c.generation < 1)
      throw Error("CHECKPOINT_INTEGRITY");
    this.bounds(c);
    const byId = new Map(c.revisions.map((r) => [r.revisionId, r]));
    if (byId.size !== c.revisions.length) throw Error("REVISION_DUPLICATE");
    for (const [key, s] of Object.entries(c.streams))
      if (hash(s) !== key) throw Error("STREAM_INTEGRITY");
    for (const w of c.windows) {
      if (
        hash(this.calendar.resolve(this.input.registry.get(w.timeframe), w.window.start)) !==
        hash(w.window)
      )
        throw Error("WINDOW_CONTEXT");
      if (
        !c.streams[w.streamId] ||
        w.contributions.length > this.options.maxContributions ||
        w.barId !== this.barId(w.streamId, w.timeframe, w.window)
      )
        throw Error("WINDOW_INTEGRITY");
    }
    for (const r of c.revisions) {
      if (
        hash(r.stream) !== r.streamId ||
        r.timeframeDefinition.fingerprint !== r.window.timeframeFingerprint ||
        r.window.calendarFingerprint !== this.calendar.fingerprint ||
        r.timeframeDefinition.fingerprint !== this.input.registry.get(r.timeframe).fingerprint
      )
        throw Error("REVISION_CONTEXT");
      if (r.final && (!r.finalityAt || instant(r.finalityAt) < r.window.end))
        throw Error("FINALITY_TIME");
      if (
        !c.streams[r.streamId] ||
        r.barId !== this.barId(r.streamId, r.timeframe, r.window) ||
        r.constituents.length > this.options.maxContributions ||
        hash(this.content(r)) !== r.contentFingerprint ||
        hash(lineage(r.constituents)) !== r.lineageFingerprint
      )
        throw Error("REVISION_INTEGRITY");
      if (
        r.revisionId !==
        hash({
          barId: r.barId,
          generation: r.generation,
          contentFingerprint: r.contentFingerprint,
          lineageFingerprint: r.lineageFingerprint,
        })
      )
        throw Error("REVISION_IDENTITY");
      if (r.parentRevisionId) {
        const parent = byId.get(r.parentRevisionId);
        if (
          !parent ||
          parent.barId !== r.barId ||
          parent.generation + 1 !== r.generation ||
          parent.availableAt > r.availableAt
        )
          throw Error("REVISION_LINEAGE");
      }
      if (r.constituents.some((x) => x.revisionId && !byId.has(x.revisionId)))
        throw Error("INCOMPLETE_LINEAGE");
      if (
        Date.parse(r.availableAt) > Date.parse(this.input.clock.now()) ||
        r.availableAt < r.committedAt ||
        r.committedAt < r.computedAt
      )
        throw Error("REVISION_TIME");
    }
    // Continuity is explicitly fenced by startup after validating the committed payload.
  }
  private bounds(c: Checkpoint): void {
    if (
      Object.keys(c.streams).length > this.options.maxStreams ||
      new Set(Object.values(c.streams).map((s) => s.instrumentId)).size >
        this.options.maxInstruments ||
      c.windows.length > this.options.maxWindows ||
      c.revisions.length > this.options.maxRevisions ||
      c.windows.some((w) => w.contributions.length > this.options.maxContributions)
    )
      throw Error("STATE_LIMIT");
    if (Buffer.byteLength(JSON.stringify(c)) > this.options.maxCheckpointBytes)
      throw Error("CHECKPOINT_BOUNDS");
  }
  private transact<T>(action: (draft: Checkpoint) => T, closing = false): Result<T> {
    if (!closing) {
      try {
        this.writable();
      } catch {
        return failure(this.input.clock, "LIFECYCLE_REJECTED");
      }
    }
    const draft = structuredClone(this.checkpoint);
    let value: T;
    try {
      value = action(draft);
      this.bounds(draft);
    } catch (e) {
      const code =
        e instanceof z.ZodError
          ? "INPUT_REJECTED"
          : e instanceof Error && /^[A-Z_]{1,64}$/u.test(e.message)
            ? e.message
            : "INPUT_REJECTED";
      this.bump("rejected");
      this.error(code);
      if (code.includes("LIMIT") || code.includes("BOUNDS")) this.bump("limits");
      return failure(this.input.clock, code);
    }
    if (hash({ ...draft, fingerprint: "" }) === hash({ ...this.checkpoint, fingerprint: "" }))
      return ok(value);
    draft.generation++;
    const { fingerprint: _fingerprint, ...body } = draft;
    draft.fingerprint = hash(body);
    const operationId = hash({ generation: draft.generation, fingerprint: draft.fingerprint });
    const existing = new Set(this.checkpoint.revisions.map((r) => r.revisionId)),
      newIds = draft.revisions.filter((r) => !existing.has(r.revisionId)).map((r) => r.revisionId);
    this.busy = true;
    try {
      let committed: WriteResult<{ committedAt: UtcTimestamp }>;
      try {
        committed = this.input.repository.commit(operationId, draft, newIds);
      } catch {
        committed = failure(this.input.clock, "COMMIT_EXCEPTION");
      }
      if (!committed.ok) {
        if (!("commitment" in committed && committed.commitment === "CONFIRMED_NOT_COMMITTED"))
          this.retain(operationId, "UNKNOWN_COMMITMENT", committed.error.code);
        this.bump("checkpointFailures");
        return committed;
      }
      if (!closing && this.state !== "READY") {
        this.retain(operationId, "COMMITTED", "LIFECYCLE_LOST");
        return failure(this.input.clock, "RECOVERY_REQUIRED");
      }
      let published: Result<{ publishedAt: UtcTimestamp }>;
      try {
        published = this.input.repository.publish(operationId);
      } catch {
        published = failure(this.input.clock, "PUBLICATION_EXCEPTION");
      }
      if (!published.ok) {
        this.retain(operationId, "COMMITTED", published.error.code);
        this.bump("checkpointFailures");
        return published;
      }
      if (
        newIds.some(
          (id) =>
            draft.revisions.find((r) => r.revisionId === id)!.computedAt >
            committed.value.committedAt,
        ) ||
        published.value.publishedAt < committed.value.committedAt ||
        Date.parse(published.value.publishedAt) > Date.parse(this.input.clock.now())
      ) {
        this.retain(operationId, "COMMITTED", "PUBLICATION_TIME");
        return failure(this.input.clock, "RECOVERY_REQUIRED");
      }
      const stored: Stored = {
        operationId,
        checkpoint: draft,
        newRevisionIds: newIds,
        committedAt: committed.value.committedAt,
        publishedAt: published.value.publishedAt,
        fingerprint: "",
      };
      this.checkpoint = materialize(stored);
      if (!closing && this.state !== "READY") {
        this.retain(operationId, "COMMITTED", "LIFECYCLE_LOST");
        return failure(this.input.clock, "RECOVERY_REQUIRED");
      }
      for (const id of newIds) {
        if (this.delivery.length >= this.options.consumerCapacity) {
          this.error("CONSUMER_OVERFLOW");
          this.bump("limits");
          break;
        }
        this.delivery.push(id);
      }
      if (this.controls.length >= this.options.maxEvidence) this.controls.shift();
      this.controls.push(
        freeze({ kind: "CHECKPOINT_PUBLISHED", timestamp: this.input.clock.now(), operationId }),
      );
      return ok(value);
    } finally {
      this.busy = false;
    }
  }
  private retain(
    operationId: string,
    commitment: "UNKNOWN_COMMITMENT" | "COMMITTED",
    code: string,
  ) {
    this.recovery = freeze({ operationId, commitment, code });
    this.state = "FAILED";
    this.error(code);
  }
  public stop(): Result<void> {
    if (this.recovery) return failure(this.input.clock, "RECOVERY_REQUIRED");
    if (this.busy) {
      this.state = "STOPPING";
      return failure(this.input.clock, "SHUTDOWN_IN_PROGRESS");
    }
    if (this.state === "STOPPED") return ok(undefined);
    if (this.state !== "READY") return failure(this.input.clock, "LIFECYCLE_REJECTED");
    this.state = "STOPPING";
    const r = this.transact((c) => {
      for (const m of Object.values(c.watermarks)) m.status = "FENCED";
    }, true);
    this.state = r.ok ? "STOPPED" : "FAILED";
    return r;
  }
  public registerStream(stream: Stream): Result<string> {
    return this.transact((c) => {
      schemas.sourceId.parse(stream.sourceId);
      schemas.instrumentId.parse(stream.instrumentId);
      const s = safeClone(stream) as Stream;
      if (
        !["LAST_TRADE", "BID", "ASK", "MIDPOINT"].includes(s.basis) ||
        !["TRADE_VOLUME", "TICK_VOLUME", "QUOTE_COUNT", "NOT_AVAILABLE"].includes(s.volumeType) ||
        !idSchema.safeParse(s.channel).success ||
        !idSchema.safeParse(s.volumeUnit).success ||
        !idSchema.safeParse(s.priceCurrency).success ||
        !/^(sha256:)?[a-f0-9]{64}$/u.test(s.sourceFingerprint)
      )
        throw Error("STREAM_INVALID");
      priceSchema.parse({
        value: "0",
        instrumentId: s.instrumentId,
        quoteCurrency: s.priceCurrency,
      });
      if (s.volumeType !== "NOT_AVAILABLE")
        quantitySchema.parse({ value: "0", unit: s.volumeUnit });
      if (["QUOTE_COUNT", "TICK_VOLUME"].includes(s.volumeType) && s.volumeUnit !== "TICKS")
        throw Error("VOLUME_UNIT");
      const id = hash(s);
      c.streams[id] = s;
      if (!c.watermarks[id])
        c.watermarks[id] = {
          sessionId: "unknown",
          through: null,
          observedAt: null,
          status: "UNKNOWN",
          coverage: "UNKNOWN",
          evidenceId: null,
        };
      return id;
    });
  }
  private barId(streamId: string, timeframe: string, window: WindowState["window"]): string {
    return hash({
      streamId,
      timeframe,
      window,
      configuration: this.input.configurationFingerprint,
      graph: this.policy,
    });
  }
  private getWindow(
    c: Checkpoint,
    streamId: string,
    timeframe: string,
    eventAt: UtcTimestamp,
  ): WindowState {
    const window = this.calendar.resolve(this.input.registry.get(timeframe), eventAt),
      barId = this.barId(streamId, timeframe, window);
    let state = c.windows.find((w) => w.barId === barId);
    if (!state) {
      state = { barId, streamId, timeframe, window, contributions: [] };
      c.windows.push(state);
    }
    return state;
  }
  private contribution(stream: Stream, raw: Input): Contribution {
    const safe = evidenceSchema.parse(safeClone(raw)),
      o = marketObservationSchema.parse(safe.observation),
      now = this.input.clock.now();
    if (
      o.source.sourceId !== stream.sourceId ||
      o.instrumentId !== stream.instrumentId ||
      o.provenance.source.sourceId !== stream.sourceId ||
      safe.sourceFingerprint !== stream.sourceFingerprint ||
      safe.channel !== stream.channel
    )
      throw Error("SOURCE_MISMATCH");
    if (o.provenance.source.sourceType !== o.source.sourceType) throw Error("SOURCE_MISMATCH");
    if (
      Date.parse(o.eventTime) > Date.parse(now) ||
      Date.parse(o.receivedAt) > Date.parse(now) ||
      (safe.sourcePublishedAt && safe.sourcePublishedAt > now)
    )
      throw Error("FUTURE_INPUT");
    let open: string,
      high: string,
      low: string,
      close: string,
      volume: string | undefined,
      volumeUnit = stream.volumeUnit;
    if (o.observationKind === "BAR") {
      if (stream.basis !== o.metadata["aggregation.pricebasis"]) throw Error("PRICE_BASIS_MISSING");
      if (o.intervalEnd > now) throw Error("FUTURE_BAR");
      open = o.open.value;
      high = o.high.value;
      low = o.low.value;
      close = o.close.value;
      const v = o.volumes.find((v) => v.volumeType === stream.volumeType);
      if (v?.quantity) {
        volume = v.quantity.value;
        volumeUnit = v.quantity.unit;
      }
      if (o.completeness !== "FINAL") throw Error("INPUT_BAR_PROVISIONAL");
      for (const price of [o.open, o.high, o.low, o.close])
        if (
          (price.instrumentId && price.instrumentId !== stream.instrumentId) ||
          (price.quoteCurrency && price.quoteCurrency !== stream.priceCurrency)
        )
          throw Error("PRICE_UNIT_MISMATCH");
      const tf =
        typeof o.timeframe === "string"
          ? this.input.registry.get(o.timeframe)
          : this.input.registry.get(o.timeframe.code);
      const w = this.calendar.resolve(tf, o.intervalStart);
      if (w.start !== o.intervalStart || w.end !== o.intervalEnd)
        throw Error("SOURCE_WINDOW_MISMATCH");
    } else {
      const trade =
        o.observationKind === "TRADE" ? o : o.observationKind === "TICK" ? o.trade : undefined;
      const quote =
        o.observationKind === "QUOTE" ? o : o.observationKind === "TICK" ? o.quote : undefined;
      let price:
        | { value: string; quoteCurrency?: string | undefined; instrumentId?: string | undefined }
        | undefined;
      if (stream.basis === "LAST_TRADE") price = trade?.price;
      else if (stream.basis === "BID") price = quote?.bid;
      else if (stream.basis === "ASK") price = quote?.ask;
      else if (quote) {
        const derived = deriveMidPrice({ ...quote, instrumentId: o.instrumentId });
        if (derived.ok) price = { ...derived.value, quoteCurrency: quote.bid?.quoteCurrency };
      }
      if (
        !price ||
        (price.quoteCurrency && price.quoteCurrency !== stream.priceCurrency) ||
        (price.instrumentId && price.instrumentId !== stream.instrumentId)
      )
        throw Error("PRICE_BASIS_MISMATCH");
      open = high = low = close = price.value;
      if (stream.volumeType === "QUOTE_COUNT") {
        if (!quote) throw Error("VOLUME_TYPE");
        volume = "1";
        volumeUnit = "TICKS";
      } else if (stream.volumeType === "TICK_VOLUME") {
        if (o.observationKind !== "TICK") throw Error("VOLUME_TYPE");
        volume = "1";
        volumeUnit = "TICKS";
      } else if (stream.volumeType === "TRADE_VOLUME") {
        if (!trade?.quantity) throw Error("VOLUME_MISSING");
        volume = trade.quantity.value;
        volumeUnit = trade.quantity.unit;
      }
    }
    if (volumeUnit !== stream.volumeUnit) throw Error("VOLUME_UNIT");
    if (volume !== undefined && new D(decimal(volume)).lt(0)) throw Error("VOLUME_NEGATIVE");
    const quality = [
      ...o.qualityAnnotations,
      ...safe.warnings,
      ...(safe.quality?.findings.map(
        (f) =>
          `${safe.quality!.reportId}:${safe.quality!.reportFingerprint}:${f.findingId}:${f.category}:${f.severity}`,
      ) ?? []),
    ];
    if (!safe.quality) quality.push("QUALITY_UNASSESSED");
    if (
      safe.availability === "UNKNOWN" ||
      (safe.origin === "HISTORICAL" && !safe.sourcePublishedAt)
    )
      quality.push("UNVERIFIED_AVAILABILITY");
    return freeze({
      key: safe.identity,
      identity: safe.identity,
      observationId: o.observationId,
      source: o.source,
      provenance: o.provenance,
      ...(o.observationKind === "BAR" && o.revisionOf ? { revisionOf: o.revisionOf } : {}),
      eventAt: o.observationKind === "BAR" ? o.intervalStart : o.eventTime,
      receivedAt: o.receivedAt,
      processedAt: now,
      availableAt: now,
      availability:
        safe.origin === "HISTORICAL" && !safe.sourcePublishedAt ? "UNKNOWN" : safe.availability,
      ...(safe.sourcePublishedAt ? { sourcePublishedAt: safe.sourcePublishedAt } : {}),
      ...(safe.orderingSequence ? { sequence: safe.orderingSequence } : {}),
      open: decimal(open),
      high: decimal(high),
      low: decimal(low),
      close: decimal(close),
      ...(volume !== undefined ? { volume: decimal(volume) } : {}),
      volumeUnit,
      volumeType: stream.volumeType,
      sourceFingerprint: safe.sourceFingerprint,
      artifactId: safe.artifactId,
      quality,
      suppressed: safe.quality?.suppressed ?? 0,
      final: o.observationKind === "BAR",
      complete:
        o.observationKind === "BAR" && o.metadata["aggregation.coverage"] === "COMPLETE_COVERAGE",
      start: o.observationKind === "BAR" ? o.intervalStart : o.eventTime,
      end: o.observationKind === "BAR" ? o.intervalEnd : o.eventTime,
      contentFingerprint: hash(o),
    });
  }
  public ingest(streamId: string, input: Input): Result<void> {
    this.bump("received");
    const result = this.transact((c) => {
      const stream = c.streams[streamId];
      if (!stream) throw Error("STREAM_MISSING");
      const x = this.contribution(stream, input),
        wm = c.watermarks[streamId]!;
      if (
        c.windows.some(
          (w) =>
            w.streamId === streamId &&
            w.contributions.some(
              (v) =>
                (v.key === x.key || v.observationId === x.observationId) &&
                v.contentFingerprint !== x.contentFingerprint,
            ),
        )
      )
        throw Error("IDENTITY_CONFLICT");
      if (
        wm.sessionId !== input.sessionId ||
        input.continuity !== "CONTINUOUS" ||
        input.warnings.some((w) =>
          ["LATE", "STALE", "SEQUENCE_GAP", "OUT_OF_ORDER", "DROPPED_INPUT"].includes(w),
        ) ||
        (x.sequence &&
          wm.lastSequence &&
          BigInt(x.sequence) !== BigInt(wm.lastSequence) + 1n &&
          !c.windows.some(
            (w) =>
              w.streamId === streamId &&
              w.contributions.some((v) => v.observationId === x.observationId),
          ))
      ) {
        wm.status = "FENCED";
        wm.coverage = "UNKNOWN";
        this.bump("gaps");
      }
      if (
        x.sequence &&
        (wm.sessionId !== input.sessionId ||
          !wm.lastSequence ||
          BigInt(x.sequence) > BigInt(wm.lastSequence))
      )
        wm.lastSequence = x.sequence;
      wm.sessionId = input.sessionId;
      wm.observedAt = this.input.clock.now();
      for (const timeframe of this.input.directTimeframes) {
        const w = this.getWindow(c, streamId, timeframe, x.eventAt);
        const duplicate = w.contributions.find(
          (v) => v.key === x.key || v.observationId === x.observationId,
        );
        if (duplicate) {
          if (duplicate.contentFingerprint !== x.contentFingerprint)
            throw Error("IDENTITY_CONFLICT");
          this.bump("duplicates");
          continue;
        }
        if (w.contributions.some((v) => v.final !== x.final)) throw Error("CONSTRUCTION_INPUT_MIX");
        if (x.revisionOf) {
          const previous = w.contributions.findIndex((v) => v.observationId === x.revisionOf);
          if (previous < 0) throw Error("CORRECTION_ORIGINAL_MISSING");
          const prior = w.contributions[previous]!;
          if (prior.start !== x.start || prior.end !== x.end) throw Error("CORRECTION_INTERVAL");
          w.contributions.splice(previous, 1);
        }
        if (x.final) {
          if (
            x.start < w.window.start ||
            x.end > w.window.end ||
            w.contributions.some(
              (v) =>
                Date.parse(v.start) < Date.parse(x.end) && Date.parse(x.start) < Date.parse(v.end),
            )
          )
            throw Error("INPUT_OVERLAP");
        }
        const latest = this.latest(c, w.barId);
        if (
          latest?.final &&
          Date.parse(this.input.clock.now()) - Date.parse(w.window.end) >
            this.options.correctionHorizonMs
        )
          throw Error("CORRECTION_HORIZON");
        w.contributions.push(x);
        if (w.contributions.length > this.options.maxContributions)
          throw Error("CONTRIBUTION_LIMIT");
        if (latest?.final) {
          this.revise(c, w, wm.status === "CONTINUOUS", "CORRECTION");
          this.propagate(c, w.barId, new Set());
          this.bump("corrections");
        }
      }
    });
    if (result.ok) this.bump("accepted");
    if (!result.ok && this.state === "READY" && !this.recovery && this.checkpoint.streams[streamId])
      this.fence(streamId, "REJECTED_INPUT");
    return result;
  }
  public fence(streamId: string, reason: string): Result<void> {
    return this.transact((c) => {
      const w = c.watermarks[streamId];
      if (!w) throw Error("STREAM_MISSING");
      w.status = "FENCED";
      w.coverage = "UNKNOWN";
      this.error(reason);
      this.bump("gaps");
    });
  }
  public watermark(
    streamId: string,
    evidence: Readonly<{
      sessionId: string;
      through: UtcTimestamp;
      observedAt: UtcTimestamp;
      coverage: "COMPLETE_COVERAGE" | "INCOMPLETE" | "UNKNOWN";
      kind: "CONTINUITY" | "END_OF_STREAM";
      evidenceId: string;
      reconciled: boolean;
    }>,
  ): Result<void> {
    return this.transact((c) => {
      const m = c.watermarks[streamId];
      if (!m) throw Error("STREAM_MISSING");
      const t = Date.parse(instant(evidence.through)),
        now = Date.parse(this.input.clock.now());
      instant(evidence.observedAt);
      idSchema.parse(evidence.evidenceId);
      idSchema.parse(evidence.sessionId);
      if (
        t > now ||
        t > Date.parse(evidence.observedAt) ||
        Date.parse(evidence.observedAt) > now ||
        !["CONTINUITY", "END_OF_STREAM"].includes(evidence.kind) ||
        !["COMPLETE_COVERAGE", "INCOMPLETE", "UNKNOWN"].includes(evidence.coverage)
      )
        throw Error("WATERMARK_EVIDENCE");
      if ((m.status === "FENCED" || m.sessionId !== evidence.sessionId) && !evidence.reconciled)
        throw Error("CONTINUITY_REQUIRED");
      const through = utc(
        t - (evidence.kind === "END_OF_STREAM" ? 0 : this.options.allowedLatenessMs),
      );
      if (m.through && through < m.through) throw Error("WATERMARK_REGRESSION");
      if (evidence.reconciled) delete m.lastSequence;
      m.sessionId = evidence.sessionId;
      m.status = "CONTINUOUS";
      m.through = through;
      m.observedAt = evidence.observedAt;
      m.coverage = evidence.coverage;
      m.evidenceId = evidence.evidenceId;
    });
  }
  private latest(c: Checkpoint, barId: string): Revision | undefined {
    return c.revisions.filter((r) => r.barId === barId).at(-1);
  }
  private content(
    r: Pick<
      Revision,
      | "streamId"
      | "timeframe"
      | "window"
      | "configurationFingerprint"
      | "constructionFingerprint"
      | "open"
      | "high"
      | "low"
      | "close"
      | "volume"
      | "count"
      | "coverage"
      | "ordering"
      | "final"
      | "quality"
      | "suppressedEvidence"
      | "availability"
    >,
  ) {
    return {
      streamId: r.streamId,
      timeframe: r.timeframe,
      window: r.window,
      configurationFingerprint: r.configurationFingerprint,
      constructionFingerprint: r.constructionFingerprint,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      ...(r.volume !== undefined ? { volume: r.volume } : {}),
      count: r.count,
      coverage: r.coverage,
      ordering: r.ordering,
      final: r.final,
      quality: r.quality,
      suppressedEvidence: r.suppressedEvidence,
      availability: r.availability,
    };
  }
  private revise(
    c: Checkpoint,
    w: WindowState,
    final: boolean,
    reason: Revision["reason"],
  ): Revision {
    if (w.contributions.length === 0) throw Error("EMPTY_WINDOW");
    const stream = c.streams[w.streamId]!,
      wm = c.watermarks[w.streamId]!;
    const latest = this.latest(c, w.barId),
      now = this.input.clock.now();
    if (
      final &&
      (!wm.through || wm.through < w.window.end || wm.status !== "CONTINUOUS" || now < w.window.end)
    )
      throw Error("FINALITY_EVIDENCE");
    const a = [...w.contributions].sort(
      (a, b) =>
        Date.parse(a.eventAt) - Date.parse(b.eventAt) ||
        (a.sequence && b.sequence
          ? BigInt(a.sequence) < BigInt(b.sequence)
            ? -1
            : BigInt(a.sequence) > BigInt(b.sequence)
              ? 1
              : 0
          : a.identity.localeCompare(b.identity, "en")),
    );
    let ordering: "VERIFIED" | "UNCERTAIN" = "VERIFIED";
    for (let i = 1; i < a.length; i++)
      if (
        a[i]!.eventAt === a[i - 1]!.eventAt &&
        (!a[i]!.sequence || !a[i - 1]!.sequence || a[i]!.sequence === a[i - 1]!.sequence)
      )
        ordering = "UNCERTAIN";
    const hierarchical = a.some((x) => x.revisionId !== undefined),
      bars = a.every((x) => x.start !== x.end);
    const segments = this.calendar.segments(w.window);
    let exact =
      bars &&
      segments.length > 0 &&
      a.every((x) => x.complete) &&
      segments.every((segment) => {
        const parts = a.filter((x) => x.start >= segment.start && x.end <= segment.end);
        return (
          parts.length > 0 &&
          parts[0]!.start === segment.start &&
          parts.at(-1)!.end === segment.end &&
          parts.every((x, i) => i === 0 || parts[i - 1]!.end === x.start)
        );
      }) &&
      a.every((x) => segments.some((s) => x.start >= s.start && x.end <= s.end));
    if (!bars) exact = wm.coverage === "COMPLETE_COVERAGE";
    if (hierarchical && final && a.some((x) => !x.final)) throw Error("CONSTITUENT_PROVISIONAL");
    const coverage: Revision["coverage"] =
      exact && wm.coverage === "COMPLETE_COVERAGE"
        ? "COMPLETE_COVERAGE"
        : wm.coverage === "UNKNOWN"
          ? "UNKNOWN"
          : "INCOMPLETE";
    const qualities = [...new Set(a.flatMap((x) => x.quality))].sort();
    if (ordering === "UNCERTAIN") qualities.push("ORDERING_UNCERTAIN");
    if (coverage !== "COMPLETE_COVERAGE") qualities.push("COVERAGE_" + coverage);
    const volume =
      stream.volumeType === "NOT_AVAILABLE"
        ? undefined
        : a
            .reduce((sum, x) => {
              if (x.volume === undefined) throw Error("VOLUME_MISSING");
              return sum.plus(x.volume);
            }, new D(0))
            .toFixed();
    if (volume !== undefined) decimal(volume);
    const core = {
      streamId: w.streamId,
      stream,
      timeframe: w.timeframe,
      timeframeDefinition: this.input.registry.get(w.timeframe),
      window: w.window,
      configurationFingerprint: this.input.configurationFingerprint,
      constructionFingerprint: this.policy,
      open: a[0]!.open,
      high: a.reduce((p, x) => (new D(x.high).gt(p) ? x.high : p), a[0]!.high),
      low: a.reduce((p, x) => (new D(x.low).lt(p) ? x.low : p), a[0]!.low),
      close: a.at(-1)!.close,
      ...(volume !== undefined ? { volume } : {}),
      count: a.length,
      coverage,
      ordering,
      final,
      quality: qualities,
      suppressedEvidence: a.reduce((s, x) => s + x.suppressed, 0),
      availability: a.every((x) => x.availability === "VERIFIED")
        ? ("VERIFIED" as const)
        : ("UNKNOWN" as const),
    };
    const contentFingerprint = hash(this.content(core)),
      lineageFingerprint = hash(lineage(a));
    if (
      latest?.contentFingerprint === contentFingerprint &&
      latest.lineageFingerprint === lineageFingerprint
    )
      return latest;
    const generation = (latest?.generation ?? 0) + 1,
      revisionId = hash({ barId: w.barId, generation, contentFingerprint, lineageFingerprint });
    const state: Revision["state"] = final
      ? reason === "CORRECTION"
        ? "CORRECTED"
        : "FINALIZED"
      : reason === "CORRECTION" && latest?.final
        ? "INVALIDATED"
        : now >= w.window.end
          ? "WINDOW_ELAPSED"
          : "FORMING";
    const changed = latest
      ? (["open", "high", "low", "close", "volume", "count", "coverage"] as const).filter(
          (k) => latest[k] !== core[k],
        )
      : [];
    const revision: Revision = freeze({
      ...core,
      barId: w.barId,
      revisionId,
      generation,
      ...(latest ? { parentRevisionId: latest.revisionId } : {}),
      reason,
      correctedFields: changed,
      state,
      eventAt: a.at(-1)!.eventAt,
      receivedAt: a
        .map((x) => x.receivedAt)
        .sort()
        .at(-1)!,
      processedAt: now,
      computedAt: now,
      committedAt: now,
      publishedAt: now,
      availableAt: now,
      ...(final ? { finalityAt: now } : {}),
      constituents: a,
      contentFingerprint,
      lineageFingerprint,
      researchQualified: false,
      tradingAuthorized: false,
    });
    c.revisions.push(revision);
    return revision;
  }
  public publishWindow(
    streamId: string,
    timeframe: string,
    event: UtcTimestamp,
    final = false,
  ): Result<string> {
    return this.transact((c) => {
      if (!c.streams[streamId]) throw Error("STREAM_MISSING");
      const w = this.getWindow(c, streamId, timeframe, event),
        r = this.revise(
          c,
          w,
          final,
          final ? "FINALIZATION" : this.latest(c, w.barId) ? "UPDATE" : "INITIAL",
        );
      if (final) this.bump("finalized");
      this.propagate(c, w.barId, new Set());
      return r.revisionId;
    });
  }
  private propagate(c: Checkpoint, barId: string, visited: Set<string>): void {
    if (visited.has(barId)) throw Error("CORRECTION_CYCLE");
    visited.add(barId);
    const r = this.latest(c, barId)!;
    for (const edge of this.input.edges ?? []) {
      if (edge.child !== r.timeframe) continue;
      const parent = this.getWindow(c, r.streamId, edge.parent, r.window.start);
      if (r.window.start < parent.window.start || r.window.end > parent.window.end)
        throw Error("CONSTITUENT_BOUNDARY");
      const x: Contribution = freeze({
        key: r.barId,
        identity: r.revisionId,
        eventAt: r.window.start,
        receivedAt: r.receivedAt,
        processedAt: r.processedAt,
        availableAt: r.availableAt,
        availability: r.availability,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        ...(r.volume !== undefined ? { volume: r.volume } : {}),
        volumeUnit: r.stream.volumeUnit,
        volumeType: r.stream.volumeType,
        sourceFingerprint: r.stream.sourceFingerprint,
        artifactId: r.barId,
        ...(r.constituents[0]?.source ? { source: r.constituents[0].source } : {}),
        quality: r.quality,
        suppressed: r.suppressedEvidence,
        final: r.final,
        complete: r.coverage === "COMPLETE_COVERAGE",
        start: r.window.start,
        end: r.window.end,
        revisionId: r.revisionId,
        barId: r.barId,
        contentFingerprint: r.contentFingerprint,
      });
      const i = parent.contributions.findIndex((v) => v.key === r.barId);
      if (i < 0) parent.contributions.push(x);
      else parent.contributions[i] = x;
      const old = this.latest(c, parent.barId);
      if (old?.final) {
        this.revise(c, parent, c.watermarks[r.streamId]!.status === "CONTINUOUS", "CORRECTION");
        this.propagate(c, parent.barId, new Set(visited));
      }
    }
  }
  public recompute(streamId: string, timeframe: string, event: UtcTimestamp): Result<string> {
    return this.transact((c) => {
      if (!c.streams[streamId]) throw Error("STREAM_MISSING");
      const w = this.getWindow(c, streamId, timeframe, event),
        latest = this.latest(c, w.barId);
      if (!latest) throw Error("REVISION_MISSING");
      if (
        Date.parse(this.input.clock.now()) - Date.parse(w.window.end) >
        this.options.correctionHorizonMs
      )
        throw Error("CORRECTION_HORIZON");
      const r = this.revise(c, w, latest.final, "CORRECTION");
      this.propagate(c, w.barId, new Set());
      return r.revisionId;
    });
  }
  public snapshot(request: SnapshotRequest): Result<Snapshot> {
    this.bump("snapshots");
    try {
      instant(request.asOf);
      instant(request.cutoff);
      if (request.cutoff > request.asOf || request.cutoff > this.input.clock.now())
        throw Error("FUTURE_CUTOFF");
      if (
        request.timeframes.length === 0 ||
        request.timeframes.length > this.options.maxSnapshotTimeframes ||
        new Set(request.timeframes).size !== request.timeframes.length
      )
        throw Error("QUERY_LIMIT");
      if (request.includeProvisional && !this.options.allowProvisionalSnapshots)
        throw Error("PROVISIONAL_DISABLED");
      if (this.checkpoint.revisions.length > this.options.maxQueryScan)
        throw Error("QUERY_SCAN_LIMIT");
      if (
        request.configurationFingerprint &&
        request.configurationFingerprint !== this.input.configurationFingerprint
      )
        throw Error("CONFIGURATION_MISMATCH");
      if (request.calendarFingerprint && request.calendarFingerprint !== this.calendar.fingerprint)
        throw Error("CALENDAR_MISMATCH");
      if (!this.checkpoint.streams[request.streamId]) throw Error("SOURCE_MISMATCH");
      const maxAge = request.maxAgeMs ?? this.options.maxSnapshotAgeMs;
      if (!Number.isSafeInteger(maxAge) || maxAge < 0 || maxAge > this.options.maxSnapshotAgeMs)
        throw Error("QUERY_AGE");
      const evidenceClass = request.evidenceClass ?? "VERIFIED_POINT_IN_TIME",
        selected: Record<string, Revision> = {},
        missing: Record<string, string> = {},
        staleness: Record<string, number> = {};
      if (!["VERIFIED_POINT_IN_TIME", "EVENT_TIME_RECONSTRUCTION"].includes(evidenceClass))
        throw Error("EVIDENCE_CLASS");
      const byId = new Map(this.checkpoint.revisions.map((r) => [r.revisionId, r]));
      const knownLatest = new Map<string, Revision>();
      const invalidated = new Map<string, number>();
      for (const r of this.checkpoint.revisions) {
        if (r.availableAt > request.cutoff) continue;
        const old = knownLatest.get(r.barId);
        if (!old || old.generation < r.generation) knownLatest.set(r.barId, r);
        if (r.state === "INVALIDATED")
          invalidated.set(r.barId, Math.max(invalidated.get(r.barId) ?? 0, r.generation));
      }
      for (const tf of request.timeframes) {
        this.input.registry.get(tf);
        const scope = this.checkpoint.revisions.filter(
          (r) =>
            r.streamId === request.streamId &&
            r.timeframe === tf &&
            r.availableAt <= request.cutoff &&
            r.committedAt <= request.cutoff &&
            r.publishedAt <= request.cutoff,
        );
        const eligible = scope.filter(
          (r) =>
            r.generation >= (invalidated.get(r.barId) ?? 0) &&
            r.availableAt <= request.cutoff &&
            r.committedAt <= request.cutoff &&
            r.publishedAt <= request.cutoff &&
            r.window.start <= request.asOf &&
            (!r.final || (r.finalityAt! <= request.cutoff && r.window.end <= request.asOf)) &&
            (request.includeProvisional || r.final) &&
            (request.includeIncomplete || r.coverage === "COMPLETE_COVERAGE") &&
            (evidenceClass === "EVENT_TIME_RECONSTRUCTION" || r.availability === "VERIFIED") &&
            (!request.requireQualityEvidence || !r.quality.includes("QUALITY_UNASSESSED")) &&
            (!request.correctionPolicy ||
              request.correctionPolicy !== "INITIAL_ONLY" ||
              r.reason !== "CORRECTION"),
        );
        eligible.sort(
          (a, b) =>
            b.window.end.localeCompare(a.window.end) ||
            b.generation - a.generation ||
            a.revisionId.localeCompare(b.revisionId),
        );
        const r = eligible[0];
        if (!r) {
          missing[tf] = scope.some((r) => r.availability === "UNKNOWN")
            ? "UNVERIFIED_AVAILABILITY"
            : scope.some((r) => r.coverage !== "COMPLETE_COVERAGE")
              ? "INCOMPLETE_COVERAGE"
              : "NO_ELIGIBLE_REVISION";
          continue;
        }
        const age = Date.parse(request.asOf) - Date.parse(r.window.end);
        if (age > maxAge) {
          missing[tf] = "STALE_DATA";
          continue;
        }
        selected[tf] = r;
        staleness[tf] = Math.max(0, age);
      }
      for (const [tf, r] of Object.entries(selected))
        for (const x of r.constituents) {
          if (!x.revisionId) continue;
          const child = byId.get(x.revisionId);
          if (!child || child.availableAt > request.cutoff) {
            delete selected[tf];
            delete staleness[tf];
            missing[tf] = "INCOMPLETE_LINEAGE";
            break;
          }
          const newer = knownLatest.get(child.barId);
          if (newer && newer.generation > child.generation) {
            delete selected[tf];
            delete staleness[tf];
            missing[tf] = "REVISION_CONFLICT";
            break;
          }
        }
      const body = {
        streamId: request.streamId,
        sourceFingerprint: this.checkpoint.streams[request.streamId]!.sourceFingerprint,
        calendarFingerprint: this.calendar.fingerprint,
        asOf: request.asOf,
        cutoff: request.cutoff,
        evidenceClass,
        selected,
        missing,
        staleness,
        consistency: Object.keys(missing).length
          ? ("INCOMPLETE" as const)
          : ("CONSISTENT" as const),
        configurationFingerprint: this.input.configurationFingerprint,
        policyFingerprint: this.policy,
      };
      const fingerprint = hash(body);
      return ok(freeze({ ...body, snapshotId: fingerprint, contentFingerprint: fingerprint }));
    } catch (e) {
      this.bump("snapshotFailures");
      return failure(
        this.input.clock,
        e instanceof Error && /^[A-Z_]{1,64}$/u.test(e.message) ? e.message : "QUERY_REJECTED",
      );
    }
  }
  public history(barId: string, offset = 0, limit = 20): Result<readonly Revision[]> {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > this.options.maxQueryResults ||
      this.checkpoint.revisions.length > this.options.maxQueryScan
    )
      return failure(this.input.clock, "QUERY_LIMIT");
    return ok(
      freeze(
        this.checkpoint.revisions.filter((r) => r.barId === barId).slice(offset, offset + limit),
      ),
    );
  }
  public readRevision(id: string): Revision | undefined {
    return this.checkpoint.revisions.find((r) => r.revisionId === id);
  }
  public readDelivery(): string | undefined {
    return this.delivery.shift();
  }
  public readControl() {
    return this.controls.shift();
  }
  public diagnostics() {
    return freeze({
      state: this.state,
      ready: this.state === "READY" && !this.recovery && this.options.enabled,
      recovery: this.recovery ?? null,
      counters: { ...this.counters },
      errors: [...this.errors],
      streams: structuredClone(this.checkpoint.streams),
      watermarks: structuredClone(this.checkpoint.watermarks),
      windowCount: this.checkpoint.windows.length,
      revisionCount: this.checkpoint.revisions.length,
      deliveryDepth: this.delivery.length,
      configurationFingerprint: this.input.configurationFingerprint,
      policyFingerprint: this.policy,
      calendarFingerprint: this.calendar.fingerprint,
      researchQualified: false,
      tradingAuthorized: false,
    });
  }
}
