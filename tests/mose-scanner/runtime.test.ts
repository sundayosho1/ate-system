import { beforeAll, it, expect } from "vitest";
import { durationMs } from "@ate/time";
import {
  MultiSpeedScannerRuntime,
  failure,
  fingerprint,
  type ScanCheckpointRepository,
  type ScannerCheckpoint,
} from "@ate/mose-scanner";
import { fixture, owners, take, config } from "./fixtures.js";
let base: Awaited<ReturnType<typeof owners>>;
beforeAll(async () => {
  base = await owners();
});
async function running() {
  const f = await fixture(base);
  await f.plan();
  take(await f.start());
  return f;
}
it("duplicate request preserves original immutable receipt", async () => {
  const f = await running(),
    t = f.trigger(),
    a = take(await f.scanner.request(t)),
    b = take(await f.scanner.request(t));
  expect(b).toEqual(a);
  expect(f.scanner.coverage().requests).toBe(1);
});
it("same request identity cannot replace evidence", async () => {
  const f = await running(),
    t = f.trigger();
  take(await f.scanner.request(t));
  expect((await f.scanner.request({ ...t, evidence: fingerprint("other") })).ok).toBe(false);
});
it("request before START cannot create work", async () => {
  const f = await fixture(base);
  await f.plan();
  expect((await f.scanner.request(f.trigger())).ok).toBe(false);
  expect(f.scanner.coverage().uniqueObligations).toBe(0);
});
it("request while PAUSED cannot create work", async () => {
  const f = await running();
  take(await f.scanner.transition("pause", "PAUSE"));
  expect((await f.scanner.request(f.trigger())).ok).toBe(false);
});
it("pause retains exact pending work", async () => {
  const f = await running();
  take(await f.scanner.request(f.trigger()));
  const before = take(f.scanner.query()).work;
  take(await f.scanner.transition("pause", "PAUSE"));
  expect(take(f.scanner.query()).work).toEqual(before);
});
it("resume executes retained work", async () => {
  const f = await running();
  take(await f.scanner.request(f.trigger()));
  take(await f.scanner.transition("pause", "PAUSE"));
  take(await f.scanner.transition("resume", "RESUME"));
  expect(take(await f.scanner.dispatch("execute", 1))[0]!.status).toBe("COMPLETED");
});
it("paused dispatch cannot acknowledge work", async () => {
  const f = await running();
  take(await f.scanner.request(f.trigger()));
  take(await f.scanner.transition("pause", "PAUSE"));
  expect((await f.scanner.dispatch("execute", 1)).ok).toBe(false);
  expect(f.scanner.coverage().completed).toBe(0);
});
it("stop refuses pending obligations and fences admission", async () => {
  const f = await running();
  take(await f.scanner.request(f.trigger()));
  expect((await f.scanner.stop()).ok).toBe(false);
  expect((await f.scanner.request({ ...f.trigger(), id: "later" })).ok).toBe(false);
});
it("stop fence permits retained drain then repeatable shutdown", async () => {
  const f = await running();
  take(await f.scanner.request(f.trigger()));
  expect((await f.scanner.stop()).ok).toBe(false);
  expect(take(await f.scanner.dispatch("drain", 1))[0]!.status).toBe("COMPLETED");
  take(await f.scanner.stop());
  take(await f.scanner.stop());
});
it("stopped instance rejects queries and new plan", async () => {
  const f = await fixture(base);
  take(await f.scanner.stop());
  expect(f.scanner.query().ok).toBe(false);
  expect((await f.scanner.createPlan("x", {})).ok).toBe(false);
});
it("future boundary cannot become due", async () => {
  const f = await running();
  expect(
    (await f.scanner.request({ ...f.trigger(), boundary: "2099-01-01T00:00:00.000Z" })).ok,
  ).toBe(false);
});
it("incorrect source evidence is refused without obligations", async () => {
  const f = await running();
  expect((await f.scanner.request({ ...f.trigger(), evidence: fingerprint("forged") })).ok).toBe(
    false,
  );
  expect(f.scanner.coverage().uniqueObligations).toBe(0);
});
it("incorrect event identity is refused", async () => {
  const f = await running();
  expect((await f.scanner.request({ ...f.trigger(), cause: "missing" })).ok).toBe(false);
});
it("cross-mode event trigger rejected", async () => {
  const f = await running();
  expect((await f.scanner.request({ ...f.trigger(), kind: "DEADLINE" })).ok).toBe(false);
});
it("undeclared subscription rejected", async () => {
  const f = await running();
  expect((await f.scanner.request({ ...f.trigger(), subscriptionId: "missing" })).ok).toBe(false);
});
it("deferred queue is NOT_READY and DEGRADED", async () => {
  const f = await running();
  take(await f.scanner.request(f.trigger()));
  expect(f.scanner.diagnostics()).toMatchObject({
    readiness: "NOT_READY",
    health: "DEGRADED",
    pending: 1,
  });
});
it("queue exact limit admits and one-over returns explicit rejection", async () => {
  const f = await fixture(base, { maxQueue: 1 });
  await f.plan();
  take(await f.start());
  take(await f.scanner.request(f.trigger(0)));
  const next = await f.scanner.request(f.trigger(1));
  expect(next.ok).toBe(false);
  expect(f.scanner.coverage().pending).toBe(1);
});
it("completed current evidence avoids recomputation at later cadence", async () => {
  const f = await fixture(base);
  await f.plan([f.subscription({ mode: "SECONDS", cadenceMs: 1 })]);
  take(await f.start());
  for (let i = 0; i < f.universe.plan.length; i++) take(await f.mose.receive(i));
  take(await f.mose.process());
  const t = f.trigger(0, "ticks", "DEADLINE");
  take(await f.scanner.request(t));
  take(await f.scanner.dispatch("execute", 1));
  take(f.clock.advanceBy(durationMs(1)));
  const q = take(await f.scanner.request({ ...t, id: "again", boundary: f.clock.now() }));
  expect(q.reason).toBe("UNCHANGED_DEPENDENCIES");
  expect(f.scanner.coverage()).toMatchObject({ completed: 1, admittedObservations: 1, skipped: 1 });
});
it("changed accepted event creates a distinct obligation", async () => {
  const f = await running();
  take(await f.scanner.request(f.trigger(0)));
  take(await f.scanner.dispatch("first", 1));
  const q = take(await f.scanner.request(f.trigger(1)));
  expect(q.disposition).toBe("DUE");
  expect(f.scanner.coverage().uniqueObligations).toBe(2);
});
it("whole-universe observation sequence remains canonical", async () => {
  const f = await running();
  take(await f.scanner.request(f.trigger(1)));
  const q = take(await f.scanner.dispatch("out-of-order", 1));
  expect(q[0]!.reason).toBe("CANONICAL_PREDECESSOR_PENDING");
  expect(f.scanner.coverage().admittedObservations).toBe(0);
});
it("query pagination cannot mutate retained work", async () => {
  const f = await running();
  take(await f.scanner.request(f.trigger()));
  const q = take(f.scanner.query());
  expect(Object.isFrozen(q.work[0])).toBe(true);
  expect(q.historicalFactsNotCurrentAuthority).toBe(true);
});
for (const [offset, limit] of [
  [-1, 1],
  [0, 0],
  [0, 101],
  [0, 1.5],
  [NaN, 1],
] as const)
  it(`pagination rejects ${offset}/${limit}`, async () => {
    const f = await running();
    expect(f.scanner.query(offset, limit).ok).toBe(false);
  });
