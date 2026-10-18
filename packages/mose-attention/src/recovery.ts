import type { AttentionCheckpoint, AttentionPolicy, AttentionState } from "./contracts.js";
import { emptyState, dispatchResultSchema } from "./contracts.js";
import { assess, allocate, deriveIntent, deriveOutcome } from "./engine.js";
import { clone, fingerprint, readResult } from "./primitives.js";
const equal = (a: unknown, b: unknown) => fingerprint(a) === fingerprint(b);
/** Validate domain command deltas, not merely a self-consistent checkpoint hash. */
export function validateDelta(
  previous: AttentionState | undefined,
  next: AttentionCheckpoint,
  p: AttentionPolicy,
): void {
  const before = previous ?? emptyState(),
    after = next.state,
    c = next.command,
    expected = clone(before);
  if (c.kind === "START" || c.kind === "RESUME" || c.kind === "PAUSE" || c.kind === "STOP") {
    const origin = { START: "READY", RESUME: "PAUSED", PAUSE: "RUNNING", STOP: before.phase }[
      c.kind
    ];
    if (before.phase !== origin) throw Error("RECOVERY_LIFECYCLE");
    if (
      c.kind === "STOP" &&
      (before.recommendations.some((r) => ["INTENT", "UNRESOLVED"].includes(r.status)) ||
        before.executions.some((e) => e.status !== "ACKNOWLEDGED"))
    )
      throw Error("RECOVERY_OBLIGATION");
    expected.phase = c.kind === "PAUSE" ? "PAUSED" : c.kind === "STOP" ? "STOPPED" : "RUNNING";
    if (!equal(expected, after)) throw Error("RECOVERY_DELTA");
    return;
  }
  if (before.phase !== "RUNNING") throw Error("RECOVERY_LIFECYCLE");
  if (c.kind === "ASSESS") {
    if (after.assessments.length !== before.assessments.length + 1) throw Error("RECOVERY_DELTA");
    const actual = after.assessments.at(-1)!,
      old = before.assessments.filter((a) => a.subjectKey === fingerprint(c.subject)).at(-1);
    const computed = assess(
      c.subject,
      c.asOf,
      next.at,
      p,
      next.configuration,
      actual.evidence,
      actual.reason,
      old,
    );
    if (!equal(actual, computed)) throw Error("ASSESSMENT_INTEGRITY");
    expected.assessments.push(computed);
  } else if (c.kind === "ALLOCATE") {
    const epoch = Math.floor((Date.parse(c.asOf) - Date.parse(p.anchor)) / p.epochMs),
      l = after.ledgers.find((x) => x.epoch === epoch);
    if (
      !l ||
      !equal(
        after,
        allocate(before, p, c.asOf, c.limit, l.consistency === "ESTABLISHED", l.barrierId),
      )
    )
      throw Error("ALLOCATION_INTEGRITY");
    return;
  } else if (c.kind === "SUBMIT" || c.kind === "RECONCILE") {
    const old = before.recommendations.find((r) => r.id === c.recommendationId),
      actual = after.recommendations.find((r) => r.id === c.recommendationId);
    if (!old || !actual) throw Error("RECOMMENDATION_INTEGRITY");
    let derived: AttentionState;
    if (actual.status === "INTENT") {
      if (c.kind !== "SUBMIT") throw Error("INTENT_INTEGRITY");
      derived = deriveIntent(before, old.id, actual.payload, c.id, p);
    } else {
      if (!actual.outcome) throw Error("OUTCOME_EVIDENCE_MISSING");
      if (
        c.kind === "SUBMIT" &&
        (old.status !== "INTENT" || c.id !== old.intentCommandId + ".outcome")
      )
        throw Error("OUTCOME_COMMAND_IDENTITY");
      if (c.kind === "RECONCILE" && actual.outcome.kind !== "ACK")
        throw Error("RECONCILIATION_EVIDENCE_MISSING");
      derived = deriveOutcome(before, old.id, actual.outcome, p);
    }
    if (!equal(after, derived)) throw Error("OUTCOME_DELTA_INTEGRITY");
    return;
  } else if (c.kind === "EXECUTE_ADMITTED") {
    const old = before.executions.find((x) => x.id === c.id.replace(/\.outcome$/u, "")),
      actual = after.executions.find((x) => x.id === (old?.id ?? c.id));
    if (!actual) throw Error("EXECUTION_INTEGRITY");
    if (old) {
      if (
        old.status !== "INTENT" ||
        actual.status === "INTENT" ||
        c.id !== old.id + ".outcome" ||
        old.limit !== c.limit ||
        actual.limit !== old.limit
      )
        throw Error("EXECUTION_INTEGRITY");
      let acknowledged = false;
      const raw = actual.result as Record<string, unknown> | null;
      const exception =
        raw !== null &&
        typeof raw === "object" &&
        Object.keys(raw).length === 1 &&
        typeof raw.code === "string" &&
        /^[A-Z0-9_]{1,128}$/u.test(raw.code);
      if (!exception) {
        const result = readResult(raw);
        if (result.ok && Array.isArray(result.value) && result.value.length <= c.limit) {
          acknowledged = dispatchResultSchema.safeParse(result.value).success;
        }
      }
      if ((actual.status === "ACKNOWLEDGED") !== acknowledged)
        throw Error("EXECUTION_RESULT_INTEGRITY");
      expected.executions[expected.executions.findIndex((x) => x.id === old.id)] = actual;
    } else {
      if (
        actual.status !== "INTENT" ||
        actual.result !== null ||
        actual.limit !== c.limit ||
        c.limit > p.maxDispatchBatch
      )
        throw Error("EXECUTION_INTEGRITY");
      expected.executions.push(actual);
    }
  }
  if (!equal(expected, after)) throw Error("RECOVERY_DELTA");
}
