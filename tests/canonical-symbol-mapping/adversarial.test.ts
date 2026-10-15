import { it, expect } from "vitest";
import {
  CanonicalSymbolMapping,
  MemoryMappingRepository,
  defaultPolicy,
  fail,
  ok,
  type Repository,
  type Snapshot,
  type Result,
} from "@ate/canonical-symbol-mapping";
import { fingerprint } from "@ate/configuration";
import { durationMs } from "@ate/time";
import {
  fixture,
  addIdentity,
  take,
  effective,
  page,
  proof,
  approve,
  maker,
  checker,
} from "./fixtures.js";
it.each([null, "primitive", 42, NaN, Infinity, [], {}, { requestId: "bad", unknown: true }])(
  "native hostile primitive/shape %j is structured and atomic",
  async (raw) => {
    const f = await fixture();
    await f.import();
    const r = await f.service.publish(raw);
    expect(r).toMatchObject({ ok: false, error: { commitment: "NONE" } });
    expect(take(await f.repository.load())).toEqual([]);
    take(await f.service.publish(f.request()));
  },
);
it.each(["getter", "proxy", "revoked", "cycle", "prototype", "sparse", "unicode", "depth"])(
  "descriptor guard safely rejects %s without escaped callback",
  async (mode) => {
    const f = await fixture();
    await f.import();
    let raw: unknown = f.request();
    if (mode === "getter")
      raw = Object.defineProperty({}, "sources", {
        enumerable: true,
        get() {
          throw Error("GETTER");
        },
      });
    if (mode === "proxy")
      raw = new Proxy(
        {},
        {
          ownKeys() {
            throw Error("PROXY");
          },
        },
      );
    if (mode === "revoked") {
      const p = Proxy.revocable({}, {});
      p.revoke();
      raw = p.proxy;
    }
    if (mode === "cycle") {
      const x: Record<string, unknown> = {};
      x["loop"] = x;
      raw = x;
    }
    if (mode === "prototype")
      raw = Object.assign(Object.create({ inherited: true }) as object, f.request());
    if (mode === "sparse") raw = { ...f.request(), sources: Array(2) };
    if (mode === "unicode") raw = { ...f.request(), requestId: "bad\ud800" };
    if (mode === "depth") {
      for (let i = 0; i < 22; i++) raw = { nested: raw };
    }
    expect(await f.service.publish(raw)).toMatchObject({
      ok: false,
      error: { commitment: "NONE" },
    });
    expect(f.service.diagnostics().generation).toBe(0);
  },
);
it.each(['{"requestId":"a","requestId":"a"}', '{"a":1,"\\u0061":2}', "{", "[1,]", '{"a":1e999}'])(
  "JSON rejects duplicate or malformed evidence %s",
  async (raw) => {
    const f = await fixture();
    expect((await f.service.publishJson(raw)).ok).toBe(false);
    expect(take(await f.repository.load())).toEqual([]);
  },
);
it("input reference duplication and unknown historical roots cannot fall back", async () => {
  const f = await fixture();
  await f.import();
  const r = f.request();
  for (const bad of [
    { ...r, sources: [...r.sources, ...r.sources] },
    { ...r, registrySnapshot: fingerprint("absent") },
    { ...r, sources: [{ ...r.sources[0]!, ownerSnapshot: fingerprint("absent") }] },
  ]) {
    expect((await f.service.publish(bad)).ok).toBe(false);
    expect(f.service.diagnostics().generation).toBe(0);
  }
  take(await f.service.publish(r));
  expect(f.service.snapshot(fingerprint("absent")).ok).toBe(false);
});
it("unsupported and no-match material claims remain visible and unqualified", async () => {
  const f = await fixture();
  await f.import("a", "SYN.A", "synthetic-broker", ["economic-A", "not-found"]);
  const s = take(await f.service.publish(f.request()));
  expect(s.prepared.mappings[0]!.claims).toHaveLength(2);
  expect(s.prepared.mappings[0]!.outcome).toBe("INSUFFICIENT_EVIDENCE");
  expect(s.prepared.groups).toHaveLength(0);
});
it("actual owner ambiguity has stable full candidates and no insertion winner", async () => {
  const f = await fixture();
  await addIdentity(f, "B", undefined, "economic-A");
  await f.import();
  const a = take(await f.service.prepare(f.request())),
    b = take(await f.service.prepare(f.request()));
  expect(b).toEqual(a);
  expect(a.mappings[0]!.outcome).toBe("MULTIPLE_CANDIDATES");
  expect(a.mappings[0]!.candidateIds).toHaveLength(2);
  expect(a.groups).toHaveLength(0);
});
it("duplicate claims cannot fabricate multiple independent supporting claims", async () => {
  const f = await fixture({ ...defaultPolicy, minIndependentClaims: 2 });
  await f.import("a", "SYN.A", "synthetic-broker", ["economic-A", "economic-A"]);
  const s = take(await f.service.publish(f.request()));
  expect(s.prepared.mappings[0]!.outcome).toBe("SOURCE_METADATA_CONFLICT");
});
it("source family contradiction is explicit and excludes research grouping", async () => {
  const f = await fixture();
  const c = await f.import();
  const b = structuredClone(take(f.base.lab.catalogue(c.fingerprint)));
  const raw = {
    schemaVersion: 1,
    batchId: "family",
    namespace: b.namespace,
    source: b.source,
    records: [{ ...b.observations[0]!.raw, declaredFamily: "INDEX" }],
  };
  const next = take(await f.base.lab.importNative(raw));
  f.cats.splice(0, 1, next);
  const s = take(await f.service.publish(f.request()));
  expect(s.prepared.mappings[0]!.outcome).toBe("TAXONOMY_CONFLICT");
});
it.each(["venue", "underlying", "expiry", "strike", "kind", "network", "shareClass"])(
  "supplemental %s cannot override actual P20 economic discriminators",
  async (key) => {
    const f = await fixture();
    await f.import();
    const r = f.request();
    r.assertions = [
      proof(
        {
          [key]:
            key === "expiry"
              ? "2027-01-01T00:00:00.000Z"
              : key === "underlying"
                ? "ins-" + "0".repeat(64)
                : key === "strike"
                  ? "100"
                  : "different",
        },
        f,
      ),
    ];
    const s = take(await f.service.publish(r));
    expect(s.prepared.mappings[0]!.outcome).toBe("SOURCE_METADATA_CONFLICT");
    expect(s.prepared.groups).toHaveLength(0);
    expect(s.prepared.mappings[0]!.assertion).toEqual(r.assertions[0]);
  },
);
it("valid supplemental assertion confirms a constraint but cannot qualify name-only evidence", async () => {
  const f = await fixture();
  await f.import("a", "SYN.A", "synthetic-broker", []);
  const r = f.request();
  r.assertions = [proof({ venue: "XNAS" }, f)];
  const s = take(await f.service.publish(r));
  expect(s.prepared.mappings[0]!.outcome).toBe("INSUFFICIENT_EVIDENCE");
});
it("unattached or incorrectly hashed supplemental assertions reject atomically", async () => {
  const f = await fixture();
  await f.import();
  for (const assertion of [
    { ...proof({ venue: "XNAS" }, f), contentFingerprint: fingerprint("false") },
    { ...proof({ venue: "XNAS" }, f), observationFingerprint: fingerprint("missing") },
  ])
    expect((await f.service.publish({ ...f.request(), assertions: [assertion] })).ok).toBe(false);
  expect(take(await f.repository.load())).toEqual([]);
});
it("source age and current-root source change cannot rewrite stored conclusions", async () => {
  const f = await fixture();
  await f.import();
  const s = take(await f.service.publish(f.request()));
  f.base.clock.advanceBy(durationMs(defaultPolicy.maxSourceAgeMs + 1));
  expect(
    take(f.service.query(page("MAPPINGS", { scope: "CURRENT", outcome: "STALE_SOURCE" }))).total,
  ).toBe(1);
  expect(take(f.service.snapshot(s.fingerprint))).toEqual(s);
  expect(s.prepared.mappings[0]!.outcome).toBe("UNIQUE_QUALIFIED_CANDIDATE");
});
it("duplicate request is exact idempotency and changed input cannot conceal context drift", async () => {
  const f = await fixture();
  await f.import();
  const r = f.request(),
    s = take(await f.service.publish(r));
  expect(take(await f.service.publish(r))).toEqual(s);
  expect(take(await f.repository.load())).toHaveLength(1);
  await f.import("next");
  expect(await f.service.publish(r)).toEqual(fail("OWNER_CONTEXT_CHANGED"));
  expect((await f.service.publish({ ...r, assertions: [proof({ venue: "OTHER" }, f)] })).ok).toBe(
    false,
  );
});
it("policy drift fences writes; explicit compatible policy lineage preserves prior conclusions", async () => {
  const f = await fixture();
  await f.import();
  const first = take(await f.service.publish(f.request()));
  const changed = {
    ...defaultPolicy,
    maxQueryResults: 99,
    compatibleHistoryPolicies: [first.prepared.policyFingerprint],
  };
  f.setConfig(await effective(changed));
  expect((await f.service.publish(f.request("new"))).ok).toBe(false);
  take(await f.service.stop());
  const fresh = new CanonicalSymbolMapping("mapping-lab", f.ports);
  take(await fresh.initialize());
  expect(take(fresh.snapshot(first.fingerprint))).toEqual(first);
  expect(
    take(
      fresh.query(
        page("MAPPINGS", { scope: "CURRENT", outcome: "POLICY_INCOMPATIBLE", limit: 99 }),
      ),
    ).total,
  ).toBe(1);
  take(await fresh.publish(f.request("new")));
  take(await fresh.stop());
});
it.each(["none", "unknown", "throw", "malformed", "generation", "fingerprint"])(
  "repository %s retains honest commitment and shutdown",
  async (mode) => {
    const disk = new MemoryMappingRepository();
    let inject = false;
    const repository: Repository = {
      load: () => disk.load(),
      commit: async (s) => {
        if (!inject) return disk.commit(s);
        if (mode === "none") return fail("PROVEN_NONE");
        take(await disk.commit(s));
        if (mode === "unknown") return fail("LOST", "UNKNOWN");
        if (mode === "throw") throw Error("AFTER_ACK");
        if (mode === "malformed") return { ok: true } as unknown as ReturnType<typeof ok<Snapshot>>;
        return ok(
          mode === "generation"
            ? { ...s, generation: 99 }
            : { ...s, fingerprint: fingerprint("false") },
        );
      },
    };
    const f = await fixture(defaultPolicy, repository);
    await f.import();
    inject = true;
    const result = await f.service.publish(f.request());
    if (mode === "none") {
      expect(result).toEqual(fail("PROVEN_NONE"));
      expect(f.service.diagnostics().readiness).toBe("READY");
      inject = false;
      take(await f.service.publish(f.request()));
    } else {
      expect(result).toMatchObject({ ok: false, error: { commitment: "UNKNOWN" } });
      const saved = take(await disk.load()).at(-1) as Snapshot;
      expect(f.service.diagnostics()).toMatchObject({
        readiness: "NOT_READY",
        health: "DEGRADED",
        pending: 1,
        unresolvedPublication: { generation: saved.generation, fingerprint: saved.fingerprint },
      });
      expect((await f.service.stop()).ok).toBe(false);
      expect((await f.service.stop()).ok).toBe(false);
      const fresh = new CanonicalSymbolMapping("mapping-lab", { ...f.ports, repository: disk });
      take(await fresh.initialize());
      expect(take(fresh.snapshot())).toEqual(saved);
      take(await fresh.stop());
    }
  },
);
it("held/reentrant commit cannot lose lease or fabricate successful stop", async () => {
  let release: ((r: Result<Snapshot>) => void) | undefined;
  const f = await fixture(defaultPolicy, {
    load: () => Promise.resolve(ok([])),
    commit: () =>
      new Promise((r) => {
        release = r;
      }),
  });
  await f.import();
  const pending = f.service.publish(f.request());
  for (let i = 0; i < 100 && !release; i++) await Promise.resolve();
  expect(release).toBeTypeOf("function");
  expect(f.service.query(page("HISTORY")).ok).toBe(false);
  expect((await f.service.stop()).ok).toBe(false);
  expect((await f.service.publish(f.request("other"))).ok).toBe(false);
  release!(fail("NO_WRITE"));
  expect(await pending).toEqual(fail("NO_WRITE"));
  expect(f.service.diagnostics().readiness).toBe("READY");
});
it("rehashed corrupted mapping is rejected by actual owner reconstruction", async () => {
  const f = await fixture();
  await f.import();
  const s = take(await f.service.publish(f.request()));
  take(await f.service.stop());
  const changed = structuredClone(s);
  changed.prepared.mappings[0]!.candidateIds = [];
  const { fingerprint: _a, ...m } = changed.prepared.mappings[0]!;
  changed.prepared.mappings[0]!.fingerprint = fingerprint(m);
  const { fingerprint: _b, ...prepared } = changed.prepared;
  changed.prepared.fingerprint = fingerprint(prepared);
  const { fingerprint: _c, ...content } = changed;
  changed.fingerprint = fingerprint(content);
  const repository: Repository = {
    load: () => Promise.resolve(ok([changed])),
    commit: () => Promise.resolve(fail("UNUSED")),
  };
  const fresh = new CanonicalSymbolMapping("mapping-lab", { ...f.ports, repository });
  expect((await fresh.initialize()).ok).toBe(false);
  expect(fresh.diagnostics().recoveryRequired).toBe(true);
  expect((await fresh.stop()).ok).toBe(false);
});
it("maker self-review cannot be laundered as a P22 approved association", async () => {
  const f = await fixture();
  const c = await f.import();
  const p = take(
    await f.base.lab.propose({
      catalogueFingerprint: c.fingerprint,
      rawSymbol: "SYN.A",
      selector: { kind: "IDENTIFIER", index: 0 },
      maker,
      reason: "Claim",
    }),
  );
  expect(
    (
      await f.base.lab.review(p.proposalId, {
        checker: maker,
        state: "APPROVED_FOR_RESEARCH_ASSOCIATION",
        selectedCandidate: p.candidateIds[0],
        reason: "Self",
      })
    ).ok,
  ).toBe(false);
  const r = f.request();
  r.approvals = [
    {
      ownerId: "offline-lab",
      catalogueFingerprint: c.fingerprint,
      observationFingerprint: c.observations[0]!.fingerprint,
      proposalId: p.proposalId,
    },
  ];
  const s = take(await f.service.publish(r));
  expect(s.prepared.mappings[0]!.approval?.consistent).toBe(false);
  expect(s.prepared.mappings[0]!.target).not.toBeNull();
});
it("P21 selector approval does not certify a conflicting whole observation", async () => {
  const f = await fixture();
  await addIdentity(f, "B");
  const c = await f.import("conflict", "SYN.A", "synthetic-broker", ["economic-A", "economic-B"]);
  const accepted = await approve(f, c);
  const r = f.request();
  r.approvals = [
    {
      ownerId: "offline-lab",
      catalogueFingerprint: c.fingerprint,
      observationFingerprint: c.observations[0]!.fingerprint,
      proposalId: accepted.proposal.proposalId,
    },
  ];
  const s = take(await f.service.publish(r));
  expect(accepted.decision.checker).toEqual(checker);
  expect(s.prepared.mappings[0]!.outcome).toBe("IDENTIFIER_CONFLICT");
  expect(
    f.service.associateResearchEvidence(s.prepared.mappings[0]!.fingerprint, {
      owner: "DATASET_CATALOGUE",
      ownerReference: "blocked",
      ownerFingerprint: fingerprint("owner"),
    }).ok,
  ).toBe(false);
});

