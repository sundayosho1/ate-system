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
const unknown = { kind: "UNKNOWN", reasonIds: ["synthetic/unknown"] };

it("metadata remains nonoperational", () =>
  expect(I.validateConfigurationGuides([rec("ConfigurationGuide")], fixture.manifest).ok).toBe(
    true,
  ));
for (const field of [
  "default",
  "bounds",
  "activeVersion",
  "schemaRef",
  "fieldPath",
  "unit",
  "risk",
  "authority",
  "restart",
  "sourceRefs",
])
  it(`configuration ${field} required`, () => {
    const v = rec("ConfigurationGuide");
    delete v[field];
    expect(I.validateConfigurationGuides([v], fixture.manifest).ok).toBe(false);
  });
it("duplicate guide rejected", () =>
  expect(
    I.validateConfigurationGuides(
      [rec("ConfigurationGuide"), rec("ConfigurationGuide")],
      fixture.manifest,
    ).ok,
  ).toBe(false));
it("real guides source linked", () => {
  const data = JSON.parse(
    readFileSync("docs/knowledge/configuration-guides.json", "utf8"),
  ) as unknown;
  const m = JSON.parse(
    readFileSync("docs/knowledge/source-manifest.json", "utf8"),
  ) as SourceManifest;
  expect(I.validateConfigurationGuides(data, m).ok).toBe(true);
});
it("unknown active version not invented", () => {
  const v = take(I.validateConfigurationGuides([rec("ConfigurationGuide")], fixture.manifest));
  expect(v[0]!.activeVersion).toEqual(unknown);
});
