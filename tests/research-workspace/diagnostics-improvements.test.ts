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

it("qualified owner-health observation is not global readiness", () => {
  const f = fixture(),
    v = success(api.composeWorkspace({ ...f.input, report: reportFixture() }, f.context));
  expect(v.currentAuthority).toBe("UNKNOWN");
  expect(v.diagnostics).toMatchObject([{ axis: "HEALTH", owner: "mose-core", status: "OBSERVED" }]);
  expect(view().currentAuthority).toBe("UNKNOWN");
});
it("manual improvement register grants no mutation", () =>
  expect(view().improvementViews).toMatchObject({
    mutationAuthority: false,
    decisionAuthority: "NOT_ESTABLISHED",
  }));
for (const value of [null, {}, true, "approve", [{ id: "forged-approval" }]])
  it(`malformed improvement ${JSON.stringify(value)} rejects`, () => {
    const f = fixture();
    expect(api.composeWorkspace({ ...f.input, improvementRecords: value }, f.context).ok).toBe(
      false,
    );
  });
it("diagnostic facade cannot be redirected to improvement records", () =>
  expect(
    api.projectWorkspaceDiagnostics(view(), {
      schema: "ate.workspace.query/1",
      offset: 0,
      section: "IMPROVEMENTS",
    }).ok,
  ).toBe(false));
it("improvement facade preserves explicit supplied-only scope", () => {
  const r = success(
    api.projectImprovementView(view(), { schema: "ate.workspace.query/1", offset: 0 }),
  );
  expect(r.totalRecords).toBe(0);
  expect(r.scope).toBe("SUPPLIED_BOUNDED_INPUT_ONLY");
});
it("owner-prompt mismatch rejects instead of reporting absence", () =>
  expect(
    api.queryWorkspace(view(), {
      schema: "ate.workspace.query/1",
      offset: 0,
      owner: "mose-core",
      prompt: 27,
    }).ok,
  ).toBe(false));
it("unknown source owner rejects", () =>
  expect(
    api.queryWorkspace(view(), {
      schema: "ate.workspace.query/1",
      offset: 0,
      owner: "invented-owner",
    }).ok,
  ).toBe(false));

import type { Axis } from "@ate/research-reporting";
function axisReport(axis: Axis, field: string, availableAt: string | null = at, native?: unknown) {
  const original = reportFixture(),
    source = original.observations[0]!.artifact,
    captured = captureNativeEvidence(
      native ?? {
        lifecycle: "RUNNING",
        health: "HEALTHY",
        readiness: "READY",
        quality: "SOURCE_DECLARED",
        currentAuthority: "VERIFIED",
        eligibleDenominator: 0,
        pending: 1,
      },
      native === undefined ? "DIRECT" : "COMMITMENT",
    );
  if (!captured.ok) throw Error(JSON.stringify(captured.issues));
  const artifact = { ...source, availableAt, captured: captured.value };
  const request = {
    ...original.request,
    facets: [{ ...original.request.facets[0]!, axis, field }],
  };
  const r = composeReport(
    { request, evidence: [artifact], charts: [], improvements: [] },
    {
      clock: new VirtualClock(mustParseUtc(at), "REPLAY"),
      anchors: [
        {
          artifactId: artifact.id,
          captureDigest: captureDigest(artifact),
          sourceCommit: artifact.sourceCommit,
          owner: artifact.owner,
          reference: "synthetic-independent-context",
        },
      ],
    },
  );
  if (!r.ok) throw Error(JSON.stringify(r.issues));
  return r.value;
}
for (const [axis, field, status] of [
  ["LIFECYCLE", "lifecycle", "OBSERVED"],
  ["HEALTH", "health", "OBSERVED"],
  ["READINESS", "readiness", "OBSERVED"],
  ["QUALITY", "quality", "OBSERVED"],
  ["AUTHORITY", "currentAuthority", "UNAVAILABLE"],
  ["COVERAGE", "eligibleDenominator", "UNAVAILABLE"],
  ["OBLIGATION", "pending", "OBSERVED"],
] as const)
  it(`accepted ${axis} remains separate without current authority`, () => {
    const f = fixture(),
      report = axisReport(axis, field),
      v = success(api.composeWorkspace({ ...f.input, report }, f.context));
    expect(v.diagnostics).toMatchObject([{ axis, status, currentAuthority: "UNKNOWN" }]);
    expect(v.currentAuthority).toBe("UNKNOWN");
  });
