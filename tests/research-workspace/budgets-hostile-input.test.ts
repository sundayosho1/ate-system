import { it, expect } from "vitest";
import * as api from "@ate/research-workspace";
import { VirtualClock, mustParseUtc } from "@ate/time";
import { createHash } from "node:crypto";
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, canonical(x)]),
    );
  return v;
}
const hash = (v: unknown) =>
  "sha256:" +
  createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
const at = "2026-10-19T10:00:00.000Z";
function fixture() {
  const sourceManifest = { baseline: api.baselines.knowledge, sources: {} };
  const binding: { path: string; commit: string; sha256: string } = {
    path: "README.md",
    commit: api.baselines.governance,
    sha256: "sha256:" + "a".repeat(64),
  };
  const overlay = {
    schema: "ate.workspace.release/1",
    id: "release",
    revision: 1,
    knowledgeSourceCommit: api.baselines.knowledge,
    knowledgeManifestFingerprint: hash(sourceManifest),
    reportingValidationBaseline: api.baselines.reporting,
    acceptedGovernanceCommit: api.baselines.governance,
    acceptedRecordRefs: [
      { ...binding, path: "docs/development/p1-p27-reporting-conditional-acceptance.md" },
    ],
    scope: "OFFLINE_RESEARCH_ONLY",
    qualifications: ["F05"],
    sourceBindings: [binding],
    observedAt: at,
    authority: "NON_AUTHORITATIVE_RELEASE_METADATA",
    currentHealth: "UNESTABLISHED",
    currentReadiness: "UNESTABLISHED",
  };
  const context = {
    releaseAuthentication: {
      authenticatedCommit: api.baselines.governance,
      verifiedBindings: [binding, ...overlay.acceptedRecordRefs],
      qualificationRegisterFingerprint: "sha256:" + "b".repeat(64),
      clock: "EXTERNAL_P6_CONTEXT",
    },
    clock: new VirtualClock(mustParseUtc(at), "REPLAY"),
    cancelled: false,
  };
  const input = {
    schema: "ate.workspace.compose/1",
    id: "workspace",
    overlay,
    knowledge: {
      catalogue: { baseline: api.baselines.knowledge, entries: [] },
      sourceManifest,
      qualificationIds: ["F05"],
    },
    report: null,
    links: [],
    improvementRecords: [],
    handoverRequest: {},
  };
  return { input, context };
}
function success<T>(r: api.WorkspaceResult<T>): T {
  expect(r.ok).toBe(true);
  if (!r.ok) throw Error(JSON.stringify(r.issues));
  return r.value;
}
const view = () => {
  const f = fixture();
  return success(api.composeWorkspace(f.input, f.context));
};

it("stricter node budget fails closed without clock reset", () => {
  const f = fixture(),
    p = success(api.createWorkspacePolicy({ maxNodes: 1 }));
  expect(api.composeWorkspace(f.input, f.context, p).ok).toBe(false);
  expect(view().currentAuthority).toBe("UNKNOWN");
});
for (const raw of [null, undefined, 0, true, "workspace", [], () => 0, Symbol("bad"), 1n])
  it(`hostile input ${String(raw)} safely rejects`, () => {
    const f = fixture();
    expect(api.composeWorkspace(raw, f.context).ok).toBe(false);
  });
it("accessor is rejected without invoking getter", () => {
  const f = fixture();
  let calls = 0;
  const input = Object.defineProperty({}, "schema", {
    enumerable: true,
    get() {
      calls++;
      throw Error("hostile");
    },
  });
  expect(api.composeWorkspace(input, f.context).ok).toBe(false);
  expect(calls).toBe(0);
});
it("cycle rejects structurally", () => {
  const f = fixture(),
    x: Record<string, unknown> = {};
  x.x = x;
  expect(api.composeWorkspace(x, f.context).ok).toBe(false);
});
it("cancelled operation does not read clock", () => {
  const f = fixture();
  let calls = 0;
  const r = api.composeWorkspace(f.input, {
    ...f.context,
    cancelled: true,
    clock: {
      ...f.context.clock,
      now() {
        calls++;
        return mustParseUtc(at);
      },
    },
  });
  expect(r.ok).toBe(false);
  expect(calls).toBe(0);
});
for (const offset of [-1, 0.5, NaN, Infinity])
  it(`invalid query offset ${String(offset)} rejects`, () =>
    expect(api.queryWorkspace(view(), { schema: "ate.workspace.query/1", offset }).ok).toBe(false));
