import { it, expect } from "vitest";
import {
  assess,
  allocate,
  settle,
  validateState,
  epochAt,
  emptyState,
  defaultAttentionPolicy,
  fingerprint,
  policySchema,
  tiers,
  type Subject,
  type Evidence,
  type AttentionState,
} from "@ate/mose-attention";
import { mustParseUtc } from "@ate/time";
const p = { ...defaultAttentionPolicy, anchor: "2026-01-01T00:00:00.000Z" };
const at = (n: number) => mustParseUtc(new Date(Date.parse(p.anchor) + n * 60000).toISOString());
const subject = (id = "A"): Subject => ({
  sessionId: "S",
  universe: fingerprint("U"),
  instrumentId: id,
  subscriptions: ["rescan"],
});
const evidence = (id: number, instrumentId = "A"): Evidence => ({
  ownerHealth: "HEALTHY",
  sourceScopeHealthy: true,
  owner: "MOSE_CORE",
  ownerVersion: "0.25.0-mose-core.1",
  recordFingerprint: fingerprint(["record", id]),
  publication: {
    runtimeId: "unit-owner",
    generation: 1,
    fingerprint: fingerprint(["publication", id]),
  },
  replayInputFingerprint: fingerprint("input"),
  lineage: {
    key: fingerprint(["plan", id]),
    instrumentId,
    source: { sessionId: "unit-replay", checkpoint: "unit-checkpoint" },
    eventId: "event-" + id,
    sourceCursor: "cursor-" + id,
    ownerOrdinal: id,
    eventAt: at(id),
    boundaryAt: at(id),
    timeframe: "M1",
    datasetId: "dataset",
    datasetVersion: "v1",
    datasetVersionFingerprint: fingerprint("dataset-version"),
    datasetContentFingerprint: fingerprint("content"),
    qualityReportId: "quality",
    qualityFingerprint: fingerprint("quality"),
    manifestId: "manifest",
    manifestFingerprint: fingerprint("manifest"),
    payloadFingerprint: fingerprint(["payload", id]),
    evidenceClass: "VERIFIED_POINT_IN_TIME",
  },
  observationId: fingerprint(["O", id]),
  dependency: fingerprint(["D", id]),
  availableAt: at(id),
  eventAt: at(id),
  source: fingerprint("source"),
  policy: fingerprint("policy"),
  finality: "NOT_APPLICABLE",
});
const make = (id = "A", n = 0) =>
  assess(
    subject(id),
    at(n),
    at(n),
    p,
    fingerprint("config"),
    evidence(n, id),
    "EVIDENCE_QUALIFIED",
    undefined,
  );
