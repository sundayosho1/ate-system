import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as I from "@ate/research-insights";
import type { SourceManifest } from "@ate/research-insights";
const load = (p: string): unknown => JSON.parse(readFileSync(p, "utf8"));
const manifest = load("docs/knowledge/source-manifest.json") as SourceManifest;
const baseline = "6307f53d4febe2bd731e00d73d429546fc29d5ee";
const fixture = load("tests/research-insights/fixtures/owner-evidence.json") as {
  samples: Record<string, Record<string, unknown>>;
  generatedAt: string;
};
const row = (id: string, extra: Record<string, unknown> = {}) => ({
  ...fixture.samples.KnowledgeEntry,
  id,
  namespace: "audit",
  sourceRefs: [Object.keys(manifest.sources)[0]!],
  relatedEntryIds: [],
  qualifications: [],
  ...extra,
});
const build = (entries: readonly unknown[], cancelled = false) =>
  I.createKnowledgeCatalogue({
    entries,
    sourceManifest: manifest,
    qualificationIds: [],
    generatedAt: fixture.generatedAt,
    cancelled,
  });
const trace = (
  load("docs/knowledge/capability-traceability.json") as {
    rows: Record<string, unknown>[];
  }
).rows;
const dimensions = [
  "owner",
  "authoritativeContract",
  "documentation",
  "documentationCoverage",
  "glossaryTerms",
  "glossaryCoverage",
  "configurationGuidance",
  "diagnosticEvidence",
  "reportingReadiness",
  "improvementIntegration",
  "frontendReadiness",
];
for (const field of dimensions) {
  for (const mutation of ["missing", "null", "number", "nested"])
    it(`trace dimension ${field} rejects ${mutation}`, () => {
      const v = structuredClone(trace[0]!);
      if (mutation === "missing") delete v[field];
      else v[field] = mutation === "null" ? null : mutation === "number" ? 7 : { value: "UNKNOWN" };
      expect(I.validateCapabilityTraceability([v], [String(v.id)]).ok).toBe(false);
    });
}
for (const field of ["authoritativeContract", "documentation", "glossaryTerms"])
  for (const value of [[null], ["valid", {}], [""]])
    it(`trace ${field} rejects malformed nested ${JSON.stringify(value)}`, () => {
      expect(I.validateCapabilityTraceability([{ ...trace[0], [field]: value }], []).ok).toBe(
        false,
      );
    });
it("qualified UNKNOWN prose is retained without becoming null or an owner lookup", () => {
  const v: Record<string, unknown> = {
    ...trace[0],
    diagnosticEvidence: "UNKNOWN: public evidence unavailable",
    reportingReadiness: "UNSUPPORTED: no running owner adapter",
  };
  const r = I.validateCapabilityTraceability([v], [String(v.id)]);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.value[0]).toEqual(v);
});
for (const [field, value] of [
  ["owner", "x".repeat(257)],
  ["id", "x".repeat(257)],
  ["glossaryTerms", ["x".repeat(257)]],
  ["documentationCoverage", " "],
  ["authoritativeContract", []],
] as const)
  it(`trace rejects bounded field ${field}`, () => {
    expect(I.validateCapabilityTraceability([{ ...trace[0], [field]: value }], []).ok).toBe(false);
  });
