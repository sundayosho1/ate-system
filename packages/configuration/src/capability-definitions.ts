import { runtimeModes } from "@ate/domain";
import { clockRuntimeServiceId, type Clock } from "@ate/time";

import { foundationalConfigurationKey } from "./definitions.js";
import { configurationServiceId } from "./runtime-service.js";
import { configurationVersionServiceId } from "./version-service.js";
import { capabilityId, featureFlagId } from "./capability-registry.js";
import type { CapabilityRegistry, FeatureFlagRegistry } from "./capability-registry.js";
import type { CapabilityDefinition, FeatureFlagDefinition } from "./capability-types.js";
import type { ConfigurationResult } from "./types.js";

export const foundationalCapabilityDefinitions = (): readonly CapabilityDefinition[] => {
  const runtimeLifecycle = capabilityId("runtime.lifecycle");
  const eventsInternalBus = capabilityId("events.internalBus");
  const persistenceStateAuthority = capabilityId("persistence.stateAuthority");
  const timeClockAuthority = capabilityId("time.clockAuthority");
  const configurationHierarchical = capabilityId("configuration.hierarchical");
  const configurationSchemaValidation = capabilityId("configuration.schemaValidation");
  const configurationVersioning = capabilityId("configuration.versioning");
  const configurationCapabilityControl = capabilityId("configuration.capabilityControl");
  const configurationRelease = capabilityId("configuration.release");
  const configurationHistoryInspection = capabilityId("configuration.historyInspection");
  const configurationCapabilityDiagnostics = capabilityId("configuration.capabilityDiagnostics");
  const dataMarketDataContracts = capabilityId("data.marketDataContracts");
  const dataMarketData = capabilityId("data.marketData");
  const executionMt5 = capabilityId("execution.mt5");
  const executionLiveTrading = capabilityId("execution.liveTrading");

  return [
    {
      capabilityId: runtimeLifecycle,
      displayName: "Runtime Lifecycle",
      description: "Prompt 3 lifecycle orchestration, dependency validation and service snapshots.",
      owner: "@ate/runtime",
      capabilityClass: "MANDATORY_CORE",
      implementationStatus: "IMPLEMENTED",
      reloadBehavior: "STARTUP_ONLY",
      supportedRuntimeModes: runtimeModes,
      versionIntroduced: "0.3.0-runtime.1",
    },
    {
      capabilityId: eventsInternalBus,
      displayName: "Internal Event Bus",
      description: "Prompt 4 typed in-process event registry, factory, routing and diagnostics.",
      owner: "@ate/events",
      capabilityClass: "MANDATORY_CORE",
      implementationStatus: "IMPLEMENTED",
      reloadBehavior: "STARTUP_ONLY",
      supportedRuntimeModes: runtimeModes,
      versionIntroduced: "0.4.0-events.1",
    },
    {
      capabilityId: persistenceStateAuthority,
      displayName: "Persistence State Authority",
      description:
        "Prompt 5 state authority, transactions, history, audit and durability contracts.",
      owner: "@ate/persistence",
      capabilityClass: "MANDATORY_CORE",
      implementationStatus: "IMPLEMENTED",
      reloadBehavior: "STARTUP_ONLY",
      supportedRuntimeModes: runtimeModes,
      versionIntroduced: "0.5.0-persistence.1",
    },
    {
      capabilityId: timeClockAuthority,
      displayName: "Clock Authority",
      description: "Prompt 6 UTC clock authority, monotonic duration and deterministic scheduler.",
      owner: "@ate/time",
      capabilityClass: "MANDATORY_CORE",
      implementationStatus: "IMPLEMENTED",
      reloadBehavior: "STARTUP_ONLY",
      supportedRuntimeModes: runtimeModes,
      requiredServices: [clockRuntimeServiceId],
      versionIntroduced: "0.6.0-time.1",
    },
    {
      capabilityId: configurationHierarchical,
      displayName: "Hierarchical Configuration",
      description: "Prompt 7 deterministic configuration resolution, snapshots and provenance.",
      owner: "@ate/configuration",
      capabilityClass: "MANDATORY_CORE",
      implementationStatus: "IMPLEMENTED",
      reloadBehavior: "STARTUP_ONLY",
      supportedRuntimeModes: runtimeModes,
      requiredServices: [configurationServiceId],
      versionIntroduced: "0.7.0-config.1",
    },
    {
      capabilityId: configurationSchemaValidation,
      displayName: "Configuration Schema Validation",
      description: "Prompt 8 schema validation and invalid-candidate publication gates.",
      owner: "@ate/configuration",
      capabilityClass: "MANDATORY_CORE",
      implementationStatus: "IMPLEMENTED",
      reloadBehavior: "STARTUP_ONLY",
      supportedRuntimeModes: runtimeModes,
      dependencies: [configurationHierarchical],
      versionIntroduced: "0.8.0-config-schema.1",
    },
    {
      capabilityId: configurationVersioning,
      displayName: "Configuration Versioning",
      description: "Prompt 9 immutable configuration version history and reconstruction.",
      owner: "@ate/configuration",
      capabilityClass: "MANDATORY_CORE",
      implementationStatus: "IMPLEMENTED",
      reloadBehavior: "STARTUP_ONLY",
      supportedRuntimeModes: runtimeModes,
      dependencies: [configurationSchemaValidation],
      requiredServices: [configurationVersionServiceId],
      versionIntroduced: "0.9.0-config-versioning.1",
    },
    {
      capabilityId: configurationCapabilityControl,
      displayName: "Capability Control",
      description: "Prompt 10 build-truth capability registry and feature-flag evaluation.",
      owner: "@ate/configuration",
      capabilityClass: "MANDATORY_CORE",
      implementationStatus: "IMPLEMENTED",
      reloadBehavior: "STARTUP_ONLY",
      supportedRuntimeModes: runtimeModes,
      dependencies: [configurationVersioning],
      versionIntroduced: "0.10.0-capabilities.1",
    },
    {
      capabilityId: configurationRelease,
      displayName: "Configuration Release Governance",
      description:
        "Prompt 12 controlled configuration promotion, activation, known-good and rollback authority.",
      owner: "@ate/configuration",
      capabilityClass: "MANDATORY_CORE",
      implementationStatus: "IMPLEMENTED",
      reloadBehavior: "STARTUP_ONLY",
      supportedRuntimeModes: runtimeModes,
      dependencies: [configurationCapabilityControl],
      versionIntroduced: "0.12.0-config-promotion.1",
      safetyNotes:
        "Environment promotion governs configuration only and does not authorize paper or live trading.",
    },
    {
      capabilityId: configurationHistoryInspection,
      displayName: "Configuration History Inspection",
      description:
        "Read-only inspection of configuration history; it does not activate rollback or approval workflows.",
      owner: "@ate/configuration",
      capabilityClass: "OPTIONAL",
      implementationStatus: "IMPLEMENTED",
      reloadBehavior: "DYNAMIC",
      supportedRuntimeModes: runtimeModes,
      dependencies: [configurationVersioning],
      featureFlagId: featureFlagId("configuration.historyInspection"),
      versionIntroduced: "0.10.0-capabilities.1",
    },
    {
      capabilityId: configurationCapabilityDiagnostics,
      displayName: "Capability Diagnostics",
      description: "Safe capability-state diagnostics for operators and tests.",
      owner: "@ate/configuration",
      capabilityClass: "OPTIONAL",
      implementationStatus: "IMPLEMENTED",
      reloadBehavior: "RESTART_REQUIRED",
      supportedRuntimeModes: runtimeModes,
      dependencies: [configurationCapabilityControl],
      featureFlagId: featureFlagId("configuration.capabilityDiagnostics"),
      versionIntroduced: "0.10.0-capabilities.1",
    },
    {
      capabilityId: dataMarketDataContracts,
      displayName: "Universal Market Data Contracts",
      description:
        "Prompt 13 provider-neutral canonical market-data observation, quote, trade, tick, bar, status, provenance, correction and serialization contracts.",
      owner: "@ate/domain",
      capabilityClass: "MANDATORY_CORE",
      implementationStatus: "IMPLEMENTED",
      reloadBehavior: "STARTUP_ONLY",
      supportedRuntimeModes: runtimeModes,
      versionIntroduced: "0.13.0-market-data-contracts.1",
      safetyNotes:
        "Contracts only; no provider ingestion, historical storage, replay, strategy, risk, execution or trading authority.",
    },
    {
      capabilityId: dataMarketData,
      displayName: "Market Data Ingestion",
      description: "Future market-data ingestion capability; not implemented in Prompt 13.",
      owner: "future-market-data",
      capabilityClass: "FUTURE_UNIMPLEMENTED",
      implementationStatus: "NOT_IMPLEMENTED",
      reloadBehavior: "STARTUP_ONLY",
      supportedRuntimeModes: runtimeModes,
      dependencies: [dataMarketDataContracts],
      versionIntroduced: "future",
    },
    {
      capabilityId: executionMt5,
      displayName: "MT5 Connectivity",
      description: "Future MetaTrader 5 connectivity capability; not implemented in Prompt 10.",
      owner: "future-execution",
      capabilityClass: "FUTURE_UNIMPLEMENTED",
      implementationStatus: "NOT_IMPLEMENTED",
      reloadBehavior: "STARTUP_ONLY",
      supportedRuntimeModes: runtimeModes,
      versionIntroduced: "future",
    },
    {
      capabilityId: executionLiveTrading,
      displayName: "Live Trading",
      description: "Future capital-bearing live trading capability; not implemented in Prompt 10.",
      owner: "future-execution",
      capabilityClass: "FUTURE_UNIMPLEMENTED",
      implementationStatus: "NOT_IMPLEMENTED",
      reloadBehavior: "STARTUP_ONLY",
      supportedRuntimeModes: ["LIVE"],
      dependencies: [dataMarketData, executionMt5],
      versionIntroduced: "future",
      safetyNotes:
        "Feature flags cannot enable this capability until a later prompt implements the required trading authorities.",
    },
  ];
};

