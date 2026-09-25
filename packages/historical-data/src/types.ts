import type {
  Actor,
  CanonicalTimeframe,
  DataSourceRef,
  InstrumentId,
  MarketObservation,
  MarketObservationKind,
  SourceId,
  TimestampPrecision,
  UtcTimestamp,
  VolumeType,
} from "@ate/domain";
import type { Clock } from "@ate/time";

export type HistoricalArtifactId = string & { readonly __brand: "HistoricalArtifactId" };
export type HistoricalImportPlanId = string & { readonly __brand: "HistoricalImportPlanId" };
export type HistoricalImportSessionId = string & { readonly __brand: "HistoricalImportSessionId" };
export type HistoricalDatasetId = string & { readonly __brand: "HistoricalDatasetId" };
export type HistoricalPartitionId = string & { readonly __brand: "HistoricalPartitionId" };
export type HistoricalImportProfileId = string & { readonly __brand: "HistoricalImportProfileId" };
export type HistoricalContentChecksum = string & { readonly __brand: "HistoricalContentChecksum" };
export type HistoricalFingerprint = string & { readonly __brand: "HistoricalFingerprint" };

export const historicalFormats = ["CSV", "JSON", "NDJSON", "PARQUET"] as const;
export type HistoricalFormat = (typeof historicalFormats)[number];

export const historicalImportStates = [
  "CREATED",
  "INSPECTED",
  "PLANNED",
  "IMPORTING",
  "COMPLETED",
  "COMPLETED_WITH_REJECTIONS",
  "FAILED",
  "CANCELLED",
] as const;
export type HistoricalImportState = (typeof historicalImportStates)[number];

export const historicalErrorCodes = [
  "HISTORICAL_FORMAT_UNSUPPORTED",
  "HISTORICAL_FORMAT_MISMATCH",
  "HISTORICAL_FILE_TOO_LARGE",
  "HISTORICAL_ARTIFACT_INVALID",
  "HISTORICAL_CHECKSUM_MISMATCH",
  "HISTORICAL_SCHEMA_UNSUPPORTED",
  "HISTORICAL_MAPPING_INVALID",
  "HISTORICAL_MAPPING_AMBIGUOUS",
  "HISTORICAL_INSTRUMENT_MISSING",
  "HISTORICAL_TIMESTAMP_MAPPING_INVALID",
  "HISTORICAL_TIMEZONE_REQUIRED",
  "HISTORICAL_TIMEFRAME_REQUIRED",
  "HISTORICAL_VOLUME_SEMANTICS_REQUIRED",
  "HISTORICAL_RECORD_PARSE_FAILED",
  "HISTORICAL_RECORD_INVALID",
  "HISTORICAL_REJECTION_LIMIT_EXCEEDED",
  "HISTORICAL_RESOURCE_LIMIT_EXCEEDED",
  "HISTORICAL_IMPORT_CANCELLED",
  "HISTORICAL_IMPORT_FAILED",
  "HISTORICAL_DATASET_PUBLICATION_FAILED",
  "HISTORICAL_DATASET_NOT_FOUND",
  "HISTORICAL_QUERY_INVALID",
  "HISTORICAL_QUERY_LIMIT_EXCEEDED",
  "HISTORICAL_PATH_INVALID",
  "HISTORICAL_IDENTITY_COLLISION",
] as const;
export type HistoricalErrorCode = (typeof historicalErrorCodes)[number];

export type HistoricalError = Readonly<{
  code: HistoricalErrorCode;
  message: string;
  severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  timestamp: UtcTimestamp;
  details?: Record<string, unknown>;
}>;

export type HistoricalResult<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: HistoricalError }>;

export type SafeMetadataValue = string | number | boolean | null | readonly string[];
export type SafeMetadata = Readonly<Record<string, SafeMetadataValue>>;

export type HistoricalResourceLimits = Readonly<{
  maxArtifactBytes: number;
  maxRecords: number;
  maxColumns: number;
  maxFieldBytes: number;
  maxRowBytes: number;
  maxJsonDepth: number;
  maxJsonArrayRecords: number;
  batchSize: number;
  maxRejections: number;
  maxQueryLimit: number;
  maxPreviewRecords: number;
}>;

