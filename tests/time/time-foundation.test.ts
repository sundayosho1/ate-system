import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Actor, SourceId, UtcTimestamp } from "@ate/domain";
import {
  defaultDeliveryPolicy,
  EventFactory,
  EventRegistry,
  InternalEventBus,
  subscriptionId,
} from "@ate/events";
import {
  createEmptyPersistenceStore,
  InMemoryPersistenceEngine,
  persistenceError,
  persistenceId,
  StateAuthorityRegistry,
  stateDomain,
  stateOwner,
} from "@ate/persistence";
import {
  classifyFreshness,
  ClockQualityMonitor,
  convertFixedOffsetToUtc,
  createClockRuntimeService,
  createPerformanceMonotonicClock,
  createSimulationClock,
  createSystemUtcClock,
  DeterministicScheduler,
  durationMs,
  fixedOffsetMinutes,
  mustParseUtc,
  parseCanonicalUtc,
  ReplayClock,
  resolveLocalDateTime,
  timeZoneId,
  tradingDate,
  utcToZoned,
  VirtualClock,
  type ClockRuntimeOptions,
  type MonotonicMilliseconds,
} from "@ate/time";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const root = process.cwd();

const readText = (relativePath: string): string => readFileSync(join(root, relativePath), "utf8");

const walkFiles = (relativeDirectory: string, extension: string): string[] => {
  const absoluteDirectory = join(root, relativeDirectory);
  return readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      return walkFiles(relativePath, extension);
    }
    return entry.isFile() && entry.name.endsWith(extension) ? [relativePath] : [];
  });
};

const utc = (value: string): UtcTimestamp => mustParseUtc(value);

const actor: Actor = {
  actorType: "SERVICE",
  displayName: "time-test",
};

const source = {
  sourceId: "60000000-0000-4000-8000-000000000900" as SourceId,
  sourceType: "SYSTEM" as const,
  name: "time-test",
};

