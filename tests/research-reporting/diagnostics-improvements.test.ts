import { it, expect } from "vitest";
import * as _api from "@ate/research-reporting";
import type {
  ReportingResult as _Result,
  EvidenceArtifact as _Artifact,
  Axis as _Axis,
  ReportRequest as _Request,
} from "@ate/research-reporting";
import { VirtualClock as _VirtualClock, mustParseUtc as _mustParseUtc } from "@ate/time";
import type { Fact as _Fact, JsonValue as _Json } from "@ate/research-insight-contracts";
const _base = "2cb81c1d33462f20ce15a4616eb971296d2d44ee",
  _now = "2026-10-18T12:00:00.000Z",
  _at = "2026-10-17T12:00:00.000Z";
function _ok<V>(r: _Result<V>): V {
  expect(r.ok).toBe(true);
  if (!r.ok) throw Error(JSON.stringify(r.issues));
  return r.value;
}
function _bad(r: { readonly ok: boolean }) {
  expect(r.ok).toBe(false);
}
const _unknown = (): _Fact => ({
  kind: "UNKNOWN",
  reasonIds: ["SUPPLIED_NATIVE_HASH_UNAVAILABLE"],
});
const _fact = (value: _Json, id = "evidence"): _Fact => ({
  kind: "KNOWN",
  value,
  evidenceIds: [id],
});
function _artifact(
  prompt = 25,
  value: unknown = { health: "HEALTHY", readiness: "READY", lifecycle: "RUNNING", pending: 1 },
  unit = "STATUS",
): _Artifact {
  return {
    id: "evidence",
    prompt,
    owner: _api.promptOwners[prompt - 1]!,
    ownerVersion: "synthetic-offline-fixture.1",
    sourceCommit: _base,
    nativeIdentity: "fixture-native-identity",
    nativeFingerprint: _unknown(),
    subject: ["session", "universe", "instrument"],
    unit,
    effectiveAt: _at,
    availableAt: _at,
    captured: _ok(_api.captureNativeEvidence(value, "DIRECT")),
  };
}
function _request(a: _Artifact, axis: _Axis = "HEALTH", field = "health"): _Request {
  return {
    schema: "ate.reporting.request/1",
    id: "request",
    baseline: _base,
    purpose: "OFFLINE_RESEARCH",
    mode: "HISTORICAL",
    asOf: _at,
    knowledgeCutoff: _at,
    facets: [
      {
        id: "facet",
        prompt: a.prompt,
        owner: a.owner,
        subject: a.subject,
        axis,
        artifactId: a.id,
        field,
        unit: a.unit,
      },
    ],
  };
}
function _input(a: _Artifact, r = _request(a)) {
  return { request: r, evidence: [a], charts: [], improvements: [] };
}
function _context(a: _Artifact, anchored = true) {
  return {
    clock: new _VirtualClock(_mustParseUtc(_now), "REPLAY"),
    anchors: anchored
      ? [
          {
            artifactId: a.id,
            captureDigest: _api.captureDigest(a),
            sourceCommit: a.sourceCommit,
            owner: a.owner,
            reference: "trusted-synthetic-fixture-anchor",
          },
        ]
      : [],
  };
}
const _policy = () => _ok(_api.createReportingPolicy());
const _compose = (a = _artifact()) => _ok(_api.composeReport(_input(a), _context(a)));
const _copy = <V>(v: V): V => structuredClone(v);

