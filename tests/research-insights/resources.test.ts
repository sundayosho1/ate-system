import type { DomainResult } from "@ate/domain";
import { it, expect } from "vitest";
import { readFileSync } from "node:fs";

import type { SourceManifest } from "@ate/research-insights";
import * as C from "@ate/research-insight-contracts";
import * as I from "@ate/research-insights";
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

const build = (entries: readonly unknown[] = [rec("KnowledgeEntry")]) =>
  I.createKnowledgeCatalogue({
    entries,
    sourceManifest: fixture.manifest,
    qualificationIds: [],
    generatedAt: fixture.generatedAt,
  });

it("profile deeply frozen", () => {
  expect(Object.isFrozen(C.R1)).toBe(true);
  expect(Object.isFrozen(C.R1.knowledge)).toBe(true);
});
it("exact R1 accepted", () => expect(C.validateResourceProfile(C.R1).ok).toBe(true));
for (const key of ["maxBytes", "maxDepth", "maxNodes"])
  it(`request ${key} cannot increase`, () => {
    const v = structuredClone(C.R1) as unknown as { request: Record<string, number> };
    v.request[key] = (v.request[key] ?? 0) + 1;
    expect(C.validateResourceProfile(v).ok).toBe(false);
  });
for (const [scope, limit] of [
  ["ENTRY", 32768],
  ["DESCRIPTOR", 65536],
  ["REPORT", 4194304],
  ["EXPORT", 8388608],
] as const) {
  it(`${scope} exact UTF8bytes accepted`, () =>
    expect(I.canonicalInsightBytes("a".repeat(limit - 2), scope).ok).toBe(true));
  it(`${scope} one byte over rejected`, () =>
    expect(I.canonicalInsightBytes("a".repeat(limit - 1), scope).ok).toBe(false));
}
it("catalogue record count one over rejects before processing", () =>
  expect(build(Array.from({ length: 10001 }, () => null)).ok).toBe(false));
it("multibyte bytes not codeunits", () =>
  expect(I.canonicalInsightBytes("€".repeat(11000), "ENTRY").ok).toBe(false));
it("depth16 accepts and17 rejects", () => {
  const nest = (n: number): unknown => (n ? { a: nest(n - 1) } : null);
  expect(I.canonicalInsightBytes(nest(16)).ok).toBe(true);
  expect(I.canonicalInsightBytes(nest(17)).ok).toBe(false);
});
it("10000nodes accepted and one over rejected", () => {
  expect(I.canonicalInsightBytes(Array.from({ length: 9999 }, () => null)).ok).toBe(true);
  expect(I.canonicalInsightBytes(Array.from({ length: 10000 }, () => null)).ok).toBe(false);
});
it("future operations absent not falsely passed", () => {
  for (const key of ["query", "refresh", "dispatch", "report", "persist", "resolvePath"])
    expect(Object.hasOwn(I, key)).toBe(false);
});

it("catalogue serialization16MiB exact boundary", () =>
  expect(I.canonicalInsightBytes("x".repeat(16777216 - 2), "CATALOGUE").ok).toBe(true));
it("catalogue serialization one byte over16MiB rejects", () =>
  expect(I.canonicalInsightBytes("x".repeat(16777216 - 1), "CATALOGUE").ok).toBe(false));
it("10000 distinct catalogue entries accepted", () => {
  const entries = Array.from({ length: 10000 }, (_, i) => ({
    ...rec("KnowledgeEntry"),
    id: "term/" + i,
  }));
  expect(build(entries).ok).toBe(true);
});
it("aggregate corpus cannot reset byte counters perrecord", () => {
  const entries = Array.from({ length: 600 }, (_, i) => ({
    ...rec("KnowledgeEntry"),
    id: "term/" + i,
    definition: "x".repeat(32000),
  }));
  expect(build(entries).ok).toBe(false);
});
it("search UTF8 query limit independentofcodeunits", () => {
  expect(I.searchKnowledge(take(build()), { query: "€".repeat(85) }).ok).toBe(true);
  expect(I.searchKnowledge(take(build()), { query: "€".repeat(86) }).ok).toBe(false);
});
it("1000report evidence refs accepted,1001rejects", () => {
  const v = rec("ReportManifest");
  v.exactEvidenceVector = Array.from({ length: 1000 }, () => "e");
  expect(C.validateInsightRecord("ReportManifest", v).ok).toBe(true);
  v.exactEvidenceVector = Array.from({ length: 1001 }, () => "e");
  expect(C.validateInsightRecord("ReportManifest", v).ok).toBe(false);
});
it("2000requested facets accepted,2001rejects", () => {
  const v = rec("ReportManifest");
  v.requestedFacets = Array.from({ length: 2000 }, () => "f");
  expect(C.validateInsightRecord("ReportManifest", v).ok).toBe(true);
  v.requestedFacets = Array.from({ length: 2001 }, () => "f");
  expect(C.validateInsightRecord("ReportManifest", v).ok).toBe(false);
});

it("operation descriptor cannot exceed64KiB through qualification registry", () => {
  const ids = Array.from({ length: 400 }, (_, i) => "q".repeat(200) + i);
  expect(
    I.createKnowledgeCatalogue({
      entries: [],
      sourceManifest: fixture.manifest,
      qualificationIds: ids,
      generatedAt: fixture.generatedAt,
    }).ok,
  ).toBe(false);
});
it("catalogue cannot consume custom iterator beyond arraylength", () => {
  let calls = 0;
  const entries: unknown[] = [];
  entries[Symbol.iterator] = function* () {
    calls++;
    for (let i = 0; i < 10001; i++) yield { ...rec("KnowledgeEntry"), id: "overflow/" + i };
    return undefined;
  };
  expect(build(entries).ok).toBe(false);
  expect(calls).toBe(0);
});
it("sparse corpus rejected", () => expect(build(new Array(2) as unknown[]).ok).toBe(false));

it("serialization cancellation value rejects without executing hooks", () => {
  let calls = 0;
  const raw = {
    get input() {
      calls++;
      throw Error("unsafe");
    },
  };
  const r = I.canonicalInsightBytes(raw, "DESCRIPTOR", true);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.issues[0]!.code).toBe("INSIGHT_CANCELLED");
  expect(calls).toBe(0);
});

it("export preserves cyclic and accessor rejection reasons", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const getter = {
    get value() {
      throw Error("unsafe");
    },
  };
  for (const [raw, code] of [
    [cyclic, "INSIGHT_CYCLIC_INPUT"],
    [getter, "INSIGHT_ACCESSOR_REJECTED"],
    [undefined, "INSIGHT_SCHEMA_INVALID"],
  ] as const) {
    const r = I.canonicalInsightBytes(raw, "EXPORT");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]!.code).toBe(code);
  }
});

it("shadowed typed-array byteLength cannot raise hash limit", () => {
  const raw = new Uint8Array(16777217);
  Object.defineProperty(raw, "byteLength", { value: 0 });
  expect(
    I.insightFingerprint(raw, {
      contractVersion: "ate.insights/1",
      sourceCommit: fixture.manifest.baseline,
      projectionVersion: "1",
    }).ok,
  ).toBe(false);
});
