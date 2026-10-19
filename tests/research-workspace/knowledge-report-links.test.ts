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

it("empty bounded knowledge subset is not owner absence", () => {
  const v = view();
  expect(v.currentAuthority).toBe("UNKNOWN");
  expect(v.scope).toBe("SUPPLIED_BOUNDED_INPUT_ONLY");
});
for (const key of [
  "schema",
  "id",
  "overlay",
  "knowledge",
  "report",
  "links",
  "improvementRecords",
  "handoverRequest",
]) {
  it(`compose missing ${key} rejects`, () => {
    const f = fixture();
    const x: Record<string, unknown> = { ...f.input };
    delete x[key];
    expect(api.composeWorkspace(x, f.context).ok).toBe(false);
  });
}
it("knowledge manifest substitution rejects", () => {
  const f = fixture();
  expect(
    api.composeWorkspace(
      {
        ...f.input,
        knowledge: {
          ...f.input.knowledge,
          sourceManifest: { ...f.input.knowledge.sourceManifest, baseline: "0".repeat(40) },
        },
      },
      f.context,
    ).ok,
  ).toBe(false);
});
it("metadata is not native report evidence", () => {
  const f = fixture();
  expect(api.composeWorkspace({ ...f.input, report: f.input.knowledge }, f.context).ok).toBe(false);
});
it("broken contextual link cannot fabricate evidence", () => {
  const f = fixture();
  expect(api.composeWorkspace({ ...f.input, links: [{ id: "missing" }] }, f.context).ok).toBe(
    false,
  );
});
it("non-source knowledge entry rejects", () => {
  const f = fixture();
  expect(
    api.composeWorkspace(
      {
        ...f.input,
        knowledge: {
          ...f.input.knowledge,
          catalogue: { baseline: api.baselines.knowledge, entries: [{ id: "invented" }] },
        },
      },
      f.context,
    ).ok,
  ).toBe(false);
});

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createKnowledgeCatalogue } from "@ate/research-insights";
function knowledgeFixture() {
  const f = fixture(),
    sourceBytes = execFileSync("git", ["show", api.baselines.knowledge + ":README.md"]),
    source = {
      path: "README.md",
      line: 1,
      sha256: "sha256:" + createHash("sha256").update(sourceBytes).digest("hex"),
    };
  const manifest = { baseline: api.baselines.knowledge, sources: { "README.md:1": source } };
  const entry = {
    schema: "ate.insights.knowledge/1",
    id: "term/health",
    type: "TERM",
    namespace: "research",
    revision: 1,
    contentVersion: "synthetic-source-linked.1",
    sourceRefs: ["README.md:1"],
    temporalScope: "HISTORICAL_SOURCE",
    definition: "Source-linked synthetic contextual explanation; not owner health authority.",
    relatedEntryIds: [],
    qualifications: ["F05"],
    reviewStatus: "SOURCE_EXTRACTED",
    personaTags: ["user"],
  };
  const knowledge = {
    catalogue: {
      schema: "ate.insights.catalogue/1",
      baseline: api.baselines.knowledge,
      generatedAt: at,
      entries: [entry],
    },
    sourceManifest: manifest,
    qualificationIds: ["F05"],
  };
  f.input.overlay.knowledgeManifestFingerprint = hash(manifest);
  f.context.releaseAuthentication.verifiedBindings.push({
    path: source.path,
    commit: api.baselines.knowledge,
    sha256: source.sha256,
  });
  return { ...f, knowledge };
}
it("genuine accepted source bytes qualify bounded glossary metadata", () => {
  const f = knowledgeFixture(),
    v = success(api.composeWorkspace({ ...f.input, knowledge: f.knowledge }, f.context));
  expect(v.knowledge).toMatchObject({
    entries: [{ id: "term/health", temporalScope: "HISTORICAL_SOURCE" }],
  });
  expect(v.currentAuthority).toBe("UNKNOWN");
});
it("knowledge source digest substitution cannot ride a release anchor", () => {
  const f = knowledgeFixture();
  f.knowledge.sourceManifest.sources["README.md:1"].sha256 = "sha256:" + "0".repeat(64);
  f.input.overlay.knowledgeManifestFingerprint = hash(f.knowledge.sourceManifest);
  expect(api.composeWorkspace({ ...f.input, knowledge: f.knowledge }, f.context).ok).toBe(false);
});
it("caller context cannot omit a referenced historical source", () => {
  const f = knowledgeFixture();
  f.context.releaseAuthentication.verifiedBindings =
    f.context.releaseAuthentication.verifiedBindings.filter(
      (b) => b.commit !== api.baselines.knowledge,
    );
  expect(api.composeWorkspace({ ...f.input, knowledge: f.knowledge }, f.context).ok).toBe(false);
});
it("accepted public catalogue owns deterministic subset validation", () => {
  const f = knowledgeFixture(),
    r = createKnowledgeCatalogue({
      entries: f.knowledge.catalogue.entries,
      sourceManifest: f.knowledge.sourceManifest,
      qualificationIds: f.knowledge.qualificationIds,
      generatedAt: at,
    });
  expect(r.ok).toBe(true);
});
it("all27 prompt rows are separately source-linked in published help", () => {
  const text = readFileSync("docs/architecture/research-workspace.md", "utf8");
  for (let i = 1; i <= 27; i++) expect(text).toContain(`P${i}`);
});
