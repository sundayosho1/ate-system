import type { Fact as _Fact } from "@ate/research-insight-contracts";
import { it, expect } from "vitest";
import * as _R from "@ate/research-reporting";
import type { ReportBundle as _Bundle, ReportingResult as _Result } from "@ate/research-reporting";
import { VirtualClock as _Clock, mustParseUtc as _utc } from "@ate/time";
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
/** Independent list of reporting-owned traversals and pure-serializer preflight arguments. No internal counters. */
function _cost(
  input: Omit<ReturnType<typeof _input>, "improvements"> & { improvements: readonly unknown[] },
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
  add(input.improvements, 1); // actual internal improvement descriptor validation
  const { manifest, ...body } = b;
  add({ body, generatedAt: manifest.generatedAt });
  add(input.request, 1);
  add(b);
  return { nodes, depth };
}
function _proposal(id: string, revision = 1) {
  return {
    schema: "ate.insights.improvement/1",
    id,
    revision,
    evidenceIds: ["a"],
    affectedOwners: ["research-reporting"],
    findingRefs: ["D-C-M01"],
    hypothesis: "Shared descriptor budgets include repeated helper validation",
    boundedChange: "Only cumulative resource accounting",
    qualificationImpact: "All qualifications remain binding",
    suggestedTests: ["exact-operation-cost"],
    workflowStatus: "DRAFT",
    decisionRef: _unknown(),
    supersedes: _unknown(),
  };
}
const _sets = [
  [],
  [_proposal("one")],
  [_proposal("history", 1), _proposal("history", 2)],
  [_proposal("one"), _proposal("two"), _proposal("three")],
];
function _operation(items: readonly unknown[]) {
  const as = [_a()];
  return { as, input: { ..._input(as), improvements: items }, ctx: _ctx(as) };
}
/** Independent public DTO ledger. No production internal budget or reconstruction helper. */
function _readCost(b: _Bundle, operation: "QUERY" | "EXPORT") {
  let nodes = 0;
  const add = (v: unknown) => {
    nodes += _measure(v).nodes;
  };
  const { manifest, ...body } = b;
  add(b);
  add({ body, generatedAt: manifest.generatedAt });
  add(b.request);
  add(b.request);
  add(manifest.qualifications);
  add(manifest.qualifications);
  for (const o of b.observations) {
    add(o.artifact);
    add(o.artifact);
  }
  const ids = b.observations.map((o) => o.artifact.id);
  add(ids);
  add([...ids].sort());
  for (const o of b.observations) add(o.artifact.captured);
  add(b.facets);
  add(b.facets);
  add(manifest.missingFacets);
  add(manifest.missingFacets);
  add(manifest.requestedFacets);
  add(b.request.facets.map((f) => f.id));
  add(manifest.sourceObservationIds);
  add(ids);
  add(manifest.exactEvidenceVector);
  add(manifest.exactEvidenceVector);
  add(b.consistency);
  add(b.consistency);
  add(manifest.budgetUsage);
  add(b.budget);
  add(b.charts);
  for (const o of b.observations) {
    add(o.artifact);
    add(o.artifact);
  }
  for (const o of b.observations) add(o.artifact.captured);
  add(b.improvements);
  add(b.improvements); // preflight plus actual nested helper copy
  if (operation === "QUERY") add(_query);
  else {
    const projection = {
      schema: "ate.reporting.export/1",
      originalReportFingerprint: manifest.reportFingerprint,
      redactionPolicy: "SAFE_METADATA_ONLY_V1",
      sourceBaseline: b.request.baseline,
      generatedAt: manifest.generatedAt,
      counts: {
        facets: b.facets.length,
        observations: b.observations.length,
        charts: b.charts.length,
        improvements: b.improvements.length,
      },
      facetStates: b.facets.map((f) => ({
        axis: f.facet.axis,
        status: f.status,
        temporalScope: f.facet.temporalScope,
      })),
      omissions: [
        "RAW_NATIVE_VALUES",
        "SUBJECTS",
        "LABELS",
        "REASONS",
        "LOCATORS",
        "PROPOSAL_TEXT",
      ],
      currentAuthority: _unknown(),
    };
    add(projection);
    add({
      ...projection,
      projectionFingerprint: "fixed scalar hash placeholder; counted as one node",
    });
  }
  return nodes;
}
for (let n = 0; n < _sets.length; n++)
  for (const delta of [-1, 0, 1])
    it(`compose actual improvement validation shape${n} boundary${delta}`, () => {
      const { as, input, ctx } = _operation(_sets[n]!),
        b = _ok(_R.composeReport(input, ctx)),
        cost = _cost(input, ctx.anchors, b),
        p = _p({ maxNodes: cost.nodes + delta }),
        actual = _R.composeReport(input, _ctx(as), p);
      expect(actual.ok).toBe(delta >= 0);
      if (!actual.ok) expect(actual.issues[0]?.code).toBe("REPORTING:BUDGET_EXHAUSTED");
    });
