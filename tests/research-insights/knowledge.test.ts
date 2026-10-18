import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { DomainResult } from "@ate/domain";

import type { SourceManifest } from "@ate/research-insights";
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

it("builds immutable detached catalogue", () => {
  const v = rec("KnowledgeEntry");
  const c = take(build([v]));
  v.definition = "mutated";
  expect(c.entries[0]!.definition).not.toBe("mutated");
  expect(Object.isFrozen(c.entries)).toBe(true);
});
for (const field of [
  "id",
  "type",
  "namespace",
  "revision",
  "sourceRefs",
  "temporalScope",
  "definition",
  "relatedEntryIds",
  "qualifications",
  "reviewStatus",
  "personaTags",
])
  it(`missing knowledge ${field} rejects`, () => {
    const v = rec("KnowledgeEntry");
    delete v[field];
    expect(build([v]).ok).toBe(false);
  });
it("duplicate revision rejected", () =>
  expect(build([rec("KnowledgeEntry"), rec("KnowledgeEntry")]).ok).toBe(false));
it("orphan related entry rejected", () => {
  const v = rec("KnowledgeEntry");
  v.relatedEntryIds = ["missing"];
  expect(build([v]).ok).toBe(false);
});
it("unknown source rejected", () => {
  const v = rec("KnowledgeEntry");
  v.sourceRefs = ["missing:1"];
  expect(build([v]).ok).toBe(false);
});
it("unknown qualification rejected", () => {
  const v = rec("KnowledgeEntry");
  v.qualifications = ["invented"];
  expect(build([v]).ok).toBe(false);
});
it("cancelled build never complete", () =>
  expect(
    I.createKnowledgeCatalogue({
      entries: [],
      sourceManifest: fixture.manifest,
      qualificationIds: [],
      generatedAt: fixture.generatedAt,
      cancelled: true,
    }).ok,
  ).toBe(false));
it("getter descriptor is not invoked", () => {
  let calls = 0;
  const v = {
    get entries() {
      calls++;
      return [];
    },
    sourceManifest: fixture.manifest,
    qualificationIds: [],
    generatedAt: fixture.generatedAt,
  };
  expect(I.createKnowledgeCatalogue(v).ok).toBe(false);
  expect(calls).toBe(0);
});