it("all 2092 baseline rows remain valid and immutable", () => {
  const r = I.validateCapabilityTraceability(
    trace,
    trace.map((v) => String(v.id)),
  );
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.value).toHaveLength(2092);
    expect(Object.isFrozen(r.value[0])).toBe(true);
  }
});
// Authentication is a test/maintenance check over explicit accepted Git bytes;
// the production projection library gains no filesystem resolver or trust registry.
const acceptedSourceBytes = new Map<string, Buffer>();
const authenticate = (m: SourceManifest) => {
  if (m.baseline !== baseline) return false;
  return Object.entries(m.sources).every(([id, s]) => {
    try {
      const cacheKey = m.baseline + ":" + s.path;
      let bytes = acceptedSourceBytes.get(cacheKey);
      if (!bytes) {
        bytes = execFileSync("git", ["show", cacheKey], {
          stdio: ["ignore", "pipe", "ignore"],
        });
        acceptedSourceBytes.set(cacheKey, bytes);
      }
      return (
        id === s.path + ":" + String(s.line) &&
        s.line >= 1 &&
        s.line <= bytes.toString().split(/\r?\n/).length &&
        s.sha256 === "sha256:" + createHash("sha256").update(bytes).digest("hex")
      );
    } catch {
      return false;
    }
  });
};
const affected = [
  "tests/instrument-eligibility/architecture-guard-remediation.test.ts:13",
  "tests/mose-attention/architecture.test.ts:74",
  "tests/mose-attention/architecture.test.ts:81",
];
for (const id of affected) {
  it(`historical source reference authenticates ${id}`, () => {
    expect(authenticate({ baseline, sources: { [id]: manifest.sources[id]! } })).toBe(true);
  });
  it(`current implementation hash cannot replace accepted baseline hash ${id}`, () => {
    const s = manifest.sources[id]!;
    const altered = {
      ...s,
      sha256: "sha256:" + createHash("sha256").update(readFileSync(s.path)).digest("hex"),
    };
    expect(authenticate({ baseline, sources: { [id]: altered } })).toBe(false);
  });
}
it("complete source manifest authenticates all 1659 baseline references", () => {
  expect(Object.keys(manifest.sources)).toHaveLength(1659);
  expect(authenticate(manifest)).toBe(true);
});
it("correct hash under wrong source commit fails anchored authentication", () => {
  expect(authenticate({ ...manifest, baseline: "89b763996b0cc6979ad237dc317178865c605e88" })).toBe(
    false,
  );
});
it("correct commit and hash with wrong referenced line fails identity binding", () => {
  const id = affected[0]!,
    s = manifest.sources[id]!;
  expect(authenticate({ baseline, sources: { [id]: { ...s, line: s.line + 1 } } })).toBe(false);
});
it("missing referenced source fails anchored authentication", () => {
  expect(
    authenticate({
      baseline,
      sources: {
        "missing.ts:1": { path: "missing.ts", line: 1, sha256: "sha256:" + "a".repeat(64) },
      },
    }),
  ).toBe(false);
});
it("line beyond exact accepted file fails authentication", () => {
  const s = manifest.sources[affected[0]!]!;
  expect(
    authenticate({ baseline, sources: { [s.path + ":999999"]: { ...s, line: 999999 } } }),
  ).toBe(false);
});
for (const length of [1, 2, 3, 20])
  it(`rejects directed cycle of length ${length}`, () => {
    const entries = Array.from({ length }, (_, i) =>
      row("node/" + i, { relatedEntryIds: ["node/" + ((i + 1) % length)] }),
    );
    const r = build(entries);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.code).toBe("INSIGHT_CYCLIC_INPUT");
  });
it("disconnected graph with one cyclic component rejects", () => {
  expect(
    build([
      row("isolated"),
      row("a", { relatedEntryIds: ["b"] }),
      row("b", { relatedEntryIds: ["a"] }),
    ]).ok,
  ).toBe(false);
});
it("repeated edges of a valid DAG are preserved", () => {
  const r = build([row("a", { relatedEntryIds: ["b", "b"] }), row("b")]);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.value.entries[0]?.relatedEntryIds).toEqual(["b", "b"]);
});
it("cycles across retained revisions reject without choosing a latest revision", () => {
  expect(
    build([
      row("a", { revision: 1, relatedEntryIds: ["b"] }),
      row("a", { revision: 2 }),
      row("b", { relatedEntryIds: ["a"] }),
    ]).ok,
  ).toBe(false);
});
it("acyclic retained revisions preserve exact identities", () => {
  const r = build([
    row("a", { revision: 2 }),
    row("a", { revision: 1, relatedEntryIds: ["b"] }),
    row("b"),
  ]);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.value.entries).toHaveLength(3);
});
it("orphan validation still rejects before traversal", () => {
  expect(build([row("a", { relatedEntryIds: ["absent"] })]).ok).toBe(false);
});
it("10000-node acyclic chain uses bounded iterative traversal", () => {
  const entries = Array.from({ length: 10000 }, (_, i) =>
    row("n/" + i, { relatedEntryIds: i < 9999 ? ["n/" + (i + 1)] : [] }),
  );
  expect(build(entries).ok).toBe(true);
});
it("10001-node graph rejects without recursive processing", () => {
  expect(build(Array.from({ length: 10001 }, (_, i) => row("n/" + i))).ok).toBe(false);
});
it("cancelled graph request never returns a complete catalogue", () => {
  const r = build([row("a"), row("b")], true);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.issues[0]?.code).toBe("INSIGHT_CANCELLED");
});
const ordered = (entries: readonly unknown[]) => {
  const r = build(entries);
  expect(r.ok).toBe(true);
  if (!r.ok) throw Error("Unexpected invalid ordering fixture");
  const bytes = I.canonicalInsightBytes(r.value, "CATALOGUE");
  expect(bytes.ok).toBe(true);
  if (!bytes.ok) throw Error("Unexpected invalid canonical fixture");
  return {
    ids: r.value.entries.map((e) => e.id),
    revisions: r.value.entries.map((e) => e.revision),
    bytes: Buffer.from(bytes.value).toString(),
  };
};
for (const [left, right] of [
  ["a", "b"],
  ["2", "10"],
  ["é", "z"],
  ["😀", "é"],
  ["a/b", "a:b"],
])
  it(`component ID order stable for ${left} and ${right}`, () => {
    const a = row(left!),
      b = row(right!);
    expect(ordered([a, b])).toEqual(ordered([b, a]));
    expect(ordered([a, b]).ids).toEqual([left, right].sort());
  });