const _reason = () => ({
  owner: "mose-core",
  ownerVersion: "0.25.0-mose-core.1",
  family: "COMMITMENT",
  operation: "query",
  phase: "READ",
  code: "RECORD_NOT_FOUND",
  helpRefs: [],
});
const _proposal = () => ({
  schema: "ate.insights.improvement/1",
  id: "C-OP01",
  revision: 1,
  evidenceIds: ["evidence"],
  affectedOwners: ["research-insights"],
  findingRefs: ["C-OP01"],
  hypothesis: "Snapshot explanations could be more specific",
  boundedChange: "Future separately authorized Knowledge Center review",
  qualificationImpact: "C-OP01 remains OPEN",
  suggestedTests: ["owner-contract-review"],
  workflowStatus: "DRAFT",
  decisionRef: _unknown(),
  supersedes: _unknown(),
});
it("unmapped native code preserves exact namespaced identity", () => {
  const r = _ok(_api.explainDiagnostic(_reason()));
  expect(r.nativeCode).toBe("RECORD_NOT_FOUND");
  expect(r.helpStatus).toBe("HELP_UNMAPPED");
  expect(r.severity).toBe("UNESTABLISHED");
});
it("help refs remain source-scoped rather than authentication", () =>
  expect(
    _ok(_api.explainDiagnostic({ ..._reason(), helpRefs: ["runbook:source-loss"] })).helpStatus,
  ).toBe("SOURCE_SCOPED_REFERENCES_NOT_AUTHENTICATION"));
it.each(["owner", "ownerVersion", "family", "operation", "phase", "code"] as const)(
  "reason requires %s",
  (key) => _bad(_api.explainDiagnostic({ ..._reason(), [key]: "" })),
);
it.each([null, 3, "help", [""]])("invalid help representation %s", (helpRefs) =>
  _bad(_api.explainDiagnostic({ ..._reason(), helpRefs })),
);
it("reason explanation cannot run a proposed action", () =>
  _bad(_api.explainDiagnostic({ ..._reason(), command: "RECONCILE" })));
it("C-OP01 remains supplied non-executing proposal", () => {
  const p = _ok(_api.projectImprovementRegister([_proposal()], ["evidence"]));
  expect(p.records[0]!.id).toBe("C-OP01");
  expect(p.records[0]!.qualificationImpact).toContain("OPEN");
  expect(p.mutationAuthority).toBe(false);
  expect(p.decisionAuthority).toBe("NOT_ESTABLISHED_SUPPLIED_RECORDS_ONLY");
});
it("missing evidence cannot support a proposal", () =>
  _bad(_api.projectImprovementRegister([_proposal()], [])));
it("duplicate proposal revision rejects rather than overwrites", () =>
  _bad(_api.projectImprovementRegister([_proposal(), _proposal()], ["evidence"])));
it("two revisions retain both immutable histories", () =>
  expect(
    _ok(
      _api.projectImprovementRegister([{ ..._proposal(), revision: 2 }, _proposal()], ["evidence"]),
    ).records.map((r) => r.revision),
  ).toEqual([1, 2]));
it("native supplied governance status does not gain decision authority", () => {
  const p = _ok(
    _api.projectImprovementRegister(
      [
        {
          ..._proposal(),
          workflowStatus: "GOVERNANCE_DISPOSITION",
          decisionRef: _fact("caller-label"),
        },
      ],
      ["evidence"],
    ),
  );
  expect(p.decisionAuthority).toContain("NOT_ESTABLISHED");
});
it.each(["id", "hypothesis", "boundedChange", "qualificationImpact"] as const)(
  "proposal required %s cannot be missing",
  (key) => {
    const p: Record<string, unknown> = { ..._proposal() };
    delete p[key];
    _bad(_api.projectImprovementRegister([p], ["evidence"]));
  },
);
it("proposal display bounds are bytes, not codepoints", () =>
  _bad(
    _api.projectImprovementRegister(
      [{ ..._proposal(), hypothesis: "é".repeat(513) }],
      ["evidence"],
    ),
  ));
it("more than256proposals is rejected", () =>
  _bad(
    _api.projectImprovementRegister(
      Array.from({ length: 257 }, (_, i) => ({ ..._proposal(), id: "p" + i })),
      ["evidence"],
    ),
  ));
it("proposal exported state is detached from source", () => {
  const p = _proposal(),
    r = _ok(_api.projectImprovementRegister([p], ["evidence"]));
  p.hypothesis = "changed";
  expect(r.records[0]!.hypothesis).not.toBe("changed");
  expect(Object.isFrozen(r.records[0])).toBe(true);
});
