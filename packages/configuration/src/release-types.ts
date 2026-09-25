import type {
  Actor,
  ActorId,
  CausationId,
  CorrelationId,
  RuntimeMode,
  UtcTimestamp,
} from "@ate/domain";
import type { HealthReport, ReadinessReport, RuntimeManagedService } from "@ate/runtime";

import type { ApprovalAuthorityCategory } from "./approval-types.js";
import type {
  CapabilityId,
  CapabilitySnapshot,
  EffectiveCapabilityState,
} from "./capability-types.js";
import type {
  ConfigurationFingerprint,
  ConfigurationResult,
  ConfigurationSnapshotId,
  ConfigurationValidationReport,
} from "./types.js";
import type {
  ConfigurationVersionDiff,
  ConfigurationVersionId,
  ConfigurationVersionStreamId,
} from "./version-types.js";

export type ConfigurationEnvironment = RuntimeMode;

export type ConfigurationPromotionPolicyId = string & {
  readonly __brand: "ConfigurationPromotionPolicyId";
};
export type ConfigurationPromotionRequestId = string & {
  readonly __brand: "ConfigurationPromotionRequestId";
};
export type ConfigurationPromotionPlanId = string & {
  readonly __brand: "ConfigurationPromotionPlanId";
};
export type ConfigurationPromotionDecisionId = string & {
  readonly __brand: "ConfigurationPromotionDecisionId";
};
export type ConfigurationPromotionExecutionId = string & {
  readonly __brand: "ConfigurationPromotionExecutionId";
};
export type ConfigurationActivationId = string & {
  readonly __brand: "ConfigurationActivationId";
};
export type ConfigurationRollbackRequestId = string & {
  readonly __brand: "ConfigurationRollbackRequestId";
};
export type ConfigurationRollbackPlanId = string & {
  readonly __brand: "ConfigurationRollbackPlanId";
};
export type ConfigurationRollbackExecutionId = string & {
  readonly __brand: "ConfigurationRollbackExecutionId";
};
export type KnownGoodConfigurationId = string & {
  readonly __brand: "KnownGoodConfigurationId";
};

export type ConfigurationReleaseScope = "PROMOTABLE" | "DESTINATION_LOCAL" | "NON_PROMOTABLE";
export type ConfigurationReleaseOperation = "PROMOTION" | "ROLLBACK";
export type ConfigurationPromotionApprovalRequirement =
  "NONE" | "SOURCE_VERSION_APPROVAL" | "PROMOTION_APPROVAL";

export type ConfigurationPromotionStatus =
  | "REQUESTED"
  | "PLANNED"
  | "BLOCKED"
  | "READY"
  | "ACTIVATING"
  | "SUCCEEDED"
  | "FAILED"
  | "STALE"
  | "SUPERSEDED";

export type ConfigurationRollbackStatus =
  "REQUESTED" | "PLANNED" | "BLOCKED" | "READY" | "RESTORING" | "SUCCEEDED" | "FAILED" | "STALE";

export type ConfigurationReleaseResult = "SUCCEEDED" | "FAILED" | "UNCERTAIN";
export type RestartRequirement = "DYNAMIC_ONLY" | "RESTART_REQUIRED";

