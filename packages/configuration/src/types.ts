import type {
  AccountId,
  AssetClass,
  BrokerId,
  InstrumentId,
  RuntimeMode,
  StrategyId,
  Timeframe,
  UtcTimestamp,
} from "@ate/domain";

export type ConfigurationKey = string & { readonly __brand: "ConfigurationKey" };
export type ConfigurationSnapshotId = string & { readonly __brand: "ConfigurationSnapshotId" };
export type ConfigurationFingerprint = string & { readonly __brand: "ConfigurationFingerprint" };
export type ConfigurationSourceId = string & { readonly __brand: "ConfigurationSourceId" };
export type ConfigurationCacheKey = string & { readonly __brand: "ConfigurationCacheKey" };

export const configurationDomains = [
  "SYSTEM",
  "ENVIRONMENT",
  "BROKER",
  "ACCOUNT",
  "ASSET_CLASS",
  "INSTRUMENT",
  "TIMEFRAME",
  "REGIME",
  "STRATEGY",
  "RISK",
  "PORTFOLIO",
  "EXECUTION",
  "SURVEILLANCE",
  "DATA",
  "NEWS",
  "LEARNING",
  "REPORTING",
] as const;
export type ConfigurationDomain = (typeof configurationDomains)[number];

export const configurationScopeTypes = [
  "SYSTEM",
  "ENVIRONMENT",
  "BROKER",
  "ACCOUNT",
  "ASSET_CLASS",
  "INSTRUMENT",
  "TIMEFRAME",
  "REGIME",
  "STRATEGY",
  "PORTFOLIO",
  "RISK",
  "EXECUTION",
  "SURVEILLANCE",
  "DATA",
  "NEWS",
  "LEARNING",
  "REPORTING",
] as const;
export type ConfigurationScopeType = (typeof configurationScopeTypes)[number];

export const configurationSourceTypes = [
  "BUILT_IN",
  "FILE",
  "ENVIRONMENT",
  "PERSISTED",
  "RUNTIME",
  "TEST",
] as const;
export type ConfigurationSourceType = (typeof configurationSourceTypes)[number];

export type ConfigurationSourceCriticality = "REQUIRED" | "OPTIONAL";
export type ConfigurationSourceHealth = "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "STALE";
export type ConfigurationFailurePolicy = "FAIL_CLOSED" | "USE_LAST_KNOWN_GOOD" | "OPTIONAL_SOURCE";
export type ConfigurationEntryOperation = "SET" | "UNSET";
export type ConfigurationEntryState = "ACTIVE" | "DISABLED";
export type ConfigurationSensitivity = "PUBLIC" | "INTERNAL" | "SENSITIVE" | "SECRET_REFERENCE";
export type ConfigurationValueType =
  | "BOOLEAN"
  | "INTEGER"
  | "DECIMAL"
  | "STRING"
  | "ENUM"
  | "DURATION_MS"
  | "TIMESTAMP"
  | "TIMEZONE"
  | "IDENTIFIER"
  | "OBJECT"
  | "LIST"
  | "SECRET_REFERENCE"
  | "UNKNOWN";

export type ConfigurationMergePolicy =
  "REPLACE" | "DEEP_MERGE" | "APPEND" | "SET_UNION" | "NO_MERGE";

export type SecretReference = Readonly<{
  kind: "SECRET_REFERENCE";
  ref: string;
  provider?: string;
}>;

export type ConfigurationPrimitiveValue = boolean | number | string | null;
export interface ConfigurationObjectValue {
  [key: string]: ConfigurationValue;
}
export type ConfigurationListValue = readonly ConfigurationValue[];
export type ConfigurationValue =
  ConfigurationPrimitiveValue | SecretReference | ConfigurationListValue | ConfigurationObjectValue;

export type ConfigurationScope = Readonly<{
  scopeType: ConfigurationScopeType;
  scopeId?: string;
}>;

export type ConfigurationContext = Readonly<{
  runtimeMode?: RuntimeMode;
  brokerId?: BrokerId | string;
  accountId?: AccountId | string;
  assetClass?: AssetClass;
  instrumentId?: InstrumentId | string;
  timeframe?: Timeframe;
  regime?: string;
  strategyId?: StrategyId | string;
  portfolioId?: string;
  dimensions?: Readonly<Record<string, string>>;
}>;

export type ScopePrecedenceRule = Readonly<{
  scopeType: ConfigurationScopeType;
  rank: number;
  reason: string;
}>;

export type ScopePrecedencePolicy = Readonly<{
  policyId: string;
  rules: readonly ScopePrecedenceRule[];
}>;

