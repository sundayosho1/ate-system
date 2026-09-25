import type {
  DataQualityProfile,
  DataQualityProfileId,
  DataQualityRuleDefinition,
  DataQualityRuleId,
} from "./types.js";
import { fingerprint } from "./serialization.js";

export const ruleId = (value: string): DataQualityRuleId => value as DataQualityRuleId;
export const profileId = (value: string): DataQualityProfileId => value as DataQualityProfileId;

export const defaultDataQualityRuleDefinitions = (): readonly DataQualityRuleDefinition[] => [
  {
    ruleId: ruleId("dataset-integrity"),
    displayName: "Dataset manifest integrity",
    category: "DATASET_INTEGRITY",
    dimension: "INTEGRITY",
    severity: "ERROR",
    description:
      "Checks manifest observation counts, partition counts and bounded analysis coverage without reading private storage files.",
  },
  {
    ruleId: ruleId("partition-integrity"),
    displayName: "Partition manifest integrity",
    category: "PARTITION_INTEGRITY",
    dimension: "INTEGRITY",
    severity: "ERROR",
    description: "Checks published partition manifests for count and time-bound contradictions.",
  },
  {
    ruleId: ruleId("coverage-and-import-rejections"),
    displayName: "Coverage and import rejection evidence",
    category: "IMPORT_REJECTION_EVIDENCE",
    dimension: "COMPLETENESS",
    severity: "WARNING",
    description:
      "Reports partial imports, low observation counts and rejection evidence separately from structural validity.",
    thresholds: { minObservationCount: 1 },
  },
  {
    ruleId: ruleId("bar-gap-and-overlap"),
    displayName: "Bar gap and overlap detection",
    category: "COVERAGE_GAP",
    dimension: "COMPLETENESS",
    severity: "WARNING",
    description:
      "Detects missing or overlapping fixed bar intervals within an instrument/timeframe group.",
    thresholds: { maxGapIntervals: 1 },
    appliesTo: ["BAR"],
  },
  {
    ruleId: ruleId("duplicate-observation"),
    displayName: "Duplicate observation detection",
    category: "DUPLICATE_OBSERVATION",
    dimension: "CONSISTENCY",
    severity: "WARNING",
    description:
      "Detects duplicate observation identifiers and semantic duplicate observations without deleting evidence.",
  },
  {
    ruleId: ruleId("timestamp-and-sequence"),
    displayName: "Timestamp and sequence quality",
    category: "TIMESTAMP_ANOMALY",
    dimension: "TIMELINESS",
    severity: "WARNING",
    description: "Detects future event/source times and non-monotonic sequence evidence.",
  },
  {
    ruleId: ruleId("freshness-staleness"),
    displayName: "Freshness and staleness",
    category: "FRESHNESS_STALENESS",
    dimension: "TIMELINESS",
    severity: "WARNING",
    description: "Classifies stale or future-skewed datasets relative to the selected clock.",
    thresholds: { freshnessMaxAgeMs: 86_400_000, freshnessFutureToleranceMs: 60_000 },
  },
  {
    ruleId: ruleId("quote-spread"),
    displayName: "Quote spread quality",
    category: "QUOTE_SPREAD_ANOMALY",
    dimension: "ACCURACY",
    severity: "ERROR",
    description: "Detects crossed quotes and unusually wide spreads without repairing quote sides.",
    thresholds: { maxSpreadBps: 250 },
    appliesTo: ["QUOTE", "TICK"],
  },
  {
    ruleId: ruleId("ohlc-consistency"),
    displayName: "OHLC consistency",
    category: "OHLC_ANOMALY",
    dimension: "ACCURACY",
    severity: "ERROR",
    description:
      "Rechecks bar price relationships as quality findings while preserving Prompt 13 structural authority.",
    appliesTo: ["BAR"],
  },
  {
    ruleId: ruleId("price-outlier"),
    displayName: "Price outlier detection",
    category: "PRICE_OUTLIER",
    dimension: "ACCURACY",
    severity: "WARNING",
    description: "Detects abrupt price jumps by instrument and observation kind.",
    thresholds: { maxPriceJumpRatio: 0.1 },
  },
  {
    ruleId: ruleId("volume-anomaly"),
    displayName: "Volume evidence quality",
    category: "VOLUME_ANOMALY",
    dimension: "ACCURACY",
    severity: "INFO",
    description: "Reports missing or zero volume evidence where volume-bearing observations exist.",
    appliesTo: ["TRADE", "BAR", "TICK"],
  },
  {
    ruleId: ruleId("timezone-session-provenance"),
    displayName: "Timezone and session evidence",
    category: "TIMEZONE_SESSION_ANOMALY",
    dimension: "PROVENANCE",
    severity: "INFO",
    description:
      "Reports absent source timezone/session evidence; this is not a market calendar or session engine.",
  },
  {
    ruleId: ruleId("provenance-completeness"),
    displayName: "Provenance completeness",
    category: "PROVENANCE_INCOMPLETE",
    dimension: "PROVENANCE",
    severity: "WARNING",
    description:
      "Checks bounded source, provider symbol, timestamp precision and dataset provenance evidence.",
  },
];

export const createDefaultDataQualityProfile = (
  overrides: Partial<
    Pick<
      DataQualityProfile,
      "profileId" | "version" | "displayName" | "rules" | "minimumScore" | "maxObservations"
    >
  > = {},
): DataQualityProfile => {
  const rules = overrides.rules ?? defaultDataQualityRuleDefinitions();
  const base = {
    profileId: overrides.profileId ?? profileId("default-historical-quality"),
    version: overrides.version ?? "1.0.0",
    displayName: overrides.displayName ?? "Default historical dataset quality profile",
    intendedUses: ["RESEARCH_EXPLORATION", "BACKTEST_CANDIDATE", "SIMULATION_CANDIDATE"],
    rules,
    failOnSeverities: ["ERROR", "CRITICAL"],
    minimumScore: overrides.minimumScore ?? 70,
    evidenceLimitPerRule: 25,
    maxObservations: overrides.maxObservations ?? 100_000,
  } as const;

  return {
    ...base,
    fingerprint: fingerprint(base),
  };
};