export type ConfigurationPromotionReasonCode =
  | "PROMOTION_ELIGIBLE"
  | "TRANSITION_ALLOWED"
  | "TRANSITION_NOT_ALLOWED"
  | "SAME_ENVIRONMENT_RELEASE"
  | "SOURCE_VERSION_NOT_FOUND"
  | "SOURCE_INTEGRITY_VERIFIED"
  | "SOURCE_INTEGRITY_FAILED"
  | "SOURCE_VALIDATION_FAILED"
  | "DESTINATION_BASELINE_CURRENT"
  | "DESTINATION_DRIFTED"
  | "DESTINATION_SCHEMA_COMPATIBLE"
  | "DESTINATION_SCHEMA_INCOMPATIBLE"
  | "DESTINATION_VALIDATION_PASSED"
  | "DESTINATION_VALIDATION_FAILED"
  | "DESTINATION_EFFECTIVE_CONFIGURATION_VALIDATED"
  | "DESTINATION_LOCAL_OVERRIDE_PRESERVED"
  | "NON_PROMOTABLE_CONFIGURATION"
  | "SECRET_REFERENCE_ONLY"
  | "CAPABILITY_ELIGIBLE"
  | "CAPABILITY_UNAVAILABLE"
  | "CAPABILITY_BLOCKED"
  | "APPROVAL_NOT_REQUIRED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_SATISFIED"
  | "APPROVAL_NOT_SATISFIED"
  | "PROMOTION_APPROVAL_REQUIRED"
  | "PROMOTION_APPROVAL_SATISFIED"
  | "PROMOTION_POLICY_CONFLICT"
  | "PROMOTION_POLICY_OF_RECORD"
  | "PROMOTION_POLICY_SELF_DOWNGRADE_PROTECTED"
  | "RESTART_REQUIRED"
  | "PROMOTION_STALE"
  | "PROMOTION_PLAN_CURRENT"
  | "PROMOTION_ACTIVATED"
  | "PROMOTION_VERIFIED"
  | "KNOWN_GOOD_RECORDED";

export type ConfigurationRollbackReasonCode =
  | "ROLLBACK_ELIGIBLE"
  | "ROLLBACK_TARGET_FOUND"
  | "ROLLBACK_TARGET_NOT_FOUND"
  | "ROLLBACK_TARGET_KNOWN_GOOD"
  | "ROLLBACK_TARGET_NOT_KNOWN_GOOD"
  | "ROLLBACK_TARGET_INTEGRITY_VERIFIED"
  | "ROLLBACK_TARGET_INVALID"
  | "ROLLBACK_SCHEMA_COMPATIBLE"
  | "ROLLBACK_SCHEMA_INCOMPATIBLE"
  | "ROLLBACK_VALIDATION_PASSED"
  | "ROLLBACK_VALIDATION_FAILED"
  | "ROLLBACK_APPROVAL_NOT_REQUIRED"
  | "ROLLBACK_APPROVAL_REQUIRED"
  | "ROLLBACK_APPROVAL_SATISFIED"
  | "ROLLBACK_APPROVAL_NOT_SATISFIED"
  | "ROLLBACK_PLAN_CURRENT"
  | "ROLLBACK_PLAN_STALE"
  | "ROLLBACK_ACTIVATED"
  | "ROLLBACK_VERIFIED"
  | "ROLLBACK_HISTORY_PRESERVED"
  | "RESTART_REQUIRED";

export type ConfigurationReleaseBlocker = Readonly<{
  code: ConfigurationPromotionReasonCode | ConfigurationRollbackReasonCode;
  message: string;
}>;

export type ConfigurationReleaseWarning = Readonly<{
  code: ConfigurationPromotionReasonCode | ConfigurationRollbackReasonCode;
  message: string;
}>;

export type ConfigurationPromotionPolicy = Readonly<{
  policyId: ConfigurationPromotionPolicyId;
  displayName: string;
  description: string;
  version: number;
  enabled: boolean;
  source: ConfigurationEnvironment;
  destination: ConfigurationEnvironment;
  allowSameEnvironmentRelease: boolean;
  approvalRequirement: ConfigurationPromotionApprovalRequirement;
  requiredPromotionAuthority: ApprovalAuthorityCategory;
  requiredPromotionApprovalCount: number;
  rollbackRequiresApproval: boolean;
  allowSchemaFingerprintChange: boolean;
  allowRestartRequiredActivation: boolean;
  maxPlanAgeMs?: number;
}>;

