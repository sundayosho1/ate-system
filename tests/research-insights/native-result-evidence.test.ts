import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { DomainResult } from "@ate/domain";

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

for (const commitment of ["ACK", "NONE", "UNKNOWN"])
  it(`retains scoped ${commitment}`, () => {
    const v = rec("NativeResultEvidence");
    v.nativeCommitment = known(commitment);
    expect(take(C.validateInsightRecord("NativeResultEvidence", v))).toEqual(v);
  });
for (const value of [null, 0, "false", {}, [], undefined])
  it(`reject nonboolean discriminator ${JSON.stringify(value)}`, () => {
    const v = rec("NativeResultEvidence");
    v.selectedDiscriminator = value;
    expect(C.validateInsightRecord("NativeResultEvidence", v).ok).toBe(false);
  });
it("contradictory native branches reject", () => {
  const v = rec("NativeResultEvidence");
  v.selectedValueRef = known("x");
  expect(C.validateInsightRecord("NativeResultEvidence", v).ok).toBe(false);
});
it("failure detail required", () => {
  const v = rec("NativeResultEvidence");
  v.selectedFailure = { code: "RECORD_NOT_FOUND", family: "owner" };
  expect(C.validateInsightRecord("NativeResultEvidence", v).ok).toBe(false);
});
it("success must carry selected value only", () => {
  const v = rec("NativeResultEvidence");
  v.selectedDiscriminator = true;
  delete v.selectedFailure;
  v.selectedValueRef = known(0);
  expect(C.validateInsightRecord("NativeResultEvidence", v).ok).toBe(true);
});
it("malformed raw native envelope is not a projection", () =>
  expect(
    C.validateInsightRecord("NativeResultEvidence", {
      ok: false,
      error: { code: "RECORD_NOT_FOUND" },
    }).ok,
  ).toBe(false));
it("unknown commitment never normalized to NONE", () => {
  const v = rec("NativeResultEvidence");
  v.nativeCommitment = known("UNKNOWN");
  expect(take(C.validateInsightRecord("NativeResultEvidence", v))).toEqual(v);
});
