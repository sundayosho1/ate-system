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

for (const method of ["query", "diagnostics", "improvements", "handover", "export"])
  for (const defect of ["cycle", "source", "link", "header"])
    it(`cross ${method} ${defect}`, () => {
      const v = _clone(_view(true));
      if (defect === "cycle")
        _set(v, ["knowledge", "entries", 0, "relatedEntryIds"], ["term/test"]);
      if (defect === "source")
        _set(
          v,
          ["knowledgeSourceEvidence", "sourceManifest", "sources", "README.md:1", "sha256"],
          "sha256:" + "0".repeat(64),
        );
      if (defect === "link") _set(v, ["links"], [{ id: "forged" }]);
      if (defect === "header") _set(v, ["budget", "calls"], -1);
      _set(v, ["knowledgeFingerprint"], _hash(v.knowledge));
      _rehash(v);
      const q = { schema: "ate.workspace.query/1", offset: 0 };
      const result =
        method === "query"
          ? _query(v, { section: "REPORT", owner: "mose-core" })
          : method === "diagnostics"
            ? w.projectWorkspaceDiagnostics(v, q)
            : method === "improvements"
              ? w.projectImprovementView(v, q)
              : method === "handover"
                ? w.buildHandoverDescriptors(v)
                : w.serializeWorkspaceExport(v);
      expect(result.ok).toBe(false);
    });
for (const resource of ["maxNodes", "maxInputBytes", "maxCalls", "maxDepth"])
  it(`stricter ${resource} not reset`, () => {
    const v = _view(),
      p = _must(w.createWorkspacePolicy({ [resource]: 1 }));
    for (let i = 0; i < 2; i++) expect(_query(v, {}, p).ok).toBe(false);
  });
it("weaker caller ceiling cannot expand stored query policy", () => {
  const f = _fixture(),
    p = _must(w.createWorkspacePolicy({ maxQuery: 1 })),
    v = _must(w.composeWorkspace(f.input, f.context, p));
  expect(_query(v, { limit: 2 }, w.W1).ok).toBe(false);
  expect(_query(v, { limit: 1 }, w.W1).ok).toBe(true);
});
it("hostile accessor not invoked", () => {
  const v = _clone(_view());
  let reads = 0;
  Object.defineProperty(_obj(v.knowledgeSourceEvidence), "sourceBindings", {
    enumerable: true,
    get() {
      reads++;
      throw Error("HOSTILE");
    },
  });
  expect(_query(v).ok).toBe(false);
  expect(reads).toBe(0);
});
it("original mutation cannot change frozen output or canonical export", () => {
  const f = _fixture(),
    v = _must(w.composeWorkspace(f.input, f.context));
  _set(f.input, ["knowledge", "catalogue", "entries", 0, "definition"], "changed");
  expect(_get(_must(_query(v, { section: "KNOWLEDGE" })).records, [0, "definition"])).not.toBe(
    "changed",
  );
  expect(_must(w.serializeWorkspaceExport(v))).toEqual(
    _must(w.serializeWorkspaceExport(_clone(v))),
  );
});