export type ConfigurationPromotionPolicyMatch = Readonly<{
  policyId: ConfigurationPromotionPolicyId;
  source: ConfigurationEnvironment;
  destination: ConfigurationEnvironment;
  approvalRequirement: ConfigurationPromotionApprovalRequirement;
  requiredPromotionAuthority: ApprovalAuthorityCategory;
  requiredPromotionApprovalCount: number;
  rollbackRequiresApproval: boolean;
  allowSchemaFingerprintChange: boolean;
  allowRestartRequiredActivation: boolean;
}>;

export type ConfigurationEnvironmentState = Readonly<{
  environment: ConfigurationEnvironment;
  streamId: ConfigurationVersionStreamId;
  activeVersionId: ConfigurationVersionId;
  activeConfigurationFingerprint: ConfigurationFingerprint;
  activeSchemaFingerprint: ConfigurationFingerprint;
  activationId: ConfigurationActivationId;
  activatedAt: UtcTimestamp;
  activatedBy: Actor;
  previousActiveVersionId?: ConfigurationVersionId;
  previousKnownGoodVersionId?: ConfigurationVersionId;
  pendingPromotionRequestId?: ConfigurationPromotionRequestId;
  restartRequired: boolean;
  restartPending: boolean;
  runningVersionId?: ConfigurationVersionId;
  targetPostRestartVersionId?: ConfigurationVersionId;
  stateFingerprint: ConfigurationFingerprint;
}>;

export type KnownGoodConfiguration = Readonly<{
  knownGoodId: KnownGoodConfigurationId;
  environment: ConfigurationEnvironment;
  versionId: ConfigurationVersionId;
  configurationFingerprint: ConfigurationFingerprint;
  schemaFingerprint: ConfigurationFingerprint;
  activationId: ConfigurationActivationId;
  verifiedAt: UtcTimestamp;
  verificationResult: "VERIFIED" | "VERIFIED_WITH_PENDING_RESTART";
  policyId: ConfigurationPromotionPolicyId;
  policyFingerprint: ConfigurationFingerprint;
  knownGoodFingerprint: ConfigurationFingerprint;
}>;

export type ConfigurationPromotionRequest = Readonly<{
  requestId: ConfigurationPromotionRequestId;
  sourceEnvironment: ConfigurationEnvironment;
  sourceVersionId: ConfigurationVersionId;
  sourceStreamId: ConfigurationVersionStreamId;
  sourceConfigurationFingerprint: ConfigurationFingerprint;
  sourceSchemaFingerprint: ConfigurationFingerprint;
  destinationEnvironment: ConfigurationEnvironment;
  destinationStreamId: ConfigurationVersionStreamId;
  destinationBaselineVersionId?: ConfigurationVersionId;
  destinationBaselineFingerprint?: ConfigurationFingerprint;
  destinationBaselineActivationId?: ConfigurationActivationId;
  requestedBy: Actor;
  requestedAt: UtcTimestamp;
  reason: string;
  policyId: ConfigurationPromotionPolicyId;
  policyFingerprint: ConfigurationFingerprint;
  sourceApprovalRequestId?: string;
  correlationId?: CorrelationId;
  causationId?: CausationId;
  idempotencyKey?: string;
  requestFingerprint: ConfigurationFingerprint;
}>;

export type ConfigurationPromotionDecision = Readonly<{
  decisionId: ConfigurationPromotionDecisionId;
  requestId: ConfigurationPromotionRequestId;
  checker: Actor;
  decision: "APPROVE" | "REJECT";
  reason: string;
  decidedAt: UtcTimestamp;
  authority: ApprovalAuthorityCategory;
  policyId: ConfigurationPromotionPolicyId;
  policyFingerprint: ConfigurationFingerprint;
  correlationId?: CorrelationId;
  causationId?: CausationId;
  idempotencyKey?: string;
  decisionFingerprint: ConfigurationFingerprint;
}>;

