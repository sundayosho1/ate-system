import { it, expect } from "vitest";
import { associateResearchEvidence, FilesystemRegistryRepository } from "@ate/instrument-registry";
import { fingerprint } from "@ate/configuration";
import { setup, disk, equity, index, evidence, take } from "./fixtures.js";
it("Journey A: offline evidence to immutable canonical query", async () => {
  const { registry } = await setup();
  const r = take(await registry.register(equity()));
  expect(take(registry.get(r.instrumentId))).toEqual(r);
  expect(r.definition.taxonomyVersion).toBe("T1");
});
it("Journey B: two aliases resolve exact canonical revision while qualifying alias evidence", async () => {
  const { registry } = await setup();
  const d = equity();
  d.aliases = [
    { value: "ABC", scope: "X", rule: "CASE", kind: "SYMBOL", evidence: evidence("ABC") },
    {
      value: "Synthetic Share",
      scope: "X",
      rule: "EXACT",
      kind: "DISPLAY",
      evidence: evidence("Synthetic Share"),
    },
  ];
  const r = take(await registry.register(d));
  for (const a of d.aliases) {
    const resolved = take(
      registry.resolve({ value: a.value, scope: a.scope, aliasKind: a.kind, rule: a.rule }),
    );
    expect(resolved.candidates[0]!.revisionId).toBe(r.revisionId);
    expect(resolved.status).toBe("QUALIFIED_MATCH");
  }
  expect(
    take(registry.get(r.instrumentId))!
      .definition.aliases.map((a) => a.evidence.originalValue)
      .sort(),
  ).toEqual(["ABC", "Synthetic Share"]);
});
it("Journey C: ambiguous identity never arbitrarily selected", async () => {
  const { registry } = await setup();
  for (const cls of ["A", "B"]) {
    const d = equity(cls);
    d.identifiers = [
      { scheme: "RESEARCH", value: "ABC", scope: "X", authority: "fixture", evidence: evidence() },
    ];
    take(await registry.register(d));
  }
  const result = take(registry.resolve({ scheme: "RESEARCH", value: "ABC", scope: "X" }));
  expect(result.status).toBe("AMBIGUOUS");
  expect(result.candidates).toHaveLength(2);
});
it("Journey D: revision leaves old version reproducible", async () => {
  const { registry } = await setup();
  const a = take(await registry.register(equity()));
  const b = take(
    await registry.revise(
      a.instrumentId,
      a.revisionId,
      { ...equity(), displayName: "renamed" },
      "evidenced name update",
    ),
  );
  expect(b.instrumentId).toBe(a.instrumentId);
  expect(take(registry.revision(a.revisionId))).toEqual(a);
});
it("Journey E: fund relation does not merge underlying index identity", async () => {
  const { registry } = await setup();
  const i = take(await registry.register(index()));
  const d = {
    ...equity(),
    identity: {
      family: "FUND" as const,
      kind: "ETF" as const,
      fund: "SYN",
      shareClass: "A",
      venue: "X",
    },
    classification: "FUND",
    relationships: [
      { type: "TRACKS_INDEX" as const, target: i.instrumentId, evidence: evidence() },
    ],
  };
  const f = take(await registry.register(d));
  expect(f.instrumentId).not.toBe(i.instrumentId);
  expect(take(registry.relationships(f.instrumentId))[0]!.target).toBe(i.instrumentId);
});
it("Journey F: fresh repository recovers deterministic registry fingerprints", async () => {
  const f = await disk();
  take(await f.registry.importRecords([equity(), equity("B")]));
  const before = take(f.registry.snapshot());
  const fresh = await setup(undefined, new FilesystemRegistryRepository(f.path));
  expect(take(fresh.registry.snapshot())).toEqual(before);
  expect(take(fresh.registry.search())).toEqual(take(f.registry.search()));
});
it("Journey G: conflict import records rejection evidence and preserves original", async () => {
  const { registry } = await setup();
  const a = take(await registry.register(equity()));
  expect(
    take(await registry.importRecords([{ ...equity(), displayName: "foreign" }])).outcomes[0]!
      .status,
  ).toBe("CONFLICT");
  expect(take(registry.get(a.instrumentId))).toEqual(a);
});
it("Journey H: explicit replay association preserves original evidence content", async () => {
  const { registry } = await setup();
  const row = take(await registry.register(equity())),
    snapshot = take(registry.snapshot())!;
  const legacy = {
    session: "legacy",
    instrument: "source-native",
    historicalMembership: "UNVERIFIED",
  };
  const hash = fingerprint(legacy);
  const ref = take(
    associateResearchEvidence(registry, {
      schemaVersion: 1,
      owner: "MARKET_REPLAY",
      ownerReference: legacy.session,
      ownerFingerprint: hash,
      registryId: "synthetic-registry",
      instrumentId: row.instrumentId,
      revisionId: row.revisionId,
      registrySnapshot: snapshot.fingerprint,
    }),
  );
  expect(ref.ownerFingerprint).toBe(hash);
  expect(fingerprint(legacy)).toBe(hash);
});
