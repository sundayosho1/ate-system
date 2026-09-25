import { runtimeModes } from "@ate/domain";
import type { Clock } from "@ate/time";

import { configurationKey } from "./keys.js";
import { configurationSchemaFromDefinition, type ConfigurationSchema } from "./schema-types.js";
import type { ConfigurationDefinition, ConfigurationKey } from "./types.js";

export const foundationalConfigurationKey = (value: string, clock: Clock): ConfigurationKey => {
  const parsed = configurationKey(value, clock.now());
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return parsed.value;
};

export const foundationalConfigurationDefinitions = (
  clock: Clock,
): readonly ConfigurationDefinition[] => [
  {
    key: foundationalConfigurationKey("system.runtimeMode", clock),
    domain: "SYSTEM",
    displayName: "Runtime Mode",
    description: "Canonical runtime mode used to isolate configuration by environment.",
    valueType: "ENUM",
    required: true,
    failClosed: true,
    allowedScopes: ["SYSTEM", "ENVIRONMENT"],
    mergePolicy: "REPLACE",
    sensitivity: "INTERNAL",
    metadata: {
      purpose: "Tie managed configuration to Prompt 3 runtime modes.",
      riskImplication: "A missing or mismatched runtime mode must block readiness.",
      reloadRequirement: "RESTART",
    },
  },
  {
    key: foundationalConfigurationKey("system.logLevel", clock),
    domain: "SYSTEM",
    displayName: "Log Level",
    description: "Bootstrap-visible operational log level once managed configuration is available.",
    valueType: "ENUM",
    required: false,
    failClosed: false,
    allowedScopes: ["SYSTEM", "ENVIRONMENT"],
    mergePolicy: "REPLACE",
    sensitivity: "INTERNAL",
    defaultValue: "info",
    metadata: {
      purpose: "Document a safe managed home for log-level configuration.",
      reloadRequirement: "REFRESH",
    },
  },
  {
    key: foundationalConfigurationKey("system.configurationCacheMaxEntries", clock),
    domain: "SYSTEM",
    displayName: "Configuration Cache Max Entries",
    description: "Bounded non-authoritative effective-configuration cache size.",
    valueType: "INTEGER",
    required: false,
    failClosed: false,
    allowedScopes: ["SYSTEM", "ENVIRONMENT"],
    mergePolicy: "REPLACE",
    sensitivity: "INTERNAL",
    defaultValue: 100,
    metadata: {
      purpose: "Prevent unbounded cache growth.",
      riskImplication: "Cache misses affect performance, not configuration authority.",
      reloadRequirement: "RESTART",
    },
  },
  {
    key: foundationalConfigurationKey("data.defaultFreshnessPolicy", clock),
    domain: "DATA",
    displayName: "Default Freshness Policy",
    description:
      "Foundational data freshness policy container; Prompt 8 will add complete schema validation.",
    valueType: "OBJECT",
    required: false,
    failClosed: false,
    allowedScopes: ["SYSTEM", "ENVIRONMENT", "BROKER", "ASSET_CLASS", "INSTRUMENT", "TIMEFRAME"],
    mergePolicy: "REPLACE",
    sensitivity: "INTERNAL",
    metadata: {
      purpose: "Prepare data services to consume freshness configuration from one authority.",
      riskImplication: "Future stale data handling must fail closed where safety-critical.",
      reloadRequirement: "REFRESH",
    },
  },
  {
    key: foundationalConfigurationKey("execution.maxRetryAttempts", clock),
    domain: "EXECUTION",
    displayName: "Maximum Retry Attempts",
    description:
      "Foundational execution retry setting definition for future services; no execution engine is implemented.",
    valueType: "INTEGER",
    required: false,
    failClosed: false,
    allowedScopes: ["SYSTEM", "ENVIRONMENT", "BROKER", "ACCOUNT", "INSTRUMENT", "EXECUTION"],
    mergePolicy: "REPLACE",
    sensitivity: "INTERNAL",
    metadata: {
      purpose: "Ensure future retry defaults are declared centrally instead of in modules.",
      riskImplication: "Retry settings can affect duplicate or stale future commands.",
      reloadRequirement: "RESTART",
    },
  },
  {
    key: foundationalConfigurationKey("surveillance.scanIntervalMs", clock),
    domain: "SURVEILLANCE",
    displayName: "Surveillance Scan Interval",
    description:
      "Foundational surveillance interval definition for future MOSE/surveillance services only.",
    valueType: "DURATION_MS",
    required: false,
    failClosed: false,
    allowedScopes: [
      "SYSTEM",
      "ENVIRONMENT",
      "ASSET_CLASS",
      "INSTRUMENT",
      "TIMEFRAME",
      "REGIME",
      "STRATEGY",
      "SURVEILLANCE",
    ],
    mergePolicy: "REPLACE",
    sensitivity: "INTERNAL",
    metadata: {
      purpose: "Show how future surveillance settings resolve without implementing surveillance.",
      reloadRequirement: "REFRESH",
    },
  },
  {
    key: foundationalConfigurationKey(
      "system.feature.configurationHistoryInspectionEnabled",
      clock,
    ),
    domain: "SYSTEM",
    displayName: "Configuration History Inspection Feature",
    description:
      "Enables read-only inspection of configuration version history through capability control diagnostics.",
    valueType: "BOOLEAN",
    required: false,
    failClosed: false,
    allowedScopes: ["SYSTEM", "ENVIRONMENT"],
    mergePolicy: "REPLACE",
    sensitivity: "INTERNAL",
    defaultValue: true,
    metadata: {
      purpose: "Provide an implemented optional capability controlled by managed configuration.",
      effect: "Toggles read-only historical configuration inspection surfaces.",
      riskImplication: "Disabling it removes diagnostics only; it cannot disable version history.",
      reloadRequirement: "REFRESH",
    },
  },
  {
    key: foundationalConfigurationKey("system.feature.capabilityDiagnosticsEnabled", clock),
    domain: "SYSTEM",
    displayName: "Capability Diagnostics Feature",
    description:
      "Enables capability-control diagnostics derived from the registry and effective configuration.",
    valueType: "BOOLEAN",
    required: false,
    failClosed: false,
    allowedScopes: ["SYSTEM", "ENVIRONMENT"],
    mergePolicy: "REPLACE",
    sensitivity: "INTERNAL",
    defaultValue: true,
    metadata: {
      purpose: "Expose safe capability-state diagnostics without creating a second config engine.",
      effect: "Toggles operator-facing capability diagnostics.",
      riskImplication: "Restart is required so observers cannot see mixed diagnostic policy.",
      reloadRequirement: "RESTART",
    },
  },
];