export const defaultHistoricalResourceLimits: HistoricalResourceLimits = {
  maxArtifactBytes: 25 * 1024 * 1024,
  maxRecords: 250_000,
  maxColumns: 128,
  maxFieldBytes: 16 * 1024,
  maxRowBytes: 128 * 1024,
  maxJsonDepth: 12,
  maxJsonArrayRecords: 250_000,
  batchSize: 1000,
  maxRejections: 1000,
  maxQueryLimit: 5000,
  maxPreviewRecords: 25,
};

export type HistoricalSourceArtifact = Readonly<{
  artifactId: HistoricalArtifactId;
  originalFileName: string;
  sanitizedFileName: string;
  declaredFormat?: HistoricalFormat;
  detectedFormat: HistoricalFormat;
  byteSize: number;
  checksum: HistoricalContentChecksum;
  importedAt: UtcTimestamp;
  importedBy?: Actor;
  source: DataSourceRef;
  sourceDescription?: string;
  exportMetadata: SafeMetadata;
  metadata: SafeMetadata;
}>;

export type FormatDetectionEvidence = Readonly<{
  extension?: string;
  signature?: string;
  parserProbe: "MATCHED" | "FAILED" | "NOT_RUN";
  declaredFormat?: HistoricalFormat;
  detectedFormat: HistoricalFormat;
}>;

export type SourceFieldSummary = Readonly<{
  fieldName: string;
  inferredTypes: readonly ("STRING" | "DECIMAL" | "BOOLEAN" | "NULL" | "TIMESTAMP_CANDIDATE")[];
  missingCount: number;
  sampleValues: readonly string[];
}>;

export type SourceSchemaSummary = Readonly<{
  format: HistoricalFormat;
  recordCount: number;
  fields: readonly SourceFieldSummary[];
  timestampCandidates: readonly string[];
  priceCandidates: readonly string[];
  volumeCandidates: readonly string[];
  inspectedAt: UtcTimestamp;
}>;

export type SourceRecordLocation = Readonly<{
  kind: "CSV_ROW" | "JSON_INDEX" | "NDJSON_LINE" | "PARQUET_ROW";
  rowNumber?: number;
  lineNumber?: number;
  recordIndex?: number;
  jsonPath?: string;
  rowGroup?: number;
}>;

export type ParsedHistoricalRecord = Readonly<{
  location: SourceRecordLocation;
  values: Readonly<Record<string, unknown>>;
  sourceOrder: number;
}>;

export type HistoricalDataParser = Readonly<{
  format: HistoricalFormat;
  inspect: (
    content: Uint8Array,
    artifact: HistoricalSourceArtifact,
    limits: HistoricalResourceLimits,
    clock: Clock,
  ) => Promise<HistoricalResult<SourceSchemaSummary>> | HistoricalResult<SourceSchemaSummary>;
  parse: (
    content: Uint8Array,
    artifact: HistoricalSourceArtifact,
    limits: HistoricalResourceLimits,
  ) => AsyncIterable<HistoricalResult<ParsedHistoricalRecord>>;
}>;

export type FieldSelector = Readonly<
  | { kind: "FIELD"; field: string }
  | { kind: "FIXED"; value: string }
  | { kind: "OPTIONAL_FIELD"; field: string }
>;

export type TimestampMapping = Readonly<{
  field: string;
  timezone: string;
  precision: TimestampPrecision;
  meaning: "EVENT_TIME" | "SOURCE_TIME" | "INTERVAL_START" | "INTERVAL_END";
}>;

export type InstrumentMapping = Readonly<
  | { kind: "FIXED"; instrumentId: InstrumentId }
  | { kind: "FIELD"; field: string; dictionary: Readonly<Record<string, InstrumentId>> }
>;

export type TimeframeMapping = Readonly<
  | { kind: "FIXED"; timeframe: CanonicalTimeframe | string }
  | {
      kind: "FIELD";
      field: string;
      dictionary: Readonly<Record<string, CanonicalTimeframe | string>>;
    }
>;

export type VolumeMapping = Readonly<{
  field?: string;
  volumeType: VolumeType;
  unit: "ASSET_UNITS" | "BROKER_VOLUME" | "LOTS" | "CONTRACTS" | "TICKS" | "POINTS" | "PIPS";
  nullMarkers?: readonly string[];
}>;

