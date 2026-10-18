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

it("J01 repository authentication never follows a substituted anchor", () => {
  const a = _artifact(1, { source: "README" }),
    c = _context(a);
  _bad(
    _api.composeReport(
      { ..._input(a), request: { ..._request(a), facets: [] } },
      { ...c, anchors: c.anchors.map((x) => ({ ...x, sourceCommit: "a".repeat(40) })) },
    ),
  );
});
it("J02 DomainResult family preserves issues instead of negative commitment", () => {
  const c = _ok(
    _api.captureNativeEvidence(
      { ok: false, issues: [{ code: "SCHEMA", message: "invalid" }] },
      "DOMAIN",
    ),
  );
  expect(c.commitment.kind).toBe("UNKNOWN");
});
it("J03 runtime state is owner-scoped historical evidence", () => {
  const a = _artifact(3, { state: "RUNNING" });
  const r = _ok(_api.composeReport(_input(a, _request(a, "LIFECYCLE", "state")), _context(a)));
  expect(r.facets[0]!.facet.temporalScope).toBe("HISTORICAL");
  expect(r.currentAuthority.kind).toBe("UNKNOWN");
});
it("J04 report cannot publish or drain event bus", () => {
  let calls = 0;
  _bad(_api.admitReadBinding({ method: "publish", call: () => calls++ }));
  expect(calls).toBe(0);
});
it("J05 persistence UNKNOWN survives historical ACK projection", () => {
  const a = {
    ..._artifact(5),
    captured: _ok(
      _api.captureNativeEvidence(
        { ok: false, error: { code: "WRITE_UNCERTAIN", commitment: "UNKNOWN" } },
        "COMMITMENT",
      ),
    ),
  };
  const r = _ok(_api.composeReport(_input(a), _context(a)));
  expect(r.status).toBe("PARTIAL");
  expect(r.observations[0]!.artifact.captured.commitment).toEqual(
    _fact("UNKNOWN", "native-selected-fields"),
  );
});
it("J06 P6bounded dependency has no automatic fallback", () => {
  const a = _artifact(6),
    c = _context(a);
  c.clock.now = () => {
    throw Error("clock unavailable");
  };
  _bad(_api.composeReport(_input(a), c));
});
it("J07 proposed configuration is not current effective authority", () => {
  const a = _artifact(7, { currentAuthority: true });
  const r = _ok(
    _api.composeReport(_input(a, _request(a, "AUTHORITY", "currentAuthority")), _context(a)),
  );
  expect(r.status).toBe("PARTIAL");
});
it("J08 schema report fingerprint mismatch cannot silently validate", () => {
  const a = _artifact(8),
    c = _context(a);
  _bad(
    _api.composeReport(
      _input({ ...a, captured: _ok(_api.captureNativeEvidence({ health: "DEGRADED" }, "DIRECT")) }),
      c,
    ),
  );
});
it("J09 historical version is not current active version", () => {
  const a = _artifact(9);
  expect(
    _ok(_api.composeReport(_input(a, { ..._request(a), mode: "CURRENT" }), _context(a))).status,
  ).toBe("PARTIAL");
});
it("J10 enabled capability metadata grants no execution authority", () => {
  const a = _artifact(10, { currentAuthority: true });
  const r = _ok(
    _api.composeReport(_input(a, _request(a, "AUTHORITY", "currentAuthority")), _context(a)),
  );
  expect(r.facets[0]!.facet.nativeStatus.kind).toBe("UNKNOWN");
});
it("J11 caller approval metadata cannot activate owner method", () =>
  _bad(_api.admitReadBinding({ method: "submitDecision", actor: "maker", approved: true })));
it("J12 reporting cannot execute historical rollback", () =>
  _bad(_api.admitReadBinding({ method: "executeRollback", knownGood: true })));