const ids = Array.from(
  { length: 100 },
  (_, index) => `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);

const defaultClockRuntimeOptions = (
  clockMode: ClockRuntimeOptions["clockMode"],
  runtimeMode: ClockRuntimeOptions["runtimeMode"] = "SIMULATION",
): ClockRuntimeOptions => ({
  runtimeMode,
  clockMode,
  maximumFutureSkewMs: durationMs(1_000),
  clockJumpWarningThresholdMs: durationMs(500),
  clockJumpCriticalThresholdMs: durationMs(2_000),
  schedulerMaxTasks: 10,
});

describe("Prompt 6 clock, time authority, temporal integrity, and deterministic runtime", () => {
  it("normalizes explicit UTC instants and rejects naive or invalid timestamps", () => {
    expect(parseCanonicalUtc("2026-09-25T00:00:00.000Z")).toEqual({
      ok: true,
      value: utc("2026-09-25T00:00:00.000Z"),
    });
    expect(parseCanonicalUtc("2026-09-25T01:30:00+01:30")).toEqual({
      ok: true,
      value: utc("2026-09-25T00:00:00.000Z"),
    });
    const naive = parseCanonicalUtc("2026-09-25T00:00:00");
    expect(naive.ok).toBe(false);
    expect(naive.ok ? undefined : naive.error.code).toBe("NAIVE_TIMESTAMP");
    const invalid = parseCanonicalUtc("not-a-date");
    expect(invalid.ok).toBe(false);
    expect(invalid.ok ? undefined : invalid.error.code).toBe("INVALID_TIMESTAMP");
    expect(() => durationMs(-1)).toThrow(/invalid duration/u);
  });

  it("provides system UTC and monotonic clock adapters with authoritative shapes", () => {
    const systemClock = createSystemUtcClock();
    expect(systemClock.mode).toBe("SYSTEM");
    expect(systemClock.provenance.source).toBe("SYSTEM_UTC");
    expect(systemClock.now()).toMatch(/^\d{4}-\d{2}-\d{2}T/u);

    const monotonic = createPerformanceMonotonicClock();
    expect(monotonic.now()).toBeGreaterThanOrEqual(0);
  });

  it("advances virtual, simulation, and replay clocks without waiting on wall time", () => {
    const start = utc("2026-09-25T00:00:00.000Z");
    const virtualClock = new VirtualClock(start);
    expect(virtualClock.now()).toBe(start);
    expect(virtualClock.advanceBy(durationMs(1_500))).toEqual({
      ok: true,
      value: utc("2026-09-25T00:00:01.500Z"),
    });
    const backward = virtualClock.advanceTo(start);
    expect(backward.ok).toBe(false);
    expect(backward.ok ? undefined : backward.error.code).toBe("INVALID_CLOCK_ADVANCE");

    const simulationClock = createSimulationClock(start);
    expect(simulationClock.advanceBy(durationMs(86_400_000))).toEqual({
      ok: true,
      value: utc("2026-09-26T00:00:00.000Z"),
    });

    const replayClock = new ReplayClock([
      utc("2026-09-25T00:00:00.000Z"),
      utc("2026-09-25T00:00:01.000Z"),
      utc("2026-09-25T00:00:02.000Z"),
    ]);
    expect(replayClock.now()).toBe("2026-09-25T00:00:00.000Z");
    expect(replayClock.step()).toEqual({ ok: true, value: utc("2026-09-25T00:00:01.000Z") });
    expect(replayClock.step()).toEqual({ ok: true, value: utc("2026-09-25T00:00:02.000Z") });
    replayClock.reset();
    expect(replayClock.now()).toBe("2026-09-25T00:00:00.000Z");
  });

  it("runs deterministic scheduled tasks only when due and in stable due/priority/sequence order", async () => {
    const clock = new VirtualClock(utc("2026-09-25T00:00:00.000Z"));
    const scheduler = new DeterministicScheduler(clock, (sequence) => `task-${sequence}` as never, {
      maxScheduledTasks: 3,
    });
    const observed: string[] = [];
    expect(
      scheduler.scheduleAfter(durationMs(1_000), () => {
        observed.push("late");
      }),
    ).toEqual({
      ok: true,
      value: "task-1",
    });
    expect(
      scheduler.scheduleAfter(
        durationMs(500),
        () => {
          observed.push("low");
        },
        1,
      ).ok,
    ).toBe(true);
    expect(
      scheduler.scheduleAfter(
        durationMs(500),
        () => {
          observed.push("high");
        },
        10,
      ).ok,
    ).toBe(true);
    const overflow = scheduler.scheduleAfter(durationMs(2_000), () => {
      observed.push("never");
    });
    expect(overflow.ok).toBe(false);
    expect(overflow.ok ? undefined : overflow.error.code).toBe("TIMER_LIMIT_EXCEEDED");

    expect(await scheduler.runDueTasks()).toEqual({ ok: true, value: [] });
    expect(clock.advanceBy(durationMs(500)).ok).toBe(true);
    expect(await scheduler.runDueTasks()).toEqual({ ok: true, value: ["task-3", "task-2"] });
    expect(observed).toEqual(["high", "low"]);

    const cancel = scheduler.scheduleAfter(durationMs(500), () => {
      observed.push("cancelled");
    });
    expect(cancel.ok).toBe(true);
    expect(scheduler.cancel(cancel.ok ? cancel.value : ("missing" as never))).toBe(true);
    expect(clock.advanceBy(durationMs(500)).ok).toBe(true);
    expect(await scheduler.runDueTasks()).toEqual({ ok: true, value: ["task-1"] });
    expect(observed).toEqual(["high", "low", "late"]);
    expect(scheduler.snapshot()).toMatchObject({
      scheduledTaskCount: 0,
      executedTaskCount: 3,
      cancelledTaskCount: 1,
    });
  });

  it("converts IANA timezones, rejects abbreviations, and detects DST gaps and overlaps", () => {
    const utcZone = timeZoneId("Etc/UTC");
    const tokyo = timeZoneId("Asia/Tokyo");
    const newYork = timeZoneId("America/New_York");
    const abbreviation = timeZoneId("EST");
    expect(utcZone.ok).toBe(true);
    expect(tokyo.ok).toBe(true);
    expect(newYork.ok).toBe(true);
    expect(abbreviation.ok).toBe(false);
    expect(abbreviation.ok ? undefined : abbreviation.error.code).toBe("INVALID_TIMEZONE");

    const instant = utc("2026-09-25T00:00:00.000Z");
    expect(
      utcToZoned(instant, utcZone.ok ? utcZone.value : (undefined as never)).offsetMinutes,
    ).toBe(0);
    expect(utcToZoned(instant, tokyo.ok ? tokyo.value : (undefined as never)).offsetMinutes).toBe(
      540,
    );
    expect(
      utcToZoned(instant, newYork.ok ? newYork.value : (undefined as never)).offsetMinutes,
    ).toBe(-240);
    expect(tradingDate(instant, tokyo.ok ? tokyo.value : (undefined as never))).toBe("2026-09-25");
    expect(
      convertFixedOffsetToUtc(
        { year: 2026, month: 9, day: 25, hour: 9, minute: 0, second: 0, millisecond: 0 },
        fixedOffsetMinutes(540),
      ),
    ).toBe(instant);

    const nonexistent = resolveLocalDateTime(
      { year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0, millisecond: 0 },
      newYork.ok ? newYork.value : (undefined as never),
    );
    expect(nonexistent.ok).toBe(false);
    expect(nonexistent.ok ? undefined : nonexistent.error.code).toBe("NONEXISTENT_LOCAL_TIME");
    const ambiguous = resolveLocalDateTime(
      { year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0, millisecond: 0 },
      newYork.ok ? newYork.value : (undefined as never),
    );
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.ok ? undefined : ambiguous.error.code).toBe("AMBIGUOUS_LOCAL_TIME");
  });

  it("classifies freshness and detects wall-clock quality regressions", () => {
    const thresholds = {
      agingAfterMs: durationMs(1_000),
      staleAfterMs: durationMs(2_000),
      expiredAfterMs: durationMs(5_000),
      futureSkewToleranceMs: durationMs(500),
    };
    const now = utc("2026-09-25T00:00:05.000Z");
    expect(classifyFreshness(utc("2026-09-25T00:00:04.500Z"), now, thresholds).status).toBe(
      "FRESH",
    );
    expect(classifyFreshness(utc("2026-09-25T00:00:03.500Z"), now, thresholds).status).toBe(
      "AGING",
    );
    expect(classifyFreshness(utc("2026-09-25T00:00:02.000Z"), now, thresholds).status).toBe(
      "STALE",
    );
    expect(classifyFreshness(utc("2026-09-25T00:00:00.000Z"), now, thresholds).status).toBe(
      "EXPIRED",
    );
    const future = classifyFreshness(utc("2026-09-25T00:00:06.000Z"), now, thresholds);
    expect(future.status).toBe("FUTURE");
    expect(future.error?.code).toBe("FUTURE_TIMESTAMP");

    const quality = new ClockQualityMonitor(durationMs(500), durationMs(2_000));
    expect(
      quality.observe({
        wallClock: utc("2026-09-25T00:00:00.000Z"),
        monotonic: 0 as MonotonicMilliseconds,
      }),
    ).toBe("ACCEPTABLE");
    expect(
      quality.observe({
        wallClock: utc("2026-09-25T00:00:00.250Z"),
        monotonic: 1_000 as MonotonicMilliseconds,
      }),
    ).toBe("DEGRADED");
    expect(quality.lastClockJump()?.code).toBe("CLOCK_JUMP_DETECTED");
    expect(
      quality.observe({
        wallClock: utc("2026-09-24T23:59:59.000Z"),
        monotonic: 1_500 as MonotonicMilliseconds,
      }),
    ).toBe("UNTRUSTED");
    expect(quality.lastClockJump()?.code).toBe("CLOCK_MOVED_BACKWARD");
  });

  it("gates clock runtime service readiness by runtime and clock mode compatibility", () => {
    const virtualClock = new VirtualClock(utc("2026-09-25T00:00:00.000Z"));
    const liveVirtual = createClockRuntimeService({
      clock: virtualClock,
      options: defaultClockRuntimeOptions("VIRTUAL", "LIVE"),
    });
    expect(liveVirtual.initialize().ok).toBe(false);
    expect(liveVirtual.checkReadiness().status).toBe("NOT_READY");

    const simulationReplay = createClockRuntimeService({
      clock: new ReplayClock([utc("2026-09-25T00:00:00.000Z")]),
      options: defaultClockRuntimeOptions("REPLAY", "SIMULATION"),
    });
    expect(simulationReplay.initialize()).toEqual({ ok: true, value: undefined });
    expect(simulationReplay.checkHealth().status).toBe("HEALTHY");
    expect(simulationReplay.checkReadiness().status).toBe("READY");
    expect(simulationReplay.diagnostics()).toMatchObject({
      clockMode: "REPLAY",
      runtimeMode: "SIMULATION",
      timezoneCapability: true,
    });
  });

  it("uses virtual clock authority for event timestamps", async () => {
    const clock = new VirtualClock(utc("2026-09-25T00:00:00.000Z"));
    const registry = new EventRegistry(clock);
    expect(
      registry.register({
        eventType: "time.workflow.completed.v1",
        category: "APPLICATION",
        version: 1,
        schema: z.object({ step: z.string() }).strict(),
        description: "Temporal event test.",
        owner: "@ate/time",
      }).ok,
    ).toBe(true);
    const factory = new EventFactory(registry, {
      runtimeMode: "SIMULATION",
      source,
      actor,
      clock,
      idGenerator: () => ids.shift() ?? "60000000-0000-4000-8000-000000000999",
      maxCausationDepth: 8,
    });
    const bus = new InternalEventBus({ registry, factory, clock });
    bus.start();
    const delivered: UtcTimestamp[] = [];
    const subscribed = bus.register({
      subscriptionId: subscriptionId("time-subscription"),
      subscriberId: "time-test",
      description: "records virtual timestamps",
      eventTypes: ["time.workflow.completed.v1"],
      criticality: "OPTIONAL",
      policy: defaultDeliveryPolicy,
      handler: ({ event }) => {
        delivered.push(event.envelope.eventTimestamp);
      },
    });
    expect(subscribed.ok).toBe(true);
    const first = factory.createRootEvent({
      eventType: "time.workflow.completed.v1",
      payload: { step: "first" },
    });
    expect(first.ok).toBe(true);
    expect(clock.advanceBy(durationMs(2_000)).ok).toBe(true);
    const second = factory.createRootEvent({
      eventType: "time.workflow.completed.v1",
      payload: { step: "second" },
    });
    expect(second.ok).toBe(true);
    expect(first.ok ? first.value.envelope.eventTimestamp : undefined).toBe(
      "2026-09-25T00:00:00.000Z",
    );
    expect(second.ok ? second.value.envelope.eventTimestamp : undefined).toBe(
      "2026-09-25T00:00:02.000Z",
    );
    await bus.publish(first.ok ? first.value : (undefined as never));
    await bus.publish(second.ok ? second.value : (undefined as never));
    expect(delivered).toEqual([utc("2026-09-25T00:00:00.000Z"), utc("2026-09-25T00:00:02.000Z")]);
  });

  it("uses virtual clock authority for persistence state, audit, outbox, inbox, and dead-letter time", async () => {
    const clock = new VirtualClock(utc("2026-09-25T00:00:00.000Z"));
    let idCursor = 0;
    const idGenerator = () => ids[idCursor++] ?? ids.at(-1)!;
    const authority = new StateAuthorityRegistry(clock);
    expect(
      authority.register({
        stateDomain: stateDomain("time.reference"),
        owner: stateOwner("time"),
        authorityType: "INTERNAL_AUTHORITATIVE",
        writeAuthority: "@ate/time/test",
        readers: ["tests"],
        durable: true,
        historyRequired: true,
        reconciliationRequired: false,
        runtimeModes: ["SIMULATION"],
        description: "Time integration state.",
      }).ok,
    ).toBe(true);
    const persistence = new InMemoryPersistenceEngine(
      createEmptyPersistenceStore(),
      clock,
      idGenerator,
      authority,
      { runtimeMode: "SIMULATION", inboxProcessingLeaseMs: 5_000 },
    );
    expect(persistence.connect().ok).toBe(true);

    const registry = new EventRegistry(clock);
    expect(
      registry.register({
        eventType: "time.persistence.changed.v1",
        category: "APPLICATION",
        version: 1,
        schema: z.object({ stateId: z.string() }).strict(),
        description: "Persistence time test.",
        owner: "@ate/time",
      }).ok,
    ).toBe(true);
    const factory = new EventFactory(registry, {
      runtimeMode: "SIMULATION",
      source,
      actor,
      clock,
      idGenerator,
      maxCausationDepth: 8,
    });
    const stateId = persistenceId("60000000-0000-4000-8000-000000000050");
    const event = factory.createRootEvent({
      eventType: "time.persistence.changed.v1",
      payload: { stateId },
    });
    expect(event.ok).toBe(true);
    const transaction = await persistence.execute({ runtimeMode: "SIMULATION" }, (tx) => {
      const saved = persistence.saveState(tx, {
        stateId,
        stateDomain: stateDomain("time.reference"),
        owner: stateOwner("time"),
        runtimeMode: "SIMULATION",
        expectedVersion: 0,
        payload: { value: "deterministic" },
        actor,
        transition: "CREATE",
      });
      expect(saved.ok).toBe(true);
      expect(
        persistence.appendAudit(tx, {
          runtimeMode: "SIMULATION",
          actor,
          action: "TIME_TEST",
          outcome: "SUCCESS",
          affectedResource: stateId,
          metadata: {},
        }).ok,
      ).toBe(true);
      const outbox = persistence.appendOutbox(tx, event.ok ? event.value : (undefined as never));
      expect(outbox.ok).toBe(true);
    });
    expect(transaction.ok).toBe(true);
    const loaded = persistence.loadState<{ value: string }>(stateId, "SIMULATION");
    expect(loaded.ok ? loaded.value.createdAt : undefined).toBe("2026-09-25T00:00:00.000Z");
    expect(persistence.historyForState(stateId)[0]?.occurredAt).toBe("2026-09-25T00:00:00.000Z");
    expect(persistence.auditRecords()[0]?.occurredAt).toBe("2026-09-25T00:00:00.000Z");
    expect(persistence.claimPendingOutbox()[0]?.claimedAt).toBe("2026-09-25T00:00:00.000Z");

    expect(clock.advanceBy(durationMs(5_000)).ok).toBe(true);
    const claim = persistence.claimInbox({
      subscriptionId: subscriptionId("time-inbox"),
      idempotencyKey: "time-key",
      eventId: event.ok ? event.value.envelope.eventId : (undefined as never),
      runtimeMode: "SIMULATION",
    });
    expect(claim.ok).toBe(true);
    expect(claim.ok ? claim.value.record.receivedAt : undefined).toBe("2026-09-25T00:00:05.000Z");
    expect(claim.ok ? claim.value.record.claimExpiresAt : undefined).toBe(
      "2026-09-25T00:00:10.000Z",
    );
    const deadLetter = persistence.persistDeadLetter({
      event: event.ok ? event.value : (undefined as never),
      subscriptionId: subscriptionId("time-inbox"),
      failure: persistenceError({
        code: "OUTBOX_DISPATCH_FAILED",
        message: "test failure",
        timestamp: clock.now(),
      }),
      attempts: 1,
      firstFailureAt: clock.now(),
      finalFailureAt: clock.now(),
      correlationId: event.ok ? event.value.envelope.correlationId : (undefined as never),
      subscriberId: "time-test",
      runtimeMode: "SIMULATION",
      replayCount: 0,
    });
    expect(deadLetter.ok).toBe(true);
    expect(clock.advanceBy(durationMs(1_000)).ok).toBe(true);
    const replayed = persistence.markDeadLetterReplayed(
      deadLetter.ok ? deadLetter.value.deadLetterId : (undefined as never),
    );
    expect(replayed.ok ? replayed.value.replayedAt : undefined).toBe("2026-09-25T00:00:06.000Z");
  });

  it("keeps direct current-time APIs constrained to approved infrastructure seams", () => {
    const productionFiles = walkFiles("packages", ".ts");
    const directClockUsages = productionFiles
      .filter((file) => !file.startsWith("packages/time/"))
      .flatMap((file) => {
        const text = readText(file);
        return [
          ["Date.now()", text.includes("Date.now()")],
          ["new Date().toISOString()", text.includes("new Date().toISOString()")],
          ["setTimeout(", text.includes("setTimeout(")],
        ]
          .filter(([, found]) => found)
          .map(([pattern]) => `${file}:${pattern}`);
      });

    expect(directClockUsages.sort()).toEqual(
      [
        "packages/events/src/bus.ts:Date.now()",
        "packages/events/src/bus.ts:setTimeout(",
        "packages/persistence/src/memory.ts:setTimeout(",
        "packages/runtime/src/primitives.ts:new Date().toISOString()",
        "packages/runtime/src/primitives.ts:setTimeout(",
        "packages/runtime/src/runtime.ts:Date.now()",
      ].sort(),
    );
    expect(readText("packages/domain/src/index.ts")).not.toContain("@ate/time");
  });
});
