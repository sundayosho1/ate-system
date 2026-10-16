import { hash } from "@ate/multitimeframe";
import { types } from "node:util";
import { z } from "zod";
import {
  type EffectiveConfiguration,
  type ApprovalAuthorityResolver,
  configurationApprovalPolicyId,
} from "@ate/configuration";
import { type Clock, mustParseUtc } from "@ate/time";
import {
  stateDomain,
  stateOwner,
  persistenceId,
  type StateAuthorityRegistry,
} from "@ate/persistence";
import {
  certificateSchema,
  type InstrumentEligibility,
  type Context,
  type Assessment,
  type EvidencePorts,
} from "@ate/instrument-eligibility";
import {
  DeterministicReplaySequencer,
  validateReplayCheckpoint,
  verifyReplaySpecification,
  type ReplayCheckpoint,
  type ReplaySessionSpecification,
  type ReplayResolvedInputs,
} from "@ate/market-replay";
import {
  commandSchema,
  checkpointSchema,
  universeSchema,
  observationSchema,
  stateSchema,
  ok,
  reasons,
  code,
  type Policy,
  type Command,
  type Universe,
  type Session,
  type Plan,
  type Observation,
  type State,
  type Checkpoint,
  type Repository,
  type Result,
  type Source,
  type Reason,
} from "./contracts.js";
import {
  clone,
  freeze,
  fingerprint,
  failure,
  errorCode,
  withoutFingerprint,
  bytes,
  parseJSON,
  cloneHistory,
  retainedHistoryBytes,
} from "./primitives.js";
import {
  canonicalPlan,
  comparePlans,
  validateMemberState,
  creationFailureReason,
  classifyMember,
  unresolvedMember,
} from "./canonical.js";
import { validateTransition } from "./structural.js";
import { readPolicy } from "./configuration.js";
export type ReplayOwnerEvidence = Readonly<{
  specification: ReplaySessionSpecification;
  checkpoint: ReplayCheckpoint;
  inputs: ReplayResolvedInputs;
}>;
export interface MOSEPorts {
  clock: Clock;
  configuration: () => EffectiveConfiguration;
  authority: StateAuthorityRegistry;
  authorityResolver: ApprovalAuthorityResolver;
  datasets: Pick<EvidencePorts["datasets"], "getVersion">;
  quality: Pick<EvidencePorts["quality"], "getReport">;
  historical: Pick<EvidencePorts["historical"], "getManifest">;
  eligibility: Pick<InstrumentEligibility, "getEligibility">;
  replayEvidence: (sessionId: string, checkpoint: string) => ReplayOwnerEvidence | undefined;
  repository: Repository;
}
type Lifecycle =
  | "CREATED"
  | "INITIALIZING"
  | "READY"
  | "RUNNING"
  | "PAUSED"
  | "STOPPING"
  | "STOPPED"
  | "RECOVERY_REQUIRED"
  | "FAILED";
const ratio = (numerator: number, denominator: number | null) => ({
  numerator,
  denominator,
  status: denominator === null ? "UNAVAILABLE" : denominator === 0 ? "NOT_APPLICABLE" : "AVAILABLE",
  value: denominator === null || denominator === 0 ? null : numerator / denominator,
});
// Tuple encoding prevents one session/instrument pair from concealing another scope.
const sourceScope = (sessionId: string, instrumentId: string) =>
  JSON.stringify([sessionId, instrumentId]) + ":" + instrumentId;
