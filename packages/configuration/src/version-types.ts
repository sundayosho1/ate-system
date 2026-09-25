import type { Actor, CausationId, CorrelationId, RuntimeMode, UtcTimestamp } from "@ate/domain";
import type { HealthReport, ReadinessReport, RuntimeManagedService } from "@ate/runtime";

import type {
  ConfigurationEntry,
  ConfigurationFingerprint,
  ConfigurationResult,
  ConfigurationScope,
  ConfigurationSnapshot,
  ConfigurationSnapshotId,
  ConfigurationValue,
  ConfigurationValidationReport,
} from "./types.js";

export type ConfigurationVersionId = string & { readonly __brand: "ConfigurationVersionId" };
export type ConfigurationVersionStreamId = string & {
  readonly __brand: "ConfigurationVersionStreamId";
};
export type ConfigurationChangeSetId = string & { readonly __brand: "ConfigurationChangeSetId" };

export type ConfigurationVersionOrigin =
  "OPERATOR" | "SYSTEM" | "AUTOMATION" | "MIGRATION" | "TEST";

export type ConfigurationVersionState = "CREATED" | "SUPERSEDED";

export type ConfigurationVersionValueDigest = Readonly<{
  fingerprint: ConfigurationFingerprint;
  redacted: boolean;
  value?: ConfigurationValue;
}>;

export type ConfigurationVersionEntry = Readonly<{
  identity: string;
  key: ConfigurationEntry["key"];
  domain: ConfigurationEntry["domain"];
  scope: ConfigurationScope;
  operation: ConfigurationEntry["operation"];
  state: ConfigurationEntry["state"];
  sourceId: string;
  sourceType: string;
  loadedAt: UtcTimestamp;
  value?: ConfigurationValue;
  valueFingerprint?: ConfigurationFingerprint;
  valueRedacted: boolean;
  metadataFingerprint: ConfigurationFingerprint;
  metadata: Readonly<Record<string, ConfigurationValue>>;
}>;

export type ConfigurationVersionContent = Readonly<{
  registryFingerprint: ConfigurationFingerprint;
  sourceFingerprints: Readonly<Record<string, ConfigurationFingerprint>>;
  sourceHealth: ConfigurationSnapshot["sourceHealth"];
  entries: readonly ConfigurationVersionEntry[];
}>;

export type ConfigurationChangeOperationType = "ADD" | "MODIFY" | "REMOVE";

export type ConfigurationChangeOperation = Readonly<{
  operation: ConfigurationChangeOperationType;
  identity: string;
  key: ConfigurationEntry["key"];
  scope: ConfigurationScope;
  previous?: ConfigurationVersionValueDigest;
  next?: ConfigurationVersionValueDigest;
  reason?: string;
}>;

export type ConfigurationChangeSet = Readonly<{
  changeSetId: ConfigurationChangeSetId;
  fingerprint: ConfigurationFingerprint;
  operationCount: number;
  operations: readonly ConfigurationChangeOperation[];
}>;

export type ConfigurationVersion = Readonly<{
  versionId: ConfigurationVersionId;
  streamId: ConfigurationVersionStreamId;
  runtimeMode: RuntimeMode;
  sequence: number;
  state: ConfigurationVersionState;
  rootVersionId: ConfigurationVersionId;
  parentVersionId?: ConfigurationVersionId;
  derivedFromVersionId?: ConfigurationVersionId;
  configurationSnapshotId: ConfigurationSnapshotId;
  configurationFingerprint: ConfigurationFingerprint;
  schemaFingerprint: ConfigurationFingerprint;
  validationReportFingerprint?: ConfigurationFingerprint;
  changeSetId: ConfigurationChangeSetId;
  changeSetFingerprint: ConfigurationFingerprint;
  versionFingerprint: ConfigurationFingerprint;
  previousVersionFingerprint?: ConfigurationFingerprint;
  actor: Actor;
  origin: ConfigurationVersionOrigin;
  reason: string;
  createdAt: UtcTimestamp;
  correlationId?: CorrelationId;
  causationId?: CausationId;
  idempotencyKey?: string;
  content: ConfigurationVersionContent;
  changeSet: ConfigurationChangeSet;
}>;

export type ConfigurationVersionDiffEntry = Readonly<{
  operation: ConfigurationChangeOperationType | "UNCHANGED";
  identity: string;
  key: ConfigurationEntry["key"];
  scope: ConfigurationScope;
  previous?: ConfigurationVersionValueDigest;
  next?: ConfigurationVersionValueDigest;
}>;

export type ConfigurationVersionDiff = Readonly<{
  fromVersionId: ConfigurationVersionId;
  toVersionId: ConfigurationVersionId;
  added: readonly ConfigurationVersionDiffEntry[];
  changed: readonly ConfigurationVersionDiffEntry[];
  removed: readonly ConfigurationVersionDiffEntry[];
  unchangedCount: number;
  truncated: boolean;
  limit: number;
  fingerprint: ConfigurationFingerprint;
}>;