it("delimiter collision cannot hide distinct namespace/type/ID tuples", () => {
  const a = row("c", { namespace: "a/MODULE/b", type: "TERM" });
  const b = row("b/TERM/c", { namespace: "a", type: "MODULE" });
  expect(ordered([a, b])).toEqual(ordered([b, a]));
});
it("revision ordering is numeric and preserves multiple versions", () => {
  const a = row("a", { revision: 10 }),
    b = row("a", { revision: 2 });
  expect(ordered([a, b]).revisions).toEqual([2, 10]);
  expect(ordered([a, b])).toEqual(ordered([b, a]));
});
it("namespace precedes entry type and ID", () => {
  expect(
    ordered([
      row("a", { namespace: "z", type: "MODULE" }),
      row("z", { namespace: "a", type: "TERM" }),
    ]).ids,
  ).toEqual(["z", "a"]);
});
it("type precedes ID for the same namespace", () => {
  expect(ordered([row("a", { type: "TERM" }), row("z", { type: "MODULE" })]).ids).toEqual([
    "z",
    "a",
  ]);
});
it("DAG traversal does not change canonical arrays or detach semantics", () => {
  const a = row("a", { relatedEntryIds: ["b"] }),
    b = row("b");
  expect(ordered([a, b])).toEqual(ordered([b, a]));
});
const glossary = load("docs/knowledge/glossary.json") as Record<string, unknown>[];
for (const [term, phrase] of [
  ["Backtest", "historical research"],
  ["Rollback Request", "request"],
  ["Backpressure", "capacity pressure"],
  ["Known-good rollback", "restoration"],
]) {
  it(`exact glossary explanation for ${term}`, () => {
    const entry = glossary.find((v) => v.term === term)!;
    expect(String(entry.qualifiedCurrentExplanation)).toContain(phrase!);
    expect(entry.qualifiedCurrentExplanation).not.toBe(
      glossary.find((v) => v.term === "ACK")?.qualifiedCurrentExplanation,
    );
  });
  it(`original glossary identity and definition preserved for ${term}`, () => {
    const original = JSON.parse(
      execFileSync(
        "git",
        ["show", "89b763996b0cc6979ad237dc317178865c605e88:docs/knowledge/glossary.json"],
        { encoding: "utf8" },
      ),
    ) as Record<string, unknown>[];
    const now = { ...glossary.find((v) => v.term === term) };
    delete now.qualifiedCurrentExplanation;
    const old = { ...original.find((v) => v.term === term) };
    delete old.qualifiedCurrentExplanation;
    expect(now).toEqual(old);
  });
}
it("only four explicitly authorized glossary explanations differ", () => {
  const original = JSON.parse(
    execFileSync(
      "git",
      ["show", "89b763996b0cc6979ad237dc317178865c605e88:docs/knowledge/glossary.json"],
      { encoding: "utf8" },
    ),
  ) as Record<string, unknown>[];
  expect(
    glossary.filter((v, i) => JSON.stringify(v) !== JSON.stringify(original[i])).map((v) => v.term),
  ).toEqual(["Backtest", "Rollback Request", "Backpressure", "Known-good rollback"]);
});
it("invalid source in otherwise valid acyclic catalogue still rejects", () => {
  expect(build([row("a", { sourceRefs: ["missing:1"] }), row("b")]).ok).toBe(false);
});