export class MOSECoreRuntime {
  private lifecycle: Lifecycle = "CREATED";
  private busy = false;
  private checking = false;
  private stopRequested = false;
  private history: Checkpoint[] = [];
  private state: State = { sessions: [] };
  private policy: Policy | undefined;
  private configurationFingerprint = "";
  private obligation: { generation: number; fingerprint: string } | null = null;
  private lastError: string | null = null;
  private currentSources = new Map<string, boolean>();
  private clockIdentity = "";
  private configurationSnapshot = "";
  private readinessAxes = new Map<
    string,
    {
      dataSourceReady: boolean;
      eligibilityReady: boolean;
      universeAuthority: boolean;
      checkedAt: string;
      dataSourceReasons: Reason[];
    }
  >();
  // Immutable historical authentication is separate from fresh availability/permission axes.
  private readonly verifiedPlans = new Set<string>();
  private readonly pendingPlanVerification = new Map<string, Reason>();
  private refusedAPIAttempts = 0;
  private planScope(u: Universe, instrumentId: string) {
    return u.fingerprint + ":" + instrumentId;
  }
  private async verifyMember(u: Universe, m: Universe["members"][number]) {
    const scope = this.planScope(u, m.instrumentId);
    try {
      const source = await this.boundSource(
        m,
        u.plan.filter((p) => p.instrumentId === m.instrumentId),
      );
      this.verifiedPlans.add(scope);
      this.pendingPlanVerification.delete(scope);
      return source;
    } catch (e) {
      if (errorCode(e) === "CANONICAL_PLAN_MISMATCH") throw e;
      if (!this.verifiedPlans.has(scope)) {
        const reason = errorCode(e);
        this.pendingPlanVerification.set(
          scope,
          reason in reasons ? (reason as Reason) : "REPLAY_EVIDENCE_INVALID",
        );
      }
      throw e;
    }
  }
  private async requireVerified(u: Universe, m: Universe["members"][number]) {
    try {
      await this.verifyMember(u, m);
    } catch (e) {
      if (errorCode(e) === "CANONICAL_PLAN_MISMATCH") {
        const last = this.history.at(-1);
        this.obligation = last
          ? { generation: last.generation, fingerprint: last.fingerprint }
          : this.obligation;
        this.lifecycle = "RECOVERY_REQUIRED";
        throw e;
      }
      // Already authenticated immutable facts may support a rejected/deferred receipt;
      // a freshly recovered, unverified source cannot authorize a new publication.
      if (!this.verifiedPlans.has(this.planScope(u, m.instrumentId)))
        throw Error("CANONICAL_PLAN_UNVERIFIED", { cause: e });
    }
  }
  public constructor(
    public readonly runtimeId: string,
    private readonly ports: MOSEPorts,
  ) {
    code.parse(runtimeId);
  }
  private now() {
    return mustParseUtc(this.ports.clock.now());
  }
  private configuration() {
    if (this.checking) throw Error("CONFIGURATION_INVALID");
    this.checking = true;
    try {
      if (
        this.clockIdentity &&
        this.clockIdentity !==
          fingerprint({ mode: this.ports.clock.mode, provenance: this.ports.clock.provenance })
      )
        throw Error("CONFIGURATION_INVALID");
      const c = readPolicy(this.ports.configuration(), this.ports.clock),
        owner = this.ports.authority.require(stateDomain("mose.surveillance"));
      if (
        !owner.ok ||
        owner.value.owner !== stateOwner("mose.core") ||
        owner.value.writeAuthority !== "mose.core" ||
        owner.value.authorityType !== "DERIVED" ||
        !owner.value.durable ||
        !owner.value.historyRequired ||
        !owner.value.reconciliationRequired ||
        !owner.value.runtimeModes.includes("RESEARCH")
      )
        throw Error("UNIVERSE_NOT_AUTHORIZED");
      if (
        this.policy &&
        (c.snapshotId !== this.configurationSnapshot ||
          fingerprint(c.policy) !== fingerprint(this.policy) ||
          c.configurationFingerprint !== this.configurationFingerprint)
      )
        throw Error("CONFIGURATION_INVALID");
      return c;
    } finally {
      this.checking = false;
    }
  }
  private gate(allowDrain = false) {
    if (this.busy || this.checking) throw Error("OPERATION_IN_FLIGHT");
    if (
      !this.policy ||
      this.obligation ||
      ["CREATED", "INITIALIZING", "STOPPED", "FAILED", "RECOVERY_REQUIRED"].includes(
        this.lifecycle,
      ) ||
      (this.stopRequested && !allowDrain)
    )
      throw Error("RUNTIME_NOT_READY");
    if (this.history.length && this.now() < this.history.at(-1)!.at)
      throw Error("TEMPORAL_INCONSISTENCY");
    return this.configuration().policy;
  }
  private reject<T>(e: unknown, uncertain = false): Result<T> {
    this.lastError = errorCode(e);
    if (!uncertain) this.refusedAPIAttempts++;
    if (uncertain) this.lifecycle = "RECOVERY_REQUIRED";
    return failure(
      this.lastError,
      uncertain ? "UNKNOWN" : "NONE",
      fingerprint({
        runtimeId: this.runtimeId,
        generation: this.history.length + 1,
        error: this.lastError,
        attempt: this.refusedAPIAttempts,
      }),
    );
  }
  private session(state: State, id: string) {
    const s = state.sessions.find((s) => s.universe.sessionId === id);
    if (!s) throw Error("UNIVERSE_NOT_AUTHORIZED");
    return s;
  }
  private verifyUniverseAuthority(u: Universe): void {
    const before = this.now(),
      provenance = fingerprint(this.ports.clock.provenance);
    const r = this.ports.authorityResolver.resolve(u.checker, {
      classification: "STANDARD",
      requiredAuthority: "CONFIGURATION_CHECKER",
      runtimeMode: "RESEARCH",
      policyId: configurationApprovalPolicyId(this.policy!.approvalPolicyId),
    });
    if (!r.ok) {
      for (const m of u.members)
        this.currentSources.set(sourceScope(u.sessionId, m.instrumentId), false);
      throw Error("UNIVERSE_NOT_AUTHORIZED");
    }
    const c = certificateSchema.safeParse(clone(r.value, this.policy!.maxInputBytes));
    if (
      !c.success ||
      c.data.actorId !== u.checker.actorId ||
      c.data.checkedAt < before ||
      c.data.checkedAt > this.now() ||
      provenance !== fingerprint(this.ports.clock.provenance)
    ) {
      for (const m of u.members)
        this.currentSources.set(sourceScope(u.sessionId, m.instrumentId), false);
      throw Error("UNIVERSE_NOT_AUTHORIZED");
    }
  }
  private seedUnresolvedHealth(u: Universe, m: Universe["members"][number]) {
    const scope = sourceScope(u.sessionId, m.instrumentId);
    this.currentSources.set(scope, false);
    this.readinessAxes.set(scope, {
      dataSourceReady: false,
      eligibilityReady: false,
      universeAuthority: false,
      checkedAt: this.now(),
      dataSourceReasons: [...m.reasons],
    });
  }
  private async recheck(s: Session, m: Universe["members"][number]) {
    const classification = classifyMember(m);
    if (classification === "CONFIRMED_EXCLUSION") return;
    if (classification === "ELIGIBILITY_UNRESOLVED") {
      this.seedUnresolvedHealth(s.universe, m);
      return;
    }
    let dataSourceReady = false,
      eligibilityReady = false,
      universeAuthority = false;
    const dataSourceReasons: Reason[] = [];
    try {
      this.verifyUniverseAuthority(s.universe);
      universeAuthority = true;
    } catch {
      /* Recorded separately from data availability. */
    }
    try {
      const current = await this.ownerEligibility(m.instrumentId, m.context ?? undefined);
      eligibilityReady =
        current.current.replayReproducible && current.recorded.version === m.eligibilityVersion;
    } catch {
      /* No historical permission inference. */
    }
    try {
      if (classification === "ELIGIBLE_SOURCE_UNREADY") await this.deriveMemberSource(m, true);
      else await this.verifyMember(s.universe, m);
      dataSourceReady = true;
    } catch (e) {
      if (classification === "ELIGIBLE_SOURCE_READY" && errorCode(e) === "CANONICAL_PLAN_MISMATCH")
        throw e;
      const reason = errorCode(e);
      dataSourceReasons.push(reason in reasons ? (reason as Reason) : "REPLAY_EVIDENCE_INVALID");
    }
    const scope = sourceScope(s.universe.sessionId, m.instrumentId);
    this.readinessAxes.set(scope, {
      dataSourceReady,
      eligibilityReady,
      universeAuthority,
      checkedAt: this.now(),
      dataSourceReasons,
    });
    this.currentSources.set(scope, dataSourceReady && eligibilityReady && universeAuthority);
  }
  private async ownerEligibility(
    instrumentId: string,
    context?: Context,
    observe?: (a: Assessment) => void,
    confirmedExclusion?: () => void,
  ) {
    const r = await this.ports.eligibility.getEligibility(instrumentId);
    if (
      r.ok &&
      (r.value.current.evaluatedAt > this.now() || r.value.recorded.decisionAt > this.now())
    )
      throw Error("TEMPORAL_INCONSISTENCY");
    if (!r.ok) {
      if (r.error.code === "RECORD_NOT_FOUND") {
        confirmedExclusion?.();
        throw Error("INSTRUMENT_INELIGIBLE");
      }
      throw Error("SOURCE_UNAVAILABLE");
    }
    if (
      r.value.recorded.instrumentId !== instrumentId ||
      r.value.recorded.context.instrumentId !== instrumentId ||
      r.value.current.contextFingerprint !== fingerprint(r.value.recorded.context) ||
      r.value.current.fingerprint !== fingerprint(withoutFingerprint(r.value.current)) ||
      r.value.current.source !== r.value.recorded.stage
    )
      throw Error("REPLAY_EVIDENCE_INVALID");
    if (r.ok) observe?.(r.value.current);
    if (
      ["LIVE_ELIGIBLE", "ACTIVE"].includes(r.value.recorded.stage) ||
      !r.value.current.capabilities.find((c) => c.capability === this.policy!.capability)?.allowed
    ) {
      confirmedExclusion?.();
      throw Error("INSTRUMENT_INELIGIBLE");
    }
    if (context && fingerprint(context) !== fingerprint(r.value.recorded.context))
      throw Error("INSTRUMENT_INELIGIBLE");
    return r.value;
  }
  private async source(ref: Source) {
    const e = this.ports.replayEvidence(ref.sessionId, ref.checkpoint);
    if (!e) throw Error("SOURCE_UNAVAILABLE");
    if (e.checkpoint.logicalTime > this.now()) throw Error("REPLAY_EVIDENCE_INVALID");
    verifyReplaySpecification(e.specification);
    validateReplayCheckpoint(e.checkpoint, e.specification);
    if (
      e.specification.sessionId !== ref.sessionId ||
      e.checkpoint.fingerprint !== ref.checkpoint ||
      e.inputs.fingerprint !== e.checkpoint.inputFingerprint ||
      e.inputs.manifests.some((m) => m.kind !== "HISTORICAL")
    )
      throw Error("REPLAY_EVIDENCE_INVALID");
    if (e.inputs.manifests.reduce((n, m) => n + m.records.length, 0) > this.policy!.maxRetained)
      throw Error("RESOURCE_BUDGET_EXCEEDED");
    await e.inputs.verify();
    const seq = new DeterministicReplaySequencer(e.specification, e.inputs);
    if (
      !e.checkpoint.timestampComplete ||
      e.checkpoint.cursor !== seq.events.length ||
      e.checkpoint.state !== "COMPLETED"
    )
      throw Error("REPLAY_EVIDENCE_INVALID");
    return { e, events: seq.events };
  }
  private async binding(
    context: Context,
    origin: { originReference: string; originFingerprint: string },
  ) {
    const matches = [];
    for (const d of context.datasets) {
      const v = await this.ports.datasets.getVersion(
        d.versionId as Parameters<EvidencePorts["datasets"]["getVersion"]>[0],
      );
      if (
        !v.ok ||
        v.value.versionFingerprint !== d.versionFingerprint ||
        v.value.content.contentFingerprint !== d.contentFingerprint ||
        v.value.content.historicalDatasetId !== origin.originReference
      )
        continue;
      const q = await this.ports.quality.getReport(
        d.qualityReportId as Parameters<EvidencePorts["quality"]["getReport"]>[0],
      );
      const h = await this.ports.historical.getManifest(v.value.content.historicalDatasetId);
      if (
        !q.ok ||
        !h.ok ||
        q.value.reportFingerprint !== d.qualityFingerprint ||
        h.value.contentFingerprint !== d.contentFingerprint
      )
        continue;
      if (
        hash({ manifest: h.value, report: q.value, catalogueVersion: v.value }) ===
        origin.originFingerprint
      )
        matches.push({
          datasetId: h.value.datasetId,
          datasetVersion: d.versionId,
          datasetVersionFingerprint: d.versionFingerprint,
          datasetContentFingerprint: d.contentFingerprint,
          qualityReportId: d.qualityReportId,
          qualityFingerprint: d.qualityFingerprint,
        });
    }
    if (matches.length !== 1) throw Error("PROVENANCE_INCOMPLETE");
    return matches[0]!;
  }
  private async deriveMemberSource(member: Universe["members"][number], allowMissingInput = false) {
    const context = member.context;
    if (
      !context?.replay ||
      ![context.replay.leftSession, context.replay.rightSession].includes(
        member.source.sessionId,
      ) ||
      (member.source.sessionId === context.replay.leftSession
        ? context.replay.leftCheckpoint
        : context.replay.rightCheckpoint) !== member.source.checkpoint
    )
      throw Error("PROVENANCE_INCOMPLETE");
    const resolved = await this.source(member.source);
    if (
      !(allowMissingInput && member.inputFingerprint === null) &&
      resolved.e.inputs.fingerprint !== member.inputFingerprint
    )
      throw Error("CANONICAL_PLAN_MISMATCH");
    if (
      resolved.e.specification.replayMode === "EVENT_TIME_RECONSTRUCTION" &&
      !this.policy!.allowReconstruction
    )
      throw Error("CANONICAL_PLAN_MISMATCH");
    const bindings = new Map<string, Awaited<ReturnType<MOSECoreRuntime["binding"]>>>();
    for (const manifest of resolved.e.inputs.manifests)
      bindings.set(manifest.manifestId, await this.binding(context, manifest));
    const expected = canonicalPlan(
      member,
      context,
      resolved.events,
      resolved.e.specification.replayMode,
      bindings,
      this.policy!.maxRetained,
    );
    return { resolved, expected };
  }
  private async boundSource(member: Universe["members"][number], plans: readonly Plan[]) {
    const { resolved, expected } = await this.deriveMemberSource(member);
    if (member.expected !== expected.length || fingerprint(plans) !== fingerprint(expected))
      throw Error("CANONICAL_PLAN_MISMATCH");
    return resolved;
  }
  private async universe(a: Extract<Command, { kind: "CREATE" }>): Promise<Universe> {
    const p = this.policy!;
    const checkedAt = this.now(),
      provenance = fingerprint(this.ports.clock.provenance),
      authority = this.ports.authorityResolver.resolve(a.checker, {
        classification: "STANDARD",
        requiredAuthority: "CONFIGURATION_CHECKER",
        runtimeMode: "RESEARCH",
        policyId: configurationApprovalPolicyId(p.approvalPolicyId),
      });
    if (!authority.ok) throw Error("UNIVERSE_NOT_AUTHORIZED");
    const certificate = certificateSchema.parse(clone(authority.value, p.maxInputBytes));
    if (
      certificate.actorId !== a.checker.actorId ||
      certificate.checkedAt < checkedAt ||
      certificate.checkedAt > this.now() ||
      provenance !== fingerprint(this.ports.clock.provenance)
    )
      throw Error("UNIVERSE_NOT_AUTHORIZED");
    const members: Universe["members"] = [],
      plan: Plan[] = [];
    for (const request of [...a.instruments].sort((x, y) =>
      x.instrumentId < y.instrumentId ? -1 : 1,
    )) {
      let context: Context | null = null,
        eligibilityVersion: string | null = null,
        eligibilityAssessment: string | null = null,
        eligible = false,
        confirmedExclusion = false,
        sourceReady: boolean,
        inputFingerprint: string | null = null,
        expected: number | null;
      const codes: Reason[] = [];
      try {
        const r = await this.ownerEligibility(request.instrumentId, undefined, undefined, () => {
          confirmedExclusion = true;
        });
        context = r.recorded.context;
        eligible = true;
        eligibilityVersion = r.recorded.version;
        eligibilityAssessment = r.current.fingerprint;
        if (!r.current.replayReproducible) throw Error("PROVENANCE_INCOMPLETE");
        if (
          !context.replay ||
          ![context.replay.leftSession, context.replay.rightSession].includes(
            request.source.sessionId,
          ) ||
          (request.source.sessionId === context.replay.leftSession
            ? context.replay.leftCheckpoint
            : context.replay.rightCheckpoint) !== request.source.checkpoint
        )
          throw Error("PROVENANCE_INCOMPLETE");
        const source = await this.source(request.source);
        inputFingerprint = source.e.inputs.fingerprint;
        sourceReady = true;
        if (
          source.e.specification.replayMode === "EVENT_TIME_RECONSTRUCTION" &&
          !p.allowReconstruction
        )
          throw Error("TEMPORAL_INCONSISTENCY");
        expected = source.events.length;
        const bindings = new Map<string, Awaited<ReturnType<MOSECoreRuntime["binding"]>>>();
        for (const manifest of source.e.inputs.manifests)
          bindings.set(manifest.manifestId, await this.binding(context, manifest));
        for (const entry of canonicalPlan(
          request,
          context,
          source.events,
          source.e.specification.replayMode,
          bindings,
          p.maxRetained,
        ))
          plan.push(entry);
      } catch (e) {
        const label = errorCode(e);
        if (label === "RESOURCE_BUDGET_EXCEEDED") throw e;
        codes.push(
          creationFailureReason(
            eligible,
            label in reasons ? (label as Reason) : "REPLAY_EVIDENCE_INVALID",
            confirmedExclusion,
          ),
        );
        sourceReady = false;
        expected = null;
      }

      members.push({
        instrumentId: request.instrumentId,
        eligible,
        sourceReady,
        included: eligible && sourceReady && codes.length === 0,
        reasons: codes,
        context,
        eligibilityVersion,
        eligibilityAssessment,
        source: request.source,
        inputFingerprint,
        expected,
      });
    }
    const included = new Set(members.filter((m) => m.included).map((m) => m.instrumentId));
    const ordered = plan.filter((e) => included.has(e.instrumentId)).sort(comparePlans);
    if (
      ordered.length > p.maxRetained ||
      new Set(ordered.map((e) => e.key)).size !== ordered.length
    )
      throw Error("RESOURCE_BUDGET_EXCEEDED");
    for (const member of members)
      validateMemberState(
        member,
        ordered.filter((entry) => entry.instrumentId === member.instrumentId).length,
      );
    const body = {
      schemaVersion: 1 as const,
      sessionId: a.sessionId,
      previousUniverse: a.previousUniverse,
      configurationSnapshot: this.configurationSnapshot,
      configurationFingerprint: this.configurationFingerprint,
      policyFingerprint: fingerprint(p),
      createdAt: this.now(),
      effectiveAt: this.now(),
      policy: p,
      maker: a.maker,
      checker: a.checker,
      certificate,
      members,
      plan: ordered,
    };
    return freeze(universeSchema.parse({ ...body, fingerprint: fingerprint(body) }));
  }
  private async evaluate(
    s: Session,
    o: Observation,
    at: Observation["receivedAt"],
  ): Promise<Observation> {
    const member = s.universe.members.find((m) => m.instrumentId === o.instrumentId)!;
    let reason: Reason = "OBSERVED",
      outcome: Observation["outcome"] = "ADMITTED",
      assessment: string | null = null;
    let eligibilityReasons: string[] = [];
    let qualityReferences: string[] = [];
    let qualityDisposition: Observation["qualityDisposition"] = "UNKNOWN";
    try {
      this.verifyUniverseAuthority(s.universe);
      const eligibility = await this.ownerEligibility(
        o.instrumentId,
        member.context ?? undefined,
        (a) => {
          eligibilityReasons =
            a.capabilities.find((c) => c.capability === this.policy!.capability)?.reasons ?? [];
        },
      );
      if (!eligibility.current.replayReproducible) throw Error("PROVENANCE_INCOMPLETE");
      if (eligibility.recorded.version !== member.eligibilityVersion)
        throw Error("INSTRUMENT_INELIGIBLE");
      assessment = eligibility.current.fingerprint;
      const source = await this.boundSource(
        member,
        s.universe.plan.filter((p) => p.instrumentId === o.instrumentId),
      );
      const event = source.events.find((e) => e.eventId === o.plan.eventId)!;
      qualityReferences = event.record.input.quality
        ? [event.record.input.quality.reportFingerprint]
        : [];
      qualityDisposition = event.record.input.quality?.findings.some((f) =>
        ["ERROR", "CRITICAL"].includes(f.severity),
      )
        ? "FAILED"
        : "PRESERVED";
      if (o.plan.boundaryAt > at) {
        reason = "PROCESSING_DEFERRED";
        outcome = "DEFERRED";
      } else if (
        Date.parse(o.plan.boundaryAt) - Date.parse(o.plan.eventAt) >
        this.policy!.maxEvidenceAgeMs
      ) {
        reason = "DATA_STALE";
        outcome = "QUARANTINED";
      } else if (
        !event.record.input.quality ||
        event.record.input.quality.findings.some((f) => ["ERROR", "CRITICAL"].includes(f.severity))
      ) {
        reason = "DATA_QUALITY_FAILED";
        outcome = "QUARANTINED";
      } else if (this.policy!.requiredTimeframes.length) {
        const snapshot = source.e.checkpoint.snapshots
          .filter((snap) => snap.logicalTime <= o.plan.boundaryAt)
          .at(-1);
        if (
          !snapshot ||
          snapshot.aggregation.consistency !== "CONSISTENT" ||
          snapshot.aggregation.asOf > o.plan.boundaryAt ||
          snapshot.aggregation.cutoff > o.plan.boundaryAt ||
          this.policy!.requiredTimeframes.some((tf) => {
            const r = snapshot.aggregation.selected[tf];
            return (
              !r ||
              !r.final ||
              r.coverage !== "COMPLETE_COVERAGE" ||
              r.availableAt > o.plan.boundaryAt ||
              r.window.end > o.plan.boundaryAt
            );
          })
        ) {
          reason = "TEMPORAL_INCONSISTENCY";
          outcome = "DEFERRED";
        }
      }
      this.currentSources.set(sourceScope(s.universe.sessionId, o.instrumentId), true);
    } catch (e) {
      const c = errorCode(e);
      reason = c in reasons ? (c as Reason) : "REPLAY_EVIDENCE_INVALID";
      outcome = reason === "SOURCE_UNAVAILABLE" ? "DEFERRED" : "REJECTED";
      this.currentSources.set(sourceScope(s.universe.sessionId, o.instrumentId), false);
    }
    const body = {
      ...o,
      processingTime: at,
      qualityDisposition,
      qualityReferences,
      outcome,
      reason,
      reasonExplanation: reasons[reason],
      eligibilityAssessment: assessment,
      eligibilityReasons,
      funnelEvent: null,
    };
    return observationSchema.parse(
      outcome !== "ADMITTED"
        ? body
        : {
            ...body,
            funnelEvent: {
              schemaVersion: 1,
              eventId: fingerprint({ observation: o.observationId, stage: "OBSERVED" }),
              opportunityCorrelationId: o.observationId,
              observationId: o.observationId,
              instrumentId: o.instrumentId,
              stageOwner: "MOSE_CORE",
              previousStage: null,
              newStage: "OBSERVED",
              at,
              reason: "OBSERVED",
              sourceVersion: member.inputFingerprint,
              evidenceVersions: [o.plan.datasetVersionFingerprint, o.plan.qualityFingerprint],
              policyVersion: 1,
              policyFingerprint: s.universe.policyFingerprint,
              authorityReference: member.eligibilityVersion,
              evidenceReferences: [o.plan.payloadFingerprint, o.plan.manifestFingerprint],
              outcome: "RESEARCH_ONLY",
              auditTrace: o.auditCorrelationId,
            },
          },
    );
  }
  private replayDelta(previous: State, next: Checkpoint, priorCommand?: Command): void {
    validateTransition(previous, next.command, this.policy!, priorCommand);
    const a = next.command,
      p = this.policy!,
      expected = stateSchema.parse(clone(previous, p.maxCheckpointBytes));
    if (a.kind === "CREATE") {
      if (next.state.sessions.length !== previous.sessions.length + 1)
        throw Error("CHECKPOINT_INTEGRITY");
      const created = next.state.sessions.at(-1)!;
      if (
        created.universe.sessionId !== a.sessionId ||
        created.status !== "READY" ||
        created.cursor !== 0 ||
        created.observations.length ||
        created.universe.previousUniverse !== a.previousUniverse ||
        created.universe.createdAt !== next.at ||
        fingerprint(created.universe.maker) !== fingerprint(a.maker) ||
        fingerprint(created.universe.checker) !== fingerprint(a.checker) ||
        fingerprint(
          created.universe.members
            .map((m) => ({ instrumentId: m.instrumentId, source: m.source }))
            .sort((x, y) => (x.instrumentId < y.instrumentId ? -1 : 1)),
        ) !==
          fingerprint([...a.instruments].sort((x, y) => (x.instrumentId < y.instrumentId ? -1 : 1)))
      )
        throw Error("CHECKPOINT_INTEGRITY");
      expected.sessions.push(created);
    } else if (a.kind === "STOP") {
      for (const s of expected.sessions) s.status = "STOPPED";
    } else {
      const s = this.session(expected, a.sessionId),
        actual = this.session(next.state, a.sessionId);
      if (a.kind === "START") {
        s.status = "RUNNING";
      } else if (a.kind === "PAUSE") {
        s.status = "PAUSED";
      } else if (a.kind === "COMPLETE") s.status = "COMPLETED";
      else if (a.kind === "RECEIVE") {
        const o = actual.observations.at(-1),
          plan = s.universe.plan[s.cursor];
        if (
          !o ||
          !plan ||
          actual.observations.length !== s.observations.length + 1 ||
          o.plan.eventId !== a.eventId ||
          o.instrumentId !== a.instrumentId ||
          o.universeSnapshot !== a.universeSnapshot ||
          fingerprint(o.plan) !== fingerprint(plan) ||
          o.receivedAt !== next.at ||
          (o.processingTime !== null && o.processingTime !== next.at) ||
          o.funnelEvent !== null ||
          (o.processingTime === null
            ? o.outcome !== (s.status === "PAUSED" ? "DEFERRED" : "PENDING")
            : !(
                o.outcome === "REJECTED" ||
                (o.outcome === "DEFERRED" && o.reason === "SOURCE_UNAVAILABLE")
              )) ||
          o.auditCorrelationId !== fingerprint({ runtimeId: this.runtimeId, id: a.id })
        )
          throw Error("CHECKPOINT_INTEGRITY");
        s.observations.push(o);
        s.cursor++;
      } else if (a.kind === "PROCESS") {
        if (actual.observations.length !== s.observations.length)
          throw Error("CHECKPOINT_INTEGRITY");
        let count = 0;
        for (let i = 0; i < s.observations.length && count < a.limit; i++) {
          const old = s.observations[i]!;
          if (!["PENDING", "DEFERRED"].includes(old.outcome)) continue;
          const now = actual.observations[i]!;
          const immutable = (o: Observation) => ({
            observationId: o.observationId,
            sessionId: o.sessionId,
            universeSnapshot: o.universeSnapshot,
            instrumentId: o.instrumentId,
            plan: o.plan,
            sequence: o.sequence,
            receivedAt: o.receivedAt,
            auditCorrelationId: o.auditCorrelationId,
            researchClassification: o.researchClassification,
          });
          if (
            fingerprint(immutable(old)) !== fingerprint(immutable(now)) ||
            now.processingTime !== next.at ||
            now.outcome === "PENDING"
          )
            throw Error("CHECKPOINT_INTEGRITY");
          s.observations[i] = now;
          count++;
        }
      }
    }
    if (fingerprint(expected) !== fingerprint(next.state)) throw Error("CHECKPOINT_INTEGRITY");
  }