export type ConfigurationVersionIntegrityReport = Readonly<{
  versionId: ConfigurationVersionId;
  ok: boolean;
  checkedAt: UtcTimestamp;
  issues: readonly string[];
  recalculatedConfigurationFingerprint: ConfigurationFingerprint;
  recalculatedVersionFingerprint: ConfigurationFingerprint;
}>;

export type ConfigurationVersionReconstruction = Readonly<{
  version: ConfigurationVersion;
  snapshot: ConfigurationSnapshot;
  integrity: ConfigurationVersionIntegrityReport;
  reconstructedAt: UtcTimestamp;
}>;

export type ConfigurationVersionListFilter = Readonly<{
  streamId?: ConfigurationVersionStreamId;
  runtimeMode?: RuntimeMode;
  actorId?: string;
  configurationFingerprint?: ConfigurationFingerprint;
  changedKey?: ConfigurationEntry["key"];
  limit?: number;
  offset?: number;
}>;

export type CreateConfigurationVersionInput = Readonly<{
  snapshot: ConfigurationSnapshot;
  schemaFingerprint: ConfigurationFingerprint;
  validationReport?: ConfigurationValidationReport;
  actor: Actor;
  origin: ConfigurationVersionOrigin;
  reason: string;
  expectedParentVersionId?: ConfigurationVersionId;
  derivedFromVersionId?: ConfigurationVersionId;
  correlationId?: CorrelationId;
  causationId?: CausationId;
  idempotencyKey?: string;
  allowNoSemanticChange?: boolean;
}>;

export type ConfigurationVersionRepository = Readonly<{
  append: (input: CreateConfigurationVersionInput) => ConfigurationResult<ConfigurationVersion>;
  get: (versionId: ConfigurationVersionId) => ConfigurationResult<ConfigurationVersion>;
  getCurrent: (streamId: ConfigurationVersionStreamId) => ConfigurationResult<ConfigurationVersion>;
  list: (filter?: ConfigurationVersionListFilter) => readonly ConfigurationVersion[];
  childrenOf: (versionId: ConfigurationVersionId) => readonly ConfigurationVersion[];
  lineage: (
    versionId: ConfigurationVersionId,
    limit?: number,
  ) => ConfigurationResult<readonly ConfigurationVersion[]>;
  diff: (
    fromVersionId: ConfigurationVersionId,
    toVersionId: ConfigurationVersionId,
    limit?: number,
  ) => ConfigurationResult<ConfigurationVersionDiff>;
  reconstruct: (
    versionId: ConfigurationVersionId,
  ) => ConfigurationResult<ConfigurationVersionReconstruction>;
  verifyIntegrity: (
    versionId: ConfigurationVersionId,
  ) => ConfigurationResult<ConfigurationVersionIntegrityReport>;
}>;

export type ConfigurationVersionDiagnostics = Readonly<{
  state: "CREATED" | "READY" | "DEGRADED" | "STOPPED" | "FAILED";
  runtimeMode: RuntimeMode;
  streamId: ConfigurationVersionStreamId;
  currentVersionId?: ConfigurationVersionId;
  rootVersionId?: ConfigurationVersionId;
  versionCount: number;
  latestSequence: number;
  lastVersionCreatedAt?: UtcTimestamp;
  lastActorType?: Actor["actorType"];
  reconstructionCount: number;
  reconstructionFailures: number;
  concurrencyConflicts: number;
  noOpRejections: number;
  diffRequests: number;
  candidateFromHistoryCount: number;
  integrityOk: boolean;
  recentErrors: readonly string[];
}>;

export type ConfigurationVersionRuntimeService = Readonly<{
  managedService: RuntimeManagedService;
  createVersion: (
    input: CreateConfigurationVersionInput,
  ) => ConfigurationResult<ConfigurationVersion>;
  createCandidateFromVersion: (
    versionId: ConfigurationVersionId,
    input: Omit<CreateConfigurationVersionInput, "snapshot" | "derivedFromVersionId">,
  ) => ConfigurationResult<ConfigurationVersion>;
  reconstruct: (
    versionId: ConfigurationVersionId,
  ) => ConfigurationResult<ConfigurationVersionReconstruction>;
  diff: (
    fromVersionId: ConfigurationVersionId,
    toVersionId: ConfigurationVersionId,
    limit?: number,
  ) => ConfigurationResult<ConfigurationVersionDiff>;
  revalidateHistoricalVersion: (
    versionId: ConfigurationVersionId,
  ) => ConfigurationResult<ConfigurationValidationReport>;
  diagnostics: () => ConfigurationVersionDiagnostics;
  checkHealth: () => HealthReport;
  checkReadiness: () => ReadinessReport;
  stop: () => void;
}>;
