import { it, expect } from "vitest";
import { defaultPolicy } from "@ate/instrument-registry";
import { setup, equity, evidence, take } from "./fixtures.js";
async function fixture() {
  const f = await setup();
  for (const cls of ["A", "B"]) {
    const d = equity(cls);
    d.aliases = [
      { value: "ABC", scope: "XTEST", kind: "SYMBOL", rule: "CASE", evidence: evidence() },
    ];
    d.identifiers = [
      {
        scheme: "RESEARCH",
        value: cls,
        scope: "XTEST",
        authority: "fixture",
        evidence: evidence(),
      },
    ];
    take(await f.registry.register(d));
  }
  return f.registry;
}
it.each([
  [{ value: "ABC", scope: "XTEST", aliasKind: "SYMBOL", rule: "CASE" }, "AMBIGUOUS"],
  [{ value: "ABC", scope: "OTHER", aliasKind: "SYMBOL", rule: "CASE" }, "NOT_FOUND"],
  [{ value: "ABC", scope: "XTEST", aliasKind: "PROVIDER", rule: "CASE" }, "NOT_FOUND"],
  [{ value: "ABC", aliasKind: "SYMBOL", rule: "CASE" }, "INSUFFICIENT_EVIDENCE"],
  [{ value: "ABC", scope: "XTEST", aliasKind: "SYMBOL" }, "INSUFFICIENT_EVIDENCE"],
  [{ value: "A", scope: "XTEST", scheme: "RESEARCH" }, "QUALIFIED_MATCH"],
  [{ value: "A", scope: "XTEST", scheme: "RESEARCH", authority: "foreign" }, "NOT_FOUND"],
  [{ value: "A", scope: "XTEST", scheme: "ALIEN" }, "UNSUPPORTED_SCHEME"],
  [
    { value: "ABC", scope: "XTEST", aliasKind: "SYMBOL", rule: "CASE", family: "INDEX" },
    "NOT_FOUND",
  ],
  [
    { value: "ABC", scope: "XTEST", aliasKind: "SYMBOL", rule: "CASE", jurisdiction: "XX" },
    "NOT_FOUND",
  ],
  [{ canonicalId: "invalid" }, "INVALID_INPUT"],
  [null, "INVALID_INPUT"],
] as const)("resolution fails closed for %j", async (q, status) => {
  const r = await fixture();
  const result = take(r.resolve(q));
  expect(result.status).toBe(status);
  if (status === "AMBIGUOUS") expect(result.candidates).toHaveLength(2);
});
it("exact canonical ID selects a definition not provider authorization", async () => {
  const r = await fixture();
  const row = take(r.search())[0]!;
  const result = take(r.resolve({ canonicalId: row.instrumentId }));
  expect(result.status).toBe("EXACT_MATCH");
  expect(result.candidates[0]!.revisionId).toBe(row.revisionId);
});
it("candidate overflow is ambiguity, never truncated unique match", async () => {
  const f = await setup({ ...defaultPolicy, maxCandidates: 1 });
  for (const c of ["A", "B"]) {
    const d = equity(c);
    d.aliases = [{ value: "ABC", scope: "X", kind: "SYMBOL", rule: "CASE", evidence: evidence() }];
    take(await f.registry.register(d));
  }
  const r = take(
    f.registry.resolve({ value: "ABC", scope: "X", aliasKind: "SYMBOL", rule: "CASE" }),
  );
  expect(r.status).toBe("AMBIGUOUS");
  expect(r.reason).toBe("CANDIDATE_CAPACITY");
});
it("exact registry address never upgrades an unverified economic claim", async () => {
  const { registry } = await setup();
  const row = take(await registry.register(equity()));
  const result = take(registry.resolve({ canonicalId: row.instrumentId }));
  expect(result.status).toBe("EXACT_MATCH");
  expect(result.reason).toBe("CANONICAL_IDENTITY_ADDRESS");
  expect(result.candidates[0]!.definition.qualification).toBe("EVIDENCE_QUALIFIED");
});
