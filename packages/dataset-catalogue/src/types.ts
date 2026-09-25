import type {
  Actor,
  CausationId,
  CorrelationId,
  InstrumentId,
  MarketObservationKind,
  RuntimeMode,
  SourceId,
  UtcTimestamp,
} from "@ate/domain";
import type {
  DataQualityClass,
  DataQualityProfileId,
  DataQualityQualificationStatus,
  DataQualityReport,
  DataQualityReportId,
  DataQualityReportRepository,
} from "@ate/data-quality";
import type {
  HistoricalContentChecksum,
  HistoricalDatasetId,
  HistoricalDatasetManifest,
  HistoricalDatasetRepository,
  HistoricalFingerprint,
  HistoricalPartitionManifest,
} from "@ate/historical-data";
import type { Clock } from "@ate/time";

export type DatasetFamilyId = string & { readonly __brand: "DatasetFamilyId" };
export type DatasetVersionId = string & { readonly __brand: "DatasetVersionId" };
export type DatasetLineageEdgeId = string & { readonly __brand: "DatasetLineageEdgeId" };
export type DatasetTransformationId = string & { readonly __brand: "DatasetTransformationId" };
export type DatasetCatalogueSnapshotId = string & {
  readonly __brand: "DatasetCatalogueSnapshotId";
};
export type DatasetIntegrityVerificationId = string & {
  readonly __brand: "DatasetIntegrityVerificationId";
};
export type DatasetFingerprint = string & { readonly __brand: "DatasetFingerprint" };
export type DatasetMetadataAmendmentId = string & {
  readonly __brand: "DatasetMetadataAmendmentId";
};

export const datasetCatalogueErrorCodes = [
  "DATASET_CATALOGUE_ENTRY_NOT_FOUND",
  "DATASET_FAMILY_NOT_FOUND",
  "DATASET_VERSION_NOT_FOUND",
  "DATASET_VERSION_CONFLICT",
  "DATASET_VERSION_ALREADY_EXISTS",
  "DATASET_FAMILY_INCOMPATIBLE",
  "DATASET_REGISTRATION_INVALID",
  "DATASET_REGISTRATION_CONFLICT",
  "DATASET_CONTENT_FINGERPRINT_MISMATCH",
  "DATASET_MANIFEST_MISMATCH",
  "DATASET_PROVENANCE_INVALID",
  "DATASET_LINEAGE_INVALID",
  "DATASET_LINEAGE_CYCLE",
  "DATASET_LINEAGE_SELF_REFERENCE",
  "DATASET_LINEAGE_PARENT_NOT_FOUND",
  "DATASET_LINEAGE_BROKEN",
  "DATASET_INTEGRITY_MISMATCH",
  "DATASET_QUALITY_REPORT_NOT_FOUND",
  "DATASET_QUALITY_REFERENCE_INVALID",
  "DATASET_LIFECYCLE_TRANSITION_INVALID",
  "DATASET_ACTIVE_VERSION_CONFLICT",
  "DATASET_NOT_ELIGIBLE",
  "DATASET_REPRODUCIBILITY_INCOMPLETE",
  "DATASET_QUERY_LIMIT_EXCEEDED",
  "DATASET_LINEAGE_LIMIT_EXCEEDED",
  "DATASET_CATALOGUE_SNAPSHOT_STALE",
  "DATASET_CATALOGUE_PERSISTENCE_FAILED",
] as const;
export type DatasetCatalogueErrorCode = (typeof datasetCatalogueErrorCodes)[number];

export type DatasetCatalogueError = Readonly<{
  code: DatasetCatalogueErrorCode;
  message: string;
  severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  timestamp: UtcTimestamp;
  details?: Record<string, unknown>;
}>;

export type DatasetCatalogueResult<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: DatasetCatalogueError }>;

export type SafeCatalogueMetadataValue = string | number | boolean | null | readonly string[];
export type SafeCatalogueMetadata = Readonly<Record<string, SafeCatalogueMetadataValue>>;

export const datasetOriginTypes = [
  "HISTORICAL_IMPORT",
  "EXTERNAL_REFERENCE",
  "DERIVED",
  "LIVE_CAPTURE",
  "AGGREGATED",
] as const;
export type DatasetOriginType = (typeof datasetOriginTypes)[number];

export const implementedDatasetOriginTypes = [
  "HISTORICAL_IMPORT",
  "EXTERNAL_REFERENCE",
  "DERIVED",
] as const;
export type ImplementedDatasetOriginType = (typeof implementedDatasetOriginTypes)[number];

