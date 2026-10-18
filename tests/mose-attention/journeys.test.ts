import { beforeAll, it, expect } from "vitest";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MemoryAttentionRepository,
  FilesystemAttentionRepository,
  defaultAttentionPolicy,
  fail,
  fingerprint,
  clone,
} from "@ate/mose-attention";
import { fixture, owners, take, checker, durationMs } from "./fixtures.js";
import { seed } from "../mose-scanner/bar-helper.js";
import { multiOwners } from "./multi-owners.js";
let base: Awaited<ReturnType<typeof owners>>, pair: Awaited<ReturnType<typeof multiOwners>>;
beforeAll(async () => {
  base = await owners();
  pair = await multiOwners();
});
const recommend = async (f: Awaited<ReturnType<typeof fixture>>) => {
  take(await f.assess());
  return take(await f.allocate()).state.recommendations[0]!;
};
it("A01 two genuinely independent eligible instruments receive floor recommendations", async () => {
  const f = await fixture(pair.a, {}, new MemoryAttentionRepository(), pair.b);
  take(await f.assess());
  take(
    await f.runtime.dispatch({
      kind: "ASSESS",
      id: "assess-B",
      subject: f.secondSubject,
      asOf: f.clock.now(),
    }),
  );
  const cp = take(await f.allocate());
  expect(new Set(cp.state.recommendations.map((r) => r.instrumentKey)).size).toBe(2);
  expect(cp.state.floors.every((x) => x.settledBy === null)).toBe(true);
});
it("A02 two genuine newly processed observation epochs escalate exactly one tier", async () => {
  const f = await fixture(base, {}, new MemoryAttentionRepository(), undefined, 1);
  take(await f.assess());
  for (let i = 1; i <= 2; i++) {
    take(f.clock.advanceBy(durationMs(60000)));
    take(await f.scanner.mose.receive(i));
    take(await f.scanner.mose.process());
    take(await f.assess("epoch-" + i));
  }
  expect(take(f.runtime.query()).state.assessments.at(-1)!.reason).not.toBe("SOURCE_UNAVAILABLE");
  expect(take(f.runtime.query()).state.assessments.at(-1)!.tier).toBe("ELEVATED");
});
it("A03 unchanged qualified epochs de-escalate without floor erasure", async () => {
  const f = await fixture(base);
  take(await f.assess());
  take(await f.allocate());
  for (let i = 1; i <= 2; i++) {
    take(f.clock.advanceBy(durationMs(60000)));
    take(await f.assess("stable-" + i));
  }
  expect(take(f.runtime.query()).state.assessments.at(-1)!.reason).not.toBe("SOURCE_UNAVAILABLE");
  expect(take(f.runtime.query()).state.assessments.at(-1)!.tier).toBe("LOW");
  expect(f.runtime.diagnostics().floorDebt).toBe(1);
});
it("A04 repeated observation in same epoch earns no artificial priority", async () => {
  const f = await fixture(base);
  take(await f.assess());
  for (let i = 0; i < 3; i++) take(await f.assess("repeat-" + i));
  expect(
    take(f.runtime.query()).state.assessments.every(
      (a) => a.tier === "STANDARD" && a.changedStreak === 0,
    ),
  ).toBe(true);
});
it("A05 unknown eligibility is not zero or confirmed exclusion", async () => {
  const f = await fixture(base);
  f.ports.eligibility = {
    getEligibility: () => Promise.resolve(fail("RECORD_NOT_FOUND", "UNKNOWN")),
  };
  const cp = take(await f.assess());
  expect(cp.state.assessments[0]!.sufficient).toBe(false);
  expect(f.runtime.diagnostics().eligibleDenominator).toBeNull();
});
it("A06 future state/rank/intelligence owners absent without fabricated states", async () => {
  const f = await fixture(base);
  take(await f.assess());
  expect(take(f.runtime.query()).opportunityState).toBe("UNSUPPORTED");
  expect(f.runtime.help().immutablePlan).toBe(true);
});
it("A07 exact expiry and skipped epochs cannot prolong execution grants", async () => {
  const f = await fixture(base, { submissionEnabled: true, actor: checker.actorId });
  const r = await recommend(f);
  take(f.clock.advanceBy(durationMs(180000)));
  expect(f.runtime.diagnostics().health).toBe("DEGRADED");
  expect(
    (await f.runtime.dispatch({ kind: "SUBMIT", id: "at-expiry", recommendationId: r.id })).ok,
  ).toBe(false);
});
it("A08 attention never mutates installed cadence, priority or plan", async () => {
  const f = await fixture(base),
    before = fingerprint(take(f.scanner.scanner.query()).plan);
  await recommend(f);
  expect(fingerprint(take(f.scanner.scanner.query()).plan)).toBe(before);
  expect(f.scanner.configuredPlan().subscriptions.find((s) => s.id === "periodic")!.cadenceMs).toBe(
    60000,
  );
});
it("A09 allowlisted actor that is not checker cannot submit", async () => {
  const f = await fixture(base, { submissionEnabled: true, actor: "wrong-checker" });
  const r = await recommend(f);
  const before = f.scanner.scanner.coverage().requests;
  expect(
    await f.runtime.dispatch({ kind: "SUBMIT", id: "forged-actor", recommendationId: r.id }),
  ).toMatchObject({ ok: false, error: { code: "ACTOR_UNAUTHORIZED" } });
  expect(f.scanner.scanner.coverage().requests).toBe(before);
});
it("A10 genuine checker rescan receipt and lineage admit exactly one floor", async () => {
  const f = await fixture(base, { submissionEnabled: true, actor: checker.actorId });
  const r = await recommend(f);
  const cp = take(await f.runtime.dispatch({ kind: "SUBMIT", id: "real", recommendationId: r.id })),
    a = cp.state.recommendations[0]!;
  expect(a.status).toBe("ADMITTED");
  expect(cp.state.floors.filter((x) => x.settledBy === a.receiptId)).toHaveLength(1);
  expect(take(f.scanner.scanner.query()).requests.some((q) => q.trigger.id === a.receiptId)).toBe(
    true,
  );
});
it("A11 default-disabled submission never borrows actor authority", async () => {
  const f = await fixture(base),
    r = await recommend(f);
  expect(
    await f.runtime.dispatch({ kind: "SUBMIT", id: "disabled", recommendationId: r.id }),
  ).toMatchObject({ ok: false, error: { code: "SUBMISSION_DISABLED" } });
  expect(f.scanner.scanner.coverage().requests).toBe(0);
});
it("A12 fixed-cutoff lexical-first failure retains debt while a genuine periodic peer is admitted", async () => {
  const f = await fixture(
    pair.a,
    { submissionEnabled: true, actor: checker.actorId },
    new MemoryAttentionRepository(),
    pair.b,
    3,
    { maxCatchup: 1 },
  );
  take(await f.assess());
  take(
    await f.runtime.dispatch({
      kind: "ASSESS",
      id: "peer",
      subject: { ...f.secondSubject, subscriptions: ["periodic-B"] },
      asOf: f.clock.now(),
    }),
  );
  const allocated = take(await f.allocate());
  const peer = allocated.state.recommendations.find((r) => r.subscriptionId === "periodic-B")!;
  expect(peer).toBeDefined();
  const repository = f.scanner.repository;
  f.scanner.ports.repository = {
    load: () => repository.load(),
    commit: async (cp) =>
      cp.state.requests.some((r) => r.trigger.subscriptionId === "periodic")
        ? fail("LEXICAL_FIRST_WRITE_REFUSED")
        : repository.commit(cp),
  };
  const failed = take(await f.scanner.scanner.advance());
  expect(failed.remainingNotProcessed).toBe(true);
  expect(f.scanner.scanner.coverage().requests).toBe(0);
  const accepted = take(
    await f.runtime.dispatch({ kind: "SUBMIT", id: "peer-submit", recommendationId: peer.id }),
  );
  expect(accepted.state.recommendations.find((r) => r.id === peer.id)!.status).toBe("ADMITTED");
  expect(accepted.state.floors.filter((d) => d.settledBy !== null)).toHaveLength(1);
  expect(f.runtime.diagnostics().floorDebt).toBe(1);
  f.captureEvidence({ kind: "P26_LEXICAL_FIRST_FAILURE_PEER_ADMISSION", failed, peer, accepted });
});
it("A13 moving logical time does not hide accepted scanner debt", async () => {
  const f = await fixture(base, {}, new MemoryAttentionRepository(), undefined, 3, {
    maxCatchup: 1,
  });
  await recommend(f);
  take(await f.scanner.scanner.advance());
  take(f.clock.advanceBy(durationMs(120000)));
  const batch = take(await f.scanner.scanner.advance());
  expect(batch.remainingNotProcessed).toBe(true);
  expect(f.scanner.scanner.coverage().unrepresentedCadenceDue).toBe(1);
  expect(f.runtime.diagnostics().floorDebt).toBe(1);
  expect(f.runtime.diagnostics().coverageComplete).toBe(false);
  expect(f.runtime.help().qualifications).toContain("A26-Q01 OPEN");
  f.captureEvidence({
    kind: "P26_BOUNDED_CONTINUATION",
    batch,
    coverage: f.scanner.scanner.coverage(),
  });
});
it("A14 infeasible floor budget preserves debt and rotates across restart", async () => {
  const f = await fixture(
    pair.a,
    { maxProposalsPerEpoch: 1 },
    new MemoryAttentionRepository(),
    pair.b,
  );
  take(await f.assess());
  take(
    await f.runtime.dispatch({
      kind: "ASSESS",
      id: "B",
      subject: f.secondSubject,
      asOf: f.clock.now(),
    }),
  );
  const cp = take(await f.allocate("one", 1));
  expect(cp.state.recommendations).toHaveLength(1);
  expect(cp.state.floors).toHaveLength(2);
  const next = await f.restart();
  expect(next.diagnostics().floorDebt).toBe(2);
});
it("A15 new command IDs cannot reset epoch quota after restart", async () => {
  const f = await fixture(base);
  await recommend(f);
  const next = await f.restart();
  const cp = take(
    await next.dispatch({ kind: "ALLOCATE", id: "again-new-id", asOf: f.clock.now(), limit: 32 }),
  );
  expect(cp.state.ledgers[0]!.spent).toBe(1);
  expect(cp.state.recommendations).toHaveLength(1);
});
it("A16 upstream receipt survives failed local outcome and fresh reconciliation", async () => {
  const f = await fixture(base, { submissionEnabled: true, actor: checker.actorId }),
    r = await recommend(f),
    repo = f.repository;
  f.ports.repository = {
    load: () => repo.load(),
    commit: (cp) =>
      cp.command.id.endsWith(".outcome") ? Promise.resolve(fail("WRITE_FAILED")) : repo.commit(cp),
  };
  expect(
    (await f.runtime.dispatch({ kind: "SUBMIT", id: "partial", recommendationId: r.id })).ok,
  ).toBe(false);
  expect(f.runtime.diagnostics().pendingSubmissions).toBe(1);
  f.ports.repository = repo;
  const next = await f.restart();
  take(await next.dispatch({ kind: "RECONCILE", id: "recover", recommendationId: r.id }));
  expect(next.diagnostics().settledFloors).toBe(1);
});
it("A17 lost own ACK retains exact body until authenticated readback", async () => {
  const repo = new MemoryAttentionRepository(),
    f = await fixture(base, {}, repo);
  f.ports.repository = {
    load: () => repo.load(),
    commit: async (cp) => {
      take(await repo.commit(cp));
      return fail("LOST_ACK", "UNKNOWN");
    },
  };
  const before = take(await repo.load()).length;
  expect((await f.assess()).ok).toBe(false);
  const physical = take(await repo.load());
  expect(physical.length).toBe(before + 1);
  expect((await f.runtime.stop()).ok).toBe(false);
  const ack = take(await f.runtime.reconcilePublication());
  expect(ack.fingerprint).toBe((physical.at(-1) as { fingerprint: string }).fingerprint);
});
it("A18 request enumeration ignores null work cursor and finds original third receipt", async () => {
  const f = await fixture(base, {
      submissionEnabled: true,
      actor: checker.actorId,
      maxQueryResults: 2,
    }),
    r = await recommend(f),
    repo = f.repository;
  for (let i = 0; i < 2; i++) {
    const preview = take(f.scanner.scanner.preview("rescan", f.clock.now()));
    take(
      await f.scanner.scanner.request({
        id: "other-" + i,
        subscriptionId: "rescan",
        boundary: f.clock.now(),
        kind: "RESEARCH_RESCAN",
        actor: checker.actorId,
        cause: preview.cause,
        evidence: preview.evidence,
      }),
    );
  }
  f.ports.repository = {
    load: () => repo.load(),
    commit: (cp) =>
      cp.command.id.endsWith(".outcome") ? Promise.resolve(fail("NO")) : repo.commit(cp),
  };
  expect(
    (await f.runtime.dispatch({ kind: "SUBMIT", id: "third", recommendationId: r.id })).ok,
  ).toBe(false);
  f.ports.repository = repo;
  const next = await f.restart();
  take(await next.dispatch({ kind: "RECONCILE", id: "third-recovery", recommendationId: r.id }));
  expect(next.diagnostics().pendingSubmissions).toBe(0);
  expect(f.scanner.scanner.coverage().requests).toBe(3);
});
it("A19 missing read barrier refuses complete floor and authoritative absence", async () => {
  const f = await fixture(base);
  delete f.ports.readBarrier;
  take(await f.assess());
  const cp = take(await f.allocate());
  expect(cp.state.ledgers[0]!.consistency).toBe("CONSISTENCY_UNESTABLISHED");
  expect(cp.state.recommendations).toEqual([]);
  expect(f.runtime.diagnostics().coverageComplete).toBe(false);
});
it("A20 future-time intelligence cannot enter earlier attention lineage", async () => {
  const f = await fixture(base);
  const first = take(await f.assess());
  const before = fingerprint(first.state.assessments[0]);
  const earlier = f.clock.now(),
    bars = await seed(f.scanner);
  take(f.clock.advanceBy(durationMs(1000)));
  const revision = bars.publish("H4"),
    snapshot = take(bars.inspect("H4"));
  const selected = Object.values(snapshot.selected).find((r) => r.revisionId === revision);
  expect(selected).toBeDefined();
  expect(selected!.availableAt > earlier).toBe(true);
  expect(
    (
      await f.runtime.dispatch({
        kind: "ASSESS",
        id: "future-h4-input",
        subject: f.subject,
        asOf: earlier,
        higherTimeframeEvidence: snapshot,
      })
    ).ok,
  ).toBe(false);
  f.captureEvidence({ kind: "P18_FUTURE_H4", earlier, revision, snapshot });
  const future = new Date(Date.parse(f.clock.now()) + 4 * 3600000).toISOString();
  expect(
    (
      await f.runtime.dispatch({
        kind: "ASSESS",
        id: "future-H4",
        subject: f.subject,
        asOf: future,
      })
    ).ok,
  ).toBe(false);
  expect(fingerprint(take(f.runtime.query()).state.assessments[0])).toBe(before);
  expect(first.state.assessments[0]!.evidence!.eventAt <= first.at).toBe(true);
});
it("A21 source outage/restoration preserves historical tier without current grant", async () => {
  const f = await fixture(base);
  take(await f.assess());
  const original = f.ports.replayEvidence;
  f.ports.replayEvidence = () => undefined;
  const bad = take(await f.assess("offline"));
  expect(bad.state.assessments.at(-1)!.sufficient).toBe(false);
  expect(bad.state.assessments[0]!.sufficient).toBe(true);
  f.ports.replayEvidence = original;
  expect(take(await f.assess("restored")).state.assessments.at(-1)!.sufficient).toBe(true);
});
it("A22 history one-over refuses new work without dropping physical evidence", async () => {
  const f = await fixture(base, { maxHistory: 2 });
  take(await f.assess());
  expect((await f.allocate()).ok).toBe(false);
  expect(take(f.runtime.query()).total).toBe(2);
});
it("A23 reentrant shutdown during acknowledged publication cannot report false success", async () => {
  const f = await fixture(base),
    repo = f.repository;
  let stopped: unknown;
  f.ports.repository = {
    load: () => repo.load(),
    commit: async (cp) => {
      stopped = await f.runtime.stop();
      return repo.commit(cp);
    },
  };
  take(await f.assess());
  expect(stopped).toMatchObject({ ok: false, error: { commitment: "UNKNOWN" } });
  expect((await f.runtime.stop()).ok).toBe(true);
});
it("A24 filesystem replay and repeated recovery preserve exact physical generations", async () => {
  const root = mkdtempSync(join(tmpdir(), "attention-replay-")),
    repo = new FilesystemAttentionRepository(root, defaultAttentionPolicy),
    f = await fixture(base, {}, repo);
  await recommend(f);
  const before = Object.fromEntries(
    readdirSync(root).map((n) => [n, readFileSync(join(root, n), "utf8")]),
  );
  const a = await f.restart(),
    b = await f.restart();
  expect(fingerprint(take(a.query()).state)).toBe(fingerprint(take(b.query()).state));
  expect(
    Object.fromEntries(readdirSync(root).map((n) => [n, readFileSync(join(root, n), "utf8")])),
  ).toEqual(before);
  expect(clone(take(a.query()).state).floors).toHaveLength(1);
});
it("selected healthy source remains distinct from a genuinely unavailable peer", async () => {
  pair.faults.qualityUnavailable = false;
  const f = await fixture(pair.a, {}, new MemoryAttentionRepository(), pair.b);
  pair.faults.qualityUnavailable = true;
  try {
    const a = take(await f.assess()).state.assessments.at(-1)!;
    expect(a.sufficient).toBe(true);
    expect(a.evidence).toMatchObject({ ownerHealth: "DEGRADED", sourceScopeHealthy: true });
    expect(take(await f.runtime.health()).health).toBe("DEGRADED");
    const b = take(
      await f.runtime.dispatch({
        kind: "ASSESS",
        id: "peer-unavailable",
        subject: f.secondSubject,
        asOf: f.clock.now(),
      }),
    );
    expect(b.state.assessments.at(-1)!.sufficient).toBe(false);
  } finally {
    pair.faults.qualityUnavailable = false;
  }
});
