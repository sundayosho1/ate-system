import type { MarketObservation, UtcTimestamp } from "@ate/domain";
import type {
  Input,
  Stream,
  Checkpoint,
  Snapshot,
  EngineInput,
  AggregationEngine,
  Timeframe,
} from "@ate/multitimeframe";
import type { ReplayLimits } from "./configuration.js";
export type ReplayMode = "VERIFIED_POINT_IN_TIME" | "EVENT_TIME_RECONSTRUCTION";
export type ReplayState =
  | "CREATED"
  | "VALIDATING"
  | "READY"
  | "RUNNING"
  | "PAUSED"
  | "CHECKPOINTING"
  | "STOPPING"
  | "STOPPED"
  | "COMPLETED"
  | "FAILED"
  | "RECOVERY_REQUIRED";
export type AvailabilityEvidence = Readonly<{
  kind: "SOURCE_PUBLICATION" | "RECORDED_RECEIPT" | "AGGREGATE_PUBLICATION" | "CANONICAL_FIXTURE";
  availableAt: UtcTimestamp;
  fingerprint: string;
  qualityAvailableAt?: UtcTimestamp;
}>;
export type ReplaySourceRecord = Readonly<{
  input: Input;
  qualityAvailableAt?: UtcTimestamp;
  evidence?: AvailabilityEvidence;
}>;
export type ReplayEventEnvelope = Readonly<{
  eventId: string;
  manifestId: string;
  manifestFingerprint: string;
  payloadFingerprint: string;
  sourceId: string;
  instrumentId: string;
  channel: string;
  observationId: string;
  eventAt: UtcTimestamp;
  availableAt?: UtcTimestamp;
  eligibilityAt: UtcTimestamp;
  sourceCursor: string;
  ordering: "EVIDENCED" | "SYNTHETIC_UNCERTAIN";
  record: ReplaySourceRecord;
}>;
export type ReplayInputManifest = Readonly<{
  manifestId: string;
  kind: "HISTORICAL" | "CAPTURE" | "FIXTURE" | "AGGREGATE";
  contentFingerprint: string;
  canonicalSchemaVersion: "1";
  sourceFingerprint: string;
  records: readonly ReplaySourceRecord[];
  scopes: readonly Stream[];
  continuity: "CONTINUOUS" | "GAP" | "UNKNOWN";
  qualityReferences: readonly string[];
  calendarFingerprint: string;
  validation: "VALIDATED";
  originReference: string;
  originFingerprint: string;
  fingerprint: string;
}>;
export type ReplayResolvedInputs = Readonly<{
  manifests: readonly ReplayInputManifest[];
  fingerprint: string;
  verify: () => Promise<void>;
}>;
export type WatermarkEvidence = Parameters<AggregationEngine["watermark"]>[1];
export type ReplayTaskAction =
  | Readonly<{ kind: "FENCE" | "FORK_FENCE"; streamId: string; reason: string }>
  | Readonly<{
      kind: "LOSS" | "FORK_LOSS";
      consumerId: string;
      rejected: number;
      discarded: number;
      degraded: boolean;
      closed: boolean;
      contextFingerprint: string;
    }>
  | Readonly<{
      kind: "WATERMARK";
      streamId: string;
      evidence: WatermarkEvidence;
      authorityReference: string;
    }>
  | Readonly<{
      kind: "PUBLISH";
      streamId: string;
      timeframe: string;
      eventAt: UtcTimestamp;
      final: boolean;
    }>
  | Readonly<{
      kind: "SNAPSHOT";
      streamId: string;
      timeframes: readonly string[];
      includeIncomplete: boolean;
    }>;
export type ReplayTaskDescriptor = Readonly<{
  taskId: string;
  dueAt: UtcTimestamp;
  action: ReplayTaskAction;
}>;
export type ReplayAggregationPolicy = Readonly<
  Pick<EngineInput, "calendar" | "directTimeframes" | "edges" | "options"> & {
    timeframes: readonly Timeframe[];
  }
