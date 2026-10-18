import { types } from "node:util";
import { marketObservationSchema } from "@ate/domain";
import type { Clock } from "@ate/time";

import {
  persistenceId,
  stateDomain,
  stateOwner,
  type StateAuthorityRegistry,
} from "@ate/persistence";
import type { EffectiveConfiguration } from "@ate/configuration";
import type { CalendarBoundaryResolver } from "@ate/multitimeframe";
import {
  hash as marketFingerprint,
  TimeframeRegistry,
  safeClone as cloneOwnerEvidence,
  type Snapshot,
  type Revision,
  type AggregationEngine,
} from "@ate/multitimeframe";
import { DeterministicReplaySequencer } from "@ate/market-replay";
import {
  universeSchema,
  type MOSECoreRuntime,
  type Observation,
  type Universe,
  type MOSEPorts,
} from "@ate/mose-core";
import { checkedCheckpoint } from "./repository.js";
import { readScannerPolicy } from "./policy.js";
import { boundedClone, bytes, fingerprint, frozen } from "./primitives.js";
import { validatePlan, ScanDependencyGraph, workKey, equivalentKey, ordered } from "./planner.js";
import {
  triggerSchema,
  timestamp,
  identifier,
  success,
  failure,
  type ScannerState,
  type ScannerCheckpoint,
  type ScannerPolicy,
  type ScanSubscription,
  type ScanTrigger,
  type ScanWork,
  type ScannerResult,
  type ScanCheckpointRepository,
} from "./contracts.js";
export interface ScannerPorts {
  clock: Clock;
  configuration: () => EffectiveConfiguration;
  authority: StateAuthorityRegistry;
  mose: Pick<
    MOSECoreRuntime,
    "getUniverse" | "getSessionSummary" | "health" | "query" | "dispatch"
  >;
  aggregation: Pick<AggregationEngine, "snapshot" | "readRevision">;
  calendar: CalendarBoundaryResolver;
  repository: ScanCheckpointRepository;
  replayEvidence: MOSEPorts["replayEvidence"];
}
const empty = (): ScannerState => ({
  phase: "READY",
  plan: null,
  work: [],
  requests: [],
  versions: {},
  lastInstrument: null,
  lastWork: {},
  deadlines: {},
  avoided: 0,
});
const pending = (w: ScanWork) => ["DUE", "DEFERRED", "UNKNOWN"].includes(w.status);
const err = (e: unknown) =>
  e instanceof Error && /^[A-Z0-9_]+$/u.test(e.message) ? e.message : "OWNER_FAILURE";