it("CURRENT clock failure rejects rather than creating false fresh qualification", async () => {
  const f = await fixture();
  await f.import();
  const s = take(await f.service.publish(f.request()));
  const now = f.base.clock.now.bind(f.base.clock);
  f.base.clock.now = () => {
    throw Error("CLOCK_UNAVAILABLE");
  };
  expect(f.service.query(page("MAPPINGS", { scope: "CURRENT" }))).toMatchObject({
    ok: false,
    error: { commitment: "NONE" },
  });
  expect(take(f.service.snapshot(s.fingerprint))).toEqual(s);
  f.base.clock.now = now;
});
it("pre-admission configuration rejection permits retry with no durable obligation", async () => {
  let calls = 0;
  const repository: Repository = {
    load: () => {
      calls++;
      return Promise.resolve(ok([]));
    },
    commit: () => Promise.resolve(fail("UNUSED")),
  };
  const f = await fixture(defaultPolicy, repository, false);
  const config = await effective(defaultPolicy);
  f.setConfig({ ...config, conflicts: [{}] as unknown as typeof config.conflicts });
  expect((await f.service.initialize()).ok).toBe(false);
  expect(calls).toBe(0);
  expect(f.service.diagnostics()).toMatchObject({
    generation: 0,
    unresolvedPublication: null,
    recoveryRequired: false,
    readiness: "NOT_READY",
  });
  f.setConfig(config);
  take(await f.service.initialize());
  expect(calls).toBe(1);
  take(await f.service.stop());
  take(await f.service.stop());
});

