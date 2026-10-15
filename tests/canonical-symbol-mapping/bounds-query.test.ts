import { it, expect } from "vitest";
import {
  CanonicalSymbolMapping,
  defaultPolicy,
  validatePolicy,
  fail,
} from "@ate/canonical-symbol-mapping";
import { fingerprint } from "@ate/configuration";
import { fixture, addIdentity, take, page, effective } from "./fixtures.js";
it.each([
  "maxCatalogues",
  "maxNamespaces",
  "maxObservations",
  "maxClaims",
  "maxCandidates",
  "maxConflicts",
  "maxGroupMembers",
  "maxSets",
  "maxQueryResults",
  "maxRegistryHistory",
] as const)(
  "governed %s accepts exact one and conservatively rejects one beyond",
  async (field) => {
    const f = await fixture({ ...defaultPolicy, [field]: 1 });
    await f.import();
    const first = take(await f.service.publish(f.request()));
    expect(first.generation).toBe(1);
    if (field === "maxSets") {
      expect((await f.service.publish(f.request("next"))).ok).toBe(false);
      return;
    }
    if (field === "maxQueryResults") {
      expect(f.service.query(page("MAPPINGS", { limit: 2 }))).toMatchObject({
        ok: false,
        error: { commitment: "NONE" },
      });
      expect(take(f.service.query(page("MAPPINGS", { limit: 1 }))).total).toBe(1);
      return;
    }
    if (field === "maxRegistryHistory") {
      await addIdentity(f, "B");
      expect((await f.service.publish(f.request("next"))).ok).toBe(false);
      return;
    }
    if (field === "maxClaims") {
      f.cats.splice(0);
      await f.import("two", "DOUBLE", "B", ["economic-A", "different"]);
    } else if (field === "maxCandidates") {
      await addIdentity(f, "B", undefined, "economic-A");
    } else if (field === "maxConflicts") {
      await addIdentity(f, "B");
      f.cats.splice(0);
      await f.import("c", "CONFLICT", "B", ["economic-A", "economic-B"]);
      await f.import("d", "OTHER", "C", ["economic-A", "economic-B"]);
    } else await f.import("second", "OTHER", "B");
    expect((await f.service.publish(f.request("next"))).ok).toBe(false);
    expect(take(f.service.snapshot(first.fingerprint))).toEqual(first);
    expect(f.service.diagnostics().generation).toBe(1);
  },
);
it.each(["maxInputBytes", "maxSnapshotBytes", "maxRetainedBytes", "maxInputDepth"] as const)(
  "%s policy rejects invalid limits before repository admission",
  async (field) => {
    expect(() => validatePolicy({ ...defaultPolicy, [field]: 0 })).toThrow();
    const f = await fixture(defaultPolicy, undefined, false);
    f.setConfig(await effective({ ...defaultPolicy, [field]: 0 }));
    expect((await f.service.initialize()).ok).toBe(false);
    expect(f.service.diagnostics().readiness).toBe("NOT_READY");
  },
);
it("input byte bound and depth bound preserve safe prepublication rejection", async () => {
  const f = await fixture({ ...defaultPolicy, maxInputBytes: 1024, maxInputDepth: 3 });
  await f.import();
  take(await f.service.publish(f.request()));
  expect((await f.service.publish({ ...f.request("large"), data: "X".repeat(1025) })).ok).toBe(
    false,
  );
  expect(
    (await f.service.publish({ ...f.request("deep"), data: { one: { two: { three: "x" } } } })).ok,
  ).toBe(false);
  expect(f.service.diagnostics().generation).toBe(1);
});
it("snapshot/retained byte capacities accept exact physical JSON size and reject one less", async () => {
  const sizing = await fixture();
  await sizing.import();
  const first = take(await sizing.service.publish(sizing.request()));
  const original = Buffer.byteLength(JSON.stringify(first));
  for (const field of ["maxSnapshotBytes", "maxRetainedBytes"] as const) {
    let capacity = original;
    for (let i = 0; i < 5; i++)
      capacity = original - String(defaultPolicy[field]).length + String(capacity).length;
    const exact = await fixture({ ...defaultPolicy, [field]: capacity });
    await exact.import();
    const s = take(await exact.service.publish(exact.request()));
    expect(Buffer.byteLength(JSON.stringify(s))).toBe(capacity);
    const below = await fixture({ ...defaultPolicy, [field]: capacity - 1 });
    await below.import();
    expect((await below.service.publish(below.request())).ok).toBe(false);
    expect(take(await below.repository.load())).toEqual([]);
  }
});
it("strict verified-identifiers policy refuses owner-qualified unverified research claims", async () => {
  const f = await fixture({ ...defaultPolicy, requireVerifiedIdentifiers: true });
  await f.import();
  const s = take(await f.service.publish(f.request()));
  expect(s.prepared.mappings[0]!.outcome).toBe("INSUFFICIENT_EVIDENCE");
  expect(s.prepared.mappings[0]!.claims[0]!.status).toBe("QUALIFIED_MATCH");
});
it.each(["MAPPINGS", "GROUPS", "CONFLICTS", "HISTORY"] as const)(
  "%s exact history and all supported predicate composition has no silent broadening",
  async (kind) => {
    const f = await fixture();
    const c = await f.import();
    const s = take(await f.service.publish(f.request()));
    const m = s.prepared.mappings[0]!;
    const filters = {
      ownerId: m.source.ownerId,
      namespaceKey: m.source.namespaceKey,
      catalogueFingerprint: c.fingerprint,
      observationFingerprint: m.source.observationFingerprint,
      instrumentId: m.target!.instrumentId,
      family: m.target!.family,
      rawSymbol: m.observation.raw.rawSymbol,
      normalizedKey: m.observation.keys[0]!.value,
      outcome: m.outcome,
      qualifiedOnly: true,
      snapshotFingerprint: s.fingerprint,
    };
    const r = take(f.service.query(page(kind, filters)));
    expect(r.total).toBe(kind === "CONFLICTS" ? 0 : 1);
    expect(
      take(f.service.query(page(kind, { ...filters, namespaceKey: fingerprint("other") }))).total,
    ).toBe(0);
    expect(f.service.query(page(kind, { snapshotFingerprint: fingerprint("missing") }))).toEqual(
      fail("HISTORICAL_EVIDENCE_UNAVAILABLE"),
    );
    expect(f.service.query(page(kind, { unknown: true })).ok).toBe(false);
    expect(take(f.service.snapshot(s.fingerprint))).toEqual(s);
  },
);
it.each([0, 1, 2, 3, 9])(
  "filtered pagination offset %s has truthful total and deterministic pages",
  async (offset) => {
    const f = await fixture();
    for (let i = 0; i < 3; i++) await f.import("r" + i, "NAME" + i, "B" + i);
    const s = take(await f.service.publish(f.request()));
    const r = take(f.service.query(page("MAPPINGS", { qualifiedOnly: true, offset, limit: 1 })));
    expect(r.total).toBe(3);
    expect(r.records).toHaveLength(offset < 3 ? 1 : 0);
    expect(r.nextOffset).toBe(offset + 1 < 3 ? offset + 1 : null);
    expect(
      take(f.service.query(page("MAPPINGS", { qualifiedOnly: true, offset, limit: 1 }))),
    ).toEqual(r);
    expect(take(f.service.snapshot())).toEqual(s);
  },
);
it("source-owner registry wrapper is isolated from caller map mutation", async () => {
  const f = await fixture();
  await f.import();
  (f.ports.sources as Map<string, typeof f.base.lab>).clear();
  take(await f.service.publish(f.request()));
  expect(f.service.diagnostics().readiness).toBe("READY");
});
it("incompatible prior policy fails recovery without changing original history", async () => {
  const f = await fixture();
  await f.import();
  const s = take(await f.service.publish(f.request()));
  take(await f.service.stop());
  f.setConfig(await effective({ ...defaultPolicy, maxClaims: 1 }));
  const fresh = new CanonicalSymbolMapping("mapping-lab", f.ports);
  expect((await fresh.initialize()).ok).toBe(false);
  expect(fresh.diagnostics().recoveryRequired).toBe(true);
  expect(take(await f.repository.load())).toEqual([s]);
});