for (const limit of [0, -1, 0.5, 51])
  it(`invalid query limit ${limit} rejects`, () =>
    expect(
      api.queryWorkspace(view(), { schema: "ate.workspace.query/1", offset: 0, limit }).ok,
    ).toBe(false));

// Own-package meter controls; no private upstream imports or counters are replaced.
import { Budget } from "../../packages/research-workspace/src/budgets.js";
it("independent exact-node oracle rejects one beyond without resetting", () => {
  const b = new Budget({ ...api.W1, maxNodes: 10 });
  for (let i = 0; i < 10; i++) b.visit(0);
  expect(b.usage().nodes).toBe(10);
  expect(() => b.visit(0)).toThrow("WORKSPACE:BUDGET_EXHAUSTED");
  expect(b.usage().nodes).toBe(10);
});
it("independent byte oracle conserves prior consumption", () => {
  const b = new Budget({ ...api.W1, maxInputBytes: 8 });
  b.bytes(3);
  b.bytes(5);
  expect(b.usage().bytes).toBe(8);
  expect(() => b.bytes(1)).toThrow();
  expect(b.usage().bytes).toBe(8);
});
it("depth one beyond denies before a new visit is admitted", () => {
  const b = new Budget(api.W1);
  b.visit(16);
  expect(() => b.visit(17)).toThrow();
  expect(b.usage().nodes).toBe(1);
});
it("repeated reservation cannot manufacture node credits", () => {
  const b = new Budget(api.W1);
  b.reserve([1, 2], 4);
  b.reserve([1, 2], 4);
  expect(b.usage().nodes).toBe(24);
  expect(b.usage().calls).toBe(2);
});
it("public call reservations have an exact immutable ceiling", () => {
  const b = new Budget({ ...api.W1, maxCalls: 2 });
  b.reserve(null, 1);
  b.reserve(null, 1);
  expect(() => b.reserve(null, 1)).toThrow();
  expect(b.usage().calls).toBe(2);
});
it("stricter reconstructed budget cannot erase debt", () => {
  const b = new Budget(api.W1);
  b.reserve(null, 20);
  expect(() => b.tighten({ ...api.W1, maxNodes: 19 })).toThrow();
  expect(b.usage().nodes).toBe(20);
});
it("a rejected dependency does not refund reserved work", () => {
  const b = new Budget(api.W1);
  b.reserveBound(100, 20);
  expect(b.usage()).toMatchObject({ nodes: 100, bytes: 20, calls: 1 });
});
for (const factor of [0, -1, NaN, Infinity])
  it(`unknown pre-call factor ${String(factor)} cannot invoke work`, () => {
    const b = new Budget(api.W1);
    expect(() => b.reserve(null, factor)).toThrow();
    expect(b.usage().calls).toBe(0);
  });
it("a structural Proxy is rejected without invoking traps", () => {
  const f = fixture();
  let calls = 0;
  const proxy = new Proxy(
    {},
    {
      ownKeys() {
        calls++;
        return [];
      },
    },
  );
  expect(api.composeWorkspace(proxy, f.context).ok).toBe(false);
  expect(calls).toBe(0);
});
it("symbol-bearing JSON envelope does not silently drop fields", () => {
  const f = fixture();
  expect(api.composeWorkspace({ ...f.input, [Symbol("hidden")]: true }, f.context).ok).toBe(false);
});
it("non-enumerable array payload is not silently stripped", () => {
  const f = fixture(),
    links: unknown[] = [];
  Object.defineProperty(links, "hidden", { value: "unapproved", enumerable: false });
  expect(api.composeWorkspace({ ...f.input, links }, f.context).ok).toBe(false);
});
it("explicit null query limit is not an omitted default", () =>
  expect(
    api.queryWorkspace(view(), { schema: "ate.workspace.query/1", offset: 0, limit: null }).ok,
  ).toBe(false));
