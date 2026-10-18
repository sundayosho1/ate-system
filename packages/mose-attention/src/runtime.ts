import { validateDelta } from "./recovery.js";
import type { Clock } from "@ate/time";
import type { EffectiveConfiguration } from "@ate/configuration";
import type { StateAuthorityRegistry } from "@ate/persistence";
import { stateDomain, stateOwner } from "@ate/persistence";
import type { MultiSpeedScannerRuntime, ScanRequest } from "@ate/mose-scanner";
import { triggerSchema } from "@ate/mose-scanner";
import { universeSchema } from "@ate/mose-core";
import {
  commandSchema,
  dispatchResultSchema,
  checkpointSchema,
  subjectSchema,
  emptyState,
  ok,
  fail,
  type AttentionPolicy,
  type AttentionRepository,
  type AttentionCheckpoint,
  type AttentionState,
  type AttentionCommand,
  type Recommendation,
} from "./contracts.js";
import { readAttentionPolicy } from "./policy.js";
import { ownerEvidence, type EvidencePorts } from "./evidence.js";
import { assess, allocate, epochAt, validateState } from "./engine.js";
import {
  fingerprint,
  clone,
  frozen,
  errorCode,
  unwrap,
  readResult,
  readScanReceipt,
} from "./primitives.js";
import { deriveIntent, deriveOutcome, obligationAttempts } from "./engine.js";
/** Trusted offline composition lease. Caller must actually exclude relevant writers;
 * this is NOT a newly implemented owner lock or a generation-pinned query API. */