function state(ids = ["A"]): AttentionState {
  return { ...emptyState(), phase: "RUNNING", assessments: ids.map((id) => make(id)) };
}
// Independent finite-tier oracle, deliberately does not call implementation helpers.
function tierOracle(values: (number | null)[]) {
  let tier = 2,
    up = 0,
    down = 0,
    last = -2;
  return values.map((v, i) => {
    if (v === null) {
      up = down = 0;
      return tiers[tier];
    }
    if (i > 0 && values[i - 1] !== null) {
      if (v !== values[i - 1]) {
        up++;
        down = 0;
      } else {
        down++;
        up = 0;
      }
      if (i - last >= 2 && up >= 2 && tier < 4) {
        tier++;
        last = i;
        up = 0;
      } else if (i - last >= 2 && down >= 2 && tier > 0) {
        tier--;
        last = i;
        down = 0;
      }
    }
    return tiers[tier];
  });
}
const tierCases = [
  [0],
  [0, 1],
  [0, 1, 2],
  [0, 0, 0],
  [0, 1, 2, 3],
  [0, 1, 2, 3, 4],
  [0, 1, 2, 3, 4, 5, 6],
  [0, 0, 0, 0, 0],
  [0, 1, null, 3],
  [0, null, 2, 3],
  [0, 1, 1, 1],
  [0, 1, 2, 2, 2],
  [0, 1, 2, 3, 3, 3],
  [0, 0, 1, 1, 1],
  [0, 1, 0, 1, 0],
  [0, null, null, 3, 4],
] as (number | null)[][];
it.each(tierCases)("independent tier epoch oracle %#", (...values) => {
  let old: ReturnType<typeof assess> | undefined;
  const actual = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    old = assess(
      subject(),
      at(i),
      at(i),
      p,
      fingerprint("C"),
      v === null ? null : evidence(v),
      v === null ? "SOURCE_UNAVAILABLE" : "EVIDENCE_QUALIFIED",
      old,
    );
    actual.push(old.tier);
  }
  expect(actual).toEqual(tierOracle(values));
});
it("same-epoch repeated changed evidence earns no confirmation", () => {
  let old = make();
  for (let n = 1; n < 8; n++)
    old = assess(
      subject(),
      at(0),
      at(0),
      p,
      fingerprint("C"),
      evidence(n),
      "EVIDENCE_QUALIFIED",
      old,
    );
  expect(old.tier).toBe("STANDARD");
  expect(old.changedStreak).toBe(0);
});
it("missing epoch resets escalation streak rather than fabricating observation", () => {
  const a = make(),
    b = assess(subject(), at(1), at(1), p, fingerprint("C"), evidence(1), "X", a),
    c = assess(subject(), at(3), at(3), p, fingerprint("C"), evidence(3), "X", b);
  expect(c.tier).toBe("STANDARD");
  expect(c.changedStreak).toBe(0);
});
it("unknown evidence grants no discretionary budget even if historical tier high", () => {
  const old = { ...make(), tier: "HIGH" as const };
  const a = assess(subject(), at(1), at(1), p, fingerprint("C"), null, "OWNER_UNKNOWN", old);
  expect(a.proposedBudget).toBe(0);
  expect(a.currentAuthority).toBe("UNESTABLISHED");
});
it("as-of order cannot regress subject history", () => {
  expect(() =>
    assess(subject(), at(0), at(0), p, fingerprint("C"), evidence(0), "X", make("A", 1)),
  ).toThrow("ASSESSMENT_ORDER");
});
it.each([1, 2, 3, 4, 8, 16, 32])("floor conservation oracle across %i instruments", (count) => {
  const ids = Array.from({ length: count }, (_, i) => "I" + String(i).padStart(2, "0"));
  let s = state(ids);
  s = allocate(s, p, at(0), 32, true);
  expect(s.floors).toHaveLength(count);
  expect(s.recommendations).toHaveLength(count);
  expect(s.ledgers[0]!.spent).toBe(count);
  expect(s.floors.every((f) => f.settledBy === null && f.reservation !== null)).toBe(true);
  expect(Object.values(s.ledgers[0]!.credits).reduce((a, b) => a + b, 0)).toBe(0);
  validateState(s, p);
});
it("new allocation identity cannot mint epoch floor or bonus budget", () => {
  let s = allocate(state(), p, at(0), 32, true);
  for (let i = 0; i < 10; i++) s = allocate(s, p, at(0), 32, true);
  expect(s.recommendations).toHaveLength(1);
  expect(s.ledgers[0]!.spent).toBe(1);
  expect(s.ledgers[0]!.bonusAccrued).toEqual([]);
});
it("small budget rotates to the previously unserved peer", () => {
  const small = { ...p, maxProposalsPerEpoch: 1 };
  let s = allocate(state(["A", "B"]), small, at(0), 1, true);
  expect(s.recommendations).toHaveLength(1);
  const prior = s.recommendations[0]!.instrumentKey;
  s.assessments.push(make("A", 1), make("B", 1));
  s = allocate(s, small, at(1), 1, true);
  expect(s.recommendations[1]!.instrumentKey).not.toBe(prior);
  expect(s.floors.filter((f) => !f.settledBy)).toHaveLength(4);
});
it("unestablished consistency never grants proposals or settled floors", () => {
  const s = allocate(state(), p, at(0), 32, false);
  expect(s.recommendations).toEqual([]);
  expect(s.ledgers[0]!.consistency).toBe("CONSISTENCY_UNESTABLISHED");
  expect(s.floors[0]!.settledBy).toBeNull();
});
it("policy revision cannot regenerate same epoch credit", () => {
  let s = allocate(state(), p, at(0), 32, true);
  s = allocate(s, { ...p, version: "next" }, at(0), 32, true);
  expect(s.recommendations).toHaveLength(1);
  expect(s.floors).toHaveLength(1);
});
it("membership revision cannot reset spent quota", () => {
  const small = { ...p, maxProposalsPerEpoch: 1 };
  let s = allocate(state(), small, at(0), 1, true);
  s.assessments.push(make("B"));
  s = allocate(s, small, at(0), 1, true);
  expect(s.recommendations).toHaveLength(1);
  expect(s.floors).toHaveLength(2);
});
it("credit cap does not erase the exact old floor ledger", () => {
  let s = state();
  for (let n = 0; n < 8; n++) {
    if (n) s.assessments.push(make("A", n));
    s = allocate(s, p, at(n), 1, false);
  }
  expect(s.floors).toHaveLength(8);
  expect(Object.values(s.ledgers.at(-1)!.credits)).toEqual([4]);
  expect(s.floors.every((f) => !f.settledBy)).toBe(true);
});
it("allocation persists independently for future callback mutation", () => {
  const s = state(),
    before = JSON.stringify(s);
  allocate(s, p, at(0), 32, true);
  expect(JSON.stringify(s)).toBe(before);
});
it.each([0, -1, 33, 1.5, NaN, Infinity])(
  "invalid allocation budget %s rejects without mutation",
  (limit) => {
    const s = state();
    expect(() => allocate(s, p, at(0), limit, true)).toThrow("ALLOCATION_BOUNDS");
    expect(s.recommendations).toEqual([]);
  },
);
it.each(["COALESCED", "SKIPPED", "REJECTED", "UNKNOWN", "QUARANTINED", "CANCELLED"])(
  "receipt %s cannot silently settle floor",
  (disposition) => {
    const s = allocate(state(), p, at(0), 32, true),
      r = s.recommendations[0]!;
    settle(s, r, { id: "receipt", fingerprint: fingerprint("R"), disposition }, p);
    expect(s.floors[0]!.settledBy).toBeNull();
    expect(r.status).toBe("RECOMMENDATION_ONLY");
  },
);
it.each(["DUE", "DEFERRED", "COMPLETED"])(
  "genuine %s receipt settles only its own floor",
  (disposition) => {
    const s = allocate(state(["A", "B"]), p, at(0), 32, true);
    settle(
      s,
      s.recommendations[0]!,
      { id: "receipt", fingerprint: fingerprint("R"), disposition },
      p,
    );
    expect(s.floors.filter((f) => f.settledBy !== null)).toHaveLength(1);
  },
);
it("single receipt cannot settle a second historical floor", () => {
  let s = allocate(state(), p, at(0), 32, true);
  settle(
    s,
    s.recommendations[0]!,
    { id: "same", fingerprint: fingerprint("R"), disposition: "DUE" },
    p,
  );
  s.assessments.push(make("A", 1));
  s = allocate(s, p, at(1), 32, true);
  expect(() =>
    settle(
      s,
      s.recommendations[1]!,
      { id: "same", fingerprint: fingerprint("R"), disposition: "DUE" },
      p,
    ),
  ).toThrow("RECEIPT_ALREADY_SETTLED");
  expect(s.floors[1]!.settledBy).toBeNull();
});
it("forged floor reservation cannot establish admission", () => {
  const s = allocate(state(), p, at(0), 32, true);
  s.floors[0]!.reservation = fingerprint("other");
  expect(() =>
    settle(
      s,
      s.recommendations[0]!,
      { id: "R", fingerprint: fingerprint("R"), disposition: "DUE" },
      p,
    ),
  ).toThrow("FLOOR_CONFLICT");
});
it("recovery rejects duplicate settlement identities", () => {
  const s = allocate(state(["A", "B"]), p, at(0), 32, true);
  s.floors[0]!.settledBy = "R";
  s.floors[1]!.settledBy = "R";
  expect(() => validateState(s, p)).toThrow("RECEIPT_ALREADY_SETTLED");
});
it("recovery rejects spent counter smaller than retained proposals", () => {
  const s = allocate(state(), p, at(0), 32, true);
  s.ledgers[0]!.spent = 0;
  expect(() => validateState(s, p)).toThrow("BUDGET_INTEGRITY");
});
it("recovery rejects missing reservation evidence", () => {
  const s = allocate(state(), p, at(0), 32, true);
  s.recommendations = [];
  s.ledgers[0]!.spent = 0;
  expect(() => validateState(s, p)).toThrow("FLOOR_CONFLICT");
});
it.each([
  "maxInstruments",
  "maxSubjects",
  "maxOwnerCallsPerCommand",
  "maxHistory",
  "maxQueryPages",
  "maxAttemptRetries",
  "creditCap",
  "maxBoostPerInstrument",
  "maxInputDepth",
  "maxRetainedBytes",
] as const)("configuration cap %s cannot be silently relaxed", (key) => {
  expect(policySchema.safeParse({ ...p, [key]: p[key] + 1 }).success).toBe(false);
  expect(policySchema.safeParse({ ...p, [key]: 0 }).success).toBe(false);
});
it("epoch uses supplied clock anchor and inclusive boundary", () => {
  expect(epochAt(p.anchor, p)).toBe(0);
  expect(epochAt(at(1), p)).toBe(1);
  expect(() => epochAt(new Date(Date.parse(p.anchor) - 1).toISOString(), p)).toThrow(
    "EPOCH_INVALID",
  );
});
it("current-epoch receipt cannot falsely settle older epoch service", () => {
  const s = allocate(state(), p, at(0), 32, true);
  const r = s.recommendations[0]!;
  r.payload = {
    id: "wrong-epoch",
    subscriptionId: "rescan",
    boundary: at(1),
    kind: "RESEARCH_RESCAN",
    actor: "checker",
    cause: "source",
    evidence: fingerprint("E"),
  };
  expect(() =>
    settle(s, r, { id: "wrong-epoch", fingerprint: fingerprint("R"), disposition: "DUE" }, p),
  ).toThrow("FLOOR_EPOCH_MISMATCH");
  expect(s.floors[0]!.settledBy).toBeNull();
});
it("fixed public tier semantics cannot be mutated by a consumer", () => {
  expect(Reflect.set(tiers, 0, "HIGH")).toBe(false);
  expect(tiers[0]).toBe("MINIMAL");
});
it("failed epoch settlement leaves the complete recommendation unchanged", () => {
  const s = allocate(state(), p, at(0), 32, true),
    r = s.recommendations[0]!;
  r.payload = {
    id: "wrong",
    subscriptionId: "rescan",
    boundary: at(1),
    kind: "RESEARCH_RESCAN",
    actor: "checker",
    cause: "source",
    evidence: fingerprint("E"),
  };
  const before = JSON.stringify(s);
  expect(() =>
    settle(s, r, { id: "wrong", fingerprint: fingerprint("R"), disposition: "DUE" }, p),
  ).toThrow("FLOOR_EPOCH_MISMATCH");
  expect(JSON.stringify(s)).toBe(before);
});