it("current owner loss degrades readiness without retrospective evidence rewrite", async () => {
  const f = await fixture();
  await f.import();
  const s = take(await f.service.publish(f.request()));
  take(await f.base.lab.stop());
  expect(f.service.diagnostics()).toMatchObject({ readiness: "NOT_READY", health: "DEGRADED" });
  expect(
    take(
      f.service.query(
        page("MAPPINGS", { scope: "CURRENT", outcome: "CURRENT_AUTHORITY_UNAVAILABLE" }),
      ),
    ).total,
  ).toBe(1);
  expect(take(f.service.snapshot(s.fingerprint))).toEqual(s);
  expect(
    take(
      f.service.query(page("MAPPINGS", { scope: "STORED", outcome: "UNIQUE_QUALIFIED_CANDIDATE" })),
    ).total,
  ).toBe(1);
});

it("non-research configuration cannot be relabeled as research mutation authority", async () => {
  const f = await fixture(defaultPolicy, undefined, false),
    config = await effective(defaultPolicy);
  f.setConfig({ ...config, context: { ...config.context, runtimeMode: "LIVE" } });
  expect(await f.service.initialize()).toMatchObject({
    ok: false,
    error: { code: "RESEARCH_MODE_REQUIRED", commitment: "NONE" },
  });
  expect(take(await f.repository.load())).toEqual([]);
});
it("Q-TICK remains research identity only, with no contract-equivalence or trading certification", async () => {
  const f = await fixture();
  const c = await f.import();
  const raw = take(f.base.lab.catalogue(c.fingerprint));
  const b = {
    schemaVersion: 1,
    batchId: "tick",
    namespace: raw.namespace,
    source: raw.source,
    records: [{ ...raw.observations[0]!.raw, digits: 2, point: "0.01", tickSize: "0.001" }],
  };
  const next = take(await f.base.lab.importNative(b));
  f.cats.splice(0, 1, next);
  const s = take(await f.service.publish(f.request()));
  expect(s.prepared.mappings[0]!.outcome).toBe("UNIQUE_QUALIFIED_CANDIDATE");
  expect(s.prepared.groups[0]!.contractEquivalence).toBe("NOT_ESTABLISHED");
  expect(s.prepared.groups[0]!.tradingAuthority).toBe(false);
});
