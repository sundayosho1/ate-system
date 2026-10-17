import type { Checkpoint } from "@ate/mose-core";
import { beforeAll, it, expect } from "vitest";
import { fingerprint } from "@ate/mose-scanner";
import { durationMs } from "@ate/time";
import {
  CalendarBoundaryResolver,
  calendarSchema,
  AggregationEngine,
  MemoryAggregationRepository,
  TimeframeRegistry,
  utcCalendar,
  defaultOptions,
} from "@ate/multitimeframe";
import { MultiSpeedScannerRuntime, failure } from "@ate/mose-scanner";
import { fixture, owners, take, config } from "./fixtures.js";
import { checker } from "../mose-core/fixtures.js";
import { seed } from "./bar-helper.js";
let base: Awaited<ReturnType<typeof owners>>;
beforeAll(async () => {
  base = await owners();
});
it("J01 actual event stream retains canonical source order and genuine receipts", async () => {
  const f = await fixture(base);
  await f.plan();
  take(await f.start());
  for (let i = 0; i < f.universe.plan.length; i++) {
    take(await f.scanner.request(f.trigger(i)));
    expect(take(await f.scanner.dispatch("event-" + i, 1))[0]!.status).toBe("COMPLETED");
  }
  expect(f.scanner.coverage().admittedObservations).toBe(f.universe.plan.length);
});
it("J02 seconds deadlines advance under accepted virtual time", async () => {
  const f = await fixture(base);
  await f.plan([f.subscription({ mode: "SECONDS", cadenceMs: 5000 })]);
  take(await f.start());
  take(await f.scanner.advance());
  take(f.clock.advanceBy(durationMs(10000)));
  const next = take(await f.scanner.advance());
  expect(next.results.length).toBe(2);
  expect(f.scanner.coverage().requests).toBe(3);
});
it("J03 accepted bar finality publication gates BAR_CLOSE", async () => {
  const f = await fixture(base),
    b = await seed(f);
  await f.plan([f.subscription({ mode: "BAR_CLOSE", streamId: b.streamId })]);
  take(await f.start());
  expect(f.scanner.preview("ticks", f.clock.now()).ok).toBe(false);
  b.publish("M15");
  expect(
    f.scanner.preview("ticks", f.clock.now()),
    JSON.stringify({
      scanner: f.scanner.preview("ticks", f.clock.now()),
      snapshot: b.inspect("M15"),
    }),
  ).toMatchObject({ ok: true });
  for (let i = 0; i < f.universe.plan.length; i++) take(await f.mose.receive(i));
  take(await f.mose.process());
  const preview = take(f.scanner.preview("ticks", f.clock.now()));
  take(
    await f.scanner.request({
      id: "final-bar-work",
      subscriptionId: "ticks",
      boundary: f.clock.now(),
      kind: "BAR_FINALITY",
      actor: null,
      cause: preview.cause,
      evidence: preview.evidence,
    }),
  );
  expect(take(await f.scanner.dispatch("bar-evaluation", 1))[0]!.status).toBe("COMPLETED");
});
it("J04 later H4 finality is unavailable at earlier M15 boundary", async () => {
  const f = await fixture(base),
    b = await seed(f),
    earlier = f.clock.now();
  await f.plan([f.subscription({ mode: "TIMEFRAME", streamId: b.streamId, timeframe: "H4" })]);
  take(await f.start());
  take(f.clock.advanceBy(durationMs(1000)));
  b.publish("H4");
  expect(f.scanner.preview("ticks", earlier).ok).toBe(false);
  expect(
    f.scanner.preview("ticks", f.clock.now()),
    JSON.stringify({
      scanner: f.scanner.preview("ticks", f.clock.now()),
      snapshot: b.inspect("H4"),
    }),
  ).toMatchObject({ ok: true });
  for (let i = 0; i < f.universe.plan.length; i++) take(await f.mose.receive(i));
  take(await f.mose.process());
  const preview = take(f.scanner.preview("ticks", f.clock.now()));
  take(
    await f.scanner.request({
      id: "final-bar-work",
      subscriptionId: "ticks",
      boundary: f.clock.now(),
      kind: "TIMEFRAME",
      actor: null,
      cause: preview.cause,
      evidence: preview.evidence,
    }),
  );
  expect(take(await f.scanner.dispatch("bar-evaluation", 1))[0]!.status).toBe("COMPLETED");
});
it("J05 accepted session break creates explicit skipped schedule receipt", async () => {
  const f = await fixture(base),
    at = f.clock.now(),
    ms = Date.parse(at),
    stamp = (n: number) => new Date(ms + n).toISOString();
  const calendar = new CalendarBoundaryResolver(
    calendarSchema.parse({
      id: "session",
      version: "1",
      kind: "EXPLICIT_SESSION_SCHEDULE",
      timezone: "Etc/UTC",
      sessions: [
        {
          id: "day",
          date: at.slice(0, 10),
          open: stamp(-1000),
          close: stamp(60000),
          breaks: [{ start: at, end: stamp(10000) }],
        },
      ],
    }),
  );
  f.ports.calendar = calendar;
  await f.plan([
    f.subscription({
      mode: "SCHEDULE",
      cadenceMs: 5000,
      schedule: {
        id: "session",
        calendarFingerprint: calendar.fingerprint,
        end: stamp(30000),
        missed: "CATCH_UP",
      },
    }),
  ]);
  take(await f.start());
  take(await f.scanner.advance());
  expect(take(f.scanner.query()).requests[0]!.reason).toBe("SESSION_BREAK");
  expect(f.scanner.coverage().admittedObservations).toBe(0);
});
it("J06 accepted calendar DST fold and holiday scope constrain schedule", async () => {
  const f = await fixture(base),
    calendar = new CalendarBoundaryResolver(
      calendarSchema.parse({
        id: "new-york",
        version: "1",
        kind: "TIMEZONE_CALENDAR",
        timezone: "America/New_York",
        fold: "LATER",
        holidays: [f.clock.now().slice(0, 10)],
      }),
    );
  const folded = calendar.localBoundary({
    year: 2026,
    month: 11,
    day: 1,
    hour: 1,
    minute: 30,
    second: 0,
    millisecond: 0,
  });
  expect(folded).toBe("2026-11-01T06:30:00.000Z");
  f.ports.calendar = calendar;
  await f.plan([
    f.subscription({
      mode: "SCHEDULE",
      cadenceMs: 5000,
      schedule: {
        id: "holiday",
        calendarFingerprint: calendar.fingerprint,
        end: f.clock.now(),
        missed: "CATCH_UP",
      },
    }),
  ]);
  take(await f.start());
  take(await f.scanner.advance());
  expect(take(f.scanner.query()).requests[0]!.reason).toBe("SESSION_CLOSED");
});
it("J07 governed checker trigger accepted and forged actor refused", async () => {
  const f = await fixture(base, { trustedTriggerActors: [checker.actorId] });
  await f.plan([f.subscription({ mode: "TRIGGER" })]);
  take(await f.start());
  for (let i = 0; i < f.universe.plan.length; i++) take(await f.mose.receive(i));
  take(await f.mose.process());
  const t = f.trigger(f.universe.plan.length - 1, "ticks", "RESEARCH_RESCAN");
  expect((await f.scanner.request({ ...t, actor: "forged" })).ok).toBe(false);
  expect(take(await f.scanner.request({ ...t, actor: checker.actorId })).disposition).toBe("DUE");
  expect(take(await f.scanner.dispatch("checker-trigger", 1))[0]!.status).toBe("COMPLETED");
});
it("J08 simultaneous equivalent tick and cadence work safely coalesces", async () => {
  const f = await fixture(base);
  await f.plan([
    f.subscription(),
    f.subscription({ id: "seconds", mode: "SECONDS", cadenceMs: 5000 }),
  ]);
  take(await f.start());
  const e = f.universe.plan.length - 1;
  take(await f.scanner.request(f.trigger(e)));
  const p = take(f.scanner.preview("seconds", f.clock.now()));
  take(
    await f.scanner.request({
      id: "seconds-due",
      subscriptionId: "seconds",
      boundary: f.clock.now(),
      kind: "DEADLINE",
      actor: null,
      cause: "seconds",
      evidence: p.evidence,
    }),
  );
  expect(f.scanner.coverage()).toMatchObject({ requests: 2, uniqueObligations: 1, coalesced: 1 });
});
it("J09 duplicate event does not inflate completed observations", async () => {
  const f = await fixture(base);
  await f.plan();
  take(await f.start());
  const t = f.trigger();
  take(await f.scanner.request(t));
  take(await f.scanner.request(t));
  take(await f.scanner.dispatch("once", 1));
  expect(f.scanner.coverage()).toMatchObject({
    requests: 1,
    completed: 1,
    admittedObservations: 1,
  });
});
it("J10 out-of-order work defers until canonical predecessor is acknowledged", async () => {
  const f = await fixture(base);
  await f.plan();
  take(await f.start());
  take(await f.scanner.request(f.trigger(1)));
  expect(take(await f.scanner.dispatch("later", 1))[0]!.status).toBe("DEFERRED");
  take(await f.scanner.request(f.trigger(0)));
  const result = take(await f.scanner.dispatch("retry", 2));
  expect(result.some((w) => w.status === "COMPLETED")).toBe(true);
  expect(f.scanner.coverage().pending).toBeGreaterThanOrEqual(0);
});
it("J11 graph invalidation is bounded to explicitly dependent timeframe", async () => {
  const f = await fixture(base);
  await f.plan(
    [f.subscription({ dependencies: ["m15"] })],
    [
      { id: "source", parents: [] },
      { id: "m15", parents: ["source"] },
      { id: "h4", parents: [] },
    ],
  );
  expect(take(f.scanner.affectedDependencies(["source"]))).toEqual(["m15", "source"]);
});
it("J12 incremental current cache beats redundant brute-force oracle", async () => {
  const f = await fixture(base);
  await f.plan([f.subscription({ mode: "SECONDS", cadenceMs: 1 })]);
  take(await f.start());
  for (let i = 0; i < f.universe.plan.length; i++) take(await f.mose.receive(i));
  take(await f.mose.process());
  const t = f.trigger(0, "ticks", "DEADLINE");
  take(await f.scanner.request(t));
  take(await f.scanner.dispatch("first", 1));
  for (let i = 1; i <= 5; i++) {
    take(f.clock.advanceBy(durationMs(1)));
    take(await f.scanner.request({ ...t, id: "repeat-" + i, boundary: f.clock.now() }));
  }
  const inputs = take(f.scanner.query()).requests.map((q) => ({ evidence: q.trigger.evidence }));
  let oracleEvaluations = 0;
  const reference = inputs.map((input) => {
    oracleEvaluations++;
    return fingerprint({ evidence: input.evidence, purpose: "qualified-research-work" });
  });
  const evaluated = take(f.scanner.query()).work.filter((w) => w.status === "COMPLETED");
  expect([...new Set(reference)]).toEqual([
    ...new Set(
      evaluated.map((w) =>
        fingerprint({ evidence: w.evidence, purpose: "qualified-research-work" }),
      ),
    ),
  ]);
  expect(evaluated.length).toBeLessThan(oracleEvaluations);
  expect(f.scanner.coverage().requests).toBe(inputs.length);
  expect(f.scanner.coverage().completed).toBe(1);
  expect(f.scanner.diagnostics().avoidedEvaluations).toBe(5);
});
it("J13 changed genuine source evidence requires new work", async () => {
  const f = await fixture(base);
  await f.plan();
  take(await f.start());
  take(await f.scanner.request(f.trigger(0)));
  take(await f.scanner.dispatch("one", 1));
  take(await f.scanner.request(f.trigger(1)));
  expect(f.scanner.coverage()).toMatchObject({ uniqueObligations: 2, pending: 1 });
});
it("non-equivalent timeframe obligations are not coalesced", async () => {
  const f = await fixture(base);
  await f.plan([f.subscription(), f.subscription({ id: "other", timeframe: "H1" })]);
  take(await f.start());
  take(await f.scanner.request(f.trigger(0)));
  take(await f.scanner.request(f.trigger(0, "other")));
  expect(f.scanner.coverage().uniqueObligations).toBe(2);
});
it("J15 saturated queue explicitly refuses excess and preserves retained work", async () => {
  const f = await fixture(base, { maxQueue: 1 });
  await f.plan();
  take(await f.start());
  take(await f.scanner.request(f.trigger(0)));
  expect(await f.scanner.request(f.trigger(1))).toMatchObject({
    ok: false,
    error: { code: "RESOURCE_DEFERRED" },
  });
  expect(f.scanner.coverage().pending).toBe(1);
});
it("J16 stop during held publication never returns successful shutdown", async () => {
  const f = await fixture(base);
  await f.plan();
  take(await f.start());
  const repo = f.repository;
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>((r) => (release = r)),
    begun = new Promise<void>((r) => (entered = r));
  f.ports.repository = {
    load: () => repo.load(),
    commit: async (c) => {
      await Promise.resolve();
      entered();
      await held;
      return repo.commit(c);
    },
  };
  const request = f.scanner.request(f.trigger());
  await begun;
  expect((await f.scanner.stop()).ok).toBe(false);
  release();
  expect((await request).ok).toBe(true);
  expect((await f.scanner.stop()).ok).toBe(false);
});
it("J17 actual committed lost ACK recovers exact due identity", async () => {
  const f = await fixture(base);
  await f.plan();
  take(await f.start());
  const repo = f.repository;
  f.ports.repository = {
    load: () => repo.load(),
    commit: async (c) => {
      await Promise.resolve();
      take(await repo.commit(c));
      return failure("LOST_ACK", "UNKNOWN");
    },
  };
  expect((await f.scanner.request(f.trigger())).ok).toBe(false);
  expect(f.scanner.diagnostics().uncertainty).not.toBeNull();
  const fresh = new MultiSpeedScannerRuntime({ ...f.ports, repository: repo });
  take(await fresh.initialize());
  expect(fresh.coverage().pending).toBe(1);
});
it("J18 actual current eligibility revocation refuses evaluation", async () => {
  const owner = await owners(),
    f = await fixture(owner);
  await f.plan();
  take(await f.start());
  take(await f.scanner.request(f.trigger()));
  await owner.promote("RESEARCH", { disposition: "REVOKED" });
  expect(take(await f.scanner.dispatch("outage", 1))[0]!.status).toBe("DEFERRED");
  expect(f.scanner.coverage()).toMatchObject({ pending: 1, completed: 0 });
});
it("fault injection: negative-provenance diagnostics block scan completion", async () => {
  const f = await fixture(base);
  await f.plan();
  take(await f.start());
  take(await f.scanner.request(f.trigger()));
  const original = f.mose.service.health.bind(f.mose.service);
  f.ports.mose.health = async () => {
    await Promise.resolve();
    const r = take(await original());
    return {
      ok: true,
      value: {
        ...r,
        negativeProvenanceObligations: [
          {
            sessionId: "session-A",
            instrumentId: f.subscription().instrumentId,
            universeFingerprint: f.universe.fingerprint,
            reason: "MISSING_RETAINED_NATIVE_NEGATIVE_PROVENANCE" as const,
          },
        ],
      },
    };
  };
  expect(take(await f.scanner.dispatch("legacy", 1))[0]!.reason).toBe("PROVENANCE_INCOMPLETE");
});
it("J20 trigger/work/actual P25 receipt reconcile without funnel promotion", async () => {
  const f = await fixture(base);
  await f.plan();
  take(await f.start());
  take(await f.scanner.request(f.trigger()));
  const work = take(await f.scanner.dispatch("reconcile", 1))[0]!;
  const q = take(
    f.mose.service.query({
      sessionId: "session-A",
      kind: "OBSERVATIONS",
      offset: 0,
      limit: 100,
      asOf: null,
    }),
  );
  expect(JSON.stringify(q)).toContain(work.observationId!);
  expect(JSON.stringify(q)).toContain("OBSERVED");
  expect(f.scanner.coverage().admittedObservations).toBe(1);
});
it("J19 actual recovered legacy root rejects scheduled authority without rewriting history", async () => {
  const { readFileSync, writeFileSync, readdirSync } = await import("node:fs"),
    { join } = await import("node:path");
  const { MOSECoreRuntime, FilesystemMOSERepository } = await import("@ate/mose-core");
  const { fixture: mf, root } = await import("../mose-core/fixtures.js");
  const legacy = JSON.parse(
    readFileSync(new URL("../mose-core/negative-result-history.json", import.meta.url), "utf8"),
  ) as { files: Record<string, string> };
  const dir = root();
  for (const [name, raw] of Object.entries(legacy.files)) writeFileSync(join(dir, name), raw);
  const original = Object.entries(legacy.files).map(([name, raw]) => [name, fingerprint(raw)]);
  const cp = JSON.parse(Object.values(legacy.files)[0]!) as Checkpoint;
  const owner = await mf(
    base,
    cp.state.sessions[0]!.universe.policy,
    new FilesystemMOSERepository(dir),
    false,
  );
  const recovered = new MOSECoreRuntime("mose-lab", owner.ports);
  take(await recovered.initialize());
  const f = await fixture(base);
  f.ports.mose = recovered;
  const u = take(recovered.getUniverse("session-A"));
  const proposed = {
    id: "legacy",
    dependencies: [{ id: "source", parents: [] }],
    subscriptions: [
      f.subscription({
        universe: u.fingerprint,
        instrumentId: u.members[0]!.instrumentId,
        mode: "SECONDS",
        cadenceMs: 5000,
      }),
    ],
  };
  f.setConfiguration(await config(f.clock, f.policy, proposed));
  const plan = await f.scanner.createPlan("legacy-schedule", proposed);
  expect(plan.ok).toBe(false);
  expect(recovered.diagnostics()).toMatchObject({ readiness: "NOT_READY", health: "DEGRADED" });
  expect(f.scanner.coverage().completed).toBe(0);
  expect(
    readdirSync(dir)
      .sort()
      .map((name) => [name, fingerprint(readFileSync(join(dir, name), "utf8"))]),
  ).toEqual(original);
});

