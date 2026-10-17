import { it, expect } from "vitest";
import {
  ScanDependencyGraph,
  validatePlan,
  defaultScannerPolicy,
  policySchema,
  fingerprint,
  workKey,
  equivalentKey,
  ordered,
  type ScanSubscription,
} from "@ate/mose-scanner";
const policy = defaultScannerPolicy;
const sub: ScanSubscription = {
  id: "s",
  sessionId: "session",
  universe: fingerprint("u"),
  instrumentId: "instrument",
  timeframe: "M15",
  streamId: null,
  mode: "TICK_EVENT",
  dependencies: ["a"],
  priority: 1,
  cadenceMs: null,
  anchor: "2026-10-17T00:00:00.000Z",
  schedule: null,
};
const plan = { id: "plan", dependencies: [{ id: "a", parents: [] }], subscriptions: [sub] };
const trigger = {
  id: "request",
  subscriptionId: "s",
  boundary: sub.anchor,
  kind: "EVENT" as const,
  actor: null,
  cause: "event",
  evidence: fingerprint("e"),
};
const vector = { a: fingerprint("a") };
const bounded = [
  "maxSubscriptions",
  "maxInstruments",
  "maxTimeframes",
  "maxQueue",
  "maxRequests",
  "maxDependencies",
  "maxEdges",
  "maxBatch",
  "maxFanout",
  "maxCoalesced",
  "maxHistory",
  "maxRecoverySteps",
  "maxCatchup",
  "maxOwnerCalls",
  "maxInputBytes",
  "maxInputDepth",
  "maxCheckpointBytes",
  "maxRetainedBytes",
  "maxScheduleHorizonMs",
  "maxQueryResults",
] as const;
for (const field of bounded) {
  it(`${field} rejects zero rather than disabling a safety budget`, () =>
    expect(policySchema.safeParse({ ...policy, [field]: 0 }).success).toBe(false));
  it(`${field} rejects fractional resource accounting`, () =>
    expect(policySchema.safeParse({ ...policy, [field]: 1.5 }).success).toBe(false));
}
for (const [name, patch] of [
  ["duplicate subscriptions", { subscriptions: [sub, sub] }],
  ["unknown timeframe", { subscriptions: [{ ...sub, timeframe: "H3" }] }],
  ["missing dependency", { dependencies: [] }],
  ["duplicate dependency vector", { subscriptions: [{ ...sub, dependencies: ["a", "a"] }] }],
  ["seconds without cadence", { subscriptions: [{ ...sub, mode: "SECONDS" }] }],
  ["event with hidden cadence", { subscriptions: [{ ...sub, cadenceMs: 5 }] }],
  ["schedule without calendar", { subscriptions: [{ ...sub, mode: "SCHEDULE", cadenceMs: 5 }] }],
  [
    "event with calendar",
    {
      subscriptions: [
        {
          ...sub,
          schedule: {
            id: "cal",
            calendarFingerprint: fingerprint("c"),
            end: sub.anchor,
            missed: "SKIP",
          },
        },
      ],
    },
  ],
  ["bar without stream", { subscriptions: [{ ...sub, mode: "BAR_CLOSE" }] }],
  ["timeframe without stream", { subscriptions: [{ ...sub, mode: "TIMEFRAME" }] }],
  ["invalid priority", { subscriptions: [{ ...sub, priority: -1 }] }],
  ["unsafe identifier", { subscriptions: [{ ...sub, id: "../escape" }] }],
  ["empty subscriptions", { subscriptions: [] }],
  ["unknown mode", { subscriptions: [{ ...sub, mode: "TRADE" }] }],
  [
    "duplicate node",
    {
      dependencies: [
        { id: "a", parents: [] },
        { id: "a", parents: [] },
      ],
    },
  ],
  ["unknown parent", { dependencies: [{ id: "a", parents: ["missing"] }] }],
  ["self cycle", { dependencies: [{ id: "a", parents: ["a"] }] }],
  [
    "two-node cycle",
    {
      dependencies: [
        { id: "a", parents: ["b"] },
        { id: "b", parents: ["a"] },
      ],
    },
  ],
] as const)
  it(`plan rejects ${name}`, () =>
    expect(() => validatePlan({ ...plan, ...patch }, policy)).toThrow());