export const datasetMaterializationTypes = ["MATERIALIZED", "EXTERNAL_REFERENCE"] as const;
export type DatasetMaterializationType = (typeof datasetMaterializationTypes)[number];

export const datasetLifecycleStates = [
  "REGISTERED",
  "QUALIFIED",
  "ACTIVE",
  "SUPERSEDED",
  "DEPRECATED",
  "QUARANTINED",
  "INVALIDATED",
  "RETIRED",
] as const;
export type DatasetLifecycleState = (typeof datasetLifecycleStates)[number];

export const datasetIntegrityStatuses = [
  "VERIFIED",
  "UNVERIFIED",
  "MISMATCH",
  "BROKEN_REFERENCE",
  "INSUFFICIENT_EVIDENCE",
] as const;
export type DatasetIntegrityStatus = (typeof datasetIntegrityStatuses)[number];

export const datasetEligibilityStatuses = [
  "ELIGIBLE",
  "ELIGIBLE_WITH_WARNINGS",
  "NOT_ELIGIBLE",
  "INSUFFICIENT_EVIDENCE",
] as const;
export type DatasetEligibilityStatus = (typeof datasetEligibilityStatuses)[number];

export const datasetEligibilityReasonCodes = [
  "QUALITY_QUALIFIED",
  "QUALITY_WARNINGS",
  "QUALITY_NOT_QUALIFIED",
  "QUALITY_REPORT_MISSING",
  "INTEGRITY_VERIFIED",
  "INTEGRITY_MISMATCH",
  "PROVENANCE_INCOMPLETE",
  "LIFECYCLE_QUARANTINED",
  "LIFECYCLE_INVALIDATED",
  "UNSUPPORTED_INTENDED_USE",
  "LINEAGE_BROKEN",
  "LIFECYCLE_ACTIVE",
  "LIFECYCLE_REGISTERED_ONLY",
] as const;
export type DatasetEligibilityReasonCode = (typeof datasetEligibilityReasonCodes)[number];

export const datasetIntendedUses = [
  "RESEARCH_EXPLORATION",
  "BACKTEST_CANDIDATE",
  "SIMULATION_CANDIDATE",
  "PAPER_REVIEW",
  "GENERAL_RESEARCH",
  "BACKTEST_RESEARCH",
  "SIMULATION_RESEARCH",
  "FEATURE_RESEARCH",
  "VISUALIZATION",
] as const;
export type DatasetIntendedUse = (typeof datasetIntendedUses)[number];

export const datasetReproducibilityStatuses = [
  "REPRODUCIBLE",
  "PARTIALLY_REPRODUCIBLE",
  "NOT_REPRODUCIBLE",
  "INSUFFICIENT_EVIDENCE",
] as const;
export type DatasetReproducibilityStatus = (typeof datasetReproducibilityStatuses)[number];

export const datasetLineageRelationshipTypes = [
  "DERIVED_FROM",
  "IMPORTED_FROM",
  "FILTERED_FROM",
  "MERGED_FROM",
  "NORMALIZED_FROM",
  "SUPERSEDES",
] as const;
export type DatasetLineageRelationshipType = (typeof datasetLineageRelationshipTypes)[number];

export const datasetTransformationTypes = [
  "IMPORT",
  "FILTER",
  "MERGE",
  "NORMALIZE",
  "QUALITY_GATED_SELECTION",
  "AGGREGATE",
  "RESAMPLE",
  "REPLAY_CAPTURE",
  "FEATURE_DERIVATION",
] as const;
export type DatasetTransformationType = (typeof datasetTransformationTypes)[number];

export const implementedTransformationTypes = [
  "IMPORT",
  "FILTER",
  "MERGE",
  "NORMALIZE",
  "QUALITY_GATED_SELECTION",
] as const;
export type ImplementedTransformationType = (typeof implementedTransformationTypes)[number];

export type DatasetFamilyDefinition = Readonly<{
  familyId: DatasetFamilyId;
  displayName: string;
  purpose: string;
  identityDimensions: DatasetFamilyIdentityDimensions;
  createdAt: UtcTimestamp;
  createdBy?: Actor;
  metadata: SafeCatalogueMetadata;
  familyFingerprint: DatasetFingerprint;
}>;

export type DatasetFamilyIdentityDimensions = Readonly<{
  instrumentIds: readonly InstrumentId[];
  observationKinds: readonly MarketObservationKind[];
  timeframes: readonly string[];
  sourceIds: readonly SourceId[];
  schemaFamily: string;
  originType: ImplementedDatasetOriginType;
}>;