  private validateState(state: State, p: Policy, boundary: string) {
    if (
      state.sessions.reduce(
        (n, s) =>
          n + s.observations.filter((o) => ["PENDING", "DEFERRED"].includes(o.outcome)).length,
        0,
      ) > p.maxQueued ||
      state.sessions.length > p.maxSessions ||
      state.sessions.reduce((n, s) => n + s.observations.length, 0) > p.maxRetained
    )
      throw Error("RESOURCE_BUDGET_EXCEEDED");
    const all = new Set<string>();
    for (const s of state.sessions) {
      const u = s.universe;
      if (
        u.createdAt > boundary ||
        u.effectiveAt > boundary ||
        u.policyFingerprint !== fingerprint(u.policy) ||
        u.policyFingerprint !== fingerprint(p) ||
        u.configurationSnapshot !== this.configurationSnapshot ||
        u.configurationFingerprint !== this.configurationFingerprint ||
        u.maker.actorId === u.checker.actorId ||
        u.certificate.actorId !== u.checker.actorId ||
        u.certificate.checkedAt > u.createdAt
      )
        throw Error("CHECKPOINT_INTEGRITY");
      if (
        fingerprint(withoutFingerprint(u)) !== u.fingerprint ||
        new Set(u.members.map((m) => m.instrumentId)).size !== u.members.length ||
        u.members.some((m) => m.context !== null && m.context.instrumentId !== m.instrumentId) ||
        u.members.length > p.maxInstruments ||
        u.plan.length > p.maxRetained ||
        new Set(u.plan.map((x) => x.key)).size !== u.plan.length ||
        s.cursor !== s.observations.length ||
        s.cursor > u.plan.length ||
        s.observations.filter((o) => ["PENDING", "DEFERRED"].includes(o.outcome)).length >
          p.maxQueued
      )
        throw Error("CHECKPOINT_INTEGRITY");
      if (fingerprint(u.plan) !== fingerprint([...u.plan].sort(comparePlans)))
        throw Error("CANONICAL_PLAN_MISMATCH");
      for (const m of u.members) {
        const count = u.plan.filter((p) => p.instrumentId === m.instrumentId).length;
        validateMemberState(m, count);
        if (m.included) {
          const replay = m.context?.replay;
          if (
            !replay ||
            ![replay.leftSession, replay.rightSession].includes(m.source.sessionId) ||
            (m.source.sessionId === replay.leftSession
              ? replay.leftCheckpoint
              : replay.rightCheckpoint) !== m.source.checkpoint
          )
            throw Error("CANONICAL_PLAN_MISMATCH");
        }
      }
      for (const plan of u.plan) {
        const member = u.members.find((m) => m.instrumentId === plan.instrumentId);
        if (
          !member?.included ||
          !member.context ||
          fingerprint(member.source) !== fingerprint(plan.source) ||
          plan.key !==
            fingerprint({
              instrumentId: plan.instrumentId,
              source: plan.source,
              event: plan.eventId,
            }) ||
          !member.context.datasets.some(
            (d) =>
              d.versionId === plan.datasetVersion &&
              d.versionFingerprint === plan.datasetVersionFingerprint &&
              d.contentFingerprint === plan.datasetContentFingerprint &&
              d.qualityReportId === plan.qualityReportId &&
              d.qualityFingerprint === plan.qualityFingerprint,
          )
        )
          throw Error("CHECKPOINT_INTEGRITY");
      }
      if (all.has(u.sessionId)) throw Error("CHECKPOINT_INTEGRITY");
      all.add(u.sessionId);
      for (const [i, o] of s.observations.entries()) {
        if (
          o.receivedAt > boundary ||
          (o.processingTime !== null && o.processingTime > boundary) ||
          o.receivedAt < u.createdAt ||
          o.sequence !== i + 1 ||
          o.sessionId !== u.sessionId ||
          o.universeSnapshot !== u.fingerprint ||
          fingerprint(o.plan) !== fingerprint(u.plan[i]) ||
          o.observationId !==
            fingerprint({ sessionId: u.sessionId, universe: u.fingerprint, key: o.plan.key }) ||
          o.reasonExplanation !== reasons[o.reason] ||
          (o.outcome === "ADMITTED") !== (o.funnelEvent !== null) ||
          (o.outcome === "ADMITTED" &&
            (o.reason !== "OBSERVED" ||
              !o.eligibilityAssessment ||
              o.processingTime === null ||
              o.plan.boundaryAt > o.processingTime))
        )
          throw Error("CHECKPOINT_INTEGRITY");
      }
      for (const o of s.observations.filter((o) => o.outcome === "ADMITTED")) {
        const member = u.members.find((m) => m.instrumentId === o.instrumentId)!;
        const event = {
          schemaVersion: 1,
          eventId: fingerprint({ observation: o.observationId, stage: "OBSERVED" }),
          opportunityCorrelationId: o.observationId,
          observationId: o.observationId,
          instrumentId: o.instrumentId,
          stageOwner: "MOSE_CORE",
          previousStage: null,
          newStage: "OBSERVED",
          at: o.processingTime,
          reason: "OBSERVED",
          sourceVersion: member.inputFingerprint,
          evidenceVersions: [o.plan.datasetVersionFingerprint, o.plan.qualityFingerprint],
          policyVersion: 1,
          policyFingerprint: u.policyFingerprint,
          authorityReference: member.eligibilityVersion,
          evidenceReferences: [o.plan.payloadFingerprint, o.plan.manifestFingerprint],
          outcome: "RESEARCH_ONLY",
          auditTrace: o.auditCorrelationId,
        };
        if (
          fingerprint(event) !== fingerprint(o.funnelEvent) ||
          o.qualityDisposition !== "PRESERVED" ||
          !o.qualityReferences.includes(o.plan.qualityFingerprint)
        )
          throw Error("CHECKPOINT_INTEGRITY");
      }
      if (
        s.status === "COMPLETED" &&
        (s.cursor !== u.plan.length ||
          s.observations.some((o) => ["PENDING", "DEFERRED"].includes(o.outcome)) ||
          u.members.some((m) => m.eligible && !m.sourceReady))
      )
        throw Error("CHECKPOINT_INTEGRITY");
    }
  }
  public async initialize(): Promise<Result<void>> {
    if (this.busy || this.lifecycle !== "CREATED") return failure("RUNTIME_NOT_READY");
    this.busy = true;
    this.lifecycle = "INITIALIZING";
    try {
      const c = this.configuration();
      this.clockIdentity = fingerprint({
        mode: this.ports.clock.mode,
        provenance: this.ports.clock.provenance,
      });
      this.policy = c.policy;
      this.configurationFingerprint = c.configurationFingerprint;
      this.configurationSnapshot = c.snapshotId;
      this.obligation = { generation: 0, fingerprint: "RECOVERY_IN_FLIGHT" };
      const loaded = await this.ports.repository.load();
      if (!loaded.ok) throw Error("RECOVERY_REQUIRED");
      const raw = cloneHistory(
        loaded.value,
        Math.min(c.policy.maxRecoverySteps, c.policy.maxHistory),
        c.policy.maxCheckpointBytes,
        c.policy.maxRetainedBytes,
      );
      if (
        !Array.isArray(raw) ||
        raw.length > c.policy.maxRecoverySteps ||
        raw.length > c.policy.maxHistory
      )
        throw Error("RESOURCE_BUDGET_EXCEEDED");
      if (raw.length === 0) this.obligation = null;
      const history: Checkpoint[] = [];
      let retained = 0;
      for (const row of raw) {
        const s = checkpointSchema.parse(clone(row, c.policy.maxCheckpointBytes));
        retained += bytes(s);
        if (
          retained > c.policy.maxRetainedBytes ||
          s.runtimeId !== this.runtimeId ||
          s.generation !== history.length + 1 ||
          s.previous !== (history.at(-1)?.fingerprint ?? null) ||
          s.fingerprint !== fingerprint(withoutFingerprint(s)) ||
          s.configurationFingerprint !== c.configurationFingerprint ||
          s.policyFingerprint !== fingerprint(c.policy) ||
          s.at > this.now() ||
          s.at < (history.at(-1)?.at ?? s.at) ||
          history.some((x) => x.command.id === s.command.id)
        )
          throw Error("CHECKPOINT_INTEGRITY");
        clone(s.command, c.policy.maxInputBytes, c.policy.maxInputDepth);
        this.validateState(s.state, c.policy, s.at);
        this.replayDelta(history.at(-1)?.state ?? { sessions: [] }, s, history.at(-1)?.command);
        history.push(freeze(s));
      }
      const state = history.at(-1)?.state ?? { sessions: [] };
      for (const s of state.sessions)
        for (const m of s.universe.members) {
          if (unresolvedMember(m)) this.seedUnresolvedHealth(s.universe, m);
          else if (m.included) {
            this.pendingPlanVerification.set(
              this.planScope(s.universe, m.instrumentId),
              "CANONICAL_PLAN_UNVERIFIED",
            );
            await this.recheck(s, m);
          }
        }
      this.configuration();
      if (this.stopRequested) throw Error("STOP_REQUESTED");
      this.history = history;
      this.state = freeze(state);
      this.obligation = null;
      this.lifecycle = this.pendingPlanVerification.size ? "PAUSED" : "READY";
      return ok(undefined);
    } catch (e) {
      if (!this.obligation) {
        this.lifecycle = "FAILED";
        return this.reject(e);
      }
      return this.reject(e, true);
    } finally {
      this.busy = false;
    }
  }
  public async dispatch(raw: unknown): Promise<Result<Checkpoint>> {
    let acquired = false,
      attempted = false;
    try {
      const pendingKind =
        raw !== null && typeof raw === "object" && !types.isProxy(raw)
          ? Object.getOwnPropertyDescriptor(raw, "kind")
          : undefined;
      const drain =
        pendingKind &&
        "value" in pendingKind &&
        (pendingKind.value === "PROCESS" || pendingKind.value === "STOP");
      const p = this.gate(Boolean(drain));
      this.busy = true;
      acquired = true;
      const a = commandSchema.parse(clone(raw, p.maxInputBytes, p.maxInputDepth));
      const previous = this.history.find((c) => c.command.id === a.id);
      if (previous) {
        if (fingerprint(previous.command) !== fingerprint(a)) throw Error("IDEMPOTENCY_CONFLICT");
        return ok(previous);
      }
      // A recovered journal with unresolved semantic authentication is readable evidence,
      // not authority for any new publication (including no-op PROCESS, PAUSE or STOP).
      for (const s of this.state.sessions)
        for (const m of s.universe.members.filter((m) =>
          this.pendingPlanVerification.has(this.planScope(s.universe, m.instrumentId)),
        ))
          await this.requireVerified(s.universe, m);
      if (this.history.length >= Math.min(p.maxHistory, p.maxRecoverySteps))
        throw Error("RESOURCE_BUDGET_EXCEEDED");
      const at = this.now(),
        state = stateSchema.parse(clone(this.state, p.maxCheckpointBytes));
      validateTransition(state, a, p, this.history.at(-1)?.command);
      if (a.kind === "CREATE") {
        state.sessions.push({
          universe: await this.universe(a),
          status: "READY",
          cursor: 0,
          observations: [],
        });
      } else if (a.kind === "STOP") {
        for (const s of state.sessions) s.status = "STOPPED";
      } else {
        const s = this.session(state, a.sessionId);
        if (a.kind === "START") {
          this.verifyUniverseAuthority(s.universe);
          const included = s.universe.members.filter((m) => m.included);
          let eligible = 0;
          for (const m of included) {
            try {
              await this.requireVerified(s.universe, m);
              if (!this.verifiedPlans.has(this.planScope(s.universe, m.instrumentId)))
                throw Error("CANONICAL_PLAN_UNVERIFIED");
              const current = await this.ownerEligibility(m.instrumentId, m.context ?? undefined);
              if (
                current.current.replayReproducible &&
                current.recorded.version === m.eligibilityVersion
              )
                eligible++;
            } catch (e) {
              if (errorCode(e) === "CANONICAL_PLAN_MISMATCH") throw e;
              /* Instrument-local exclusion; another eligible instrument can proceed. */
            }
          }
          if (included.length && !eligible) throw Error("INSTRUMENT_INELIGIBLE");
          s.status = "RUNNING";
        } else if (a.kind === "PAUSE") {
          s.status = "PAUSED";
        } else if (a.kind === "COMPLETE") {
          if (s.universe.members.some(unresolvedMember)) throw Error("PROCESSING_DEFERRED");
          for (const m of s.universe.members.filter((m) => m.included)) {
            await this.requireVerified(s.universe, m);
            if (!this.verifiedPlans.has(this.planScope(s.universe, m.instrumentId)))
              throw Error("CANONICAL_PLAN_UNVERIFIED");
          }
          s.status = "COMPLETED";
        } else if (a.kind === "RECEIVE") {
          this.verifyUniverseAuthority(s.universe);
          const next = s.universe.plan[s.cursor]!;
          const id = fingerprint({
            sessionId: a.sessionId,
            universe: s.universe.fingerprint,
            key: next.key,
          });
          let reason: Reason = s.status === "PAUSED" ? "PROCESSING_DEFERRED" : "UNKNOWN_EVIDENCE",
            outcome: Observation["outcome"] = s.status === "PAUSED" ? "DEFERRED" : "PENDING",
            processingTime: Observation["processingTime"] = null,
            eligibilityAssessment: string | null = null,
            eligibilityReasons: string[] = [];
          const member = s.universe.members.find((m) => m.instrumentId === a.instrumentId)!;
          await this.requireVerified(s.universe, member);
          try {
            const current = await this.ownerEligibility(
              a.instrumentId,
              member.context ?? undefined,
              (c) => {
                eligibilityReasons =
                  c.capabilities.find((x) => x.capability === p.capability)?.reasons ?? [];
              },
            );
            eligibilityAssessment = current.current.fingerprint;
            if (current.recorded.version !== member.eligibilityVersion)
              throw Error("INSTRUMENT_INELIGIBLE");
            if (!current.current.replayReproducible) throw Error("PROVENANCE_INCOMPLETE");
          } catch (e) {
            const c = errorCode(e);
            reason = c in reasons ? (c as Reason) : "UNKNOWN_EVIDENCE";
            outcome = reason === "SOURCE_UNAVAILABLE" ? "DEFERRED" : "REJECTED";
            this.currentSources.set(sourceScope(s.universe.sessionId, a.instrumentId), false);
            processingTime = at;
          }

          s.observations.push({
            schemaVersion: 1,
            observationId: id,
            sessionId: a.sessionId,
            universeSnapshot: s.universe.fingerprint,
            instrumentId: a.instrumentId,
            plan: next,
            sequence: s.cursor + 1,
            receivedAt: at,
            processingTime,
            researchClassification: "OFFLINE_OBSERVATION",
            qualityDisposition: "NOT_EVALUATED",
            qualityReferences: [],
            outcome,
            reason,
            reasonExplanation: reasons[reason],
            auditCorrelationId: fingerprint({ runtimeId: this.runtimeId, id: a.id }),
            eligibilityAssessment,
            eligibilityReasons,
            funnelEvent: null,
          });
          s.cursor++;
        } else if (a.kind === "PROCESS") {
          if (s.status === "PAUSED" && !this.stopRequested) throw Error("RESOURCE_BUDGET_EXCEEDED");
          let n = 0;
          for (let i = 0; i < s.observations.length && n < a.limit; i++) {
            const o = s.observations[i]!;
            if (!["PENDING", "DEFERRED"].includes(o.outcome)) continue;
            await this.requireVerified(
              s.universe,
              s.universe.members.find((m) => m.instrumentId === o.instrumentId)!,
            );
            s.observations[i] = await this.evaluate(s, o, at);
            n++;
          }
        }
      }
      this.configuration();
      if (this.now() !== at) throw Error("TEMPORAL_INCONSISTENCY");
      if (this.stopRequested && a.kind !== "PROCESS" && a.kind !== "STOP")
        throw Error("RUNTIME_NOT_READY");
      this.validateState(state, p, at);
      const body = {
        schemaVersion: 1 as const,
        runtimeId: this.runtimeId,
        generation: this.history.length + 1,
        previous: this.history.at(-1)?.fingerprint ?? null,
        at,
        clock: this.ports.clock.provenance,
        configurationFingerprint: this.configurationFingerprint,
        policyFingerprint: fingerprint(p),
        command: a,
        state,
      };
      const next = freeze(checkpointSchema.parse({ ...body, fingerprint: fingerprint(body) }));
      if (
        bytes(next) > p.maxCheckpointBytes ||
        retainedHistoryBytes(this.history) + bytes(next) > p.maxRetainedBytes
      )
        throw Error("RESOURCE_BUDGET_EXCEEDED");
      this.replayDelta(this.state, next, this.history.at(-1)?.command);
      const mutation = this.ports.authority.validateMutation({
        stateId: persistenceId(
          fingerprint({ runtimeId: this.runtimeId, generation: next.generation }),
        ),
        stateDomain: stateDomain("mose.surveillance"),
        owner: stateOwner("mose.core"),
        runtimeMode: "RESEARCH",
        reason: "Governed offline surveillance checkpoint",
        actor: { actorType: "SYSTEM" },
        transition: a.kind,
        payload: next,
      });
      if (!mutation.ok) throw Error("UNIVERSE_NOT_AUTHORIZED");
      this.obligation = { generation: next.generation, fingerprint: next.fingerprint };
      attempted = true;
      const response = await this.ports.repository.commit(next);
      const ack = z
        .union([
          z.object({ ok: z.literal(true), value: checkpointSchema }).strict(),
          z
            .object({
              ok: z.literal(false),
              error: z
                .object({
                  code: z.string(),
                  commitment: z.enum(["NONE", "UNKNOWN"]),
                  auditCorrelationId: z.string(),
                })
                .strict(),
            })
            .strict(),
        ])
        .parse(clone(response, p.maxCheckpointBytes + 1024));
      if (!ack.ok) {
        if (ack.error.commitment === "NONE") {
          this.obligation = null;
          attempted = false;
          this.refusedAPIAttempts++;
          return failure(ack.error.code, "NONE", ack.error.auditCorrelationId);
        }
        throw Error("COMMITMENT_UNKNOWN");
      }
      if (fingerprint(ack.value) !== fingerprint(next)) throw Error("ACK_MISMATCH");
      this.history.push(next);
      this.state = next.state;
      if (a.kind === "CREATE") {
        const u = next.state.sessions.at(-1)!.universe;
        for (const m of u.members) {
          if (m.included) {
            this.verifiedPlans.add(this.planScope(u, m.instrumentId));
            this.currentSources.set(sourceScope(u.sessionId, m.instrumentId), true);
          } else if (unresolvedMember(m)) this.seedUnresolvedHealth(u, m);
        }
      }
      this.obligation = null;
      attempted = false;
      this.lifecycle =
        a.kind === "STOP"
          ? "STOPPED"
          : this.stopRequested
            ? "STOPPING"
            : this.state.sessions.some((s) => s.status === "RUNNING")
              ? "RUNNING"
              : this.state.sessions.some((s) => s.status === "PAUSED")
                ? "PAUSED"
                : "READY";
      return ok(next);
    } catch (e) {
      return this.reject(e, attempted);
    } finally {
      if (acquired) this.busy = false;
    }
  }
  public dispatchJson(raw: unknown): Promise<Result<Checkpoint>> {
    try {
      const p = this.gate();
      return this.dispatch(parseJSON(raw, p.maxInputBytes));
    } catch (e) {
      return Promise.resolve(this.reject(e));
    }
  }
  public async stop(): Promise<Result<void>> {
    await Promise.resolve();
    if (this.checking) return failure("OPERATION_IN_FLIGHT");
    this.stopRequested = true;
    if (this.busy) return failure("OPERATION_IN_FLIGHT", this.obligation ? "UNKNOWN" : "NONE");
    if (this.obligation || this.lifecycle === "RECOVERY_REQUIRED")
      return failure("RECOVERY_REQUIRED", "UNKNOWN");
    if (this.pendingPlanVerification.size) return failure("CANONICAL_PLAN_UNVERIFIED");
    if (
      this.state.sessions.some((s) =>
        s.observations.some((o) => ["PENDING", "DEFERRED"].includes(o.outcome)),
      )
    ) {
      this.lifecycle = "STOPPING";
      return failure(
        "PROCESSING_DEFERRED",
        "NONE",
        fingerprint({
          runtimeId: this.runtimeId,
          history: this.history.length,
          kind: "shutdown-pending-work",
        }),
      );
    }
    this.lifecycle = "STOPPED";
    return ok(undefined);
  }
  public diagnostics() {
    let valid = false;
    try {
      this.configuration();
      valid = true;
    } catch {
      /* Declared in health. */
    }
    const pending = this.state.sessions.reduce(
      (n, s) =>
        n + s.observations.filter((o) => ["PENDING", "DEFERRED"].includes(o.outcome)).length,
      0,
    );
    return freeze({
      lifecycle: this.lifecycle,
      readiness:
        valid &&
        !this.busy &&
        !this.obligation &&
        !this.stopRequested &&
        this.pendingPlanVerification.size === 0 &&
        ["READY", "RUNNING", "PAUSED"].includes(this.lifecycle)
          ? "READY"
          : "NOT_READY",
      health:
        valid &&
        !this.obligation &&
        ["READY", "RUNNING", "PAUSED"].includes(this.lifecycle) &&
        ![...this.currentSources.values()].includes(false)
          ? "HEALTHY"
          : "DEGRADED",
      researchOnly: true,
      tradingAuthority: false,
      memberClassifications: this.state.sessions.flatMap((s) =>
        s.universe.members.map((m) => ({
          sessionId: s.universe.sessionId,
          instrumentId: m.instrumentId,
          classification: classifyMember(m),
        })),
      ),
      sessions: this.state.sessions.map((s) => ({
        sessionId: s.universe.sessionId,
        status: s.status,
        eligibleUniverseSize: s.universe.members.filter((m) => m.included).length,
      })),
      lastAcceptedEventTime:
        this.state.sessions
          .flatMap((s) => s.observations)
          .filter((o) => o.outcome === "ADMITTED")
          .map((o) => o.plan.eventAt)
          .sort()
          .at(-1) ?? null,
      lastProcessingTime:
        this.state.sessions
          .flatMap((s) => s.observations)
          .map((o) => o.processingTime)
          .filter((t): t is NonNullable<typeof t> => t !== null)
          .sort()
          .at(-1) ?? null,
      quarantinedObservations: this.state.sessions.reduce(
        (n, s) => n + s.observations.filter((o) => o.outcome === "QUARANTINED").length,
        0,
      ),
      temporalIntegrity: this.state.sessions.some((s) =>
        s.observations.some((o) => o.reason === "TEMPORAL_INCONSISTENCY"),
      )
        ? "DEFERRED_OR_REJECTED"
        : "NO_DETECTED_VIOLATION",
      refusedAPIAttempts: this.refusedAPIAttempts,
      refusedAttemptsScope: "RETURNED_NONCOMMITTING_API_REFUSALS_NOT_DURABLE_LOGICAL_RECEIPTS",
      pendingObservations: pending,
      pendingAcknowledgments: this.obligation ? 1 : 0,
      recoveryObligation: this.obligation,
      canonicalVerificationObligations: [...this.pendingPlanVerification].map(
        ([scope, reason]) => ({ scope, reason }),
      ),
      history: this.history.length,
      lastError: this.lastError,
      sourceReadiness: [...this.currentSources].map(([scope, ready]) => ({ scope, ready })),
      sourceReadinessAxes: [...this.readinessAxes].map(([scope, axes]) => ({ scope, ...axes })),
      sourceReadinessMeaning: "LAST_OWNER_CHECK_NOT_A_FUTURE_AVAILABILITY_GUARANTEE",
    });
  }
  public getUniverse(raw: unknown): Result<Universe> {
    try {
      const p = this.gate();
      return ok(
        this.session(this.state, code.parse(clone(raw, p.maxInputBytes, p.maxInputDepth))).universe,
      );
    } catch (e) {
      return this.reject(e);
    }
  }
  public getSessionSummary(raw: unknown): Result<ReturnType<MOSECoreRuntime["coverage"]>> {
    try {
      const p = this.gate();
      return ok(
        freeze(
          this.coverage(
            this.session(this.state, code.parse(clone(raw, p.maxInputBytes, p.maxInputDepth))),
          ),
        ),
      );
    } catch (e) {
      return this.reject(e);
    }
  }
  public async health(): Promise<Result<ReturnType<MOSECoreRuntime["diagnostics"]>>> {
    let acquired = false;
    try {
      this.gate();
      this.busy = true;
      acquired = true;
      for (const s of this.state.sessions)
        for (const m of s.universe.members) await this.recheck(s, m);
      this.configuration();
      this.busy = false;
      acquired = false;
      return ok(this.diagnostics());
    } catch (e) {
      if (errorCode(e) === "CANONICAL_PLAN_MISMATCH") {
        const last = this.history.at(-1);
        if (last) this.obligation = { generation: last.generation, fingerprint: last.fingerprint };
        return this.reject(e, true);
      }
      return this.reject(e);
    } finally {
      if (acquired) this.busy = false;
    }
  }
  public query(raw: unknown): Result<ResearchReadEnvelope> {
    try {
      const p = this.gate();
      const q = z
        .object({
          sessionId: code,
          kind: z.enum([
            "SUMMARY",
            "UNIVERSE",
            "OBSERVATIONS",
            "PENDING",
            "REASONS",
            "HISTORY",
            "SOURCE_QUALITY",
            "INCLUSION",
          ]),
          offset: z.number().int().min(0).max(10000),
          limit: z.number().int().min(1).max(100),
          asOf: z.string().nullable(),
        })
        .strict()
        .parse(clone(raw, p.maxInputBytes, p.maxInputDepth));
      const asOf = q.asOf === null ? this.now() : mustParseUtc(q.asOf);
      if (asOf > this.now()) throw Error("TEMPORAL_INCONSISTENCY");
      const history = this.history.filter((c) => c.at <= asOf),
        state = history.at(-1)?.state ?? { sessions: [] },
        s = this.session(state, q.sessionId);
      let value: ResearchReadEnvelope["value"];
      if (q.kind === "UNIVERSE") value = s.universe;
      else if (q.kind === "SUMMARY") value = this.coverage(s);
      else {
        const rows =
          q.kind === "INCLUSION"
            ? s.universe.members
            : q.kind === "SOURCE_QUALITY"
              ? s.universe.members.map((m) => ({
                  instrumentId: m.instrumentId,
                  included: m.included,
                  sourceReadyAtPublication: m.sourceReady,
                  qualityReferences:
                    m.context?.datasets.map((d) => ({
                      reportId: d.qualityReportId,
                      fingerprint: d.qualityFingerprint,
                    })) ?? [],
                  rejections: s.observations
                    .filter((o) => o.instrumentId === m.instrumentId && o.outcome !== "ADMITTED")
                    .map((o) => ({
                      observationId: o.observationId,
                      reason: o.reason,
                      ownerReasons: o.eligibilityReasons,
                    })),
                }))
              : q.kind === "OBSERVATIONS"
                ? s.observations
                : q.kind === "PENDING"
                  ? s.observations.filter((o) => ["PENDING", "DEFERRED"].includes(o.outcome))
                  : q.kind === "REASONS"
                    ? Object.entries(reasons).map(([reason, explanation]) => ({
                        reason,
                        explanation,
                        count: s.observations.filter((o) => o.reason === reason).length,
                      }))
                    : history.filter(
                        (c) => "sessionId" in c.command && c.command.sessionId === q.sessionId,
                      );
        value = {
          records: rows.slice(q.offset, q.offset + q.limit),
          total: rows.length,
          nextOffset: q.offset + q.limit < rows.length ? q.offset + q.limit : null,
        };
      }
      const response: ResearchReadEnvelope = {
        kind: q.kind,
        scope: q.asOf === null ? "LATEST_RECORDED_FACTS" : "RECORDED_AS_OF",
        asOf,
        value,
        currentAuthorityNotEstablishedByHistoricalQuery: true,
      };
      if (bytes(response) > p.maxCheckpointBytes) throw Error("RESOURCE_BUDGET_EXCEEDED");
      return ok(freeze(response));
    } catch (e) {
      return this.reject(e);
    }
  }
  private coverage(s: Session) {
    const outcomes = s.observations,
      completed = outcomes.filter((o) =>
        ["ADMITTED", "REJECTED", "QUARANTINED"].includes(o.outcome),
      ).length,
      verificationPending = s.universe.members.some(
        (m) => m.included && !this.verifiedPlans.has(this.planScope(s.universe, m.instrumentId)),
      ),
      expected = s.universe.members
        .filter((m) => m.included)
        .reduce((n, m) => n + (m.expected ?? 0), 0),
      unknown = verificationPending || s.universe.members.some(unresolvedMember),
      admitted = outcomes.filter((o) => o.outcome === "ADMITTED").length;
    return {
      eligibilityScope: "UNIVERSE_PUBLICATION_NOT_CURRENT_AUTHORITY",
      sessionStatus: s.status,
      configured: s.universe.members.length,
      eligible: s.universe.members.filter((m) => m.eligible).length,
      excluded: s.universe.members.filter((m) => classifyMember(m) === "CONFIRMED_EXCLUSION")
        .length,
      unresolvedEligibility: s.universe.members.filter(
        (m) => classifyMember(m) === "ELIGIBILITY_UNRESOLVED",
      ).length,
      notIncluded: s.universe.members.filter((m) => !m.included).length,
      scheduled: new Set(s.universe.plan.map((e) => e.instrumentId)).size,
      observed: new Set(outcomes.filter((o) => o.outcome === "ADMITTED").map((o) => o.instrumentId))
        .size,
      received: outcomes.length,
      admitted,
      rejected: outcomes.filter((o) => o.outcome === "REJECTED").length,
      quarantined: outcomes.filter((o) => o.outcome === "QUARANTINED").length,
      deferred: outcomes.filter((o) => o.outcome === "DEFERRED").length,
      pending: outcomes.filter((o) => ["PENDING", "DEFERRED"].includes(o.outcome)).length,
      unreceived: s.universe.plan.length - s.cursor,
      unresolvedSources: s.universe.members.filter(unresolvedMember).length,
      canonicalVerification: unknown ? "UNVERIFIED" : "VERIFIED",
      expectedObligations: unknown ? null : expected,
      coverageComplete: !unknown && completed === expected,
      eligibilityCoverage: ratio(
        s.universe.members.filter((m) => m.eligible).length,
        s.universe.members.length,
      ),
      completionCoverage: ratio(completed, unknown ? null : expected),
      evidenceQualificationCoverage: ratio(admitted, completed),
      counterSemantics:
        "Durable unique receipts only; deferred is a subset of pending; API refusals are returned with audit correlation and never fabricate a receipt or denominator.",
    };
  }
}