it("disabled mode is not silently enabled", () =>
  expect(() => validatePlan(plan, { ...policy, enabledModes: ["SECONDS"] })).toThrow(
    "MODE_DISABLED",
  ));
it("subscription exact capacity admitted", () =>
  expect(validatePlan(plan, { ...policy, maxSubscriptions: 1 }).subscriptions).toHaveLength(1));
it("one subscription over capacity rejected", () =>
  expect(() =>
    validatePlan(
      { ...plan, subscriptions: [sub, { ...sub, id: "b" }] },
      { ...policy, maxSubscriptions: 1 },
    ),
  ).toThrow());
it("dependency exact capacity admitted", () =>
  expect(new ScanDependencyGraph(plan.dependencies, 1, 1).has("a")).toBe(true));
it("dependency one over rejected", () =>
  expect(
    () => new ScanDependencyGraph([...plan.dependencies, { id: "b", parents: [] }], 1, 1),
  ).toThrow());
it("edge exact capacity admitted", () =>
  expect(
    new ScanDependencyGraph(
      [
        { id: "a", parents: [] },
        { id: "b", parents: ["a"] },
      ],
      2,
      1,
    ).affected(["a"]),
  ).toEqual(["a", "b"]));
it("edge one over rejected", () =>
  expect(
    () =>
      new ScanDependencyGraph(
        [
          { id: "a", parents: [] },
          { id: "b", parents: ["a"] },
          { id: "c", parents: ["b"] },
        ],
        3,
        1,
      ),
  ).toThrow());
it("invalidation does not traverse unrelated timeframe", () =>
  expect(
    new ScanDependencyGraph(
      [
        { id: "a", parents: [] },
        { id: "m15", parents: ["a"] },
        { id: "h4", parents: [] },
      ],
      3,
      2,
    ).affected(["a"]),
  ).toEqual(["a", "m15"]));
it("invalidation is stable under registration order", () => {
  const nodes = [
    { id: "a", parents: [] },
    { id: "b", parents: ["a"] },
    { id: "c", parents: ["b"] },
  ];
  expect(new ScanDependencyGraph(nodes, 3, 3).affected(["a"])).toEqual(
    new ScanDependencyGraph([...nodes].reverse(), 3, 3).affected(["a"]),
  );
});
it("unknown invalidation rejected", () =>
  expect(() => new ScanDependencyGraph(plan.dependencies, 1, 1).affected(["z"])).toThrow());
for (const field of ["sessionId", "universe", "instrumentId", "timeframe", "mode"] as const)
  it(`work identity binds ${field}`, () => {
    const v = field === "universe" ? fingerprint("other") : field === "mode" ? "TRIGGER" : "other";
    expect(workKey({ ...sub, [field]: v }, trigger, vector, "p")).not.toBe(
      workKey(sub, trigger, vector, "p"),
    );
  });
it("work identity binds boundary", () =>
  expect(workKey(sub, { ...trigger, boundary: "2026-10-17T00:00:01.000Z" }, vector, "p")).not.toBe(
    workKey(sub, trigger, vector, "p"),
  ));
it("work identity binds evidence", () =>
  expect(workKey(sub, { ...trigger, evidence: fingerprint("new") }, vector, "p")).not.toBe(
    workKey(sub, trigger, vector, "p"),
  ));
it("work identity binds dependency version", () =>
  expect(workKey(sub, trigger, { a: fingerprint("new") }, "p")).not.toBe(
    workKey(sub, trigger, vector, "p"),
  ));