for (const limit of [0, -1, 1.5, 17, NaN])
  it(`dispatch bounds reject ${limit}`, async () => {
    const f = await running();
    expect((await f.scanner.dispatch("batch", limit)).ok).toBe(false);
  });
it("governed config replacement cannot mutate immutable plan", async () => {
  const f = await running(),
    trigger = f.trigger();
  f.setConfiguration(
    await config(f.clock, { ...f.policy, version: "changed" }, f.configuredPlan()),
  );
  expect((await f.scanner.request(trigger)).ok).toBe(false);
});
it("NULL owner health is structured deferred work", async () => {
  const f = await running();
  take(await f.scanner.request(f.trigger()));
  f.ports.mose = {
    ...f.ports.mose,
    getUniverse: f.mose.service.getUniverse.bind(f.mose.service),
    getSessionSummary: f.mose.service.getSessionSummary.bind(f.mose.service),
    query: f.mose.service.query.bind(f.mose.service),
    dispatch: f.mose.service.dispatch.bind(f.mose.service),
    health: () => Promise.resolve(null as never),
  };
  expect(take(await f.scanner.dispatch("broken-owner", 1))[0]!.status).toBe("DEFERRED");
});
it("owner exception cannot manufacture completion", async () => {
  const f = await running();
  take(await f.scanner.request(f.trigger()));
  f.ports.mose.health = async () => {
    await Promise.resolve();
    throw Error("offline");
  };
  expect(take(await f.scanner.dispatch("offline", 1))[0]!.status).toBe("DEFERRED");
  expect(f.scanner.coverage().completed).toBe(0);
});
it("fresh recovery preserves due work and invalidates cache authority", async () => {
  const f = await running();
  take(await f.scanner.request(f.trigger()));
  const fresh = new MultiSpeedScannerRuntime(f.ports);
  take(await fresh.initialize());
  expect(fresh.coverage()).toMatchObject({ pending: 1, completed: 0 });
  expect(fresh.diagnostics().recoveredCacheNotAuthoritative).toBe(true);
});
it("fresh recovery authenticates completed owner evidence", async () => {
  const f = await running();
  take(await f.scanner.request(f.trigger()));
  take(await f.scanner.dispatch("execute", 1));
  const fresh = new MultiSpeedScannerRuntime(f.ports);
  take(await fresh.initialize());
  expect(fresh.coverage().admittedObservations).toBe(1);
});
it("fresh recovery refuses nonexistent owner observation", async () => {
  const f = await running();
  take(await f.scanner.request(f.trigger()));
  take(await f.scanner.dispatch("execute", 1));
  f.ports.mose.query = () => ({
    ok: false,
    error: { code: "SOURCE_UNAVAILABLE", commitment: "NONE", auditCorrelationId: "audit" },
  });
  expect((await new MultiSpeedScannerRuntime(f.ports).initialize()).ok).toBe(false);
});
it("failed initialization cannot be used for admission", async () => {
  const f = await running();
  const service = new MultiSpeedScannerRuntime({
    ...f.ports,
    repository: {
      load: () => Promise.resolve(failure("LOAD_FAILED")),
      commit: () => Promise.resolve(failure("WRITE_FAILED")),
    },
  });
  expect((await service.initialize()).ok).toBe(false);
  expect((await service.request(f.trigger())).ok).toBe(false);
});
it("reentrant repository callback cannot admit phantom work", async () => {
  const f = await running(),
    repo = f.repository,
    trigger = f.trigger();
  let reentrant: unknown;
  f.ports.repository = {
    load: () => repo.load(),
    commit: async (c) => {
      await Promise.resolve();
      reentrant = await f.scanner.request({ ...trigger, id: "reentrant" });
      return repo.commit(c);
    },
  };
  take(await f.scanner.request(f.trigger()));
  expect(reentrant).toMatchObject({ ok: false });
  expect(f.scanner.coverage().requests).toBe(1);
});
for (const outcome of ["NONE", "UNKNOWN", "THROW", "WRONG_ACK"] as const)
  it(`repository ${outcome} cannot create phantom due work`, async () => {
    const f = await running();
    f.ports.repository = {
      load: () => f.repository.load(),
      commit: async (c) => {
        await Promise.resolve();
        if (outcome === "THROW") throw Error("disk");
        if (outcome === "WRONG_ACK")
          return { ok: true, value: { ...c, fingerprint: fingerprint("wrong") } };
        return failure("DISK", outcome);
      },
    };
    expect((await f.scanner.request(f.trigger())).ok).toBe(false);
    expect(f.scanner.coverage().uniqueObligations).toBe(0);
    if (outcome !== "NONE") expect((await f.scanner.stop()).ok).toBe(false);
  });
