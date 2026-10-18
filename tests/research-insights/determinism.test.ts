import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { DomainResult } from "@ate/domain";

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

it("canonical key order stable", () =>
  expect(Buffer.from(take(I.canonicalInsightBytes({ b: 2, a: 1 }))).toString()).toBe(
    '{"a":1,"b":2}',
  ));
it("same inputs same bytes", () =>
  expect(take(I.canonicalInsightBytes({ a: [1, 2] }))).toEqual(
    take(I.canonicalInsightBytes({ a: [1, 2] })),
  ));
it("array order retained", () =>
  expect(take(I.canonicalInsightBytes([1, 2]))).not.toEqual(take(I.canonicalInsightBytes([2, 1]))));
it("shared reference detached not mistaken for cycle", () => {
  const a = { a: 1 };
  expect(I.canonicalInsightBytes([a, a]).ok).toBe(true);
});
for (const key of ["contractVersion", "sourceCommit", "projectionVersion"])
  it(`fingerprint binds ${key}`, () => {
    const raw = take(I.canonicalInsightBytes({ a: 1 })),
      c = {
        contractVersion: "ate.insights/1",
        sourceCommit: fixture.manifest.baseline,
        projectionVersion: "1",
      },
      other = { ...c, [key]: key === "sourceCommit" ? "b".repeat(40) : "2" };
    expect(take(I.insightFingerprint(raw, c))).not.toBe(take(I.insightFingerprint(raw, other)));
  });
it("fingerprint binds payload", () => {
  const c = {
    contractVersion: "ate.insights/1",
    sourceCommit: fixture.manifest.baseline,
    projectionVersion: "1",
  };
  expect(take(I.insightFingerprint(new Uint8Array([1]), c))).not.toBe(
    take(I.insightFingerprint(new Uint8Array([2]), c)),
  );
});
it("owner hash is not rewritten", () => {
  const r = rec("EvidenceReference");
  expect(take(C.validateInsightRecord("EvidenceReference", r))).toEqual(r);
});
it("repeated catalogue stable", () => expect(take(build())).toEqual(take(build())));

it("P6 now captured exactly once", () => {
  let reads = 0;
  const clock = {
    now: () => {
      reads++;
      return fixture.generatedAt;
    },
    mode: "VIRTUAL",
    provenance: { clockId: "synthetic-clock", mode: "VIRTUAL", quality: "GOOD" },
  };
  expect(
    I.captureGeneratedAt(clock as unknown as Parameters<typeof I.captureGeneratedAt>[0]).ok,
  ).toBe(true);
  expect(reads).toBe(1);
});
it("clock rejection has no fallback", () => {
  const clock = {
    now() {
      throw Error("unavailable");
    },
  };
  expect(
    I.captureGeneratedAt(clock as unknown as Parameters<typeof I.captureGeneratedAt>[0]).ok,
  ).toBe(false);
});