export type ConfigurationPromotionEligibility = Readonly<{
  eligible: boolean;
  evaluatedAt: UtcTimestamp;
  status: ConfigurationPromotionStatus;
  reasonCodes: readonly ConfigurationPromotionReasonCode[];
  blockers: readonly ConfigurationReleaseBlocker[];
  warnings: readonly ConfigurationReleaseWarning[];
  sourceIntegrityOk: boolean;
  transitionAllowed: boolean;
  destinationBaselineCurrent: boolean;
  schemaCompatible: boolean;
  destinationValidationPassed: boolean;
  capabilityEligible: boolean;
  approvalEligible: boolean;
  restartRequirement: RestartRequirement;
  policyId: ConfigurationPromotionPolicyId;
  policyFingerprint: ConfigurationFingerprint;
}>;

export type ConfigurationPromotionPlan = Readonly<{
  planId: ConfigurationPromotionPlanId;
  requestId: ConfigurationPromotionRequestId;
  sourceEnvironment: ConfigurationEnvironment;
  destinationEnvironment: ConfigurationEnvironment;
  sourceVersionId: ConfigurationVersionId;
  destinationBaselineVersionId?: ConfigurationVersionId;
  destinationBaselineFingerprint?: ConfigurationFingerprint;
  resultingVersionId: ConfigurationVersionId;
  resultingConfigurationFingerprint: ConfigurationFingerprint;
  resultingSchemaFingerprint: ConfigurationFingerprint;
  resultingSnapshotId: ConfigurationSnapshotId;
  plannedAt: UtcTimestamp;
  plannedBy: Actor;
  safeDiff: ConfigurationVersionDiff;
  validationReport: ConfigurationValidationReport;
  capabilitySnapshot?: CapabilitySnapshot;
  capabilityImpact: readonly {
    capabilityId: CapabilityId;
    state: EffectiveCapabilityState;
    pendingRestart: boolean;
  }[];
  approvalEvidenceRequestId?: string;
  promotionDecisionIds: readonly ConfigurationPromotionDecisionId[];
  restartRequirement: RestartRequirement;
  policyId: ConfigurationPromotionPolicyId;
  policyFingerprint: ConfigurationFingerprint;
  eligibility: ConfigurationPromotionEligibility;
  planFingerprint: ConfigurationFingerprint;
  correlationId?: CorrelationId;
  causationId?: CausationId;
  idempotencyKey?: string;
}>;

export type ConfigurationActivationRecord = Readonly<{
  activationId: ConfigurationActivationId;
  operation: ConfigurationReleaseOperation;
  promotionRequestId?: ConfigurationPromotionRequestId;
  promotionPlanId?: ConfigurationPromotionPlanId;
  rollbackRequestId?: ConfigurationRollbackRequestId;
  rollbackPlanId?: ConfigurationRollbackPlanId;
  sourceVersionId: ConfigurationVersionId;
  destinationEnvironment: ConfigurationEnvironment;
  previousVersionId?: ConfigurationVersionId;
  resultingVersionId: ConfigurationVersionId;
  expectedPreviousFingerprint?: ConfigurationFingerprint;
  resultingConfigurationFingerprint: ConfigurationFingerprint;
  resultingSchemaFingerprint: ConfigurationFingerprint;
  activatedBy: Actor;
  policyId: ConfigurationPromotionPolicyId;
  policyFingerprint: ConfigurationFingerprint;
  approvalEvidenceIds: readonly string[];
  activatedAt: UtcTimestamp;
  result: ConfigurationReleaseResult;
  restartRequirement: RestartRequirement;
  safeMessage: string;
  correlationId?: CorrelationId;
  causationId?: CausationId;
  idempotencyKey?: string;
  activationFingerprint: ConfigurationFingerprint;
}>;

export type ConfigurationPromotionExecution = Readonly<{
  executionId: ConfigurationPromotionExecutionId;
  requestId: ConfigurationPromotionRequestId;
  planId: ConfigurationPromotionPlanId;
  activationId?: ConfigurationActivationId;
  executedBy: Actor;
  executedAt: UtcTimestamp;
  result: ConfigurationReleaseResult;
  status: ConfigurationPromotionStatus;
  reasonCodes: readonly ConfigurationPromotionReasonCode[];
  safeMessage: string;
  correlationId?: CorrelationId;
  causationId?: CausationId;
  idempotencyKey?: string;
  executionFingerprint: ConfigurationFingerprint;
}>;

