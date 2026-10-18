import {
  tiers,
  weights,
  type AttentionAssessment,
  type AttentionPolicy,
  type AttentionState,
  type Evidence,
  type Subject,
  type Recommendation,
  type SubmissionOutcome,
  outcomeSchema,
} from "./contracts.js";
import { fingerprint, clone, errorCode, readScanReceipt } from "./primitives.js";
export const epochAt = (at: string, p: AttentionPolicy) => {
  const n = Math.floor((Date.parse(at) - Date.parse(p.anchor)) / p.epochMs);
  if (!Number.isSafeInteger(n) || n < 0) throw Error("EPOCH_INVALID");
  return n;
};
export const instrumentKey = (s: Subject) => fingerprint([s.sessionId, s.universe, s.instrumentId]);
export function assess(
  subject: Subject,
  at: string,
  now: string,
  p: AttentionPolicy,
  configuration: string,
  evidence: Evidence | null,
  reason: string,
  old: AttentionAssessment | undefined,
): AttentionAssessment {
  const epoch = epochAt(at, p),
    key = fingerprint(subject);
  if (old && at < old.asOf) throw Error("ASSESSMENT_ORDER");
  const consecutive = old?.epoch === epoch - 1;
  const changed =
    !!evidence &&
    !!old?.evidence &&
    evidence.observationId !== old.evidence.observationId &&
    evidence.dependency !== old.evidence.dependency;
  let tier = old && old.expiresAt > at ? old.tier : "STANDARD",
    up = 0,
    down = 0,
    last = old?.lastChangeEpoch ?? -2;
  if (evidence) {
    if (old?.epoch === epoch) {
      up = old.changedStreak;
      down = old.stableStreak;
    } else if (old?.sufficient && consecutive) {
      up = changed ? Math.min(2, old.changedStreak + 1) : 0;
      down = changed ? 0 : Math.min(2, old.stableStreak + 1);
    }
    if (old && epoch !== old.epoch && epoch - last >= 2) {
      const index = tiers.indexOf(tier);
      if (up >= 2 && index < 4) {
        tier = tiers[index + 1]!;
        last = epoch;
        up = 0;
        reason = "EVIDENCE_ESCALATED";
      } else if (down >= 2 && index > 0) {
        tier = tiers[index - 1]!;
        last = epoch;
        down = 0;
        reason = "STABLE_DEESCALATED";
      }
    }
  }
  const body = {
    owner: "MOSE_ATTENTION" as const,
    ownerVersion: "0.27.0-adaptive-surveillance.1" as const,
    reasonCodes: [
      reason,
      ...(evidence?.ownerHealth === "DEGRADED" ? ["OWNER_DEGRADED_OTHER_SCOPE"] : []),
      ...(!evidence ? ["CURRENT_AUTHORITY_UNESTABLISHED", "BOOST_WITHHELD"] : []),
      ...(old && old.expiresAt <= at ? ["EXPIRED_PREDECESSOR"] : []),
      ...(old && old.epoch !== epoch && old.epoch !== epoch - 1 ? ["NONCONSECUTIVE_EPOCH"] : []),
      ...(epoch - last < 2 ? ["COOLDOWN_ACTIVE"] : []),
    ],
    effectiveFrom: at,
    cooldownUntil: new Date(Date.parse(p.anchor) + (last + 2) * p.epochMs).toISOString(),
    schemaVersion: 1 as const,
    subject,
    subjectKey: key,
    epoch,
    asOf: at,
    evaluatedAt: now,
    policy: fingerprint(p),
    configuration,
    previous: old?.id ?? null,
    evidence,
    tier,
    sufficient: evidence !== null,
    reason,
    changedStreak: up,
    stableStreak: down,
    lastChangeEpoch: last,
    expiresAt: new Date(Date.parse(p.anchor) + (epoch + 3) * p.epochMs).toISOString(),
    recommendedCadence: "RECOMMENDATION_ONLY_INSTALLED_PLAN_UNCHANGED",
    proposedBudget: evidence ? weights[tiers.indexOf(tier)]! : 0,
    opportunityState: "UNSUPPORTED" as const,
    currentAuthority: evidence ? ("VERIFIED" as const) : ("UNESTABLISHED" as const),
  };
  return { ...body, id: fingerprint(body) };
}
export function allocate(
  state: AttentionState,
  p: AttentionPolicy,
  at: string,
  limit: number,
  consistent: boolean,
  barrierId: string | null = null,
): AttentionState {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > p.maxProposalsPerEpoch)
    throw Error("ALLOCATION_BOUNDS");
  const epoch = epochAt(at, p),
    s = clone(state),
    latest = new Map(s.assessments.map((a) => [a.subjectKey, a]));
  const members = [...latest.values()]
    .filter((a) => a.epoch === epoch && a.sufficient && a.expiresAt > at)
    .sort((a, b) => (a.subjectKey < b.subjectKey ? -1 : 1));
  const groups = new Map<string, AttentionAssessment[]>();
  for (const a of members) {
    const k = instrumentKey(a.subject);
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  if (groups.size > p.maxInstruments) throw Error("INSTRUMENT_LIMIT");
  let l = s.ledgers.find((x) => x.epoch === epoch);
  if (!l) {
    const prior = s.ledgers.at(-1);
    if (prior && prior.epoch > epoch) throw Error("EPOCH_ORDER");
    l = {
      epoch,
      spent: 0,
      credits: { ...(prior?.credits ?? {}) },
      bonus: { ...(prior?.bonus ?? {}) },
      bonusAccrued: [],
      bonuses: {},
      lastInstrument: prior?.lastInstrument ?? null,
      lastSubject: { ...(prior?.lastSubject ?? {}) },
      memberKeys: [],
      consistency: consistent ? "ESTABLISHED" : "CONSISTENCY_UNESTABLISHED",
      barrierId,
    };
    s.ledgers.push(l);
  }
  l.consistency = consistent ? "ESTABLISHED" : "CONSISTENCY_UNESTABLISHED";
  l.barrierId = barrierId;
  for (const [k, list] of groups) {
    const id = fingerprint(["floor.v1", k, epoch]);
    if (!s.floors.some((f) => f.id === id)) {
      s.floors.push({
        id,
        instrumentKey: k,
        subjectKey: list[0]!.subjectKey,
        epoch,
        policy: fingerprint(p),
        settledBy: null,
        reservation: null,
      });
      l.credits[k] = Math.min(p.creditCap, (l.credits[k] ?? 0) + 1);
    }
    if (!l.memberKeys.includes(k)) l.memberKeys.push(k);
  }
  l.memberKeys.sort();
  if (!consistent) return s;
  let slots = Math.min(limit, p.maxProposalsPerEpoch - l.spent);
  const order = new Map<string, string>();
  for (const a of s.assessments) {
    order.set(
      instrumentKey(a.subject),
      JSON.stringify([a.subject.sessionId, a.subject.universe, a.subject.instrumentId]),
    );
    order.set(a.subjectKey, JSON.stringify(a.subject));
  }
  const compare = (a: string, b: string) =>
    (order.get(a) ?? a) < (order.get(b) ?? b)
      ? -1
      : (order.get(a) ?? a) === (order.get(b) ?? b)
        ? 0
        : 1;
  const keys = [...groups.keys()].sort(compare);
  const rotate = (xs: string[], after: string | null) =>
    after === null
      ? xs
      : [...xs.filter((x) => compare(x, after) > 0), ...xs.filter((x) => compare(x, after) <= 0)];
  const propose = (k: string, floor: AttentionState["floors"][number] | null) => {
    const list = groups.get(k)!,
      subjectKeys = list.map((a) => a.subjectKey).sort(compare),
      key = rotate(subjectKeys, l.lastSubject[k] ?? null)[0]!,
      latest = list.find((x) => x.subjectKey === key)!;
    const a = floor
      ? (s.assessments
          .filter((a) => a.subjectKey === key && a.epoch === floor.epoch && a.sufficient)
          .at(-1) ?? latest)
      : latest;
    const subscription = a.subject.subscriptions[l.spent % a.subject.subscriptions.length]!;
    const id = fingerprint([
      "recommendation.v1",
      a.id,
      epoch,
      l.spent,
      k,
      subscription,
      floor?.id ?? null,
    ]);
    const recommendation: Recommendation = {
      id,
      assessmentId: a.id,
      subjectKey: key,
      instrumentKey: k,
      epoch,
      subscriptionId: subscription,
      floorId: floor?.id ?? null,
      payload: null,
      status: "PROPOSED",
      attempts: 0,
      reason: "RECOMMENDATION_ONLY",
      receiptId: null,
      receiptFingerprint: null,
    };
    s.recommendations.push(recommendation);
    if (floor) {
      floor.reservation = id;
      l.credits[k] = Math.max(0, (l.credits[k] ?? 0) - 1);
    }
    l.lastSubject[k] = key;
    l.lastInstrument = k;
    l.spent++;
    slots--;
  };
  // Oldest retained unserved floors first. Reservations never count as admitted settlement.
  let progress = true;
  while (slots > 0 && progress) {
    progress = false;
    for (const k of rotate(keys, l.lastInstrument)) {
      if (slots <= 0) break;
      const f = s.floors.find(
        (f) => f.instrumentKey === k && f.settledBy === null && f.reservation === null,
      );
      if (f && (l.credits[k] ?? 0) > 0) {
        propose(k, f);
        progress = true;
      }
    }
  }
  const unresolved = s.floors.some(
    (f) => groups.has(f.instrumentKey) && f.epoch <= epoch && f.settledBy === null,
  );
  if (!unresolved) {
    for (const k of keys)
      if (!l.bonusAccrued.includes(k)) {
        const a = groups.get(k)![0]!;
        l.bonus[k] = Math.min(32, (l.bonus[k] ?? 0) + weights[tiers.indexOf(a.tier)]!);
        l.bonusAccrued.push(k);
      }
    while (slots > 0) {
      const eligible = keys
        .filter((k) => (l.bonus[k] ?? 0) >= 8 && (l.bonuses[k] ?? 0) < p.maxBoostPerInstrument)
        .sort(
          (a, b) =>
            (l.bonus[b] ?? 0) - (l.bonus[a] ?? 0) ||
            s.recommendations.findLastIndex((r) => r.floorId === null && r.instrumentKey === a) -
              s.recommendations.findLastIndex((r) => r.floorId === null && r.instrumentKey === b) ||
            compare(a, b),
        );
      const k = eligible[0];
      if (!k) break;
      propose(k, null);
      l.bonus[k] = (l.bonus[k] ?? 0) - 8;
      l.bonuses[k] = (l.bonuses[k] ?? 0) + 1;
    }
  }
  return s;
}
export function settle(
  s: AttentionState,
  r: Recommendation,
  receipt: { id: string; fingerprint: string; disposition: string },
  p: AttentionPolicy,
): void {
  if (
    s.recommendations.some((x) => x.id !== r.id && x.receiptId === receipt.id && x.floorId !== null)
  )
    throw Error("RECEIPT_ALREADY_SETTLED");
  const qualifies = ["DUE", "COMPLETED", "DEFERRED"].includes(receipt.disposition);
  const floor = qualifies && r.floorId ? s.floors.find((f) => f.id === r.floorId) : undefined;
  if (qualifies && r.floorId) {
    if (!floor || floor.reservation !== r.id || floor.settledBy !== null)
      throw Error("FLOOR_CONFLICT");
    if (
      r.payload &&
      (epochAt(r.payload.boundary, p) !== floor.epoch || r.payload.id !== receipt.id)
    )
      throw Error("FLOOR_EPOCH_MISMATCH");
  }
  r.receiptId = receipt.id;
  r.receiptFingerprint = receipt.fingerprint;
  if (!qualifies) {
    r.status = "RECOMMENDATION_ONLY";
    r.reason = "RECEIPT_NOT_FLOOR_SERVICE";
    return;
  }
  r.status = "ADMITTED";
  r.reason = "SCANNER_ADMISSION_NOT_COMPLETION";
  if (floor) {
    floor.settledBy = receipt.id;
    floor.reservation = null;
  }
}
export function validateState(s: AttentionState, p: AttentionPolicy): void {
  if (
    s.assessments.length > p.maxHistory ||
    s.floors.length > p.maxHistory ||
    s.recommendations.length > p.maxHistory ||
    s.ledgers.length > p.maxHistory
  )
    throw Error("RETAINED_BOUNDS");
  for (const rows of [s.assessments, s.floors, s.recommendations])
    if (new Set(rows.map((x) => x.id)).size !== rows.length) throw Error("DUPLICATE_IDENTITY");
  if (
    new Set(s.floors.filter((f) => f.settledBy !== null).map((f) => f.settledBy)).size !==
    s.floors.filter((f) => f.settledBy !== null).length
  )
    throw Error("RECEIPT_ALREADY_SETTLED");
  for (const l of s.ledgers) {
    if (
      l.spent > p.maxProposalsPerEpoch ||
      s.recommendations.filter((r) => r.epoch === l.epoch).length !== l.spent
    )
      throw Error("BUDGET_INTEGRITY");
  }
  for (const f of s.floors)
    if (
      f.reservation &&
      !s.recommendations.some((r) => r.id === f.reservation && r.floorId === f.id)
    )
      throw Error("FLOOR_CONFLICT");
}