export interface QuiescentRead {
  withRead<T>(
    asOf: string,
    read: () => Promise<T>,
  ): Promise<{ value: T; asOf: string; id: string }>;
}
export interface AttentionPorts extends EvidencePorts {
  clock: Clock;
  configuration: () => EffectiveConfiguration;
  authority: StateAuthorityRegistry;
  scanner: Pick<
    MultiSpeedScannerRuntime,
    "preview" | "request" | "dispatch" | "query" | "health" | "coverage"
  >;
  repository: AttentionRepository;
  readBarrier?: QuiescentRead;
}
export class AdaptiveSurveillanceRuntime {
  private state = emptyState();
  private history: AttentionCheckpoint[] = [];
  private policy: AttentionPolicy | null = null;
  private configuration = "";
  private busy = false;
  private initialized = false;
  private stopped = false;
  private stopping = false;
  private calls = 0;
  private obligation: AttentionCheckpoint | null = null;
  private failure: string | null = null;
  private lastConsistency = "CONSISTENCY_UNESTABLISHED";
  constructor(private readonly ports: AttentionPorts) {}
  private config() {
    return readAttentionPolicy(this.ports.configuration(), this.ports.clock);
  }
  private call() {
    if (++this.calls > this.policy!.maxOwnerCallsPerCommand) throw Error("OWNER_CALL_LIMIT");
  }
  private gate() {
    const c = this.config();
    if (
      !this.policy ||
      c.configuration !== this.configuration ||
      fingerprint(c.policy) !== fingerprint(this.policy)
    )
      throw Error("CONFIGURATION_CHANGED");
    const auth = this.ports.authority.require(stateDomain("mose.attention"));
    if (
      !auth.ok ||
      auth.value.owner !== stateOwner("mose.attention") ||
      auth.value.writeAuthority !== "mose.attention" ||
      !auth.value.runtimeModes.includes("RESEARCH")
    )
      throw Error("STATE_AUTHORITY_MISSING");
    return c;
  }
  private async consistent<T>(
    at: string,
    fn: () => Promise<T>,
  ): Promise<{ value: T; consistent: boolean; barrierId: string | null }> {
    if (!this.ports.readBarrier) {
      this.lastConsistency = "CONSISTENCY_UNESTABLISHED";
      return { value: await fn(), consistent: false, barrierId: null };
    }
    const r = await this.ports.readBarrier.withRead(at, fn);
    if (typeof r.id !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/u.test(r.id) || r.asOf !== at)
      throw Error("CONSISTENCY_UNESTABLISHED");
    this.lastConsistency = "ESTABLISHED";
    return { value: r.value, consistent: true, barrierId: r.id };
  }
  private check(cp: AttentionCheckpoint) {
    const { fingerprint: f, ...body } = cp;
    if (fingerprint(body) !== f) throw Error("CHECKPOINT_INTEGRITY");
    validateState(cp.state, this.policy!);
  }
  async initialize() {
    if (this.initialized || this.busy || this.stopped) return fail("RUNTIME_NOT_READY");
    this.busy = true;
    try {
      const c = this.config();
      this.policy = c.policy;
      this.configuration = c.configuration;
      this.gate();
      const raw = unwrap(await this.ports.repository.load());
      if (
        !Array.isArray(raw) ||
        raw.length > Math.min(c.policy.maxRecoverySteps, c.policy.maxHistory)
      )
        throw Error("RECOVERY_BOUNDS");
      let prior: AttentionCheckpoint | null = null,
        retained = 0;
      for (const x of raw as unknown[]) {
        const cp = checkpointSchema.parse(
          clone(x, c.policy.maxCheckpointBytes, c.policy.maxInputDepth),
        );
        this.check(cp);
        if (this.history.some((x) => x.command.id === cp.command.id))
          throw Error("DUPLICATE_COMMAND");
        validateDelta(prior?.state, cp, c.policy);
        if (
          cp.generation !== (prior?.generation ?? 0) + 1 ||
          cp.previous !== (prior?.fingerprint ?? null) ||
          cp.policy !== fingerprint(c.policy) ||
          cp.configuration !== c.configuration ||
          cp.at > this.ports.clock.now() ||
          (prior && cp.at < prior.at)
        )
          throw Error("RECOVERY_INTEGRITY");
        retained += Buffer.byteLength(JSON.stringify(cp));
        if (retained > c.policy.maxRetainedBytes) throw Error("RETAINED_BOUNDS");
        // Every predecessor's immutable evidence/floor identity and acknowledged settlement remains retained.
        if (prior) {
          for (const a of prior.state.assessments)
            if (!cp.state.assessments.some((b) => fingerprint(b) === fingerprint(a)))
              throw Error("HISTORY_REWRITTEN");
          for (const f of prior.state.floors) {
            const next = cp.state.floors.find((n) => n.id === f.id);
            if (
              !next ||
              next.epoch !== f.epoch ||
              next.instrumentKey !== f.instrumentKey ||
              (f.settledBy && next.settledBy !== f.settledBy)
            )
              throw Error("DEBT_REWRITTEN");
          }
          for (const l of prior.state.ledgers) {
            const next = cp.state.ledgers.find((n) => n.epoch === l.epoch);
            if (
              !next ||
              next.spent < l.spent ||
              l.bonusAccrued.some((k) => !next.bonusAccrued.includes(k))
            )
              throw Error("BUDGET_REWRITTEN");
          }
        }
        prior = cp;
        this.history.push(frozen(cp));
      }
      // A locally rehashed fabricated ACK is not an authoritative scanner publication.
      const required = new Map<string, string>();
      for (const cp of this.history)
        for (const r of cp.state.recommendations) {
          if (r.outcome?.kind === "ACK") {
            const receipt = readScanReceipt(
                r.outcome.receipt,
                r.payload,
                c.policy.maxCheckpointBytes,
              ),
              id = receipt.trigger.id,
              hash = fingerprint(receipt);
            if (required.has(id) && required.get(id) !== hash)
              throw Error("RECEIPT_IDENTITY_CONFLICT");
            required.set(id, hash);
          }
        }
      if (required.size) {
        const size = Math.min(c.policy.maxQueryResults, c.scannerPolicy.maxQueryResults);
        this.calls = 0;
        const seen = new Set<string>();
        let total: number | null = null;
        for (let page = 0; page < c.policy.maxQueryPages && required.size; page++) {
          this.call();
          const raw = clone(
            unwrap(this.ports.scanner.query(page * size, size)),
            c.policy.maxCheckpointBytes,
          ) as { requests: unknown[]; totalRequests: number };
          if (
            !Array.isArray(raw.requests) ||
            raw.requests.length > size ||
            !Number.isSafeInteger(raw.totalRequests) ||
            raw.totalRequests < 0 ||
            (total !== null && total !== raw.totalRequests)
          )
            throw Error("CONSISTENCY_UNESTABLISHED");
          total = raw.totalRequests;
          for (const value of raw.requests) {
            const candidate = value as ScanRequest,
              receipt = readScanReceipt(value, candidate?.trigger, c.policy.maxCheckpointBytes),
              id = receipt.trigger.id;
            if (seen.has(id)) throw Error("ENUMERATION_INCOMPLETE");
            seen.add(id);
            if (required.has(id)) {
              if (required.get(id) !== fingerprint(receipt))
                throw Error("RECEIPT_IDENTITY_CONFLICT");
              required.delete(id);
            }
          }
          if (!raw.requests.length || seen.size >= total) break;
        }
        if (required.size) throw Error("RECEIPT_EVIDENCE_UNESTABLISHED");
      }
      if (prior) this.state = clone(prior.state);
      this.initialized = true;
      this.failure = null;
      return ok(undefined);
    } catch (e) {
      this.failure = errorCode(e);
      this.history = [];
      this.state = emptyState();
      this.policy = null;
      return fail(this.failure);
    } finally {
      this.busy = false;
    }
  }
  private async save(command: AttentionCommand, state: AttentionState) {
    if (this.stopping && command.kind !== "STOP") throw Error("STOPPING");
    this.gate();
    validateState(state, this.policy!);
    const body = {
      owner: "MOSE_ATTENTION" as const,
      ownerVersion: "0.27.0-adaptive-surveillance.1" as const,
      schemaVersion: 1 as const,
      generation: this.history.length + 1,
      previous: this.history.at(-1)?.fingerprint ?? null,
      at: this.ports.clock.now(),
      policy: fingerprint(this.policy),
      configuration: this.configuration,
      command,
      state,
    };
    const cp = checkpointSchema.parse({ ...body, fingerprint: fingerprint(body) });
    validateDelta(this.state, cp, this.policy!);
    const bytes = Buffer.byteLength(JSON.stringify(cp));
    if (
      bytes > this.policy!.maxCheckpointBytes ||
      this.history.length >= this.policy!.maxHistory ||
      this.history.reduce((n, c) => n + Buffer.byteLength(JSON.stringify(c)), 0) + bytes >
        this.policy!.maxRetainedBytes
    )
      throw Error("RETAINED_BOUNDS");
    this.obligation = frozen(clone(cp));
    try {
      const response = readResult(await this.ports.repository.commit(cp));
      if (!response.ok) {
        if (response.error.commitment === "NONE") this.obligation = null;
        throw Error(response.error.code);
      }
      const actual = checkpointSchema.parse(clone(response.value, this.policy!.maxCheckpointBytes));
      if (fingerprint(actual) !== fingerprint(cp)) throw Error("ACK_MISMATCH");
      this.history.push(frozen(clone(cp)));
      this.state = clone(cp.state);
      if (cp.command.kind === "ASSESS") this.lastConsistency = "CONSISTENCY_UNESTABLISHED";
      this.obligation = null;
      return cp;
    } catch (e) {
      this.failure = errorCode(e);
      throw e;
    }
  }
  async dispatch(raw: unknown) {
    if (this.busy || !this.initialized || this.stopped || this.stopping)
      return fail("RUNTIME_NOT_READY");
    this.busy = true;
    this.calls = 0;
    try {
      const c = this.gate(),
        p = c.policy;
      const command = commandSchema.parse(clone(raw, p.maxInputBytes, p.maxInputDepth));
      if (this.obligation) throw Error("RECOVERY_REQUIRED");
      if (["SUBMIT", "EXECUTE_ADMITTED"].includes(command.kind) && command.id.length > 120)
        throw Error("COMMAND_ID_BOUNDS");
      const old = this.history.find((x) => x.command.id === command.id);
      if (old) {
        if (fingerprint(old.command) !== fingerprint(command)) throw Error("IDEMPOTENCY_CONFLICT");
        return ok(this.history.find((x) => x.command.id === command.id + ".outcome") ?? old);
      }
      if (this.state.phase === "STOPPED") throw Error("RUNTIME_NOT_READY");
      if (
        (this.state.recommendations.some((r) => ["INTENT", "UNRESOLVED"].includes(r.status)) ||
          this.state.executions.some((x) => x.status !== "ACKNOWLEDGED")) &&
        !["RECONCILE", "STOP"].includes(command.kind)
      )
        throw Error("RECONCILIATION_REQUIRED");
      let s = clone(this.state);
      if (["START", "PAUSE", "RESUME"].includes(command.kind)) {
        const expected = { START: "READY", PAUSE: "RUNNING", RESUME: "PAUSED" };
        if (s.phase !== expected[command.kind as keyof typeof expected])
          throw Error("INVALID_LIFECYCLE");
        s.phase = command.kind === "PAUSE" ? "PAUSED" : "RUNNING";
      } else if (command.kind === "STOP") {
        if (
          s.recommendations.some((r) => ["INTENT", "UNRESOLVED"].includes(r.status)) ||
          s.executions.some((x) => x.status !== "ACKNOWLEDGED")
        )
          throw Error("RECONCILIATION_REQUIRED");
        s.phase = "STOPPED";
      } else {
        if (s.phase !== "RUNNING") throw Error("INVALID_LIFECYCLE");
        if (command.kind === "ASSESS") {
          const subject = subjectSchema.parse(command.subject),
            at = command.asOf;
          if (at > this.ports.clock.now()) throw Error("FUTURE_BOUNDARY");
          if (at < c.policy.effectiveAt || at < c.configurationResolvedAt)
            throw Error("POLICY_NOT_KNOWN_AT_CUTOFF");
          if (new Set(subject.subscriptions).size !== subject.subscriptions.length)
            throw Error("SUBJECT_MISMATCH");
          for (const id of subject.subscriptions) {
            const sub = c.plan.subscriptions.find((x) => x.id === id);
            if (
              !sub ||
              sub.sessionId !== subject.sessionId ||
              sub.universe !== subject.universe ||
              sub.instrumentId !== subject.instrumentId
            )
              throw Error("SUBJECT_MISMATCH");
          }
          const key = fingerprint(subject),
            old = s.assessments.filter((a) => a.subjectKey === key).at(-1);
          if (!old && new Set(s.assessments.map((a) => a.subjectKey)).size >= p.maxSubjects)
            throw Error("SUBJECT_LIMIT");
          let evidence = null,
            reason = "EVIDENCE_QUALIFIED";
          try {
            evidence = await ownerEvidence(this.ports, subject, at, this.ports.clock.now(), p, () =>
              this.call(),
            );
          } catch (e) {
            reason = errorCode(e);
          }
          s.assessments.push(
            assess(subject, at, this.ports.clock.now(), p, c.configuration, evidence, reason, old),
          );
        } else if (command.kind === "ALLOCATE") {
          if (command.asOf > this.ports.clock.now()) throw Error("FUTURE_BOUNDARY");
          if (command.asOf < c.policy.effectiveAt || command.asOf < c.configurationResolvedAt)
            throw Error("POLICY_NOT_KNOWN_AT_CUTOFF");
          const checked = await this.consistent(command.asOf, async () => {
            this.call();
            unwrap(await this.ports.mose.health());
            this.call();
            unwrap(await this.ports.scanner.health());
            // Current evidence is rechecked, never an old healthy assessment used as present authority.
            for (const a of new Map(s.assessments.map((a) => [a.subjectKey, a])).values())
              if (a.epoch === epochAt(command.asOf, p) && a.sufficient) {
                try {
                  await ownerEvidence(
                    this.ports,
                    a.subject,
                    command.asOf,
                    this.ports.clock.now(),
                    p,
                    () => this.call(),
                  );
                } catch (e) {
                  throw Error(errorCode(e), { cause: e });
                }
              }
            return c.plan.subscriptions.every((sub) =>
              [...new Map(s.assessments.map((a) => [a.subjectKey, a])).values()].some(
                (a) =>
                  a.subject.instrumentId === sub.instrumentId &&
                  a.subject.sessionId === sub.sessionId &&
                  a.epoch === epochAt(command.asOf, p) &&
                  a.sufficient,
              ),
            );
          });
          s = allocate(s, p, command.asOf, command.limit, checked.consistent, checked.barrierId);
        } else if (command.kind === "SUBMIT") {
          if (!p.submissionEnabled) throw Error("SUBMISSION_DISABLED");
          const r = s.recommendations.find((r) => r.id === command.recommendationId);
          if (!r) throw Error("RECOMMENDATION_MISSING");
          if (r.status !== "PROPOSED" && r.status !== "REJECTED")
            throw Error("RECOMMENDATION_NOT_SUBMITTABLE");
          if (obligationAttempts(s, r) >= p.maxAttemptRetries)
            throw Error("OBLIGATION_RETRY_EXHAUSTED");
          const a = s.assessments.find((a) => a.id === r.assessmentId)!;
          if (a.expiresAt <= this.ports.clock.now()) throw Error("ASSESSMENT_EXPIRED");
          const latest = s.assessments.filter((x) => x.subjectKey === a.subjectKey).at(-1);
          if (!latest?.sufficient || (r.floorId === null && latest.id !== a.id))
            throw Error("ASSESSMENT_SUPERSEDED");
          await ownerEvidence(
            this.ports,
            a.subject,
            this.ports.clock.now(),
            this.ports.clock.now(),
            p,
            () => this.call(),
          );
          const sub = c.plan.subscriptions.find((x) => x.id === r.subscriptionId)!;
          if (!["SECONDS", "SCHEDULE", "TRIGGER"].includes(sub.mode))
            throw Error("UNSUPPORTED_SUBMISSION");
          this.call();
          const u = universeSchema.parse(unwrap(this.ports.mose.getUniverse(sub.sessionId)));
          if (
            !p.actor ||
            u.checker.actorId !== p.actor ||
            !c.scannerPolicy.trustedTriggerActors.includes(p.actor)
          )
            throw Error("ACTOR_UNAUTHORIZED");
          this.call();
          const queried = unwrap(this.ports.scanner.query(0, 1)) as { plan: unknown };
          if (fingerprint(queried.plan) !== fingerprint(c.plan)) throw Error("PLAN_MISMATCH");
          const boundary = a.asOf;
          this.call();
          const preview = unwrap(this.ports.scanner.preview(sub.id, boundary)) as {
            cause: string;
            evidence: string;
          };
          const payload = triggerSchema.parse({
            id: "attention-" + r.id.slice(7),
            subscriptionId: sub.id,
            boundary,
            kind: sub.mode === "TRIGGER" ? "RESEARCH_RESCAN" : "DEADLINE",
            actor: sub.mode === "TRIGGER" ? p.actor : null,
            cause: sub.mode === "TRIGGER" ? preview.cause : (sub.schedule?.id ?? sub.id),
            evidence: preview.evidence,
          });
          if (
            r.floorId &&
            s.floors.find((f) => f.id === r.floorId)?.epoch !== epochAt(payload.boundary, p)
          )
            throw Error("FLOOR_EPOCH_MISMATCH");
          if (r.payload && fingerprint(r.payload) !== fingerprint(payload))
            throw Error("PAYLOAD_SUPERSEDED");
          Object.assign(s, deriveIntent(s, r.id, payload, command.id, p));
          await this.save(command, s);
          let outcome: AttentionState;
          try {
            this.call();
            const response = readResult(await this.ports.scanner.request(payload));
            if (response.ok) {
              const receipt = readScanReceipt(response.value, payload, p.maxCheckpointBytes),
                published = this.findReceipt(
                  this.state.recommendations.find((x) => x.id === r.id)!,
                  p,
                );
              if (!published || fingerprint(published) !== fingerprint(receipt))
                throw Error("RECEIPT_EVIDENCE_UNESTABLISHED");
              outcome = deriveOutcome(this.state, r.id, { kind: "ACK", receipt }, p);
            } else
              outcome = deriveOutcome(this.state, r.id, { kind: "NEGATIVE", ...response.error }, p);
          } catch (e) {
            outcome = deriveOutcome(this.state, r.id, { kind: "UNCERTAIN", code: errorCode(e) }, p);
          }
          return ok(await this.save({ ...command, id: command.id + ".outcome" }, outcome));
        } else if (command.kind === "RECONCILE") {
          const r = s.recommendations.find((r) => r.id === command.recommendationId);
          if (!r?.payload || !["INTENT", "UNRESOLVED"].includes(r.status))
            throw Error("NO_RECONCILIATION_OBLIGATION");
          const result = await this.consistent(this.ports.clock.now(), async () => {
            await Promise.resolve();
            return this.findReceipt(r, p);
          });
          if (!result.value)
            throw Error(
              result.consistent ? "RECEIPT_ABSENCE_NOT_NONCOMMITMENT" : "CONSISTENCY_UNESTABLISHED",
            );
          s = deriveOutcome(
            s,
            r.id,
            {
              kind: "ACK",
              receipt: readScanReceipt(result.value, r.payload, p.maxCheckpointBytes),
            },
            p,
          );
        } else if (command.kind === "EXECUTE_ADMITTED") {
          if (
            !p.dispatchEnabled ||
            !p.actor ||
            !c.scannerPolicy.trustedTriggerActors.includes(p.actor)
          )
            throw Error("DISPATCH_DISABLED");
          if (command.limit > Math.min(p.maxDispatchBatch, c.scannerPolicy.maxBatch))
            throw Error("BATCH_BOUNDS");
          const assessments = [...new Map(s.assessments.map((a) => [a.subjectKey, a])).values()];
          if (
            !assessments.length ||
            c.plan.subscriptions.some(
              (sub) =>
                !assessments.some(
                  (a) =>
                    a.subject.sessionId === sub.sessionId &&
                    a.subject.instrumentId === sub.instrumentId &&
                    a.sufficient &&
                    a.expiresAt > this.ports.clock.now(),
                ),
            )
          )
            throw Error("CURRENT_AUTHORITY_MISSING");
          for (const a of assessments) {
            this.call();
            const u = universeSchema.parse(
              unwrap(this.ports.mose.getUniverse(a.subject.sessionId)),
            );
            if (u.checker.actorId !== p.actor) throw Error("ACTOR_UNAUTHORIZED");
            await ownerEvidence(
              this.ports,
              a.subject,
              this.ports.clock.now(),
              this.ports.clock.now(),
              p,
              () => this.call(),
            );
          }
          s.executions.push({
            id: command.id,
            status: "INTENT",
            result: null,
            limit: command.limit,
          });
          await this.save(command, s);
          const outcome = clone(this.state),
            execution = outcome.executions.find((x) => x.id === command.id)!;
          try {
            this.call();
            const returned = readResult(
              await this.ports.scanner.dispatch(command.id, command.limit),
            );
            execution.result = clone(returned, p.maxCheckpointBytes);
            execution.status =
              returned.ok &&
              Array.isArray(returned.value) &&
              returned.value.length <= command.limit &&
              dispatchResultSchema.safeParse(returned.value).success
                ? "ACKNOWLEDGED"
                : "UNRESOLVED";
          } catch (e) {
            execution.status = "UNRESOLVED";
            execution.result = { code: errorCode(e) };
          }
          return ok(await this.save({ ...command, id: command.id + ".outcome" }, outcome));
        }
      }
      return ok(await this.save(command, s));
    } catch (e) {
      return fail(
        errorCode(e),
        this.obligation ||
          this.state.recommendations.some((r) => ["INTENT", "UNRESOLVED"].includes(r.status)) ||
          this.state.executions.some((x) => x.status !== "ACKNOWLEDGED")
          ? "UNKNOWN"
          : "NONE",
      );
    } finally {
      this.busy = false;
    }
  }
  private findReceipt(r: Recommendation, p: AttentionPolicy): ScanRequest | null {
    let total: number | null = null;
    const seen = new Set<string>();
    const pageSize = Math.min(p.maxQueryResults, this.gate().scannerPolicy.maxQueryResults);
    for (let page = 0, offset = 0; page < p.maxQueryPages; page++, offset += pageSize) {
      this.call();
      const v = unwrap(this.ports.scanner.query(offset, pageSize)) as {
        requests: ScanRequest[];
        totalRequests: number;
      };
      if (
        !Number.isSafeInteger(v.totalRequests) ||
        v.totalRequests < 0 ||
        (total !== null && total !== v.totalRequests)
      )
        throw Error("CONSISTENCY_UNESTABLISHED");
      total = v.totalRequests;
      for (const receipt of v.requests) {
        if (seen.has(receipt.trigger.id)) throw Error("ENUMERATION_INCOMPLETE");
        seen.add(receipt.trigger.id);
        if (receipt.trigger.id === r.payload!.id) {
          if (fingerprint(receipt.trigger) !== fingerprint(r.payload))
            throw Error("SCANNER_IDENTITY_CONFLICT");
          return readScanReceipt(receipt, r.payload, p.maxCheckpointBytes);
        }
      }
      if (seen.size === total) return null;
      if (!v.requests.length) throw Error("ENUMERATION_INCOMPLETE");
    }
    throw Error("ENUMERATION_INCOMPLETE");
  }
  dispatchJson(raw: unknown) {
    try {
      if (typeof raw !== "string" || Buffer.byteLength(raw) > (this.policy?.maxInputBytes ?? 65536))
        throw Error("INPUT_BOUNDS");
      return this.dispatch(JSON.parse(raw) as unknown);
    } catch (e) {
      return Promise.resolve(fail(errorCode(e)));
    }
  }
  async reconcilePublication() {
    if (this.busy || !this.obligation) return fail("NO_PUBLICATION_OBLIGATION");
    this.busy = true;
    try {
      const cp = this.obligation,
        rows = unwrap(await this.ports.repository.load());
      if (!Array.isArray(rows) || rows.length > this.policy!.maxRecoverySteps)
        throw Error("RECOVERY_REQUIRED");
      const actual = (rows as unknown[])
        .map((r) => checkpointSchema.parse(r))
        .find((r) => r.generation === cp.generation);
      if (!actual || fingerprint(actual) !== fingerprint(cp)) throw Error("RECOVERY_REQUIRED");
      this.history.push(frozen(clone(cp)));
      this.state = clone(cp.state);
      if (cp.command.kind === "ASSESS") this.lastConsistency = "CONSISTENCY_UNESTABLISHED";
      this.obligation = null;
      this.failure = null;
      return ok(cp);
    } catch (e) {
      return fail(errorCode(e), "UNKNOWN");
    } finally {
      this.busy = false;
    }
  }
  query(offset = 0, limit = 20) {
    try {
      if (!this.initialized || this.stopped || this.busy) throw Error("RUNTIME_NOT_READY");
      this.gate();
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > this.policy!.maxQueryResults
      )
        throw Error("QUERY_BOUNDS");
      return ok(
        frozen({
          state: clone(this.state),
          records: this.history.slice(offset, offset + limit),
          total: this.history.length,
          nextOffset: offset + limit < this.history.length ? offset + limit : null,
          historicalFactsNotCurrentAuthority: true,
          opportunityState: "UNSUPPORTED",
          tradingAuthority: false,
        }),
      );
    } catch (e) {
      return fail(errorCode(e));
    }
  }
  queryHistory(asOf: string, offset = 0, limit = 20) {
    if (
      typeof asOf !== "string" ||
      asOf.length !== 24 ||
      asOf > this.ports.clock.now() ||
      !Number.isFinite(Date.parse(asOf))
    )
      return fail("FUTURE_BOUNDARY");
    const q = this.query(offset, limit);
    if (!q.ok) return q;
    const rows = this.history.filter((x) => x.at <= asOf);
    return ok(
      frozen({
        ...q.value,
        state: clone(rows.at(-1)?.state ?? emptyState()),
        records: rows.slice(offset, offset + limit),
        total: rows.length,
        nextOffset: offset + limit < rows.length ? offset + limit : null,
        scope: "HISTORICAL_NOT_CURRENT_AUTHORITY",
      }),
    );
  }
  diagnostics() {
    const pending =
      this.state.recommendations.filter((r) => ["INTENT", "UNRESOLVED"].includes(r.status)).length +
      this.state.executions.filter((x) => x.status !== "ACKNOWLEDGED").length;
    let configured = false;
    try {
      this.gate();
      configured = true;
    } catch {
      /* Explicit degraded axis below. */
    }
    return frozen({
      lifecycle: this.stopped
        ? "STOPPED"
        : this.stopping
          ? "STOPPING"
          : this.initialized
            ? this.state.phase
            : this.failure
              ? "FAILED"
              : "CREATED",
      readiness:
        this.initialized &&
        ["READY", "RUNNING", "PAUSED"].includes(this.state.phase) &&
        !this.busy &&
        !this.stopped &&
        !this.stopping &&
        !this.obligation &&
        !pending &&
        configured
          ? "READY"
          : "NOT_READY",
      health:
        configured &&
        !this.obligation &&
        !pending &&
        !this.state.assessments.some((a) => !a.sufficient || a.expiresAt <= this.ports.clock.now())
          ? "HEALTHY"
          : "DEGRADED",
      pendingPublications: this.obligation ? 1 : 0,
      pendingSubmissions: pending,
      floorDebt: this.state.floors.filter((f) => f.settledBy === null).length,
      settledFloors: this.state.floors.filter((f) => f.settledBy !== null).length,
      eligibleDenominator: null,
      recordedAllocationEligibleCount:
        this.state.ledgers.at(-1)?.consistency === "ESTABLISHED"
          ? this.state.ledgers.at(-1)!.memberKeys.length
          : null,
      denominatorScope: "CURRENT_UNESTABLISHED_RECORDED_ALLOCATION_IS_HISTORICAL",
      currentReadConsistency: "CONSISTENCY_UNESTABLISHED",
      consistency: this.lastConsistency,
      coverageComplete: false,
      scope: "P27_OWN_RECOMMENDATIONS_NOT_PHASE_COVERAGE",
      opportunityState: "UNSUPPORTED",
      tradingAuthority: false,
      lastError: this.failure,
    });
  }
  async health() {
    if (this.busy || !this.initialized) return fail("RUNTIME_NOT_READY");
    try {
      this.gate();
      const m = readResult(await this.ports.mose.health()),
        s = readResult(await this.ports.scanner.health());
      if (!m.ok || !s.ok) return fail("OWNER_UNAVAILABLE");
      const mv = m.value as { health?: string },
        sv = s.value as { health?: string };
      if (mv?.health !== "HEALTHY" || sv?.health !== "HEALTHY")
        return ok(
          frozen({
            ...this.diagnostics(),
            health: "DEGRADED",
            readiness: "NOT_READY",
            ownerHealth: "UNAVAILABLE_OR_DEGRADED",
          }),
        );
      return ok(this.diagnostics());
    } catch (e) {
      return fail(errorCode(e));
    }
  }
  async stop() {
    await Promise.resolve();
    this.stopping = true;
    if (
      (!this.initialized && this.failure !== null) ||
      this.busy ||
      this.obligation ||
      this.state.recommendations.some((r) => ["INTENT", "UNRESOLVED"].includes(r.status)) ||
      this.state.executions.some((x) => x.status !== "ACKNOWLEDGED")
    )
      return fail("RECOVERY_REQUIRED", "UNKNOWN");
    this.stopped = true;
    return ok(undefined);
  }
  help() {
    return frozen({
      purpose: "Offline computational attention; no opportunity states or execution",
      policy: this.policy,
      submissionDefault: false,
      dispatchDefault: false,
      immutablePlan: true,
      qualifications: ["A26-Q01 OPEN", "A26C-L01 OPEN", "F05", "F06", "T01", "E-T01"],
      consistency: "Matching totals do not prove a concurrent snapshot",
      receipts: "One qualified receipt settles at most one floor; admission is not completion",
      commands: [
        "ASSESS",
        "ALLOCATE",
        "SUBMIT",
        "RECONCILE",
        "EXECUTE_ADMITTED",
        "START",
        "PAUSE",
        "RESUME",
        "STOP",
      ],
    });
  }
}