it("work identity binds policy", () =>
  expect(workKey(sub, trigger, vector, "other")).not.toBe(workKey(sub, trigger, vector, "p")));
it("equivalent work across modes can share exact semantics", () =>
  expect(equivalentKey({ ...sub, mode: "SECONDS" }, trigger, vector, "p")).toBe(
    equivalentKey(sub, trigger, vector, "p"),
  ));
it("coalescing cannot cross stream context", () =>
  expect(equivalentKey({ ...sub, streamId: "other" }, trigger, vector, "p")).not.toBe(
    equivalentKey(sub, trigger, vector, "p"),
  ));
it("round robin bounds starvation under saturated fast instrument", () => {
  const q = [0, 1, 2].map((i) => ({ key: "a" + i, boundary: sub.anchor, subscription: sub }));
  q.push({ key: "b", boundary: sub.anchor, subscription: { ...sub, instrumentId: "z" } });
  expect(
    ordered(q, null)
      .slice(0, 2)
      .map((w) => w.key),
  ).toEqual(["a0", "b"]);
});
it("round robin resumes after last serviced instrument", () =>
  expect(
    ordered(
      [
        { key: "a", boundary: sub.anchor, subscription: sub },
        { key: "b", boundary: sub.anchor, subscription: { ...sub, instrumentId: "z" } },
      ],
      "instrument",
    )[0]!.key,
  ).toBe("b"));
it("same instrument obeys deadline before priority", () =>
  expect(
    ordered(
      [
        {
          key: "late",
          boundary: "2026-10-17T00:00:01.000Z",
          subscription: { ...sub, priority: 0 },
        },
        { key: "early", boundary: sub.anchor, subscription: { ...sub, priority: 100 } },
      ],
      null,
    )[0]!.key,
  ).toBe("early"));
it("tie ordering is independent of input enumeration", () => {
  const q = ["c", "a", "b"].map((key) => ({ key, boundary: sub.anchor, subscription: sub }));
  expect(ordered(q, null).map((w) => w.key)).toEqual(
    ordered([...q].reverse(), null).map((w) => w.key),
  );
});
it("equal-time source ordinal precedes work hash", () => {
  const a = { key: "z", boundary: sub.anchor, subscription: sub, ordinal: 0 },
    b = { key: "a", boundary: sub.anchor, subscription: sub, ordinal: 1 };
  expect(ordered([b, a], null).map((w) => w.ordinal)).toEqual([0, 1]);
});
it("deferred earlier work cannot starve a ready peer on the same instrument", () => {
  const q = [
    { key: "blocked", boundary: sub.anchor, subscription: sub },
    { key: "ready", boundary: "2026-10-17T00:00:01.000Z", subscription: sub },
  ];
  expect(ordered(q, null, { [sub.instrumentId]: "blocked" })[0]!.key).toBe("ready");
});
it("completed cursor removal restores original deterministic due order", () => {
  const q = [
    { key: "early", boundary: sub.anchor, subscription: sub },
    { key: "late", boundary: "2026-10-17T00:00:01.000Z", subscription: sub },
  ];
  expect(ordered(q, null, { [sub.instrumentId]: "no-longer-pending" })[0]!.key).toBe("early");
});
it("explicit research rescan cannot coalesce with ordinary work", () => {
  const t = { ...trigger, kind: "RESEARCH_RESCAN" as const, actor: "checker" };
  expect(equivalentKey({ ...sub, mode: "TRIGGER" }, t, vector, "p")).not.toBe(
    equivalentKey(sub, trigger, vector, "p"),
  );
});
it("separate authorized research rescan occurrences retain distinct obligations", () => {
  const t = { ...trigger, kind: "RESEARCH_RESCAN" as const, actor: "checker" };
  expect(equivalentKey({ ...sub, mode: "TRIGGER" }, t, vector, "p")).not.toBe(
    equivalentKey({ ...sub, mode: "TRIGGER" }, { ...t, id: "another-rescan" }, vector, "p"),
  );
});