export const foundationalConfigurationSchemas = (clock: Clock): readonly ConfigurationSchema[] => {
  const definitions = foundationalConfigurationDefinitions(clock);
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
  const runtimeMode = foundationalConfigurationKey("system.runtimeMode", clock);
  const logLevel = foundationalConfigurationKey("system.logLevel", clock);
  const cacheMaxEntries = foundationalConfigurationKey(
    "system.configurationCacheMaxEntries",
    clock,
  );
  const freshnessPolicy = foundationalConfigurationKey("data.defaultFreshnessPolicy", clock);
  const maxRetryAttempts = foundationalConfigurationKey("execution.maxRetryAttempts", clock);
  const scanInterval = foundationalConfigurationKey("surveillance.scanIntervalMs", clock);
  const historyInspection = foundationalConfigurationKey(
    "system.feature.configurationHistoryInspectionEnabled",
    clock,
  );
  const capabilityDiagnostics = foundationalConfigurationKey(
    "system.feature.capabilityDiagnosticsEnabled",
    clock,
  );

  return [
    configurationSchemaFromDefinition(requireDefinition(byKey, runtimeMode), {
      constraints: { enumValues: runtimeModes },
      crossFieldRules: [
        {
          ruleId: "RUNTIME_MODE_MATCHES_CONTEXT",
          keys: [runtimeMode],
          message: "system.runtimeMode must match the effective resolution runtime context",
        },
      ],
      metadata: {
        ...requireDefinition(byKey, runtimeMode).metadata,
        helpText: "Choose one Prompt 3 runtime mode and keep environment overrides isolated.",
        examples: ["SIMULATION", "PAPER", "LIVE"],
      },
    }),
    configurationSchemaFromDefinition(requireDefinition(byKey, logLevel), {
      constraints: { enumValues: ["trace", "debug", "info", "warn", "error"] },
      metadata: {
        ...requireDefinition(byKey, logLevel).metadata,
        helpText: "Controls operational logging verbosity after managed configuration loads.",
        examples: ["info", "warn"],
      },
    }),
    configurationSchemaFromDefinition(requireDefinition(byKey, cacheMaxEntries), {
      constraints: { minimum: 1, maximum: 10_000, unit: "count" },
      metadata: {
        ...requireDefinition(byKey, cacheMaxEntries).metadata,
        helpText: "Bounds the non-authoritative effective-configuration cache.",
        examples: [100, 500],
        invalidExamples: [0, 100_001],
        units: "entries",
      },
    }),
    configurationSchemaFromDefinition(requireDefinition(byKey, freshnessPolicy), {
      constraints: {
        requiredProperties: ["maxAgeMs", "staleAction"],
        allowUnknownProperties: false,
        properties: {
          maxAgeMs: {
            valueType: "DURATION_MS",
            required: true,
            constraints: { minimum: 1, maximum: 86_400_000, unit: "milliseconds" },
          },
          staleAction: {
            valueType: "ENUM",
            required: true,
            constraints: { enumValues: ["FAIL_CLOSED", "WARN", "IGNORE"] },
          },
        },
      },
      metadata: {
        ...requireDefinition(byKey, freshnessPolicy).metadata,
        helpText:
          "Declares foundational data freshness shape without implementing market-data services.",
        examples: [{ maxAgeMs: 1_000, staleAction: "FAIL_CLOSED" }],
      },
    }),
    configurationSchemaFromDefinition(requireDefinition(byKey, maxRetryAttempts), {
      constraints: { minimum: 0, maximum: 10, unit: "count" },
      metadata: {
        ...requireDefinition(byKey, maxRetryAttempts).metadata,
        helpText: "Caps future execution retry attempts without implementing an execution engine.",
        examples: [0, 3],
        invalidExamples: [-1, 50],
      },
    }),
    configurationSchemaFromDefinition(requireDefinition(byKey, scanInterval), {
      constraints: { minimum: 1_000, maximum: 3_600_000, unit: "milliseconds" },
      metadata: {
        ...requireDefinition(byKey, scanInterval).metadata,
        helpText:
          "Bounds future surveillance scan intervals without implementing MOSE or surveillance.",
        examples: [5_000, 60_000],
      },
    }),
    configurationSchemaFromDefinition(requireDefinition(byKey, historyInspection), {
      metadata: {
        ...requireDefinition(byKey, historyInspection).metadata,
        helpText:
          "Controls read-only configuration history inspection; it cannot enable approval, promotion, rollback or trading.",
        examples: [true, false],
      },
    }),
    configurationSchemaFromDefinition(requireDefinition(byKey, capabilityDiagnostics), {
      metadata: {
        ...requireDefinition(byKey, capabilityDiagnostics).metadata,
        helpText:
          "Controls capability diagnostics visibility. Changes are restart-required by Prompt 10 policy.",
        examples: [true, false],
      },
    }),
  ];
};

const requireDefinition = (
  definitions: ReadonlyMap<ConfigurationKey, ConfigurationDefinition>,
  key: ConfigurationKey,
): ConfigurationDefinition => {
  const definition = definitions.get(key);
  if (definition === undefined) {
    throw new Error(`missing foundational configuration definition: ${key}`);
  }
  return definition;
};