export const foundationalFeatureFlagDefinitions = (
  clock: Clock,
): readonly FeatureFlagDefinition[] => [
  {
    flagId: featureFlagId("configuration.historyInspection"),
    key: foundationalConfigurationKey(
      "system.feature.configurationHistoryInspectionEnabled",
      clock,
    ),
    displayName: "Configuration History Inspection",
    description: "Managed flag for read-only configuration history inspection.",
    defaultEnabled: true,
    controls: [capabilityId("configuration.historyInspection")],
    reloadBehavior: "DYNAMIC",
    owner: "@ate/configuration",
    safetyNotes: "Does not enable rollback, promotion, maker-checker approval or trading.",
  },
  {
    flagId: featureFlagId("configuration.capabilityDiagnostics"),
    key: foundationalConfigurationKey("system.feature.capabilityDiagnosticsEnabled", clock),
    displayName: "Capability Diagnostics",
    description: "Managed flag for safe capability diagnostics.",
    defaultEnabled: true,
    controls: [capabilityId("configuration.capabilityDiagnostics")],
    reloadBehavior: "RESTART_REQUIRED",
    owner: "@ate/configuration",
  },
];

export const registerCapabilityDefinitions = (
  registry: CapabilityRegistry,
  definitions: readonly CapabilityDefinition[] = foundationalCapabilityDefinitions(),
): ConfigurationResult<readonly CapabilityDefinition[]> => {
  for (const definition of definitions) {
    const registered = registry.register(definition);
    if (!registered.ok) {
      return registered;
    }
  }
  return registry.validateGraph();
};

export const registerFeatureFlagDefinitions = (
  registry: FeatureFlagRegistry,
  definitions: readonly FeatureFlagDefinition[],
): ConfigurationResult<readonly FeatureFlagDefinition[]> => {
  for (const definition of definitions) {
    const registered = registry.register(definition);
    if (!registered.ok) {
      return registered;
    }
  }
  return { ok: true, value: registry.all() };
};
