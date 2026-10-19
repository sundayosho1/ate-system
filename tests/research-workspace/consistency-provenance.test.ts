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
it("genuine accepted report remains a separately identified historical artifact", () => {
  const f = fixture(),
    report = reportFixture();
  const r = success(api.composeWorkspace({ ...f.input, report }, f.context));
  expect(r.reportFingerprint).toBe(report.manifest.reportFingerprint);
  expect(r.currentAuthority).toBe("UNKNOWN");
  expect(view().currentAuthority).toBe("UNKNOWN");
});

it("cross-owner consistency is unestablished even for an intact view", () =>
  expect(view().consistency).toMatchObject({ status: "CONSISTENCY_UNESTABLISHED" }));
it("tampered view current authority rejects", () => {
  const v = { ...view(), currentAuthority: "VERIFIED" };
  expect(api.queryWorkspace(v, { schema: "ate.workspace.query/1", offset: 0 }).ok).toBe(false);
});
it("changed report bytes with stale fingerprint rejects", () => {
  const f = fixture(),
    report = reportFixture();
  expect(
    api.composeWorkspace(
      {
        ...f.input,
        report: {
          ...report,
          status: "COMPLETE",
          currentAuthority: { kind: "KNOWN", value: true, evidenceIds: ["fake"] },
        },
      },
      f.context,
    ).ok,
  ).toBe(false);
});
it("valid historical ACK cannot upgrade workspace authority", () => {
  const f = fixture();
  const v = success(api.composeWorkspace({ ...f.input, report: reportFixture() }, f.context));
  expect(v.currentAuthority).toBe("UNKNOWN");
});
it("genuine report remains queryable under qualified owner scope", () => {
  const f = fixture(),
    v = success(api.composeWorkspace({ ...f.input, report: reportFixture() }, f.context));
  const q = success(
    api.queryWorkspace(v, {
      schema: "ate.workspace.query/1",
      offset: 0,
      owner: "mose-core",
      prompt: 25,
    }),
  );
  expect(q.totalRecords).toBe(1);
  expect(q.currentAuthority).toBe("UNKNOWN");
});
it("rehashing a fabricated readiness claim does not establish current authority", () => {
  const v = { ...view(), currentAuthority: "READY" };
  const body = Object.fromEntries(Object.entries(v).filter(([k]) => k !== "fingerprint"));
  expect(
    api.queryWorkspace(
      { ...v, fingerprint: hash(body) },
      { schema: "ate.workspace.query/1", offset: 0 },
    ).ok,
  ).toBe(false);
});
it("valid report bytes cannot be silently reattributed", () => {
  const f = fixture(),
    report = reportFixture();
  const r = api.composeWorkspace(
    {
      ...f.input,
      report: { ...report, request: { ...report.request, baseline: api.baselines.governance } },
    },
    f.context,
  );
  expect(r.ok).toBe(false);
});
it("later report generation cannot contaminate an earlier P6 workspace clock", () => {
  const f = fixture();
  f.input.overlay.observedAt = "2026-10-18T10:00:00.000Z";
  const r = api.composeWorkspace(
    { ...f.input, report: reportFixture() },
    { ...f.context, clock: new VirtualClock(mustParseUtc("2026-10-18T10:00:00.000Z"), "REPLAY") },
  );
  expect(r.ok).toBe(false);
});
it("future release observation cannot masquerade as already observed", () => {
  const f = fixture();
  f.input.overlay.observedAt = "2099-01-01T00:00:00.000Z";
  expect(api.composeWorkspace(f.input, f.context).ok).toBe(false);
});
it("unknown export qualifications cannot carry caller text", () => {
  const f = fixture();
  f.input.overlay.qualifications = ["SYNTHETIC_SECRET_QUALIFICATION"];
  expect(api.composeWorkspace(f.input, f.context).ok).toBe(false);
});
