import { it, expect } from "vitest";
import { readFileSync } from "node:fs";

import type { SourceManifest } from "@ate/research-insights";
import * as I from "@ate/research-insights";
const fixture = JSON.parse(
  readFileSync("tests/research-insights/fixtures/owner-evidence.json", "utf8"),
) as {
  samples: Record<string, Record<string, unknown>>;
  manifest: SourceManifest;
  generatedAt: string;
};

const row = () => ({
  id: "g/1",
  term: "snapshot",
  namespace: "P19",
  definition: "Checkpoint publishing command, not a passive read.",
  aliases: ["checkpoint snapshot"],
  overloadedMeaningRefs: [],
  futureReserved: false,
  sourceRefs: ["README.md:1"],
});
it("qualified glossary passes", () =>
  expect(I.validateGlossary([row()], fixture.manifest, ["g/1"]).ok).toBe(true));
for (const field of [
  "id",
  "term",
  "namespace",
  "definition",
  "aliases",
  "overloadedMeaningRefs",
  "futureReserved",
  "sourceRefs",
])
  it(`missing glossary ${field}`, () => {
    const v: Record<string, unknown> = row();
    delete v[field];
    expect(I.validateGlossary([v], fixture.manifest).ok).toBe(false);
  });
it("distinct namespaces preserve homonyms", () => {
  const a = row(),
    b = { ...row(), id: "g/2", namespace: "P18" };
  expect(I.validateGlossary([a, b], fixture.manifest).ok).toBe(true);
});
it("missing seed rejected", () =>
  expect(I.validateGlossary([row()], fixture.manifest, ["missing"]).ok).toBe(false));
it("missing overload rejected", () => {
  const v = row();
  v.overloadedMeaningRefs = ["missing"] as never[];
  expect(I.validateGlossary([v], fixture.manifest).ok).toBe(false);
});
it("all226 real seeds represented", () => {
  const data = JSON.parse(readFileSync("docs/knowledge/glossary.json", "utf8")) as { id: string }[];
  const manifest = JSON.parse(
    readFileSync("docs/knowledge/source-manifest.json", "utf8"),
  ) as SourceManifest;
  expect(data).toHaveLength(226);
  expect(
    I.validateGlossary(
      data,
      manifest,
      data.map((x) => x.id),
    ).ok,
  ).toBe(true);
});

it("custom glossary iterator cannot exceed declared corpuslength", () => {
  let calls = 0;
  const rows: unknown[] = [];
  rows[Symbol.iterator] = function* () {
    calls++;
    for (let i = 0; i < 10001; i++) yield { ...row(), id: "overflow/" + i };
    return undefined;
  };
  expect(I.validateGlossary(rows, fixture.manifest).ok).toBe(false);
  expect(calls).toBe(0);
});
