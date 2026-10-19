import { it, expect } from "vitest";
import { Budget } from "../../packages/mose-opportunities/src/validation.js";
import {
  O1,
  defaultOpportunityPolicy as policy,
  createOpportunityPolicy,
  effectivePolicy,
} from "../../packages/mose-opportunities/src/policy.js";
it("exact node budget admits and one beyond rejects", () => {
  expect(new Budget({ ...O1, maxOperationNodes: 3 }).capture([1, 2])).toEqual([1, 2]);
  expect(() => new Budget({ ...O1, maxOperationNodes: 2 }).capture([1, 2])).toThrow(
    "BUDGET_EXHAUSTED",
  );
});
it("node cost accumulates across captures", () => {
  const b = new Budget({ ...O1, maxOperationNodes: 2 });
  b.capture(1);
  b.capture(2);
  expect(() => b.capture(3)).toThrow("BUDGET_EXHAUSTED");
});
it("exact depth admits and next depth rejects", () => {
  expect(new Budget({ ...O1, maxDepth: 2 }).capture({ a: 1 })).toEqual({ a: 1 });
  expect(() => new Budget({ ...O1, maxDepth: 1 }).capture({ a: 1 })).toThrow("BUDGET_EXHAUSTED");
});
it("UTF8 serialized bytes use inclusive exact boundary", () => {
  const n = Buffer.byteLength(JSON.stringify("é"));
  expect(new Budget({ ...O1, maxRequestBytes: n }).capture("é")).toBe("é");
  expect(() => new Budget({ ...O1, maxRequestBytes: n - 1 }).capture("é")).toThrow();
});
for (const field of [
  "maxLiveKeys",
  "maxJournalRecords",
  "maxRequestBytes",
  "maxRetainedJournalBytes",
  "maxOperationNodes",
  "maxDepth",
  "maxEvidenceRefs",
  "maxTimeframes",
  "maxDimensions",
  "maxClausesPerManifest",
  "maxEdgeManifests",
  "maxIdentifierBytes",
  "maxReasons",
  "maxPageSize",
  "maxOffset",
  "maxOutputBytes",
  "maxReplayRecords",
  "maxExplicitApprovedOwnerReads",
  "defaultEvidenceMaxAgeMs",
  "maxExpiryMs",
] as const)
  it(`weaker configured ${field} cannot enlarge O1`, () => {
    const result = createOpportunityPolicy({
      ...policy,
      limits: { ...O1, [field]: O1[field] + 1 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.limits[field]).toBe(O1[field]);
  });
for (const value of [-1, 0.5, NaN, Infinity, "10", null])
  it(`invalid configured limit ${String(value)} fails closed`, () =>
    expect(createOpportunityPolicy({ ...policy, limits: { ...O1, maxLiveKeys: value } }).ok).toBe(
      false,
    ));
it("strict query policy cannot be relaxed by omitted or weaker policy", () => {
  const original = { ...policy, limits: { ...O1, maxDepth: 8 } };
  expect(effectivePolicy(original).limits.maxDepth).toBe(8);
  expect(effectivePolicy(original, policy).limits.maxDepth).toBe(8);
  expect(
    effectivePolicy(original, { ...policy, limits: { ...O1, maxDepth: 4 } }).limits.maxDepth,
  ).toBe(4);
});
it("driver remains prohibited", () =>
  expect(createOpportunityPolicy({ ...policy, compositionDriverEnabled: true }).ok).toBe(false));
it("financial authority remains prohibited", () =>
  expect(createOpportunityPolicy({ ...policy, tradingAuthorized: true }).ok).toBe(false));
it("unknown policy properties fail closed", () =>
  expect(createOpportunityPolicy({ ...policy, extra: true }).ok).toBe(false));

it("same-operation decoder reuse charges the complete graph once and a retained reference once", () => {
  const b = new Budget({ ...O1, maxOperationNodes: 5 });
  const copy = b.capture([1, 2]);
  expect(b.nodes).toBe(3);
  expect(b.reuseCaptured(copy, 100)).toBe(copy);
  expect(b.nodes).toBe(4);
  b.reuseCaptured(copy, 100);
  expect(b.nodes).toBe(5);
  expect(() => b.reuseCaptured(copy, 100)).toThrow("BUDGET_EXHAUSTED");
});
it("decoder reuse cannot evade a newly stricter byte limit", () => {
  const b = new Budget(O1),
    copy = b.capture({ a: "é" });
  expect(() => b.reuseCaptured(copy, 1)).toThrow("BUDGET_EXHAUSTED");
});
it("decoder proof is local to one operation budget", () => {
  const a = new Budget(O1),
    copy = a.capture([1, 2]);
  const b = new Budget({ ...O1, maxOperationNodes: 2 });
  expect(() => b.reuseCaptured(copy, 100)).toThrow("BUDGET_EXHAUSTED");
});
it("mutable raw input has no reusable decoder proof", () => {
  const b = new Budget(O1),
    raw = { a: 1 };
  b.capture(raw);
  Reflect.set(raw, "a", () => 0);
  expect(() => b.reuseCaptured(raw, 100)).toThrow();
});
it("shallow freezing cannot confer a trusted decoder proof", () => {
  const b = new Budget(O1),
    child: { a: unknown } = { a: 1 },
    raw = Object.freeze({ child });
  b.capture(raw);
  child.a = () => 0;
  expect(() => b.reuseCaptured(raw, 100)).toThrow();
});
it("generic capture still charges full logical cost for repeated immutable graphs", () => {
  const b = new Budget(O1),
    copy = b.capture([1, 2]);
  b.capture(copy);
  expect(b.nodes).toBe(6);
});

import { serializeOpportunityExport } from "../../packages/mose-opportunities/src/handover.js";
// Independent tree accounting: full input + derived redacted tree + each flat representation.
function logicalNodes(value: unknown): number {
  if (Array.isArray(value)) return 1 + value.reduce<number>((n, v) => n + logicalNodes(v), 0);
  if (value !== null && typeof value === "object")
    return 1 + Object.values(value).reduce<number>((n, v) => n + logicalNodes(v), 0);
  return 1;
}
function exportPolicy(nodes: number) {
  const r = createOpportunityPolicy({ ...policy, limits: { ...O1, maxOperationNodes: nodes } });
  if (!r.ok) throw Error(r.error.code);
  return r.value;
}
for (const [label, raw] of [
  ["array", Array(9).fill(0)],
  ["nested", { a: [{ b: 1 }, 2] }],
  ["redacted", { secret: "PLACEHOLDER_test", nested: { token: "PLACEHOLDER_hidden", value: 2 } }],
] as const)
  for (const format of ["JSON", "CSV"] as const)
    for (const delta of [-1, 0, 1])
      it(`export independent cumulative oracle ${label} ${format} boundary${delta}`, () => {
        const expected = 2 * logicalNodes(raw) + (format === "CSV" ? 2 : 1);
        const r = serializeOpportunityExport(raw, exportPolicy(expected + delta), format);
        expect(r.ok).toBe(delta >= 0);
        if (!r.ok)
          expect(r).toMatchObject({ error: { code: "OPP:BUDGET_EXHAUSTED", commitment: "NONE" } });
        else expect(r.value).not.toContain("PLACEHOLDER_");
      });
it("export repeated redactions share a cumulative operation budget without reset", () => {
  const raw = {
    secret: "PLACEHOLDER_test",
    password: "PLACEHOLDER_test",
    token: "PLACEHOLDER_test",
  };
  const required = 2 * logicalNodes(raw) + 1;
  for (let i = 0; i < 3; i++)
    expect(serializeOpportunityExport(raw, exportPolicy(required - 1))).toMatchObject({
      ok: false,
      error: { code: "OPP:BUDGET_EXHAUSTED", commitment: "NONE" },
    });
  expect(serializeOpportunityExport(raw, exportPolicy(required)).ok).toBe(true);
});
it("export exhaustion returns no partial successful output", () => {
  const r = serializeOpportunityExport(Array(9).fill(0), exportPolicy(12));
  expect(r).toMatchObject({ ok: false, error: { commitment: "NONE" } });
  expect("value" in r).toBe(false);
});
