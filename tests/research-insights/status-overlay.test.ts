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

const status = () => ({
  sourceRefs: ["README.md:1"],
  records: [
    {
      sourceRefs: ["README.md:1"],
      currentAuthority: "UNESTABLISHED",
      currentReadiness: "UNESTABLISHED",
      evidenceMeaning: "SOURCE_BYTES_NOT_EXTERNAL_AUTHENTICATION",
    },
  ],
});
it("qualified overlay grants no authority", () =>
  expect(take(I.createStatusOverlay(status(), fixture.manifest))).toMatchObject({
    grantsAuthority: false,
  }));
for (const key of ["currentAuthority", "currentReadiness", "evidenceMeaning"])
  it(`invented ${key} rejected`, () => {
    const v = status();
    (v.records[0] as Record<string, unknown>)[key] = "VERIFIED";
    expect(I.createStatusOverlay(v, fixture.manifest).ok).toBe(false);
  });
it("unknown source rejects", () => {
  const v = status();
  v.records[0]!.sourceRefs = ["missing"];
  expect(I.createStatusOverlay(v, fixture.manifest).ok).toBe(false);
});
it("null overlay structured failure", () =>
  expect(I.createStatusOverlay(null, fixture.manifest).ok).toBe(false));
it("null manifest structured failure", () =>
  expect(I.createStatusOverlay(status(), null as unknown as SourceManifest).ok).toBe(false));
it("frozen root snapshot not edited", () => {
  const v = JSON.parse(readFileSync("config/capabilities.json", "utf8")) as {
    completed_prompt: number;
  };
  expect(v.completed_prompt).toBe(25);
});
it("real current overlay labels unavailable authority", () => {
  const v = JSON.parse(readFileSync("docs/knowledge/status-overlay.json", "utf8")) as unknown;
  const m = JSON.parse(
    readFileSync("docs/knowledge/source-manifest.json", "utf8"),
  ) as SourceManifest;
  expect(I.createStatusOverlay(v, m).ok).toBe(true);
});

for (const field of ["baseline", "sha256"])
  it(`malformed manifest ${field} is contained without coercion`, () => {
    const m = structuredClone(fixture.manifest) as unknown as {
      baseline: unknown;
      sources: Record<string, { sha256: unknown }>;
    };
    if (field === "baseline") m.baseline = { toString: 0 };
    else m.sources["README.md:1"]!.sha256 = { toString: 0 };
    const state: { result?: ReturnType<typeof I.createStatusOverlay> } = {};
    expect(() => {
      state.result = I.createStatusOverlay(status(), m as unknown as SourceManifest);
    }).not.toThrow();
    expect(state.result?.ok).toBe(false);
  });
