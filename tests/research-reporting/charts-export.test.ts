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

const _chart = (a: _Artifact) => ({
  schema: "ate.reporting.chart/1",
  id: "chart",
  kind: "TABLE",
  label: "Declared health",
  legend: "Offline source-qualified values",
  series: [
    {
      id: "health",
      points: [
        {
          id: "point",
          value: _fact("HEALTHY"),
          unit: a.unit,
          at: a.effectiveAt,
          availableAt: a.availableAt,
          evidenceId: a.id,
          correctionOf: null,
          finality: "UNKNOWN",
        },
      ],
    },
  ],
});
function _charts(a: _Artifact, c: unknown) {
  const r = _compose(a);
  return _api.buildChartMetadata(c, r.observations, _policy());
}
it("chart fact retains exact source/unit/time/evidence", () => {
  const a = _artifact(),
    c = _ok(_charts(a, [_chart(a)]));
  expect(c[0]!.series[0]!.points[0]!.value).toEqual(_fact("HEALTHY"));
  expect(c[0]!.series[0]!.points[0]!.unit).toBe("STATUS");
});
it.each(["TIMESERIES", "BAR", "SCATTER", "STATUS_TIMELINE", "TABLE"])(
  "chart kind %s is metadata only",
  (kind) => {
    const a = _artifact();
    expect(_charts(a, [{ ..._chart(a), kind }]).ok).toBe(true);
  },
);
it("unknown value stays a gap rather than zero", () => {
  const a = _artifact(),
    c = _chart(a),
    point = { ...c.series[0]!.points[0]!, value: _unknown() };
  const r = _ok(_charts(a, [{ ...c, series: [{ id: "s", points: [point] }] }]));
  expect(r[0]!.series[0]!.points[0]!.value).not.toHaveProperty("value");
});
it("chart units cannot be substituted", () => {
  const a = _artifact(),
    c = _chart(a);
  _bad(
    _charts(a, [
      { ...c, series: [{ id: "s", points: [{ ...c.series[0]!.points[0]!, unit: "PRICE" }] }] },
    ]),
  );
});
it("chart value cannot invent a source quantity", () => {
  const a = _artifact(),
    c = _chart(a);
  _bad(
    _charts(a, [
      { ...c, series: [{ id: "s", points: [{ ...c.series[0]!.points[0]!, value: _fact(999) }] }] },
    ]),
  );
});
it("chart cannot invent finality", () => {
  const a = _artifact(),
    c = _chart(a);
  _bad(
    _charts(a, [
      { ...c, series: [{ id: "s", points: [{ ...c.series[0]!.points[0]!, finality: "FINAL" }] }] },
    ]),
  );
});
it("chart cannot invent correction lineage", () => {
  const a = _artifact(),
    c = _chart(a);
  _bad(
    _charts(a, [
      {
        ...c,
        series: [{ id: "s", points: [{ ...c.series[0]!.points[0]!, correctionOf: "missing" }] }],
      },
    ]),
  );
});
it("exact decimal strings are not rounded to binary floats", () => {
  const price = "0.1000000000000000000001",
    a = _artifact(13, { price }, "PRICE"),
    c = _chart(a);
  const point = { ...c.series[0]!.points[0]!, value: _fact(price) };
  const out = _ok(_charts(a, [{ ...c, series: [{ id: "price", points: [point] }] }]));
  expect(out[0]!.series[0]!.points[0]!.value).toEqual(_fact(price));
});
it("duplicate chart ids cannot overwrite", () => {
  const a = _artifact();
  _bad(_charts(a, [_chart(a), _chart(a)]));
});
it("ninth chart is rejected", () => {
  const a = _artifact();
  _bad(
    _charts(
      a,
      Array.from({ length: 9 }, (_, i) => ({ ..._chart(a), id: "c" + i })),
    ),
  );
});
it("ninth series is rejected", () => {
  const a = _artifact();
  _bad(
    _charts(a, [
      { ..._chart(a), series: Array.from({ length: 9 }, (_, i) => ({ id: "s" + i, points: [] })) },
    ]),
  );
});
it("UTF8label bound rejects129two-byte characters", () => {
  const a = _artifact();
  _bad(_charts(a, [{ ..._chart(a), label: "é".repeat(129) }]));
});
it("unknown chart executable field is denied", () => {
  const a = _artifact();
  _bad(_charts(a, [{ ..._chart(a), render: "eval()" }]));
});
it("ASCII export is deterministic redacted canonical bytes", () => {
  const r = _compose(),
    x = _ok(_api.serializeReportExport(r));
  expect(x.bytes).toBe(_ok(_api.serializeReportExport(r)).bytes);
  expect(x.bytes).not.toContain("fixture-native-identity");
  expect(x.projectionFingerprint).not.toBe(r.manifest.reportFingerprint);
});
it("multibyte source text is redacted without UTF8corruption", () => {
  const a = _artifact(25, { health: "HEALTHY", secret: "PLACEHOLDER_日本語é😀" }),
    x = _ok(_api.serializeReportExport(_compose(a)));
  expect(Buffer.from(x.bytes, "utf8").toString("utf8")).toBe(x.bytes);
  expect(x.bytes).not.toContain("日本語");
  expect(x.bytes).not.toContain("secret");
});
it("malformed bytes are not a report/decoder input", () =>
  _bad(_api.serializeReportExport(Uint8Array.from([0xc3, 0x28, 0xff]))));
it("export lower byte ceiling is enforced", () =>
  _bad(
    _api.serializeReportExport(_compose(), _ok(_api.createReportingPolicy({ maxExportBytes: 10 }))),
  ));
it("tampered canonical bundle is not exported", () => {
  const r = _compose();
  _bad(_api.serializeReportExport({ ...r, projectionRequestComplete: false }));
});
it("export omits untrusted HTMLlabels rather than evaluating", () => {
  const a = _artifact(),
    c = { ..._chart(a), label: "<script>alert(1)</script>" };
  const r = _ok(_api.composeReport({ ..._input(a), charts: [c] }, _context(a)));
  expect(_ok(_api.serializeReportExport(r)).bytes).not.toContain("script");
});

it("equal value in unrelated native field cannot populate a chart series", () => {
  const a = _artifact(25, { health: "HEALTHY", other: "HEALTHY" }),
    c = _chart(a);
  _bad(_charts(a, [{ ...c, series: [{ id: "missing-field", points: c.series[0]!.points }] }]));
});
