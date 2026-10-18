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

it("valid anchored historical value is observed with unestablished crossowner consistency", () => {
  const r = _compose();
  expect(r.facets[0]!.status).toBe("OBSERVED");
  expect(r.consistency.mode).toBe("SEQUENTIAL_UNESTABLISHED");
  expect(r.currentAuthority.kind).toBe("UNKNOWN");
});
it("current request cannot acquire authority from historical artifact", () => {
  const a = _artifact(),
    r = _ok(_api.composeReport(_input(a, { ..._request(a), mode: "CURRENT" }), _context(a)));
  expect(r.status).toBe("PARTIAL");
  expect(r.facets[0]!.facet.currentAuthority.kind).toBe("UNKNOWN");
});
it("no trusted anchor means unavailable rather than authoritative negative", () => {
  const a = _artifact(),
    r = _ok(_api.composeReport(_input(a), _context(a, false)));
  expect(r.status).toBe("PARTIAL");
  expect(r.facets[0]!.reasons).toContain("REPORTING:SOURCE_UNAUTHENTICATED");
});
it("unknown availability cannot support PIT", () => {
  const a = { ..._artifact(), availableAt: null };
  expect(_ok(_api.composeReport(_input(a), _context(a))).status).toBe("PARTIAL");
});
it("future availability is excluded", () => {
  const a = { ..._artifact(), availableAt: _now };
  expect(_ok(_api.composeReport(_input(a), _context(a))).status).toBe("PARTIAL");
});
it("future effective time is excluded", () => {
  const a = { ..._artifact(), effectiveAt: _now };
  expect(_ok(_api.composeReport(_input(a), _context(a))).status).toBe("PARTIAL");
});
it.each(["asOf", "knowledgeCutoff"] as const)("future request %s is rejected", (key) => {
  const a = _artifact();
  _bad(
    _api.composeReport(
      _input(a, { ..._request(a), [key]: "2099-01-01T00:00:00.000Z" }),
      _context(a),
    ),
  );
});
it.each(["owner", "captureDigest", "sourceCommit"] as const)(
  "anchor %s mismatch rejects evidence",
  (key) => {
    const a = _artifact(),
      c = _context(a);
    const anchors = c.anchors.map((x) => ({ ...x, [key]: "wrong" }));
    _bad(_api.composeReport(_input(a), { ...c, anchors }));
  },
);
it("duplicate anchors cannot substitute another trust context", () => {
  const a = _artifact(),
    c = _context(a);
  _bad(_api.composeReport(_input(a), { ...c, anchors: [...c.anchors, ...c.anchors] }));
});
it("duplicate artifact identity is rejected", () => {
  const a = _artifact();
  _bad(_api.composeReport({ ..._input(a), evidence: [a, a] }, _context(a)));
});
it.each(["owner", "unit", "subject", "prompt"] as const)(
  "facet %s mismatch does not join unrelated source",
  (key) => {
    const a = _artifact(),
      r = _request(a);
    const facet = {
      ...r.facets[0],
      [key]: key === "subject" ? ["other"] : key === "prompt" ? 24 : "other",
    };
    _bad(_api.composeReport(_input(a, { ...r, facets: [facet] } as _Request), _context(a)));
  },
);
it("missing facet evidence remains partial with original requested identity", () => {
  const a = _artifact(),
    r = _ok(_api.composeReport({ ..._input(a), evidence: [] }, _context(a)));
  expect(r.manifest.missingFacets).toEqual(["facet"]);
  expect(r.facets[0]!.facet.nativeStatus.kind).toBe("UNKNOWN");
});
it("canonical report is invariant under equivalent own key insertion order", () => {
  const a = _artifact(25, { health: "HEALTHY", pending: 1 }),
    b = _artifact(25, { pending: 1, health: "HEALTHY" });
  expect(_compose(a).manifest.reportFingerprint).toBe(_compose(b).manifest.reportFingerprint);
});
it("same inputs and P6time produce identical report bytes", () =>
  expect(JSON.stringify(_compose())).toBe(JSON.stringify(_compose())));
it("input mutation cannot mutate sealed report", () => {
  const a = _artifact(),
    r = _compose(a);
  const changed = { ...a, unit: "changed" };
  expect(r.observations[0]!.artifact.unit).not.toBe(changed.unit);
  expect(Object.isFrozen(r.facets[0]!.facet)).toBe(true);
});
it("supplied native fingerprint is not a derived trust signature", () => {
  const a = { ..._artifact(), nativeFingerprint: _fact("sha256:" + "a".repeat(64)) };
  expect(_compose(a).observations[0]!.artifact.nativeFingerprint).toEqual(a.nativeFingerprint);
  expect(_compose(a).currentAuthority.kind).toBe("UNKNOWN");
});
it("malformed known native fingerprint is rejected", () =>
  _bad(
    _api.composeReport(
      _input({ ..._artifact(), nativeFingerprint: _fact("self-asserted") }),
      _context(_artifact()),
    ),
  ));