for (let n = 0; n < 3; n++)
  for (const operation of ["QUERY", "EXPORT"] as const)
    for (const delta of [-1, 0, 1])
      it(`${operation} actual reconstructed helper shape${n} boundary${delta}`, () => {
        const { input, ctx } = _operation(_sets[n]!),
          b = _ok(_R.composeReport(input, ctx)),
          required = _readCost(b, operation),
          p = _p({ maxNodes: required + delta }),
          actual =
            operation === "QUERY" ? _R.queryReport(b, _query, p) : _R.serializeReportExport(b, p);
        expect(actual.ok).toBe(delta >= 0);
        if (!actual.ok) expect(actual.issues[0]?.code).toBe("REPORTING:BUDGET_EXHAUSTED");
      });
it("standalone empty improvement input preserves public bounded contract", () => {
  const x = _ok(_R.projectImprovementRegister([], []));
  expect(x.records).toEqual([]);
  expect(x.mutationAuthority).toBe(false);
});
it("standalone one proposal remains source-declared only", () => {
  const x = _ok(_R.projectImprovementRegister(_sets[1], ["a"]));
  expect(x.records).toHaveLength(1);
  expect(x.decisionAuthority).toBe("NOT_ESTABLISHED_SUPPLIED_RECORDS_ONLY");
});
it("standalone immutable revisions retain both records", () =>
  expect(
    _ok(_R.projectImprovementRegister(_sets[2], ["a"])).records.map((x) => x.revision),
  ).toEqual([1, 2]));
it("standalone missing evidence still rejects", () =>
  _bad(_R.projectImprovementRegister(_sets[1], [])));
it("standalone duplicate revision still rejects", () =>
  _bad(_R.projectImprovementRegister([_proposal("x"), _proposal("x")], ["a"])));
it("standalone hostile descriptor is not invoked", () => {
  let invoked = 0;
  const raw = {
    get id() {
      invoked++;
      return "x";
    },
  };
  _bad(_R.projectImprovementRegister([raw], ["a"]));
  expect(invoked).toBe(0);
});
it("conflicting immutable evidence cannot hide behind improvement validation", () => {
  const a = _a({ health: "HEALTHY" }, "a"),
    b = _a({ health: "UNHEALTHY" }, "b");
  const input = { ..._input([a, b]), improvements: [_proposal("one")] };
  _bad(_R.composeReport(input, _ctx([a, b])));
});
it("unknown-generation contradiction remains rejected", () => {
  const a = _a({ health: "HEALTHY" }, "a"),
    b = _a({ health: "DEGRADED" }, "b");
  b.nativeFingerprint = _unknown();
  _bad(_R.composeReport({ ..._input([a, b]), improvements: _sets[1] }, _ctx([a, b])));
});
it("genuine corrected generation remains distinct and non-authoritative", () => {
  const a = _a({ health: "HEALTHY", correctionOf: null }, "a"),
    b = _a({ health: "DEGRADED", correctionOf: "a" }, "b");
  b.nativeFingerprint = _known("sha256:" + "c".repeat(64));
  const result = _ok(_R.composeReport({ ..._input([a, b]), improvements: _sets[1] }, _ctx([a, b])));
  expect(result.observations).toHaveLength(2);
  expect(result.currentAuthority.kind).toBe("UNKNOWN");
});
it("cancelled composition cannot return COMPLETE with valid proposals", () => {
  const { input, ctx } = _operation(_sets[1]!);
  _bad(_R.composeReport(input, { ...ctx, cancelled: true }));
});
it("exhausted helper operation permits fresh exact-budget retry", () => {
  const { input, ctx } = _operation(_sets[2]!),
    baseline = _ok(_R.composeReport(input, ctx)),
    required = _cost(input, ctx.anchors, baseline).nodes;
  _bad(_R.composeReport(input, ctx, _p({ maxNodes: required - 1 })));
  expect(_ok(_R.composeReport(input, ctx, _p({ maxNodes: required }))).status).toBe("COMPLETE");
});
it("weaker override cannot wash an embedded readback limit", () => {
  const { as, input, ctx } = _operation(_sets[1]!),
    baseline = _ok(_R.composeReport(input, ctx)),
    required = _readCost(baseline, "QUERY"),
    restricted = _ok(_R.composeReport(input, _ctx(as), _p({ maxNodes: required - 1 })));
  _bad(_R.queryReport(restricted, _query, _p()));
});
it("malformed cumulative policy rejects before improvement work", () => {
  const { input, ctx } = _operation(_sets[1]!);
  _bad(_R.composeReport(input, ctx, { ..._p(), maxNodes: 0 }));
});
it("repeated operations do not inflate an immutable per-operation ceiling", () => {
  const { as, input, ctx } = _operation(_sets[3]!),
    baseline = _ok(_R.composeReport(input, ctx)),
    required = _cost(input, ctx.anchors, baseline).nodes,
    p = _p({ maxNodes: required - 1 });
  for (let attempt = 0; attempt < 3; attempt++) _bad(_R.composeReport(input, _ctx(as), p));
  expect(p.maxNodes).toBe(required - 1);
});
it("internal budgeted improvement entrypoint is not a root public export", () =>
  expect(Object.hasOwn(_R, "projectImprovementRegisterWithinBudget")).toBe(false));
