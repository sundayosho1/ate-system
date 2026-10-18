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

it("default policy keeps all owner reads disabled", () => {
  const p = _policy();
  expect(p.ownerReads).toBe(false);
  expect(p.refresh).toBe(false);
  expect(p.retries).toBe(0);
});
it.each([
  "maxArtifacts",
  "maxNativeBytes",
  "maxDepth",
  "maxNodes",
  "maxReportBytes",
  "maxEvidenceRefs",
  "maxFacets",
  "maxClockReads",
  "maxCalls",
  "maxCharts",
  "maxSeries",
  "maxPointsPerChart",
  "maxPoints",
  "maxImprovements",
  "maxExportBytes",
] as const)("caller cannot raise %s ceiling", (key) =>
  _bad(_api.createReportingPolicy({ [key]: _api.D1[key] + 1 })),
);
it.each([0, -1, 1.5, NaN, Infinity, "1", null])("invalid lowered limit %s is denied", (v) =>
  _bad(_api.createReportingPolicy({ maxCalls: v })),
);
it("unknown policy fields cannot activate a route", () =>
  _bad(_api.createReportingPolicy({ ownerReads: true })));
it("lower policy limits are accepted", () =>
  expect(_ok(_api.createReportingPolicy({ maxClockReads: 1 })).maxClockReads).toBe(1));
it("all report clock reads consume total and owner budget", () => {
  const r = _compose();
  expect(r.budget.clockReads).toBe(2);
  expect(r.budget.calls).toBe(2);
});
it("insufficient clock budget denies second read without reset", () => {
  const a = _artifact();
  _bad(
    _api.composeReport(
      _input(a),
      _context(a),
      _ok(_api.createReportingPolicy({ maxClockReads: 1 })),
    ),
  );
});
it("ledger exact capacity then one-beyond fails", () => {
  const l = new _api.ReadBudgetLedger(_policy());
  for (let i = 0; i < 8; i++) l.clock();
  expect(l.snapshot().clockReads).toBe(8);
  expect(() => l.clock()).toThrow("REPORTING:BUDGET_EXHAUSTED");
  expect(l.snapshot().clockReads).toBe(8);
});
it("evidence consumption is cumulative across attempted batches", () => {
  const l = new _api.ReadBudgetLedger(_policy());
  l.evidence(500000);
  l.evidence(500000);
  expect(() => l.evidence(50000)).toThrow();
  expect(l.snapshot().nativeBytes).toBe(1000000);
});
it("negative evidence cost cannot refund budget", () => {
  const l = new _api.ReadBudgetLedger(_policy());
  l.evidence(10);
  expect(() => l.evidence(-1)).toThrow();
  expect(l.snapshot().nativeBytes).toBe(10);
});
it("cancellation before start makes zero clock calls", () => {
  const a = _artifact(),
    c = _context(a);
  let reads = 0;
  const now = c.clock.now.bind(c.clock);
  c.clock.now = () => {
    reads++;
    return now();
  };
  _bad(_api.composeReport(_input(a), { ...c, cancelled: true }));
  expect(reads).toBe(0);
});
it("throwing P6clock never triggers wallclock fallback", () => {
  const a = _artifact(),
    c = _context(a);
  c.clock.now = () => {
    throw Error("unavailable");
  };
  _bad(_api.composeReport(_input(a), c));
});
it("backward P6read rejects report and releases local token", () => {
  const a = _artifact(),
    c = _context(a);
  let reads = 0;
  c.clock.now = () => _mustParseUtc(++reads === 1 ? _now : _at);
  _bad(_api.composeReport(_input(a), c));
  c.clock.now = () => _mustParseUtc(_now);
  expect(_api.composeReport(_input(a), c).ok).toBe(true);
});
it("reentrant clock callback cannot admit another report", () => {
  const a = _artifact(),
    c = _context(a);
  let nested = false;
  c.clock.now = () => {
    if (!nested) {
      nested = true;
      _bad(_api.composeReport(_input(a), c));
    }
    return _mustParseUtc(_now);
  };
  expect(_api.composeReport(_input(a), c).ok).toBe(true);
});
it.each(_api.passiveCandidates)("route %s stays denied with no callable port", (candidate) =>
  _bad(_api.admitReadBinding({ candidate, enabled: true, certificate: "caller-signed" })),
);
it("async binding is denied without invoking a supplied callback", () => {
  let calls = 0;
  _bad(
    _api.admitReadBinding({
      call: () => {
        calls++;
        return Promise.resolve(1);
      },
    }),
  );
  expect(calls).toBe(0);
});
it("evidence pack beyond artifact count rejects before native reads", () => {
  const a = _artifact();
  _bad(
    _api.composeReport(
      { ..._input(a), evidence: Array.from({ length: 33 }, (_, i) => ({ ...a, id: "a" + i })) },
      _context(a),
    ),
  );
});
it("native byte ceiling applies before output composition", () => {
  const a = _artifact(25, { health: "HEALTHY", padding: "x".repeat(10000) });
  _bad(
    _api.composeReport(
      _input(a),
      _context(a),
      _ok(_api.createReportingPolicy({ maxNativeBytes: 1000 })),
    ),
  );
});
