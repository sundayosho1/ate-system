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

it("ASCII case fold", () =>
  expect(take(I.searchKnowledge(take(build()), { query: "EXPLICIT" }))).toMatchObject({
    totalMatches: 1,
  }));
it("empty search observed empty catalogue", () =>
  expect(take(I.searchKnowledge(take(build([])), { query: "" }))).toMatchObject({
    records: [],
    totalMatches: 0,
    hasMore: false,
  }));
for (const q of [
  { query: "a".repeat(257) },
  { query: "a ".repeat(21) },
  { query: "", maxHits: 0 },
  { query: "", maxHits: 101 },
  { query: "", maxHits: 1.1 },
  { query: "", cancelled: true },
  { query: "", ownerCommand: "refresh" },
])
  it(`bounded query ${JSON.stringify(q)}`, () =>
    expect(I.searchKnowledge(take(build()), q).ok).toBe(false));
it("query256bytes supported", () =>
  expect(I.searchKnowledge(take(build()), { query: "a".repeat(256) }).ok).toBe(true));
it("20tokens supported", () =>
  expect(I.searchKnowledge(take(build()), { query: "a ".repeat(20) }).ok).toBe(true));
it("100hits maximum supported", () =>
  expect(I.searchKnowledge(take(build()), { query: "", maxHits: 100 }).ok).toBe(true));
it("caller cast cannot bypass entryvalidation", () => {
  const c = structuredClone(take(build())) as unknown as { entries: Record<string, unknown>[] };
  delete c.entries[0]!.sourceRefs;
  expect(I.searchKnowledge(c as unknown as I.KnowledgeCatalogue, { query: "" }).ok).toBe(false);
});

it("invalid catalogue metadata cannot be cast into a search", () => {
  const c = { ...take(build()), generatedAt: "invalid" };
  expect(I.searchKnowledge(c, { query: "" }).ok).toBe(false);
});
it("duplicate catalogue identities cannot inflate hit counts", () => {
  const c = take(build());
  expect(I.searchKnowledge({ ...c, entries: [...c.entries, ...c.entries] }, { query: "" }).ok).toBe(
    false,
  );
});