it("max conflict evidence exact boundary is retained rather than truncated", async () => {
  const f = await fixture({ ...defaultPolicy, maxConflicts: 1 });
  await addIdentity(f, "B");
  await f.import("single-conflict", "C", "synthetic-broker", ["economic-A", "economic-B"]);
  const s = take(await f.service.publish(f.request()));
  expect(s.prepared.conflicts).toHaveLength(1);
  expect(s.prepared.mappings[0]!.reasonCodes).toHaveLength(1);
  expect(s.prepared.mappings[0]!.outcome).toBe("IDENTIFIER_CONFLICT");
});

it("reconciliation composite identities cannot collide through delimiters", async () => {
  const f = await fixture();
  const { BrokerSymbolCatalogue, MemoryCatalogueRepository, namespaceKey } =
    await import("@ate/broker-symbol-catalogue");
  const { batch } = await import("../broker-symbol-catalogue/fixtures.js");
  const a = batch("a"),
    b = batch("b");
  a.namespace.brokerNamespaceId = "namespace-one";
  b.namespace.brokerNamespaceId = "namespace-two";
  const ownerA = "source-a",
    ownerB = ownerA + ":" + namespaceKey(a.namespace);
  a.records[0]!.rawSymbol = namespaceKey(b.namespace) + ":leaf";
  b.records[0]!.rawSymbol = "leaf";
  for (const record of [a.records[0]!, b.records[0]!])
    record.identifiers = [
      { scheme: "RESEARCH", scope: "synthetic-broker", authority: "fixture", value: "economic-A" },
    ];
  const labA = new BrokerSymbolCatalogue(ownerA, {
      ...f.base.ports,
      repository: new MemoryCatalogueRepository(),
    }),
    labB = new BrokerSymbolCatalogue(ownerB, {
      ...f.base.ports,
      repository: new MemoryCatalogueRepository(),
    });
  take(await labA.initialize());
  take(await labB.initialize());
  const ca = take(await labA.importNative(a)),
    cb = take(await labB.importNative(b));
  take(await f.service.stop());
  const mapping = new CanonicalSymbolMapping("mapping-lab", {
    ...f.ports,
    sources: new Map([
      [ownerA, labA],
      [ownerB, labB],
    ]),
  });
  take(await mapping.initialize());
  const input = {
    requestId: "before",
    registrySnapshot: take(f.base.canonical.registry.snapshot())!.fingerprint,
    sources: [
      {
        ownerId: ownerA,
        ownerSnapshot: take(labA.snapshot())!.fingerprint,
        catalogueFingerprint: ca.fingerprint,
      },
    ],
    assertions: [],
    approvals: [],
  };
  const first = take(await mapping.publish(input));
  const second = take(
    await mapping.publish({
      ...input,
      requestId: "after",
      sources: [
        ...input.sources,
        {
          ownerId: ownerB,
          ownerSnapshot: take(labB.snapshot())!.fingerprint,
          catalogueFingerprint: cb.fingerprint,
        },
      ],
    }),
  );
  const diff = take(mapping.compare(first.fingerprint, second.fingerprint));
  expect(diff.differences).toHaveLength(1);
  expect(diff.differences[0]!.kind).toBe("ADDED");
  take(await mapping.stop());
  take(await labA.stop());
  take(await labB.stop());
});

it("multiple retained versions of one raw symbol are never collapsed into a reconciliation winner", async () => {
  const f = await fixture();
  await f.import("old", "SAME");
  const before = take(await f.service.publish(f.request()));
  await f.import("new", "SAME");
  const after = take(await f.service.publish(f.request("next")));
  expect(after.prepared.mappings).toHaveLength(2);
  const differences = take(f.service.compare(before.fingerprint, after.fingerprint)).differences;
  expect(differences).toHaveLength(2);
  expect(differences.filter((d) => d.kind === "ADDED")).toHaveLength(1);
  expect(new Set(differences.map((d) => d.after)).size).toBe(2);
  expect(take(f.service.snapshot(before.fingerprint))).toEqual(before);
});
