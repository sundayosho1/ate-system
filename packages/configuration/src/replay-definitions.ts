import type { Clock } from "@ate/time";
import { configurationKey } from "./keys.js";
import { configurationSchemaFromDefinition } from "./schema-types.js";
import type { ConfigurationDefinition } from "./types.js";
export const replayLimitSettings = {
  maxSessions: [16, 1, 128, "Bound independent replay session namespaces."],
  maxEventsPerSession: [10000, 1, 100000, "Bound immutable input snapshot events."],
  maxEventsPerBatch: [64, 1, 1000, "Bound processing work per public batch; operational only."],
  maxPendingTasks: [256, 1, 5000, "Bound stable scheduled task descriptors."],
  maxSnapshots: [64, 1, 1000, "Bound immutable snapshots; reject rather than evict."],
  maxCheckpoints: [
    4096,
    1,
    20000,
    "Bound operation records per session, including lifecycle records.",
  ],
  maxCheckpointBytes: [
    10485760,
    4096,
    67108864,
    "Bound complete whole-system checkpoint parsing and writing.",
  ],
  maxInputBytes: [16777216, 4096, 67108864, "Bound canonical input snapshot parsing."],
  maxBranches: [16, 1, 128, "Bound recorded immutable children per session."],
  maxComparisonItems: [2048, 1, 10000, "Bound comparison evidence, snapshots and revisions."],
  maxEvidenceRecords: [2048, 1, 10000, "Bound authoritative replay evidence; no eviction."],
  maxRepositoryOperations: [
    8192,
    1,
    20000,
    "Reserve operation content, marker and temporary paths.",
  ],
} as const;
const policySettings = {
  enabled: { value: false, purpose: "Enable offline replay; no financial capability." },
  requireAvailabilityEvidence: {
    value: true,
    purpose: "Verified mode always requires source knowledge evidence.",
  },
  failOnSourceGap: {
    value: false,
    purpose: "Choose fail-on-gap or truthful fenced research continuation.",
  },
} as const;
export function replayConfigurationDefinitions(clock: Clock): readonly ConfigurationDefinition[] {
  const base = (
    name: string,
    value: number | boolean | string,
    purpose: string,
  ): ConfigurationDefinition => {
    const key = configurationKey(`research.replay.${name}`, clock.now());
    if (!key.ok) throw Error("INVALID_KEY");
    return {
      key: key.value,
      domain: "DATA",
      displayName: `Replay ${name}`,
      description: purpose,
      valueType:
        typeof value === "boolean" ? "BOOLEAN" : typeof value === "number" ? "INTEGER" : "ENUM",
      required: false,
      failClosed: true,
      allowedScopes: ["SYSTEM", "ENVIRONMENT"],
      mergePolicy: "REPLACE",
      sensitivity: "INTERNAL",
      defaultValue: value,
      metadata: {
        purpose,
        effect: purpose,
        riskImplication:
          "Offline research; changed semantic settings require a new session or reconstructed branch.",
        reloadRequirement: "RESTART",
        uiHint: purpose,
      },
    };
  };
  return [
    ...Object.entries(replayLimitSettings).map(([n, [v, , , p]]) => base(n, v, p)),
    ...Object.entries(policySettings).map(([n, s]) => base(n, s.value, s.purpose)),
    base(
      "defaultMode",
      "EVENT_TIME_RECONSTRUCTION",
      "Explicit historical mode; reconstruction never grants verified knowledge.",
    ),
    base(
      "orderingPolicy",
      "AVAILABILITY_SOURCE_IDENTITY_V1",
      "Versioned availability-first total ordering with chronology uncertainty.",
    ),
  ];
}
export const replayConfigurationSchemas = (clock: Clock) =>
  replayConfigurationDefinitions(clock).map((d) => {
    const name = d.key.slice("research.replay.".length),
      numeric = replayLimitSettings[name as keyof typeof replayLimitSettings];
    return configurationSchemaFromDefinition(d, {
      constraints: numeric
        ? { minimum: numeric[1], maximum: numeric[2] }
        : d.valueType === "ENUM"
          ? {
              enumValues:
                name === "defaultMode"
                  ? ["EVENT_TIME_RECONSTRUCTION", "VERIFIED_POINT_IN_TIME"]
                  : ["AVAILABILITY_SOURCE_IDENTITY_V1"],
            }
          : {},
      metadata: { ...d.metadata, examples: [d.defaultValue!] },
    });
  });
