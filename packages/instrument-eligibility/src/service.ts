import { z } from "zod";
import {
  fingerprint,
  configurationApprovalPolicyId,
  type EffectiveConfiguration,
} from "@ate/configuration";
import { type Actor, schemas } from "@ate/domain";
import { freeze } from "@ate/multitimeframe";
import { mustParseUtc } from "@ate/time";
import {
  stateDomain,
  stateOwner,
  persistenceId,
  type StateAuthorityRegistry,
} from "@ate/persistence";
import {
  actionSchema,
  attestationSchema,
  snapshotSchema,
  certificateSchema,
  code,
  clockSchema,
  digest,
  ok,
  fail,
  stages,
  type Action,
  type Assessment,
  type Context,
  type Policy,
  type RecordState,
  type Repository,
  type Result,
  type Snapshot,
  type Certificate,
  type Stage,
} from "./contracts.js";
import { assess, type EvidencePorts, type AttestationState } from "./evidence.js";
import { policyFromEffective } from "./policy.js";
import { safeClone, parseJson, errorLabel } from "./boundary.js";
export interface EligibilityPorts extends EvidencePorts {
  configuration(): EffectiveConfiguration;
  authority: StateAuthorityRegistry;
  repository: Repository;
}
const size = (v: unknown) => Buffer.byteLength(JSON.stringify(v));
const identity = (v: { fingerprint: string }) => {
  const { fingerprint: ignored, ...body } = v;
  void ignored;
  return fingerprint(body);
};
export class InstrumentEligibility {
  private lifecycle: "CREATED" | "READY" | "RECOVERY_REQUIRED" | "FAILED" | "STOPPED" = "CREATED";
  private busy = false;
  private checking = false;
  private stopRequested = false;
  private history: Snapshot[] = [];
  private policy: Policy | undefined;
  private configurationFingerprint = "";
  private obligation: { generation: number; fingerprint: string } | null = null;
  private lastError: string | null = null;
  public constructor(
    private readonly serviceId: string,
    private readonly ports: EligibilityPorts,
  ) {
    code.parse(serviceId);
  }
  private configuration() {
    if (this.checking) throw Error("REENTRANT_CONFIGURATION");
    this.checking = true;
    try {
      const c = policyFromEffective(this.ports.configuration());
      digest.parse(c.configurationFingerprint);
      const entry = this.ports.authority.require(stateDomain("instrument.eligibility"));
      if (
        !entry.ok ||
        entry.value.owner !== stateOwner("instrument.eligibility") ||
        entry.value.writeAuthority !== "instrument.eligibility" ||
        entry.value.authorityType !== "DERIVED" ||
        !entry.value.durable ||
        !entry.value.historyRequired ||
        !entry.value.reconciliationRequired ||
        !entry.value.runtimeModes.includes("RESEARCH")
      )
        throw Error("STATE_AUTHORITY_REQUIRED");
      if (this.policy && fingerprint(c.policy) !== fingerprint(this.policy))
        throw Error("POLICY_INCOMPATIBLE");
      if (
        this.configurationFingerprint &&
        c.configurationFingerprint !== this.configurationFingerprint
      )
        throw Error("CONFIGURATION_CHANGED");
      return c;
    } finally {
      this.checking = false;
    }
  }
  private gate() {
    if (this.busy || this.checking) throw Error("BUSY");
    if (this.lifecycle !== "READY" || this.stopRequested) throw Error("NOT_READY");
    return this.configuration().policy;
  }
  private reject<T>(e: unknown, unknown = false): Result<T> {
    const s = errorLabel(e);
    this.lastError = /^[A-Z][A-Z0-9_]{0,127}$/.test(s) ? s : "INVALID_INPUT_OR_CALLBACK";
    if (unknown) this.lifecycle = "RECOVERY_REQUIRED";
    return fail(this.lastError, unknown ? "UNKNOWN" : "NONE");
  }
  private now() {
    return mustParseUtc(this.ports.clock.now());
  }
  public diagnostics() {
    let valid = false;
    try {
      this.configuration();
      valid = true;
    } catch {
      /* Failure is exposed below. */
    }
    return freeze({
      lifecycle: this.lifecycle,
      readiness:
        this.lifecycle === "READY" && !this.busy && !this.obligation && valid && !this.stopRequested
          ? "READY"
          : "NOT_READY",
      health: this.lifecycle === "READY" && !this.obligation && valid ? "HEALTHY" : "DEGRADED",
      history: this.history.length,
      records: this.records().size,
      pending: this.obligation,
      publicationSummary: "VOLATILE_NOT_DURABLE_ACK",
      lastError: this.lastError,
      researchOnly: true,
      tradingAuthority: false,
    });
  }
  private records(history: readonly Snapshot[] = this.history) {
    const rows = new Map<string, RecordState>();
    for (const s of history) {
      const a = s.action;
      if (a.kind === "DISCOVER")
        rows.set(
          a.instrumentId,
          freeze({
            instrumentId: a.instrumentId,
            stage: "DISCOVERED",
            disposition: "NONE",
            context: a.context,
            version: s.fingerprint,
            effectiveAt: a.effectiveAt,
            decisionAt: s.publishedAt,
            approval: null,
            previous: null,
          }),
        );
      else if (a.kind === "COMMIT") {
        const req = history.find((x) => x.action.kind === "REQUEST" && x.action.id === a.requestId);
        if (!req || req.action.kind !== "REQUEST") throw Error("REQUEST_NOT_FOUND");
        const r = req.action,
          old = rows.get(r.instrumentId);
        if (!old) throw Error("RECORD_NOT_FOUND");
        rows.set(
          r.instrumentId,
          freeze({
            instrumentId: r.instrumentId,
            stage: r.destination,
            disposition: r.disposition ?? "NONE",
            context: r.context,
            version: s.fingerprint,
            effectiveAt: r.effectiveAt,
            decisionAt: s.publishedAt,
            approval: a.approvalId,
            previous: old.version,
          }),
        );
      }
    }
    return rows;
  }
  private attestations(history: readonly Snapshot[] = this.history): AttestationState[] {
    const map = new Map<string, AttestationState>();
    for (const s of history) {
      const a = s.action;
      if (a.kind === "ATTEST")
        map.set(a.attestation.fingerprint, {
          declaration: a.attestation,
          status: a.attestation.status,
          verified: true,
        });
      else if (a.kind === "ATTEST_STATUS") {
        const prior = map.get(a.attestation);
        if (!prior) throw Error("ATTESTATION_NOT_FOUND");
        map.set(a.attestation, { ...prior, status: a.status });
      }
    }
    return [...map.values()];
  }
  private certificate(actor: Actor, p: Policy): Certificate {
    if (!actor.actorId) throw Error("ACTOR_ID_REQUIRED");
    const before = this.now(),
      provenance = fingerprint(clockSchema.parse(safeClone(this.ports.clock.provenance)));
    const r = this.ports.authorityResolver.resolve(actor, {
      classification: "STANDARD",
      requiredAuthority: "CONFIGURATION_CHECKER",
      runtimeMode: "RESEARCH",
      policyId: configurationApprovalPolicyId(p.approvalPolicyId),
    });
    if (!r.ok) throw Error("APPROVAL_AUTHORITY_REQUIRED");
    const candidate = safeClone(r.value, p.maxInputBytes);
    if (
      candidate !== null &&
      typeof candidate === "object" &&
      "authorized" in candidate &&
      candidate.authorized === false
    )
      throw Error("APPROVAL_AUTHORITY_REQUIRED");
    const c = certificateSchema.parse(candidate);
    if (
      c.actorId !== actor.actorId ||
      c.checkedAt < before ||
      c.checkedAt > this.now() ||
      fingerprint(clockSchema.parse(safeClone(this.ports.clock.provenance))) !== provenance
    )
      throw Error("APPROVAL_CERTIFICATE_MISMATCH");
    return c;
  }
  private currentAttestations(p: Policy) {
    const rows = this.attestations();
    return rows.map((a) => {
      const event = this.history.find(
        (x) =>
          x.action.kind === "ATTEST" &&
          x.action.attestation.fingerprint === a.declaration.fingerprint,
      )!;
      if (event.action.kind !== "ATTEST") throw Error("ATTESTATION_NOT_FOUND");
      let verified = true;
      try {
        this.certificate(a.declaration.issuer, p);
        this.certificate(event.action.checker, p);
      } catch {
        verified = false;
      }
      return { ...a, verified };
    });
  }
  private async evaluation(
    c: Context,
    r: RecordState | undefined,
    d: Stage,
    p: Policy,
    at: string,
    current = true,
    history: readonly Snapshot[] = this.history,
  ) {
    const result = await assess(
      this.ports,
      p,
      c,
      r,
      d,
      current ? this.currentAttestations(p) : this.attestations(history),
      at,
      current,
    );
    if (current && r?.approval) {
      try {
        const approval = history.find(
          (x) => x.action.kind === "APPROVE" && x.action.id === r.approval,
        );
        if (!approval || approval.action.kind !== "APPROVE")
          throw Error("APPROVAL_AUTHORITY_REVOKED");
        this.certificate(approval.action.checker, p);
      } catch {
        const { fingerprint: ignored, ...body } = result;
        void ignored;
        const reason = "APPROVAL_AUTHORITY_REVOKED";
        const next = {
          ...body,
          allowed: false,
          reasons: [...new Set([...body.reasons, reason])].sort(),
          dimensions: { ...body.dimensions, governance: [...body.dimensions.governance!, reason] },
          capabilities: body.capabilities.map((x) => ({
            ...x,
            allowed: false,
            reasons: [...new Set([...x.reasons, reason])].sort(),
          })),
        };
        return freeze({ ...next, fingerprint: fingerprint(next) });
      }
    }
    return result;
  }
  private request(history: readonly Snapshot[], id: string) {
    const s = history.find((x) => x.action.kind === "REQUEST" && x.action.id === id);
    if (!s || s.action.kind !== "REQUEST") throw Error("REQUEST_NOT_FOUND");
    return { snapshot: s, action: s.action };
  }
  private async derive(
    a: Action,
    p: Policy,
    at: string,
    history: readonly Snapshot[],
    recovery = false,
  ): Promise<{ assessment: Assessment | null; certificates: Certificate[] }> {
    const rows = this.records(history),
      certificates: Certificate[] = [];
    let assessment: Assessment | null = null;
    if (a.kind === "DISCOVER") {
      if (rows.has(a.instrumentId)) throw Error("RECORD_EXISTS");
      if (a.context.instrumentId !== a.instrumentId) throw Error("CROSS_INSTRUMENT_EVIDENCE");
      this.times(a.occurredAt, a.effectiveAt, at);
      // Discovery is recorded only from genuine accepted catalogue/mapping evidence; MAPPED remains a separate governed admission.
      assessment = await this.evaluation(
        a.context,
        undefined,
        "DISCOVERED",
        p,
        at,
        !recovery,
        history,
      );
      if (!assessment.allowed) throw Error(assessment.reasons[0]);
    } else if (a.kind === "REQUEST") {
      const r = rows.get(a.instrumentId);
      if (!r) throw Error("RECORD_NOT_FOUND");
      if (!a.maker.actorId) throw Error("ACTOR_ID_REQUIRED");
      if (a.context.instrumentId !== a.instrumentId) throw Error("CROSS_INSTRUMENT_EVIDENCE");
      this.times(a.occurredAt, a.effectiveAt, at);
      if (a.effectiveAt < r.effectiveAt || at < r.decisionAt) throw Error("TEMPORAL_ORDER");
      if (a.destination === "LIVE_ELIGIBLE" || a.destination === "ACTIVE")
        throw Error("LIVE_STAGE_PROHIBITED");
      if (a.disposition !== null && a.destination !== r.stage)
        throw Error("DISPOSITION_STAGE_CHANGE");
      if (r.disposition === "RETIRED") throw Error("RETIRED");
      // Blocking changes require explicit governance but may be requested while evidence is broken.
      const blocking = a.disposition !== null && a.disposition !== "NONE";
      const evaluatedRecord = a.disposition === "NONE" ? { ...r, disposition: "NONE" as const } : r;
      assessment = await this.evaluation(
        a.context,
        evaluatedRecord,
        a.destination,
        p,
        at,
        !recovery,
        history,
      );
      if (!blocking && !assessment.allowed) throw Error(assessment.reasons[0]);
      if (blocking && a.disposition === "EXPIRED" && !assessment.expired.length)
        throw Error("EXPIRY_EVIDENCE_REQUIRED");
      if (
        blocking &&
        a.disposition === "SUSPENDED" &&
        !assessment.reasons.filter((x) => x !== "BLOCKING_DISPOSITION").length
      )
        throw Error("SUSPENSION_EVIDENCE_REQUIRED");
      if (
        history.filter((x) => x.action.kind === "REQUEST").length >= p.maxRequests &&
        !history.some((x) => x.action.kind === "REQUEST" && x.action.id === a.id)
      )
        throw Error("REQUEST_CAPACITY");
    } else if (a.kind === "APPROVE") {
      const req = this.request(history, a.requestId);
      if (history.some((x) => x.action.kind === "COMMIT" && x.action.requestId === a.requestId))
        throw Error("REQUEST_ALREADY_COMMITTED");
      if (a.checker.actorId === req.action.maker.actorId) throw Error("MAKER_CHECKER_SEPARATION");
      if (!recovery) certificates.push(this.certificate(a.checker, p));
      const rerun = await this.derive(req.action, p, at, history, recovery);
      assessment = rerun.assessment;
      if (
        !req.snapshot.assessment ||
        assessment?.contextFingerprint !== req.snapshot.assessment.contextFingerprint
      )
        throw Error("EVIDENCE_CHANGED");
      if (history.filter((x) => x.action.kind === "APPROVE").length >= p.maxApprovals)
        throw Error("APPROVAL_CAPACITY");
    } else if (a.kind === "COMMIT") {
      const req = this.request(history, a.requestId),
        approval = history.find((x) => x.action.kind === "APPROVE" && x.action.id === a.approvalId);
      if (
        !approval ||
        approval.action.kind !== "APPROVE" ||
        approval.action.requestId !== a.requestId
      )
        throw Error("APPROVAL_REQUIRED");
      if (history.some((x) => x.action.kind === "COMMIT" && x.action.requestId === a.requestId))
        throw Error("REQUEST_ALREADY_COMMITTED");
      const state = rows.get(req.action.instrumentId)!;
      const atRequest = this.records(history.slice(0, history.indexOf(req.snapshot))).get(
        req.action.instrumentId,
      );
      if (state.version !== atRequest?.version) throw Error("STALE_REQUEST");
      if (!recovery) certificates.push(this.certificate(approval.action.checker, p));
      const rerun = await this.derive(req.action, p, at, history, recovery);
      assessment = rerun.assessment;
    } else if (a.kind === "ATTEST") {
      const d = a.attestation;
      if (identity(d) !== d.fingerprint) throw Error("ATTESTATION_FINGERPRINT");
      if (
        d.evidenceFingerprint !==
        fingerprint({
          subject: d.subject,
          instrumentId: d.instrumentId,
          hypothesis: d.hypothesis,
          methodology: d.methodology,
          methodologyVersion: d.methodologyVersion,
          datasets: d.datasets,
          replay: d.replay,
          evidenceReferences: d.evidenceReferences,
          provenance: d.provenance,
        })
      )
        throw Error("EVIDENCE_FINGERPRINT");
      if (
        !p.validationSources.some(
          (x) =>
            x.sourceId === d.sourceId &&
            x.issuerId === d.issuer.actorId &&
            x.methodologyVersion === d.methodologyVersion,
        ) ||
        d.policyId !== p.policyId ||
        d.policyVersion !== p.version
      )
        throw Error("VALIDATION_AUTHORITY_MISSING");
      if ((d.status === "SUPERSEDED") !== (d.supersededBy !== null))
        throw Error("SUPERSESSION_REFERENCE_REQUIRED");
      if (!d.issuer.actorId || d.issuer.actorId === a.checker.actorId)
        throw Error("MAKER_CHECKER_SEPARATION");
      this.times(d.issuedAt, d.effectiveAt, at);
      if (d.expiresAt !== null && d.expiresAt <= d.effectiveAt) throw Error("ATTESTATION_TIME");
      if (
        history.some(
          (x) =>
            x.action.kind === "ATTEST" &&
            (x.action.attestation.fingerprint === d.fingerprint ||
              x.action.attestation.attestationId === d.attestationId),
        )
      )
        throw Error("ATTESTATION_EXISTS");
      if (!recovery)
        certificates.push(this.certificate(d.issuer, p), this.certificate(a.checker, p));
      if (
        d.evidenceReferences.length + d.datasets.length * 4 + 6 > p.maxEvidence ||
        new Set(d.evidenceReferences).size !== d.evidenceReferences.length ||
        d.datasets.length > p.maxDependencies
      )
        throw Error("EVIDENCE_CAPACITY");
      // Owner references are checked even for FAILED/INCONCLUSIVE declarations, which never grant promotion.
      const record = rows.get(d.instrumentId);
      if (!record) throw Error("RECORD_NOT_FOUND");
      const context: Context = {
        source: record.context.source,
        timeframes: record.context.timeframes,
        instrumentId: d.instrumentId,
        revisionId: rows.get(d.instrumentId)?.context.revisionId ?? "sha256:" + "0".repeat(64),
        mappingSet: rows.get(d.instrumentId)?.context.mappingSet ?? "sha256:" + "0".repeat(64),
        mappingFingerprint:
          rows.get(d.instrumentId)?.context.mappingFingerprint ?? "sha256:" + "0".repeat(64),
        specification: rows.get(d.instrumentId)?.context.specification ?? null,
        datasets: d.datasets,
        calendar: rows.get(d.instrumentId)?.context.calendar ?? null,
        calendarFingerprint: rows.get(d.instrumentId)?.context.calendarFingerprint ?? null,
        subject: d.subject,
        hypothesis: d.hypothesis,
        methodology: d.methodology,
        methodologyVersion: d.methodologyVersion,
        replay: d.replay,
        attestation: null,
      };
      if (!rows.has(d.instrumentId)) throw Error("RECORD_NOT_FOUND");
      assessment = await this.evaluation(
        context,
        // Recording new evidence after promotion must remain possible: it can invalidate
        // current eligibility, but is not itself a backwards lifecycle transition.
        record.stage === "VALIDATED" || record.stage === "SIMULATION"
          ? { ...record, stage: "RESEARCH" }
          : record,
        "RESEARCH",
        p,
        at,
        !recovery,
        history,
      );
      if (!assessment.allowed || !assessment.replayReproducible)
        throw Error("ATTESTATION_OWNER_EVIDENCE_INVALID");
    } else {
      const original = history.find(
        (x) => x.action.kind === "ATTEST" && x.action.attestation.fingerprint === a.attestation,
      );
      if (!original || original.action.kind !== "ATTEST") throw Error("ATTESTATION_NOT_FOUND");
      if (a.checker.actorId === original.action.attestation.issuer.actorId)
        throw Error("MAKER_CHECKER_SEPARATION");
      if (!recovery) certificates.push(this.certificate(a.checker, p));
      if (
        this.attestations(history).find((x) => x.declaration.fingerprint === a.attestation)
          ?.status !== "CURRENT"
      )
        throw Error("ATTESTATION_ALREADY_CLOSED");
    }
    return { assessment, certificates };
  }
  private times(occurrence: string, effective: string, at: string) {
    if (occurrence > at || effective > at || effective < occurrence)
      throw Error("FUTURE_OR_INCONSISTENT_TIME");
  }
  private limits(a: Action, p: Policy, history: readonly Snapshot[]) {
    if (history.length >= p.maxHistory || history.length >= p.maxRecoverySteps)
      throw Error("HISTORY_CAPACITY");
    if (a.kind === "DISCOVER" && this.records(history).size >= p.maxRecords)
      throw Error("RECORD_CAPACITY");
    if ("context" in a) {
      const c = a.context;
      const evidence = [
        c.revisionId,
        c.mappingSet,
        c.mappingFingerprint,
        c.source.catalogueFingerprint,
        c.source.observationFingerprint,
        c.specification,
        c.calendarFingerprint,
        c.attestation,
        ...c.datasets.flatMap((d) => [
          d.versionFingerprint,
          d.contentFingerprint,
          d.qualityFingerprint,
          d.associationFingerprint,
        ]),
        ...(c.replay ? [c.replay.leftCheckpoint, c.replay.rightCheckpoint] : []),
      ].filter((x) => x !== null);
      const dependencies = 5 + c.datasets.length * 3 + (c.replay ? 2 : 0) + (c.attestation ? 1 : 0);
      if (
        evidence.length > p.maxEvidence ||
        dependencies > p.maxDependencies ||
        new Set(c.datasets.map((x) => x.versionId)).size !== c.datasets.length
      )
        throw Error("EVIDENCE_CAPACITY");
    }
  }
  private mutation(s: Snapshot) {
    const r = this.ports.authority.validateMutation({
      stateId: persistenceId(s.fingerprint),
      stateDomain: stateDomain("instrument.eligibility"),
      owner: stateOwner("instrument.eligibility"),
      runtimeMode: "RESEARCH",
      payload: s,
      actor: { actorType: "SYSTEM" },
      transition: s.action.kind,
    });
    if (!r.ok) throw Error("STATE_AUTHORITY_REQUIRED");
  }
  public async initialize(): Promise<Result<Snapshot | undefined>> {
    if (this.busy || this.checking) return fail("BUSY");
    if (this.lifecycle !== "CREATED") return fail("INITIALIZATION_STATE");
    this.busy = true;
    let recoveryAttempted = false;
    try {
      const c = this.configuration();
      this.policy = c.policy;
      this.configurationFingerprint = c.configurationFingerprint;
      this.obligation = { generation: 0, fingerprint: "RECOVERY_IN_FLIGHT" };
      recoveryAttempted = true;
      const loaded = await this.ports.repository.load();
      if (!loaded.ok) throw Error("RECOVERY_REQUIRED");
      const raw = safeClone(loaded.value, c.policy.maxRetainedBytes) as unknown[];
      if (
        !Array.isArray(raw) ||
        raw.length > c.policy.maxRecoverySteps ||
        raw.length > c.policy.maxHistory
      )
        throw Error("RECOVERY_CAPACITY");
      if (raw.length === 0) {
        this.obligation = null;
        recoveryAttempted = false;
      }
      const history: Snapshot[] = [];
      let retained = 0;
      for (const row of raw) {
        const s = snapshotSchema.parse(safeClone(row, c.policy.maxSnapshotBytes));
        retained += size(s);
        if (retained > c.policy.maxRetainedBytes) throw Error("RETAINED_CAPACITY");
        if (
          s.serviceId !== this.serviceId ||
          s.generation !== history.length + 1 ||
          s.previous !== (history.at(-1)?.fingerprint ?? null) ||
          identity(s) !== s.fingerprint ||
          fingerprint(s.policy) !== s.policyFingerprint ||
          s.publishedAt > this.now() ||
          s.observedAt > s.publishedAt ||
          s.publishedAt < (history.at(-1)?.publishedAt ?? s.publishedAt) ||
          s.observedAt < (history.at(-1)?.publishedAt ?? s.observedAt)
        )
          throw Error("HISTORY_INTEGRITY");
        if (
          s.policyFingerprint !== fingerprint(c.policy) &&
          !c.policy.compatibleHistoryPolicies.includes(s.policyFingerprint)
        )
          throw Error("POLICY_INCOMPATIBLE");
        if (
          s.policyFingerprint === fingerprint(c.policy) &&
          s.configurationFingerprint !== c.configurationFingerprint
        )
          throw Error("CONFIGURATION_CHANGED");
        if (history.some((x) => x.action.id === s.action.id)) throw Error("DUPLICATE_REQUEST");
        // Recorded policy interprets semantics; current policy bounds physical admission.
        safeClone(s.action, c.policy.maxInputBytes, c.policy.maxInputDepth);
        this.limits(s.action, c.policy, history);
        const derived = await this.derive(s.action, s.policy, s.observedAt, history, true);
        if (
          s.assessment?.replayReproducible &&
          derived.assessment?.dimensions.validation?.includes("REPLAY_ORIGIN_INCOMPLETE")
        )
          throw Error("HISTORICAL_REPLAY_ORIGIN_INCOMPLETE");
        if (fingerprint(derived.assessment) !== fingerprint(s.assessment))
          throw Error("DECISION_REDERIVATION_MISMATCH");
        const actors =
          s.action.kind === "APPROVE"
            ? [s.action.checker]
            : s.action.kind === "ATTEST"
              ? [s.action.attestation.issuer, s.action.checker]
              : s.action.kind === "ATTEST_STATUS"
                ? [s.action.checker]
                : s.action.kind === "COMMIT"
                  ? [
                      (
                        history.find(
                          (x) =>
                            x.action.kind === "APPROVE" &&
                            x.action.id ===
                              (s.action as Extract<Action, { kind: "COMMIT" }>).approvalId,
                        )?.action as Extract<Action, { kind: "APPROVE" }>
                      ).checker,
                    ]
                  : [];
        for (const actor of actors) this.certificate(actor, c.policy);
        if (
          actors.length !== s.certificates.length ||
          s.certificates.some(
            (cert, i) =>
              cert.actorId !== actors[i]?.actorId ||
              cert.checkedAt < s.observedAt ||
              cert.checkedAt > s.publishedAt,
          )
        )
          throw Error("AUTHORITY_EVIDENCE_INVALID");
        this.mutation(s);
        history.push(freeze(s));
      }
      this.configuration();
      if (this.stopRequested) throw Error("STOP_REQUESTED");
      this.history = history;
      this.obligation = null;
      this.lifecycle = "READY";
      return ok(history.at(-1));
    } catch (e) {
      this.lifecycle = recoveryAttempted ? "RECOVERY_REQUIRED" : "FAILED";
      return this.reject(e, recoveryAttempted);
    } finally {
      this.busy = false;
    }
  }
  public async publish(raw: unknown): Promise<Result<Snapshot>> {
    let acquired = false,
      attempted = false;
    try {
      const p = this.gate();
      this.busy = true;
      acquired = true;
      const a = actionSchema.parse(safeClone(raw, p.maxInputBytes, p.maxInputDepth));
      const old = this.history.find((x) => x.action.id === a.id);
      if (old) {
        if (fingerprint(old.action) !== fingerprint(a)) throw Error("IDEMPOTENCY_CONFLICT");
        return ok(old);
      }
      this.limits(a, p, this.history);
      const observedAt = this.now();
      const derived = await this.derive(a, p, observedAt, this.history);
      this.configuration();
      if (this.stopRequested) throw Error("STOP_REQUESTED");
      const publishedAt = this.now();
      if (publishedAt < observedAt || observedAt < (this.history.at(-1)?.publishedAt ?? observedAt))
        throw Error("CLOCK_REGRESSION");
      // Evidence evaluation identity uses evaluation time, not an invented later clock instant.
      const body = {
        schemaVersion: 1 as const,
        serviceId: this.serviceId,
        generation: this.history.length + 1,
        previous: this.history.at(-1)?.fingerprint ?? null,
        publishedAt,
        observedAt,
        clockProvenance: clockSchema.parse(safeClone(this.ports.clock.provenance)),
        policy: p,
        policyFingerprint: fingerprint(p),
        configurationFingerprint: this.configurationFingerprint,
        action: a,
        ...derived,
      };
      const next = freeze(snapshotSchema.parse({ ...body, fingerprint: fingerprint(body) }));
      if (
        size(next) > p.maxSnapshotBytes ||
        size(next) + this.history.reduce((n, s) => n + size(s), 0) > p.maxRetainedBytes
      )
        throw Error("SNAPSHOT_CAPACITY");
      this.mutation(next);
      this.obligation = { generation: next.generation, fingerprint: next.fingerprint };
      attempted = true;
      const response = safeClone(
        await this.ports.repository.commit(next),
        p.maxSnapshotBytes + 1024,
      );
      const ack = z
        .union([
          z.object({ ok: z.literal(true), value: snapshotSchema }).strict(),
          z
            .object({
              ok: z.literal(false),
              error: z.object({ code, commitment: z.enum(["NONE", "UNKNOWN"]) }).strict(),
            })
            .strict(),
        ])
        .parse(response);
      if (!ack.ok) {
        if (ack.error.commitment === "NONE") {
          this.obligation = null;
          attempted = false;
          return fail(ack.error.code);
        }
        throw Error("COMMITMENT_UNKNOWN");
      }
      if (fingerprint(ack.value) !== fingerprint(next)) throw Error("ACK_MISMATCH");
      this.history.push(next);
      this.obligation = null;
      attempted = false;
      // A genuine ACK is retained even if reentrant stop/configuration change now blocks readiness.
      return ok(next);
    } catch (e) {
      return this.reject(e, attempted);
    } finally {
      if (acquired) this.busy = false;
    }
  }
  public publishJson(raw: unknown): Promise<Result<Snapshot>> {
    try {
      const p = this.gate();
      return this.publish(parseJson(raw, p.maxInputBytes));
    } catch (e) {
      return Promise.resolve(this.reject(e));
    }
  }
  public discover(raw: unknown) {
    return this.publish(raw);
  }
  public requestTransition(raw: unknown) {
    return this.only("REQUEST", raw);
  }
  public approveTransition(raw: unknown) {
    return this.only("APPROVE", raw);
  }
  public commitTransition(raw: unknown) {
    return this.only("COMMIT", raw);
  }
  public recordAttestation(raw: unknown) {
    return this.only("ATTEST", raw);
  }
  private only(kind: Action["kind"], raw: unknown): Promise<Result<Snapshot>> {
    try {
      const p = this.gate(),
        a = actionSchema.parse(safeClone(raw, p.maxInputBytes, p.maxInputDepth));
      if (a.kind !== kind) throw Error("OPERATION_MISMATCH");
      return this.publish(a);
    } catch (e) {
      return Promise.resolve(this.reject(e));
    }
  }
  public async evaluateTransition(raw: unknown): Promise<Result<Assessment>> {
    let acquired = false;
    try {
      const p = this.gate();
      this.busy = true;
      acquired = true;
      const q = z
        .object({
          instrumentId: code,
          destination: z.enum(stages),
          context: actionSchema.options[0].shape.context,
        })
        .strict()
        .parse(safeClone(raw, p.maxInputBytes, p.maxInputDepth));
      const r = this.records().get(q.instrumentId);
      if (!r) throw Error("RECORD_NOT_FOUND");
      if (q.context.instrumentId !== r.instrumentId) throw Error("CROSS_INSTRUMENT_EVIDENCE");
      return ok(await this.evaluation(q.context, r, q.destination, p, this.now()));
    } catch (e) {
      return this.reject(e);
    } finally {
      if (acquired) this.busy = false;
    }
  }
  public async getEligibility(raw: unknown): Promise<
    Result<
      Readonly<{
        recorded: RecordState;
        current: Assessment;
        context: "CURRENT_REEVALUATION";
        tradingAuthority: false;
      }>
    >
  > {
    let acquired = false;
    try {
      const p = this.gate();
      this.busy = true;
      acquired = true;
      const id = code.parse(safeClone(raw, p.maxInputBytes));
      const recorded = this.records().get(id);
      if (!recorded) throw Error("RECORD_NOT_FOUND");
      const current = await this.evaluation(
        recorded.context,
        recorded,
        recorded.stage,
        p,
        this.now(),
      );
      return ok(
        freeze({ recorded, current, context: "CURRENT_REEVALUATION", tradingAuthority: false }),
      );
    } catch (e) {
      return this.reject(e);
    } finally {
      if (acquired) this.busy = false;
    }
  }
  public getEligibilityHistory(raw: unknown): Result<
    Readonly<{
      records: readonly Snapshot[];
      total: number;
      nextOffset: number | null;
      context: "RECORDED_KNOWLEDGE";
    }>
  > {
    try {
      const p = this.gate();
      const q = z
        .object({
          instrumentId: code,
          asOf: schemas.timestamp,
          offset: z.number().int().min(0).max(p.maxHistory),
          limit: z.number().int().min(1).max(p.maxQueryResults),
        })
        .strict()
        .parse(safeClone(raw, p.maxInputBytes));
      if (q.asOf > this.now()) throw Error("FUTURE_QUERY");
      const rows = this.history.filter(
        (s) =>
          s.publishedAt <= q.asOf &&
          (("instrumentId" in s.action && s.action.instrumentId === q.instrumentId) ||
            ((s.action.kind === "COMMIT" || s.action.kind === "APPROVE") &&
              this.request(this.history, s.action.requestId).action.instrumentId ===
                q.instrumentId) ||
            (s.action.kind === "ATTEST" && s.action.attestation.instrumentId === q.instrumentId) ||
            (s.action.kind === "ATTEST_STATUS" &&
              this.history.some(
                (x) =>
                  x.action.kind === "ATTEST" &&
                  x.action.attestation.fingerprint ===
                    (s.action as Extract<Action, { kind: "ATTEST_STATUS" }>).attestation &&
                  x.action.attestation.instrumentId === q.instrumentId,
              ))),
      );
      return ok(
        freeze({
          records: rows.slice(q.offset, q.offset + q.limit),
          total: rows.length,
          nextOffset: q.offset + q.limit < rows.length ? q.offset + q.limit : null,
          context: "RECORDED_KNOWLEDGE",
        }),
      );
    } catch (e) {
      return this.reject(e);
    }
  }
  public historicalEligibility(raw: unknown): Result<RecordState> {
    try {
      const p = this.gate();
      const q = z
        .object({ instrumentId: code, asOf: schemas.timestamp })
        .strict()
        .parse(safeClone(raw, p.maxInputBytes));
      if (q.asOf > this.now()) throw Error("FUTURE_QUERY");
      const rows = this.history.filter((s) => s.publishedAt <= q.asOf);
      const r = this.records(rows).get(q.instrumentId);
      if (!r || r.effectiveAt > q.asOf) throw Error("HISTORICAL_EVIDENCE_UNAVAILABLE");
      return ok(r);
    } catch (e) {
      return this.reject(e);
    }
  }
  public explainEligibilityDecision(raw: unknown): Result<Snapshot> {
    try {
      const p = this.gate(),
        ref = digest.parse(safeClone(raw, p.maxInputBytes));
      const s = this.history.find(
        (x) =>
          x.fingerprint === ref ||
          (x.action.kind === "ATTEST" && x.action.attestation.fingerprint === ref),
      );
      if (!s) throw Error("DECISION_NOT_FOUND");
      return ok(s);
    } catch (e) {
      return this.reject(e);
    }
  }
  public getEligibilityEvidence(raw: unknown) {
    return this.explainEligibilityDecision(raw);
  }
  public compareEligibilityVersions(
    raw: unknown,
  ): Result<Readonly<{ before: Snapshot; after: Snapshot; changed: boolean }>> {
    try {
      const p = this.gate();
      const q = z
        .object({ before: digest, after: digest })
        .strict()
        .parse(safeClone(raw, p.maxInputBytes));
      const a = this.history.find((x) => x.fingerprint === q.before),
        b = this.history.find((x) => x.fingerprint === q.after);
      if (!a || !b) throw Error("DECISION_NOT_FOUND");
      return ok(
        freeze({ before: a, after: b, changed: fingerprint(a.action) !== fingerprint(b.action) }),
      );
    } catch (e) {
      return this.reject(e);
    }
  }
  public getEligibilityChanges(raw: unknown) {
    return this.compareEligibilityVersions(raw);
  }
  public async dependencyImpact(id: unknown) {
    const result = await this.getEligibility(id);
    if (!result.ok) return result;
    const a = result.value.current;
    let pendingInvalid = false;
    for (const s of this.history) {
      if (
        s.action.kind !== "REQUEST" ||
        s.action.instrumentId !== result.value.recorded.instrumentId ||
        this.history.some((x) => x.action.kind === "COMMIT" && x.action.requestId === s.action.id)
      )
        continue;
      const preview = await this.evaluateTransition({
        instrumentId: s.action.instrumentId,
        destination: s.action.destination,
        context: s.action.context,
      });
      if (!preview.ok || !preview.value.allowed) pendingInvalid = true;
    }
    return ok(
      freeze({
        recordedVersion: result.value.recorded.version,
        assessment: a,
        classification: pendingInvalid
          ? "TRANSITION_INVALIDATION_REQUIRED"
          : a.allowed
            ? "NO_ELIGIBILITY_IMPACT"
            : a.reasons.includes("BLOCKING_DISPOSITION")
              ? "TRANSITION_INVALIDATION_REQUIRED"
              : a.reasons.some((x) => /MAPPING|IDENTITY|DATASET|EXPIRED|REVOKED/.test(x))
                ? "SUSPENSION_REQUIRED"
                : a.capabilities.some((x) => !x.allowed)
                  ? "CAPABILITY_RESTRICTION_REQUIRED"
                  : "REEVALUATION_REQUIRED",
      }),
    );
  }
  public suspendEligibility(raw: unknown) {
    return this.disposition("SUSPENDED", raw);
  }
  public revokeEligibility(raw: unknown) {
    return this.disposition("REVOKED", raw);
  }
  public reinstateEligibility(raw: unknown) {
    return this.disposition("NONE", raw);
  }
  private disposition(d: string, raw: unknown): Promise<Result<Snapshot>> {
    try {
      const p = this.gate(),
        a = actionSchema.parse(safeClone(raw, p.maxInputBytes, p.maxInputDepth));
      if (a.kind !== "REQUEST" || a.disposition !== d) throw Error("OPERATION_MISMATCH");
      return this.publish(a);
    } catch (e) {
      return Promise.resolve(this.reject(e));
    }
  }
  public stop(): Promise<Result<void>> {
    if (this.checking) return Promise.resolve(fail("BUSY"));
    this.stopRequested = true;
    if (this.busy)
      return Promise.resolve(fail("OPERATION_IN_FLIGHT", this.obligation ? "UNKNOWN" : "NONE"));
    if (this.obligation || this.lifecycle === "RECOVERY_REQUIRED")
      return Promise.resolve(fail("RECOVERY_REQUIRED", "UNKNOWN"));
    this.lifecycle = "STOPPED";
    return Promise.resolve(ok(undefined));
  }
}
export function createAttestation(raw: unknown) {
  const body = attestationSchema
    .omit({ fingerprint: true, evidenceFingerprint: true })
    .parse(safeClone(raw));
  const evidenceFingerprint = fingerprint({
    subject: body.subject,
    instrumentId: body.instrumentId,
    hypothesis: body.hypothesis,
    methodology: body.methodology,
    methodologyVersion: body.methodologyVersion,
    datasets: body.datasets,
    replay: body.replay,
    evidenceReferences: body.evidenceReferences,
    provenance: body.provenance,
  });
  const content = { ...body, evidenceFingerprint };
  return freeze(attestationSchema.parse({ ...content, fingerprint: fingerprint(content) }));
}
