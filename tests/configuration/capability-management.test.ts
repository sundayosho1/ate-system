import type { UtcTimestamp } from "@ate/domain";
import { EventRegistry } from "@ate/events";
import { StateAuthorityRegistry } from "@ate/persistence";
import { mustParseUtc, VirtualClock } from "@ate/time";
import {
  buildConfigurationSnapshot,
  capabilityId,
  CapabilityRegistry,
  configurationEntry,
  configurationEventRegistrations,
  configurationSourceId,
  ConfigurationRegistry,
  ConfigurationResolver,
  ConfigurationSchemaRegistry,
  createConfigurationCapabilityService,
  evaluateCapabilities,
  featureFlagId,
  FeatureFlagRegistry,
  foundationalCapabilityDefinitions,
  foundationalConfigurationDefinitions,
  foundationalConfigurationKey,
  foundationalConfigurationSchemas,
  foundationalFeatureFlagDefinitions,
  registerCapabilityDefinitions,
  registerConfigurationCapabilityControlStateAuthority,
  registerConfigurationSchemas,
  registerConfigurationStateAuthority,
  registerConfigurationVersionHistoryStateAuthority,
  registerFeatureFlagDefinitions,
  StaticConfigurationSource,
  type CapabilityDefinition,
  type ConfigurationEntry,
  type ConfigurationKey,
  type FeatureFlagDefinition,
} from "@ate/configuration";
import { describe, expect, it } from "vitest";

const utc = (value: string): UtcTimestamp => mustParseUtc(value);

const makeClock = () => new VirtualClock(utc("2026-09-25T10:00:00.000Z"));

const key = (value: string, clock: VirtualClock): ConfigurationKey =>
  foundationalConfigurationKey(value, clock);

const registerConfiguration = (clock: VirtualClock) => {
  const configurationRegistry = new ConfigurationRegistry(clock);
  for (const definition of foundationalConfigurationDefinitions(clock)) {
    expect(configurationRegistry.register(definition).ok).toBe(true);
  }
  const schemaRegistry = new ConfigurationSchemaRegistry(clock);
  expect(
    registerConfigurationSchemas(schemaRegistry, foundationalConfigurationSchemas(clock)).ok,
  ).toBe(true);
  return { configurationRegistry, schemaRegistry };
};

const registerCapabilities = (clock: VirtualClock) => {
  const capabilityRegistry = new CapabilityRegistry(clock);
  expect(registerCapabilityDefinitions(capabilityRegistry).ok).toBe(true);
  const flagRegistry = new FeatureFlagRegistry(clock, capabilityRegistry);
  expect(
    registerFeatureFlagDefinitions(flagRegistry, foundationalFeatureFlagDefinitions(clock)).ok,
  ).toBe(true);
  return { capabilityRegistry, flagRegistry };
};

