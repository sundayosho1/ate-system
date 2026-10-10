import { it, expect } from "vitest";
import {
  associateCatalogueResearchEvidence,
  BrokerSymbolCatalogue,
  type Snapshot,
  type Repository,
  ok,
} from "@ate/broker-symbol-catalogue";
import { fingerprint } from "@ate/configuration";
import { setup, registered, batch, take, maker, checker, equity, evidence } from "./fixtures.js";
const request = (catalogueFingerprint: string) => ({
  catalogueFingerprint,
  rawSymbol: "SYN.A",
  selector: { kind: "IDENTIFIER", index: 0 },
  maker,
  reason: "Offline scoped identity claim",
});
async function proposal() {
  const f = await registered(),
    b = batch();
  b.records[0]!.identifiers = [
    { scheme: "RESEARCH", scope: "synthetic-broker", authority: "fixture", value: "economic-A" },
  ];
  const c = take(await f.lab.importNative(b)),
    p = take(await f.lab.propose(request(c.fingerprint)));
  return { ...f, c, p };
}
it("derives genuine P20 candidate evidence and stores maker without creating identity", async () => {
  const { lab, canonical, p } = await proposal();
  expect(p.outcome).toBe("UNIQUE_CANDIDATE");
  expect(p.evidenceClass).toBe("SCOPED_IDENTIFIER");
  expect(p.initialState).toBe("PROPOSED");
  expect(p.registrySnapshot).toBe(take(canonical.registry.snapshot())!.fingerprint);
  expect(p.resolution).toEqual(take(canonical.registry.resolve(p.query)));
  expect(take(lab.mapping(p.proposalId)).state).toBe("PROPOSED");
  expect(take(canonical.registry.snapshot())!.generation).toBe(1);
});
it("checker approves immutable research-only association, then fresh recovery preserves decisions", async () => {
  const f = await proposal();
  const d = take(
    await f.lab.review(f.p.proposalId, {
      checker,
      state: "APPROVED_FOR_RESEARCH_ASSOCIATION",
      selectedCandidate: f.p.candidateIds[0],
      reason: "Scoped synthetic research evidence",
    }),
  );
  expect(d.sequence).toBe(1);
  expect(take(f.lab.mapping(f.p.proposalId)).state).toBe("APPROVED_FOR_RESEARCH_ASSOCIATION");
  take(await f.lab.stop());
  const fresh = new BrokerSymbolCatalogue("offline-lab", f.ports);
  take(await fresh.initialize());
  expect(take(fresh.mapping(f.p.proposalId)).decisions).toEqual([d]);
});
it("same maker cannot approve; unauthorized checker cannot transition", async () => {
  const { lab, p } = await proposal();
  for (const who of [maker, { ...checker, actorId: "unprivileged" }])
    expect(
      (
        await lab.review(p.proposalId, {
          checker: who,
          state: "APPROVED_FOR_RESEARCH_ASSOCIATION",
          selectedCandidate: p.candidateIds[0],
          reason: "Attempt",
        })
      ).ok,
    ).toBe(false);
  expect(take(lab.mapping(p.proposalId)).decisions).toHaveLength(0);
});
it("key or suffix matching is lookup evidence only even with an authorized checker", async () => {
  const f = await setup(),
    d = equity();
  d.aliases = [
    {
      value: "SYN.A",
      scope: "synthetic-broker",
      kind: "BROKER",
      rule: "EXACT",
      evidence: evidence(),
    },
  ];
  take(await f.canonical.registry.register(d));
  const c = take(await f.lab.importNative(batch()));
  const p = take(
    await f.lab.propose({
      ...request(c.fingerprint),
      selector: { kind: "NORMALIZED_KEY", ruleId: "exact", aliasKind: "BROKER" },
    }),
  );
  expect(p.outcome).toBe("UNIQUE_CANDIDATE");
  expect(p.initialState).toBe("NEEDS_REVIEW");
  expect(
    (
      await f.lab.review(p.proposalId, {
        checker,
        state: "APPROVED_FOR_RESEARCH_ASSOCIATION",
        selectedCandidate: p.candidateIds[0],
        reason: "Name-only attempt",
      })
    ).ok,
  ).toBe(false);
});
it("ambiguous canonical identifiers retain all candidates and block approval", async () => {
  const f = await proposal(),
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
  const p = take(await f.lab.propose(request(f.c.fingerprint)));
  expect(p.outcome).toBe("MULTIPLE_CANDIDATES");
  expect(p.candidateIds).toHaveLength(2);
  expect(
    (
      await f.lab.review(p.proposalId, {
        checker,
        state: "APPROVED_FOR_RESEARCH_ASSOCIATION",
        selectedCandidate: p.candidateIds[0],
        reason: "Ambiguous attempt",
      })
    ).ok,
  ).toBe(false);
});
it("unsupported claim and no-match remain unresolved without synthetic canonical IDs", async () => {
  const f = await registered(),
    b = batch();
  b.records[0]!.identifiers = [
    { scheme: "RESEARCH", scope: "synthetic-broker", value: "unmatched" },
  ];
  const c = take(await f.lab.importNative(b)),
    p = take(await f.lab.propose(request(c.fingerprint)));
  expect(p.outcome).toBe("NO_CANDIDATE");
  expect(p.candidateIds).toHaveLength(0);
  expect(take(f.lab.query({ kind: "UNRESOLVED", offset: 0, limit: 10 })).total).toBe(1);
});
it("contradictory declared classification remains observed but blocks mapping", async () => {
  const f = await registered(),
    b = batch();
  b.records[0]!.identifiers = [
    { scheme: "RESEARCH", scope: "synthetic-broker", value: "economic-A" },
  ];
  b.records[0]!.declaredFamily = "INDEX";
  const c = take(await f.lab.importNative(b)),
    p = take(await f.lab.propose(request(c.fingerprint)));
  expect(p.outcome).toBe("MAPPING_CONFLICT");
  expect(p.contradictions).toContain("FAMILY_CONFLICT");
  expect(
    (
      await f.lab.review(p.proposalId, {
        checker,
        state: "APPROVED_FOR_RESEARCH_ASSOCIATION",
        selectedCandidate: p.candidateIds[0],
        reason: "Contradiction attempt",
      })
    ).ok,
  ).toBe(false);
});
it("new catalogue and registry revisions stale old evidence without rewriting proposal", async () => {
  const f = await proposal();
  take(await f.lab.importNative(batch("new")));
  const state = take(f.lab.mapping(f.p.proposalId));
  expect(state.state).toBe("EXPIRED_OR_STALE");
  expect(state.staleReasons).toContain("CATALOGUE_SUPERSEDED");
  expect(state.proposal).toEqual(f.p);
  expect(
    (
      await f.lab.review(f.p.proposalId, {
        checker,
        state: "APPROVED_FOR_RESEARCH_ASSOCIATION",
        selectedCandidate: f.p.candidateIds[0],
        reason: "Stale attempt",
      })
    ).ok,
  ).toBe(false);
});
it("registry evolution fences approval but retained evidence recovers through P20 historical view", async () => {
  const f = await proposal();
  take(await f.canonical.registry.register(equity("new")));
  expect(take(f.lab.mapping(f.p.proposalId)).staleReasons).toContain("REGISTRY_CONTEXT_CHANGED");
  take(await f.lab.stop());
  const fresh = new BrokerSymbolCatalogue("offline-lab", f.ports);
  take(await fresh.initialize());
  expect(take(fresh.mapping(f.p.proposalId)).proposal).toEqual(f.p);
});
it("immutable rejection cannot be revived and unrelated supersession is prohibited", async () => {
  const f = await proposal();
  expect(
    (
      await f.lab.review(f.p.proposalId, {
        checker,
        state: "SUPERSEDED",
        supersededBy: "0".repeat(64),
        reason: "Invalid replacement",
      })
    ).ok,
  ).toBe(false);
  take(
    await f.lab.review(f.p.proposalId, {
      checker,
      state: "REJECTED",
      reason: "Insufficient research evidence",
    }),
  );
  expect(
    (await f.lab.review(f.p.proposalId, { checker, state: "NEEDS_REVIEW", reason: "Revive" })).ok,
  ).toBe(false);
});
it("self-consistently rehashed candidate substitution still fails owner reconstruction", async () => {
  const f = await proposal();
  const rows = take(await f.repository.load()) as Snapshot[];
  const s = JSON.parse(JSON.stringify(rows.at(-1))) as Snapshot;
  s.proposals[0]!.candidateIds = ["0".repeat(64)];
  const { proposalId: _id, ...pc } = s.proposals[0]!;
  s.proposals[0]!.proposalId = fingerprint(pc);
  const { fingerprint: _fp, ...sc } = s;
  s.fingerprint = fingerprint(sc);
  const repository: Repository = {
    load: () => Promise.resolve(ok([rows[0], s])),
    commit: () => Promise.resolve(ok(s)),
  };
  const fresh = new BrokerSymbolCatalogue("offline-lab", { ...f.ports, repository });
  expect((await fresh.initialize()).ok).toBe(false);
  expect(fresh.diagnostics().recoveryRequired).toBe(true);
});

