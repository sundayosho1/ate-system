import { it, expect } from "vitest";
import * as w from "@ate/research-workspace";
import * as r from "@ate/research-reporting";
import { VirtualClock, mustParseUtc } from "@ate/time";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const at = "2026-10-19T12:34:56.000Z";
function _obj(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw Error("Expected test object");
  return value as Record<string, unknown>;
}
function _array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw Error("Expected test array");
  return value;
}
function _get(value: unknown, path: readonly (string | number)[]): unknown {
  let current = value;
  for (const key of path)
    current = typeof key === "number" ? _array(current)[key] : _obj(current)[key];
  return current;
}
function _set(value: unknown, path: readonly (string | number)[], replacement: unknown) {
  const parent = _get(value, path.slice(0, -1)),
    key = path[path.length - 1];
  if (typeof key === "number") _array(parent)[key] = replacement;
  else if (key !== undefined) _obj(parent)[key] = replacement;
  else throw Error("Empty path");
}
function _canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v: unknown) => _canonical(v));
  if (value !== null && typeof value === "object") {
    const row = _obj(value);
    return Object.fromEntries(
      Object.keys(row)
        .sort()
        .map((k) => [k, _canonical(row[k])]),
    );
  }
  return value;
}
function _hash(value: unknown) {
  return (
    "sha256:" +
    createHash("sha256")
      .update(JSON.stringify(_canonical(value)))
      .digest("hex")
  );
}
function _clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function _rehash(value: unknown) {
  const row = _obj(value);
  delete row.fingerprint;
  row.fingerprint = _hash(row);
}
function _must<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) throw Error(JSON.stringify(result));
  return result.value;
}
function _fixture() {
  const sourceBytes = execFileSync("git", ["show", w.baselines.knowledge + ":README.md"]),
    digest = "sha256:" + createHash("sha256").update(sourceBytes).digest("hex");
  const sourceManifest = {
    baseline: w.baselines.knowledge,
    sources: { "README.md:1": { path: "README.md", line: 1, sha256: digest } },
  };
  const sourceBinding = { path: "README.md", commit: w.baselines.knowledge, sha256: digest };
  const accepted = {
    path: "docs/development/p1-p27-reporting-conditional-acceptance.md",
    commit: w.baselines.governance,
    sha256: "sha256:" + "a".repeat(64),
  };
  const overlay = {
    schema: "ate.workspace.release/1",
    id: "test-release",
    revision: 3,
    knowledgeSourceCommit: w.baselines.knowledge,
    knowledgeManifestFingerprint: _hash(sourceManifest),
    reportingValidationBaseline: w.baselines.reporting,
    acceptedGovernanceCommit: w.baselines.governance,
    acceptedRecordRefs: [accepted],
    sourceBindings: [sourceBinding],
    scope: "OFFLINE_RESEARCH_ONLY",
    qualifications: ["F05"],
    observedAt: at,
    authority: "NON_AUTHORITATIVE_RELEASE_METADATA",
    currentHealth: "UNESTABLISHED",
    currentReadiness: "UNESTABLISHED",
  };
  const entry = {
    schema: "ate.insights.knowledge/1",
    id: "term/test",
    type: "TERM",
    namespace: "test",
    revision: 3,
    contentVersion: "test.1",
    sourceRefs: ["README.md:1"],
    temporalScope: "HISTORICAL_SOURCE",
    definition: "Source-linked synthetic explanatory metadata, not current owner authority.",
    relatedEntryIds: [],
    qualifications: ["F05"],
    reviewStatus: "SOURCE_EXTRACTED",
    personaTags: ["developer"],
  };
  return {
    input: {
      schema: "ate.workspace.compose/1",
      id: "test-workspace",
      overlay,
      knowledge: {
        catalogue: { baseline: w.baselines.knowledge, entries: [entry] },
        sourceManifest,
        qualificationIds: ["F05"],
      },
      report: null,
      links: [],
      improvementRecords: [],
      handoverRequest: {},
    },
    context: {
      releaseAuthentication: {
        authenticatedCommit: w.baselines.governance,
        verifiedBindings: [accepted, sourceBinding],
        qualificationRegisterFingerprint: "sha256:" + "b".repeat(64),
        clock: "SYNTHETIC_DECLARED_CONTEXT",
      },
      clock: new VirtualClock(mustParseUtc(at), "REPLAY"),
      cancelled: false,
    },
  };
}
function _report(multiple = false) {
  const declarations = multiple
    ? [
        {
          id: "b-health",
          prompt: 25,
          owner: "mose-core",
          axis: "HEALTH" as const,
          field: "health",
          artifactId: "a",
        },
        {
          id: "a-ready",
          prompt: 25,
          owner: "mose-core",
          axis: "READINESS" as const,
          field: "readiness",
          artifactId: "a",
        },
        {
          id: "c-obligation",
          prompt: 26,
          owner: "mose-scanner",
          axis: "OBLIGATION" as const,
          field: "pending",
          artifactId: "b",
        },
      ]
    : [
        {
          id: "facet",
          prompt: 25,
          owner: "mose-core",
          axis: "HEALTH" as const,
          field: "health",
          artifactId: "a",
        },
      ];
  const artifacts: r.EvidenceArtifact[] = [
    {
      id: "a",
      prompt: 25,
      owner: "mose-core",
      ownerVersion: "synthetic.1",
      sourceCommit: w.baselines.reporting,
      nativeIdentity: "a",
      nativeFingerprint: { kind: "UNKNOWN", reasonIds: ["SYNTHETIC"] },
      subject: ["test"],
      unit: "STATUS",
      effectiveAt: at,
      availableAt: at,
      captured: _must(r.captureNativeEvidence({ health: "HEALTHY", readiness: "READY" }, "DIRECT")),
    },
  ];
  if (multiple)
    artifacts.push({
      ...artifacts[0]!,
      id: "b",
      nativeIdentity: "b",
      prompt: 26,
      owner: "mose-scanner",
      captured: _must(r.captureNativeEvidence({ pending: 1 }, "DIRECT")),
    });
  return _must(
    r.composeReport(
      {
        request: {
          schema: "ate.reporting.request/1",
          id: "test-report",
          baseline: w.baselines.reporting,
          purpose: "OFFLINE_RESEARCH",
          mode: "HISTORICAL",
          asOf: at,
          knowledgeCutoff: at,
          facets: declarations.map((d) => ({ ...d, subject: ["test"], unit: "STATUS" })),
        },
        evidence: artifacts,
        charts: [],
        improvements: [],
      },
      {
        clock: new VirtualClock(mustParseUtc(at), "REPLAY"),
        anchors: artifacts.map((a) => ({
          artifactId: a.id,
          captureDigest: r.captureDigest(a),
          sourceCommit: a.sourceCommit,
          owner: a.owner,
          reference: "SYNTHETIC_CONTEXT_NOT_EXTERNAL_AUTHENTICATION",
        })),
      },
    ),
  );
}
function _view(withReport = false) {
  const f = _fixture();
  if (withReport) _set(f.input, ["report"], _report());
  return _must(w.composeWorkspace(f.input, f.context));
}
function _query(value: unknown, extra: Record<string, unknown> = {}, policy?: w.WorkspacePolicy) {
  return w.queryWorkspace(
    value,
    { schema: "ate.workspace.query/1", offset: 0, limit: 10, ...extra },
    policy,
  );
}
function _invalidRoutes(value: unknown) {
  for (const result of [
    _query(value),
    w.projectWorkspaceDiagnostics(value, { schema: "ate.workspace.query/1", offset: 0 }),
    w.projectImprovementView(value, { schema: "ate.workspace.query/1", offset: 0 }),
    w.buildHandoverDescriptors(value),
    w.serializeWorkspaceExport(value),
  ])
    expect(result.ok).toBe(false);
}

