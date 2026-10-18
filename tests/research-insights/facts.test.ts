import { it, expect } from "vitest";
import type { DomainResult } from "@ate/domain";

import * as C from "@ate/research-insight-contracts";
const take = <T>(r: DomainResult<T>): T => {
  if (!r.ok) throw Error(r.issues.map((x) => x.code).join(","));
  return r.value;
};
const known = (value: unknown) => ({ kind: "KNOWN", value, evidenceIds: ["synthetic/evidence"] });

for (const value of [0, false, null, "0", [], {}])
  it(`known fact preserves ${JSON.stringify(value)}`, () => {
    const r = take(C.validateInsightRecord("Fact", known(value)));
    expect(r).toEqual(known(value));
    expect(Object.isFrozen(r)).toBe(true);
  });
for (const value of [
  { kind: "KNOWN", value: 0 },
  { kind: "KNOWN", value: 0, evidenceIds: [] },
  { kind: "UNKNOWN" },
  { kind: "UNSUPPORTED", reasonIds: [] },
  { kind: "NOT_APPLICABLE" },
  { kind: "UNKNOWN", reasonIds: ["r"], value: 0 },
])
  it(`reject invalid fact ${JSON.stringify(value)}`, () =>
    expect(C.validateInsightRecord("Fact", value).ok).toBe(false));
it("not applicable requires explanation", () =>
  expect(
    C.validateInsightRecord("Fact", {
      kind: "NOT_APPLICABLE",
      justification: "Pure domain contract has no runtime health.",
    }).ok,
  ).toBe(true));
it("cannot mutate detached fact", () => {
  const v = known({ a: 1 }),
    r = take(C.validateInsightRecord("Fact", v));
  (v.value as { a: number }).a = 2;
  expect(r).toEqual(known({ a: 1 }));
});
