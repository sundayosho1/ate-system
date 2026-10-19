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
import { composeReport, captureNativeEvidence, captureDigest } from "@ate/research-reporting";
function reportFixture() {
  const artifact = {
    id: "evidence",
    prompt: 25,
    owner: "mose-core",
    ownerVersion: "synthetic-research.1",
    sourceCommit: api.baselines.reporting,
    nativeIdentity: "native",
    nativeFingerprint: { kind: "UNKNOWN" as const, reasonIds: ["SYNTHETIC"] },
    subject: ["session"],
    unit: "STATUS",
    effectiveAt: at,
    availableAt: at,
    captured: (() => {
      const r = captureNativeEvidence(
        { health: "HEALTHY", readiness: "READY", pending: 1 },
        "DIRECT",
      );
      if (!r.ok) throw Error("capture failed");
      return r.value;
    })(),
  };
  const request = {
    schema: "ate.reporting.request/1" as const,
    id: "report",
    baseline: api.baselines.reporting,
    purpose: "OFFLINE_RESEARCH",
    mode: "HISTORICAL" as const,
    asOf: at,
    knowledgeCutoff: at,
    facets: [
      {
        id: "health",
        prompt: 25,
        owner: "mose-core",
        subject: artifact.subject,
        axis: "HEALTH" as const,
        artifactId: "evidence",
        field: "health",
        unit: "STATUS",
      },
    ],
  };
  const r = composeReport(
    { request, evidence: [artifact], charts: [], improvements: [] },
    {
      clock: new VirtualClock(mustParseUtc(at), "REPLAY"),
      anchors: [
        {
          artifactId: "evidence",
          captureDigest: captureDigest(artifact),
          sourceCommit: artifact.sourceCommit,
          owner: artifact.owner,
          reference: "synthetic-trusted-context",
        },
      ],
    },
  );
  if (!r.ok) throw Error(JSON.stringify(r.issues));
  return r.value;
}
it("J01 three baseline identities", () => {
  const v = view();
  expect(
    new Set([v.knowledgeBaseline, v.reportingValidationBaseline, v.governanceRelease]).size,
  ).toBe(3);
});
it("J02 self-declared context rejected", () => {
  const f = fixture();
  expect(api.composeWorkspace(f.input, { ...f.context, releaseAuthentication: {} }).ok).toBe(false);
});
it("J03 historical pending status cannot grant current authority", () => {
  const f = fixture();
  expect(api.composeWorkspace({ ...f.input, foundationStatus: "ACCEPTED" }, f.context).ok).toBe(
    false,
  );
});
it("J04 help subset identity", () => {
  expect(view().knowledgeFingerprint).toMatch(/^sha256:/);
});
it("J05 all27 source coverage independent of report presence", () => {
  for (let prompt = 1; prompt <= 27; prompt++)
    expect(
      success(api.queryWorkspace(view(), { schema: "ate.workspace.query/1", offset: 0, prompt }))
        .scope,
    ).toBe("SUPPLIED_BOUNDED_INPUT_ONLY");
});
it("J06 configuration is guidance only", () => {
  expect(view().administration).toMatchObject({
    setters: false,
    configuration: "SOURCE_DECLARATION_NOT_EFFECTIVE_CONFIGURATION",
  });
});
it("J07 supplied historical report preserves fingerprint", () => {
  const f = fixture(),
    r = reportFixture();
  expect(
    success(api.composeWorkspace({ ...f.input, report: r }, f.context)).reportFingerprint,
  ).toBe(r.manifest.reportFingerprint);
});
it("J08 missing report unknown not absence", () => {
  expect(view().reportFingerprint).toBeNull();
  expect(view().currentAuthority).toBe("UNKNOWN");
});
it("J09 diagnostic owner-health axis qualified", () => {
  const f = fixture();
  expect(
    success(api.composeWorkspace({ ...f.input, report: reportFixture() }, f.context)).diagnostics,
  ).toMatchObject([{ axis: "HEALTH", currentAuthority: "UNKNOWN" }]);
});
it("J10 contradictory immutable view rejected", () => {
  expect(
    api.queryWorkspace(
      { ...view(), reportFingerprint: "forged" },
      { schema: "ate.workspace.query/1", offset: 0 },
    ).ok,
  ).toBe(false);
});
it("J11 distinct release revisions retain identity", () => {
  const f = fixture();
  const a = success(api.validateReleaseOverlay(f.input.overlay, f.context.releaseAuthentication));
  f.input.overlay.revision = 2;
  expect(
    success(api.validateReleaseOverlay(f.input.overlay, f.context.releaseAuthentication))
      .fingerprint,
  ).not.toBe(a.fingerprint);
});
it("J12 future capture is not current readiness", () => {
  const f = fixture();
  f.input.overlay.observedAt = "2099-01-01T00:00:00.000Z";
  expect(
    success(api.validateReleaseOverlay(f.input.overlay, f.context.releaseAuthentication))
      .currentReadiness,
  ).toBe("UNESTABLISHED");
});
it("J13 unestablished concurrent source consistency", () => {
  expect(view().consistency).toMatchObject({ status: "CONSISTENCY_UNESTABLISHED" });
});
it("J14 native obligation is not manufactured", () => {
  expect(view().diagnostics).toEqual([]);
});
it("J15 historical acknowledgment does not authorize action", () => {
  expect(view().currentAuthority).toBe("UNKNOWN");
});
it("J16 open reason-fidelity finding retained", () => {
  expect(view().qualifications).toContain("D-E-L01");
});
it("J17 manual proposal grants no approval", () => {
  expect(view().improvementViews).toMatchObject({ decisionAuthority: "NOT_ESTABLISHED" });
});
it("J18 administration role not authentication", () => {
  expect(view().administration).toMatchObject({
    identity: "DISPLAY_NOT_AUTHENTICATION",
    approvalAuthority: false,
  });
});
it("J19 exact query limit ceiling", () => {
  expect(
    success(api.queryWorkspace(view(), { schema: "ate.workspace.query/1", offset: 0, limit: 50 }))
      .records,
  ).toEqual([]);
});
it("J20 retry does not grant weaker stored policy", () => {
  const f = fixture(),
    p = success(api.createWorkspacePolicy({ maxQuery: 1 })),
    v = success(api.composeWorkspace(f.input, f.context, p));
  expect(
    api.queryWorkspace(v, { schema: "ate.workspace.query/1", offset: 0, limit: 2 }, api.W1).ok,
  ).toBe(false);
});
it("J21 strict policy re-import", () => {
  const p = success(api.createWorkspacePolicy({ maxNodes: 1 }));
  expect(api.buildHandoverDescriptors(view(), p).ok).toBe(false);
});
it("J22 no passive route activation", () => {
  expect(success(api.buildHandoverDescriptors(view())).ownerReadRoutes).toEqual([]);
});
it("J23 pagination/fairness disclosure", () => {
  expect(view().administration).toMatchObject({
    scannerPagination: "USE_TOTAL_REQUESTS_AND_EXPLICIT_OFFSETS",
    fairness: "ADMISSION_STARVATION_POSSIBLE",
  });
});
it("J24 redacted deterministic report handover", () => {
  const v = view();
  expect(success(api.serializeWorkspaceExport(v))).toEqual(
    success(api.serializeWorkspaceExport(v)),
  );
});
