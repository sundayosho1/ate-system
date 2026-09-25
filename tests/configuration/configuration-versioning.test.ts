import type { Actor, UtcTimestamp } from "@ate/domain";
import { EventRegistry } from "@ate/events";
import {
  buildConfigurationSnapshot,
  configurationEntry,
  configurationEventRegistrations,
  configurationSchemaFromDefinition,
  configurationSourceId,
  ConfigurationRegistry,
  ConfigurationSchemaRegistry,
  createConfigurationVersionService,
  createEmptyConfigurationVersionStore,
  foundationalConfigurationDefinitions,
  foundationalConfigurationKey,
  foundationalConfigurationSchemas,
  InMemoryConfigurationVersionRepository,
  registerConfigurationSchemas,
  registerConfigurationStateAuthority,
  registerConfigurationVersionHistoryStateAuthority,
  StaticConfigurationSource,
  type ConfigurationDefinition,
  type ConfigurationEntry,
  type ConfigurationKey,
} from "@ate/configuration";
import { StateAuthorityRegistry } from "@ate/persistence";
import { mustParseUtc, VirtualClock } from "@ate/time";
import { describe, expect, it } from "vitest";

const utc = (value: string): UtcTimestamp => mustParseUtc(value);

const makeClock = () => new VirtualClock(utc("2026-09-25T09:00:00.000Z"));

const actor: Actor = {
  actorType: "SERVICE",
  displayName: "configuration-version-test",
};

const key = (value: string, clock: VirtualClock): ConfigurationKey =>
  foundationalConfigurationKey(value, clock);

const registerDefinitions = (clock: VirtualClock): ConfigurationRegistry => {
  const registry = new ConfigurationRegistry(clock);
  for (const definition of foundationalConfigurationDefinitions(clock)) {
    expect(registry.register(definition).ok).toBe(true);
  }
  return registry;
};

const registerSchemas = (clock: VirtualClock): ConfigurationSchemaRegistry => {
  const registry = new ConfigurationSchemaRegistry(clock);
  expect(registerConfigurationSchemas(registry, foundationalConfigurationSchemas(clock)).ok).toBe(
    true,
  );
  return registry;
};

const source = (
  clock: VirtualClock,
  entries: readonly Omit<ConfigurationEntry, "source" | "loadedAt">[],
  sourceId = "version-test",
) =>
  new StaticConfigurationSource({
    clock,
    descriptor: {
      sourceId: configurationSourceId(sourceId),
      sourceType: "TEST",
      name: sourceId,
      criticality: "REQUIRED",
      failurePolicy: "FAIL_CLOSED",
      priority: 0,
    },
    entries,
  });

const snapshot = async (clock: VirtualClock, registry: ConfigurationRegistry, logLevel: string) =>
  buildConfigurationSnapshot({
    registry,
    clock,
    sources: [
      source(clock, [
        configurationEntry({
          key: key("system.runtimeMode", clock),
          scopeType: "SYSTEM",
          value: "SIMULATION",
        }),
        configurationEntry({
          key: key("system.logLevel", clock),
          scopeType: "SYSTEM",
          value: logLevel,
        }),
      ]),
    ],
  });

const versioning = (clock: VirtualClock) => {
  const registry = registerDefinitions(clock);
  const schemaRegistry = registerSchemas(clock);
  const repository = new InMemoryConfigurationVersionRepository({
    clock,
    runtimeMode: "SIMULATION",
    schemaRegistry,
    store: createEmptyConfigurationVersionStore(),
  });
  const service = createConfigurationVersionService({
    runtimeMode: "SIMULATION",
    clock,
    registry,
    schemaRegistry,
    repository,
  });
  return { registry, schemaRegistry, repository, service };
};