>;
export type ReplaySessionSpecification = Readonly<{
  sessionId: string;
  specificationVersion: 1;
  replayMode: ReplayMode;
  sourceManifestIds: readonly string[];
  datasetFingerprints: readonly string[];
  instrumentScope: readonly string[];
  sourceScope: readonly string[];
  channelScope: readonly string[];
  startTime: UtcTimestamp;
  endTime: UtcTimestamp;
  clockMode: "REPLAY";
  orderingPolicy: "AVAILABILITY_SOURCE_IDENTITY_V1";
  availabilityPolicy: "EVIDENCE_REQUIRED" | "EXPLICIT_RECONSTRUCTION";
  continuityPolicy: "FENCE_GAPS" | "FAIL_ON_GAP";
  qualityPolicy: "PRESERVE_REFERENCES";
  calendarFingerprint: string;
  configurationFingerprint: string;
  softwareIdentity: string;
  checkpointPolicy: "EVERY_ATOMIC_BOUNDARY";
  resourceLimits: ReplayLimits;
  outputEvidencePolicy: "IMMUTABLE_RESEARCH_EVIDENCE";
  researchOnly: true;
  streams: readonly Stream[];
  aggregation: ReplayAggregationPolicy;
  tasks: readonly ReplayTaskDescriptor[];
  fingerprint: string;
}>;
export type ReplaySnapshot = Readonly<{
  snapshotId: string;
  sessionId: string;
  specificationFingerprint: string;
  logicalTime: UtcTimestamp;
  inputCursor: number;
  sourceManifestFingerprints: readonly string[];
  mode: ReplayMode;
  publicationClass: "REPLAY_DERIVED";
  registryContext: "CURRENT_GOVERNED_CONTEXT";
  configurationFingerprint: string;
  calendarFingerprint: string;
  clockSchedulerFingerprint: string;
  aggregation: Snapshot;
  continuityFingerprint: string;
  semanticFingerprint: string;
}>;
export type ReplayBranchEvidence = Readonly<{
  branchId: string;
  parentSessionId: string;
  parentSpecificationFingerprint: string;
  parentCheckpointId: string;
  forkTime: UtcTimestamp;
  parentSourceFingerprints: readonly string[];
  parentConfigurationFingerprint: string;
  branchConfigurationFingerprint: string;
  softwareIdentity: string;
  changedFields: readonly string[];
  reconstruction: "FROM_IMMUTABLE_INPUT_ORIGIN";
}>;
export type ReplayCheckpoint = Readonly<{
  schemaVersion: 1;
  specificationFingerprint: string;
  sessionId: string;
  inputFingerprint: string;
  generation: number;
  cursor: number;
  lastEventId: string | null;
  logicalTime: UtcTimestamp;
  state: ReplayState;
  timestampComplete: boolean;
  pendingTasks: readonly ReplayTaskDescriptor[];
  executedTaskIds: readonly string[];
  aggregation: Checkpoint;
  snapshots: readonly ReplaySnapshot[];
  branch?: ReplayBranchEvidence;
  children: readonly ReplayBranchEvidence[];
  evidence: readonly Readonly<{ kind: string; identity: string; at: UtcTimestamp }>[];
  checkpointId: string;
  fingerprint: string;
}>;
export type ReplayEvidenceManifest = Readonly<{
  sessionId: string;
  specificationFingerprint: string;
  inputFingerprint: string;
  softwareIdentity: string;
  mode: ReplayMode;
  clockPolicy: string;
  orderingPolicy: string;
  configurationFingerprint: string;
  calendarFingerprint: string;
  logicalTime: UtcTimestamp;
  cursor: number;
  state: ReplayState;
  semanticCheckpointId: string;
  snapshots: readonly string[];
  revisions: readonly string[];
  qualityFingerprint: string;
  continuityFingerprint: string;
  branch?: ReplayBranchEvidence;
  semanticFingerprint: string;
}>;
export type ReplayComparison = Readonly<{
  classification: "IDENTICAL" | "EXPECTED_DIFFERENCE" | "UNEXPLAINED_DIVERGENCE" | "INCOMPARABLE";
  reasons: readonly string[];
  left: string;
  right: string;
  fingerprint: string;
}>;
export type CanonicalReplayObservation = MarketObservation;
