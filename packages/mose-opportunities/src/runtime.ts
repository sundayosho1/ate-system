import { inOperation, operationBudget } from "./validation.js";
import type { Clock } from "@ate/time";
import {
  type StateAuthorityRegistry,
  persistenceId,
  stateDomain,
  stateOwner,
} from "@ate/persistence";
import { actorSchema } from "@ate/domain";
import {
  success,
  failure,
  contextSchema,
  type Result,
  type OpportunityRepository,
  type Policy,
  type DecisionProposal,
  type JournalRecord,
  type TrustedHostAuthorization,
  type CommitAck,
} from "./contracts.js";
import { effectivePolicy, defaultOpportunityPolicy } from "./policy.js";
import { canonical, fingerprint } from "./canonical.js";
import { demand, freeze, OpportunityError } from "./validation.js";
import {
  captureNativeResult,
  attachCapture,
  rehydrateCapture,
  proposalDetails,
} from "./evidence.js";
import { evaluateOpportunity } from "./transitions.js";
import { makeJournalRecord, exactAcknowledgement, acknowledgement } from "./journal.js";
import { recoverJournal, isVerifiedLegacyRecord } from "./recovery.js";
import { captureOpportunityClock, milliseconds } from "./time-policy.js";
import { commandFingerprint } from "./identity.js";
import { queryOpportunityHistory } from "./query.js";
import { opportunityDiagnostics } from "./diagnostics.js";
export class OpportunityRuntime {
  readonly policy: Policy;
  private records: readonly JournalRecord[] = [];
  private phase = "CREATED";
  private busy = false;
  private pending: JournalRecord | null = null;
  constructor(
    readonly repository: OpportunityRepository,
    private readonly clock: Clock,
    private readonly authority: StateAuthorityRegistry,
    private readonly host: TrustedHostAuthorization | null = null,
    policy: Policy = defaultOpportunityPolicy,
  ) {
    this.policy = effectivePolicy(policy);
  }
  private gate() {
    demand(this.phase === "READY" && !this.busy, "NOT_READY");
    demand(this.pending === null, "RECOVERY_REQUIRED");
  }
  async initialize(): Promise<Result<readonly JournalRecord[]>> {
    return inOperation(this.policy.limits, async () => {
      if (this.busy) return failure("BUSY");
      if (this.phase === "STOPPED" || this.pending !== null) return failure("NOT_READY");
      this.busy = true;
      try {
        const raw = captureNativeResult(await this.repository.load());
        demand(raw.ok && Array.isArray(raw.value), "RECOVERY_REQUIRED");
        this.records = recoverJournal(raw.value, this.repository.root, this.policy, this.host);
        this.phase = "READY";
        return success(this.records);
      } catch {
        this.phase = "RECOVERY_REQUIRED";
        return failure("RECOVERY_REQUIRED", "UNKNOWN");
      } finally {
        this.busy = false;
      }
    });
  }
  evaluate(raw: unknown, context: unknown) {
    return inOperation(this.policy.limits, () => {
      try {
        this.gate();
        const dto = contextSchema.parse(operationBudget(this.policy.limits).capture(context));
        demand(this.host, "SOURCE_UNVERIFIED");
        const capture = this.host.captures[dto.trustedCaptureRef];
        demand(capture, "SOURCE_UNVERIFIED");
        return evaluateOpportunity(raw, attachCapture(dto, capture, this.policy), this.policy);
      } catch {
        return failure("SOURCE_UNVERIFIED");
      }
    });
  }
  private authorize(proposal: DecisionProposal, action: "BIRTH" | "COMMIT" | "RECOVER") {
    const details = proposalDetails(proposal);
    demand(this.host && this.host.reviewReference.length > 0, "AUTHORITY_UNESTABLISHED");
    const clock = captureOpportunityClock(this.clock);
    demand(
      details.input.capturedClock.clockId === clock.clockId &&
        details.input.capturedClock.mode === clock.mode &&
        details.input.capturedClock.source === clock.source &&
        details.input.capturedClock.quality === clock.quality &&
        milliseconds(details.input.decisionCutoff) <= milliseconds(clock.now),
      "CLOCK_UNTRUSTED",
    );
    const captureFingerprint = fingerprint("ate.opportunity-capture/1", details);
    const raw = captureNativeResult(
      this.host.verify({
        action,
        root: this.repository.root,
        principalRef: details.input.actorAuthorityRef,
        key: proposal.key,
        policyFingerprint: details.input.policyFingerprint,
        captureFingerprint,
        asOf: clock.now,
      }),
    );
    demand(raw.ok, "AUTHORITY_UNESTABLISHED");
    const grant = operationBudget(this.policy.limits).capture(raw.value);
    demand(
      grant !== null && typeof grant === "object" && !Array.isArray(grant),
      "AUTHORITY_UNESTABLISHED",
    );
    const g = grant as Record<string, unknown>;
    demand(
      g.principalRef === details.input.actorAuthorityRef &&
        g.key === proposal.key &&
        g.policyFingerprint === details.input.policyFingerprint &&
        g.captureFingerprint === captureFingerprint &&
        g.root === this.repository.root &&
        g.scope === "HISTORICAL_RESEARCH" &&
        typeof g.issuerRef === "string" &&
        g.issuerRef.length > 0 &&
        Array.isArray(g.approvalReferences) &&
        g.approvalReferences.length > 0 &&
        g.approvalReferences.every((x) => typeof x === "string" && x.length > 0) &&
        typeof g.issuedAt === "string" &&
        typeof g.expiresAt === "string",
      "AUTHORITY_UNESTABLISHED",
    );
    demand(
      milliseconds(g.issuedAt) <= milliseconds(clock.now) &&
        milliseconds(clock.now) < milliseconds(g.expiresAt),
      "AUTHORITY_UNESTABLISHED",
    );
    for (const m of details.context.predicateManifests.filter((m) => m.enabled))
      demand(g.approvalReferences.includes(m.approvalEvidenceRef), "MANIFEST_NOT_APPROVED");
    demand(
      g.approvalReferences.includes(details.input.configurationReleaseRef),
      "CONFIGURATION_NOT_APPROVED",
    );
    const actor = actorSchema.parse(g.actor);
    demand(actor.actorId === details.input.actorAuthorityRef, "AUTHORITY_UNESTABLISHED");
    const allowed = this.authority.validateMutation({
      stateId: persistenceId(proposal.key),
      stateDomain: stateDomain("surveillance.opportunity"),
      owner: stateOwner("mose.opportunities"),
      runtimeMode: "RESEARCH",
      actor,
      transition: action,
      payload: { key: proposal.key },
    });
    demand(allowed.ok, "AUTHORITY_UNESTABLISHED");
  }
  async commit(
    proposal: DecisionProposal,
    expectedHead?: DecisionProposal["expectedHead"],
  ): Promise<Result<CommitAck>> {
    return inOperation(this.policy.limits, async () => {
      if (this.busy) return failure("BUSY");
      this.busy = true;
      let possible = false;
      try {
        demand(this.phase === "READY" && this.pending === null, "NOT_READY");
        const d = proposalDetails(proposal);
        // Only the exact immutable proposal produced by our evaluator has a private WeakMap proof.
        // No caller-copy, Symbol forgery or serialized DTO can replace that proof.
        const command = commandFingerprint(
          d.input.actorAuthorityRef,
          proposal.key,
          d.input.commandId,
          d,
        );
        const old = this.records.find(
          (r) =>
            r.snapshot.key === proposal.key &&
            r.operationId === d.input.commandId &&
            r.details.input.actorAuthorityRef === d.input.actorAuthorityRef,
        );
        if (old) {
          if (old.commandFingerprint !== command) {
            demand(isVerifiedLegacyRecord(old), "COMMAND_CONFLICT");
            operationBudget(this.policy.limits).tighten(old.details.policy.limits);
            // Canonicalize the validated original details only for comparison; never rewrite them.
            const normalized = evaluateOpportunity(
              old.details.input,
              rehydrateCapture(old.details.context, old.details.capture, old.details.policy),
              old.details.policy,
            );
            demand(normalized.ok, "COMMAND_CONFLICT");
            const equivalent = commandFingerprint(
              old.details.input.actorAuthorityRef,
              old.proposal.key,
              old.operationId,
              proposalDetails(normalized.value),
            );
            demand(equivalent === command, "COMMAND_CONFLICT");
          }
          return success(acknowledgement(old, this.repository.storageMode));
        }
        demand(canonical(d.policy) === canonical(this.policy), "SOURCE_CONTEXT_MISMATCH");
        demand(
          canonical(expectedHead === undefined ? proposal.expectedHead : expectedHead) ===
            canonical(proposal.expectedHead),
          "STALE_PREDECESSOR",
        );
        demand(proposal.disposition !== "NO_ACTION", "NO_ACTION");
        this.authorize(proposal, proposal.from === null ? "BIRTH" : "COMMIT");
        const record = makeJournalRecord(this.repository.root, this.records, proposal);
        const priorRecord = [...this.records]
          .reverse()
          .find((r) => r.snapshot.key === proposal.key);
        const prior = priorRecord?.snapshot ?? null;
        demand(
          d.context.previousEventFingerprint === (priorRecord?.proposal.eventFingerprint ?? null),
          "STALE_PREDECESSOR",
        );
        demand(canonical(prior) === canonical(d.context.historicalState), "STALE_PREDECESSOR");
        demand(
          this.records.length < this.policy.limits.maxJournalRecords &&
            this.records.length < this.policy.limits.maxReplayRecords,
          "BUDGET_EXHAUSTED",
        );
        demand(
          Buffer.byteLength(canonical(record.snapshot)) <=
            this.policy.limits.maxSnapshotBytesWithinRecord &&
            this.policy.limits.maxSnapshotsPerRecord >= 1,
          "BUDGET_EXHAUSTED",
        );
        operationBudget(this.policy.limits).capture(record, this.policy.limits.maxRecordBytes);
        demand(
          this.records.reduce(
            (n, r) => n + Buffer.byteLength(canonical(r)),
            Buffer.byteLength(canonical(record)),
          ) <= this.policy.limits.maxRetainedJournalBytes,
          "BUDGET_EXHAUSTED",
        );
        this.pending = record;
        possible = true;
        let raw;
        try {
          raw = captureNativeResult(await this.repository.compareAppend(record));
        } catch {
          return failure("COMMITMENT_UNKNOWN", "UNKNOWN", record.operationId);
        }
        if (!raw.ok) {
          if (raw.error.commitment === "NONE") {
            this.pending = null;
            possible = false;
            return failure("REPOSITORY_REJECTED", "NONE", record.operationId);
          }
          return failure("COMMITMENT_UNKNOWN", "UNKNOWN", record.operationId);
        }
        const ack = exactAcknowledgement(raw.value, record, this.repository.storageMode);
        this.records = freeze([...this.records, record]);
        this.pending = null;
        return success(ack);
      } catch (error) {
        return failure(
          possible
            ? "COMMITMENT_UNKNOWN"
            : error instanceof OpportunityError
              ? error.code
              : "COMMIT_REJECTED",
          possible ? "UNKNOWN" : "NONE",
          this.pending?.operationId ?? null,
        );
      } finally {
        this.busy = false;
      }
    });
  }
  async createWatch(raw: unknown, context: unknown) {
    return inOperation(this.policy.limits, async () => {
      const p = this.evaluate(raw, context);
      if (!p.ok) return p;
      if (p.value.from !== null || p.value.to !== "DORMANT") return failure("TRANSITION_DENIED");
      return this.commit(p.value);
    });
  }
  async recover(operationId: string): Promise<Result<CommitAck>> {
    return inOperation(this.policy.limits, async () => {
      if (this.busy) return failure("BUSY");
      this.busy = true;
      try {
        demand(this.pending?.operationId === operationId, "RECOVERY_REQUIRED");
        const pending = this.pending;
        const p = evaluateOpportunity(
          pending.details.input,
          rehydrateCapture(
            pending.details.context,
            pending.details.capture,
            pending.details.policy,
          ),
          pending.details.policy,
        );
        demand(p.ok, "RECOVERY_REQUIRED");
        this.authorize(p.value, "RECOVER");
        const raw = captureNativeResult(await this.repository.load());
        demand(raw.ok && Array.isArray(raw.value), "RECOVERY_REQUIRED");
        const records = recoverJournal(raw.value, this.repository.root, this.policy, this.host);
        const found = records.find((r) => r.fingerprint === pending.fingerprint);
        demand(found && canonical(found) === canonical(pending), "RECOVERY_REQUIRED");
        this.records = records;
        this.pending = null;
        this.phase = "READY";
        return success(acknowledgement(found, this.repository.storageMode));
      } catch {
        return failure("RECOVERY_REQUIRED", "UNKNOWN", operationId);
      } finally {
        this.busy = false;
      }
    });
  }
  query(raw: unknown, lower?: unknown) {
    try {
      this.gate();
      return queryOpportunityHistory(this.records, raw, this.policy, lower);
    } catch {
      return failure("NOT_READY");
    }
  }
  diagnostics() {
    return opportunityDiagnostics(
      this.records,
      this.policy,
      this.phase,
      this.pending?.operationId ?? null,
    );
  }
  async shutdown(): Promise<Result<void>> {
    return inOperation(this.policy.limits, async () => {
      await Promise.resolve();
      if (this.busy) return failure("BUSY");
      if (this.pending !== null || this.phase === "RECOVERY_REQUIRED")
        return failure("RECOVERY_REQUIRED", "UNKNOWN", this.pending?.operationId ?? null);
      this.phase = "STOPPED";
      return success(undefined);
    });
  }
}