const source = (
  clock: VirtualClock,
  entries: readonly Omit<ConfigurationEntry, "source" | "loadedAt">[],
  sourceId = "capability-test",
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

const resolvedConfiguration = async (
  clock: VirtualClock,
  entries: readonly Omit<ConfigurationEntry, "source" | "loadedAt">[],
) => {
  const { configurationRegistry, schemaRegistry } = registerConfiguration(clock);
  const snapshot = await buildConfigurationSnapshot({
    registry: configurationRegistry,
    clock,
    sources: [source(clock, entries)],
  });
  expect(snapshot.ok).toBe(true);
  const effective = new ConfigurationResolver(
    configurationRegistry,
    snapshot.ok ? snapshot.value : (undefined as never),
    clock,
  ).resolve({ runtimeMode: "SIMULATION" });
  expect(effective.ok).toBe(true);
  return {
    schemaRegistry,
    effective: effective.ok ? effective.value : (undefined as never),
  };
};

describe("Prompt 10 feature flags and capability management", () => {
  it("registers truthful capability and feature-flag definitions and rejects unsafe registry records", () => {
    const clock = makeClock();
    const { capabilityRegistry, flagRegistry } = registerCapabilities(clock);

    expect(capabilityRegistry.all().map((definition) => definition.capabilityId)).toEqual(
      expect.arrayContaining([
        capabilityId("configuration.capabilityControl"),
        capabilityId("data.marketData"),
        capabilityId("execution.mt5"),
        capabilityId("execution.liveTrading"),
      ]),
    );
    const liveTrading = capabilityRegistry.require(capabilityId("execution.liveTrading"));
    expect(liveTrading.ok ? liveTrading.value.implementationStatus : undefined).toBe(
      "NOT_IMPLEMENTED",
    );
    expect(flagRegistry.require(featureFlagId("configuration.historyInspection")).ok).toBe(true);
    expect(capabilityRegistry.register(foundationalCapabilityDefinitions()[0]!).ok).toBe(false);

    const unsafeMandatoryFlag: CapabilityDefinition = {
      capabilityId: capabilityId("configuration.unsafeMandatoryToggle"),
      displayName: "Unsafe Mandatory Toggle",
      description: "Test-only invalid mandatory flag.",
      owner: "@ate/configuration",
      capabilityClass: "MANDATORY_CORE",
      implementationStatus: "IMPLEMENTED",
      reloadBehavior: "DYNAMIC",
      supportedRuntimeModes: ["SIMULATION"],
      featureFlagId: featureFlagId("configuration.historyInspection"),
      versionIntroduced: "test",
    };
    expect(new CapabilityRegistry(clock).register(unsafeMandatoryFlag).ok).toBe(false);
  });

  it("evaluates flags from managed configuration without disabling mandatory core capabilities", async () => {
    const clock = makeClock();
    const { capabilityRegistry, flagRegistry } = registerCapabilities(clock);
    const { effective, schemaRegistry } = await resolvedConfiguration(clock, [
      configurationEntry({
        key: key("system.runtimeMode", clock),
        scopeType: "SYSTEM",
        value: "SIMULATION",
      }),
      configurationEntry({
        key: key("system.feature.configurationHistoryInspectionEnabled", clock),
        scopeType: "SYSTEM",
        value: false,
      }),
      configurationEntry({
        key: key("system.feature.capabilityDiagnosticsEnabled", clock),
        scopeType: "SYSTEM",
        value: true,
      }),
    ]);

    const first = evaluateCapabilities({
      capabilityRegistry,
      featureFlagRegistry: flagRegistry,
      evaluation: {
        runtimeMode: "SIMULATION",
        effectiveConfiguration: effective,
        now: clock.now(),
        schemaFingerprint: schemaRegistry.fingerprint(),
      },
    });
    const second = evaluateCapabilities({
      capabilityRegistry,
      featureFlagRegistry: flagRegistry,
      evaluation: {
        runtimeMode: "SIMULATION",
        effectiveConfiguration: effective,
        now: clock.now(),
        schemaFingerprint: schemaRegistry.fingerprint(),
      },
    });

    expect(first.ok).toBe(true);
    expect(first.ok && second.ok ? first.value.fingerprint : undefined).toBe(
      second.ok ? second.value.fingerprint : undefined,
    );
    const capabilities = new Map(
      (first.ok ? first.value.capabilities : []).map((capability) => [
        capability.capabilityId,
        capability,
      ]),
    );
    expect(capabilities.get(capabilityId("configuration.schemaValidation"))?.state).toBe("ENABLED");
    expect(capabilities.get(capabilityId("configuration.historyInspection"))?.state).toBe(
      "DISABLED",
    );
    expect(capabilities.get(capabilityId("configuration.capabilityDiagnostics"))?.state).toBe(
      "ENABLED",
    );
    expect(first.ok ? Object.isFrozen(first.value.capabilities[0]) : false).toBe(true);
  });

  it("fails closed for unimplemented, environment-blocked, dependent, conflicting and restart-required capabilities", () => {
    const clock = makeClock();
    const capabilityRegistry = new CapabilityRegistry(clock);
    const future = capabilityId("execution.futureRequested");
    const dependent = capabilityId("configuration.experimentalDependent");
    const researchOnly = capabilityId("configuration.researchOnly");
    const conflictA = capabilityId("configuration.conflictA");
    const conflictB = capabilityId("configuration.conflictB");
    const restartFeature = capabilityId("configuration.restartFeature");
    const definitions: readonly CapabilityDefinition[] = [
      testCapability(future, {
        capabilityClass: "FUTURE_UNIMPLEMENTED",
        implementationStatus: "NOT_IMPLEMENTED",
        featureFlagId: featureFlagId("configuration.futureRequested"),
      }),
      testCapability(dependent, {
        dependencies: [future],
        featureFlagId: featureFlagId("configuration.dependent"),
      }),
      testCapability(researchOnly, {
        supportedRuntimeModes: ["RESEARCH"],
        featureFlagId: featureFlagId("configuration.researchOnly"),
      }),
      testCapability(conflictA, {
        conflictsWith: [conflictB],
        featureFlagId: featureFlagId("configuration.conflictA"),
      }),
      testCapability(conflictB, {
        featureFlagId: featureFlagId("configuration.conflictB"),
      }),
      testCapability(restartFeature, {
        reloadBehavior: "RESTART_REQUIRED",
        featureFlagId: featureFlagId("configuration.restartFeature"),
      }),
    ];
    for (const definition of definitions) {
      expect(capabilityRegistry.register(definition).ok).toBe(true);
    }
    expect(capabilityRegistry.validateGraph().ok).toBe(true);
    const flagRegistry = new FeatureFlagRegistry(clock, capabilityRegistry);
    for (const definition of definitions) {
      expect(
        flagRegistry.register(
          testFlag(
            definition.featureFlagId ?? featureFlagId("configuration.unused"),
            definition.capabilityId,
            clock,
          ),
        ).ok,
      ).toBe(true);
    }

    const effectiveConfiguration = {
      snapshotId: "cfgsnap-test" as never,
      fingerprint: "sha256:capability-test" as never,
      values: new Map(
        flagRegistry.all().map((flag) => [flag.key, { value: true, present: true }] as const),
      ),
    };
    const evaluated = evaluateCapabilities({
      capabilityRegistry,
      featureFlagRegistry: flagRegistry,
      evaluation: {
        runtimeMode: "LIVE",
        effectiveConfiguration,
        now: clock.now(),
        appliedFeatureFlags: { "configuration.restartFeature": false },
      },
    });

    expect(evaluated.ok).toBe(true);
    const capabilities = new Map(
      (evaluated.ok ? evaluated.value.capabilities : []).map((capability) => [
        capability.capabilityId,
        capability,
      ]),
    );
    expect(capabilities.get(future)?.state).toBe("UNAVAILABLE");
    expect(capabilities.get(future)?.reasonCodes).toContain("NOT_IMPLEMENTED");
    expect(capabilities.get(dependent)?.state).toBe("BLOCKED");
    expect(capabilities.get(dependent)?.reasonCodes).toContain("DEPENDENCY_UNAVAILABLE");
    expect(capabilities.get(researchOnly)?.state).toBe("BLOCKED");
    expect(capabilities.get(conflictA)?.state).toBe("BLOCKED");
    expect(capabilities.get(restartFeature)?.pendingRestart).toBe(true);
    expect(capabilities.get(restartFeature)?.reasonCodes).toContain("RESTART_REQUIRED");
  });

  it("detects dependency cycles and required service degradation", async () => {
    const clock = makeClock();
    const first = capabilityId("configuration.firstCycle");
    const second = capabilityId("configuration.secondCycle");
    const cyclicRegistry = new CapabilityRegistry(clock);
    expect(cyclicRegistry.register(testCapability(first, { dependencies: [second] })).ok).toBe(
      true,
    );
    expect(cyclicRegistry.register(testCapability(second, { dependencies: [first] })).ok).toBe(
      true,
    );
    expect(cyclicRegistry.validateGraph().ok).toBe(false);

    const { capabilityRegistry, flagRegistry } = registerCapabilities(clock);
    const { effective } = await resolvedConfiguration(clock, [
      configurationEntry({
        key: key("system.runtimeMode", clock),
        scopeType: "SYSTEM",
        value: "SIMULATION",
      }),
    ]);
    const evaluated = evaluateCapabilities({
      capabilityRegistry,
      featureFlagRegistry: flagRegistry,
      evaluation: {
        runtimeMode: "SIMULATION",
        effectiveConfiguration: effective,
        now: clock.now(),
        serviceReadiness: { configuration: "NOT_READY" },
      },
    });
    expect(evaluated.ok).toBe(true);
    expect(
      evaluated.ok
        ? evaluated.value.capabilities.find(
            (capability) => capability.capabilityId === capabilityId("configuration.hierarchical"),
          )?.state
        : undefined,
    ).toBe("DEGRADED");
  });

  it("exposes runtime service diagnostics, explanations, safe events and state authority", async () => {
    const clock = makeClock();
    const { capabilityRegistry, flagRegistry } = registerCapabilities(clock);
    const { effective, schemaRegistry } = await resolvedConfiguration(clock, [
      configurationEntry({
        key: key("system.runtimeMode", clock),
        scopeType: "SYSTEM",
        value: "SIMULATION",
      }),
    ]);
    const service = createConfigurationCapabilityService({
      runtimeMode: "SIMULATION",
      clock,
      capabilityRegistry,
      featureFlagRegistry: flagRegistry,
    });
    const evaluated = service.evaluate({
      runtimeMode: "SIMULATION",
      effectiveConfiguration: effective,
      now: clock.now(),
      schemaFingerprint: schemaRegistry.fingerprint(),
    });
    expect(evaluated.ok).toBe(true);
    expect(service.checkReadiness().status).toBe("READY");
    expect(service.diagnostics().enabledCount).toBeGreaterThan(0);
    const explanation = service.explain(capabilityId("configuration.capabilityControl"));
    expect(explanation.ok).toBe(true);
    expect(explanation.ok ? explanation.value.schemaFingerprint : undefined).toBe(
      schemaRegistry.fingerprint(),
    );

    const eventRegistry = new EventRegistry(clock);
    for (const registration of configurationEventRegistrations) {
      expect(eventRegistry.register(registration).ok).toBe(true);
    }
    expect(eventRegistry.all().map((registration) => registration.eventType)).toEqual(
      expect.arrayContaining([
        "configuration.capability.snapshot-published.v1",
        "configuration.capability.blocked.v1",
      ]),
    );

    const authority = new StateAuthorityRegistry(clock);
    expect(registerConfigurationStateAuthority(authority, ["SIMULATION"]).ok).toBe(true);
    expect(registerConfigurationVersionHistoryStateAuthority(authority, ["SIMULATION"]).ok).toBe(
      true,
    );
    expect(registerConfigurationCapabilityControlStateAuthority(authority, ["SIMULATION"]).ok).toBe(
      true,
    );
    expect(authority.all().map((entry) => entry.stateDomain)).toEqual(
      expect.arrayContaining([
        "configuration.controlplane",
        "configuration.versionhistory",
        "configuration.capabilitycontrol",
      ]),
    );
  });
});

const testCapability = (
  id: ReturnType<typeof capabilityId>,
  overrides: Partial<CapabilityDefinition> = {},
): CapabilityDefinition => ({
  capabilityId: id,
  displayName: id,
  description: "Prompt 10 capability-control test definition.",
  owner: "@ate/configuration",
  capabilityClass: "OPTIONAL",
  implementationStatus: "IMPLEMENTED",
  reloadBehavior: "DYNAMIC",
  supportedRuntimeModes: ["DEVELOPMENT", "RESEARCH", "BACKTEST", "SIMULATION", "PAPER", "LIVE"],
  versionIntroduced: "test",
  ...overrides,
});

const testFlag = (
  flagIdValue: ReturnType<typeof featureFlagId>,
  controlledCapability: ReturnType<typeof capabilityId>,
  clock: VirtualClock,
): FeatureFlagDefinition => ({
  flagId: flagIdValue,
  key: key(`system.feature.${flagIdValue.split(".").at(-1) ?? "unknown"}Enabled`, clock),
  displayName: flagIdValue,
  description: "Prompt 10 feature-flag test definition.",
  defaultEnabled: false,
  controls: [controlledCapability],
  reloadBehavior: flagIdValue.endsWith("restartFeature") ? "RESTART_REQUIRED" : "DYNAMIC",
  owner: "@ate/configuration",
});