export type ObservationFieldMapping = Readonly<{
  bid?: FieldSelector;
  ask?: FieldSelector;
  bidSize?: FieldSelector;
  askSize?: FieldSelector;
  tradePrice?: FieldSelector;
  tradeQuantity?: FieldSelector;
  sourceTradeId?: FieldSelector;
  open?: FieldSelector;
  high?: FieldSelector;
  low?: FieldSelector;
  close?: FieldSelector;
  status?: FieldSelector;
  providerSymbol?: FieldSelector;
}>;

export type HistoricalDataMappingSpecification = Readonly<{
  mappingId: string;
  version: string;
  targetKind: MarketObservationKind;
  source: DataSourceRef;
  instrument: InstrumentMapping;
  providerSymbol?: FieldSelector;
  eventTime: TimestampMapping;
  sourceTime?: TimestampMapping;
  intervalStart?: TimestampMapping;
  intervalEnd?: TimestampMapping;
  timeframe?: TimeframeMapping;
  fields: ObservationFieldMapping;
  volumes: readonly VolumeMapping[];
  nullMarkers: readonly string[];
  metadata: SafeMetadata;
}>;

export type HistoricalImportProfile = Readonly<{
  profileId: HistoricalImportProfileId;
  version: string;
  supportedFormat: HistoricalFormat;
  displayName: string;
  mapping: HistoricalDataMappingSpecification;
  fingerprint: HistoricalFingerprint;
}>;

export type RejectionPolicy = Readonly<{
  mode: "FAIL_FAST" | "COLLECT_AND_FAIL" | "ALLOW_PARTIAL";
  maxRejections: number;
  maxRejectionRatio?: number;
}>;

export type DuplicatePolicy = "PRESERVE" | "REJECT_EXACT";

export type HistoricalImportPlan = Readonly<{
  planId: HistoricalImportPlanId;
  artifact: HistoricalSourceArtifact;
  formatEvidence: FormatDetectionEvidence;
  schema: SourceSchemaSummary;
  mapping: HistoricalDataMappingSpecification;
  rejectionPolicy: RejectionPolicy;
  duplicatePolicy: DuplicatePolicy;
  resourceLimits: HistoricalResourceLimits;
  planFingerprint: HistoricalFingerprint;
  canonicalSchemaVersion: string;
  createdAt: UtcTimestamp;
}>;

export type HistoricalRejectionRecord = Readonly<{
  rejectionId: string;
  sessionId: HistoricalImportSessionId;
  artifactId: HistoricalArtifactId;
  location: SourceRecordLocation;
  reasonCode: HistoricalErrorCode;
  field?: string;
  safeSource: SafeMetadata;
  canonicalErrors: readonly string[];
  rejectedAt: UtcTimestamp;
}>;

export type DuplicateEvidence = Readonly<{
  observationId: string;
  duplicateOfObservationId: string;
  sourceLocation: SourceRecordLocation;
  evidence: readonly (
    "OBSERVATION_ID" | "SOURCE_OBSERVATION_ID" | "SEQUENCE" | "SEMANTIC_FINGERPRINT"
  )[];
}>;

export type HistoricalImportStatistics = Readonly<{
  sourceRecords: number;
  parsedRecords: number;
  acceptedRecords: number;
  rejectedRecords: number;
  quarantinedRecords: number;
  duplicateCandidates: number;
  firstEventTime?: UtcTimestamp;
  lastEventTime?: UtcTimestamp;
  instruments: readonly InstrumentId[];
  observationKinds: readonly MarketObservationKind[];
  timeframes: readonly string[];
  volumesByType: Readonly<Partial<Record<VolumeType, number>>>;
  durationMs: number;
}>;

export type HistoricalImportSession = Readonly<{
  sessionId: HistoricalImportSessionId;
  planId: HistoricalImportPlanId;
  artifactId: HistoricalArtifactId;
  startedAt: UtcTimestamp;
  completedAt?: UtcTimestamp;
  actor?: Actor;
  state: HistoricalImportState;
  statistics: HistoricalImportStatistics;
  outputDatasetId?: HistoricalDatasetId;
  failureReason?: HistoricalError;
}>;

export type HistoricalPartitionManifest = Readonly<{
  partitionId: HistoricalPartitionId;
  datasetId: HistoricalDatasetId;
  key: string;
  instrumentId?: InstrumentId;
  observationKind?: MarketObservationKind;
  dateBucket?: string;
  timeframe?: string;
  rowCount: number;
  firstEventTime?: UtcTimestamp;
  lastEventTime?: UtcTimestamp;
  checksum: HistoricalContentChecksum;
  storageRef: string;
}>;