export type DatasetContentReference = Readonly<{
  historicalDatasetId?: HistoricalDatasetId;
  contentFingerprint: HistoricalFingerprint | DatasetFingerprint;
  schemaIdentity: string;
  manifestFingerprint?: DatasetFingerprint;
  materializationType: DatasetMaterializationType;
  safeStorageRef?: string;
}>;

export type DatasetContentSummary = Readonly<{
  instrumentIds: readonly InstrumentId[];
  observationKinds: readonly MarketObservationKind[];
  timeframes: readonly string[];
  sourceIds: readonly SourceId[];
  firstEventTime?: UtcTimestamp;
  lastEventTime?: UtcTimestamp;
  observationCount: number;
  partitionCount: number;
}>;

export type DatasetSourceReference = Readonly<{
  sourceId?: SourceId;
  sourceName: string;
  provider?: string;
  providerSymbol?: string;
  artifactId?: string;
  artifactChecksum?: HistoricalContentChecksum | string;
  originalSourceType: "PROMPT14_ARTIFACT" | "EXTERNAL_SOURCE" | "CATALOGUE_DATASET";
  importPlanFingerprint?: HistoricalFingerprint | string;
  importProfileId?: string;
  importSessionId?: string;
  mappingFingerprint?: string;
  schemaIdentity?: string;
  metadata: SafeCatalogueMetadata;
}>;

export type DatasetTransformation = Readonly<{
  transformationId: DatasetTransformationId;
  transformationType: ImplementedTransformationType;
  transformationVersion: string;
  inputDatasetVersionIds: readonly DatasetVersionId[];
  outputDatasetVersionId: DatasetVersionId;
  configurationFingerprint?: string;
  parameters: SafeCatalogueMetadata;
  startedAt?: UtcTimestamp;
  completedAt?: UtcTimestamp;
  actor?: Actor;
  transformationFingerprint: DatasetFingerprint;
}>;

export type DatasetProvenance = Readonly<{
  originType: ImplementedDatasetOriginType;
  sources: readonly DatasetSourceReference[];
  transformations: readonly DatasetTransformation[];
  provenanceFingerprint: DatasetFingerprint;
}>;

export type DatasetLineageNodeRef = Readonly<
  | { nodeType: "DATASET_VERSION"; datasetVersionId: DatasetVersionId }
  | {
      nodeType: "SOURCE_ARTIFACT";
      artifactId: string;
      artifactChecksum?: HistoricalContentChecksum | string;
    }
  | { nodeType: "EXTERNAL_SOURCE"; externalSourceId: string; sourceName: string }
>;

export type DatasetLineageEdge = Readonly<{
  edgeId: DatasetLineageEdgeId;
  source: DatasetLineageNodeRef;
  target: DatasetLineageNodeRef;
  relationshipType: DatasetLineageRelationshipType;
  transformationId?: DatasetTransformationId;
  createdAt: UtcTimestamp;
  actor?: Actor;
  evidence: readonly string[];
  edgeFingerprint: DatasetFingerprint;
}>;

export type DatasetLineageGraph = Readonly<{
  versionId: DatasetVersionId;
  parents: readonly DatasetVersionId[];
  children: readonly DatasetVersionId[];
  edges: readonly DatasetLineageEdge[];
  lineageFingerprint: DatasetFingerprint;
}>;

export type DatasetIntegrityVerification = Readonly<{
  verificationId: DatasetIntegrityVerificationId;
  status: DatasetIntegrityStatus;
  checkedAt: UtcTimestamp;
  issues: readonly string[];
  manifestFingerprint?: DatasetFingerprint;
  contentFingerprint: HistoricalFingerprint | DatasetFingerprint;
  provenanceFingerprint: DatasetFingerprint;
  lineageFingerprint: DatasetFingerprint;
}>;

export type DatasetIntegrityMetadata = Readonly<{
  status: DatasetIntegrityStatus;
  contentFingerprint: HistoricalFingerprint | DatasetFingerprint;
  manifestFingerprint?: DatasetFingerprint;
  partitionChecksums: readonly string[];
  schemaIdentity: string;
  registrationFingerprint: DatasetFingerprint;
  provenanceFingerprint: DatasetFingerprint;
  lineageFingerprint: DatasetFingerprint;
  verifiedAt?: UtcTimestamp;
  verificationHistory: readonly DatasetIntegrityVerification[];
}>;

