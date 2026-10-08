import type { Clock } from "@ate/time";
import { configurationKey } from "./keys.js";
import { configurationSchemaFromDefinition } from "./schema-types.js";
import type { ConfigurationDefinition } from "./types.js";
export const multitimeframeSettings = {
  enabled: [false, 0, 1, "Enable offline aggregation only."],
  allowedLatenessMs: [
    5000,
    0,
    86400000,
    "Subtract lateness from justified stream event progression.",
  ],
  correctionHorizonMs: [
    86400000,
    1000,
    604800000,
    "Reject corrections older than this bounded window.",
  ],
  maxStreams: [16, 1, 128, "Bound source/instrument/channel/basis streams."],
  maxInstruments: [16, 1, 128, "Bound unique instrument identities."],
  maxTimeframes: [16, 1, 32, "Bound configured timeframes."],
  maxWindows: [256, 1, 10000, "Bound retained windows including correction inputs."],
  maxContributions: [
    1024,
    1,
    10000,
    "Bound contributions per window; reject rather than truncate lineage.",
  ],
  maxRevisions: [
    2048,
    1,
    10000,
    "Bound immutable revision history; never evict requested history silently.",
  ],
  maxEvidence: [100, 1, 1000, "Bound diagnostic samples; retain obligations separately."],
  maxSnapshotTimeframes: [16, 1, 32, "Bound snapshot selection count."],
  maxQueryResults: [100, 1, 1000, "Bound history pagination and results."],
  maxQueryScan: [10000, 1, 10000, "Bound deterministic revision scans; reject beyond budget."],
  maxSnapshotAgeMs: [86400000, 0, 604800000, "Maximum default snapshot age."],
  maxCheckpointBytes: [
    10485760,
    4096,
    67108864,
    "Bound checkpoint serialization and recovery reads.",
  ],
  consumerCapacity: [
    64,
    1,
    1000,
    "Bound pull-consumer publication IDs; overflow requires history reconciliation.",
  ],
  allowProvisionalSnapshots: [
    false,
    0,
    1,
    "Permit explicitly requested provisional research revisions.",
  ],
  requireAvailabilityEvidence: [
    true,
    0,
    1,
    "Verified point-in-time always requires credible source availability.",
  ],
} as const;
export const multitimeframeConfigurationDefinitions = (
  clock: Clock,
): readonly ConfigurationDefinition[] => [
  ...Object.entries(multitimeframeSettings).map(
    ([name, [value, , , purpose]]): ConfigurationDefinition => {
      const key = configurationKey(`data.multitimeframe.${name}`, clock.now());
      if (!key.ok) throw Error("invalid aggregation key");
      return {
        key: key.value,
        domain: "DATA",
        displayName: `Aggregation ${name}`,
        description: purpose,
        valueType: typeof value === "boolean" ? "BOOLEAN" : "INTEGER",
        required: false,
        failClosed: true,
        allowedScopes: ["SYSTEM", "ENVIRONMENT"],
        mergePolicy: "REPLACE",
        sensitivity: "INTERNAL",
        defaultValue: value,
        metadata: {
          purpose,
          effect: purpose,
          riskImplication: "Offline research only; no qualification authority.",
          reloadRequirement: "RESTART",
          uiHint: `${purpose} Requires governed restart with versioned policies.`,
        },
      };
    },
  ),
  {
    key: configurationKey("data.multitimeframe.policyJson", clock.now()).ok
      ? ("data.multitimeframe.policyJson" as ConfigurationDefinition["key"])
      : (() => {
          throw Error("INVALID_KEY");
        })(),
    domain: "DATA",
    displayName: "Aggregation material policy",
    description: "Versioned calendar, registry and construction graph JSON. Requires restart.",
    valueType: "STRING",
    required: false,
    failClosed: true,
    allowedScopes: ["SYSTEM", "ENVIRONMENT"],
    mergePolicy: "REPLACE",
    sensitivity: "INTERNAL",
    defaultValue: "{}",
    metadata: {
      purpose: "Govern material aggregation policy through configuration authority.",
      effect: "Select boundaries and constituent graph.",
      riskImplication: "Policy mismatch fails recovery closed.",
      reloadRequirement: "RESTART",
      uiHint: "Strict policy JSON, bounded at 65536 characters; {} selects versioned UTC defaults.",
    },
  } satisfies ConfigurationDefinition,
];
export const multitimeframeConfigurationSchemas = (clock: Clock) =>
  multitimeframeConfigurationDefinitions(clock).map((d) => {
    if (d.valueType === "STRING")
      return configurationSchemaFromDefinition(d, {
        constraints: { maxLength: 65536 },
        metadata: { ...d.metadata, examples: ["{}"] },
      });
    const s =
      multitimeframeSettings[
        d.key.slice("data.multitimeframe.".length) as keyof typeof multitimeframeSettings
      ];
    return configurationSchemaFromDefinition(d, {
      constraints: typeof s[0] === "number" ? { minimum: s[1], maximum: s[2] } : {},
      metadata: { ...d.metadata, examples: [s[0]] },
    });
  });