export type CoverageSummary = Extract<
  ReturnType<MOSECoreRuntime["getSessionSummary"]>,
  { ok: true }
>["value"];
export type ReasonSummary = Readonly<{ reason: string; explanation: string; count: number }>;
export type SourceQualitySummary = Readonly<{
  instrumentId: string;
  included: boolean;
  sourceReadyAtPublication: boolean;
  qualityReferences: readonly Readonly<{ reportId: string; fingerprint: string }>[];
  rejections: readonly Readonly<{
    observationId: string;
    reason: Reason;
    ownerReasons: readonly string[];
  }>[];
}>;
export type ResearchReadEnvelope = Readonly<{
  kind:
    | "SUMMARY"
    | "UNIVERSE"
    | "OBSERVATIONS"
    | "PENDING"
    | "REASONS"
    | "HISTORY"
    | "SOURCE_QUALITY"
    | "INCLUSION";
  scope: "LATEST_RECORDED_FACTS" | "RECORDED_AS_OF";
  asOf: string;
  currentAuthorityNotEstablishedByHistoricalQuery: true;
  value:
    | Universe
    | CoverageSummary
    | Readonly<{
        records: readonly (
          | Observation
          | Checkpoint
          | Universe["members"][number]
          | ReasonSummary
          | SourceQualitySummary
        )[];
        total: number;
        nextOffset: number | null;
      }>;
}>;