it("physical sequence corruption rejects recovery", async () => {
  const f = await running();
  const loaded = take(await f.repository.load()) as readonly ScannerCheckpoint[];
  const corrupt = structuredClone(loaded);
  corrupt[0]!.generation = 9;
  const { fingerprint: _fp, ...body } = corrupt[0]!;
  corrupt[0]!.fingerprint = fingerprint(body);
  const repo: ScanCheckpointRepository = {
    load: () => Promise.resolve({ ok: true, value: corrupt }),
    commit: () => Promise.resolve(failure("NO_WRITE")),
  };
  expect(
    (await new MultiSpeedScannerRuntime({ ...f.ports, repository: repo }).initialize()).ok,
  ).toBe(false);
});
it("physical impossible phase with valid digest rejects recovery", async () => {
  const f = await running();
  const records = structuredClone(take(await f.repository.load())) as ScannerCheckpoint[];
  records[0]!.state.phase = "RUNNING";
  const { fingerprint: _fp, ...body } = records[0]!;
  records[0]!.fingerprint = fingerprint(body);
  expect(
    (
      await new MultiSpeedScannerRuntime({
        ...f.ports,
        repository: {
          load: () => Promise.resolve({ ok: true, value: records }),
          commit: () => Promise.resolve(failure("NO_WRITE")),
        },
      }).initialize()
    ).ok,
  ).toBe(false);
});
it("seconds anchor inclusive boundary creates one due work", async () => {
  const f = await fixture(base);
  await f.plan([f.subscription({ id: "seconds", mode: "SECONDS", cadenceMs: 5000 })]);
  take(await f.start());
  const out = take(await f.scanner.advance());
  expect(out.results).toHaveLength(1);
  expect(f.scanner.coverage().pending).toBe(1);
});
it("seconds same boundary cannot duplicate scheduled request", async () => {
  const f = await fixture(base);
  await f.plan([f.subscription({ mode: "SECONDS", cadenceMs: 5000 })]);
  take(await f.start());
  take(await f.scanner.advance());
  expect(take(await f.scanner.advance()).results).toHaveLength(0);
});
it("seconds catchup stops at governed budget with explicit remainder", async () => {
  const f = await fixture(base, { maxCatchup: 1 });
  await f.plan([f.subscription({ mode: "SECONDS", cadenceMs: 5000 })]);
  take(await f.start());
  take(f.clock.advanceBy(durationMs(20000)));
  expect(take(await f.scanner.advance()).remainingNotProcessed).toBe(true);
});
it("seconds off-grid wakeup is NOT_DUE", async () => {
  const f = await fixture(base);
  await f.plan([f.subscription({ mode: "SECONDS", cadenceMs: 5000 })]);
  take(await f.start());
  take(f.clock.advanceBy(durationMs(1)));
  const p = take(f.scanner.preview("ticks", f.clock.now()));
  expect(
    (await f.scanner.request({ ...f.trigger(0, "ticks", "DEADLINE"), evidence: p.evidence })).ok,
  ).toBe(false);
});
it("unregistered stream cannot fabricate bar finality", async () => {
  const f = await fixture(base);
  await f.plan([f.subscription({ mode: "BAR_CLOSE", streamId: "absent" })]);
  take(await f.start());
  expect(f.scanner.preview("ticks", f.clock.now()).ok).toBe(false);
});
it("unregistered higher frame cannot become available by close label", async () => {
  const f = await fixture(base);
  await f.plan([f.subscription({ mode: "TIMEFRAME", timeframe: "H4", streamId: "absent" })]);
  take(await f.start());
  expect(f.scanner.preview("ticks", f.clock.now()).ok).toBe(false);
});
