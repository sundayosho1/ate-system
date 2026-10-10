import { it, expect } from "vitest";
import {
  BrokerSymbolCatalogue,
  defaultPolicy,
  MemoryCatalogueRepository,
  bytes,
  fail,
  ok,
  type Repository,
  type Snapshot,
} from "@ate/broker-symbol-catalogue";
import { fingerprint } from "@ate/configuration";
import { setup, registered, batch, take, maker, checker, effective } from "./fixtures.js";
async function proposed(policy = { ...defaultPolicy }) {
  const canonical = await registered(),
    f = await setup(policy);
  f.ports.registry = canonical.canonical.registry;
  f.ports.registryConfiguration = () => canonical.canonical.config;
  const b = batch();
  b.records[0]!.identifiers = [
    { scheme: "RESEARCH", scope: "synthetic-broker", value: "economic-A" },
  ];
  const c = take(await f.lab.importNative(b)),
    request = {
      catalogueFingerprint: c.fingerprint,
      rawSymbol: "SYN.A",
      selector: { kind: "IDENTIFIER", index: 0 },
      maker,
      reason: "Scoped evidence",
    };
  const p = take(await f.lab.propose(request));
  return { ...f, c, p, request };
}
it("exact proposal capacity succeeds, identical retry is idempotent and excess is NONE", async () => {
  const f = await proposed({ ...defaultPolicy, maxProposals: 1 });
  expect(take(await f.lab.propose(f.request))).toEqual(f.p);
  expect((await f.lab.propose({ ...f.request, reason: "Different proposal" })).ok).toBe(false);
  expect(f.lab.diagnostics()).toMatchObject({
    generation: 2,
    readiness: "READY",
    recoveryRequired: false,
  });
});
it("exact decision capacity succeeds and excess cannot overwrite approval", async () => {
  const f = await proposed({ ...defaultPolicy, maxDecisions: 1 });
  const d = take(
    await f.lab.review(f.p.proposalId, {
      checker,
      state: "APPROVED_FOR_RESEARCH_ASSOCIATION",
      selectedCandidate: f.p.candidateIds[0],
      reason: "Independent approval",
    }),
  );
  expect(
    (
      await f.lab.review(f.p.proposalId, {
        checker,
        state: "REJECTED",
        reason: "Capacity attempted revoke",
      })
    ).ok,
  ).toBe(false);
  expect(take(f.lab.mapping(f.p.proposalId)).decisions).toEqual([d]);
  expect(take(f.lab.mapping(f.p.proposalId)).state).toBe("APPROVED_FOR_RESEARCH_ASSOCIATION");
});
it("difference capacity rejects excess without silently truncated comparison", async () => {
  const f = await setup({ ...defaultPolicy, maxDifferences: 1 }),
    a = take(await f.lab.importNative(batch("one", ["A"]))),
    b = take(await f.lab.importNative(batch("two", ["A", "B"])));
  expect(take(f.lab.compare(a.fingerprint, b.fingerprint)).differences).toHaveLength(1);
  const c = take(await f.lab.importNative(batch("three", ["C", "D"])));
  expect(f.lab.compare(b.fingerprint, c.fingerprint).ok).toBe(false);
  expect(f.lab.diagnostics().recoveryRequired).toBe(false);
});
it.each(["maxSnapshotBytes", "maxRetainedBytes"] as const)(
  "configured %s rejects excess immutable storage without uncertainty",
  async (field) => {
    const f = await setup({ ...defaultPolicy, [field]: 4096 });
    take(await f.lab.importNative(batch("one")));
    const b = batch(
      "two",
      Array.from({ length: 20 }, (_, i) => `SYMBOL-${i}`),
    );
    expect((await f.lab.importNative(b)).ok).toBe(false);
    expect(f.lab.diagnostics()).toMatchObject({
      generation: 1,
      readiness: "READY",
      recoveryRequired: false,
    });
    expect(bytes(take(f.lab.snapshot()))).toBeLessThanOrEqual(4096);
  },
);
it("unknown publication retains the exact original obligation across repeated stop and rejection", async () => {
  let attempted: Snapshot | undefined;
  const base = new MemoryCatalogueRepository(),
    repository: Repository = {
      load: () => base.load(),
      commit: async (s) => {
        attempted = s;
        take(await base.commit(s));
        return fail("LOST_ACK", "UNKNOWN");
      },
    },
    f = await setup(defaultPolicy, repository);
  expect((await f.lab.importNative(batch())).ok).toBe(false);
  const original = f.lab.diagnostics().unresolvedPublication;
  expect(original).toEqual({
    generation: attempted!.generation,
    fingerprint: attempted!.fingerprint,
  });
  expect(f.lab.diagnostics().pending).toBe(1);
  expect((await f.lab.importNative(batch("other"))).ok).toBe(false);
  expect((await f.lab.stop()).ok).toBe(false);
  expect((await f.lab.stop()).ok).toBe(false);
  expect(f.lab.diagnostics().unresolvedPublication).toEqual(original);
});
it("reentrant governed configuration cannot recurse into additional admission or writes", async () => {
  const f = await setup();
  let nested: Promise<unknown> | undefined;
  const config = await effective();
  const ports = {
    ...f.ports,
    configuration: () => {
      nested = lab.importNative(batch("nested"));
      return config;
    },
  };
  const lab = new BrokerSymbolCatalogue("offline-lab", ports);
  take(await lab.initialize());
  expect(await nested).toMatchObject({ ok: false });
  take(await lab.importNative(batch("original")));
  expect(await nested).toMatchObject({ ok: false });
  expect(take(lab.snapshot())!.catalogues.map((c) => c.batchId)).toEqual(["original"]);
});
it("source verifier reentrant writes are rejected and invalid evidence remains side-effect free", async () => {
  const f = await setup({ ...defaultPolicy, allowedQuality: ["EVIDENCED_RECORDED"] });
  let nested: Promise<unknown> | undefined;
  f.ports.verifySourceEvidence = () => {
    nested = f.lab.importNative(batch("nested"));
    return false;
  };
  const b = batch();
  b.source.quality = "EVIDENCED_RECORDED";
  expect((await f.lab.importNative(b)).ok).toBe(false);
  expect(await nested).toMatchObject({ ok: false });
  expect(take(await f.repository.load())).toHaveLength(0);
  expect(f.lab.diagnostics().recoveryRequired).toBe(false);
});
it("current checker-authority loss fences fresh recovery without erasing acknowledged decisions", async () => {
  const f = await proposed();
  take(
    await f.lab.review(f.p.proposalId, {
      checker,
      state: "APPROVED_FOR_RESEARCH_ASSOCIATION",
      selectedCandidate: f.p.candidateIds[0],
      reason: "Approved research",
    }),
  );
  const before = take(await f.repository.load());
  take(await f.lab.stop());
  const fresh = new BrokerSymbolCatalogue("offline-lab", {
    ...f.ports,
    authorityResolver: {
      resolve: () => {
        throw Error("ROLE_UNAVAILABLE");
      },
    },
  });
  expect((await fresh.initialize()).ok).toBe(false);
  expect(take(await f.repository.load())).toEqual(before);
  expect((await fresh.stop()).ok).toBe(false);
});
it("duplicate rehashed proposal history is rejected despite valid copied candidate evidence", async () => {
  const f = await proposed(),
    rows = take(await f.repository.load()) as Snapshot[],
    last = JSON.parse(JSON.stringify(rows.at(-1))) as Snapshot;
  last.generation = 3;
  last.previous = rows[1]!.fingerprint;
  last.proposals.push(last.proposals[0]!);
  const { fingerprint: _fp, ...body } = last;
  last.fingerprint = fingerprint(body);
  const fresh = new BrokerSymbolCatalogue("offline-lab", {
    ...f.ports,
    repository: {
      load: () => Promise.resolve(ok([...rows, last])),
      commit: () => Promise.resolve(ok(last)),
    },
  });
  expect((await fresh.initialize()).ok).toBe(false);
  expect(fresh.diagnostics().recoveryRequired).toBe(true);
});
