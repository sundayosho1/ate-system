import type { Actor, SourceId, UtcTimestamp } from "@ate/domain";
import { EventFactory, EventRegistry, InternalEventBus } from "@ate/events";
import { buildRuntime } from "@ate/runtime";
import {
  buildConfigurationSnapshot,
  configurationEntry,
  configurationSchemaFromDefinition,
  configurationSourceId,
  ConfigurationRegistry,
  ConfigurationResolver,
  ConfigurationSchemaRegistry,
  createConfigurationRuntimeService,
  foundationalConfigurationDefinitions,
  foundationalConfigurationKey,
  foundationalConfigurationSchemas,
  registerConfigurationSchemas,
  registerConfigurationStateAuthority,
  StaticConfigurationSource,
  validateConfigurationSnapshot,
  validateEffectiveConfiguration,
  type ConfigurationDefinition,
  type ConfigurationEntry,
  type ConfigurationKey,
} from "@ate/configuration";
import { StateAuthorityRegistry } from "@ate/persistence";
import { createClockRuntimeService, durationMs, mustParseUtc, VirtualClock } from "@ate/time";
import { describe, expect, it } from "vitest";

const utc = (value: string): UtcTimestamp => mustParseUtc(value);

const makeClock = () => new VirtualClock(utc("2026-09-25T08:00:00.000Z"));

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
  const result = registerConfigurationSchemas(registry, foundationalConfigurationSchemas(clock));
  expect(result.ok).toBe(true);
  return registry;
};

