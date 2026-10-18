import type { AttentionCheckpoint, AttentionPolicy, AttentionState } from "./contracts.js";
import { emptyState } from "./contracts.js";
import { assess, allocate, epochAt } from "./engine.js";
import { clone, fingerprint } from "./primitives.js";
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
    if (
      !old ||
      !actual ||
      !equal(
        {
          ...old,
          payload: null,
          status: "PROPOSED",
          attempts: 0,
          reason: "X",
          receiptId: null,
          receiptFingerprint: null,
        },
        {
          ...actual,
          payload: null,
          status: "PROPOSED",
          attempts: 0,
          reason: "X",
          receiptId: null,
          receiptFingerprint: null,
        },
      )
    )
      throw Error("RECOMMENDATION_INTEGRITY");
    if (old.payload && !equal(old.payload, actual.payload)) throw Error("PAYLOAD_REWRITTEN");
    if (actual.status === "INTENT") {
      if (
        !["PROPOSED", "REJECTED"].includes(old.status) ||
        actual.attempts !== old.attempts + 1 ||
        !actual.payload ||
        c.kind !== "SUBMIT"
      )
        throw Error("INTENT_INTEGRITY");
    } else if (!["INTENT", "UNRESOLVED"].includes(old.status) || actual.attempts !== old.attempts)
      throw Error("OUTCOME_INTEGRITY");
    if (actual.status === "ADMITTED" && actual.floorId) {
      const floor = after.floors.find((f) => f.id === actual.floorId);
      if (
        !floor ||
        !actual.payload ||
        epochAt(actual.payload.boundary, p) !== floor.epoch ||
        floor.settledBy !== actual.payload.id
      )
        throw Error("FLOOR_EPOCH_MISMATCH");
    }
    if (actual.receiptId && actual.receiptId !== actual.payload?.id)
      throw Error("RECEIPT_IDENTITY");
    const idx = expected.recommendations.findIndex((r) => r.id === old.id);
    expected.recommendations[idx] = actual;
    // Only the bound floor and its original-epoch credit may change during an outcome.
    if (old.floorId) {
      const f = after.floors.find((f) => f.id === old.floorId),
        prior = before.floors.find((f) => f.id === old.floorId);
      if (
        !f ||
        !prior ||
        !equal(
          { ...f, reservation: null, settledBy: null },
          { ...prior, reservation: null, settledBy: null },
        ) ||
        (prior.settledBy && f.settledBy !== prior.settledBy)
      )
        throw Error("DEBT_REWRITTEN");
      expected.floors[expected.floors.findIndex((x) => x.id === f.id)] = f;
      const l = after.ledgers.find((l) => l.epoch === old.epoch),
        prev = expected.ledgers.find((l) => l.epoch === old.epoch);
      if (!l || !prev) throw Error("BUDGET_INTEGRITY");
      prev.credits[old.instrumentKey] = l.credits[old.instrumentKey] ?? 0;
    }
  } else if (c.kind === "EXECUTE_ADMITTED") {
    const old = before.executions.find((x) => x.id === c.id.replace(/\.outcome$/u, "")),
      actual = after.executions.find((x) => x.id === (old?.id ?? c.id));
    if (!actual) throw Error("EXECUTION_INTEGRITY");
    if (old) {
      if (old.status !== "INTENT" || actual.status === "INTENT") throw Error("EXECUTION_INTEGRITY");
      expected.executions[expected.executions.findIndex((x) => x.id === old.id)] = actual;
    } else {
      if (actual.status !== "INTENT" || actual.result !== null) throw Error("EXECUTION_INTEGRITY");
      expected.executions.push(actual);
    }
  }
  if (!equal(expected, after)) throw Error("RECOVERY_DELTA");
}
