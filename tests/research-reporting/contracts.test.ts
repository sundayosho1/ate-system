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

it("valid closed request retains exact canonical time and subject", () => {
  const a = _artifact();
  expect(_ok(_api.validateReportRequest(_request(a)))).toEqual(_request(a));
});
const invalids: readonly (readonly [string, unknown])[] = [
  ["null", null],
  ["primitive", 3],
  ["array", []],
  ["missing schema", {}],
  ["extra key", { ..._request(_artifact()), command: "STOP" }],
  ["wrong schema", { ..._request(_artifact()), schema: "other" }],
  ["wrong baseline", { ..._request(_artifact()), baseline: "f".repeat(40) }],
  ["blank id", { ..._request(_artifact()), id: " " }],
  ["oversized id", { ..._request(_artifact()), id: "é".repeat(129) }],
  ["control id", { ..._request(_artifact()), id: "a\n" }],
  ["naive time", { ..._request(_artifact()), asOf: "2026-10-17T12:00:00" }],
  ["offset time", { ..._request(_artifact()), asOf: "2026-10-17T12:00:00.000+00:00" }],
  ["invalid calendar", { ..._request(_artifact()), asOf: "invalid" }],
  ["unknown mode", { ..._request(_artifact()), mode: "LIVE" }],
  ["facets null", { ..._request(_artifact()), facets: null }],
  ["facets scalar", { ..._request(_artifact()), facets: 3 }],
  ...([0, 28, -1, 1.5] as const).map(
    (n) =>
      [
        "invalid prompt " + n,
        { ..._request(_artifact()), facets: [{ ..._request(_artifact()).facets[0], prompt: n }] },
      ] as const,
  ),
  [
    "unknown axis",
    { ..._request(_artifact()), facets: [{ ..._request(_artifact()).facets[0], axis: "PROFIT" }] },
  ],
  [
    "pollution field",
    {
      ..._request(_artifact()),
      facets: [{ ..._request(_artifact()).facets[0], field: "__proto__" }],
    },
  ],
  [
    "missing subject",
    { ..._request(_artifact()), facets: [{ ..._request(_artifact()).facets[0], subject: [] }] },
  ],
  [
    "duplicate facet",
    {
      ..._request(_artifact()),
      facets: [..._request(_artifact()).facets, ..._request(_artifact()).facets],
    },
  ],
  ["undefined", undefined],
  ["symbol", Symbol("x")],
  ["function", () => true],
  ["nonfinite", NaN],
];
it.each(invalids)("closed request rejects %s", (_name, value) =>
  _bad(_api.validateReportRequest(value)),
);
it("request accessor is rejected without executing it", () => {
  let calls = 0;
  const raw = {
    get schema() {
      calls++;
      return "ate.reporting.request/1";
    },
  };
  _bad(_api.validateReportRequest(raw));
  expect(calls).toBe(0);
});
it("request cycle is structured rejection", () => {
  const r: { self?: unknown } = {};
  r.self = r;
  _bad(_api.validateReportRequest(r));
});
it("multibyte id exactly256bytes is allowed", () => {
  const r = { ..._request(_artifact()), id: "é".repeat(128) };
  expect(_api.validateReportRequest(r).ok).toBe(true);
});
it("descriptor larger than64KiB is rejected", () =>
  _bad(_api.validateReportRequest({ ..._request(_artifact()), purpose: "x".repeat(65537) })));
it("sparse facet input is rejected", () =>
  _bad(_api.validateReportRequest({ ..._request(_artifact()), facets: new Array(2) })));