export type ConfigurationRollbackRequest = Readonly<{
  requestId: ConfigurationRollbackRequestId;
  environment: ConfigurationEnvironment;
  currentVersionId: ConfigurationVersionId;
  currentConfigurationFingerprint: ConfigurationFingerprint;
  targetVersionId: ConfigurationVersionId;
  targetConfigurationFingerprint: ConfigurationFingerprint;
  requestedBy: Actor;
  reason: string;
  requestedAt: UtcTimestamp;
  triggeringPromotionRequestId?: ConfigurationPromotionRequestId;
  policyId: ConfigurationPromotionPolicyId;
  policyFingerprint: ConfigurationFingerprint;
  correlationId?: CorrelationId;
  causationId?: CausationId;
  idempotencyKey?: string;
  requestFingerprint: ConfigurationFingerprint;
}>;

export type ConfigurationRollbackEligibility = Readonly<{
  eligible: boolean;
  evaluatedAt: UtcTimestamp;
  status: ConfigurationRollbackStatus;
  reasonCodes: readonly ConfigurationRollbackReasonCode[];
  blockers: readonly ConfigurationReleaseBlocker[];
  warnings: readonly ConfigurationReleaseWarning[];
  targetExists: boolean;
  targetKnownGood: boolean;
  targetIntegrityOk: boolean;
  schemaCompatible: boolean;
  validationPassed: boolean;
  approvalEligible: boolean;
  restartRequirement: RestartRequirement;
  policyId: ConfigurationPromotionPolicyId;
  policyFingerprint: ConfigurationFingerprint;
}>;

export type ConfigurationRollbackPlan = Readonly<{
  planId: ConfigurationRollbackPlanId;
  requestId: ConfigurationRollbackRequestId;
  environment: ConfigurationEnvironment;
  currentVersionId: ConfigurationVersionId;
  targetVersionId: ConfigurationVersionId;
  resultingVersionId: ConfigurationVersionId;
  resultingConfigurationFingerprint: ConfigurationFingerprint;
  resultingSchemaFingerprint: ConfigurationFingerprint;
  plannedAt: UtcTimestamp;
  plannedBy: Actor;
  safeDiff: ConfigurationVersionDiff;
  validationReport: ConfigurationValidationReport;
  capabilitySnapshot?: CapabilitySnapshot;
  restartRequirement: RestartRequirement;
  policyId: ConfigurationPromotionPolicyId;
  policyFingerprint: ConfigurationFingerprint;
  eligibility: ConfigurationRollbackEligibility;
  planFingerprint: ConfigurationFingerprint;
  correlationId?: CorrelationId;
  causationId?: CausationId;
  idempotencyKey?: string;
}>;

export type ConfigurationRollbackExecution = Readonly<{
  executionId: ConfigurationRollbackExecutionId;
  requestId: ConfigurationRollbackRequestId;
  planId: ConfigurationRollbackPlanId;
  activationId?: ConfigurationActivationId;
  executedBy: Actor;
  executedAt: UtcTimestamp;
  result: ConfigurationReleaseResult;
  status: ConfigurationRollbackStatus;
  reasonCodes: readonly ConfigurationRollbackReasonCode[];
  safeMessage: string;
  correlationId?: CorrelationId;
  causationId?: CausationId;
  idempotencyKey?: string;
  executionFingerprint: ConfigurationFingerprint;
}>;

export type ConfigurationReleaseLineage = Readonly<{
  environment: ConfigurationEnvironment;
  versionId: ConfigurationVersionId;
  activationId?: ConfigurationActivationId;
  sourceVersionId?: ConfigurationVersionId;
  previousVersionId?: ConfigurationVersionId;
  depth: number;
  lineage: readonly {
    environment: ConfigurationEnvironment;
    versionId: ConfigurationVersionId;
    activationId?: ConfigurationActivationId;
    operation: ConfigurationReleaseOperation;
  }[];
}>;

