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

it("source context accepts exact synthetic bindings without readiness authority", () => {
  const f = fixture();
  expect(
    success(api.validateReleaseOverlay(f.input.overlay, f.context.releaseAuthentication))
      .currentReadiness,
  ).toBe("UNESTABLISHED");
  expect(view().currentAuthority).toBe("UNKNOWN");
});
for (const key of [
  "schema",
  "id",
  "revision",
  "knowledgeSourceCommit",
  "knowledgeManifestFingerprint",
  "reportingValidationBaseline",
  "acceptedGovernanceCommit",
  "acceptedRecordRefs",
  "scope",
  "qualifications",
  "sourceBindings",
  "observedAt",
  "authority",
  "currentHealth",
  "currentReadiness",
]) {
  it(`missing release ${key} rejects`, () => {
    const f = fixture();
    const o: Record<string, unknown> = { ...f.input.overlay };
    delete o[key];
    expect(api.validateReleaseOverlay(o, f.context.releaseAuthentication).ok).toBe(false);
  });
}
it("release cannot authenticate itself", () => {
  const f = fixture();
  expect(api.validateReleaseOverlay(f.input.overlay, {}).ok).toBe(false);
});
it("substituted trusted-context commit rejects", () => {
  const f = fixture();
  expect(
    api.validateReleaseOverlay(f.input.overlay, {
      ...f.context.releaseAuthentication,
      authenticatedCommit: "0".repeat(40),
    }).ok,
  ).toBe(false);
});
it("unknown release field rejects", () => {
  const f = fixture();
  expect(
    api.validateReleaseOverlay(
      { ...f.input.overlay, active: true },
      f.context.releaseAuthentication,
    ).ok,
  ).toBe(false);
});
for (const path of [
  "../README.md",
  "/README.md",
  "https://example.invalid",
  "a\\b",
  "a//b",
  "./README.md",
]) {
  it(`unsafe release path ${path} rejects`, () => {
    const f = fixture();
    f.input.overlay.sourceBindings[0]!.path = path;
    expect(api.validateReleaseOverlay(f.input.overlay, f.context.releaseAuthentication).ok).toBe(
      false,
    );
  });
}

import { execFileSync } from "node:child_process";
it("real accepted Git source bytes authenticate release context without owner readiness", () => {
  const f = fixture();
  for (const b of [...f.input.overlay.sourceBindings, ...f.input.overlay.acceptedRecordRefs])
    b.sha256 =
      "sha256:" +
      createHash("sha256")
        .update(execFileSync("git", ["show", api.baselines.governance + ":" + b.path]))
        .digest("hex");
  f.context.releaseAuthentication.verifiedBindings = [
    ...f.input.overlay.sourceBindings,
    ...f.input.overlay.acceptedRecordRefs,
  ];
  const r = success(api.validateReleaseOverlay(f.input.overlay, f.context.releaseAuthentication));
  expect(r.currentReadiness).toBe("UNESTABLISHED");
  expect(r.authority).toBe("NON_AUTHORITATIVE_RELEASE_METADATA");
});