describe("Prompt 9 immutable configuration versioning and history", () => {
  it("creates an immutable root version with attribution, schema, snapshot and integrity", async () => {
    const clock = makeClock();
    const { registry, schemaRegistry, repository, service } = versioning(clock);
    const firstSnapshot = await snapshot(clock, registry, "info");
    expect(firstSnapshot.ok).toBe(true);

    const root = service.createVersion({
      snapshot: firstSnapshot.ok ? firstSnapshot.value : (undefined as never),
      schemaFingerprint: schemaRegistry.fingerprint(),
      actor,
      origin: "MIGRATION",
      reason: "Bootstrap current Prompt 8 configuration as first historical version",
      idempotencyKey: "bootstrap-v1",
    });

    expect(root.ok).toBe(true);
    expect(root.ok ? root.value.sequence : undefined).toBe(1);
    expect(root.ok ? root.value.parentVersionId : "unexpected").toBeUndefined();
    expect(root.ok ? root.value.schemaFingerprint : undefined).toBe(schemaRegistry.fingerprint());
    expect(root.ok ? root.value.configurationSnapshotId : undefined).toBe(
      firstSnapshot.ok ? firstSnapshot.value.snapshotId : undefined,
    );
    expect(root.ok ? root.value.actor.displayName : undefined).toBe(actor.displayName);
    expect(
      root.ok ? root.value.changeSet.operations.map((operation) => operation.operation) : [],
    ).toContain("ADD");
    expect(repository.getCurrent(root.ok ? root.value.streamId : (undefined as never)).ok).toBe(
      true,
    );
    expect(
      repository.verifyIntegrity(root.ok ? root.value.versionId : (undefined as never)).ok,
    ).toBe(true);
    expect(service.checkReadiness().status).toBe("READY");
  });

  it("creates child versions, lineages and deterministic directional semantic diffs", async () => {
    const clock = makeClock();
    const { registry, schemaRegistry, repository, service } = versioning(clock);
    const rootSnapshot = await snapshot(clock, registry, "info");
    const root = service.createVersion({
      snapshot: rootSnapshot.ok ? rootSnapshot.value : (undefined as never),
      schemaFingerprint: schemaRegistry.fingerprint(),
      actor,
      origin: "MIGRATION",
      reason: "Initial version",
    });
    expect(root.ok).toBe(true);
    const childSnapshot = await snapshot(clock, registry, "warn");
    const child = service.createVersion({
      snapshot: childSnapshot.ok ? childSnapshot.value : (undefined as never),
      schemaFingerprint: schemaRegistry.fingerprint(),
      expectedParentVersionId: root.ok ? root.value.versionId : (undefined as never),
      actor,
      origin: "OPERATOR",
      reason: "Change log level for operational visibility",
    });

    expect(child.ok).toBe(true);
    expect(child.ok ? child.value.parentVersionId : undefined).toBe(
      root.ok ? root.value.versionId : undefined,
    );
    expect(child.ok ? child.value.sequence : undefined).toBe(2);
    const lineage = repository.lineage(child.ok ? child.value.versionId : (undefined as never));
    expect(lineage.ok ? lineage.value.map((version) => version.versionId) : []).toEqual([
      root.ok ? root.value.versionId : undefined,
      child.ok ? child.value.versionId : undefined,
    ]);
    const forward = service.diff(
      root.ok ? root.value.versionId : (undefined as never),
      child.ok ? child.value.versionId : (undefined as never),
    );
    const reverse = service.diff(
      child.ok ? child.value.versionId : (undefined as never),
      root.ok ? root.value.versionId : (undefined as never),
    );
    expect(forward.ok ? forward.value.changed.map((entry) => entry.key) : []).toContain(
      key("system.logLevel", clock),
    );
    expect(reverse.ok ? reverse.value.changed.map((entry) => entry.key) : []).toContain(
      key("system.logLevel", clock),
    );
    expect(forward.ok && reverse.ok && forward.value.fingerprint).not.toBe(
      reverse.ok ? reverse.value.fingerprint : undefined,
    );
  });

  it("rejects stale expected parents, no-op changes, and invalid schema candidates", async () => {
    const clock = makeClock();
    const { registry, schemaRegistry, service } = versioning(clock);
    const rootSnapshot = await snapshot(clock, registry, "info");
    const root = service.createVersion({
      snapshot: rootSnapshot.ok ? rootSnapshot.value : (undefined as never),
      schemaFingerprint: schemaRegistry.fingerprint(),
      actor,
      origin: "MIGRATION",
      reason: "Initial version",
    });
    expect(root.ok).toBe(true);
    const childSnapshot = await snapshot(clock, registry, "warn");
    const child = service.createVersion({
      snapshot: childSnapshot.ok ? childSnapshot.value : (undefined as never),
      schemaFingerprint: schemaRegistry.fingerprint(),
      expectedParentVersionId: root.ok ? root.value.versionId : (undefined as never),
      actor,
      origin: "OPERATOR",
      reason: "Change log level",
    });
    expect(child.ok).toBe(true);

    const stale = service.createVersion({
      snapshot: await awaitSnapshot(clock, registry, "debug"),
      schemaFingerprint: schemaRegistry.fingerprint(),
      expectedParentVersionId: root.ok ? root.value.versionId : (undefined as never),
      actor,
      origin: "OPERATOR",
      reason: "Stale write attempt",
    });
    expect(stale.ok ? undefined : stale.error.code).toBe(
      "CONFIGURATION_VERSION_CONCURRENCY_CONFLICT",
    );

    const noOp = service.createVersion({
      snapshot: childSnapshot.ok ? childSnapshot.value : (undefined as never),
      schemaFingerprint: schemaRegistry.fingerprint(),
      expectedParentVersionId: child.ok ? child.value.versionId : (undefined as never),
      actor,
      origin: "OPERATOR",
      reason: "No semantic change",
    });
    expect(noOp.ok ? undefined : noOp.error.code).toBe("CONFIGURATION_VERSION_NO_SEMANTIC_CHANGE");

    const invalid = await buildConfigurationSnapshot({
      registry,
      clock,
      sources: [
        source(clock, [
          configurationEntry({
            key: key("system.runtimeMode", clock),
            scopeType: "SYSTEM",
            value: "SIMULATION",
          }),
          configurationEntry({
            key: key("system.logLevel", clock),
            scopeType: "SYSTEM",
            value: "verbose",
          }),
        ]),
      ],
    });
    const invalidVersion = service.createVersion({
      snapshot: invalid.ok ? invalid.value : (undefined as never),
      schemaFingerprint: schemaRegistry.fingerprint(),
      expectedParentVersionId: child.ok ? child.value.versionId : (undefined as never),
      actor,
      origin: "OPERATOR",
      reason: "Invalid version attempt",
    });
    expect(invalidVersion.ok ? undefined : invalidVersion.error.code).toBe(
      "CONFIGURATION_VALIDATION_FAILED",
    );
  });

  it("deduplicates idempotent submissions without collapsing distinct version identity", async () => {
    const clock = makeClock();
    const { registry, schemaRegistry, service } = versioning(clock);
    const rootSnapshot = await snapshot(clock, registry, "info");
    const first = service.createVersion({
      snapshot: rootSnapshot.ok ? rootSnapshot.value : (undefined as never),
      schemaFingerprint: schemaRegistry.fingerprint(),
      actor,
      origin: "MIGRATION",
      reason: "Initial version",
      idempotencyKey: "same-operation",
    });
    const duplicate = service.createVersion({
      snapshot: rootSnapshot.ok ? rootSnapshot.value : (undefined as never),
      schemaFingerprint: schemaRegistry.fingerprint(),
      actor,
      origin: "MIGRATION",
      reason: "Initial version duplicate",
      idempotencyKey: "same-operation",
    });

    expect(first.ok && duplicate.ok && duplicate.value.versionId).toBe(
      first.ok ? first.value.versionId : undefined,
    );
  });

  it("reconstructs historical versions and creates a new version from old content without rollback", async () => {
    const clock = makeClock();
    const { registry, schemaRegistry, service } = versioning(clock);
    const rootSnapshot = await snapshot(clock, registry, "info");
    const root = service.createVersion({
      snapshot: rootSnapshot.ok ? rootSnapshot.value : (undefined as never),
      schemaFingerprint: schemaRegistry.fingerprint(),
      actor,
      origin: "MIGRATION",
      reason: "Initial version",
    });
    const childSnapshot = await snapshot(clock, registry, "warn");
    const child = service.createVersion({
      snapshot: childSnapshot.ok ? childSnapshot.value : (undefined as never),
      schemaFingerprint: schemaRegistry.fingerprint(),
      expectedParentVersionId: root.ok ? root.value.versionId : (undefined as never),
      actor,
      origin: "OPERATOR",
      reason: "Change log level",
    });
    expect(root.ok && child.ok).toBe(true);

    const reconstructed = service.reconstruct(
      root.ok ? root.value.versionId : (undefined as never),
    );
    expect(reconstructed.ok).toBe(true);
    expect(reconstructed.ok ? reconstructed.value.integrity.ok : false).toBe(true);
    expect(reconstructed.ok ? reconstructed.value.snapshot.fingerprint : undefined).toBe(
      root.ok ? root.value.configurationFingerprint : undefined,
    );
    const derived = service.createCandidateFromVersion(
      root.ok ? root.value.versionId : (undefined as never),
      {
        schemaFingerprint: schemaRegistry.fingerprint(),
        expectedParentVersionId: child.ok ? child.value.versionId : (undefined as never),
        actor,
        origin: "OPERATOR",
        reason: "Create new historical candidate from root content without rollback activation",
      },
    );
    expect(derived.ok).toBe(true);
    expect(derived.ok ? derived.value.parentVersionId : undefined).toBe(
      child.ok ? child.value.versionId : undefined,
    );
    expect(derived.ok ? derived.value.derivedFromVersionId : undefined).toBe(
      root.ok ? root.value.versionId : undefined,
    );
    expect(derived.ok ? derived.value.configurationFingerprint : undefined).toBe(
      root.ok ? root.value.configurationFingerprint : undefined,
    );
    expect(derived.ok ? derived.value.versionId : undefined).not.toBe(
      root.ok ? root.value.versionId : undefined,
    );
  });

  it("redacts secret references from version payloads and diffs", async () => {
    const clock = makeClock();
    const registry = registerDefinitions(clock);
    const schemaRegistry = registerSchemas(clock);
    const secretDefinition: ConfigurationDefinition = {
      key: key("system.databaseSecretRef", clock),
      domain: "SYSTEM",
      displayName: "Database Secret Reference",
      description: "Secret reference versioning test.",
      valueType: "SECRET_REFERENCE",
      required: false,
      failClosed: false,
      allowedScopes: ["SYSTEM"],
      mergePolicy: "REPLACE",
      sensitivity: "SECRET_REFERENCE",
    };
    expect(registry.register(secretDefinition).ok).toBe(true);
    expect(
      registerConfigurationSchemas(schemaRegistry, [
        configurationSchemaFromDefinition(secretDefinition, {
          constraints: { secretRefPattern: "^secret/" },
        }),
      ]).ok,
    ).toBe(true);
    const repository = new InMemoryConfigurationVersionRepository({
      clock,
      runtimeMode: "SIMULATION",
      schemaRegistry,
      store: createEmptyConfigurationVersionStore(),
    });
    const service = createConfigurationVersionService({
      runtimeMode: "SIMULATION",
      clock,
      registry,
      schemaRegistry,
      repository,
    });
    const secretSnapshot = await buildConfigurationSnapshot({
      registry,
      clock,
      sources: [
        source(clock, [
          configurationEntry({
            key: key("system.runtimeMode", clock),
            scopeType: "SYSTEM",
            value: "SIMULATION",
          }),
          configurationEntry({
            key: secretDefinition.key,
            scopeType: "SYSTEM",
            value: { kind: "SECRET_REFERENCE", ref: "secret/prod/db", provider: "test" },
          }),
        ]),
      ],
    });
    const version = service.createVersion({
      snapshot: secretSnapshot.ok ? secretSnapshot.value : (undefined as never),
      schemaFingerprint: schemaRegistry.fingerprint(),
      actor,
      origin: "TEST",
      reason: "Secret redaction history test",
    });
    expect(version.ok).toBe(true);
    expect(JSON.stringify(version.ok ? version.value : {})).not.toContain("secret/prod/db");
    expect(JSON.stringify(version.ok ? version.value.changeSet : {})).toContain("[REDACTED]");
  });

  it("registers version state authority and safe version events without future workflows", () => {
    const clock = makeClock();
    const authority = new StateAuthorityRegistry(clock);
    expect(registerConfigurationStateAuthority(authority, ["SIMULATION"]).ok).toBe(true);
    expect(registerConfigurationVersionHistoryStateAuthority(authority, ["SIMULATION"]).ok).toBe(
      true,
    );
    expect(authority.all().map((entry) => entry.stateDomain)).toEqual(
      expect.arrayContaining(["configuration.controlplane", "configuration.versionhistory"]),
    );

    const eventRegistry = new EventRegistry(clock);
    for (const registration of configurationEventRegistrations) {
      expect(eventRegistry.register(registration).ok).toBe(true);
    }
    expect(eventRegistry.all().map((registration) => registration.eventType)).toEqual(
      expect.arrayContaining([
        "configuration.version.created.v1",
        "configuration.version.integrity_failed.v1",
      ]),
    );
  });
});

const awaitSnapshot = async (
  clock: VirtualClock,
  registry: ConfigurationRegistry,
  logLevel: string,
) => {
  const built = await snapshot(clock, registry, logLevel);
  if (!built.ok) {
    throw new Error(built.error.message);
  }
  return built.value;
};