export type ConfigurationReleaseRepository = Readonly<{
  appendPromotionRequest: (
    request: ConfigurationPromotionRequest,
  ) => ConfigurationResult<ConfigurationPromotionRequest>;
  appendPromotionPlan: (
    plan: ConfigurationPromotionPlan,
  ) => ConfigurationResult<ConfigurationPromotionPlan>;
  appendPromotionDecision: (
    decision: ConfigurationPromotionDecision,
  ) => ConfigurationResult<ConfigurationPromotionDecision>;
  appendPromotionExecution: (
    execution: ConfigurationPromotionExecution,
  ) => ConfigurationResult<ConfigurationPromotionExecution>;
  appendRollbackRequest: (
    request: ConfigurationRollbackRequest,
  ) => ConfigurationResult<ConfigurationRollbackRequest>;
  appendRollbackPlan: (
    plan: ConfigurationRollbackPlan,
  ) => ConfigurationResult<ConfigurationRollbackPlan>;
  appendRollbackExecution: (
    execution: ConfigurationRollbackExecution,
  ) => ConfigurationResult<ConfigurationRollbackExecution>;
  appendActivation: (
    activation: ConfigurationActivationRecord,
    expectedActiveVersionId?: ConfigurationVersionId,
  ) => ConfigurationResult<ConfigurationActivationRecord>;
  recordKnownGood: (
    knownGood: KnownGoodConfiguration,
  ) => ConfigurationResult<KnownGoodConfiguration>;
  getPromotionRequest: (
    requestId: ConfigurationPromotionRequestId,
  ) => ConfigurationResult<ConfigurationPromotionRequest>;
  getPromotionPlan: (
    planId: ConfigurationPromotionPlanId,
  ) => ConfigurationResult<ConfigurationPromotionPlan>;
  getRollbackRequest: (
    requestId: ConfigurationRollbackRequestId,
  ) => ConfigurationResult<ConfigurationRollbackRequest>;
  getRollbackPlan: (
    planId: ConfigurationRollbackPlanId,
  ) => ConfigurationResult<ConfigurationRollbackPlan>;
  environmentState: (
    environment: ConfigurationEnvironment,
  ) => ConfigurationEnvironmentState | undefined;
  knownGoodForEnvironment: (
    environment: ConfigurationEnvironment,
  ) => readonly KnownGoodConfiguration[];
  promotionDecisionsByRequest: (
    requestId: ConfigurationPromotionRequestId,
  ) => readonly ConfigurationPromotionDecision[];
  activationHistory: (
    environment: ConfigurationEnvironment,
    limit?: number,
  ) => readonly ConfigurationActivationRecord[];
  listPromotionRequests: () => readonly ConfigurationPromotionRequest[];
  listRollbackRequests: () => readonly ConfigurationRollbackRequest[];
}>;

export type CreatePromotionRequestInput = Readonly<{
  sourceVersionId: ConfigurationVersionId;
  sourceEnvironment: ConfigurationEnvironment;
  destinationEnvironment: ConfigurationEnvironment;
  requestedBy: Actor;
  reason: string;
  correlationId?: CorrelationId;
  causationId?: CausationId;
  idempotencyKey?: string;
}>;

export type CreatePromotionPlanInput = Readonly<{
  requestId: ConfigurationPromotionRequestId;
  plannedBy: Actor;
  correlationId?: CorrelationId;
  causationId?: CausationId;
  idempotencyKey?: string;
}>;

export type SubmitPromotionDecisionInput = Readonly<{
  requestId: ConfigurationPromotionRequestId;
  checker: Actor;
  decision: "APPROVE" | "REJECT";
  reason: string;
  correlationId?: CorrelationId;
  causationId?: CausationId;
  idempotencyKey?: string;
}>;