it("missing historical availability cannot become established evidence", () => {
  const f = fixture(),
    v = success(
      api.composeWorkspace({ ...f.input, report: axisReport("HEALTH", "health", null) }, f.context),
    );
  expect(v.diagnostics).toMatchObject([{ status: "UNAVAILABLE" }]);
});
it("future availability cannot contaminate an earlier research view", () => {
  const f = fixture(),
    v = success(
      api.composeWorkspace(
        { ...f.input, report: axisReport("HEALTH", "health", "2099-01-01T00:00:00.000Z") },
        f.context,
      ),
    );
  expect(v.diagnostics).toMatchObject([{ status: "UNAVAILABLE" }]);
});
for (const commitment of ["NONE", "UNKNOWN"] as const)
  it(`native ${commitment} remains distinct after integration`, () => {
    const f = fixture(),
      report = axisReport("HEALTH", "health", at, {
        ok: false,
        error: { code: "RECORD_NOT_FOUND", commitment },
      }),
      v = success(api.composeWorkspace({ ...f.input, report }, f.context));
    expect(v.report).toMatchObject({
      observations: [
        { artifact: { captured: { commitment: { kind: "KNOWN", value: commitment } } } },
      ],
    });
    expect(v.currentAuthority).toBe("UNKNOWN");
  });
it("original reporting reason survives an integration rejection", () => {
  const f = fixture(),
    report = reportFixture();
  const r = api.composeWorkspace(
    { ...f.input, report: { ...report, status: "TAMPERED" } },
    f.context,
  );
  expect(r.ok).toBe(false);
  if (r.ok) throw Error("unsafe success");
  expect(r.issues.some((i) => i.code.startsWith("REPORTING:"))).toBe(true);
});
it("imported report self-hash never becomes owner authentication", () => {
  const f = fixture(),
    v = success(api.composeWorkspace({ ...f.input, report: reportFixture() }, f.context));
  expect(v.diagnostics).toMatchObject([
    { evidenceAuthentication: "SELF_HASH_ONLY_NOT_OWNER_AUTHENTICATION" },
  ]);
  expect(v.consistency).toMatchObject({
    ownerAuthentication: "SELF_HASH_ONLY_NOT_OWNER_AUTHENTICATION",
  });
});
const manualProposal = () => ({
  schema: "ate.insights.improvement/1",
  id: "C-OP01",
  revision: 1,
  evidenceIds: ["evidence"],
  affectedOwners: ["research-insights"],
  findingRefs: ["C-OP01"],
  hypothesis: "Source-linked glossary could be clearer",
  boundedChange: "Future separately authorized source review",
  qualificationImpact: "C-OP01 remains OPEN",
  suggestedTests: ["owner-contract-review"],
  workflowStatus: "DRAFT",
  decisionRef: { kind: "UNKNOWN", reasonIds: ["NO_OWNER_DECISION"] },
  supersedes: { kind: "UNKNOWN", reasonIds: ["NO_PREDECESSOR"] },
});
it("genuine source-linked manual proposal is retained without approval", () => {
  const f = fixture(),
    v = success(
      api.composeWorkspace(
        { ...f.input, report: reportFixture(), improvementRecords: [manualProposal()] },
        f.context,
      ),
    );
  expect(v.improvementViews).toMatchObject({
    decisionAuthority: "NOT_ESTABLISHED",
    mutationAuthority: false,
    records: [{ id: "C-OP01", workflowStatus: "DRAFT" }],
  });
  const read = success(
    api.projectImprovementView(v, { schema: "ate.workspace.query/1", offset: 0 }),
  );
  expect(read.totalRecords).toBe(1);
});
it("unknown proposal evidence cannot ride a healthy peer", () => {
  const f = fixture(),
    p = { ...manualProposal(), evidenceIds: ["unprovided"] };
  expect(
    api.composeWorkspace(
      { ...f.input, report: reportFixture(), improvementRecords: [p] },
      f.context,
    ).ok,
  ).toBe(false);
});
it("duplicate proposal revision cannot overwrite immutable history", () => {
  const f = fixture();
  expect(
    api.composeWorkspace(
      {
        ...f.input,
        report: reportFixture(),
        improvementRecords: [manualProposal(), manualProposal()],
      },
      f.context,
    ).ok,
  ).toBe(false);
});