export type DatasetQualityReference = Readonly<{
  reportId: DataQualityReportId;
  profileId: DataQualityProfileId;
  profileVersion: string;
  analysisFingerprint: string;
  reportFingerprint: string;
  score: number;
  qualityClass: DataQualityClass;
  qualification: DataQualityQualificationStatus;
  blockingFindingCount: number;
  completedAt: UtcTimestamp;
  intendedUses: readonly DatasetIntendedUse[];
}>;

export type DatasetLifecycleTransition = Readonly<{
  from?: DatasetLifecycleState;
  to: DatasetLifecycleState;
  reason: string;
  actor?: Actor;
  timestamp: UtcTimestamp;
  correlationId?: CorrelationId;
  causationId?: CausationId;
  evidence: readonly string[];
}>;

export type DatasetEligibility = Readonly<{
  intendedUse: DatasetIntendedUse;
  status: DatasetEligibilityStatus;
  reasonCodes: readonly DatasetEligibilityReasonCode[];
  explanation: string;
  evaluatedAt: UtcTimestamp;
  qualityReportId?: DataQualityReportId;
}>;

export type DatasetReproducibilityRecord = Readonly<{
  status: DatasetReproducibilityStatus;
  sourceArtifactChecksums: readonly string[];
  parentDatasetVersionIds: readonly DatasetVersionId[];
  parentFingerprints: readonly string[];
  importPlanFingerprint?: string;
  mappingFingerprint?: string;
  schemaIdentity: string;
  transformationFingerprints: readonly DatasetFingerprint[];
  configurationFingerprint?: string;
  applicationVersion?: string;
  expectedContentFingerprint: string;
  missingEvidence: readonly string[];
  explanation: string;
}>;

export type DatasetVersionRecord = Readonly<{
  familyId: DatasetFamilyId;
  versionId: DatasetVersionId;
  versionSequence: number;
  createdAt: UtcTimestamp;
  registeredAt: UtcTimestamp;
  registeredBy?: Actor;
  runtimeMode: Exclude<RuntimeMode, "LIVE">;
  content: DatasetContentReference;
  contentSummary: DatasetContentSummary;
  historicalManifest?: HistoricalDatasetManifest;
  provenance: DatasetProvenance;
  lineage: DatasetLineageGraph;
  integrity: DatasetIntegrityMetadata;
  qualityReferences: readonly DatasetQualityReference[];
  lifecycleState: DatasetLifecycleState;
  lifecycleHistory: readonly DatasetLifecycleTransition[];
  eligibility: readonly DatasetEligibility[];
  reproducibility: DatasetReproducibilityRecord;
  metadata: SafeCatalogueMetadata;
  registrationFingerprint: DatasetFingerprint;
  versionFingerprint: DatasetFingerprint;
  catalogueStateFingerprint: DatasetFingerprint;
}>;

export type DatasetCatalogueEntry = Readonly<{
  family: DatasetFamilyDefinition;
  version: DatasetVersionRecord;
}>;

export type DatasetRegistrationRequest = Readonly<{
  family?: Partial<
    Pick<DatasetFamilyDefinition, "familyId" | "displayName" | "purpose" | "metadata">
  >;
  historicalDatasetId?: HistoricalDatasetId;
  externalContent?: DatasetContentReference;
  parentDatasetVersionIds?: readonly DatasetVersionId[];
  qualityReportIds?: readonly DataQualityReportId[];
  intendedUses?: readonly DatasetIntendedUse[];
  lifecycleState?: DatasetLifecycleState;
  setActive?: boolean;
  actor?: Actor;
  reason: string;
  runtimeMode: Exclude<RuntimeMode, "LIVE">;
  metadata?: SafeCatalogueMetadata;
  expectedFamilyVersion?: number;
  correlationId?: CorrelationId;
  causationId?: CausationId;
}>;

export type DatasetRegistrationResult = Readonly<{
  entry: DatasetCatalogueEntry;
  idempotent: boolean;
  createdFamily: boolean;
  activeVersionChanged: boolean;
}>;

export type DatasetCatalogueQuery = Readonly<{
  familyId?: DatasetFamilyId;
  versionId?: DatasetVersionId;
  instrumentId?: InstrumentId;
  observationKind?: MarketObservationKind;
  timeframe?: string;
  sourceId?: SourceId;
  lifecycleState?: DatasetLifecycleState;
  integrityStatus?: DatasetIntegrityStatus;
  qualityQualification?: DataQualityQualificationStatus;
  intendedUse?: DatasetIntendedUse;
  createdAfter?: UtcTimestamp;
  createdBefore?: UtcTimestamp;
  limit: number;
  cursor?: string;
}>;