const invalid: [string, unknown][] = [
  ["sourceRefs", ["missing.md:1"]],
  ["revision", -1],
  ["type", "FAKE"],
  ["namespace", null],
  ["reviewStatus", "LIVE_APPROVED"],
  ["relatedEntryIds", ["missing"]],
  ["relatedEntryIds", ["term/test"]],
];
for (const [field, bad] of invalid)
  for (const hasReport of [false, true])
    it(`relationship ${field} ${JSON.stringify(bad)} report=${hasReport}`, () => {
      const v = _clone(_view(hasReport));
      _set(v, ["knowledge", "entries", 0, field], bad);
      _set(v, ["knowledgeFingerprint"], _hash(v.knowledge));
      _rehash(v);
      _invalidRoutes(v);
    });
function _link(v: w.WorkspaceView) {
  return {
    id: "link",
    relationship: "CONTEXT_ONLY",
    knowledgeEntryId: "term/test",
    knowledgeRevision: 3,
    knowledgeFingerprint: v.knowledgeFingerprint,
    reportFingerprint: v.reportFingerprint,
    facetId: "facet",
    owner: "mose-core",
    sourceCommit: w.baselines.reporting,
    qualificationIds: ["F05"],
  };
}
for (const field of [
  "relationship",
  "knowledgeEntryId",
  "knowledgeRevision",
  "knowledgeFingerprint",
  "reportFingerprint",
  "facetId",
  "owner",
  "sourceCommit",
  "qualificationIds",
])
  it(`invalid link ${field}`, () => {
    const v = _clone(_view(true));
    const link = _link(v);
    _set(link, [field], field === "qualificationIds" ? ["UNSUPPORTED"] : "invalid");
    _set(v, ["links"], [link]);
    _rehash(v);
    _invalidRoutes(v);
  });