/** maxAttemptRetries is the fixed total admitted-call-attempt allowance, including initial call. */
export function obligationAttempts(s: AttentionState, r: Recommendation): number {
  return s.recommendations
    .filter((x) => (r.floorId !== null ? x.floorId === r.floorId : x.id === r.id))
    .reduce((n, x) => n + x.attempts, 0);
}
export function deriveIntent(
  before: AttentionState,
  id: string,
  payload: Recommendation["payload"],
  commandId: string,
  p: AttentionPolicy,
): AttentionState {
  const s = clone(before),
    r = s.recommendations.find((x) => x.id === id);
  if (!r || !["PROPOSED", "REJECTED"].includes(r.status) || !payload)
    throw Error("INTENT_INTEGRITY");
  if (obligationAttempts(s, r) >= p.maxAttemptRetries) throw Error("OBLIGATION_RETRY_EXHAUSTED");
  if (
    payload.id !== "attention-" + r.id.slice(7) ||
    payload.subscriptionId !== r.subscriptionId ||
    (r.payload && fingerprint(r.payload) !== fingerprint(payload))
  )
    throw Error("PAYLOAD_REWRITTEN");
  if (r.floorId) {
    const f = s.floors.find((x) => x.id === r.floorId);
    if (
      !f ||
      f.settledBy ||
      (f.reservation !== null && f.reservation !== r.id) ||
      epochAt(payload.boundary, p) !== f.epoch
    )
      throw Error("FLOOR_CONFLICT");
    if (f.reservation === null) {
      const l = s.ledgers.find((x) => x.epoch === r.epoch);
      if (!l) throw Error("BUDGET_INTEGRITY");
      f.reservation = r.id;
      l.credits[r.instrumentKey] = Math.max(0, (l.credits[r.instrumentKey] ?? 0) - 1);
    }
  }
  r.payload = clone(payload);
  r.status = "INTENT";
  r.attempts++;
  r.intentCommandId = commandId;
  delete r.outcome;
  return s;
}
/** Pure derivation makes live mutation and recovery compare the same exact lawful delta. */
export function deriveOutcome(
  before: AttentionState,
  id: string,
  raw: SubmissionOutcome,
  p: AttentionPolicy,
): AttentionState {
  const s = clone(before),
    r = s.recommendations.find((x) => x.id === id),
    outcome = outcomeSchema.parse(raw);
  if (!r || !r.payload || !r.intentCommandId || !["INTENT", "UNRESOLVED"].includes(r.status))
    throw Error("OUTCOME_INTEGRITY");
  if (r.status === "UNRESOLVED" && outcome.kind !== "ACK")
    throw Error("RECONCILIATION_EVIDENCE_MISSING");
  if (outcome.kind === "ACK") {
    const receipt = readScanReceipt(outcome.receipt, r.payload, p.maxCheckpointBytes);
    settle(
      s,
      r,
      {
        id: receipt.trigger.id,
        fingerprint: fingerprint(receipt),
        disposition: receipt.disposition,
      },
      p,
    );
    r.outcome = { kind: "ACK", receipt };
  } else {
    r.receiptId = null;
    r.receiptFingerprint = null;
    r.status =
      outcome.kind === "NEGATIVE" && outcome.commitment === "NONE" ? "REJECTED" : "UNRESOLVED";
    r.reason = outcome.kind === "UNCERTAIN" ? outcome.code : errorCode(Error(outcome.code));
    r.outcome = outcome;
    if (r.status === "REJECTED" && r.floorId) {
      const f = s.floors.find((x) => x.id === r.floorId),
        l = s.ledgers.find((x) => x.epoch === r.epoch);
      if (!f || !l || f.reservation !== r.id || f.settledBy !== null) throw Error("FLOOR_CONFLICT");
      f.reservation = null;
      l.credits[r.instrumentKey] = Math.min(p.creditCap, (l.credits[r.instrumentKey] ?? 0) + 1);
    }
  }
  return s;
}
