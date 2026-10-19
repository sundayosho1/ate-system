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

it("handover contains no server, runtime UI or owner route", () => {
  const v = view(),
    h = success(api.buildHandoverDescriptors(v));
  expect(h.frontendImplemented).toBe(false);
  expect(h.transport).toBe("NONE");
  expect(h.ownerReadRoutes).toEqual([]);
});
it("safe export omits native bodies and proposal text", () => {
  const x = success(api.serializeWorkspaceExport(view()));
  expect(x.bytes).not.toContain("nativeIdentity");
  expect(x.bytes).not.toContain("hypothesis");
  expect((JSON.parse(x.bytes) as { currentAuthority: unknown }).currentAuthority).toBe("UNKNOWN");
});
it("safe export separates projection and original identity", () => {
  const v = view(),
    x = success(api.serializeWorkspaceExport(v));
  expect(x.originalWorkspaceFingerprint).toBe(v.fingerprint);
  expect(x.projectionFingerprint).not.toBe(v.fingerprint);
});
it("repeated export is deterministic", () => {
  const v = view();
  expect(success(api.serializeWorkspaceExport(v))).toEqual(
    success(api.serializeWorkspaceExport(v)),
  );
});
it("stricter export byte ceiling rejects safely", () => {
  const p = success(api.createWorkspacePolicy({ maxExportBytes: 1 }));
  expect(api.serializeWorkspaceExport(view(), p).ok).toBe(false);
});
it("tampered view cannot build handover", () =>
  expect(api.buildHandoverDescriptors({ ...view(), id: "tampered" }).ok).toBe(false));
it("Cursor handover covers27modules and preserves unknown runtime facts", () => {
  const h = success(api.buildHandoverDescriptors(view()));
  expect(h.modules).toHaveLength(27);
  expect(
    h.modules.every(
      (m) => m.currentHealth === "UNESTABLISHED" && m.currentReadiness === "UNESTABLISHED",
    ),
  ).toBe(true);
  expect(h.tableColumns).toContain("UNIT");
  expect(h.emptyStates.missingReport).toBe("UNKNOWN_NOT_ABSENT");
});