it("duplicate identity and revision cannot reconstruct", () => {
  const v = _clone(_view());
  _array(_get(v, ["knowledge", "entries"])).push(_clone(_get(v, ["knowledge", "entries", 0])));
  _set(v, ["knowledgeFingerprint"], _hash(v.knowledge));
  _rehash(v);
  _invalidRoutes(v);
});
it("distinct corrected revisions remain exportable", () => {
  const f = _fixture();
  _array(_get(f.input, ["knowledge", "catalogue", "entries"])).push({
    ..._obj(_get(f.input, ["knowledge", "catalogue", "entries", 0])),
    revision: 4,
    definition: "Corrected historical explanation.",
  });
  const v = _must(w.composeWorkspace(f.input, f.context));
  expect(_must(_query(_clone(v), { section: "KNOWLEDGE" })).totalRecords).toBe(2);
  expect(w.serializeWorkspaceExport(_clone(v)).ok).toBe(true);
});
it("valid contextual link preserves UNKNOWN authority", () => {
  const f = _fixture();
  _set(f.input, ["report"], _report());
  const base = _must(w.composeWorkspace(f.input, f.context));
  _set(f.input, ["links"], [_link(base)]);
  const v = _must(w.composeWorkspace(f.input, f.context));
  expect(_must(w.buildHandoverDescriptors(v)).ownerReadRoutes).toEqual([]);
  expect(_must(_query(v)).currentAuthority).toBe("UNKNOWN");
});
it("repeated verified context bindings do not poison reconstruction", () => {
  const f = _fixture();
  f.context.releaseAuthentication.verifiedBindings.push({
    ...f.context.releaseAuthentication.verifiedBindings[1]!,
  });
  const v = _must(w.composeWorkspace(f.input, f.context));
  expect(_query(_clone(v)).ok).toBe(true);
});