export class MultiSpeedScannerRuntime {
  private state = empty();
  private history: ScannerCheckpoint[] = [];
  private busy = false;
  private initialized = false;
  private stopped = false;
  private stopping = false;
  private uncertainty: string | null = null;
  private policy!: ScannerPolicy;
  private config = "";
  private recovered = false;
  private readonly authenticatedCacheKeys = new Set<string>();
  private clockIdentity = "";
  private readonly sourceChecks = new Map<string, { ready: boolean; checkedAt: string }>();
  private ownerCalls = 0;
  private recovering = false;
  private checkingConfiguration = false;
  private ownerCall() {
    if (
      this.ownerCalls >=
      (this.recovering
        ? this.policy.maxRecoverySteps * this.policy.maxOwnerCalls
        : this.policy.maxOwnerCalls)
    )
      throw Error("OWNER_CALL_BOUNDS");
    this.ownerCalls++;
  }
  constructor(private readonly ports: ScannerPorts) {}
  private gate(allowInitialConfiguration = false) {
    if (this.checkingConfiguration) throw Error("CONFIGURATION_REENTRANCY");
    this.checkingConfiguration = true;
    try {
      const c = readScannerPolicy(this.ports.configuration(), this.ports.clock);
      if (
        this.initialized &&
        this.clockIdentity !==
          fingerprint({ mode: this.ports.clock.mode, provenance: this.ports.clock.provenance })
      )
        throw Error("CLOCK_AUTHORITY_CHANGED");
      const authority = this.ports.authority.require(stateDomain("mose.scanner"));
      if (
        !authority.ok ||
        authority.value.owner !== stateOwner("mose.scanner") ||
        authority.value.writeAuthority !== "mose.scanner" ||
        authority.value.authorityType !== "DERIVED" ||
        !authority.value.durable ||
        !authority.value.historyRequired ||
        !authority.value.reconciliationRequired ||
        !authority.value.runtimeModes.includes("RESEARCH")
      )
        throw Error("STATE_AUTHORITY");
      if (
        this.initialized &&
        (fingerprint(c.policy) !== fingerprint(this.policy) || c.configuration !== this.config)
      ) {
        if (
          allowInitialConfiguration &&
          !this.history.length &&
          !this.state.plan &&
          !this.uncertainty
        ) {
          this.policy = c.policy;
          this.config = c.configuration;
        } else throw Error("CONFIGURATION_CHANGED");
      }
      return c;
    } finally {
      this.checkingConfiguration = false;
    }
  }
  private now() {
    return timestamp.parse(this.ports.clock.now());
  }
  private input(raw: unknown) {
    return boundedClone(raw, this.policy.maxInputBytes, this.policy.maxInputDepth);
  }
  private universe(s: ScanSubscription): Universe {
    this.ownerCall();
    const r = this.ports.mose.getUniverse(s.sessionId);
    if (r.ok !== true) throw Error("SOURCE_UNAVAILABLE");
    const u = universeSchema.parse(r.value);
    const { fingerprint: identity, ...body } = u;
    if (fingerprint(body) !== identity) throw Error("SOURCE_MISMATCH");
    if (
      u.fingerprint !== s.universe ||
      !u.members.some((m) => m.instrumentId === s.instrumentId && m.included)
    )
      throw Error("INSTRUMENT_INELIGIBLE");
    return u;
  }
  private async current(s: ScanSubscription) {
    const key = JSON.stringify([s.sessionId, s.universe, s.instrumentId]);
    this.sourceChecks.delete(key);
    try {
      await this.checkCurrent(s);
      this.sourceChecks.set(key, { ready: true, checkedAt: this.now() });
    } catch (e) {
      this.sourceChecks.set(key, { ready: false, checkedAt: this.now() });
      throw e;
    }
  }
  private async checkCurrent(s: ScanSubscription) {
    this.universe(s);
    this.ownerCall();
    const h = await this.ports.mose.health();
    if (h.ok !== true) throw Error("SOURCE_UNAVAILABLE");
    const d = h.value;
    if (d.sessions.find((session) => session.sessionId === s.sessionId)?.status !== "RUNNING")
      throw Error("RUNTIME_NOT_READY");
    if (
      d.pendingAcknowledgments ||
      d.recoveryObligation ||
      d.negativeProvenanceObligations.some((o) => o.sessionId === s.sessionId)
    )
      throw Error("PROVENANCE_INCOMPLETE");
    const scope = JSON.stringify([s.sessionId, s.instrumentId]) + ":" + s.instrumentId,
      axis = d.sourceReadinessAxes.find((x) => x.scope === scope);
    if (
      !axis ||
      axis.checkedAt !== this.now() ||
      axis.eligibilityReady !== true ||
      axis.universeAuthority !== true ||
      axis.dataSourceReady !== true
    )
      throw Error("SOURCE_UNAVAILABLE");
  }
  private evidence(s: ScanSubscription, boundary: string, cause?: string) {
    const u = this.universe(s),
      events = u.plan.filter((p) => p.instrumentId === s.instrumentId && p.boundaryAt <= boundary);
    const event = cause ? events.find((e) => e.eventId === cause) : events.at(-1);
    if (!event) throw Error("TEMPORAL_NOT_READY");
    let bar: string | null = null;
    if (s.mode === "BAR_CLOSE" || s.mode === "TIMEFRAME") {
      this.ownerCall();
      const response = this.ports.aggregation.snapshot({
        streamId: s.streamId!,
        timeframes: [s.timeframe],
        evidenceClass: event.evidenceClass,
        asOf: boundary as Parameters<AggregationEngine["snapshot"]>[0]["asOf"],
        cutoff: boundary as Parameters<AggregationEngine["snapshot"]>[0]["cutoff"],
        includeProvisional: false,
        includeIncomplete: false,
        requireQualityEvidence: true,
      });
      const native = response as unknown as { ok?: unknown; value?: unknown; error?: unknown };
      const resultKind = native.ok,
        resultValue = native.value,
        resultError = native.error;
      if (resultKind !== true || resultError !== undefined) throw Error("TEMPORAL_NOT_READY");
      const snapshot = cloneOwnerEvidence(resultValue, this.policy.maxCheckpointBytes) as Snapshot;
      if (
        snapshot.consistency !== "CONSISTENT" ||
        snapshot.streamId !== s.streamId ||
        snapshot.asOf !== boundary ||
        snapshot.cutoff !== boundary
      )
        throw Error("TEMPORAL_NOT_READY");
      const revision = snapshot.selected[s.timeframe];
      this.ownerCall();
      const replay = this.ports.replayEvidence(event.source.sessionId, event.source.checkpoint);
      if (!replay) throw Error("SOURCE_UNAVAILABLE");
      const member = u.members.find((m) => m.instrumentId === s.instrumentId)!;
      if (
        replay.inputs.fingerprint !== member.inputFingerprint ||
        replay.inputs.manifests.reduce((n, m) => n + m.records.length, 0) > u.policy.maxRetained
      )
        throw Error("SOURCE_MISMATCH");
      const sourceEvents = new DeterministicReplaySequencer(replay.specification, replay.inputs)
        .events;
      const sourceEvent = sourceEvents.find((x) => x.eventId === event.eventId);
      if (!sourceEvent || sourceEvent.payloadFingerprint !== event.payloadFingerprint)
        throw Error("SOURCE_MISMATCH");
      if (
        !revision ||
        revision.stream.sourceFingerprint !== sourceEvent.record.input.sourceFingerprint
      )
        throw Error("SOURCE_MISMATCH");
      const queue: { revision: Revision; ancestors: readonly string[] }[] = [
          { revision, ancestors: [] },
        ],
        seen = new Set<string>();
      let edges = 0;
      while (queue.length) {
        const { revision: r, ancestors } = queue.shift()!;
        if (seen.has(r.revisionId)) continue;
        seen.add(r.revisionId);
        if (seen.size > this.policy.maxDependencies) throw Error("LINEAGE_BOUNDS");
        for (const at of [
          r.availableAt,
          r.committedAt,
          r.publishedAt,
          r.window.start,
          r.window.end,
        ])
          timestamp.parse(at);
        if (
          r.stream.sourceFingerprint !== revision.stream.sourceFingerprint ||
          r.availableAt > boundary ||
          r.committedAt > boundary ||
          r.publishedAt > boundary
        )
          throw Error("SOURCE_MISMATCH");
        for (const c of r.constituents) {
          if (++edges > this.policy.maxEdges) throw Error("LINEAGE_BOUNDS");
          if (c.revisionId) {
            this.ownerCall();
            const nativeChild = this.ports.aggregation.readRevision(c.revisionId);
            const child = nativeChild
              ? (cloneOwnerEvidence(nativeChild, this.policy.maxCheckpointBytes) as Revision)
              : undefined;
            if (
              !child ||
              child.contentFingerprint !== c.contentFingerprint ||
              child.streamId !== r.streamId
            )
              throw Error("SOURCE_MISMATCH");
            if (ancestors.includes(child.revisionId) || child.revisionId === r.revisionId)
              throw Error("LINEAGE_CYCLE");
            queue.push({ revision: child, ancestors: [...ancestors, r.revisionId] });
          } else {
            const original = sourceEvents.find(
              (x) =>
                x.record.input.identity === c.identity &&
                x.record.input.artifactId === c.artifactId,
            );
            const planned = original
              ? u.plan.find(
                  (p) => p.eventId === original.eventId && p.instrumentId === s.instrumentId,
                )
              : undefined;
            if (
              !original ||
              !planned ||
              planned.boundaryAt > boundary ||
              marketFingerprint(
                marketObservationSchema.parse(original.record.input.observation),
              ) !== c.contentFingerprint ||
              !c.quality.includes(
                `QUALITY_REPORT:${planned.qualityReportId}:${planned.qualityFingerprint}`,
              )
            )
              throw Error("SOURCE_MISMATCH");
          }
        }
      }
      if (
        !revision ||
        revision.stream.instrumentId !== sourceEvent.instrumentId ||
        revision.final !== true ||
        revision.streamId !== s.streamId ||
        revision.timeframe !== s.timeframe ||
        snapshot.sourceFingerprint !== revision.stream.sourceFingerprint ||
        !timestamp.safeParse(revision.finalityAt).success ||
        revision.window.end > boundary ||
        revision.window.start >= revision.window.end ||
        revision.availableAt > boundary ||
        revision.committedAt > boundary ||
        !revision.finalityAt ||
        revision.finalityAt > boundary ||
        revision.coverage !== "COMPLETE_COVERAGE"
      )
        throw Error("TEMPORAL_NOT_READY");
      bar = fingerprint({
        revision: revision.revisionId,
        lineage: revision.lineageFingerprint,
        availableAt: revision.availableAt,
        source: snapshot.sourceFingerprint,
      });
    }
    return {
      event,
      identity: fingerprint({
        universe: u.fingerprint,
        event: bar ? null : event.key,
        quality: bar ? null : event.qualityFingerprint,
        bar,
      }),
      bar,
    };
  }
  private validateTrigger(sub: ScanSubscription, t: ScanTrigger, at: string) {
    const kinds: Record<ScanSubscription["mode"], readonly ScanTrigger["kind"][]> = {
      TICK_EVENT: ["EVENT"],
      SECONDS: ["DEADLINE"],
      BAR_CLOSE: ["BAR_FINALITY"],
      TIMEFRAME: ["TIMEFRAME"],
      SCHEDULE: ["DEADLINE"],
      TRIGGER: ["CONFIGURATION", "QUALITY", "SOURCE_RECOVERY", "UNIVERSE", "RESEARCH_RESCAN"],
    };
    if (!kinds[sub.mode].includes(t.kind) || t.boundary > at) throw Error("TRIGGER_MODE");
    if (sub.mode === "TRIGGER") {
      if (!t.actor || !this.policy.trustedTriggerActors.includes(t.actor))
        throw Error("TRIGGER_UNAUTHORIZED");
    } else if (t.actor !== null) throw Error("TRIGGER_ACTOR");
    if (["SECONDS", "SCHEDULE"].includes(sub.mode)) {
      const elapsed = Date.parse(t.boundary) - Date.parse(sub.anchor);
      if (elapsed < 0 || elapsed % sub.cadenceMs! !== 0) throw Error("NOT_DUE");
      if (
        t.cause !== (sub.schedule?.id ?? sub.id) ||
        (sub.schedule && t.boundary > sub.schedule.end)
      )
        throw Error("TRIGGER_CAUSE_MISMATCH");
    }
  }
  private budget(state: ScannerState) {
    if (
      state.requests.length > this.policy.maxRequests ||
      state.work.filter(pending).length > this.policy.maxQueue ||
      state.work.length > this.policy.maxRequests
    )
      throw Error("RESOURCE_BUDGET_EXCEEDED");
    if (state.work.some((w) => w.requests.length > this.policy.maxCoalesced))
      throw Error("COALESCING_BOUNDS");
  }
  private async save(
    id: string,
    kind: string,
    payload: unknown,
    state: ScannerState,
  ): Promise<void> {
    this.gate();
    if (this.history.at(-1) && this.history.at(-1)!.at > this.now())
      throw Error("CLOCK_REGRESSION");
    if (this.stopping && !["STOP", "ATTEMPT", "RESULT"].includes(kind)) throw Error("STOP_FENCE");
    this.budget(state);
    if (kind === "STOP" && this.cadencePending(this.now(), state))
      throw Error("CADENCE_OBLIGATIONS_UNRESOLVED");
    const body = {
      schemaVersion: 1 as const,
      generation: this.history.length + 1,
      previous: this.history.at(-1)?.fingerprint ?? null,
      at: this.now(),
      policy: fingerprint(this.policy),
      configuration: this.config,
      state,
      operation: {
        id: id.length > 128 ? "op-" + fingerprint({ id, kind }).slice(7) : id,
        kind,
        payload,
      },
    };
    const c: ScannerCheckpoint = frozen({ ...body, fingerprint: fingerprint(body) });
    if (
      this.history.length >= this.policy.maxHistory ||
      bytes(c) > this.policy.maxCheckpointBytes ||
      this.history.reduce((n, h) => n + bytes(h), 0) + bytes(c) > this.policy.maxRetainedBytes
    )
      throw Error("CHECKPOINT_BOUNDS");
    this.validateHistory(this.history.at(-1) ?? null, c);
    const auth = this.ports.authority.validateMutation({
      stateId: persistenceId(c.fingerprint),
      stateDomain: stateDomain("mose.scanner"),
      owner: stateOwner("mose.scanner"),
      runtimeMode: "RESEARCH",
      actor: { actorType: "SYSTEM" },
      transition: kind,
      payload: c,
    });
    if (!auth.ok) throw Error("STATE_AUTHORITY");
    this.uncertainty = c.fingerprint;
    const result = (await this.ports.repository.commit(c)) as unknown as {
      ok?: unknown;
      value?: unknown;
      error?: unknown;
    };
    const discriminator = result.ok,
      selectedValue = result.value,
      selectedError = result.error;
    if (discriminator !== true) {
      if (
        discriminator === false &&
        selectedValue === undefined &&
        selectedError &&
        typeof selectedError === "object"
      ) {
        const e = selectedError as { code?: unknown; commitment?: unknown };
        const code = e.code,
          commitment = e.commitment;
        if (
          typeof code !== "string" ||
          !code.length ||
          !["NONE", "UNKNOWN"].includes(commitment as string)
        )
          throw Error("PUBLICATION_UNKNOWN");
        if (commitment === "NONE") {
          this.uncertainty = null;
          throw Error("PUBLICATION_REFUSED");
        }
      }
      throw Error("PUBLICATION_UNKNOWN");
    }
    if (selectedError !== undefined) throw Error("PUBLICATION_UNKNOWN");
    const actual = checkedCheckpoint(selectedValue, this.policy);
    if (actual.fingerprint !== c.fingerprint || fingerprint(actual) !== fingerprint(c))
      throw Error("ACK_MISMATCH");
    this.history.push(c);
    this.state = c.state;
    this.uncertainty = null;
  }
  private copy(): ScannerState {
    return structuredClone(this.state);
  }
  private async operation<T>(fn: () => Promise<T>, allowDrain = false): Promise<ScannerResult<T>> {
    if (
      this.busy ||
      this.stopped ||
      (this.stopping && !allowDrain) ||
      !this.initialized ||
      this.uncertainty
    )
      return failure("RUNTIME_NOT_READY", this.uncertainty ? "UNKNOWN" : "NONE");
    this.busy = true;
    this.ownerCalls = 0;
    try {
      this.gate(true);
      return success(frozen(await fn()));
    } catch (e) {
      return failure(err(e), this.uncertainty ? "UNKNOWN" : "NONE");
    } finally {
      this.busy = false;
    }
  }
  async initialize(): Promise<ScannerResult<void>> {
    if (this.busy || this.initialized || this.stopped || this.uncertainty)
      return failure("INVALID_LIFECYCLE");
    this.busy = true;
    this.ownerCalls = 0;
    this.recovering = true;
    try {
      const c = this.gate();
      this.policy = c.policy;
      this.clockIdentity = fingerprint({
        mode: this.ports.clock.mode,
        provenance: this.ports.clock.provenance,
      });
      this.config = c.configuration;
      const loaded = (await this.ports.repository.load()) as unknown as {
        ok?: unknown;
        value?: unknown;
        error?: unknown;
      };
      const kind = loaded.ok,
        rawHistory = loaded.value,
        opposite = loaded.error;
      if (
        kind !== true ||
        opposite !== undefined ||
        !Array.isArray(rawHistory) ||
        types.isProxy(rawHistory)
      )
        throw Error("RECOVERY_REQUIRED");
      const length = rawHistory.length;
      if (length > Math.min(this.policy.maxRecoverySteps, this.policy.maxHistory))
        throw Error("RECOVERY_BOUNDS");
      const records: ScannerCheckpoint[] = [];
      let retained = 0;
      for (let i = 0; i < length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(rawHistory, String(i));
        if (!descriptor || descriptor.get || descriptor.set) throw Error("RECOVERY_REQUIRED");
        const record = checkedCheckpoint(descriptor.value, this.policy);
        retained += bytes(record);
        if (retained > this.policy.maxRetainedBytes) throw Error("RECOVERY_BOUNDS");
        records.push(record);
      }
      let previous: ScannerCheckpoint | null = null;
      for (const next of records) {
        if (
          retained > this.policy.maxRetainedBytes ||
          next.generation !== (previous?.generation ?? 0) + 1 ||
          next.previous !== (previous?.fingerprint ?? null) ||
          next.policy !== fingerprint(this.policy) ||
          next.configuration !== this.config ||
          next.at > this.now() ||
          (previous && next.at < previous.at)
        )
          throw Error("HISTORY_INTEGRITY");
        this.validateHistory(previous, next);
        this.budget(next.state);
        if (next.state.plan) {
          validatePlan(next.state.plan, this.policy);
          if (fingerprint(next.state.plan) !== fingerprint(c.plan))
            throw Error("RECOVERY_PLAN_CONFIGURATION");
        }
        previous = next;
        this.history.push(next);
      }
      this.state = previous?.state ?? empty();
      for (const receipt of this.state.requests) {
        const sub = this.state.plan?.subscriptions.find(
          (s) => s.id === receipt.trigger.subscriptionId,
        );
        if (sub?.mode === "TRIGGER") {
          const u = this.universe(sub),
            t = receipt.trigger;
          if (u.checker.actorId !== t.actor) throw Error("RECOVERY_TRIGGER_AUTHORITY");
          const expected =
            t.kind === "CONFIGURATION"
              ? this.config
              : t.kind === "UNIVERSE"
                ? u.fingerprint
                : t.kind === "QUALITY"
                  ? u.plan
                      .filter(
                        (p) => p.instrumentId === sub.instrumentId && p.boundaryAt <= t.boundary,
                      )
                      .at(-1)?.qualityReportId
                  : null;
          if (expected !== null && expected !== t.cause) throw Error("RECOVERY_TRIGGER_CAUSE");
        }
      }

      for (const w of this.state.work) {
        const cause = this.state.requests.find(
          (q) => q.workKey === w.key && q.trigger.kind === "EVENT",
        )?.trigger.cause;
        const source = this.evidence(w.subscription, w.boundary, cause);
        if (
          source.identity !== w.evidence ||
          w.ordinal !== source.event.ownerOrdinal ||
          fingerprint(w.vector) !==
            fingerprint(
              Object.fromEntries(
                w.subscription.dependencies.map((d) => [
                  d,
                  fingerprint({ identity: source.identity, dependency: d }),
                ]),
              ),
            )
        )
          throw Error("RECOVERY_DEPENDENCY_EVIDENCE");
        if (w.status !== "COMPLETED") continue;
        const observed = this.observations(w.subscription.sessionId).find(
          (o) => o.observationId === w.observationId,
        );
        if (
          !observed ||
          observed.outcome !== "ADMITTED" ||
          observed.universeSnapshot !== w.subscription.universe ||
          observed.plan.key !== source.event.key
        )
          throw Error("RECOVERY_OWNER_EVIDENCE");
        let found = false;
        for (let offset = 0; offset < this.policy.maxRecoverySteps; offset += 100) {
          this.ownerCall();
          const h = this.ports.mose.query({
            sessionId: w.subscription.sessionId,
            kind: "HISTORY",
            offset,
            limit: 100,
            asOf: null,
          });
          if (h.ok !== true || !("records" in h.value.value))
            throw Error("RECOVERY_OWNER_EVIDENCE");
          const page = h.value.value as {
            records: readonly {
              fingerprint?: string;
              state?: { sessions: readonly { observations: readonly Observation[] }[] };
            }[];
            nextOffset: number | null;
          };
          if (
            page.records.some(
              (c) =>
                c.fingerprint === w.ownerAck &&
                c.state?.sessions.some((session) =>
                  session.observations.some(
                    (o) =>
                      o.observationId === w.observationId &&
                      o.outcome === "ADMITTED" &&
                      o.plan.key === source.event.key,
                  ),
                ),
            )
          ) {
            found = true;
            break;
          }
          if (page.nextOffset === null) break;
        }
        if (!found) throw Error("RECOVERY_OWNER_ACK");
      }
      this.recovered = !!previous;
      this.stopped = this.state.phase === "STOPPED";
      this.initialized = true;
      return success(undefined);
    } catch (e) {
      this.uncertainty = "RECOVERY_REQUIRED";
      return failure(err(e), "UNKNOWN");
    } finally {
      this.busy = false;
      this.recovering = false;
    }
  }
  private validateHistory(previous: ScannerCheckpoint | null, next: ScannerCheckpoint) {
    const old = previous?.state ?? empty(),
      s = next.state,
      k = next.operation.kind;
    if (
      !["PLAN", "START", "PAUSE", "RESUME", "REQUEST", "ATTEMPT", "RESULT", "STOP"].includes(k) ||
      old.phase === "STOPPED"
    )
      throw Error("HISTORY_LIFECYCLE");
    if (k === "PLAN") {
      if (
        old.plan ||
        !s.plan ||
        s.phase !== "READY" ||
        fingerprint(next.operation.payload) !== fingerprint(s.plan)
      )
        throw Error("HISTORY_PLAN");
    } else if (fingerprint(old.plan) !== fingerprint(s.plan)) throw Error("HISTORY_PLAN");
    const phases: Record<string, string[]> = {
      START: ["READY"],
      PAUSE: ["RUNNING"],
      RESUME: ["PAUSED"],
      REQUEST: ["RUNNING"],
      ATTEMPT: ["RUNNING"],
      RESULT: ["RUNNING"],
      STOP: ["READY", "RUNNING", "PAUSED"],
    };
    if (k !== "PLAN" && !phases[k]!.includes(old.phase)) throw Error("HISTORY_LIFECYCLE");
    const expectedPhase =
      k === "START" || k === "RESUME"
        ? "RUNNING"
        : k === "PAUSE"
          ? "PAUSED"
          : k === "STOP"
            ? "STOPPED"
            : old.phase;
    if (s.phase !== expectedPhase) throw Error("HISTORY_LIFECYCLE");
    if (
      new Set(s.work.map((w) => w.key)).size !== s.work.length ||
      new Set(s.requests.map((x) => x.trigger.id)).size !== s.requests.length
    )
      throw Error("HISTORY_IDENTITY");
    for (const w of s.work) {
      if (
        !s.plan?.subscriptions.some((sub) => fingerprint(sub) === fingerprint(w.subscription)) ||
        w.boundary > next.at
      )
        throw Error("HISTORY_WORK");
      if (w.status === "COMPLETED" && (!w.ownerAck || !w.observationId))
        throw Error("HISTORY_COMPLETION");
      const prior = old.work.find((x) => x.key === w.key);
      if (prior && prior.status === "COMPLETED" && fingerprint(prior) !== fingerprint(w))
        throw Error("HISTORY_COMPLETION");
      for (const id of w.requests)
        if (!s.requests.some((q) => q.trigger.id === id && q.workKey === w.key))
          throw Error("HISTORY_LINEAGE");
    }
    for (const w of old.work) if (!s.work.some((x) => x.key === w.key)) throw Error("HISTORY_LOSS");
    for (const q of old.requests)
      if (!s.requests.some((x) => fingerprint(x) === fingerprint(q))) throw Error("HISTORY_LOSS");
    const expected = structuredClone(old);
    if (k === "PLAN") expected.plan = s.plan;
    else if (["START", "PAUSE", "RESUME", "STOP"].includes(k)) expected.phase = s.phase;
    else if (k === "REQUEST") {
      if (s.requests.length !== old.requests.length + 1) throw Error("HISTORY_REQUEST");
      const q = s.requests.at(-1)!;
      const subscription = s.plan?.subscriptions.find((sub) => sub.id === q.trigger.subscriptionId);
      if (!subscription) throw Error("HISTORY_SUBSCRIPTION");
      this.validateTrigger(subscription, q.trigger, next.at);
      if (
        q.trigger.boundary < (this.history.find((c) => c.operation.kind === "PLAN")?.at ?? next.at)
      )
        throw Error("HISTORY_PLAN_NOT_EFFECTIVE");
      if (
        fingerprint(q.trigger) !== fingerprint(next.operation.payload) ||
        q.trigger.boundary > next.at
      )
        throw Error("HISTORY_REQUEST");
      if (q.workKey === null) {
        if (
          q.disposition !== "SKIPPED" ||
          !["MISSED_INTERVAL", "SESSION_CLOSED", "SESSION_BREAK"].includes(q.reason)
        )
          throw Error("HISTORY_REQUEST");
        const schedule = subscription.schedule;
        if (
          !schedule ||
          schedule.calendarFingerprint !== this.ports.calendar.fingerprint ||
          q.trigger.evidence !==
            fingerprint({ calendar: schedule.calendarFingerprint, boundary: q.trigger.boundary })
        )
          throw Error("HISTORY_SCHEDULE");
        if (q.reason === "MISSED_INTERVAL") {
          if (
            schedule.missed !== "SKIP" ||
            Date.parse(q.trigger.boundary) + subscription.cadenceMs! >
              Math.min(Date.parse(next.at), Date.parse(schedule.end))
          )
            throw Error("HISTORY_MISSED_INTERVAL");
        } else {
          let actual: string | null = null;
          try {
            this.ports.calendar.resolve(
              new TimeframeRegistry().get(subscription.timeframe),
              q.trigger.boundary as Parameters<CalendarBoundaryResolver["resolve"]>[1],
            );
          } catch (e) {
            actual = err(e);
          }
          if (actual !== q.reason) throw Error("HISTORY_SCHEDULE");
        }
        expected.requests.push(q);
        expected.deadlines[q.trigger.subscriptionId] = q.trigger.boundary;
        if (fingerprint(expected) !== fingerprint(s)) throw Error("HISTORY_TRANSITION");
        return;
      }
      expected.requests.push(q);
      const before = old.work.find((w) => w.key === q.workKey),
        after = s.work.find((w) => w.key === q.workKey);
      if (!after) throw Error("HISTORY_WORK");
      if (q.disposition === "DUE") {
        if (
          before ||
          after.status !== "DUE" ||
          after.attempts !== 0 ||
          after.ownerAck ||
          after.observationId ||
          fingerprint(after.requests) !== fingerprint([q.trigger.id])
        )
          throw Error("HISTORY_WORK");
        if (
          workKey(
            after.subscription,
            q.trigger,
            after.vector,
            fingerprint({
              policy: next.policy,
              plan: fingerprint(s.plan),
              configuration: next.configuration,
            }),
          ) !== after.key
        )
          throw Error("HISTORY_IDENTITY");
        expected.work.push(after);
      } else if (q.disposition === "COALESCED") {
        if (!before || !pending(before)) throw Error("HISTORY_COALESCING");
        const w = expected.work.find((w) => w.key === before.key)!;
        w.requests.push(q.trigger.id);
        if (
          equivalentKey(
            w.subscription,
            {
              ...old.requests.find((r) => r.workKey === w.key && r.disposition === "DUE")!.trigger,
              boundary: w.boundary,
              evidence: w.evidence,
            },
            w.vector,
            fingerprint({
              policy: next.policy,
              plan: fingerprint(s.plan),
              configuration: next.configuration,
            }),
          ) !==
          equivalentKey(
            s.plan!.subscriptions.find((x) => x.id === q.trigger.subscriptionId)!,
            q.trigger,
            after.vector,
            fingerprint({
              policy: next.policy,
              plan: fingerprint(s.plan),
              configuration: next.configuration,
            }),
          )
        )
          throw Error("HISTORY_COALESCING");
      } else if (q.disposition === "SKIPPED") {
        if (
          !before ||
          !["UNCHANGED_DEPENDENCIES", "DUPLICATE_REQUEST"].includes(q.reason) ||
          (q.reason === "UNCHANGED_DEPENDENCIES" && before.status !== "COMPLETED")
        )
          throw Error("HISTORY_CACHE");
        if (
          q.reason === "DUPLICATE_REQUEST" &&
          !old.requests.some(
            (r) =>
              r.trigger.kind === "EVENT" &&
              q.trigger.kind === "EVENT" &&
              r.trigger.cause === q.trigger.cause &&
              r.trigger.subscriptionId === q.trigger.subscriptionId &&
              r.workKey === q.workKey,
          )
        )
          throw Error("HISTORY_DUPLICATE");
        expected.avoided++;
      } else throw Error("HISTORY_REQUEST");
      if (q.workKey !== null && q.trigger.evidence !== after.evidence)
        throw Error("HISTORY_EVIDENCE");
      expected.versions = { ...expected.versions, ...after.vector };
      expected.deadlines[q.trigger.subscriptionId] = q.trigger.boundary;
    } else {
      const payload = next.operation.payload as {
        key?: string;
        ownerAck?: string;
        reason?: string;
      };
      const w = expected.work.find((w) => w.key === payload?.key),
        after = s.work.find((w) => w.key === payload?.key);
      if (!w || !after) throw Error("HISTORY_WORK");
      if (k === "ATTEMPT") {
        if (!pending(w)) throw Error("HISTORY_ATTEMPT");
        w.attempts++;
        w.status = "UNKNOWN";
        w.reason = "OWNER_ATTEMPT_RETAINED";
      } else {
        if (w.status !== "UNKNOWN" || !["COMPLETED", "DEFERRED"].includes(after.status))
          throw Error("HISTORY_RESULT");
        if (
          (after.status === "COMPLETED" &&
            (payload.ownerAck !== after.ownerAck ||
              after.reason !== "P25_OBSERVATION_ACKNOWLEDGED")) ||
          (after.status === "DEFERRED" && payload.reason !== after.reason)
        )
          throw Error("HISTORY_RESULT");
        w.status = after.status;
        w.reason = after.reason;
        w.observationId = after.observationId;
        w.ownerAck = after.ownerAck;
        expected.lastInstrument = w.subscription.instrumentId;
        expected.lastWork[w.subscription.instrumentId] = w.key;
      }
    }
    if (fingerprint(expected) !== fingerprint(s)) throw Error("HISTORY_TRANSITION");
  }
  async configure() {
    return this.operation(async () => {
      await Promise.resolve();
      const c = this.gate();
      return {
        configurationFingerprint: c.configuration,
        policyFingerprint: fingerprint(c.policy),
        planFingerprint: c.plan ? fingerprint(c.plan) : null,
        scope: "ACCEPTED_CONFIGURATION_OWNER_NOT_NEW_APPROVAL_AUTHORITY",
      };
    });
  }
  async createPlan(id: string, raw: unknown) {
    return this.operation(async () => {
      identifier.parse(id);
      if (this.state.phase !== "READY" || this.state.plan) throw Error("INVALID_LIFECYCLE");
      const p = validatePlan(this.input(raw), this.policy);
      if (
        p.subscriptions.some(
          (sub) =>
            (["SECONDS", "SCHEDULE"].includes(sub.mode) && sub.anchor < this.now()) ||
            (sub.schedule &&
              Date.parse(sub.schedule.end) >
                Date.parse(this.now()) + this.policy.maxScheduleHorizonMs),
        )
      )
        throw Error("PLAN_HORIZON");
      const configured = this.gate().plan;
      if (!configured || fingerprint(configured) !== fingerprint(p))
        throw Error("PLAN_NOT_GOVERNED");
      for (const sub of p.subscriptions) this.universe(sub);
      const s = this.copy();
      s.plan = p;
      await this.save(id, "PLAN", p, s);
      return p;
    });
  }
  async transition(id: string, kind: "START" | "PAUSE" | "RESUME") {
    return this.operation(async () => {
      identifier.parse(id);
      const old = this.history.find((c) => c.operation.id === id);
      if (old) {
        if (old.operation.kind !== kind) throw Error("IDEMPOTENCY_CONFLICT");
        return old.state.phase;
      }
      if (this.state.plan && this.state.phase === (kind === "PAUSE" ? "PAUSED" : "RUNNING"))
        return this.state.phase;
      const expected = { START: "READY", PAUSE: "RUNNING", RESUME: "PAUSED" };
      if (!this.state.plan || this.state.phase !== expected[kind]) throw Error("INVALID_LIFECYCLE");
      const s = this.copy();
      s.phase = kind === "PAUSE" ? "PAUSED" : "RUNNING";
      await this.save(id, kind, null, s);
      return s.phase;
    });
  }
  async request(raw: unknown) {
    return this.operation(async () => {
      const t = triggerSchema.parse(this.input(raw));
      return this.planRequest(t);
    });
  }
  private async planRequest(t: ScanTrigger) {
    if (this.state.phase !== "RUNNING" || !this.state.plan) throw Error("INVALID_LIFECYCLE");
    if (t.boundary > this.now()) throw Error("FUTURE_BOUNDARY");
    if (t.boundary < (this.history.find((c) => c.operation.kind === "PLAN")?.at ?? this.now()))
      throw Error("PLAN_NOT_EFFECTIVE");
    const old = this.state.requests.find((q) => q.trigger.id === t.id);
    if (old) {
      if (fingerprint(old.trigger) !== fingerprint(t)) throw Error("IDEMPOTENCY_CONFLICT");
      return old;
    }
    const sub = this.state.plan.subscriptions.find((s) => s.id === t.subscriptionId);
    if (!sub) throw Error("SUBSCRIPTION_MISSING");
    this.validateTrigger(sub, t, this.now());
    if (sub.mode === "TRIGGER" && (!t.actor || !this.policy.trustedTriggerActors.includes(t.actor)))
      throw Error("TRIGGER_UNAUTHORIZED");
    this.ownerCall();
    const authority = this.ports.mose.getSessionSummary(sub.sessionId);
    if (authority.ok !== true) throw Error("SOURCE_UNAVAILABLE");
    if (authority.value.currentPublicationAuthority === "RESTRICTED")
      throw Error("PROVENANCE_INCOMPLETE");
    const allowed: Record<ScanSubscription["mode"], ScanTrigger["kind"][]> = {
      TICK_EVENT: ["EVENT"],
      SECONDS: ["DEADLINE"],
      BAR_CLOSE: ["BAR_FINALITY"],
      TIMEFRAME: ["TIMEFRAME"],
      SCHEDULE: ["DEADLINE"],
      TRIGGER: ["CONFIGURATION", "QUALITY", "SOURCE_RECOVERY", "UNIVERSE", "RESEARCH_RESCAN"],
    };
    if (!allowed[sub.mode].includes(t.kind)) throw Error("TRIGGER_MODE");
    if (sub.mode === "TRIGGER") {
      const u = this.universe(sub);
      if (
        !t.actor ||
        !this.policy.trustedTriggerActors.includes(t.actor) ||
        u.checker.actorId !== t.actor
      )
        throw Error("TRIGGER_UNAUTHORIZED");
      await this.current(sub);
      const cause =
        t.kind === "CONFIGURATION"
          ? this.config
          : t.kind === "UNIVERSE"
            ? u.fingerprint
            : t.kind === "QUALITY"
              ? u.plan
                  .filter((p) => p.instrumentId === sub.instrumentId && p.boundaryAt <= t.boundary)
                  .at(-1)?.qualityReportId
              : null;
      if (cause !== null && cause !== t.cause) throw Error("TRIGGER_CAUSE_MISMATCH");
    }
    if (["SECONDS", "SCHEDULE"].includes(sub.mode)) {
      if (t.cause !== (sub.schedule?.id ?? sub.id)) throw Error("TRIGGER_CAUSE_MISMATCH");
      const elapsed = Date.parse(t.boundary) - Date.parse(sub.anchor);
      if (elapsed < 0 || elapsed % sub.cadenceMs! !== 0) throw Error("NOT_DUE");
      if (sub.schedule) {
        if (
          sub.schedule.calendarFingerprint !== this.ports.calendar.fingerprint ||
          t.boundary > sub.schedule.end
        )
          throw Error("INVALID_SCHEDULE");
        const tf = new TimeframeRegistry().get(sub.timeframe);
        this.ports.calendar.resolve(
          tf,
          t.boundary as Parameters<CalendarBoundaryResolver["resolve"]>[1],
        );
      }
    }
    const e = this.evidence(sub, t.boundary, t.kind === "EVENT" ? t.cause : undefined);
    if (
      t.evidence !== e.identity ||
      (["EVENT", "BAR_FINALITY", "TIMEFRAME"].includes(t.kind) && t.cause !== e.event.eventId)
    )
      throw Error("EVIDENCE_MISMATCH");
    const vector = Object.fromEntries(
      sub.dependencies.map((d) => [d, fingerprint({ identity: e.identity, dependency: d })]),
    );
    const priorEvent =
      t.kind === "EVENT"
        ? this.state.requests.find(
            (q) =>
              q.trigger.kind === "EVENT" &&
              q.trigger.subscriptionId === t.subscriptionId &&
              q.trigger.cause === t.cause,
          )
        : undefined;
    if (priorEvent) {
      await this.current(sub);
      const state = this.copy(),
        receipt = {
          trigger: t,
          workKey: priorEvent.workKey,
          disposition: "SKIPPED" as const,
          reason: "DUPLICATE_REQUEST",
        };
      state.requests.push(receipt);
      state.deadlines[sub.id] = t.boundary;
      const linked = state.work.find((w) => w.key === priorEvent.workKey)!;
      state.versions = { ...state.versions, ...linked.vector };
      state.avoided++;
      await this.save(t.id, "REQUEST", t, state);
      return receipt;
    }
    const key = workKey(
        sub,
        t,
        vector,
        fingerprint({
          policy: fingerprint(this.policy),
          plan: fingerprint(this.state.plan),
          configuration: this.config,
        }),
      ),
      s = this.copy();
    const previous = s.work.find(
      (w) =>
        w.subscription.sessionId === sub.sessionId &&
        w.subscription.universe === sub.universe &&
        w.subscription.instrumentId === sub.instrumentId &&
        w.subscription.timeframe === sub.timeframe &&
        w.subscription.streamId === sub.streamId &&
        fingerprint(w.vector) === fingerprint(vector) &&
        w.status === "COMPLETED" &&
        this.authenticatedCacheKeys.has(w.key),
    );
    let reason = "NEW_EVIDENCE",
      disposition: "DUE" | "COALESCED" | "SKIPPED" = "DUE",
      target = key;
    if (previous && !(sub.mode === "TRIGGER" && t.kind === "RESEARCH_RESCAN")) {
      await this.current(sub);
      reason = "UNCHANGED_DEPENDENCIES";
      disposition = "SKIPPED";
      target = previous.key;
      s.avoided++;
    } else {
      const equivalent =
        this.policy.coalescing === "EXACT_EVIDENCE"
          ? s.work.find(
              (w) =>
                pending(w) &&
                equivalentKey(
                  w.subscription,
                  {
                    ...s.requests.find((q) => q.workKey === w.key && q.disposition === "DUE")!
                      .trigger,
                    boundary: w.boundary,
                    evidence: w.evidence,
                  },
                  w.vector,
                  fingerprint({
                    policy: fingerprint(this.policy),
                    plan: fingerprint(this.state.plan),
                    configuration: this.config,
                  }),
                ) ===
                  equivalentKey(
                    sub,
                    t,
                    vector,
                    fingerprint({
                      policy: fingerprint(this.policy),
                      plan: fingerprint(this.state.plan),
                      configuration: this.config,
                    }),
                  ),
            )
          : undefined;
      if (equivalent) {
        if (equivalent.requests.length >= this.policy.maxCoalesced)
          throw Error("COALESCING_BOUNDS");
        equivalent.requests.push(t.id);
        target = equivalent.key;
        reason = "COALESCED_EQUIVALENT_WORK";
        disposition = "COALESCED";
      } else {
        if (s.work.filter(pending).length >= this.policy.maxQueue) throw Error("RESOURCE_DEFERRED");
        s.work.push({
          key,
          subscription: sub,
          boundary: t.boundary,
          evidence: t.evidence,
          vector,
          requests: [t.id],
          status: "DUE",
          reason,
          ordinal: e.event.ownerOrdinal,
          attempts: 0,
          observationId: null,
          ownerAck: null,
        });
      }
    }
    const receipt = { trigger: t, workKey: target, disposition, reason };
    s.requests.push(receipt);
    s.versions = { ...s.versions, ...vector };
    s.deadlines[sub.id] = t.boundary;
    await this.save(t.id, "REQUEST", t, s);
    return receipt;
  }
  /** Obtain the exact required evidence identity from accepted owners; a preview grants no authority. */
  preview(
    subscriptionId: string,
    boundary: string,
    eventId?: string,
  ): ScannerResult<{ cause: string; evidence: string }> {
    try {
      if (this.busy || !this.initialized || this.stopped) throw Error("RUNTIME_NOT_READY");
      this.gate();
      timestamp.parse(boundary);
      if (boundary > this.now()) throw Error("FUTURE_BOUNDARY");
      const s = this.state.plan?.subscriptions.find((x) => x.id === subscriptionId);
      if (!s) throw Error("SUBSCRIPTION_MISSING");
      this.ownerCalls = 0;
      const e = this.evidence(s, boundary, eventId);
      return success(frozen({ cause: e.event.eventId, evidence: e.identity }));
    } catch (e) {
      return failure(err(e));
    }
  }
  affectedDependencies(changed: readonly string[]): ScannerResult<readonly string[]> {
    try {
      if (!this.initialized || this.busy || this.stopped || !this.state.plan)
        throw Error("RUNTIME_NOT_READY");
      if (
        !Array.isArray(changed) ||
        changed.length > this.policy.maxDependencies ||
        changed.some((id) => !identifier.safeParse(id).success)
      )
        throw Error("DEPENDENCY_BOUNDS");
      const result = new ScanDependencyGraph(
        this.state.plan.dependencies,
        this.policy.maxDependencies,
        this.policy.maxEdges,
      ).affected(changed);
      if (result.length > this.policy.maxFanout) throw Error("FANOUT_BOUNDS");
      return success(result);
    } catch (e) {
      return failure(err(e));
    }
  }
  async onEvent(sessionId: string, eventId: string, boundary: string) {
    return this.operation(async () => {
      identifier.parse(sessionId);
      identifier.parse(eventId);
      timestamp.parse(boundary);
      if (!this.state.plan || this.state.phase !== "RUNNING" || boundary > this.now())
        throw Error("RUNTIME_NOT_READY");
      const direct = this.state.plan.subscriptions.filter(
        (s) => s.sessionId === sessionId && s.mode === "TICK_EVENT",
      );
      if (!direct.length) throw Error("SUBSCRIPTION_MISSING");
      const root = this.universe(direct[0]!),
        event = root.plan.find((e) => e.eventId === eventId);
      if (!event || event.boundaryAt > boundary) throw Error("TEMPORAL_NOT_READY");
      const affected = new ScanDependencyGraph(
        this.state.plan.dependencies,
        this.policy.maxDependencies,
        this.policy.maxEdges,
      ).affected(
        direct.filter((s) => s.instrumentId === event.instrumentId).flatMap((s) => s.dependencies),
      );
      const targets = this.state.plan.subscriptions
        .filter(
          (s) =>
            s.sessionId === sessionId &&
            s.instrumentId === event.instrumentId &&
            ["TICK_EVENT", "TIMEFRAME", "BAR_CLOSE"].includes(s.mode) &&
            s.dependencies.some((d) => affected.includes(d)),
        )
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      if (targets.length > this.policy.maxFanout) throw Error("FANOUT_BOUNDS");
      const results = [];
      for (const sub of targets) {
        if (this.stopping) break;
        try {
          const evidence = this.evidence(
            sub,
            boundary,
            sub.mode === "TICK_EVENT" ? eventId : undefined,
          );
          const trigger: ScanTrigger = {
            id:
              "wake-" +
              fingerprint({ plan: this.state.plan.id, sub: sub.id, eventId, boundary }).slice(
                7,
                55,
              ),
            subscriptionId: sub.id,
            boundary,
            kind:
              sub.mode === "TICK_EVENT"
                ? "EVENT"
                : sub.mode === "TIMEFRAME"
                  ? "TIMEFRAME"
                  : "BAR_FINALITY",
            actor: null,
            cause: sub.mode === "TICK_EVENT" ? eventId : evidence.event.eventId,
            evidence: evidence.identity,
          };
          results.push({ ok: true as const, value: await this.planRequest(trigger) });
        } catch (e) {
          results.push({
            ...failure(err(e), this.uncertainty ? "UNKNOWN" : "NONE"),
            subscriptionId: sub.id,
            eventId,
            boundary,
          });
          if (this.uncertainty) break;
        }
      }
      return { results, affected, remainingNotProcessed: this.stopping || !!this.uncertainty };
    });
  }
  /** Derive cadence authority from bounded authenticated receipts, never the legacy
   * deadlines field (which records the last request, including out-of-order ones).
   * Arithmetic counts gaps without iterating an unbounded elapsed-time range. */
  private cadence(asOf = this.now(), state = this.state) {
    const active = this.history.some((c) => c.operation.kind === "START");
    const cutoff =
      state.phase === "STOPPED"
        ? (this.history.find((c) => c.operation.kind === "STOP")?.at ?? asOf)
        : asOf;
    return (state.plan?.subscriptions ?? [])
      .filter((sub) => ["SECONDS", "SCHEDULE"].includes(sub.mode))
      .map((sub) => {
        const anchor = Date.parse(sub.anchor),
          step = sub.cadenceMs!;
        const end = Math.min(
          Date.parse(cutoff),
          sub.schedule ? Date.parse(sub.schedule.end) : Infinity,
        );
        const boundaries = [
          ...new Set(
            state.requests
              .filter((q) => q.trigger.subscriptionId === sub.id && q.trigger.kind === "DEADLINE")
              .map((q) => Date.parse(q.trigger.boundary)),
          ),
        ].sort((a, b) => a - b);
        let next = anchor;
        for (const at of boundaries) {
          if (at === next) next += step;
          else if (at > next) break;
        }
        const required = active && end >= anchor ? Math.floor((end - anchor) / step) + 1 : 0;
        const represented = boundaries.filter((at) => at <= end).length;
        return {
          subscriptionId: sub.id,
          latestRequestedBoundary: boundaries.length
            ? new Date(boundaries.at(-1)!).toISOString()
            : null,
          contiguousThrough: next > anchor ? new Date(next - step).toISOString() : null,
          nextBoundary: next,
          requiredDue: required,
          representedDue: active ? represented : 0,
          unrepresentedDue: Math.max(0, required - (active ? represented : 0)),
        };
      });
  }
  private cadencePending(asOf = this.now(), state = this.state) {
    return this.cadence(asOf, state).some((row) => row.unrepresentedDue > 0);
  }
  async advance(): Promise<
    ScannerResult<{ results: readonly unknown[]; remainingNotProcessed: boolean }>
  > {
    if (
      this.busy ||
      !this.initialized ||
      this.stopped ||
      this.stopping ||
      this.state.phase !== "RUNNING" ||
      !this.state.plan
    )
      return failure("RUNTIME_NOT_READY");
    this.busy = true;
    this.ownerCalls = 0;
    const previousHistory = this.history.length;
    try {
      this.gate();
      const result: unknown[] = [];
      const batchAt = this.now();
      let remaining = this.policy.maxCatchup;
      for (const sub of [...this.state.plan.subscriptions].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      )) {
        if (!["SECONDS", "SCHEDULE"].includes(sub.mode)) continue;
        let at = this.cadence(batchAt).find((row) => row.subscriptionId === sub.id)!.nextBoundary;
        const end = Math.min(
          Date.parse(batchAt),
          sub.schedule ? Date.parse(sub.schedule.end) : Infinity,
        );
        while (at <= end) {
          if (this.stopping || remaining-- <= 0)
            return success(frozen({ results: result, remainingNotProcessed: true }));
          const boundary = new Date(at).toISOString();
          let skipped: string | null =
            sub.schedule?.missed === "SKIP" && at + sub.cadenceMs! <= end
              ? "MISSED_INTERVAL"
              : null;
          if (sub.schedule) {
            try {
              if (sub.schedule.calendarFingerprint !== this.ports.calendar.fingerprint)
                throw Error("CALENDAR_MISMATCH");
              this.ports.calendar.resolve(
                new TimeframeRegistry().get(sub.timeframe),
                boundary as Parameters<CalendarBoundaryResolver["resolve"]>[1],
              );
            } catch (e) {
              if (["SESSION_CLOSED", "SESSION_BREAK"].includes(err(e))) skipped = err(e);
              else throw e;
            }
          }
          if (skipped) {
            const reason = skipped;
            const receipt = await (async () => {
              const s = this.copy(),
                trigger: ScanTrigger = {
                  id: "skip-" + fingerprint({ sub: sub.id, boundary }).slice(7, 55),
                  subscriptionId: sub.id,
                  boundary,
                  kind: "DEADLINE",
                  actor: null,
                  cause: sub.schedule!.id,
                  evidence: fingerprint({ calendar: sub.schedule!.calendarFingerprint, boundary }),
                };
              if (s.requests.some((q) => q.trigger.id === trigger.id))
                throw Error("DUPLICATE_REQUEST");
              const q = { trigger, workKey: null, disposition: "SKIPPED" as const, reason };
              s.requests.push(q);
              s.deadlines[sub.id] = boundary;
              await this.save(trigger.id, "REQUEST", trigger, s);
              return success(q);
            })();
            result.push(receipt);
            if (!receipt.ok) break;
            at = this.cadence(batchAt).find((row) => row.subscriptionId === sub.id)!.nextBoundary;
            continue;
          }
          let preview: ScannerResult<{ evidence: string }>;
          try {
            const e = this.evidence(sub, boundary);
            preview = success({ evidence: e.identity });
          } catch (e) {
            preview = failure(err(e));
          }
          if (!preview.ok) {
            result.push({
              subscriptionId: sub.id,
              boundary,
              disposition: "DEFERRED",
              reason: preview.error.code,
            });
            break;
          }
          const trigger = {
            id:
              "due-" +
              fingerprint({ subscription: sub.id, boundary, plan: this.state.plan.id }).slice(
                7,
                55,
              ),
            subscriptionId: sub.id,
            boundary,
            kind: "DEADLINE" as const,
            actor: null,
            cause: sub.schedule?.id ?? sub.id,
            evidence: preview.value.evidence,
          };
          let receipt: ScannerResult<unknown>;
          try {
            receipt = success(await this.planRequest(trigger));
          } catch (e) {
            receipt = failure(err(e), this.uncertainty ? "UNKNOWN" : "NONE");
          }
          result.push(receipt);
          if (!receipt.ok) break;
          at = this.cadence(batchAt).find((row) => row.subscriptionId === sub.id)!.nextBoundary;
        }
      }
      return success(
        frozen({ results: result, remainingNotProcessed: this.cadencePending(batchAt) }),
      );
    } catch (e) {
      return failure(
        err(e),
        this.uncertainty || this.history.length !== previousHistory ? "UNKNOWN" : "NONE",
      );
    } finally {
      this.busy = false;
    }
  }
  async dispatch(id: string, limit: number) {
    return this.operation(async () => {
      identifier.parse(id);
      if (
        this.state.phase !== "RUNNING" ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > this.policy.maxBatch
      )
        throw Error("BATCH_BOUNDS");
      const selected = ordered(
        this.state.work.filter(pending),
        this.state.lastInstrument,
        this.state.lastWork,
      ).slice(0, Math.min(limit, Math.floor(this.policy.maxOwnerCalls / 4)));
      const receipts = [];
      for (const candidate of selected) {
        let s = this.copy(),
          w = s.work.find((x) => x.key === candidate.key)!;
        w.status = "UNKNOWN";
        w.reason = "OWNER_ATTEMPT_RETAINED";
        w.attempts++;
        await this.save(id + ".intent." + receipts.length, "ATTEMPT", { key: w.key }, s);
        try {
          await this.current(w.subscription);
          const e = this.evidence(
            w.subscription,
            w.boundary,
            this.state.requests.find((q) => q.workKey === w.key && q.trigger.kind === "EVENT")
              ?.trigger.cause,
          );
          if (
            e.identity !== w.evidence ||
            w.ordinal !== e.event.ownerOrdinal ||
            fingerprint(w.vector) !==
              fingerprint(
                Object.fromEntries(
                  w.subscription.dependencies.map((d) => [
                    d,
                    fingerprint({ identity: e.identity, dependency: d }),
                  ]),
                ),
              )
          )
            throw Error("DEPENDENCY_CHANGED");
          const u = this.universe(w.subscription);
          let observations = this.observations(w.subscription.sessionId);
          let observation = observations.find((o) => o.plan.key === e.event.key);
          if (!observation) {
            const next = u.plan[observations.length];
            if (next?.key !== e.event.key) throw Error("CANONICAL_PREDECESSOR_PENDING");
            this.ownerCall();
            const ack = await this.ports.mose.dispatch({
              kind: "RECEIVE",
              id: this.commandId(w, "receive"),
              sessionId: w.subscription.sessionId,
              eventId: e.event.eventId,
              instrumentId: w.subscription.instrumentId,
              universeSnapshot: u.fingerprint,
            });
            if (ack.ok !== true)
              throw Error(ack.error.commitment === "UNKNOWN" ? "OWNER_UNKNOWN" : ack.error.code);
          }
          this.ownerCall();
          const processed = await this.ports.mose.dispatch({
            kind: "PROCESS",
            id: this.commandId(w, "process"),
            sessionId: w.subscription.sessionId,
            limit: 1,
          });
          if (processed.ok !== true)
            throw Error(
              processed.error.commitment === "UNKNOWN" ? "OWNER_UNKNOWN" : processed.error.code,
            );
          observations = this.observations(w.subscription.sessionId);
          observation = observations.find((o) => o.plan.key === e.event.key);
          if (!observation || observation.outcome !== "ADMITTED")
            throw Error(observation?.reason ?? "OWNER_DEFERRED");
          s = this.copy();
          w = s.work.find((x) => x.key === candidate.key)!;
          w.status = "COMPLETED";
          w.reason = "P25_OBSERVATION_ACKNOWLEDGED";
          w.observationId = observation.observationId;
          w.ownerAck = processed.value.fingerprint;
          s.lastInstrument = w.subscription.instrumentId;
          s.lastWork[w.subscription.instrumentId] = w.key;
          await this.save(
            id + ".result." + receipts.length,
            "RESULT",
            { key: w.key, ownerAck: w.ownerAck },
            s,
          );
          this.authenticatedCacheKeys.add(w.key);
        } catch (e) {
          if (this.uncertainty) throw e;
          s = this.copy();
          w = s.work.find((x) => x.key === candidate.key)!;
          w.status = "DEFERRED";
          w.reason = err(e);
          s.lastInstrument = w.subscription.instrumentId;
          s.lastWork[w.subscription.instrumentId] = w.key;
          await this.save(
            id + ".defer." + receipts.length,
            "RESULT",
            { key: w.key, reason: w.reason },
            s,
          );
        }
        receipts.push(frozen(structuredClone(w)));
      }
      return receipts;
    }, true);
  }
  private commandId(w: ScanWork, kind: string) {
    return (
      "scan-" +
      fingerprint({ key: w.key, kind, attempt: kind === "process" ? w.attempts : 0 }).slice(7, 55)
    );
  }
  private observations(sessionId: string): Observation[] {
    const result: Observation[] = [];
    for (let offset = 0; offset <= this.policy.maxRequests; offset += 100) {
      this.ownerCall();
      const r = this.ports.mose.query({
        sessionId,
        kind: "OBSERVATIONS",
        offset,
        limit: 100,
        asOf: null,
      });
      if (r.ok !== true || !("records" in r.value.value)) throw Error("OWNER_QUERY_FAILED");
      const page = r.value.value as { records: readonly Observation[]; nextOffset: number | null };
      result.push(...page.records);
      if (page.nextOffset === null) return result;
    }
    throw Error("QUERY_BOUNDS");
  }
  query(offset = 0, limit = 20) {
    try {
      if (this.busy || !this.initialized || this.stopped) throw Error("RUNTIME_NOT_READY");
      this.gate();
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > this.policy.maxQueryResults
      )
        throw Error("QUERY_BOUNDS");
      return success(
        frozen({
          phase: this.state.phase,
          plan: this.state.plan,
          work: this.state.work.slice(offset, offset + limit),
          requests: this.state.requests.slice(offset, offset + limit),
          totalWork: this.state.work.length,
          totalRequests: this.state.requests.length,
          nextOffset: offset + limit < this.state.work.length ? offset + limit : null,
          historicalFactsNotCurrentAuthority: true,
        }),
      );
    } catch (e) {
      return failure(err(e));
    }
  }
  async health() {
    const r = await this.operation(async () => {
      const seen = new Set<string>();
      for (const sub of this.state.plan?.subscriptions ?? []) {
        const key = JSON.stringify([sub.sessionId, sub.universe, sub.instrumentId]);
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          await this.current(sub);
        } catch {
          /* Explicit false source axis retained; no promotion. */
        }
      }
      return null;
    });
    return r.ok ? success(this.diagnostics()) : r;
  }
  queryHistory(asOf: string, offset = 0, limit = 10) {
    try {
      if (this.busy || !this.initialized || this.stopped) throw Error("RUNTIME_NOT_READY");
      this.gate();
      timestamp.parse(asOf);
      if (
        asOf > this.now() ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > this.policy.maxQueryResults
      )
        throw Error("QUERY_BOUNDS");
      const rows = this.history.filter((c) => c.at <= asOf);
      const result = {
        scope: "HISTORICAL_CHECKPOINTS_NOT_CURRENT_AUTHORITY",
        asOf,
        records: rows.slice(offset, offset + limit),
        total: rows.length,
        nextOffset: offset + limit < rows.length ? offset + limit : null,
      };
      if (bytes(result) > this.policy.maxCheckpointBytes) throw Error("QUERY_BYTES");
      return success(frozen(result));
    } catch (e) {
      return failure(err(e));
    }
  }
  coverage() {
    const all = this.state.work,
      p = all.filter(pending),
      counts = (key: "mode" | "instrumentId" | "timeframe") =>
        Object.fromEntries(
          [...new Set(all.map((w) => w.subscription[key]))].sort().map((id) => [
            id,
            {
              obligations: all.filter((w) => w.subscription[key] === id).length,
              pending: all.filter((w) => w.subscription[key] === id && pending(w)).length,
              completed: all.filter((w) => w.subscription[key] === id && w.status === "COMPLETED")
                .length,
            },
          ]),
        );
    const delay = p.map((w) =>
      Math.max(0, Date.parse(this.ports.clock.now()) - Date.parse(w.boundary)),
    );
    return frozen({
      configuredSubscriptions: this.state.plan?.subscriptions.length ?? 0,
      eligibleSubscriptions: "NOT_ESTABLISHED_USE_CURRENT_OWNER_HEALTH",
      rejectedUnacknowledgedInputs: "NOT_ESTABLISHED_ERRORS_RETURNED_TO_CALLER",
      executionLatency: "NOT_QUALIFIED_LOGICAL_BACKLOG_ONLY",
      requests: this.state.requests.length,
      uniqueObligations: all.length,
      due: all.filter((w) => w.status === "DUE").length,
      evaluatedWork: all.filter((w) => w.attempts > 0).length,
      expired: all.filter((w) => w.status === "EXPIRED").length,
      cancelled: all.filter((w) => w.status === "CANCELLED").length,
      quarantined: all.filter((w) => w.status === "QUARANTINED").length,
      unknown: all.filter((w) => w.status === "UNKNOWN").length,
      invalidatedWork: all.filter((w) => w.reason === "DEPENDENCY_CHANGED").length,
      cacheHits: this.state.requests.filter((q) => q.reason === "UNCHANGED_DEPENDENCIES").length,
      cacheMisses: all.length,
      duplicateRequests: this.state.requests.filter((q) => q.reason === "DUPLICATE_REQUEST").length,
      completed: all.filter((w) => w.status === "COMPLETED").length,
      deferred: all.filter((w) => w.status === "DEFERRED").length,
      pending: p.length,
      cadence: this.cadence(),
      unrepresentedCadenceDue: this.cadence().reduce((n, row) => n + row.unrepresentedDue, 0),
      coalesced: this.state.requests.filter((q) => q.disposition === "COALESCED").length,
      skipped: this.state.requests.filter((q) => q.disposition === "SKIPPED").length,
      observationCountMeaning: "DISTINCT_REAL_P25_OBSERVATIONS_REFERENCED_NOT_NEW_PUBLICATIONS",
      admittedObservations: new Set(
        all.filter((w) => w.status === "COMPLETED").map((w) => w.observationId),
      ).size,
      byMode: counts("mode"),
      byInstrument: counts("instrumentId"),
      byTimeframe: counts("timeframe"),
      averageLogicalBacklogMs: delay.length ? delay.reduce((n, v) => n + v, 0) / delay.length : 0,
      maxLogicalBacklogMs: Math.max(0, ...delay),
      denominatorScope: "ACKNOWLEDGED_SCANNER_REQUESTS_ONLY",
      unrequestedFutureWork: "NOT_ESTABLISHED",
      historicalFactsNotCurrentAuthority: true,
      tradingAuthority: false,
    });
  }
  diagnostics() {
    let valid = false;
    try {
      this.gate();
      valid = true;
    } catch {
      /* Current owner/configuration validity is separate from recorded facts. */
    }
    const sourceBindings = [
      ...new Set(
        this.state.plan?.subscriptions.map((s) =>
          JSON.stringify([s.sessionId, s.universe, s.instrumentId]),
        ) ?? [],
      ),
    ];
    const sourcesReady = sourceBindings.every((key) => this.sourceChecks.get(key)?.ready === true);
    const obligations = this.state.work.filter(pending);
    return frozen({
      readiness:
        valid &&
        this.initialized &&
        !this.stopped &&
        !this.stopping &&
        !this.busy &&
        !this.uncertainty &&
        sourcesReady &&
        !obligations.length &&
        !this.cadencePending()
          ? "READY"
          : "NOT_READY",
      health:
        valid &&
        this.initialized &&
        !this.uncertainty &&
        sourcesReady &&
        !obligations.length &&
        !this.cadencePending()
          ? "HEALTHY"
          : "DEGRADED",
      phase: this.state.phase,
      phaseScope: "RECORDED_SCANNER_STATE_NOT_MOSE_LIFECYCLE",
      lifecycle: !this.initialized
        ? this.busy
          ? "INITIALIZING"
          : this.uncertainty
            ? "RECOVERY_REQUIRED"
            : "CREATED"
        : this.uncertainty
          ? this.busy
            ? "PUBLISHING"
            : "RECOVERY_REQUIRED"
          : this.stopped
            ? "STOPPED"
            : this.stopping
              ? "STOPPING"
              : this.state.phase,
      busy: this.busy,
      uncertainty: this.uncertainty,
      pending: obligations.length,
      unrepresentedCadenceDue: this.cadence().reduce((n, row) => n + row.unrepresentedDue, 0),
      sources: sourceBindings.map((key) => ({
        key,
        status: this.sourceChecks.get(key) ?? { ready: false, checkedAt: null },
      })),
      sourceHealthScope: "LAST_OWNER_CHECK_NOT_A_FUTURE_AVAILABILITY_GUARANTEE",
      totalRequests: this.state.requests.length,
      uniqueObligations: this.state.work.length,
      completed: this.state.work.filter((w) => w.status === "COMPLETED").length,
      coalesced: this.state.requests.filter((q) => q.disposition === "COALESCED").length,
      avoidedEvaluations: this.state.avoided,
      recoveredCacheNotAuthoritative: this.recovered,
      currentAuthenticatedCacheEntries: this.authenticatedCacheKeys.size,
      tradingAuthority: false,
      scope: "OFFLINE_RESEARCH_ONLY",
      checkpoint: this.history.at(-1)?.fingerprint ?? null,
      ownerCallsLastOperation: this.ownerCalls,
    });
  }
  async stop(): Promise<ScannerResult<void>> {
    if (this.stopped)
      return this.cadencePending() ? failure("CADENCE_OBLIGATIONS_UNRESOLVED") : success(undefined);
    if (this.busy) {
      this.stopping = true;
      return failure("PENDING_OPERATION", "UNKNOWN");
    }
    if (this.uncertainty) return failure("RECOVERY_REQUIRED", "UNKNOWN");
    if (!this.initialized) return failure("RUNTIME_NOT_READY");
    // A missing receipt must remain drainable through advance; do not install the
    // STOP fence until schedule accounting is complete.
    if (this.cadencePending()) return failure("CADENCE_OBLIGATIONS_UNRESOLVED");
    this.stopping = true;
    this.busy = true;
    try {
      const s = this.copy();
      if (s.work.some(pending)) return failure("PENDING_WORK");
      s.phase = "STOPPED";
      await this.save("scanner.stop", "STOP", null, s);
      this.stopped = true;
      return success(undefined);
    } catch (e) {
      return failure(err(e), this.uncertainty ? "UNKNOWN" : "NONE");
    } finally {
      this.busy = false;
    }
  }
}
