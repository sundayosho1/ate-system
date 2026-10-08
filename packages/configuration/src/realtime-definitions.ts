import type { Clock } from "@ate/time";
import { configurationKey } from "./keys.js";
import { configurationSchemaFromDefinition } from "./schema-types.js";
import type { ConfigurationDefinition } from "./types.js";

export const realtimeSettings = {
  enabled: [
    false,
    0,
    1,
    "Enable authorized data-only ingestion; does not configure a commercial provider.",
  ],
  maxProviders: [8, 1, 32, "Bound registered adapters and concurrent sessions."],
  queueCapacity: [
    256,
    1,
    10000,
    "Per-provider raw ingress capacity; reject newest and degrade on overflow.",
  ],
  consumerQueueCapacity: [
    256,
    1,
    10000,
    "Per-consumer accepted queue capacity; isolated overflow is explicit.",
  ],
  maxConsumers: [16, 1, 128, "Bound data-plane consumer cardinality."],
  maxSubscriptions: [
    64,
    1,
    1000,
    "Bound subscription records per provider, including closed records.",
  ],
  maxMessageBytes: [
    65536,
    128,
    1048576,
    "Bound raw payload and envelope bytes before normalization.",
  ],
  maxBatchSize: [64, 1, 1000, "Bound a single callback batch."],
  maxDepth: [8, 1, 16, "Bound input nesting depth."],
  maxStringLength: [1024, 64, 8192, "Bound individual input strings."],
  dedupCapacity: [1024, 1, 10000, "Bound recent provider identity evidence per subscription."],
  dedupWindowMs: [
    60000,
    1,
    3600000,
    "Expire identity evidence using receive-time clock authority.",
  ],
  maxFutureSkewMs: [1000, 0, 60000, "Reject event/source times excessively ahead of receive time."],
  maxLateAgeMs: [60000, 1, 86400000, "Classify old event/source evidence as late."],
  rejectLate: [false, 0, 1, "Reject late observations when explicitly required; otherwise warn."],
  rejectOutOfOrder: [
    false,
    0,
    1,
    "Reject regressions when required; otherwise preserve arrival order and warning.",
  ],
  staleAfterMs: [30000, 1, 86400000, "Observation freshness threshold; not a quality score."],
  heartbeatTimeoutMs: [
    10000,
    1,
    3600000,
    "Transport liveness deadline only when adapter supports heartbeats.",
  ],
  monitorIntervalMs: [1000, 1, 60000, "Virtual-scheduler monitor interval."],
  operationTimeoutMs: [
    5000,
    1,
    60000,
    "Bound adapter connect/subscribe/disconnect operations via scheduler.",
  ],
  reconnectMaxAttempts: [3, 0, 10, "Bound reconnect attempts in the retry window."],
  reconnectWindowMs: [
    60000,
    1,
    3600000,
    "Maximum elapsed retry window; exhaustion requires explicit operator action.",
  ],
  reconnectInitialDelayMs: [1000, 1, 60000, "Nonzero initial retry delay."],
  reconnectMaxDelayMs: [
    10000,
    1,
    300000,
    "Bound exponential retry delay; deterministic with no jitter.",
  ],
  maxEvidence: [
    100,
    1,
    1000,
    "Bound session, gap, error and control histories; counters disclose eviction.",
  ],
  captureEnabled: [
    false,
    0,
    1,
    "Enable capture artifact writing; never automatic dataset registration.",
  ],
  captureStorageRoot: [
    ".ate/realtime-captures",
    1,
    512,
    "Managed capture-only filesystem root; trusted operator path.",
  ],
  captureMaxFileBytes: [
    10485760,
    1024,
    67108864,
    "Bound canonical capture content and recovery reads.",
  ],
  captureMaxSessions: [32, 1, 1000, "Bound capture manifest count and lineage references."],
} as const;

export const realtimeConfigurationDefinitions = (
  clock: Clock,
): readonly ConfigurationDefinition[] =>
  Object.entries(realtimeSettings).map(([name, [value, , , purpose]]) => {
    const key = configurationKey(`data.realtime.${name}`, clock.now());
    if (!key.ok) throw new Error("invalid realtime configuration key");
    return {
      key: key.value,
      domain: "DATA",
      displayName: `Realtime ${name}`,
      description: purpose,
      valueType:
        typeof value === "boolean" ? "BOOLEAN" : typeof value === "string" ? "STRING" : "INTEGER",
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
          "Observation metadata only; no trading or research qualification authority.",
        reloadRequirement: "RESTART",
        helpText: `${purpose} Requires a new connection/capture session when changed.`,
      },
    };
  });
export const realtimeConfigurationSchemas = (clock: Clock) =>
  realtimeConfigurationDefinitions(clock).map((d) => {
    const setting =
      realtimeSettings[d.key.slice("data.realtime.".length) as keyof typeof realtimeSettings];
    return configurationSchemaFromDefinition(d, {
      constraints:
        typeof setting[0] === "number"
          ? { minimum: setting[1], maximum: setting[2] }
          : typeof setting[0] === "string"
            ? { minLength: setting[1], maxLength: setting[2] }
            : {},
      metadata: { ...d.metadata, examples: [setting[0]] },
    });
  });