// Independent identity/source/Kahn oracle. It does not call production validation helpers.
function _catalogueOracle(entries: readonly unknown[], sourceIds: readonly string[]): boolean {
  const identities = new Set<string>(),
    edges = new Map<string, Set<string>>();
  for (const raw of entries) {
    const e = _obj(raw);
    if (typeof e.id !== "string" || !Number.isSafeInteger(e.revision) || Number(e.revision) < 0)
      return false;
    const key = e.id + ":" + String(e.revision);
    if (identities.has(key)) return false;
    identities.add(key);
    if (!_array(e.sourceRefs).every((s) => typeof s === "string" && sourceIds.includes(s)))
      return false;
    const targets = edges.get(e.id) ?? new Set<string>();
    for (const target of _array(e.relatedEntryIds)) {
      if (typeof target !== "string") return false;
      targets.add(target);
    }
    edges.set(e.id, targets);
  }
  const incoming = new Map([...edges.keys()].map((id) => [id, 0]));
  for (const targets of edges.values())
    for (const target of targets) {
      if (!incoming.has(target)) return false;
      incoming.set(target, (incoming.get(target) ?? 0) + 1);
    }
  const ready = [...incoming].filter(([, n]) => n === 0).map(([id]) => id);
  let visited = 0;
  while (ready.length) {
    const id = ready.shift()!;
    visited++;
    for (const target of edges.get(id) ?? []) {
      const n = incoming.get(target)! - 1;
      incoming.set(target, n);
      if (n === 0) ready.push(target);
    }
  }
  return visited === edges.size;
}
const graphs: readonly (readonly (readonly string[])[])[] = [
  [],
  [[]],
  [["term/1"], []],
  [["term/1"], ["term/2"], []],
  [[], []],
  [["term/1", "term/2"], [], []],
  [["term/0"]],
  [["term/1"], ["term/0"]],
  [["term/1"], ["term/2"], ["term/0"]],
  [["missing"]],
  [[], ["term/1"]],
  [["term/2"], ["term/2"], []],
];
for (const [index, graph] of graphs.entries())
  it(`independent catalogue graph oracle ${index}`, () => {
    const f = _fixture(),
      template = _obj(_get(f.input, ["knowledge", "catalogue", "entries", 0]));
    const entries = graph.map((targets, i) => ({
      ...template,
      id: "term/" + i,
      revision: i,
      relatedEntryIds: [...targets],
    }));
    const expected = _catalogueOracle(entries, ["README.md:1"]);
    _set(f.input, ["knowledge", "catalogue", "entries"], entries);
    const result = w.composeWorkspace(f.input, f.context);
    expect(result.ok).toBe(expected);
    if (result.ok) expect(w.serializeWorkspaceExport(_clone(result.value)).ok).toBe(true);
  });

for (const defect of ["cycle", "target", "duplicate", "source", "type"])
  it(`schema oracle still rejects ${defect} with self-consistent lineage digests`, () => {
    const v = _clone(_view());
    if (defect === "cycle") _set(v, ["knowledge", "entries", 0, "relatedEntryIds"], ["term/test"]);
    if (defect === "target") _set(v, ["knowledge", "entries", 0, "relatedEntryIds"], ["missing"]);
    if (defect === "duplicate")
      _array(_get(v, ["knowledge", "entries"])).push(_clone(_get(v, ["knowledge", "entries", 0])));
    if (defect === "source") _set(v, ["knowledge", "entries", 0, "sourceRefs"], ["unbound.md:1"]);
    if (defect === "type") _set(v, ["knowledge", "entries", 0, "type"], "UNSUPPORTED");
    const digest = _hash(v.knowledge);
    _set(v, ["knowledgeFingerprint"], digest);
    _set(v, ["knowledgeSourceEvidence", "catalogueFingerprint"], digest);
    _rehash(v);
    _invalidRoutes(v);
  });
it("valid explanatory wording is not blacklisted or authenticated by a hash", () => {
  const f = _fixture();
  _set(f.input, ["knowledge", "catalogue", "entries", 0, "namespace"], "forged");
  _set(f.input, ["knowledge", "catalogue", "entries", 0, "definition"], "forged");
  const v = _must(w.composeWorkspace(f.input, f.context));
  expect(_query(_clone(v), { section: "KNOWLEDGE" }).ok).toBe(true);
  expect(v.currentAuthority).toBe("UNKNOWN");
});