const source = (
  clock: VirtualClock,
  entries: readonly Omit<ConfigurationEntry, "source" | "loadedAt">[],
  sourceId = "schema-test",
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

describe("Prompt 8 configuration schema, validation, and rejection gates", () => {
  it("registers deterministic schemas, rejects invalid defaults, and exposes help metadata", () => {
    const clock = makeClock();
    const schemaRegistry = registerSchemas(clock);
    const schemaFingerprint = schemaRegistry.fingerprint();
    const secondRegistry = registerSchemas(clock);

    expect(schemaRegistry.keys()).toEqual(
      foundationalConfigurationDefinitions(clock)
        .map((definition) => definition.key)
        .sort(),
    );
    expect(schemaFingerprint).toBe(secondRegistry.fingerprint());
    const logLevelSchema = schemaRegistry.require(key("system.logLevel", clock));
    expect(logLevelSchema.ok).toBe(true);
    expect(logLevelSchema.ok ? logLevelSchema.value.metadata?.helpText : undefined).toContain(
      "logging",
    );

    const invalid = new ConfigurationSchemaRegistry(clock);
    const definition = foundationalConfigurationDefinitions(clock).find(
      (candidate) => candidate.key === key("system.configurationCacheMaxEntries", clock),
    );
    if (definition === undefined) {
      throw new Error("missing cache schema definition");
    }
    const registered = invalid.register(
      configurationSchemaFromDefinition(definition, {
        defaultValue: 0,
        constraints: { minimum: 1, maximum: 10 },
      }),
    );
    expect(registered.ok).toBe(false);
    expect(registered.ok ? undefined : registered.error.code).toBe("CONFIGURATION_SCHEMA_INVALID");
  });

  it("validates source entries for type, enum, range, object shape, and safe reports", async () => {
    const clock = makeClock();
    const registry = registerDefinitions(clock);
    const schemaRegistry = registerSchemas(clock);
    const snapshot = await buildConfigurationSnapshot({
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
          configurationEntry({
            key: key("system.configurationCacheMaxEntries", clock),
            scopeType: "SYSTEM",
            value: 0,
          }),
          configurationEntry({
            key: key("data.defaultFreshnessPolicy", clock),
            scopeType: "SYSTEM",
            value: { maxAgeMs: 0, staleAction: "DROP", unknown: true },
          }),
        ]),
      ],
    });

    expect(snapshot.ok).toBe(true);
    const report = validateConfigurationSnapshot({
      schemaRegistry,
      snapshot: snapshot.ok ? snapshot.value : (undefined as never),
      clock,
    });

    expect(report.publicationAllowed).toBe(false);
    expect(report.summary.phaseCounts.CONSTRAINT).toBeGreaterThanOrEqual(4);
    expect(report.issues.map((issue) => issue.constraint)).toEqual(
      expect.arrayContaining(["enumValues", "minimum", "allowUnknownProperties"]),
    );
    expect(JSON.stringify(report)).not.toContain("plain-secret");
  });

  it("rejects invalid runtime candidates atomically and preserves last-known-good", async () => {
    const clock = makeClock();
    const registry = registerDefinitions(clock);
    const schemaRegistry = registerSchemas(clock);
    const runtimeMode = key("system.runtimeMode", clock);
    const logLevel = key("system.logLevel", clock);
    const service = createConfigurationRuntimeService({
      runtimeMode: "SIMULATION",
      clock,
      registry,
      schemaRegistry,
      sources: [
        source(clock, [
          configurationEntry({ key: runtimeMode, scopeType: "SYSTEM", value: "SIMULATION" }),
          configurationEntry({ key: logLevel, scopeType: "SYSTEM", value: "info" }),
        ]),
      ],
    });

    expect((await service.initialize()).ok).toBe(true);
    expect(service.checkReadiness().status).toBe("READY");

    const rejected = await service.refresh([
      source(clock, [
        configurationEntry({ key: runtimeMode, scopeType: "SYSTEM", value: "PAPER" }),
        configurationEntry({ key: logLevel, scopeType: "SYSTEM", value: "verbose" }),
      ]),
    ]);

    expect(rejected.ok).toBe(false);
    expect(rejected.ok ? undefined : rejected.error.code).toBe("CONFIGURATION_VALIDATION_FAILED");
    expect(service.diagnostics().schema?.lastReportSummary?.blockingIssueCount).toBeGreaterThan(0);
    const resolved = service.resolve({ runtimeMode: "SIMULATION" });
    expect(resolved.ok ? resolved.value.values.get(runtimeMode)?.value : undefined).toBe(
      "SIMULATION",
    );
  });

  it("reports dependency, conditional, mutual exclusion, and cross-field violations", async () => {
    const clock = makeClock();
    const registry = registerDefinitions(clock);
    const schemaRegistry = registerSchemas(clock);
    const primaryRegion = customDefinition(clock, "system.primaryRegion");
    const secondaryRegion = customDefinition(clock, "system.secondaryRegion");
    const liveOnlyNotice = customDefinition(clock, "system.liveOnlyNotice");
    for (const definition of [primaryRegion, secondaryRegion, liveOnlyNotice]) {
      expect(registry.register(definition).ok).toBe(true);
    }
    expect(
      registerConfigurationSchemas(schemaRegistry, [
        configurationSchemaFromDefinition(primaryRegion, {
          constraints: { minLength: 2 },
          mutuallyExclusiveWith: [{ key: secondaryRegion.key }],
        }),
        configurationSchemaFromDefinition(secondaryRegion, {
          constraints: { minLength: 2 },
          dependencies: [{ key: liveOnlyNotice.key, required: true }],
          crossFieldRules: [
            {
              ruleId: "VALUES_MUST_DIFFER",
              keys: [primaryRegion.key, secondaryRegion.key],
            },
          ],
        }),
        configurationSchemaFromDefinition(liveOnlyNotice, {
          constraints: { minLength: 3 },
          conditionals: [
            {
              when: { key: key("system.runtimeMode", clock), equals: "LIVE" },
              then: { required: true },
            },
          ],
        }),
      ]),
    ).toMatchObject({ ok: true });

    const snapshot = await buildConfigurationSnapshot({
      registry,
      clock,
      sources: [
        source(clock, [
          configurationEntry({
            key: key("system.runtimeMode", clock),
            scopeType: "SYSTEM",
            value: "LIVE",
          }),
          configurationEntry({ key: primaryRegion.key, scopeType: "SYSTEM", value: "eu" }),
          configurationEntry({ key: secondaryRegion.key, scopeType: "SYSTEM", value: "eu" }),
        ]),
      ],
    });
    expect(snapshot.ok).toBe(true);
    const effective = new ConfigurationResolver(
      registry,
      snapshot.ok ? snapshot.value : (undefined as never),
      clock,
    ).resolve({ runtimeMode: "LIVE" });
    expect(effective.ok).toBe(true);

    const report = validateEffectiveConfiguration({
      schemaRegistry,
      effective: effective.ok ? effective.value : (undefined as never),
      clock,
    });

    expect(report.publicationAllowed).toBe(false);
    expect(report.issues.map((issue) => issue.phase)).toEqual(
      expect.arrayContaining(["DEPENDENCY", "CONDITIONAL", "CROSS_FIELD"]),
    );
  });

  it("integrates schema diagnostics with runtime, events, and state authority without trading features", async () => {
    const clock = makeClock();
    const registry = registerDefinitions(clock);
    const schemaRegistry = registerSchemas(clock);
    const configurationService = createConfigurationRuntimeService({
      runtimeMode: "SIMULATION",
      clock,
      registry,
      schemaRegistry,
      sources: [
        source(clock, [
          configurationEntry({
            key: key("system.runtimeMode", clock),
            scopeType: "SYSTEM",
            value: "SIMULATION",
          }),
        ]),
      ],
    });
    const timeService = createClockRuntimeService({
      clock,
      options: {
        runtimeMode: "SIMULATION",
        clockMode: "VIRTUAL",
        maximumFutureSkewMs: durationMs(1_000),
        clockJumpWarningThresholdMs: durationMs(500),
        clockJumpCriticalThresholdMs: durationMs(2_000),
        schedulerMaxTasks: 10,
      },
    });
    const runtime = buildRuntime({
      runtimeInstanceId: "80000000-0000-4000-8000-000000000001",
      runtimeVersion: "0.8.0-config-schema.1",
      mode: "SIMULATION",
      services: [timeService.managedService, configurationService.managedService],
      clock,
    });
    expect(runtime.ok).toBe(true);
    const started = await (runtime.ok
      ? runtime.runtime.start()
      : Promise.reject(new Error("runtime failed")));
    expect(started.ok).toBe(true);
    expect(started.readiness.status).toBe("READY");
    expect(configurationService.diagnostics().schema?.registeredSchemaCount).toBeGreaterThan(0);

    const eventRegistry = new EventRegistry(clock);
    const actor: Actor = { actorType: "SERVICE", displayName: "schema-test" };
    const factory = new EventFactory(eventRegistry, {
      runtimeMode: "SIMULATION",
      source: {
        sourceId: "80000000-0000-4000-8000-000000000900" as SourceId,
        sourceType: "SYSTEM",
        name: "configuration-schema-test",
      },
      actor,
      clock,
      idGenerator: () => "80000000-0000-4000-8000-000000000901",
      maxCausationDepth: 8,
    });
    const eventBus = new InternalEventBus({ registry: eventRegistry, factory, clock });
    eventBus.start();
    expect(eventBus.diagnostics().status).toBe("RUNNING");

    const authority = new StateAuthorityRegistry(clock);
    expect(registerConfigurationStateAuthority(authority, ["SIMULATION"]).ok).toBe(true);
    expect(authority.all()[0]?.writeAuthority).toBe("@ate/configuration");
  });
});

const customDefinition = (clock: VirtualClock, value: string): ConfigurationDefinition => ({
  key: key(value, clock),
  domain: "SYSTEM",
  displayName: value,
  description: "Prompt 8 validation test key.",
  valueType: "STRING",
  required: false,
  failClosed: false,
  allowedScopes: ["SYSTEM", "ENVIRONMENT"],
  mergePolicy: "REPLACE",
  sensitivity: "INTERNAL",
});