it("J13 exact decimal contract metadata is preserved without price truth", () => {
  const c = _ok(_api.captureNativeEvidence({ price: "123.0000000000000001" }, "DIRECT"));
  expect(c.value).toEqual({ price: "123.0000000000000001" });
  expect(c.valueSemantics).toBe("UNVERIFIED_NATIVE_CAPTURE");
});
it("J14 unavailable dataset availability blocks point-in-time claim", () => {
  const a = { ..._artifact(14), availableAt: null };
  expect(_ok(_api.composeReport(_input(a), _context(a))).observations[0]!.pointInTime).toBe(
    "UNESTABLISHED",
  );
});
it("J15 quality scales do not become a global score", () => {
  const a = _artifact(15, { quality: 80 }, "OWNER_QUALITY_SCALE");
  const r = _ok(_api.composeReport(_input(a, _request(a, "QUALITY", "quality")), _context(a)));
  expect(r.facets[0]!.unit).toBe("OWNER_QUALITY_SCALE");
  expect(r.currentAuthority.kind).toBe("UNKNOWN");
});
it("J16 mismatched catalogue subject cannot join lineage", () => {
  const a = _artifact(16),
    r = _request(a);
  _bad(
    _api.composeReport(
      _input(a, { ...r, facets: [{ ...r.facets[0]!, subject: ["other-dataset"] }] }),
      _context(a),
    ),
  );
});
it("J17 capture recovery obligation is not hidden by historical health", () => {
  const a = _artifact(17, { recoveryRequired: true });
  const r = _ok(
    _api.composeReport(_input(a, _request(a, "OBLIGATION", "recoveryRequired")), _context(a)),
  );
  expect(r.facets[0]!.facet.nativeStatus).toEqual(_fact(true));
  expect(r.currentAuthority.kind).toBe("UNKNOWN");
});
it("J18 future correction cannot enter earlier knowledge window", () => {
  const a = { ..._artifact(18, { quality: "CORRECTED" }), availableAt: _now };
  const r = _ok(_api.composeReport(_input(a, _request(a, "QUALITY", "quality")), _context(a)));
  expect(r.status).toBe("PARTIAL");
});
it("J19 replay snapshot remains a denied publishing command", () =>
  _bad(_api.admitReadBinding({ method: "ReplayController.snapshot", streamId: "s" })));
it("J20 self-declared registry fingerprint is not source authority", () => {
  const a = _artifact(20);
  const r = _ok(_api.composeReport(_input(a), _context(a, false)));
  expect(r.facets[0]!.status).toBe("UNAVAILABLE");
});
it("J21 broker declaration is not current terminal availability", () => {
  const a = _artifact(21);
  expect(
    _ok(_api.composeReport(_input(a, { ..._request(a), mode: "CURRENT" }), _context(a)))
      .currentAuthority.kind,
  ).toBe("UNKNOWN");
});
it("J22 canonical alias source mismatch cannot imply equivalence", () => {
  const a = _artifact(22),
    c = _context(a);
  _bad(_api.composeReport(_input({ ...a, unit: "DIFFERENT_CONTRACT" }), c));
});
it("J23 missing specification dependency evidence stays unavailable", () => {
  const a = _artifact(23, {});
  const r = _ok(_api.composeReport(_input(a, _request(a, "QUALITY", "quality")), _context(a)));
  expect(r.facets[0]!.facet.nativeStatus.kind).toBe("UNKNOWN");
});
it("J24 PASSED label does not invent attestation issuer authority", () => {
  const a = _artifact(24, { currentAuthority: true, outcome: "PASSED" });
  const r = _ok(
    _api.composeReport(_input(a, _request(a, "AUTHORITY", "currentAuthority")), _context(a)),
  );
  expect(r.status).toBe("PARTIAL");
});
it("J25 negative provenance obligation retains source tuple", () => {
  const a = _artifact(25, { negativeProvenanceObligations: ["native-obligation"] });
  const r = _ok(
    _api.composeReport(
      _input(a, _request(a, "OBLIGATION", "negativeProvenanceObligations")),
      _context(a),
    ),
  );
  expect(r.facets[0]!.facet.subjectTuple).toEqual(a.subject);
  expect(r.facets[0]!.facet.nativeStatus).toEqual(_fact(["native-obligation"]));
});
it("J26 nextOffsetnull does not imply known request denominator", () => {
  const a = _artifact(26, { totalWork: 0, totalRequests: 3, nextOffset: null });
  const r = _ok(_api.composeReport(_input(a, _request(a, "COVERAGE", "denominator")), _context(a)));
  expect(r.status).toBe("PARTIAL");
  expect(r.facets[0]!.facet.nativeStatus.kind).toBe("UNKNOWN");
});
it("J27 floor debt and unknown eligible denominator stay separate", () => {
  const a = _artifact(27, { floorDebt: 3, eligibleDenominator: null });
  const r = _request(a, "OBLIGATION", "floorDebt");
  const out = _ok(
    _api.composeReport(
      _input(a, {
        ...r,
        facets: [
          ...r.facets,
          { ...r.facets[0]!, id: "coverage", axis: "COVERAGE", field: "eligibleDenominator" },
        ],
      }),
      _context(a),
    ),
  );
  expect(out.status).toBe("PARTIAL");
  expect(out.facets.find((f) => f.facet.axis === "OBLIGATION")!.facet.nativeStatus).toEqual(
    _fact(3),
  );
});
