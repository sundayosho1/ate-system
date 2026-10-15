import { it, expect } from "vitest";
import {
  CanonicalSymbolMapping,
  FilesystemMappingRepository,
  defaultPolicy,
} from "@ate/canonical-symbol-mapping";
import { fingerprint } from "@ate/configuration";
import { fixture, addIdentity, approve, take, root, page } from "./fixtures.js";
it("A three FX broker names qualify one actual economic ID with separate source identities", async () => {
  const f = await fixture();
  const target = await addIdentity(
    f,
    "FX",
    { family: "FX", kind: "SPOT", base: "EUR", quote: "USD", settlement: "SPOT" },
    "fx",
  );
  for (const [i, raw] of ["EURUSD.a", "EURUSDm", "EURUSD-pro"].entries())
    await f.import("broker" + i, raw, "broker-" + i, ["fx"]);
  const s = take(await f.service.publish(f.request()));
  expect(s.prepared.groups).toHaveLength(1);
  expect(s.prepared.groups[0]!.instrumentId).toBe(target.instrumentId);
  expect(s.prepared.groups[0]!.members).toHaveLength(3);
  expect(new Set(s.prepared.mappings.map((m) => m.source.namespaceKey)).size).toBe(3);
  expect(s.prepared.groups[0]!.contractEquivalence).toBe("NOT_ESTABLISHED");
});
it("B same normalized key with different identity evidence never merges economic groups", async () => {
  const f = await fixture();
  await addIdentity(f, "B");
  await f.import("a", "shared", "synthetic-broker");
  await f.import("b", "SHARED", "broker-B", ["economic-B"]);
  const s = take(await f.service.publish(f.request()));
  expect(s.prepared.groups).toHaveLength(2);
  expect(s.prepared.conflicts.some((c) => c.code === "NORMALIZED_KEY_DISTINCT_IDENTITIES")).toBe(
    true,
  );
  expect(new Set(s.prepared.groups.map((g) => g.instrumentId)).size).toBe(2);
});
it("C one observation with two actual distinct IDs is explicit IDENTIFIER_CONFLICT", async () => {
  const f = await fixture();
  await addIdentity(f, "B");
  await f.import("conflict", "SYN.A", "synthetic-broker", ["economic-A", "economic-B"]);
  const s = take(await f.service.publish(f.request()));
  expect(s.prepared.mappings[0]!.outcome).toBe("IDENTIFIER_CONFLICT");
  expect(s.prepared.mappings[0]!.claims).toHaveLength(2);
  expect(s.prepared.groups).toHaveLength(0);
});
it("D name-only evidence cannot manufacture economic qualification", async () => {
  const f = await fixture();
  await f.import("name", "SYN.A", "synthetic-broker", []);
  const s = take(await f.service.publish(f.request()));
  expect(s.prepared.mappings[0]!.outcome).toBe("INSUFFICIENT_EVIDENCE");
  expect(s.prepared.mappings[0]!.target).toBeNull();
  expect(s.prepared.groups).toHaveLength(0);
});
it("E equity and commodity preserve non-FX discriminators", async () => {
  const f = await fixture();
  const c = await addIdentity(
    f,
    "GOLD",
    {
      family: "COMMODITY",
      kind: "BENCHMARK",
      reference: "gold",
      grade: "fine",
      location: "reference",
    },
    "gold",
  );
  await f.import("equity", "SYN.A");
  await f.import("metal", "XAU.synthetic", "metals", ["gold"]);
  const s = take(await f.service.publish(f.request()));
  expect(s.prepared.groups).toHaveLength(2);
  expect(
    s.prepared.mappings.find((m) => m.target?.instrumentId === c.instrumentId)?.target?.family,
  ).toBe("COMMODITY");
});
it("F registry revision yields stale current view and explicit immutable requalification", async () => {
  const f = await fixture();
  await f.import();
  const first = take(await f.service.publish(f.request()));
  const revision = take(f.base.canonical.registry.search())[0]!;
  take(
    await f.base.canonical.registry.revise(
      revision.instrumentId,
      revision.revisionId,
      { ...revision.definition, displayName: "Revised display" },
      "Recorded revision",
    ),
  );
  expect(
    take(f.service.query(page("MAPPINGS", { scope: "CURRENT", outcome: "STALE_REGISTRY" }))).total,
  ).toBe(1);
  const second = take(await f.service.publish(f.request("next")));
  expect(second.prepared.groups[0]!.revisionId).not.toBe(first.prepared.groups[0]!.revisionId);
  expect(take(f.service.snapshot(first.fingerprint))).toEqual(first);
  expect(take(f.service.compare(first.fingerprint, second.fingerprint)).differences[0]!.kind).toBe(
    "REGISTRY_CHANGED",
  );
});
it("G explicit multi-broker sets reconcile added missing and changed observations", async () => {
  const f = await fixture();
  await f.import("a", "OLD", "A");
  const first = take(await f.service.publish(f.request()));
  f.cats.splice(0);
  await f.import("b", "NEW", "A");
  await f.import("c", "OTHER", "B");
  const next = take(await f.service.publish(f.request("next")));
  const diff = take(f.service.compare(first.fingerprint, next.fingerprint));
  expect(diff.differences.map((v) => v.kind).sort()).toEqual([
    "ADDED",
    "ADDED",
    "MISSING_FROM_MAPPING_SET",
  ]);
  expect(take(f.service.snapshot(first.fingerprint))).toEqual(first);
});
it("H technical uniqueness is distinct from actual P21 maker-checker approval", async () => {
  const f = await fixture();
  const c = await f.import();
  const first = take(await f.service.publish(f.request()));
  const owner = {
    owner: "DATASET_CATALOGUE",
    ownerReference: "research-only",
    ownerFingerprint: fingerprint("owner"),
  };
  expect(
    f.service.associateResearchEvidence(first.prepared.mappings[0]!.fingerprint, owner).ok,
  ).toBe(false);
  const approved = await approve(f, c);
  const r = f.request("approved");
  r.approvals = [
    {
      ownerId: "offline-lab",
      catalogueFingerprint: c.fingerprint,
      observationFingerprint: c.observations[0]!.fingerprint,
      proposalId: approved.proposal.proposalId,
    },
  ];
  const second = take(await f.service.publish(r));
  expect(second.prepared.mappings[0]!.approval?.consistent).toBe(true);
  expect(
    f.service.associateResearchEvidence(second.prepared.mappings[0]!.fingerprint, owner).ok,
  ).toBe(true);
  expect(second.prepared.mappings[0]!.tradingAuthority).toBe(false);
});
it("I exact filesystem ACK freshly recovers identical immutable history", async () => {
  const disk = new FilesystemMappingRepository(
      root(),
      defaultPolicy.maxSnapshotBytes,
      defaultPolicy.maxSets,
      defaultPolicy.maxRetainedBytes,
    ),
    f = await fixture(defaultPolicy, disk);
  await f.import();
  const s = take(await f.service.publish(f.request()));
  expect(take(await disk.load()).at(-1)).toEqual(s);
  take(await f.service.stop());
  const reader = new CanonicalSymbolMapping("mapping-lab", f.ports);
  take(await reader.initialize());
  expect(reader.diagnostics()).toMatchObject({ readiness: "READY", health: "HEALTHY" });
  expect(take(reader.snapshot())).toEqual(s);
  take(await reader.stop());
  take(await reader.stop());
  expect(reader.query(page("MAPPINGS")).ok).toBe(false);
});
it("J invalid atomic input preserves actual upstream canonical and source owners", async () => {
  const f = await fixture();
  await f.import();
  const before = {
    canonical: take(f.base.canonical.registry.snapshot()),
    source: take(f.base.lab.snapshot()),
  };
  expect((await f.service.publish({ ...f.request(), brokerLogin: "excluded" })).ok).toBe(false);
  expect(take(await f.repository.load())).toEqual([]);
  expect(take(f.base.canonical.registry.snapshot())).toEqual(before.canonical);
  expect(take(f.base.lab.snapshot())).toEqual(before.source);
  expect(f.service.diagnostics().generation).toBe(0);
  take(await f.service.publish(f.request()));
});