export type ConfigurationDefinition = Readonly<{
  key: ConfigurationKey;
  domain: ConfigurationDomain;
  displayName: string;
  description: string;
  valueType: ConfigurationValueType;
  required: boolean;
  failClosed: boolean;
  allowedScopes: readonly ConfigurationScopeType[];
  mergePolicy: ConfigurationMergePolicy;
  sensitivity: ConfigurationSensitivity;
  precedence?: ScopePrecedencePolicy;
  defaultValue?: ConfigurationValue;
  metadata?: ConfigurationDefinitionMetadata;
}>;

export type ConfigurationDefinitionMetadata = Readonly<{
  purpose?: string;
  effect?: string;
  riskImplication?: string;
  reloadRequirement?: "NONE" | "REFRESH" | "RESTART";
  relatedSettings?: readonly ConfigurationKey[];
  uiHint?: string;
}>;

export type ConfigurationSourceDescriptor = Readonly<{
  sourceId: ConfigurationSourceId;
  sourceType: ConfigurationSourceType;
  name: string;
  criticality: ConfigurationSourceCriticality;
  failurePolicy: ConfigurationFailurePolicy;
  priority: number;
  loadedAt?: UtcTimestamp;
  health: ConfigurationSourceHealth;
}>;

export type ConfigurationEntry = Readonly<{
  key: ConfigurationKey;
  domain: ConfigurationDomain;
  scope: ConfigurationScope;
  value?: ConfigurationValue;
  operation: ConfigurationEntryOperation;
  state: ConfigurationEntryState;
  source: ConfigurationSourceDescriptor;
  loadedAt: UtcTimestamp;
  metadata: Readonly<Record<string, ConfigurationValue>>;
}>;

export type ConfigurationLayer = Readonly<{
  source: ConfigurationSourceDescriptor;
  entries: readonly ConfigurationEntry[];
  loadedAt: UtcTimestamp;
  fingerprint: ConfigurationFingerprint;
}>;

export type ConfigurationSourceLoad = Readonly<{
  source: ConfigurationSourceDescriptor;
  entries: readonly Omit<ConfigurationEntry, "source" | "loadedAt">[];
  loadedAt: UtcTimestamp;
}>;

export type ConfigurationSource = Readonly<{
  descriptor: ConfigurationSourceDescriptor;
  load: () => Promise<ConfigurationSourceLoad> | ConfigurationSourceLoad;
}>;

export type ConfigurationConflictType =
  | "DUPLICATE_ENTRY"
  | "EQUAL_PRECEDENCE_CONFLICT"
  | "UNKNOWN_KEY"
  | "INVALID_SCOPE"
  | "INCOMPATIBLE_CONTEXT"
  | "SOURCE_FAILURE"
  | "RESOLUTION_CYCLE"
  | "MISSING_REQUIRED_CONFIGURATION"
  | "SECRET_VALUE_FORBIDDEN"
  | "MERGE_CONFLICT"
  | "LIMIT_EXCEEDED";

export type ConfigurationValidationPhase =
  | "SCHEMA"
  | "SOURCE_ENTRY"
  | "STRUCTURAL"
  | "TYPE"
  | "CONSTRAINT"
  | "SCOPE_APPLICABILITY"
  | "DEPENDENCY"
  | "CONDITIONAL"
  | "CROSS_FIELD"
  | "EFFECTIVE_CONFIGURATION"
  | "PUBLICATION_GATE";

export type ConfigurationValidationSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export type ConfigurationValidationIssue = Readonly<{
  phase: ConfigurationValidationPhase;
  severity: ConfigurationValidationSeverity;
  message: string;
  key?: ConfigurationKey;
  scope?: ConfigurationScope;
  path?: string;
  expected?: string;
  receivedType?: string;
  constraint?: string;
  dependencyKey?: ConfigurationKey;
  metadata?: Readonly<Record<string, string | number | boolean>>;
}>;

export type ConfigurationValidationSummary = Readonly<{
  issueCount: number;
  blockingIssueCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  phaseCounts: Readonly<Record<ConfigurationValidationPhase, number>>;
}>;

export type ConfigurationValidationReport = Readonly<{
  reportId: string;
  fingerprint: ConfigurationFingerprint;
  generatedAt: UtcTimestamp;
  schemaFingerprint: ConfigurationFingerprint;
  snapshotId?: ConfigurationSnapshotId;
  context?: ConfigurationContext;
  issues: readonly ConfigurationValidationIssue[];
  summary: ConfigurationValidationSummary;
  publicationAllowed: boolean;
}>;

export type ConfigurationConflict = Readonly<{
  type: ConfigurationConflictType;
  key?: ConfigurationKey;
  message: string;
  entries: readonly ConfigurationEntry[];
}>;