it("open explicit schedule completes through genuine owner acknowledgement", async () => {
  const f = await fixture(base);
  await f.plan([
    f.subscription({
      mode: "SCHEDULE",
      cadenceMs: 5000,
      schedule: {
        id: "open",
        calendarFingerprint: f.ports.calendar.fingerprint,
        end: f.clock.now(),
        missed: "CATCH_UP",
      },
    }),
  ]);
  take(await f.start());
  for (let i = 0; i < f.universe.plan.length; i++) take(await f.mose.receive(i));
  take(await f.mose.process());
  const result = take(await f.scanner.advance());
  expect(result.results.length).toBe(1);
  expect(take(await f.scanner.dispatch("open-schedule", 1))[0]!.status).toBe("COMPLETED");
});

it("real late canonical input corrects only the dependent bar work identity", async () => {
  const f = await fixture(base);
  // A separately declared offline correction lab, not a change to accepted owners/default gates.
  const engine = new AggregationEngine({
    clock: f.clock,
    repository: new MemoryAggregationRepository(f.clock),
    registry: new TimeframeRegistry(),
    calendar: utcCalendar,
    configurationFingerprint: fingerprint("seven-day-correction-lab"),
    options: {
      ...defaultOptions,
      enabled: true,
      maxSnapshotAgeMs: 604800000,
      correctionHorizonMs: 604800000,
    },
    directTimeframes: ["M15", "H4"],
    edges: [],
  });
  take(engine.start());
  f.engine = engine;
  f.ports.aggregation = engine;
  const b = await seed(f, (x) => x, true);
  await f.plan(
    [
      f.subscription({ mode: "BAR_CLOSE", streamId: b.streamId, dependencies: ["m15"] }),
      f.subscription({ id: "event", dependencies: ["independent"] }),
    ],
    [
      { id: "source", parents: [] },
      { id: "m15", parents: ["source"] },
      { id: "independent", parents: [] },
    ],
  );
  take(await f.start());
  b.publish("M15");
  const before = f.clock.now(),
    old = take(f.scanner.preview("ticks", before)),
    event = take(f.scanner.preview("event", before));
  take(
    await f.scanner.request({
      id: "original-bar",
      subscriptionId: "ticks",
      boundary: before,
      kind: "BAR_FINALITY",
      actor: null,
      cause: old.cause,
      evidence: old.evidence,
    }),
  );
  take(f.clock.advanceBy(durationMs(1000)));
  b.releaseLast();
  expect(f.scanner.preview("ticks", f.clock.now()).ok).toBe(false);
  take(
    f.engine.watermark(b.streamId, {
      sessionId: b.events[0]!.record.input.sessionId,
      through: f.clock.now(),
      observedAt: f.clock.now(),
      coverage: "COMPLETE_COVERAGE",
      kind: "END_OF_STREAM",
      evidenceId: "correction-reconciled",
      reconciled: true,
    }),
  );
  b.publish("M15");
  const corrected = take(f.scanner.preview("ticks", f.clock.now()));
  expect(corrected.evidence).not.toBe(old.evidence);
  expect(take(f.scanner.preview("ticks", before)).evidence).toBe(old.evidence);
  expect(take(f.scanner.preview("event", f.clock.now())).evidence).toBe(event.evidence);
  take(
    await f.scanner.request({
      id: "corrected-bar",
      subscriptionId: "ticks",
      boundary: f.clock.now(),
      kind: "BAR_FINALITY",
      actor: null,
      cause: corrected.cause,
      evidence: corrected.evidence,
    }),
  );
  const work = take(f.scanner.query()).work;
  expect(work).toHaveLength(2);
  expect(work[0]!.key).not.toBe(work[1]!.key);
  expect(take(f.scanner.affectedDependencies(["source"]))).toEqual(["m15", "source"]);
});

it("default accepted correction horizon refuses old late research input", async () => {
  const f = await fixture(base),
    b = await seed(f, (x) => x, true);
  b.publish("M15");
  expect(() => b.releaseLast()).toThrow("CORRECTION_HORIZON");
});