export type DatasetCataloguePage = Readonly<{
  entries: readonly DatasetCatalogueEntry[];
  nextCursor?: string;
}>;

export type DatasetLineageTraversal = Readonly<{
  rootVersionId: DatasetVersionId;
  nodes: readonly DatasetVersionRecord[];
  edges: readonly DatasetLineageEdge[];
  truncated: boolean;
  depth: number;
  fingerprint: DatasetFingerprint;
}>;

export type DatasetRootSources = Readonly<{
  datasetVersionId: DatasetVersionId;
  sources: readonly DatasetSourceReference[];
  artifactIds: readonly string[];
  providerNames: readonly string[];
  truncated: boolean;
}>;

export type DatasetLineageExplanation = Readonly<{
  datasetVersionId: DatasetVersionId;
  directParents: readonly DatasetVersionId[];
  directChildren: readonly DatasetVersionId[];
  rootSources: DatasetRootSources;
  ancestry: DatasetLineageTraversal;
  descendants: DatasetLineageTraversal;
  integrityStatus: DatasetIntegrityStatus;
  brokenLineageIssues: readonly string[];
}>;

export type DatasetImpactAnalysis = Readonly<{
  rootVersionId: DatasetVersionId;
  directDependants: readonly DatasetVersionId[];
  transitiveDependants: readonly DatasetVersionId[];
  affectedEntries: readonly DatasetCatalogueEntry[];
  truncated: boolean;
  depth: number;
  reason: string;
}>;

export type DatasetVersionComparison = Readonly<{
  leftVersionId: DatasetVersionId;
  rightVersionId: DatasetVersionId;
  contentChanged: boolean;
  qualityChanged: boolean;
  lifecycleChanged: boolean;
  lineageChanged: boolean;
  differences: readonly string[];
}>;

export type DatasetCatalogueSnapshot = Readonly<{
  snapshotId: DatasetCatalogueSnapshotId;
  createdAt: UtcTimestamp;
  familyCount: number;
  versionCount: number;
  activePointerCount: number;
  lineageEdgeCount: number;
  snapshotFingerprint: DatasetFingerprint;
}>;

export type DatasetCatalogueDiagnostics = Readonly<{
  state: "CREATED" | "INITIALIZING" | "READY" | "DEGRADED" | "STOPPING" | "STOPPED" | "FAILED";
  familyCount: number;
  versionCount: number;
  activeCount: number;
  qualifiedCount: number;
  quarantinedCount: number;
  invalidatedCount: number;
  retiredCount: number;
  integrityMismatchCount: number;
  brokenLineageCount: number;
  orphanCount: number;
  qualityLinkedCount: number;
  lineageEdgeCount: number;
  maximumObservedLineageDepth: number;
  recentRegistrations: readonly DatasetVersionId[];
  recentFailures: readonly DatasetCatalogueError[];
  repositoryStatus: "READY" | "DEGRADED" | "FAILED";
  catalogueFingerprint?: DatasetFingerprint;
  snapshotId?: DatasetCatalogueSnapshotId;
  configurationFingerprint?: string;
}>;

export type DatasetCatalogueRepository = Readonly<{
  register: (
    entry: DatasetCatalogueEntry,
    options?: DatasetRepositoryWriteOptions,
  ) => Promise<DatasetCatalogueResult<DatasetRegistrationResult>>;
  getFamily: (
    familyId: DatasetFamilyId,
  ) => Promise<DatasetCatalogueResult<DatasetFamilyDefinition>>;
  getVersion: (
    versionId: DatasetVersionId,
  ) => Promise<DatasetCatalogueResult<DatasetVersionRecord>>;
  query: (query: DatasetCatalogueQuery) => Promise<DatasetCatalogueResult<DatasetCataloguePage>>;
  transitionLifecycle: (
    versionId: DatasetVersionId,
    transition: DatasetLifecycleTransition,
  ) => Promise<DatasetCatalogueResult<DatasetVersionRecord>>;
  attachQualityReference: (
    versionId: DatasetVersionId,
    reference: DatasetQualityReference,
  ) => Promise<DatasetCatalogueResult<DatasetVersionRecord>>;
  verifyIntegrity: (
    versionId: DatasetVersionId,
    verification: DatasetIntegrityVerification,
  ) => Promise<DatasetCatalogueResult<DatasetVersionRecord>>;
  setActiveVersion: (
    familyId: DatasetFamilyId,
    versionId: DatasetVersionId,
    expectedCurrentVersionId?: DatasetVersionId,
  ) => Promise<DatasetCatalogueResult<DatasetVersionRecord>>;
  getActiveVersion: (
    familyId: DatasetFamilyId,
  ) => Promise<DatasetCatalogueResult<DatasetVersionRecord>>;
  getAncestors: (
    versionId: DatasetVersionId,
    options?: DatasetLineageTraversalOptions,
  ) => Promise<DatasetCatalogueResult<DatasetLineageTraversal>>;
  getDescendants: (
    versionId: DatasetVersionId,
    options?: DatasetLineageTraversalOptions,
  ) => Promise<DatasetCatalogueResult<DatasetLineageTraversal>>;
  createSnapshot: () => Promise<DatasetCatalogueResult<DatasetCatalogueSnapshot>>;
  diagnostics: () => Promise<DatasetCatalogueResult<DatasetCatalogueDiagnostics>>;
}>;

