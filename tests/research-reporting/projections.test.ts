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

it.each(["HEALTH", "READINESS", "LIFECYCLE", "QUALITY", "OBLIGATION"] as const)(
  "projects historical %s only in owner scope",
  (axis) => {
    const fields = {
      HEALTH: "health",
      READINESS: "readiness",
      LIFECYCLE: "lifecycle",
      QUALITY: "quality",
      OBLIGATION: "pending",
    };
    const a = _artifact(25, {
      health: "HEALTHY",
      readiness: "READY",
      lifecycle: "RUNNING",
      quality: "DECLARED",
      pending: 1,
    });
    const r = _ok(_api.composeReport(_input(a, _request(a, axis, fields[axis])), _context(a)));
    expect(r.facets[0]!.status).toBe("OBSERVED");
    expect(r.facets[0]!.facet.temporalScope).toBe("HISTORICAL");
    expect(r.facets[0]!.facet.owner).toBe("mose-core");
    expect(r.currentAuthority.kind).toBe("UNKNOWN");
  },
);
it.each(["COVERAGE", "AUTHORITY"] as const)(
  "%s never grants scalar authority or completeness",
  (axis) => {
    const field = axis === "COVERAGE" ? "denominator" : "currentAuthority",
      a = _artifact(25, { denominator: 0, currentAuthority: true });
    const r = _ok(_api.composeReport(_input(a, _request(a, axis, field)), _context(a)));
    expect(r.status).toBe("PARTIAL");
    expect(r.facets[0]!.facet.nativeStatus.kind).toBe("UNKNOWN");
  },
);
it("null denominator is not zero", () => {
  const a = _artifact(27, { eligibleDenominator: null });
  const r = _ok(
    _api.composeReport(_input(a, _request(a, "COVERAGE", "eligibleDenominator")), _context(a)),
  );
  expect(r.facets[0]!.facet.nativeStatus).not.toHaveProperty("value");
});
it("unknown field never fills readiness from health", () => {
  const a = _artifact(25, { health: "HEALTHY" });
  const r = _ok(_api.composeReport(_input(a, _request(a, "READINESS", "readiness")), _context(a)));
  expect(r.status).toBe("PARTIAL");
});
it("unapproved field cannot masquerade as diagnostic axis", () => {
  const a = _artifact();
  _bad(_api.composeReport(_input(a, _request(a, "HEALTH", "pending")), _context(a)));
});
it.each([true, 1, {}, [], "READY"])("invalid native health value %s is rejected", (health) => {
  const a = _artifact(25, { health });
  _bad(_api.composeReport(_input(a), _context(a)));
});
it.each(["HEALTHY", 0, false])("invalid readiness %s is rejected", (readiness) => {
  const a = _artifact(25, { readiness });
  _bad(_api.composeReport(_input(a, _request(a, "READINESS", "readiness")), _context(a)));
});
it("native owner failure does not confirm a positive observation", () => {
  const a = {
    ..._artifact(),
    captured: _ok(
      _api.captureNativeEvidence(
        { ok: false, error: { code: "RECORD_NOT_FOUND", commitment: "NONE" } },
        "COMMITMENT",
      ),
    ),
  };
  expect(_ok(_api.composeReport(_input(a), _context(a))).status).toBe("PARTIAL");
});
it("native UNKNOWN remains in sealed provenance", () => {
  const a = {
    ..._artifact(),
    captured: _ok(
      _api.captureNativeEvidence(
        { ok: false, error: { code: "SOURCE_UNAVAILABLE", commitment: "UNKNOWN" } },
        "COMMITMENT",
      ),
    ),
  };
  const r = _ok(_api.composeReport(_input(a), _context(a)));
  expect(r.observations[0]!.artifact.captured.commitment).toEqual(
    _fact("UNKNOWN", "native-selected-fields"),
  );
  expect(r.facets[0]!.facet.nativeStatus.kind).toBe("UNKNOWN");
});
it("query total is report facet count not native universe", () => {
  const r = _compose();
  const q = _ok(_api.queryReport(r, { offset: 0, limit: 20, owner: null }));
  expect(q.total).toBe(1);
  expect(q.scope).toBe("SEALED_REPORT_FACETS_NOT_NATIVE_SOURCE_ENUMERATION");
  expect(q.authenticity).toBe("SELF_HASH_ONLY_NOT_OWNER_AUTHENTICATION");
});
it.each([-1, 1.5, NaN, "0"])("invalid query offset %s", (offset) =>
  _bad(_api.queryReport(_compose(), { offset, limit: 20, owner: null })),
);
it.each([0, 51, 1.5, Infinity])("invalid query limit %s", (limit) =>
  _bad(_api.queryReport(_compose(), { offset: 0, limit, owner: null })),
);
it("query unknown owner is empty observed report scope only", () => {
  const q = _ok(_api.queryReport(_compose(), { offset: 0, limit: 20, owner: "other" }));
  expect(q.total).toBe(0);
  expect(q.currentAuthority.kind).toBe("UNKNOWN");
});
it("tampered report hash is rejected", () => {
  const r = _compose();
  _bad(_api.queryReport({ ...r, status: "PARTIAL" }, { offset: 0, limit: 20, owner: null }));
});
it("query does not accept an extra native command", () =>
  _bad(_api.queryReport(_compose(), { offset: 0, limit: 20, owner: null, command: "COMPLETE" })));
it("stable facet sorting does not coalesce native identities", () => {
  const a = _artifact(),
    r = _request(a);
  const facets = [
    { ...r.facets[0]!, id: "z" },
    { ...r.facets[0]!, id: "a" },
  ];
  const out = _ok(_api.composeReport(_input(a, { ...r, facets }), _context(a)));
  expect(out.facets.map((x) => x.facet.id)).toEqual(["a", "z"]);
  expect(out.facets).toHaveLength(2);
});
