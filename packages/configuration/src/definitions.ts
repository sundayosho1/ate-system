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
  {
    key: foundationalConfigurationKey("data.historical.maxArtifactBytes", clock),
    domain: "DATA",
    displayName: "Historical Data Maximum Artifact Bytes",
    description: "Maximum accepted historical source artifact size for offline laboratory imports.",
    valueType: "INTEGER",
    required: false,
    failClosed: true,
    allowedScopes: ["SYSTEM", "ENVIRONMENT"],
    mergePolicy: "REPLACE",
    sensitivity: "INTERNAL",
    defaultValue: 25 * 1024 * 1024,
    metadata: {
      purpose: "Bound untrusted historical source artifact intake.",
      riskImplication: "Unbounded historical files can exhaust parser and storage resources.",
      reloadRequirement: "RESTART",
    },
  },
  {
    key: foundationalConfigurationKey("data.historical.parserBatchSize", clock),
    domain: "DATA",
    displayName: "Historical Data Parser Batch Size",
    description: "Maximum parser batch size for controlled historical import processing.",
    valueType: "INTEGER",
    required: false,
    failClosed: true,
    allowedScopes: ["SYSTEM", "ENVIRONMENT"],
    mergePolicy: "REPLACE",
    sensitivity: "INTERNAL",
    defaultValue: 1000,
    metadata: {
      purpose: "Keep historical import processing bounded.",
      reloadRequirement: "RESTART",
    },
  },
  {
    key: foundationalConfigurationKey("data.historical.maxRejections", clock),
    domain: "DATA",
    displayName: "Historical Data Maximum Rejections",
    description: "Maximum record rejections collected before an import fails closed.",
    valueType: "INTEGER",
    required: false,
    failClosed: true,
    allowedScopes: ["SYSTEM", "ENVIRONMENT"],
    mergePolicy: "REPLACE",
    sensitivity: "INTERNAL",
    defaultValue: 1000,
    metadata: {
      purpose: "Bound rejection/quarantine evidence and prevent unbounded malformed imports.",
      reloadRequirement: "REFRESH",
    },
  },
  {
    key: foundationalConfigurationKey("data.historical.maxQueryPageSize", clock),
    domain: "DATA",
    displayName: "Historical Data Maximum Query Page Size",
    description: "Maximum page size for bounded historical research queries.",
    valueType: "INTEGER",
    required: false,
    failClosed: true,
    allowedScopes: ["SYSTEM", "ENVIRONMENT"],
    mergePolicy: "REPLACE",
    sensitivity: "INTERNAL",
    defaultValue: 5000,
    metadata: {
      purpose: "Prevent unbounded historical dataset reads.",
      reloadRequirement: "REFRESH",
    },
  },
  {
    key: foundationalConfigurationKey("data.historical.storageRoots", clock),
    domain: "DATA",
    displayName: "Historical Data Managed Storage Roots",
    description:
      "Managed staging and published dataset roots for local historical research storage.",
    valueType: "OBJECT",
    required: false,
    failClosed: true,
    allowedScopes: ["SYSTEM", "ENVIRONMENT"],
    mergePolicy: "REPLACE",
    sensitivity: "INTERNAL",
    defaultValue: {
      stagingRoot: ".ate/historical/staging",
      datasetRoot: ".ate/historical/datasets",
    },
    metadata: {
      purpose: "Keep filesystem-backed historical data inside configured managed roots.",
      riskImplication: "Raw filenames are never trusted as storage paths.",
      reloadRequirement: "RESTART",
    },
  },
  {
    key: foundationalConfigurationKey("data.quality.maxObservations", clock),
    domain: "DATA",
    displayName: "Data Quality Maximum Observations",
    description: "Maximum historical observations evaluated by one data-quality analysis report.",
    valueType: "INTEGER",
    required: false,
    failClosed: true,
    allowedScopes: ["SYSTEM", "ENVIRONMENT"],
    mergePolicy: "REPLACE",
    sensitivity: "INTERNAL",
    defaultValue: 100_000,
    metadata: {
      purpose: "Bound data-quality analysis work and report evidence volume.",
      riskImplication: "Partial analysis must be reported as insufficient evidence, never hidden.",
      reloadRequirement: "REFRESH",
    },
  },
  {
    key: foundationalConfigurationKey("data.quality.evidenceLimitPerRule", clock),
    domain: "DATA",
    displayName: "Data Quality Evidence Limit Per Rule",
    description: "Maximum findings retained per data-quality rule before suppression is counted.",
    valueType: "INTEGER",
    required: false,
    failClosed: true,
    allowedScopes: ["SYSTEM", "ENVIRONMENT"],
    mergePolicy: "REPLACE",
    sensitivity: "INTERNAL",
    defaultValue: 25,
    metadata: {
      purpose: "Keep data-quality reports bounded while exposing suppressed finding counts.",
      reloadRequirement: "REFRESH",
    },
  },
  {
    key: foundationalConfigurationKey("data.quality.defaultFreshnessMaxAgeMs", clock),
    domain: "DATA",
    displayName: "Data Quality Default Freshness Maximum Age",
    description: "Default age threshold used by historical data-quality freshness diagnostics.",
    valueType: "DURATION_MS",
    required: false,
    failClosed: true,
    allowedScopes: ["SYSTEM", "ENVIRONMENT", "INSTRUMENT", "TIMEFRAME"],
    mergePolicy: "REPLACE",
    sensitivity: "INTERNAL",
    defaultValue: 86_400_000,
    metadata: {
      purpose: "Declare freshness diagnostics centrally without authorizing trading decisions.",
      riskImplication:
        "Freshness findings are evidence for future consumers, not execution authority.",
      reloadRequirement: "REFRESH",
    },
  },
  {
    key: foundationalConfigurationKey("data.quality.reportStorageRoot", clock),
    domain: "DATA",
    displayName: "Data Quality Report Storage Root",
    description: "Managed root for staged and published immutable data-quality reports.",
    valueType: "STRING",
    required: false,
    failClosed: true,
    allowedScopes: ["SYSTEM", "ENVIRONMENT"],
    mergePolicy: "REPLACE",
    sensitivity: "INTERNAL",
    defaultValue: ".ate/data-quality/reports",
    metadata: {
      purpose: "Keep report staging and publication inside a managed storage root.",
      reloadRequirement: "RESTART",
    },
  },
  {
    key: foundationalConfigurationKey("data.catalogue.maxQueryPageSize", clock),
    domain: "DATA",
    displayName: "Dataset Catalogue Maximum Query Page Size",
    description: "Maximum number of dataset catalogue entries returned by one bounded query.",
    valueType: "INTEGER",
    required: false,
    failClosed: true,
    allowedScopes: ["SYSTEM", "ENVIRONMENT"],
    mergePolicy: "REPLACE",
    sensitivity: "INTERNAL",
    defaultValue: 1000,
    metadata: {
      purpose: "Prevent unbounded catalogue discovery reads.",
      riskImplication:
        "Unbounded catalogue queries can exhaust memory and obscure deterministic ordering.",
      reloadRequirement: "REFRESH",
    },
  },
  {
    key: foundationalConfigurationKey("data.catalogue.maxLineageDepth", clock),
    domain: "DATA",
    displayName: "Dataset Catalogue Maximum Lineage Depth",
    description: "Maximum traversal depth for ancestry, descendants and impact analysis.",
    valueType: "INTEGER",
    required: false,
    failClosed: true,
    allowedScopes: ["SYSTEM", "ENVIRONMENT"],
    mergePolicy: "REPLACE",
    sensitivity: "INTERNAL",
    defaultValue: 25,
    metadata: {
      purpose: "Bound lineage graph traversal.",
      riskImplication: "Unbounded lineage traversal can hide cycles or overload diagnostics.",
      reloadRequirement: "REFRESH",
    },
  },
  {
    key: foundationalConfigurationKey("data.catalogue.maxLineageNodes", clock),
    domain: "DATA",
    displayName: "Dataset Catalogue Maximum Lineage Nodes",
    description: "Maximum nodes returned by a lineage traversal or impact analysis.",
    valueType: "INTEGER",
    required: false,
    failClosed: true,
    allowedScopes: ["SYSTEM", "ENVIRONMENT"],
    mergePolicy: "REPLACE",
    sensitivity: "INTERNAL",
    defaultValue: 100,
    metadata: {
      purpose: "Keep lineage explanations bounded and deterministic.",
      reloadRequirement: "REFRESH",
    },
  },
  {
    key: foundationalConfigurationKey("data.catalogue.maxParentsPerDataset", clock),
    domain: "DATA",
    displayName: "Dataset Catalogue Maximum Parents Per Dataset",
    description: "Maximum governed parent dataset versions allowed during registration.",
    valueType: "INTEGER",
    required: false,
    failClosed: true,
    allowedScopes: ["SYSTEM", "ENVIRONMENT"],
    mergePolicy: "REPLACE",
    sensitivity: "INTERNAL",
    defaultValue: 16,
    metadata: {
      purpose: "Bound many-to-one lineage fan-in.",
      reloadRequirement: "REFRESH",
    },
  },
  {
    key: foundationalConfigurationKey("data.catalogue.requireQualityForQualification", clock),
    domain: "DATA",
    displayName: "Dataset Catalogue Require Quality For Qualification",
    description:
      "Requires a Prompt 15 quality report before catalogue eligibility can qualify data.",
    valueType: "BOOLEAN",
    required: false,
    failClosed: true,
    allowedScopes: ["SYSTEM", "ENVIRONMENT"],
    mergePolicy: "REPLACE",
    sensitivity: "INTERNAL",
    defaultValue: false,
    metadata: {
      purpose: "Control whether catalogue eligibility requires Prompt 15 evidence.",
      riskImplication: "Even when true, qualification remains non-trading evidence.",
      reloadRequirement: "REFRESH",
    },
  },
  {
    key: foundationalConfigurationKey("data.catalogue.requireVerifiedIntegrity", clock),
    domain: "DATA",
    displayName: "Dataset Catalogue Require Verified Integrity",
    description: "Requires verified integrity for eligible catalogue results.",
    valueType: "BOOLEAN",
    required: false,
    failClosed: true,
    allowedScopes: ["SYSTEM", "ENVIRONMENT"],
    mergePolicy: "REPLACE",
    sensitivity: "INTERNAL",
    defaultValue: true,
    metadata: {
      purpose: "Fail closed when registered dataset integrity cannot be verified.",
      reloadRequirement: "REFRESH",
    },
  },
  {
    key: foundationalConfigurationKey("data.catalogue.storageRoot", clock),
    domain: "DATA",
    displayName: "Dataset Catalogue Storage Root",
    description: "Managed root for local dataset catalogue metadata records.",
    valueType: "STRING",
    required: false,
    failClosed: true,
    allowedScopes: ["SYSTEM", "ENVIRONMENT"],
    mergePolicy: "REPLACE",
    sensitivity: "INTERNAL",
    defaultValue: ".ate/dataset-catalogue",
    metadata: {
      purpose: "Keep filesystem-backed catalogue metadata under a managed root.",
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
  const historicalMaxArtifactBytes = foundationalConfigurationKey(
    "data.historical.maxArtifactBytes",
    clock,
  );
  const historicalParserBatchSize = foundationalConfigurationKey(
    "data.historical.parserBatchSize",
    clock,
  );
  const historicalMaxRejections = foundationalConfigurationKey(
    "data.historical.maxRejections",
    clock,
  );
  const historicalMaxQueryPageSize = foundationalConfigurationKey(
    "data.historical.maxQueryPageSize",
    clock,
  );
  const historicalStorageRoots = foundationalConfigurationKey(
    "data.historical.storageRoots",
    clock,
  );
  const dataQualityMaxObservations = foundationalConfigurationKey(
    "data.quality.maxObservations",
    clock,
  );
  const dataQualityEvidenceLimitPerRule = foundationalConfigurationKey(
    "data.quality.evidenceLimitPerRule",
    clock,
  );
  const dataQualityDefaultFreshnessMaxAgeMs = foundationalConfigurationKey(
    "data.quality.defaultFreshnessMaxAgeMs",
    clock,
  );
  const dataQualityReportStorageRoot = foundationalConfigurationKey(
    "data.quality.reportStorageRoot",
    clock,
  );
  const datasetCatalogueMaxQueryPageSize = foundationalConfigurationKey(
    "data.catalogue.maxQueryPageSize",
    clock,
  );
  const datasetCatalogueMaxLineageDepth = foundationalConfigurationKey(
    "data.catalogue.maxLineageDepth",
    clock,
  );
  const datasetCatalogueMaxLineageNodes = foundationalConfigurationKey(
    "data.catalogue.maxLineageNodes",
    clock,
  );
  const datasetCatalogueMaxParentsPerDataset = foundationalConfigurationKey(
    "data.catalogue.maxParentsPerDataset",
    clock,
  );
  const datasetCatalogueRequireQualityForQualification = foundationalConfigurationKey(
    "data.catalogue.requireQualityForQualification",
    clock,
  );
  const datasetCatalogueRequireVerifiedIntegrity = foundationalConfigurationKey(
    "data.catalogue.requireVerifiedIntegrity",
    clock,
  );
  const datasetCatalogueStorageRoot = foundationalConfigurationKey(
    "data.catalogue.storageRoot",
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
        releaseScope: "DESTINATION_LOCAL",
        promotionHelpText:
          "Destination runtime mode is environment-local and is preserved during promotion.",
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
        approvalClassification: "SENSITIVE",
        approvalRequired: true,
        governanceCategory: "CAPABILITY_CONTROL",
        requiredCheckerAuthority: "SENSITIVE_CONFIGURATION_CHECKER",
        governanceHelpText:
          "Changing capability-control flags is sensitive because it can alter desired control-plane behavior.",
      },
    }),
    configurationSchemaFromDefinition(requireDefinition(byKey, capabilityDiagnostics), {
      metadata: {
        ...requireDefinition(byKey, capabilityDiagnostics).metadata,
        helpText:
          "Controls capability diagnostics visibility. Changes are restart-required by Prompt 10 policy.",
        examples: [true, false],
        approvalClassification: "SENSITIVE",
        approvalRequired: true,
        governanceCategory: "CAPABILITY_CONTROL",
        requiredCheckerAuthority: "SENSITIVE_CONFIGURATION_CHECKER",
        governanceHelpText:
          "Restart-required capability diagnostics changes require independent governance review.",
      },
    }),
    configurationSchemaFromDefinition(requireDefinition(byKey, historicalMaxArtifactBytes), {
      constraints: { minimum: 1_024, maximum: 1_073_741_824, unit: "count" },
      metadata: {
        ...requireDefinition(byKey, historicalMaxArtifactBytes).metadata,
        helpText: "Bounds each untrusted historical source artifact.",
        examples: [26_214_400],
        invalidExamples: [0],
      },
    }),
    configurationSchemaFromDefinition(requireDefinition(byKey, historicalParserBatchSize), {
      constraints: { minimum: 1, maximum: 100_000, unit: "count" },
      metadata: {
        ...requireDefinition(byKey, historicalParserBatchSize).metadata,
        helpText: "Controls bounded parser batches for historical imports.",
        examples: [1000, 5000],
      },
    }),
    configurationSchemaFromDefinition(requireDefinition(byKey, historicalMaxRejections), {
      constraints: { minimum: 0, maximum: 100_000, unit: "count" },
      metadata: {
        ...requireDefinition(byKey, historicalMaxRejections).metadata,
        helpText: "Caps rejection records collected before failing an import.",
        examples: [100, 1000],
      },
    }),
    configurationSchemaFromDefinition(requireDefinition(byKey, historicalMaxQueryPageSize), {
      constraints: { minimum: 1, maximum: 100_000, unit: "count" },
      metadata: {
        ...requireDefinition(byKey, historicalMaxQueryPageSize).metadata,
        helpText: "Bounds historical research query pages. No get-all-ticks API is allowed.",
        examples: [1000, 5000],
      },
    }),
    configurationSchemaFromDefinition(requireDefinition(byKey, historicalStorageRoots), {
      constraints: {
        requiredProperties: ["stagingRoot", "datasetRoot"],
        allowUnknownProperties: false,
        properties: {
          stagingRoot: { valueType: "STRING", required: true, constraints: { minLength: 1 } },
          datasetRoot: { valueType: "STRING", required: true, constraints: { minLength: 1 } },
        },
      },
      metadata: {
        ...requireDefinition(byKey, historicalStorageRoots).metadata,
        helpText:
          "Defines managed local roots for staged and published historical datasets. Filenames never become paths.",
        examples: [
          { stagingRoot: ".ate/historical/staging", datasetRoot: ".ate/historical/datasets" },
        ],
      },
    }),
    configurationSchemaFromDefinition(requireDefinition(byKey, dataQualityMaxObservations), {
      constraints: { minimum: 1, maximum: 1_000_000, unit: "count" },
      metadata: {
        ...requireDefinition(byKey, dataQualityMaxObservations).metadata,
        helpText: "Bounds how many historical observations one quality report can evaluate.",
        examples: [10_000, 100_000],
      },
    }),
    configurationSchemaFromDefinition(requireDefinition(byKey, dataQualityEvidenceLimitPerRule), {
      constraints: { minimum: 1, maximum: 1000, unit: "count" },
      metadata: {
        ...requireDefinition(byKey, dataQualityEvidenceLimitPerRule).metadata,
        helpText:
          "Caps retained findings per rule; suppressedFindingCount remains visible when capped.",
        examples: [25, 100],
      },
    }),
    configurationSchemaFromDefinition(
      requireDefinition(byKey, dataQualityDefaultFreshnessMaxAgeMs),
      {
        constraints: { minimum: 1_000, maximum: 31_536_000_000, unit: "milliseconds" },
        metadata: {
          ...requireDefinition(byKey, dataQualityDefaultFreshnessMaxAgeMs).metadata,
          helpText:
            "Default stale-data threshold for historical quality diagnostics. It does not authorize trading.",
          examples: [86_400_000],
        },
      },
    ),
    configurationSchemaFromDefinition(requireDefinition(byKey, dataQualityReportStorageRoot), {
      constraints: { minLength: 1, maxLength: 512 },
      metadata: {
        ...requireDefinition(byKey, dataQualityReportStorageRoot).metadata,
        helpText: "Managed local root for immutable data-quality report staging and publication.",
        examples: [".ate/data-quality/reports"],
      },
    }),
    configurationSchemaFromDefinition(requireDefinition(byKey, datasetCatalogueMaxQueryPageSize), {
      constraints: { minimum: 1, maximum: 10_000, unit: "count" },
      metadata: {
        ...requireDefinition(byKey, datasetCatalogueMaxQueryPageSize).metadata,
        helpText: "Bounds dataset catalogue discovery result pages.",
        examples: [100, 1000],
      },
    }),
    configurationSchemaFromDefinition(requireDefinition(byKey, datasetCatalogueMaxLineageDepth), {
      constraints: { minimum: 1, maximum: 100, unit: "count" },
      metadata: {
        ...requireDefinition(byKey, datasetCatalogueMaxLineageDepth).metadata,
        helpText: "Caps ancestry, descendant and impact-analysis traversal depth.",
        examples: [10, 25],
      },
    }),
    configurationSchemaFromDefinition(requireDefinition(byKey, datasetCatalogueMaxLineageNodes), {
      constraints: { minimum: 1, maximum: 10_000, unit: "count" },
      metadata: {
        ...requireDefinition(byKey, datasetCatalogueMaxLineageNodes).metadata,
        helpText:
          "Caps lineage traversal node counts and returns truncation evidence when exceeded.",
        examples: [100, 500],
      },
    }),
    configurationSchemaFromDefinition(
      requireDefinition(byKey, datasetCatalogueMaxParentsPerDataset),
      {
        constraints: { minimum: 0, maximum: 1000, unit: "count" },
        metadata: {
          ...requireDefinition(byKey, datasetCatalogueMaxParentsPerDataset).metadata,
          helpText: "Bounds governed parent dataset fan-in during registration.",
          examples: [4, 16],
        },
      },
    ),
    configurationSchemaFromDefinition(
      requireDefinition(byKey, datasetCatalogueRequireQualityForQualification),
      {
        metadata: {
          ...requireDefinition(byKey, datasetCatalogueRequireQualityForQualification).metadata,
          helpText:
            "When enabled, eligibility reports insufficient evidence without a matching Prompt 15 quality report.",
          examples: [true, false],
        },
      },
    ),
    configurationSchemaFromDefinition(
      requireDefinition(byKey, datasetCatalogueRequireVerifiedIntegrity),
      {
        metadata: {
          ...requireDefinition(byKey, datasetCatalogueRequireVerifiedIntegrity).metadata,
          helpText: "When enabled, integrity mismatch or unverifiable data blocks eligibility.",
          examples: [true, false],
        },
      },
    ),
    configurationSchemaFromDefinition(requireDefinition(byKey, datasetCatalogueStorageRoot), {
      constraints: { minLength: 1, maxLength: 512 },
      metadata: {
        ...requireDefinition(byKey, datasetCatalogueStorageRoot).metadata,
        helpText: "Managed local root for catalogue metadata. It is not dataset content storage.",
        examples: [".ate/dataset-catalogue"],
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