export type DatasetRepositoryWriteOptions = Readonly<{
  expectedFamilyVersion?: number;
  setActive?: boolean;
}>;

export type DatasetLineageTraversalOptions = Readonly<{
  maxDepth?: number;
  maxNodes?: number;
}>;

export type DatasetCatalogueServiceInput = Readonly<{
  clock: Clock;
  repository: DatasetCatalogueRepository;
  historicalRepository: HistoricalDatasetRepository;
  qualityRepository?: DataQualityReportRepository;
  maxQueryPageSize?: number;
  maxLineageDepth?: number;
  maxLineageNodes?: number;
  maxParentsPerDataset?: number;
  requireQualityForQualification?: boolean;
  requireVerifiedIntegrity?: boolean;
}>;

export type DatasetCatalogueService = Readonly<{
  registerDataset: (
    request: DatasetRegistrationRequest,
  ) => Promise<DatasetCatalogueResult<DatasetRegistrationResult>>;
  explainDataset: (
    versionId: DatasetVersionId,
  ) => Promise<DatasetCatalogueResult<DatasetCatalogueEntry>>;
  explainLineage: (
    versionId: DatasetVersionId,
  ) => Promise<DatasetCatalogueResult<DatasetLineageExplanation>>;
  explainEligibility: (
    versionId: DatasetVersionId,
    intendedUse: DatasetIntendedUse,
  ) => Promise<DatasetCatalogueResult<DatasetEligibility>>;
  analyzeDatasetImpact: (
    versionId: DatasetVersionId,
    options?: DatasetLineageTraversalOptions,
  ) => Promise<DatasetCatalogueResult<DatasetImpactAnalysis>>;
  compareDatasetVersions: (
    leftVersionId: DatasetVersionId,
    rightVersionId: DatasetVersionId,
  ) => Promise<DatasetCatalogueResult<DatasetVersionComparison>>;
  linkQualityReport: (
    versionId: DatasetVersionId,
    reportId: DataQualityReportId,
  ) => Promise<DatasetCatalogueResult<DatasetVersionRecord>>;
  verifyDatasetIntegrity: (
    versionId: DatasetVersionId,
  ) => Promise<DatasetCatalogueResult<DatasetVersionRecord>>;
  queryDatasets: (
    query: DatasetCatalogueQuery,
  ) => Promise<DatasetCatalogueResult<DatasetCataloguePage>>;
  setActiveVersion: (
    familyId: DatasetFamilyId,
    versionId: DatasetVersionId,
    expectedCurrentVersionId?: DatasetVersionId,
  ) => Promise<DatasetCatalogueResult<DatasetVersionRecord>>;
  createSnapshot: () => Promise<DatasetCatalogueResult<DatasetCatalogueSnapshot>>;
  diagnostics: () => Promise<DatasetCatalogueResult<DatasetCatalogueDiagnostics>>;
  recentRegistrationIds: () => readonly DatasetVersionId[];
  recentFailures: () => readonly DatasetCatalogueError[];
}>;

export type QualityReportResolver = Readonly<{
  getReport: (reportId: DataQualityReportId) => Promise<DataQualityReport | undefined>;
}>;

export type HistoricalManifestResolver = Readonly<{
  getManifest: (datasetId: HistoricalDatasetId) => Promise<HistoricalDatasetManifest | undefined>;
}>;

export type ManifestPartitionSummary = Pick<
  HistoricalPartitionManifest,
  "partitionId" | "checksum" | "rowCount"
>;
