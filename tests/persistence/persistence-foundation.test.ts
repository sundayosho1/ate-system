import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Actor, RuntimeMode, SourceId, UtcTimestamp } from "@ate/domain";
import {
  defaultDeliveryPolicy,
  EventFactory,
  EventRegistry,
  InternalEventBus,
  subscriptionId,
} from "@ate/events";
import {
  createEmptyPersistenceStore,
  createPersistenceRuntimeService,
  foundationalPostgresDdl,
  InMemoryPersistenceEngine,
  parameterizedSqlOnlyNotice,
  persistenceError,
  persistenceId,
  safePostgresDiagnostics,
  StateAuthorityRegistry,
  stateDomain,
  stateOwner,
  type MigrationDefinition,
  type PersistenceOptions,
} from "@ate/persistence";
import { buildRuntime, type RuntimeClock } from "@ate/runtime";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const root = process.cwd();

const ids = Array.from(
  { length: 500 },
  (_, index) => `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);

const fakeClock = (): RuntimeClock => {
  let tick = 0;
  return {
    now: () =>
      `2026-09-25T02:${String(Math.floor(tick / 60)).padStart(2, "0")}:${String(tick++ % 60).padStart(2, "0")}.000Z` as UtcTimestamp,
  };
};

const actor: Actor = {
  actorType: "SERVICE",
  displayName: "persistence-test",
};

const makePersistenceHarness = (
  runtimeMode: RuntimeMode = "SIMULATION",
  options: Partial<PersistenceOptions> = {},
) => {
  const clock = fakeClock();
  let cursor = 0;
  const idGenerator = () => ids[cursor++] ?? ids.at(-1)!;
  const store = createEmptyPersistenceStore();
  const authority = new StateAuthorityRegistry(clock);
  const entry = authority.register({
    stateDomain: stateDomain("reference.state"),
    owner: stateOwner("persistence"),
    authorityType: "INTERNAL_AUTHORITATIVE",
    writeAuthority: "@ate/persistence/reference-repository",
    readers: ["tests", "@ate/events"],
    durable: true,
    historyRequired: true,
    reconciliationRequired: false,
    runtimeModes: [runtimeMode],
    description: "Non-trading reference state used to validate persistence semantics.",
  });
  expect(entry.ok).toBe(true);
  const persistence = new InMemoryPersistenceEngine(store, clock, idGenerator, authority, {
    runtimeMode,
    ...options,
  });
  const connected = persistence.connect();
  expect(connected.ok).toBe(true);
  return { clock, idGenerator, store, authority, persistence, runtimeMode };
};

const makeEventHarness = (
  clock: RuntimeClock,
  idGenerator: () => string,
  runtimeMode: RuntimeMode,
) => {
  const registry = new EventRegistry(clock);
  const registered = registry.register({
    eventType: "persistence.reference.changed.v1",
    category: "APPLICATION",
    version: 1,
    schema: z.object({ stateId: z.string(), version: z.number().int().positive() }).strict(),
    description: "Non-trading reference state changed event.",
    owner: "@ate/persistence",
  });
  expect(registered.ok).toBe(true);
  const factory = new EventFactory(registry, {
    runtimeMode,
    source: {
      sourceId: "50000000-0000-4000-8000-000000000900" as SourceId,
      sourceType: "SYSTEM",
      name: "persistence-test",
    },
    actor,
    clock,
    idGenerator,
    maxCausationDepth: 8,
  });
  const bus = new InternalEventBus({ registry, factory, clock });
  bus.start();
  return { registry, factory, bus };
};

const migration = (id: string, checksum: string): MigrationDefinition => ({
  migrationId: id as MigrationDefinition["migrationId"],
  checksum,
  description: `migration ${id}`,
  apply: () => undefined,
});

describe("Prompt 5 persistence and state authority foundation", () => {
  it("constructs persistence, documents PostgreSQL direction, validates migrations, and redacts connection diagnostics", () => {
    const { persistence } = makePersistenceHarness();
    expect(
      foundationalPostgresDdl.some((statement) => statement.includes("core.state_records")),
    ).toBe(true);
    expect(parameterizedSqlOnlyNotice).toContain("parameterized");

    const first = persistence.applyMigrations([
      migration("0001_foundation", "sha256:1"),
      migration("0002_outbox_inbox", "sha256:2"),
    ]);
    expect(first.ok).toBe(true);
    const repeated = persistence.applyMigrations([
      migration("0001_foundation", "sha256:1"),
      migration("0002_outbox_inbox", "sha256:2"),
    ]);
    expect(repeated.ok).toBe(true);
    const mismatch = persistence.applyMigrations([migration("0001_foundation", "different")]);
    expect(mismatch.ok).toBe(false);
    expect(mismatch.ok ? undefined : mismatch.error.code).toBe("SCHEMA_INCOMPATIBLE");

    const diagnostics = safePostgresDiagnostics({
      host: "db.internal",
      port: 5432,
      database: "ate",
      user: "ate_runtime",
      passwordSecretRef: "env:ATE_DATABASE_PASSWORD",
      sslMode: "require",
      connectionTimeoutMs: 1000,
      poolMin: 0,
      poolMax: 5,
      poolIdleTimeoutMs: 30000,
    });
    expect(diagnostics.passwordSecretRef).toBe("[REDACTED]");
  });

  it("commits atomically, rolls back failed state/history/outbox writes, rejects nested transactions, and times out safely", async () => {
    const { persistence, runtimeMode, clock, idGenerator } = makePersistenceHarness("SIMULATION", {
      transactionTimeoutMs: 5,
    });
    const { factory } = makeEventHarness(clock, idGenerator, runtimeMode);
    const stateId = persistenceId("50000000-0000-4000-8000-000000000101");
    const committed = await persistence.execute({ runtimeMode }, (tx) => {
      const saved = persistence.saveState(tx, {
        stateId,
        stateDomain: stateDomain("reference.state"),
        owner: stateOwner("persistence"),
        runtimeMode,
        payload: { value: "committed" },
        actor,
        transition: "CREATE",
      });
      expect(saved.ok).toBe(true);
      const event = factory.createRootEvent({
        eventType: "persistence.reference.changed.v1",
        payload: { stateId, version: saved.ok ? saved.value.version : 0 },
      });
      expect(event.ok).toBe(true);
      const outbox = persistence.appendOutbox(tx, event.ok ? event.value : (undefined as never));
      expect(outbox.ok).toBe(true);
    });
    expect(committed.ok).toBe(true);
    expect(persistence.loadState(stateId, runtimeMode).ok).toBe(true);
    expect(persistence.historyForState(stateId)).toHaveLength(1);

    const rolledBackStateId = persistenceId("50000000-0000-4000-8000-000000000102");
    const rolledBack = await persistence.execute({ runtimeMode }, (tx) => {
      const saved = persistence.saveState(tx, {
        stateId: rolledBackStateId,
        stateDomain: stateDomain("reference.state"),
        owner: stateOwner("persistence"),
        runtimeMode,
        payload: { value: "rollback" },
        actor,
        transition: "CREATE",
      });
      expect(saved.ok).toBe(true);
      throw new Error("force rollback after state/history");
    });
    expect(rolledBack.ok).toBe(false);
    expect(persistence.loadState(rolledBackStateId, runtimeMode).ok).toBe(false);
    expect(persistence.historyForState(rolledBackStateId)).toHaveLength(0);

    const nested = await persistence.execute({ runtimeMode }, async () => {
      const result = await persistence.execute({ runtimeMode }, () => undefined);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        throw new Error(result.error.code);
      }
    });
    expect(nested.ok).toBe(false);
    expect(nested.ok ? undefined : nested.error.message).toContain("NESTED_TRANSACTION_REJECTED");

    const timeout = await persistence.execute(
      { runtimeMode, timeoutMs: 1 },
      async () => await new Promise((resolve) => setTimeout(resolve, 20)),
    );
    expect(timeout.ok).toBe(false);
    expect(timeout.ok ? undefined : timeout.error.code).toBe("TRANSACTION_TIMEOUT");
  });

  it("enforces state authority, expected-version writes, lost-update protection, environment isolation, and immutable history/audit reads", async () => {
    const { persistence, runtimeMode } = makePersistenceHarness("RESEARCH");
    const stateId = persistenceId("50000000-0000-4000-8000-000000000201");
    const create = await persistence.execute({ runtimeMode }, (tx) =>
      persistence.saveState(tx, {
        stateId,
        stateDomain: stateDomain("reference.state"),
        owner: stateOwner("persistence"),
        runtimeMode,
        expectedVersion: 0,
        payload: { value: "v1" },
        actor,
        transition: "CREATE",
      }),
    );
    expect(create.ok).toBe(true);
    const loadedA = persistence.loadState<{ value: string }>(stateId, runtimeMode);
    const loadedB = persistence.loadState<{ value: string }>(stateId, runtimeMode);
    expect(loadedA.ok && loadedA.value.version).toBe(1);
    expect(loadedB.ok && loadedB.value.version).toBe(1);

    const updateA = await persistence.execute({ runtimeMode }, (tx) =>
      persistence.saveState(tx, {
        stateId,
        stateDomain: stateDomain("reference.state"),
        owner: stateOwner("persistence"),
        runtimeMode,
        expectedVersion: loadedA.ok ? loadedA.value.version : 0,
        payload: { value: "v2" },
        actor,
        transition: "UPDATE",
      }),
    );
    expect(updateA.ok).toBe(true);
    const updateB = await persistence.execute({ runtimeMode }, (tx) =>
      persistence.saveState(tx, {
        stateId,
        stateDomain: stateDomain("reference.state"),
        owner: stateOwner("persistence"),
        runtimeMode,
        expectedVersion: loadedB.ok ? loadedB.value.version : 0,
        payload: { value: "stale" },
        actor,
        transition: "UPDATE",
      }),
    );
    expect(updateB.ok).toBe(true);
    expect(updateB.ok && updateB.value.ok).toBe(false);
    expect(updateB.ok && !updateB.value.ok ? updateB.value.error.code : undefined).toBe(
      "CONCURRENCY_CONFLICT",
    );

    expect(persistence.loadState(stateId, "LIVE").ok).toBe(false);
    const liveWrite = await persistence.execute({ runtimeMode: "LIVE" }, () => undefined);
    expect(liveWrite.ok).toBe(false);
    expect(liveWrite.ok ? undefined : liveWrite.error.code).toBe("ENVIRONMENT_ISOLATION_VIOLATION");

    const history = persistence.historyForState(stateId);
    expect(history).toHaveLength(2);
    expect(Object.isFrozen(history)).toBe(true);
    expect("updateHistory" in persistence).toBe(false);
    expect("deleteHistory" in persistence).toBe(false);

    const audit = await persistence.execute({ runtimeMode }, (tx) =>
      persistence.appendAudit(tx, {
        runtimeMode,
        actor,
        action: "REFERENCE_STATE_CONFIRMED",
        outcome: "SUCCESS",
        affectedResource: stateId,
        metadata: { safe: true },
      }),
    );
    expect(audit.ok).toBe(true);
    expect(persistence.auditRecords()).toHaveLength(1);
    expect("updateAudit" in persistence).toBe(false);
    expect("deleteAudit" in persistence).toBe(false);
  });

  it("dispatches transactional outbox through Prompt 4, preserves event identity, and recovers pending records after restart", async () => {
    const { persistence, store, runtimeMode, clock, idGenerator } = makePersistenceHarness();
    const { factory, bus } = makeEventHarness(clock, idGenerator, runtimeMode);
    let observed = 0;
    const subId = subscriptionId("persistent.subscriber");
    bus.register({
      subscriptionId: subId,
      subscriberId: "persistent-subscriber",
      description: "durable inbox subscriber",
      eventTypes: ["persistence.reference.changed.v1"],
      criticality: "REQUIRED",
      policy: defaultDeliveryPolicy,
      handler: (context) => {
        const key = context.event.metadata.idempotencyKey ?? context.event.envelope.eventId;
        const claim = persistence.claimInbox({
          subscriptionId: subId,
          idempotencyKey: key,
          eventId: context.event.envelope.eventId,
          runtimeMode,
        });
        expect(claim.ok).toBe(true);
        if (claim.ok && claim.value.duplicate) {
          return { status: "DUPLICATE_SKIPPED" };
        }
        observed += 1;
        persistence.markInboxSucceeded(subId, key);
        return { status: "SUCCESS" };
      },
    });
    const event = factory.createRootEvent({
      eventType: "persistence.reference.changed.v1",
      payload: { stateId: "reference", version: 1 },
      metadata: { idempotencyKey: "reference-effect" },
    });
    expect(event.ok).toBe(true);
    const committed = await persistence.execute({ runtimeMode }, (tx) =>
      persistence.appendOutbox(tx, event.ok ? event.value : (undefined as never)),
    );
    expect(committed.ok).toBe(true);
    const dispatch = await persistence.dispatchOutbox(bus);
    expect(dispatch.published).toBe(1);
    expect(observed).toBe(1);

    const restartedPersistence = new InMemoryPersistenceEngine(
      store,
      clock,
      idGenerator,
      persistence.authority,
      { runtimeMode },
    );
    restartedPersistence.connect();
    const { bus: restartedBus } = makeEventHarness(clock, idGenerator, runtimeMode);
    restartedBus.register({
      subscriptionId: subId,
      subscriberId: "persistent-subscriber",
      description: "durable inbox subscriber after restart",
      eventTypes: ["persistence.reference.changed.v1"],
      criticality: "REQUIRED",
      policy: defaultDeliveryPolicy,
      handler: (context) => {
        const key = context.event.metadata.idempotencyKey ?? context.event.envelope.eventId;
        const claim = restartedPersistence.claimInbox({
          subscriptionId: subId,
          idempotencyKey: key,
          eventId: context.event.envelope.eventId,
          runtimeMode,
        });
        if (claim.ok && claim.value.duplicate) {
          return { status: "DUPLICATE_SKIPPED" };
        }
        observed += 1;
        restartedPersistence.markInboxSucceeded(subId, key);
        return { status: "SUCCESS" };
      },
    });
    const duplicate = await restartedBus.publish(event.ok ? event.value : (undefined as never));
    expect(duplicate.duplicateSkips).toBe(1);
    expect(observed).toBe(1);
  });

  it("recovers stale inbox claims and persists dead letters across restart with explicit replay metadata", () => {
    const { persistence, store, runtimeMode, clock, idGenerator } = makePersistenceHarness(
      "SIMULATION",
      {
        inboxProcessingLeaseMs: 1,
      },
    );
    const subId = subscriptionId("stale.inbox");
    const first = persistence.claimInbox({
      subscriptionId: subId,
      idempotencyKey: "key",
      eventId: "50000000-0000-4000-8000-000000000301" as never,
      runtimeMode,
    });
    expect(first.ok).toBe(true);
    clock.now();
    clock.now();
    const recovered = persistence.claimInbox({
      subscriptionId: subId,
      idempotencyKey: "key",
      eventId: "50000000-0000-4000-8000-000000000301" as never,
      runtimeMode,
    });
    expect(recovered.ok && recovered.value.recoveredStaleClaim).toBe(true);

    const { factory } = makeEventHarness(clock, idGenerator, runtimeMode);
    const event = factory.createRootEvent({
      eventType: "persistence.reference.changed.v1",
      payload: { stateId: "dead-letter", version: 1 },
    });
    expect(event.ok).toBe(true);
    const persisted = persistence.persistDeadLetter({
      event: event.ok ? event.value : (undefined as never),
      subscriptionId: subId,
      failure: persistenceError({
        code: "OUTBOX_DISPATCH_FAILED",
        message: "safe failure",
        timestamp: clock.now(),
      }),
      attempts: 2,
      firstFailureAt: clock.now(),
      finalFailureAt: clock.now(),
      correlationId: event.ok ? event.value.envelope.correlationId : (undefined as never),
      subscriberId: "stale-inbox",
      runtimeMode,
      replayCount: 0,
    });
    expect(persisted.ok).toBe(true);
    const restartedPersistence = new InMemoryPersistenceEngine(
      store,
      clock,
      idGenerator,
      persistence.authority,
      { runtimeMode },
    );
    restartedPersistence.connect();
    expect(restartedPersistence.deadLetters()).toHaveLength(1);
    const replayed = restartedPersistence.markDeadLetterReplayed(
      persisted.ok ? persisted.value.deadLetterId : (undefined as never),
    );
    expect(replayed.ok && replayed.value.replayCount).toBe(1);
  });

  it("integrates with runtime lifecycle, reports connection loss, closes cleanly, and keeps diagnostics secret-safe", async () => {
    const { persistence, store, runtimeMode } = makePersistenceHarness("SIMULATION");
    const runtimeResult = buildRuntime({
      runtimeInstanceId: "50000000-0000-4000-8000-000000000401",
      runtimeVersion: "0.5.0-persistence.1",
      mode: runtimeMode,
      services: [createPersistenceRuntimeService(persistence)],
    });
    expect(runtimeResult.ok).toBe(true);
    const runtime = runtimeResult.ok ? runtimeResult.runtime : (undefined as never);
    const started = await runtime.start();
    expect(started.ok).toBe(true);
    expect(started.readiness.status).toBe("READY");
    persistence.setConnected(false);
    expect(persistence.snapshot().health).toBe("UNHEALTHY");
    const stopped = await runtime.stop();
    expect(stopped.ok).toBe(true);

    store.connected = false;
    const failingPersistence = new InMemoryPersistenceEngine(
      store,
      fakeClock(),
      () => ids[450] ?? ids.at(-1)!,
      persistence.authority,
      { runtimeMode },
    );
    const failed = failingPersistence.connect();
    expect(failed.ok).toBe(false);
    const diagnosticsText = JSON.stringify(failingPersistence.snapshot());
    expect(diagnosticsText).not.toMatch(/password|postgres:\/\/user:secret/iu);
  });

  it("prevents persistence dependency inversion and forbidden infrastructure coupling", () => {
    const domainSources = readdirSync(join(root, "packages/domain/src"))
      .filter((file) => file.endsWith(".ts"))
      .map((file) => readFileSync(join(root, "packages/domain/src", file), "utf8"))
      .join("\n");
    expect(domainSources).not.toContain("@ate/persistence");

    const eventSources = readdirSync(join(root, "packages/events/src"))
      .filter((file) => file.endsWith(".ts"))
      .map((file) => readFileSync(join(root, "packages/events/src", file), "utf8"))
      .join("\n");
    expect(eventSources).not.toContain("@ate/persistence");
    expect(eventSources.toLowerCase()).not.toContain("postgres");

    const persistenceSources = readdirSync(join(root, "packages/persistence/src"))
      .filter((file) => file.endsWith(".ts"))
      .map((file) => readFileSync(join(root, "packages/persistence/src", file), "utf8"))
      .join("\n")
      .toLowerCase();
    for (const forbidden of [
      "react",
      "mt5",
      "mql5",
      "metatrader",
      "broker sdk",
      "market-data sdk",
    ]) {
      expect(persistenceSources).not.toContain(forbidden);
    }
  });
});