it.each(["baseCurrency", "quoteCurrency"] as const)(
  "actual P20 FX %s contradiction blocks an otherwise unique scoped association",
  async (field) => {
    const f = await setup(),
      d = equity();
    d.identity = { family: "FX", kind: "SPOT", base: "EUR", quote: "USD", settlement: "SPOT" };
    d.classification = "FX";
    d.identifiers = [
      {
        scheme: "RESEARCH",
        scope: "synthetic-broker",
        authority: "fixture",
        value: "fx-economic",
        evidence: evidence(),
      },
    ];
    take(await f.canonical.registry.register(d));
    const b = batch();
    b.records[0]!.identifiers = [
      { scheme: "RESEARCH", scope: "synthetic-broker", value: "fx-economic" },
    ];
    b.records[0]![field] = "GBP";
    const c = take(await f.lab.importNative(b)),
      p = take(await f.lab.propose(request(c.fingerprint)));
    expect(p.candidateIds).toHaveLength(1);
    expect(p.contradictions).toContain("CURRENCY_CONFLICT");
    expect(p.outcome).toBe("MAPPING_CONFLICT");
    expect(
      (
        await f.lab.review(p.proposalId, {
          checker,
          state: "APPROVED_FOR_RESEARCH_ASSOCIATION",
          selectedCandidate: p.candidateIds[0],
          reason: "Contradictory currency",
        })
      ).ok,
    ).toBe(false);
    expect(take(f.lab.mapping(p.proposalId)).decisions).toHaveLength(0);
  },
);
it("venue contradiction cannot override the accepted economic discriminators", async () => {
  const f = await registered(),
    b = batch();
  b.records[0]!.identifiers = [
    { scheme: "RESEARCH", scope: "synthetic-broker", value: "economic-A" },
  ];
  b.records[0]!.venue = "OTHER";
  const c = take(await f.lab.importNative(b)),
    p = take(await f.lab.propose(request(c.fingerprint)));
  expect(p.contradictions).toContain("VENUE_CONFLICT");
  expect(p.outcome).toBe("MAPPING_CONFLICT");
});

