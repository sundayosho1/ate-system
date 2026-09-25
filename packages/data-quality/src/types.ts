import type {
  Actor,
  InstrumentId,
  MarketObservation,
  MarketObservationKind,
  RuntimeMode,
  UtcTimestamp,
} from "@ate/domain";
import type {
  HistoricalDatasetId,
  HistoricalDatasetManifest,
  HistoricalDatasetRepository,
} from "@ate/historical-data";
import type { Clock } from "@ate/time";

export type DataQualityProfileId = string & { readonly __brand: "DataQualityProfileId" };
export type DataQualityRuleId = string & { readonly __brand: "DataQualityRuleId" };
export type DataQualityReportId = string & { readonly __brand: "DataQualityReportId" };
export type DataQualityFingerprint = string & { readonly __brand: "DataQualityFingerprint" };
export type DataQualityFindingId = string & { readonly __brand: "DataQualityFindingId" };

export const dataQualityErrorCodes = [
  "DATA_QUALITY_DATASET_NOT_FOUND",
  "DATA_QUALITY_QUERY_FAILED",
  "DATA_QUALITY_PROFILE_INVALID",
  "DATA_QUALITY_RULE_FAILED",
  "DATA_QUALITY_REPORT_NOT_FOUND",
  "DATA_QUALITY_PUBLICATION_FAILED",
  "DATA_QUALITY_RESOURCE_LIMIT_EXCEEDED",
] as const;
export type DataQualityErrorCode = (typeof dataQualityErrorCodes)[number];

export type DataQualityError = Readonly<{
  code: DataQualityErrorCode;
  message: string;
  severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  timestamp: UtcTimestamp;
  details?: Record<string, unknown>;
}>;

export type DataQualityResult<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: DataQualityError }>;

export const dataQualityDimensions = [
  "STRUCTURE",
  "IMPORT",
  "COMPLETENESS",
  "TIMELINESS",
  "CONSISTENCY",
  "ACCURACY",
  "PROVENANCE",
  "INTEGRITY",
  "FITNESS",
] as const;
export type DataQualityDimension = (typeof dataQualityDimensions)[number];

export const dataQualityFindingCategories = [
  "DATASET_INTEGRITY",
  "PARTITION_INTEGRITY",
  "COVERAGE_GAP",
  "DUPLICATE_OBSERVATION",
  "TIMESTAMP_ANOMALY",
  "SEQUENCE_ANOMALY",
  "FRESHNESS_STALENESS",
  "QUOTE_SPREAD_ANOMALY",
  "OHLC_ANOMALY",
  "PRICE_OUTLIER",
  "VOLUME_ANOMALY",
  "TIMEZONE_SESSION_ANOMALY",
  "PROVENANCE_INCOMPLETE",
  "IMPORT_REJECTION_EVIDENCE",
] as const;
export type DataQualityFindingCategory = (typeof dataQualityFindingCategories)[number];

export const dataQualitySeverities = ["INFO", "WARNING", "ERROR", "CRITICAL"] as const;
export type DataQualitySeverity = (typeof dataQualitySeverities)[number];

export const dataQualityRuleStatuses = [
  "PASS",
  "FINDINGS",
  "NOT_APPLICABLE",
  "INSUFFICIENT_EVIDENCE",
  "FAILED",
] as const;
export type DataQualityRuleStatus = (typeof dataQualityRuleStatuses)[number];

export const dataQualityClasses = [
  "EXCELLENT",
  "GOOD",
  "WATCHLIST",
  "POOR",
  "UNUSABLE",
  "INSUFFICIENT_EVIDENCE",
] as const;
export type DataQualityClass = (typeof dataQualityClasses)[number];

export const dataQualityQualificationStatuses = [
  "QUALIFIED",
  "QUALIFIED_WITH_WARNINGS",
  "NOT_QUALIFIED",
  "INSUFFICIENT_EVIDENCE",
  "NOT_ASSESSED",
] as const;
export type DataQualityQualificationStatus = (typeof dataQualityQualificationStatuses)[number];

export const dataQualityIntendedUses = [
  "RESEARCH_EXPLORATION",
  "BACKTEST_CANDIDATE",
  "SIMULATION_CANDIDATE",
  "PAPER_REVIEW",
] as const;
export type DataQualityIntendedUse = (typeof dataQualityIntendedUses)[number];

export type DataQualityEvidence = Readonly<{
  evidenceId: string;
  summary: string;
  observationIds: readonly string[];
  partitionIds: readonly string[];
  sample: readonly Readonly<Record<string, string | number | boolean | null>>[];
}>;

export type DataQualityFinding = Readonly<{
  findingId: DataQualityFindingId;
  ruleId: DataQualityRuleId;
  category: DataQualityFindingCategory;
  dimension: DataQualityDimension;
  severity: DataQualitySeverity;
  message: string;
  instrumentId?: InstrumentId;
  observationKind?: MarketObservationKind;
  eventTime?: UtcTimestamp;
  evidence: readonly DataQualityEvidence[];
}>;

export type DataQualityRuleThresholds = Readonly<{
  expectedIntervalMs?: number;
  maxGapIntervals?: number;
  freshnessMaxAgeMs?: number;
  freshnessFutureToleranceMs?: number;
  maxAllowedSpread?: string;
  maxSpreadBps?: number;
  maxPriceJumpRatio?: number;
  maxEvidencePerRule?: number;
  minObservationCount?: number;
}>;