export type HistoricalDatasetManifest = Readonly<{
  datasetId: HistoricalDatasetId;
  artifactId: HistoricalArtifactId;
  artifactChecksum: HistoricalContentChecksum;
  importPlanFingerprint: HistoricalFingerprint;
  canonicalSchemaVersion: string;
  createdAt: UtcTimestamp;
  observationCount: number;
  rejectionCount: number;
  observationKinds: readonly MarketObservationKind[];
  instrumentIds: readonly InstrumentId[];
  firstEventTime?: UtcTimestamp;
  lastEventTime?: UtcTimestamp;
  timeframes: readonly string[];
  sourceRefs: readonly SourceId[];
  partitionScheme: string;
  contentFingerprint: HistoricalFingerprint;
  completenessStatus: "COMPLETE" | "COMPLETED_WITH_REJECTIONS";
  partitions: readonly HistoricalPartitionManifest[];
  provenanceRefs: readonly string[];
}>;

export type HistoricalDataset = Readonly<{
  manifest: HistoricalDatasetManifest;
  observations: readonly MarketObservation[];
  rejections: readonly HistoricalRejectionRecord[];
  duplicateEvidence: readonly DuplicateEvidence[];
}>;

export type HistoricalQuery = Readonly<{
  datasetId: HistoricalDatasetId;
  instrumentId?: InstrumentId;
  observationKind?: MarketObservationKind;
  startInclusive?: UtcTimestamp;
  endExclusive?: UtcTimestamp;
  timeframe?: string;
  sourceId?: SourceId;
  limit: number;
  cursor?: string;
}>;

export type HistoricalQueryPage = Readonly<{
  observations: readonly MarketObservation[];
  nextCursor?: string;
}>;

export type HistoricalDatasetRepository = Readonly<{
  stageDataset: (dataset: HistoricalDataset) => Promise<HistoricalResult<void>>;
  publishDataset: (
    datasetId: HistoricalDatasetId,
  ) => Promise<HistoricalResult<HistoricalDatasetManifest>>;
  getManifest: (
    datasetId: HistoricalDatasetId,
  ) => Promise<HistoricalResult<HistoricalDatasetManifest>>;
  query: (query: HistoricalQuery) => Promise<HistoricalResult<HistoricalQueryPage>>;
  quarantine: (records: readonly HistoricalRejectionRecord[]) => Promise<HistoricalResult<void>>;
  diagnostics: () => Promise<HistoricalResult<HistoricalStorageDiagnostics>>;
}>;

export type HistoricalStorageDiagnostics = Readonly<{
  stagedDatasetCount: number;
  publishedDatasetCount: number;
  quarantinedRecordCount: number;
  storageRoot?: string;
  orphanedStagingCount: number;
}>;

export type HistoricalImportServiceInput = Readonly<{
  clock: Clock;
  repository: HistoricalDatasetRepository;
  parsers: readonly HistoricalDataParser[];
  limits?: Partial<HistoricalResourceLimits>;
}>;

export type HistoricalImportRequest = Readonly<{
  fileName: string;
  content: Uint8Array;
  declaredFormat?: HistoricalFormat;
  source: DataSourceRef;
  mapping: HistoricalDataMappingSpecification;
  actor?: Actor;
  rejectionPolicy?: RejectionPolicy;
  duplicatePolicy?: DuplicatePolicy;
  metadata?: SafeMetadata;
  dryRun?: boolean;
}>;

export type HistoricalPreview = Readonly<{
  artifact: HistoricalSourceArtifact;
  schema: SourceSchemaSummary;
  plan: HistoricalImportPlan;
  normalizedPreview: readonly MarketObservation[];
  rejections: readonly HistoricalRejectionRecord[];
}>;

export type HistoricalDiagnostics = Readonly<{
  state: "CREATED" | "INITIALIZING" | "READY" | "DEGRADED" | "STOPPING" | "STOPPED" | "FAILED";
  supportedFormats: readonly HistoricalFormat[];
  parserCount: number;
  activeImports: number;
  recentImports: readonly HistoricalImportSession[];
  recentFailures: readonly HistoricalError[];
  storage: HistoricalStorageDiagnostics;
  configurationFingerprint?: string;
}>;