export type ExecutePromotionInput = Readonly<{
  planId: ConfigurationPromotionPlanId;
  executedBy: Actor;
  correlationId?: CorrelationId;
  causationId?: CausationId;
  idempotencyKey?: string;
}>;

export type CreateRollbackRequestInput = Readonly<{
  environment: ConfigurationEnvironment;
  targetVersionId: ConfigurationVersionId;
  requestedBy: Actor;
  reason: string;
  triggeringPromotionRequestId?: ConfigurationPromotionRequestId;
  correlationId?: CorrelationId;
  causationId?: CausationId;
  idempotencyKey?: string;
}>;

export type CreateRollbackPlanInput = Readonly<{
  requestId: ConfigurationRollbackRequestId;
  plannedBy: Actor;
  correlationId?: CorrelationId;
  causationId?: CausationId;
  idempotencyKey?: string;
}>;

export type ExecuteRollbackInput = Readonly<{
  planId: ConfigurationRollbackPlanId;
  executedBy: Actor;
  correlationId?: CorrelationId;
  causationId?: CausationId;
  idempotencyKey?: string;
}>;

export type ReleaseServiceDiagnostics = Readonly<{
  state: "CREATED" | "READY" | "DEGRADED" | "STOPPED" | "FAILED";
  environmentCount: number;
  activeEnvironments: readonly ConfigurationEnvironment[];
  pendingPromotionCount: number;
  blockedPromotionCount: number;
  stalePlanCount: number;
  failedActivationCount: number;
  pendingRestartCount: number;
  rollbackCount: number;
  knownGoodCount: number;
  policyFingerprint: ConfigurationFingerprint;
  integrityFailures: number;
  unresolvedActivationUncertainty: number;
  recentErrors: readonly string[];
}>;

export type ConfigurationReleaseRuntimeService = Readonly<{
  managedService: RuntimeManagedService;
  createPromotionRequest: (
    input: CreatePromotionRequestInput,
  ) => ConfigurationResult<ConfigurationPromotionRequest>;
  createPromotionPlan: (
    input: CreatePromotionPlanInput,
  ) => ConfigurationResult<ConfigurationPromotionPlan>;
  submitPromotionDecision: (
    input: SubmitPromotionDecisionInput,
  ) => ConfigurationResult<ConfigurationPromotionDecision>;
  executePromotion: (
    input: ExecutePromotionInput,
  ) => ConfigurationResult<ConfigurationPromotionExecution>;
  createRollbackRequest: (
    input: CreateRollbackRequestInput,
  ) => ConfigurationResult<ConfigurationRollbackRequest>;
  createRollbackPlan: (
    input: CreateRollbackPlanInput,
  ) => ConfigurationResult<ConfigurationRollbackPlan>;
  executeRollback: (
    input: ExecuteRollbackInput,
  ) => ConfigurationResult<ConfigurationRollbackExecution>;
  explainPromotion: (
    requestId: ConfigurationPromotionRequestId,
  ) => ConfigurationResult<ConfigurationPromotionPlan>;
  explainRollback: (
    requestId: ConfigurationRollbackRequestId,
  ) => ConfigurationResult<ConfigurationRollbackPlan>;
  explainActiveConfiguration: (
    environment: ConfigurationEnvironment,
  ) => ConfigurationResult<ConfigurationEnvironmentState>;
  traceLineage: (
    environment: ConfigurationEnvironment,
    versionId?: ConfigurationVersionId,
  ) => ConfigurationResult<ConfigurationReleaseLineage>;
  diagnostics: () => ReleaseServiceDiagnostics;
  checkHealth: () => HealthReport;
  checkReadiness: () => ReadinessReport;
  stop: () => void;
}>;

export type PromotionCheckerGrant = Readonly<{
  actorId: ActorId;
  authorities: readonly ApprovalAuthorityCategory[];
}>;