export type DataQualityRuleDefinition = Readonly<{
  ruleId: DataQualityRuleId;
  displayName: string;
  category: DataQualityFindingCategory;
  dimension: DataQualityDimension;
  severity: DataQualitySeverity;
  description: string;
  thresholds?: DataQualityRuleThresholds;
  appliesTo?: readonly MarketObservationKind[];
}>;

export type DataQualityRuleExecution = Readonly<{
  ruleId: DataQualityRuleId;
  status: DataQualityRuleStatus;
  findingCount: number;
  suppressedFindingCount: number;
  durationMs: number;
  message?: string;
}>;

export type DataQualityProfile = Readonly<{
  profileId: DataQualityProfileId;
  version: string;
  displayName: string;
  intendedUses: readonly DataQualityIntendedUse[];
  rules: readonly DataQualityRuleDefinition[];
  failOnSeverities: readonly DataQualitySeverity[];
  minimumScore: number;
  evidenceLimitPerRule: number;
  maxObservations: number;
  fingerprint: DataQualityFingerprint;
}>;

export type DataQualityAnalysisRequest = Readonly<{
  datasetId: HistoricalDatasetId;
  profile: DataQualityProfile;
  actor?: Actor;
  runtimeMode: Exclude<RuntimeMode, "LIVE">;
  asOf?: UtcTimestamp;
}>;

export type DataQualityDatasetSnapshot = Readonly<{
  manifest: HistoricalDatasetManifest;
  observations: readonly MarketObservation[];
  observationLimitReached: boolean;
}>;

export type DataQualityRuleContext = Readonly<{
  request: DataQualityAnalysisRequest;
  manifest: HistoricalDatasetManifest;
  observations: readonly MarketObservation[];
  observationLimitReached: boolean;
  clock: Clock;
}>;

export type DataQualityRule = Readonly<{
  definition: DataQualityRuleDefinition;
  evaluate: (
    context: DataQualityRuleContext,
  ) =>
    | Promise<DataQualityResult<DataQualityRuleEvaluation>>
    | DataQualityResult<DataQualityRuleEvaluation>;
}>;

export type DataQualityRuleEvaluation = Readonly<{
  status: Exclude<DataQualityRuleStatus, "FAILED">;
  findings: readonly DataQualityFinding[];
  suppressedFindingCount: number;
  message?: string;
}>;

export type DataQualityScore = Readonly<{
  value: number;
  max: 100;
  qualityClass: DataQualityClass;
  findingPenalty: number;
  coveragePenalty: number;
  qualification: DataQualityQualificationStatus;
  intendedUses: readonly DataQualityIntendedUse[];
  fitnessForPurpose: "NOT_ASSESSED" | "ASSESSMENT_REQUIRED";
  doesNotAuthorizeTrading: true;
}>;

export type DataQualityReport = Readonly<{
  reportId: DataQualityReportId;
  datasetId: HistoricalDatasetId;
  datasetContentFingerprint: string;
  profileId: DataQualityProfileId;
  profileVersion: string;
  profileFingerprint: DataQualityFingerprint;
  generatedAt: UtcTimestamp;
  generatedBy?: Actor;
  runtimeMode: Exclude<RuntimeMode, "LIVE">;
  structuralValidity: "PASSED_BEFORE_QUALITY" | "NOT_REEVALUATED";
  importValidity: "IMPORTED" | "IMPORTED_WITH_REJECTIONS" | "NOT_ASSESSED";
  dataQuality: DataQualityClass;
  score: DataQualityScore;
  summary: DataQualitySummary;
  ruleExecutions: readonly DataQualityRuleExecution[];
  findings: readonly DataQualityFinding[];
  reportFingerprint: DataQualityFingerprint;
}>;

export type DataQualitySummary = Readonly<{
  observationCount: number;
  partitionCount: number;
  findingCount: number;
  suppressedFindingCount: number;
  severityCounts: Readonly<Record<DataQualitySeverity, number>>;
  statusCounts: Readonly<Record<DataQualityRuleStatus, number>>;
}>;

export type DataQualityReportRepository = Readonly<{
  stageReport: (report: DataQualityReport) => Promise<DataQualityResult<void>>;
  publishReport: (reportId: DataQualityReportId) => Promise<DataQualityResult<DataQualityReport>>;
  getReport: (reportId: DataQualityReportId) => Promise<DataQualityResult<DataQualityReport>>;
  findByDataset: (
    datasetId: HistoricalDatasetId,
    limit: number,
  ) => Promise<DataQualityResult<readonly DataQualityReport[]>>;
  diagnostics: () => Promise<DataQualityResult<DataQualityStorageDiagnostics>>;
}>;

export type DataQualityStorageDiagnostics = Readonly<{
  stagedReportCount: number;
  publishedReportCount: number;
  storageRoot?: string;
  orphanedStagingCount: number;
}>;

export type DataQualityEngineInput = Readonly<{
  clock: Clock;
  historicalRepository: HistoricalDatasetRepository;
  reportRepository: DataQualityReportRepository;
  rules?: readonly DataQualityRule[];
}>;

export type DataQualityDiagnostics = Readonly<{
  state: "CREATED" | "INITIALIZING" | "READY" | "DEGRADED" | "STOPPING" | "STOPPED" | "FAILED";
  registeredRuleCount: number;
  recentReportIds: readonly DataQualityReportId[];
  recentFailures: readonly DataQualityError[];
  storage: DataQualityStorageDiagnostics;
  configurationFingerprint?: string;
}>;
