import type { Fact as _Fact } from "@ate/research-insight-contracts";
import { it, expect } from "vitest";
import * as _R from "@ate/research-reporting";
import type {
  ReportBundle as _Bundle,
  ReportingPolicy as _Policy,
  ReportingResult as _Result,
} from "@ate/research-reporting";
import { VirtualClock as _Clock, mustParseUtc as _utc } from "@ate/time";
import { createHash as _createHash } from "node:crypto";
import { readFileSync as _read, existsSync as _exists } from "node:fs";
import { resolve as _resolve, dirname as _dirname } from "node:path";
const _base = "2cb81c1d33462f20ce15a4616eb971296d2d44ee",
  _at = "2026-10-17T10:00:00.000Z",
  _now = "2026-10-18T10:00:00.000Z";
const _unknown = () => ({ kind: "UNKNOWN" as const, reasonIds: ["TEST:UNKNOWN"] });
const _known = (value: string): _Fact => ({
  kind: "KNOWN" as const,
  value,
  evidenceIds: ["source-certificate"],
});
function _ok<T>(x: _Result<T>): T {
  expect(x.ok).toBe(true);
  if (!x.ok) throw Error(JSON.stringify(x));
  return x.value;
}
const _bad = (x: { readonly ok: boolean }) => expect(x.ok).toBe(false);
function _a(
  value: unknown = { health: "HEALTHY", readiness: "READY", quality: 3, pending: 1 },
  id = "a",
) {
  return {
    id,
    prompt: 25,
    owner: "mose-core",
    ownerVersion: "synthetic-remediation.1",
    sourceCommit: _base,
    nativeIdentity: "native-generation-7",
    nativeFingerprint: _known("sha256:" + "a".repeat(64)),
    subject: ["research", "EURUSD"],
    unit: "STATUS",
    effectiveAt: _at,
    availableAt: _at,
    captured: _ok(_R.captureNativeEvidence(value, "DIRECT")),
  };
}
type _Artifact = ReturnType<typeof _a>;
function _request(a: _Artifact, axis = "HEALTH", field = "health") {
  return {
    schema: "ate.reporting.request/1",
    id: "remediation",
    baseline: _base,
    purpose: "OFFLINE_RESEARCH",
    mode: "HISTORICAL",
    asOf: _at,
    knowledgeCutoff: _at,
    facets: [
      {
        id: "f-" + a.id,
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
function _ctx(as: readonly _Artifact[]) {
  return {
    clock: new _Clock(_utc(_now), "REPLAY"),
    anchors: as.map((a) => ({
      artifactId: a.id,
      captureDigest: _R.captureDigest(a),
      sourceCommit: a.sourceCommit,
      owner: a.owner,
      reference: "synthetic-anchor-" + a.id,
    })),
  };
}
function _input(as: readonly _Artifact[], axis = "HEALTH", field = "health") {
  const q = _request(as[0]!, axis, field);
  q.facets = as.map((a) => _request(a, axis, field).facets[0]!);
  return { request: q, evidence: as, charts: [], improvements: [] };
}
const _p = (limits: Partial<Record<keyof typeof _R.D1, number>> = {}) =>
  _ok(_R.createReportingPolicy(limits));
const _compose = (
  as: readonly _Artifact[] = [_a()],
  p?: _Policy,
  axis = "HEALTH",
  field = "health",
) => _R.composeReport(_input(as, axis, field), _ctx(as), p);
const _copy = <T>(v: T): T => structuredClone(v);
const _query = { offset: 0, limit: 50, owner: null };
/** Independent plain-fixture graph oracle: no production validation/budget helper. */
function _measure(v: unknown, depth = 0): { nodes: number; depth: number } {
  if (v === null || typeof v !== "object") return { nodes: 1, depth };
  const children = Object.values(v).map((x: unknown) => _measure(x, depth + 1));
  return {
    nodes: 1 + children.reduce((n, x) => n + x.nodes, 0),
    depth: Math.max(depth, ...children.map((x) => x.depth)),
  };
}
function _canonical(v: unknown): unknown {
  if (v === null || typeof v !== "object") return Object.is(v, -0) ? 0 : v;
  if (Array.isArray(v)) return v.map((x: unknown) => _canonical(x));
  return Object.fromEntries(
    Object.keys(v)
      .sort()
      .map((k) => [k, _canonical(Reflect.get(v, k))]),
  );
}
function _hash(v: unknown) {
  return (
    "sha256:" +
    _createHash("sha256")
      .update(
        JSON.stringify(
          _canonical({
            contractVersion: "ate.reporting/1",
            sourceCommit: _base,
            projectionVersion: "0.1.0-reporting-projection.1",
          }),
        ),
      )
      .update("\n")
      .update(JSON.stringify(_canonical(v)))
      .digest("hex")
  );
}
function _rehash(b: _Bundle): _Bundle {
  const { manifest, ...body } = b;
  const fingerprint = _hash({ body, generatedAt: manifest.generatedAt });
  return { ...b, manifest: { ...manifest, id: fingerprint, reportFingerprint: fingerprint } };
}
/** Independent full pin oracle. Payload equality is canonical, not supplied record-id equality. */
function _conflict(a: _Artifact, b: _Artifact): boolean {
  const scope = (x: _Artifact) =>
    JSON.stringify([
      x.owner,
      x.ownerVersion,
      x.sourceCommit,
      x.nativeIdentity,
      x.subject,
      x.unit,
      x.effectiveAt,
      x.availableAt,
    ]);
  if (scope(a) !== scope(b)) return false;
  const fp = (x: _Artifact) =>
    x.nativeFingerprint.kind === "KNOWN" ? x.nativeFingerprint.value : null;
  return (
    (fp(a) === fp(b) || fp(a) === null || fp(b) === null) &&
    JSON.stringify(_canonical(a.captured)) !== JSON.stringify(_canonical(b.captured))
  );
}
/** Independent list of reporting-owned traversals and pure-serializer preflight arguments. No internal counters. */
function _cost(
  input: ReturnType<typeof _input>,
  anchors: ReturnType<typeof _ctx>["anchors"],
  b: _Bundle,
) {
  let nodes = 0,
    depth = 0;
  const add = (v: unknown, offset = 0) => {
    const m = _measure(v);
    nodes += m.nodes;
    depth = Math.max(depth, m.depth + offset);
  };
  add(input);
  add(input.request, 1);
  add(anchors);
  for (const a of input.evidence) {
    add(a, 2);
    add(a, 2);
    for (const anchor of anchors) add(anchor);
  }
  for (const a of input.evidence) add(a.captured, 3);
  add(input.charts);
  for (const a of input.evidence) {
    add(a, 2);
    add(a, 2);
  }
  for (const a of input.evidence) add(a.captured, 3);
  add(input.improvements, 1);
  const { manifest, ...body } = b;
  add({ body, generatedAt: manifest.generatedAt });
  add(input.request, 1);
  add(b);
  return { nodes, depth };
}
function _legacyLow(key: "maxNodes" | "maxDepth") {
  const b = _ok(_compose());
  return _rehash({ ...b, policy: { ...b.policy, [key]: 1 } });
}
function _legacyConflict() {
  const a = _a(undefined, "a"),
    b = _a(undefined, "b");
  const original = _ok(_compose([a, b]));
  const altered = {
    ...b,
    captured: _ok(_R.captureNativeEvidence({ health: "UNHEALTHY" }, "DIRECT")),
  };
  const observations = original.observations.map((o) =>
    o.artifact.id === "b" ? { ...o, artifact: altered, captureDigest: _hash(altered) } : o,
  );
  const budget = {
    ...original.budget,
    nativeBytes: Buffer.byteLength(JSON.stringify(observations.map((o) => o.artifact))),
  };
  const facets = original.facets.map((f) =>
    f.facet.observationId === "b"
      ? {
          ...f,
          facet: {
            ...f.facet,
            nativeStatus: { kind: "KNOWN" as const, value: "UNHEALTHY", evidenceIds: ["b"] },
          },
        }
      : f,
  );
  const consistency = {
    ...original.consistency,
    identityVector: observations.map((o) => ({
      owner: o.artifact.owner,
      identity: o.artifact.nativeIdentity,
      captureDigest: o.captureDigest,
    })),
  };
  return _rehash({
    ...original,
    observations,
    facets,
    consistency,
    budget,
    manifest: {
      ...original.manifest,
      budgetUsage: budget,
      exactEvidenceVector: observations.map((o) => ({
        id: o.artifact.id,
        digest: o.captureDigest,
        origin: o.provenance,
      })),
    },
  });
}

it("readback: omitted optional query parameter remains compatible", () => {
  const b = _ok(_compose());
  expect(_R.queryReport(b, _query).ok).toBe(true);
});
for (const key of ["maxDepth", "maxNodes"] as const)
  it(`readback: stricter query ${key}`, () =>
    _bad(_R.queryReport(_ok(_compose()), _query, _p({ [key]: 1 }))));
for (const key of ["maxDepth", "maxNodes"] as const)
  it(`readback: legacy embedded ${key} cannot be weakened by override`, () => {
    const b = _legacyLow(key);
    expect(
      _hash((({ manifest, ...body }) => ({ body, generatedAt: manifest.generatedAt }))(b)),
    ).toBe(b.manifest.reportFingerprint);
    _bad(_R.queryReport(b, _query, _p()));
    _bad(_R.queryReport(b, _query));
  });
for (const key of ["maxDepth", "maxNodes"] as const)
  it(`readback: export enforces embedded and explicit ${key}`, () => {
    _bad(_R.serializeReportExport(_legacyLow(key), _p()));
    _bad(_R.serializeReportExport(_ok(_compose()), _p({ [key]: 1 })));
  });
it("readback: malformed numeric policy fails closed", () => {
  const p = { ..._p(), maxNodes: 0 };
  _bad(_R.queryReport(_ok(_compose()), _query, p));
});
it("readback: contradictory authority policy rejected", () => {
  const b = _ok(_compose()),
    p = { ..._p(), ownerReads: true };
  const result: unknown = Reflect.apply(_R.queryReport, undefined, [b, _query, p]);
  expect(result).toMatchObject({ ok: false });
});
it("readback: legacy conflicting but correctly rehashed report rejected by query", () => {
  const b = _legacyConflict();
  _bad(_R.queryReport(b, _query));
});
it("readback: legacy conflicting but correctly rehashed report rejected by export", () =>
  _bad(_R.serializeReportExport(_legacyConflict())));
it("readback: valid stricter report stays valid with weaker requested policy", () => {
  const b = _ok(_compose([_a()], _p({ maxDepth: 16, maxNodes: 40000 })));
  const q = _ok(_R.queryReport(b, _query, _p()));
  expect(q.currentAuthority.kind).toBe("UNKNOWN");
  expect(_R.serializeReportExport(b, _p()).ok).toBe(true);
});

it("readback: historical clock use is not charged as a new query call", () => {
  const b = _ok(_compose());
  expect(_R.queryReport(b, _query, _p({ maxCalls: 1, maxClockReads: 1 })).ok).toBe(true);
});
it("readback: conflict rejection is semantic rather than incidental hash failure", () => {
  const b = _legacyConflict();
  const { manifest, ...body } = b;
  expect(_hash({ body, generatedAt: manifest.generatedAt })).toBe(manifest.reportFingerprint);
  expect(_R.queryReport(b, _query)).toMatchObject({
    ok: false,
    issues: [{ code: "REPORTING:EVIDENCE_IDENTITY_CONFLICT" }],
  });
});
