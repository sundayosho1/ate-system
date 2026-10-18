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

for (const [axis, field, first, second] of [
  ["HEALTH", "health", "HEALTHY", "UNHEALTHY"],
  ["READINESS", "readiness", "READY", "NOT_READY"],
  ["QUALITY", "quality", 1, 2],
  ["OBLIGATION", "pending", 0, 1],
] as const)
  for (const known of [true, false])
    it(`immutable: ${axis} conflict known${known}`, () => {
      const a = _a({ [field]: first }, "a"),
        b = _a({ [field]: second }, "b");
      if (!known) {
        const x = { ...a, nativeFingerprint: _unknown() },
          y = { ...b, nativeFingerprint: _unknown() };
        expect(_compose([x, y], undefined, axis, field).ok).toBe(false);
      } else {
        expect(_conflict(a, b)).toBe(true);
        _bad(_compose([a, b], undefined, axis, field));
      }
    });
it("immutable: same pin identical payload retained as2records", () => {
  const a = _a(undefined, "a"),
    b = _a(undefined, "b");
  expect(_conflict(a, b)).toBe(false);
  expect(_ok(_compose([a, b])).observations).toHaveLength(2);
});
for (const field of [
  "ownerVersion",
  "sourceCommit",
  "nativeIdentity",
  "subject",
  "unit",
  "effectiveAt",
  "availableAt",
  "nativeFingerprint",
] as const)
  it(`immutable: distinct legitimate scope ${field} is not merged`, () => {
    const a = _a({ health: "HEALTHY" }, "a"),
      b = _a({ health: "UNHEALTHY" }, "b");
    if (field === "subject") b.subject = ["different", "instrument"];
    else if (field === "nativeFingerprint")
      b.nativeFingerprint = _known("sha256:" + "b".repeat(64));
    else if (field === "sourceCommit") b.sourceCommit = "b".repeat(40);
    else if (field === "effectiveAt" || field === "availableAt")
      b[field] = "2026-10-16T00:00:00.000Z";
    else b[field] = "different-" + field;
    expect(_conflict(a, b)).toBe(false);
    const result = _ok(_compose([a, b]));
    expect(result.observations).toHaveLength(2);
    expect(result.currentAuthority.kind).toBe("UNKNOWN");
  });
it("immutable: different owner/prompt is distinct evidence", () => {
  const a = _a({ health: "HEALTHY" }, "a"),
    b = { ..._a({ health: "UNHEALTHY" }, "b"), prompt: 27, owner: "mose-attention" };
  expect(_conflict(a, b)).toBe(false);
  expect(_compose([a, b]).ok).toBe(true);
});
it("immutable: correction stays separate with genuine changed generation and availability", () => {
  const a = _a({ health: "HEALTHY" }, "a"),
    b = _a({ health: "DEGRADED", correctionOf: "earlier" }, "b");
  b.nativeIdentity = "corrected-generation";
  b.nativeFingerprint = _known("sha256:" + "b".repeat(64));
  b.availableAt = "2026-10-17T10:00:00.001Z";
  const result = _ok(_compose([a, b]));
  expect(result.facets.find((f) => f.facet.observationId === "b")?.status).toBe("UNAVAILABLE");
});
it("immutable: input order cannot hide a conflict", () => {
  const a = _a({ health: "HEALTHY" }, "a"),
    b = _a({ health: "UNHEALTHY" }, "b");
  _bad(_compose([a, b]));
  _bad(_compose([b, a]));
});
it("immutable: canonical key order is not a false conflict", () => {
  const a = _a({ health: "HEALTHY", pending: 1 }, "a"),
    b = _a({ pending: 1, health: "HEALTHY" }, "b");
  expect(_conflict(a, b)).toBe(false);
  expect(_compose([a, b]).ok).toBe(true);
});
it("immutable: known vs unknown fingerprint cannot prove conflicting generations", () => {
  const a = _a({ health: "HEALTHY" }, "a"),
    b = { ..._a({ health: "UNHEALTHY" }, "b"), nativeFingerprint: _unknown() };
  _bad(_compose([a, b]));
});

it("immutable: direct chart readback rejects conflicting sources", () => {
  const a = _a(undefined, "a"),
    b = _a(undefined, "b"),
    valid = _ok(_compose([a, b])),
    bad = { ...b, captured: _ok(_R.captureNativeEvidence({ health: "UNHEALTHY" }, "DIRECT")) };
  const observations = valid.observations.map((o) =>
    o.artifact.id === "b" ? { ...o, artifact: bad, captureDigest: _hash(bad) } : o,
  );
  _bad(_R.buildChartMetadata([], observations, _p()));
});
it("immutable: missing native fingerprint is not accepted evidence", () => {
  const a = _a(),
    raw = { ..._input([a]), evidence: [{ ...a, nativeFingerprint: null }] };
  _bad(_R.composeReport(raw, { clock: new _Clock(_utc(_now), "REPLAY"), anchors: [] }));
});
it("immutable: unknown identical repetition does not invent a conflict", () => {
  const a = { ..._a(undefined, "a"), nativeFingerprint: _unknown() },
    b = { ..._a(undefined, "b"), nativeFingerprint: _unknown() };
  expect(_compose([a, b]).ok).toBe(true);
});
