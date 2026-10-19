import { it, expect } from "vitest";
import * as api from "@ate/research-workspace";
import { VirtualClock, mustParseUtc } from "@ate/time";
import { createHash } from "node:crypto";
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, canonical(x)]),
    );
  return v;
}
const hash = (v: unknown) =>
  "sha256:" +
  createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
const at = "2026-10-19T10:00:00.000Z";
function fixture() {
  const sourceManifest = { baseline: api.baselines.knowledge, sources: {} };
  const binding: { path: string; commit: string; sha256: string } = {
    path: "README.md",
    commit: api.baselines.governance,
    sha256: "sha256:" + "a".repeat(64),
  };
  const overlay = {
    schema: "ate.workspace.release/1",
    id: "release",
    revision: 1,
    knowledgeSourceCommit: api.baselines.knowledge,
    knowledgeManifestFingerprint: hash(sourceManifest),
    reportingValidationBaseline: api.baselines.reporting,
    acceptedGovernanceCommit: api.baselines.governance,
    acceptedRecordRefs: [
      { ...binding, path: "docs/development/p1-p27-reporting-conditional-acceptance.md" },
    ],
    scope: "OFFLINE_RESEARCH_ONLY",
    qualifications: ["F05"],
    sourceBindings: [binding],
    observedAt: at,
    authority: "NON_AUTHORITATIVE_RELEASE_METADATA",
    currentHealth: "UNESTABLISHED",
    currentReadiness: "UNESTABLISHED",
  };
  const context = {
    releaseAuthentication: {
      authenticatedCommit: api.baselines.governance,
      verifiedBindings: [binding, ...overlay.acceptedRecordRefs],
      qualificationRegisterFingerprint: "sha256:" + "b".repeat(64),
      clock: "EXTERNAL_P6_CONTEXT",
    },
    clock: new VirtualClock(mustParseUtc(at), "REPLAY"),
    cancelled: false,
  };
  const input = {
    schema: "ate.workspace.compose/1",
    id: "workspace",
    overlay,
    knowledge: {
      catalogue: { baseline: api.baselines.knowledge, entries: [] },
      sourceManifest,
      qualificationIds: ["F05"],
    },
    report: null,
    links: [],
    improvementRecords: [],
    handoverRequest: {},
  };
  return { input, context };
}
function success<T>(r: api.WorkspaceResult<T>): T {
  expect(r.ok).toBe(true);
  if (!r.ok) throw Error(JSON.stringify(r.issues));
  return r.value;
}
const view = () => {
  const f = fixture();
  return success(api.composeWorkspace(f.input, f.context));
};

it("valid bounded workspace retains distinct baselines", () => {
  const v = view();
  expect(v.knowledgeBaseline).toBe(api.baselines.knowledge);
  expect(v.reportingValidationBaseline).toBe(api.baselines.reporting);
  expect(v.governanceRelease).toBe(api.baselines.governance);
  expect(v.currentAuthority).toBe("UNKNOWN");
});
const limits = {
  maxInputBytes: 4194304,
  maxDepth: 16,
  maxNodes: 10000,
  maxKnowledge: 128,
  maxReports: 1,
  maxArtifacts: 8,
  maxLinks: 128,
  maxFacets: 64,
  maxImprovements: 32,
  maxCharts: 4,
  maxPoints: 256,
  maxOutputBytes: 1048576,
  maxExportBytes: 1048576,
  maxCalls: 8,
  maxClockReads: 2,
  maxQuery: 50,
};
for (const [key, max] of Object.entries(limits)) {
  for (const [label, value] of [
    ["zero", 0],
    ["negative", -1],
    ["fraction", 0.5],
    ["above", max + 1],
    ["null", null],
    ["string", "1"],
    ["NaN", NaN],
    ["infinity", Infinity],
  ] as const)
    it(`policy ${key} rejects ${label}`, () => {
      expect(api.createWorkspacePolicy({ [key]: value }).ok).toBe(false);
    });
  it(`policy ${key} accepts exact ceiling without granting owner reads`, () => {
    const p = success(api.createWorkspacePolicy({ [key]: max }));
    expect(p[key as keyof typeof p]).toBe(max);
    expect(view().currentAuthority).toBe("UNKNOWN");
  });
}
it("unknown policy key cannot activate owner reads", () =>
  expect(api.createWorkspacePolicy({ ownerReads: true }).ok).toBe(false));
