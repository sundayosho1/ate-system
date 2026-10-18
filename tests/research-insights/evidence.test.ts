import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { DomainResult } from "@ate/domain";
import type { InsightKind, InsightRecord } from "@ate/research-insight-contracts";
import type { SourceManifest } from "@ate/research-insights";
import * as C from "@ate/research-insight-contracts";
const fixture = JSON.parse(
  readFileSync("tests/research-insights/fixtures/owner-evidence.json", "utf8"),
) as {
  samples: Record<string, Record<string, unknown>>;
  manifest: SourceManifest;
  generatedAt: string;
};
const take = <T>(r: DomainResult<T>): T => {
  if (!r.ok) throw Error(r.issues.map((x) => x.code).join(","));
  return r.value;
};
const rec = (kind: string) => structuredClone(fixture.samples[kind]!);
const known = (value: unknown) => ({ kind: "KNOWN", value, evidenceIds: ["synthetic/evidence"] });
const unknown = { kind: "UNKNOWN", reasonIds: ["synthetic/unknown"] };

for (const kind of Object.keys(fixture.samples))
  it(`valid explicit ${kind} projection`, () =>
    expect(C.validateInsightRecord(kind as InsightKind, rec(kind)).ok).toBe(true));
for (const [field, value] of [
  ["sourceCommit", "bad"],
  ["nativeFingerprint", known("truncated")],
  ["immutable", "true"],
  ["sourceTimes", { availableAt: known("tomorrow") }],
  ["schema", "ate.insights.evidence/2"],
  ["secret", "do not export"],
] as const)
  it(`evidence rejects ${field}`, () => {
    const r = rec("EvidenceReference");
    r[field] = value;
    expect(C.validateInsightRecord("EvidenceReference", r).ok).toBe(false);
  });
it("native fingerprint retained exactly", () => {
  const v = rec("EvidenceReference"),
    out = take(C.validateInsightRecord("EvidenceReference", v));
  expect(out).toEqual(v);
});
it("historical facet cannot grant current authority", () => {
  const v = rec("DiagnosticFacet");
  v.currentAuthority = known(true);
  expect(C.validateInsightRecord("DiagnosticFacet", v).ok).toBe(false);
});
it("unknown count is never zero", () => {
  const v = take(
    C.validateInsightRecord("CoverageStatement", rec("CoverageStatement")),
  ) as InsightRecord;
  expect(v.denominator).toEqual(unknown);
});
it("unknown denominator cannot support owner declared coverage", () => {
  const v = rec("CoverageStatement");
  v.claim = "OWNER_DECLARED_ONLY";
  expect(C.validateInsightRecord("CoverageStatement", v).ok).toBe(false);
});
it("numerator cannot exceed denominator", () => {
  const v = rec("CoverageStatement");
  v.numerator = known(2);
  v.denominator = known(1);
  expect(C.validateInsightRecord("CoverageStatement", v).ok).toBe(false);
});
