import { it, expect } from "vitest";
import { fingerprint } from "@ate/configuration";
import {
  BrokerSymbolCatalogue,
  FilesystemCatalogueRepository,
  MemoryCatalogueRepository,
  defaultPolicy,
  associateCatalogueResearchEvidence,
  fail,
  type Policy,
} from "@ate/broker-symbol-catalogue";
import { ReplayController, FilesystemReplayCheckpointRepository } from "@ate/market-replay";
import { VirtualClock } from "@ate/time";
import {
  setup,
  registered,
  batch,
  take,
  maker,
  checker,
  equity,
  evidence,
  root,
  time,
} from "./fixtures.js";
import { acceptanceFixture } from "../market-replay/acceptance-fixture.js";
import { historicalFixture } from "../market-replay/historical-fixture.js";
async function approved() {
  const f = await registered(),
    b = batch();
  b.records[0]!.identifiers = [
    { scheme: "RESEARCH", scope: "synthetic-broker", authority: "fixture", value: "economic-A" },
  ];
  const c = take(await f.lab.importNative(b)),
    p = take(
      await f.lab.propose({
        catalogueFingerprint: c.fingerprint,
        rawSymbol: "SYN.A",
        selector: { kind: "IDENTIFIER", index: 0 },
        maker,
        reason: "Explicit synthetic research claim",
      }),
    );
  take(
    await f.lab.review(p.proposalId, {
      checker,
      state: "APPROVED_FOR_RESEARCH_ASSOCIATION",
      selectedCandidate: p.candidateIds[0],
      reason: "Governed bounded offline association",
    }),
  );
  return { ...f, c, p };
}
it("Journey A — imports and retrieves exact single catalogue records", async () => {
  const f = await setup(),
    b = batch(),
    c = take(await f.lab.importJson(JSON.stringify(b)));
  expect(take(f.lab.catalogue(c.fingerprint)).observations[0]!.raw).toEqual(b.records[0]);
  expect(
    take(
      f.lab.query({
        kind: "OBSERVATIONS",
        catalogueFingerprint: c.fingerprint,
        rawSymbol: "SYN.A",
        offset: 0,
        limit: 1,
      }),
    ).total,
  ).toBe(1);
});
it("Journey B — same names and labels remain namespace-separated", async () => {
  const f = await setup(),
    a = take(await f.lab.importNative(batch())),
    b = batch("two");
  b.namespace.terminalFixtureId = "other-fixture";
  const c = take(await f.lab.importNative(b));
  expect(a.namespaceKey).not.toBe(c.namespaceKey);
  expect(take(f.lab.query({ kind: "NAMESPACES", offset: 0, limit: 10 })).total).toBe(2);
});
it("Journey C — normalization collisions retain all observations and no winner", async () => {
  const p: Policy = {
      ...defaultPolicy,
      rules: [{ id: "suffix", version: "B1", case: "CASE", suffixes: [".A"] }],
    },
    f = await setup(p),
    c = take(await f.lab.importNative(batch("one", ["EURUSD", "EURUSD.a"])));
  expect(c.collisions[0]!.rawSymbols).toHaveLength(2);
  expect(
    take(f.lab.query({ kind: "OBSERVATIONS", normalizedKey: "EURUSD", offset: 0, limit: 10 }))
      .total,
  ).toBe(2);
  expect(take(f.lab.snapshot())!.decisions).toHaveLength(0);
});
it("Journey D — real P20 identity and checker-authorized opt-in reference", async () => {
  const f = await approved(),
    body = { research: "synthetic owner" };
  const ref = take(
    associateCatalogueResearchEvidence(f.lab, f.canonical.registry, {
      proposalId: f.p.proposalId,
      owner: "HISTORICAL_DATA",
      ownerReference: "offline-owner",
      ownerFingerprint: fingerprint(body),
    }),
  );
  expect(ref.reference.instrumentId).toBe(f.p.candidateIds[0]);
  expect(ref.reference.ownerFingerprint).toBe(fingerprint(body));
  expect(ref.decisionId).toBe(take(f.lab.mapping(f.p.proposalId)).decisions[0]!.decisionId);
});
it("Journey E — multiple real canonical candidates remain under reviewer control", async () => {
  const f = await registered(),
    d = equity("B");
  d.identifiers = [
    {
      scheme: "RESEARCH",
      scope: "synthetic-broker",
      authority: "fixture",
      value: "economic-A",
      evidence: evidence(),
    },
  ];
  take(await f.canonical.registry.register(d));
  const b = batch();
  b.records[0]!.identifiers = [
    { scheme: "RESEARCH", scope: "synthetic-broker", value: "economic-A" },
  ];
  const c = take(await f.lab.importNative(b)),
    p = take(
      await f.lab.propose({
        catalogueFingerprint: c.fingerprint,
        rawSymbol: "SYN.A",
        selector: { kind: "IDENTIFIER", index: 0 },
        maker,
        reason: "Ambiguous claim",
      }),
    );
  expect(p.initialState).toBe("AMBIGUOUS");
  expect(p.candidateIds).toHaveLength(2);
  expect(
    (
      await f.lab.review(p.proposalId, {
        checker,
        state: "APPROVED_FOR_RESEARCH_ASSOCIATION",
        selectedCandidate: p.candidateIds[0],
        reason: "Choose first",
      })
    ).ok,
  ).toBe(false);
});
it("Journey F — deterministic versioned metadata and absence comparison", async () => {
  const f = await setup(),
    a = take(await f.lab.importNative(batch("one", ["A", "B"]))),
    b = batch("two", ["A", "C"]);
  b.records[0]!.visible = false;
  const c = take(await f.lab.importNative(b)),
    result = take(f.lab.compare(a.fingerprint, c.fingerprint));
  expect(result.differences.map((d) => d.kind)).toEqual([
    "METADATA_CHANGED",
    "REMOVED_FROM_OBSERVED_CATALOGUE",
    "ADDED",
  ]);
  expect(take(f.lab.compare(a.fingerprint, c.fingerprint))).toEqual(result);
});
it("Journey G — fresh filesystem recovery is exact before reader stop", async () => {
  const repository = new FilesystemCatalogueRepository(root()),
    f = await setup(defaultPolicy, repository),
    c = take(await f.lab.importNative(batch())),
    s = take(f.lab.snapshot());
  take(await f.lab.stop());
  const reader = new BrokerSymbolCatalogue("offline-lab", f.ports);
  expect(take(await reader.initialize())).toEqual(s);
  expect(take(reader.catalogue(c.fingerprint))).toEqual(c);
  expect(reader.diagnostics()).toMatchObject({ readiness: "READY", health: "HEALTHY" });
  take(await reader.stop());
  expect(reader.catalogue(c.fingerprint).ok).toBe(false);
});
it("Journey H — invalid mixed batch has no partial publication or artificial uncertainty", async () => {
  const f = await setup(),
    b = batch("bad", ["VALID", "INVALID"]);
  b.records[1]!.digits = -1;
  const r = await f.lab.importNative(b);
  expect(r).toMatchObject({ ok: false, error: { commitment: "NONE" } });
  expect(take(await f.repository.load())).toHaveLength(0);
  expect(f.lab.diagnostics()).toMatchObject({
    readiness: "READY",
    recoveryRequired: false,
    generation: 0,
  });
  take(await f.lab.importNative(batch()));
});
it("Journey I — lost genuine ACK fences writer and fresh service recovers exact commitment", async () => {
  const base = new MemoryCatalogueRepository(),
    f = await setup(defaultPolicy, {
      load: () => base.load(),
      commit: async (s) => {
        take(await base.commit(s));
        return fail("LOST_ACK", "UNKNOWN");
      },
    });
  expect((await f.lab.importNative(batch())).ok).toBe(false);
  expect((await f.lab.stop()).ok).toBe(false);
  const saved = take(await base.load()),
    fresh = new BrokerSymbolCatalogue("offline-lab", { ...f.ports, repository: base });
  expect(take(await fresh.initialize())).toEqual(saved[0]);
  expect(fresh.diagnostics().readiness).toBe("READY");
  take(await fresh.stop());
});
it("Journey J — actual P16 registration and P19 replay output retain owner fingerprints", async () => {
  const f = await approved(),
    historical = await historicalFixture(),
    replay = await acceptanceFixture("VERIFIED_POINT_IN_TIME", false),
    registrationBefore = fingerprint(historical.registration),
    specBefore = fingerprint(replay.spec),
    inputsBefore = fingerprint(replay.inputs);
  const a = new ReplayController(
      replay.spec,
      replay.inputs,
      new FilesystemReplayCheckpointRepository(
        root(),
        new VirtualClock(time),
        replay.spec.resourceLimits,
      ),
    ),
    b = new ReplayController(
      replay.spec,
      replay.inputs,
      new FilesystemReplayCheckpointRepository(
        root(),
        new VirtualClock(time),
        replay.spec.resourceLimits,
      ),
    );
  expect((await a.initialize()).ok).toBe(true);
  expect((await b.initialize()).ok).toBe(true);
  for (const [owner, ownerReference, ownerFingerprint] of [
    [
      "DATASET_CATALOGUE",
      String(historical.registration.entry.version.versionId),
      historical.registration.entry.version.versionFingerprint,
    ],
    ["MARKET_REPLAY", String(replay.spec.sessionId), specBefore],
  ] as const)
    take(
      associateCatalogueResearchEvidence(f.lab, f.canonical.registry, {
        proposalId: f.p.proposalId,
        owner,
        ownerReference,
        ownerFingerprint,
      }),
    );
  for (let i = 0; i < 4; i++) expect(await b.stepEvent()).toEqual(await a.stepEvent());
  expect(fingerprint(historical.registration)).toBe(registrationBefore);
  expect(fingerprint(replay.spec)).toBe(specBefore);
  expect(fingerprint(replay.inputs)).toBe(inputsBefore);
});
