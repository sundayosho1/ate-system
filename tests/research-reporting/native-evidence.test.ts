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

const malformed: readonly (readonly [string, unknown])[] = [
  ["null", null],
  ["number", 1],
  ["string", "x"],
  ["missing discriminator", {}],
  ["null discriminator", { ok: null }],
  ["numeric discriminator", { ok: 0 }],
  ["string discriminator", { ok: "false" }],
  ["true without selected value", { ok: true, error: { code: "X", commitment: "NONE" } }],
  ["missing error", { ok: false }],
  ["null error", { ok: false, error: null }],
  ["nonstring code", { ok: false, error: { code: 2, commitment: "NONE" } }],
  ["blank code", { ok: false, error: { code: "", commitment: "NONE" } }],
  ["missing commitment", { ok: false, error: { code: "RECORD_NOT_FOUND" } }],
  ["invalid commitment", { ok: false, error: { code: "RECORD_NOT_FOUND", commitment: "ACK" } }],
  ["numeric commitment", { ok: false, error: { code: "RECORD_NOT_FOUND", commitment: 0 } }],
  ["promise", Promise.resolve({ ok: true, value: 1 })],
];
it.each(malformed)("native commitment rejects %s", (_name, v) =>
  _bad(_api.captureNativeEvidence(v, "COMMITMENT")),
);
it.each(["NONE", "UNKNOWN"] as const)("preserves native %s without normalization", (commitment) => {
  const c = _ok(
    _api.captureNativeEvidence(
      { ok: false, error: { code: "RECORD_NOT_FOUND", commitment } },
      "COMMITMENT",
    ),
  );
  expect(c.commitment).toEqual(_fact(commitment, "native-selected-fields"));
  expect(c.selected).toBe("FAILURE");
});
it.each(["COMMITMENT", "DOMAIN", "MOSE"] as const)(
  "preserves %s positive selectedvalue",
  (family) => {
    expect(_ok(_api.captureNativeEvidence({ ok: true, value: { x: 1 } }, family)).value).toEqual({
      x: 1,
    });
  },
);
it("DOMAIN issues never fabricate error.code or commitment", () => {
  const c = _ok(
    _api.captureNativeEvidence(
      { ok: false, issues: [{ code: "D", message: "detail", severity: "ERROR" }] },
      "DOMAIN",
    ),
  );
  expect(c.code.kind).toBe("UNKNOWN");
  expect(c.commitment.kind).toBe("UNKNOWN");
  expect(c.value).toEqual([{ code: "D", message: "detail", severity: "ERROR" }]);
});
it("empty DomainResult issues remain a native failure", () =>
  expect(_ok(_api.captureNativeEvidence({ ok: false, issues: [] }, "DOMAIN")).selected).toBe(
    "FAILURE",
  ));
it("MOSE requires audit correlation", () =>
  _bad(
    _api.captureNativeEvidence({ ok: false, error: { code: "X", commitment: "UNKNOWN" } }, "MOSE"),
  ));
it("MOSE preserves real audit correlation", () => {
  const c = _ok(
    _api.captureNativeEvidence(
      { ok: false, error: { code: "X", commitment: "UNKNOWN", auditCorrelationId: "audit" } },
      "MOSE",
    ),
  );
  expect(c.auditCorrelation).toEqual(_fact("audit", "native-selected-fields"));
});
it.each(["array", "inherited", "null-prototype"])("accepts native %s structural Result", (kind) => {
  const r: unknown =
    kind === "array"
      ? Object.assign([], { ok: false, error: { code: "X", commitment: "NONE" } })
      : kind === "inherited"
        ? (Object.create({ ok: false, error: { code: "X", commitment: "NONE" } }) as unknown)
        : Object.assign(Object.create(null) as object, {
            ok: false,
            error: { code: "X", commitment: "NONE" },
          });
  expect(_api.captureNativeEvidence(r, "COMMITMENT").ok).toBe(true);
});
it("discriminator and selected fields captured once", () => {
  let reads = 0;
  const r = {
    get ok() {
      reads++;
      return reads === 1 ? false : true;
    },
    error: { code: "X", commitment: "UNKNOWN" },
  };
  expect(_ok(_api.captureNativeEvidence(r, "COMMITMENT")).selected).toBe("FAILURE");
  expect(reads).toBe(1);
});
it("throwing discriminator is structured rejection", () =>
  _bad(
    _api.captureNativeEvidence(
      {
        get ok() {
          throw Error("hostile");
        },
      },
      "COMMITMENT",
    ),
  ));
it("throwing selected error is structured rejection", () =>
  _bad(
    _api.captureNativeEvidence(
      {
        ok: false,
        get error() {
          throw Error("hostile");
        },
      },
      "COMMITMENT",
    ),
  ));
it("success ignores unrelated failure metadata", () =>
  expect(
    _ok(_api.captureNativeEvidence({ ok: true, value: 1, error: { code: "unused" } }, "COMMITMENT"))
      .value,
  ).toBe(1));
it("failure ignores unrelated populated value", () =>
  expect(
    _ok(
      _api.captureNativeEvidence(
        { ok: false, value: 2, error: { code: "X", commitment: "NONE" } },
        "COMMITMENT",
      ),
    ).selected,
  ).toBe("FAILURE"));
it("native nested accessors are never silently executed", () =>
  _bad(
    _api.captureNativeEvidence(
      {
        ok: true,
        value: {
          get health() {
            throw Error("hostile");
          },
        },
      },
      "COMMITMENT",
    ),
  ));
it("direct undefined is not a negative or null evidence claim", () => {
  const c = _ok(_api.captureNativeEvidence(undefined, "DIRECT"));
  expect(c.valuePresence).toBe("UNDEFINED");
  expect(c.commitment.kind).toBe("UNKNOWN");
});
it("direct null has distinct presence", () =>
  expect(_ok(_api.captureNativeEvidence(null, "DIRECT")).valuePresence).toBe("PRESENT"));
it("void success is preserved separately", () =>
  expect(
    _ok(_api.captureNativeEvidence({ ok: true, value: undefined }, "DOMAIN")).valuePresence,
  ).toBe("UNDEFINED"));
it("capture detaches and freezes values", () => {
  const v = { nested: { x: 1 } },
    c = _ok(_api.captureNativeEvidence(v, "DIRECT"));
  v.nested.x = 2;
  expect(c.value).toEqual({ nested: { x: 1 } });
  expect(Object.isFrozen(c.value)).toBe(true);
});
it.each([NaN, Infinity, -Infinity, 1n, Symbol("x")])(
  "rejects unsupported native primitive %s",
  (v) => _bad(_api.captureNativeEvidence(v, "DIRECT")),
);
it("cyclic native DTO is rejected", () => {
  const v: { x?: unknown } = {};
  v.x = v;
  _bad(_api.captureNativeEvidence(v, "DIRECT"));
});
it("extra optional native metadata is not an invented contract violation", () =>
  expect(
    _api.captureNativeEvidence(
      { ok: false, error: { code: "X", commitment: "NONE", metadata: { a: 1 } }, trace: "extra" },
      "COMMITMENT",
    ).ok,
  ).toBe(true));
