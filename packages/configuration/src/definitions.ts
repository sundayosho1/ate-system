import type { Clock } from "@ate/time";

import { configurationKey } from "./keys.js";
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
];