it("research reference binds the exact proposal candidate revision rather than the first historical revision", async () => {
  const f = await registered(),
    old = take(f.canonical.registry.search())[0]!,
    next = take(
      await f.canonical.registry.revise(
        old.instrumentId,
        old.revisionId,
        { ...old.definition, displayName: "Revised synthetic display" },
        "Explicit synthetic metadata revision",
      ),
    );
  const b = batch();
  b.records[0]!.identifiers = [
    { scheme: "RESEARCH", scope: "synthetic-broker", value: "economic-A" },
  ];
  const c = take(await f.lab.importNative(b)),
    p = take(await f.lab.propose(request(c.fingerprint)));
  take(
    await f.lab.review(p.proposalId, {
      checker,
      state: "APPROVED_FOR_RESEARCH_ASSOCIATION",
      selectedCandidate: p.candidateIds[0],
      reason: "Latest qualified research revision",
    }),
  );
  const result = take(
    associateCatalogueResearchEvidence(f.lab, f.canonical.registry, {
      proposalId: p.proposalId,
      owner: "DATASET_CATALOGUE",
      ownerReference: "research-owner",
      ownerFingerprint: fingerprint("owner"),
    }),
  );
  expect(result.reference.revisionId).toBe(next.revisionId);
  expect(result.reference.revisionId).not.toBe(old.revisionId);
});