export type ConfigurationSnapshot = Readonly<{
  snapshotId: ConfigurationSnapshotId;
  fingerprint: ConfigurationFingerprint;
  createdAt: UtcTimestamp;
  registryFingerprint: ConfigurationFingerprint;
  sourceFingerprints: Readonly<Record<string, ConfigurationFingerprint>>;
  sourceHealth: Readonly<Record<string, ConfigurationSourceHealth>>;
  entries: readonly ConfigurationEntry[];
  conflicts: readonly ConfigurationConflict[];
}>;

export type ResolutionCandidate = Readonly<{
  entry: ConfigurationEntry;
  applicable: boolean;
  rank?: number;
  reason: string;
}>;

export type ConfigurationProvenance = Readonly<{
  key: ConfigurationKey;
  finalValue?: ConfigurationValue;
  winningEntry?: ConfigurationEntry;
  winningScope?: ConfigurationScope;
  winningSource?: ConfigurationSourceDescriptor;
  considered: readonly ResolutionCandidate[];
  overridden: readonly ConfigurationEntry[];
  precedencePolicy: ScopePrecedencePolicy;
  reasoning: string;
}>;

export type EffectiveConfigurationValue = Readonly<{
  key: ConfigurationKey;
  value?: ConfigurationValue;
  present: boolean;
  provenance: ConfigurationProvenance;
}>;

export type EffectiveConfiguration = Readonly<{
  snapshotId: ConfigurationSnapshotId;
  fingerprint: ConfigurationFingerprint;
  context: ConfigurationContext;
  resolvedAt: UtcTimestamp;
  values: ReadonlyMap<ConfigurationKey, EffectiveConfigurationValue>;
  conflicts: readonly ConfigurationConflict[];
  diagnostics: ConfigurationResolutionDiagnostics;
}>;

export type ConfigurationExplanation = Readonly<{
  key: ConfigurationKey;
  context: ConfigurationContext;
  effective?: EffectiveConfigurationValue;
  candidates: readonly ResolutionCandidate[];
  conflicts: readonly ConfigurationConflict[];
  reasoning: string;
}>;

export type ConfigurationResolutionDiagnostics = Readonly<{
  resolvedKeyCount: number;
  missingRequiredKeys: readonly ConfigurationKey[];
  conflictCount: number;
  consideredEntryCount: number;
}>;

export type ConfigurationCacheSnapshot = Readonly<{
  size: number;
  maxEntries: number;
  hits: number;
  misses: number;
  evictions: number;
  invalidations: number;
}>;

export type ConfigurationDiagnostics = Readonly<{
  state: "CREATED" | "INITIALIZING" | "READY" | "DEGRADED" | "STOPPED" | "FAILED";
  runtimeMode: RuntimeMode;
  activeSnapshotId?: ConfigurationSnapshotId;
  activeFingerprint?: ConfigurationFingerprint;
  registeredKeyCount: number;
  sourceCount: number;
  sourceHealth: Readonly<Record<string, ConfigurationSourceHealth>>;
  scopeCounts: Readonly<Record<string, number>>;
  resolutionCount: number;
  resolutionFailures: number;
  conflictCount: number;
  missingRequiredValues: readonly ConfigurationKey[];
  cache: ConfigurationCacheSnapshot;
  lastSuccessfulLoad?: UtcTimestamp;
  lastSourceFailure?: UtcTimestamp;
  recentErrors: readonly ConfigurationError[];
  schema?: ConfigurationSchemaDiagnostics;
}>;

export type ConfigurationSchemaDiagnostics = Readonly<{
  registeredSchemaCount: number;
  schemaFingerprint: ConfigurationFingerprint;
  lastReportFingerprint?: ConfigurationFingerprint;
  lastReportSummary?: ConfigurationValidationSummary;
  blockingIssueCount: number;
}>;

