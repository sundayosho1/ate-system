import { it, expect } from "vitest";
import {
  compareOpportunityScalar,
  evaluatePredicate,
  dimensionValue,
} from "../../packages/mose-opportunities/src/predicates.js";
import { defaultOpportunityPolicy as policy } from "../../packages/mose-opportunities/src/policy.js";
import { manifestSchema } from "../../packages/mose-opportunities/src/contracts.js";
for (const [op, a, b, result] of [
  ["EQ", "1", "1", true],
  ["EQ", "1", "2", false],
  ["NE", "1", "2", true],
  ["NE", "1", "1", false],
  ["GT", "2", "1", true],
  ["GT", "1", "1", false],
  ["GE", "1", "1", true],
  ["GE", "0", "1", false],
  ["LT", "-1", "0", true],
  ["LT", "1", "1", false],
  ["LE", "1", "1", true],
  ["LE", "2", "1", false],
  ["GT", "9007199254740993", "9007199254740992", true],
  ["LT", "0.00000001", "0.00000002", true],
] as const)
  it(`exact decimal ${a} ${op} ${b}`, () =>
    expect(compareOpportunityScalar(a, op, b)).toBe(result));
for (const bad of ["NaN", "Infinity", "1e9", "", " 1", "+1"])
  it(`malformed scalar ${bad} rejects`, () =>
    expect(() => compareOpportunityScalar(bad, "EQ", "1")).toThrow());
it("missing feature dimension never invents classifier", () =>
  expect(() => dimensionValue([], "TRENDING", "HIGH_VOLATILITY")).toThrow("UNSUPPORTED_DIMENSION"));
it("disabled manifest cannot promote", () => {
  const m = manifestSchema.parse({
    id: "manifest",
    version: "1",
    fingerprint: "sha256:" + "1".repeat(64),
    enabled: false,
    fromState: "OBSERVING",
    toState: "INTERESTING",
    hypothesisRef: "hypothesis",
    requiredDimensions: [],
    minimumDistinctConfirmations: 1,
    maxAgeMs: 1000,
    clauses: [],
    configurationReleaseRef: "config",
    approvalEvidenceRef: "approval",
  });
  expect(evaluatePredicate(m, [], policy)).toBe(false);
  expect(() => evaluatePredicate({ ...m, enabled: true }, [], policy)).toThrow("POLICY_DISABLED");
});