export const configurationErrorCodes = [
  "CONFIGURATION_KEY_UNKNOWN",
  "CONFIGURATION_KEY_DUPLICATE",
  "CONFIGURATION_SCHEMA_INVALID",
  "CONFIGURATION_SCOPE_INVALID",
  "CONFIGURATION_CONTEXT_INVALID",
  "CONFIGURATION_CONFLICT",
  "CONFIGURATION_PRECEDENCE_UNDEFINED",
  "CONFIGURATION_REQUIRED_VALUE_MISSING",
  "CONFIGURATION_SOURCE_UNAVAILABLE",
  "CONFIGURATION_SOURCE_STALE",
  "CONFIGURATION_LOAD_FAILED",
  "CONFIGURATION_REFRESH_FAILED",
  "CONFIGURATION_SNAPSHOT_INVALID",
  "CONFIGURATION_CYCLE_DETECTED",
  "CONFIGURATION_SECRET_VALUE_FORBIDDEN",
  "CONFIGURATION_VALIDATION_FAILED",
  "CONFIGURATION_RUNTIME_MODE_MISMATCH",
  "CONFIGURATION_LIMIT_EXCEEDED",
  "CONFIGURATION_VERSION_NOT_FOUND",
  "CONFIGURATION_VERSION_ALREADY_EXISTS",
  "CONFIGURATION_VERSION_PARENT_NOT_FOUND",
  "CONFIGURATION_VERSION_PARENT_MISMATCH",
  "CONFIGURATION_VERSION_CONCURRENCY_CONFLICT",
  "CONFIGURATION_VERSION_LINEAGE_INVALID",
  "CONFIGURATION_VERSION_CYCLE_DETECTED",
  "CONFIGURATION_VERSION_INTEGRITY_FAILED",
  "CONFIGURATION_VERSION_FINGERPRINT_MISMATCH",
  "CONFIGURATION_VERSION_SCHEMA_MISMATCH",
  "CONFIGURATION_VERSION_RECONSTRUCTION_FAILED",
  "CONFIGURATION_VERSION_NO_SEMANTIC_CHANGE",
  "CONFIGURATION_VERSION_CHANGESET_INVALID",
  "CONFIGURATION_VERSION_DIFF_LIMIT_EXCEEDED",
  "CONFIGURATION_VERSION_HISTORY_UNAVAILABLE",
  "CONFIGURATION_VERSION_PERSISTENCE_FAILED",
  "CONFIGURATION_VERSION_CURRENT_POINTER_INVALID",
  "CONFIGURATION_VERSION_ATTRIBUTION_REQUIRED",
  "CONFIGURATION_VERSION_REASON_INVALID",
  "CONFIGURATION_CAPABILITY_UNKNOWN",
  "CONFIGURATION_CAPABILITY_DUPLICATE",
  "CONFIGURATION_CAPABILITY_INVALID",
  "CONFIGURATION_CAPABILITY_DEPENDENCY_INVALID",
  "CONFIGURATION_CAPABILITY_CYCLE_DETECTED",
  "CONFIGURATION_CAPABILITY_SNAPSHOT_INVALID",
  "CONFIGURATION_FEATURE_FLAG_UNKNOWN",
  "CONFIGURATION_FEATURE_FLAG_DUPLICATE",
  "CONFIGURATION_FEATURE_FLAG_INVALID",
  "APPROVAL_POLICY_UNKNOWN",
  "APPROVAL_POLICY_DUPLICATE",
  "APPROVAL_POLICY_INVALID",
  "APPROVAL_POLICY_CONFLICT",
  "APPROVAL_REQUEST_NOT_FOUND",
  "APPROVAL_REQUEST_ALREADY_EXISTS",
  "APPROVAL_REQUEST_INVALID",
  "APPROVAL_VERSION_INVALID",
  "APPROVAL_VERSION_MISMATCH",
  "APPROVAL_CHANGESET_MISMATCH",
  "APPROVAL_CONFIGURATION_FINGERPRINT_MISMATCH",
  "APPROVAL_SCHEMA_FINGERPRINT_MISMATCH",
  "APPROVAL_POLICY_FINGERPRINT_MISMATCH",
  "APPROVAL_MAKER_CHECKER_CONFLICT",
  "APPROVAL_CHECKER_UNAUTHORIZED",
  "APPROVAL_ALREADY_DECIDED",
  "APPROVAL_DECISION_CONFLICT",
  "APPROVAL_REJECTED",
  "APPROVAL_EXPIRED",
  "APPROVAL_REVOKED",
  "APPROVAL_SUPERSEDED",
  "APPROVAL_STALE",
  "APPROVAL_REQUIRED",
  "APPROVAL_NOT_SATISFIED",
  "APPROVAL_REASON_REQUIRED",
  "APPROVAL_INTEGRITY_FAILED",
  "APPROVAL_CONCURRENCY_CONFLICT",
  "APPROVAL_IDEMPOTENCY_CONFLICT",
  "APPROVAL_LIMIT_EXCEEDED",
] as const;
export type ConfigurationErrorCode = (typeof configurationErrorCodes)[number];

export type ConfigurationError = Readonly<{
  code: ConfigurationErrorCode;
  message: string;
  severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  timestamp: UtcTimestamp;
  key?: ConfigurationKey;
  details?: Record<string, unknown>;
}>;

export type ConfigurationResult<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: ConfigurationError }>;

export type BootstrapConfiguration = Readonly<{
  runtimeMode: RuntimeMode;
  sourceRefs: readonly string[];
  logLevel?: string;
  secretProviderRef?: string;
}>;
