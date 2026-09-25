import type {
  Actor,
  ActorId,
  CausationId,
  CorrelationId,
  RuntimeMode,
  UtcTimestamp,
} from "@ate/domain";
import type { HealthReport, ReadinessReport, RuntimeManagedService } from "@ate/runtime";

import type { CapabilityId } from "./capability-types.js";
import type {
  ConfigurationDomain,
  ConfigurationFingerprint,
  ConfigurationKey,
  ConfigurationResult,
  ConfigurationScope,
  ConfigurationScopeType,
} from "./types.js";
import type {
  ConfigurationChangeSetId,
  ConfigurationVersion,
  ConfigurationVersionId,
  ConfigurationVersionStreamId,
} from "./version-types.js";

export type ConfigurationApprovalPolicyId = string & {
  readonly __brand: "ConfigurationApprovalPolicyId";
};
export type ConfigurationApprovalRequestId = string & {
  readonly __brand: "ConfigurationApprovalRequestId";
};
export type ConfigurationApprovalDecisionId = string & {
  readonly __brand: "ConfigurationApprovalDecisionId";
};
export type ConfigurationApprovalRevocationId = string & {
  readonly __brand: "ConfigurationApprovalRevocationId";
};
export type ConfigurationApprovalEvaluationId = string & {
  readonly __brand: "ConfigurationApprovalEvaluationId";
};

export type ApprovalClassification = "STANDARD" | "SENSITIVE" | "CRITICAL";
export type ApprovalDecisionType = "APPROVE" | "REJECT";
export type ApprovalLifecycleStatus =
  | "NOT_REQUIRED"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "REVOKED"
  | "SUPERSEDED"
  | "STALE";
export type ApprovalAuthorityCategory =
  "CONFIGURATION_CHECKER" | "SENSITIVE_CONFIGURATION_CHECKER" | "CRITICAL_CONFIGURATION_CHECKER";

export type ApprovalRequirementReasonCode =
  | "STANDARD_CHANGE"
  | "SENSITIVE_KEY_CHANGED"
  | "CRITICAL_KEY_CHANGED"
  | "SENSITIVE_CAPABILITY_AFFECTED"
  | "ENVIRONMENT_SENSITIVE"
  | "GOVERNANCE_POLICY_CHANGED"
  | "MANDATORY_CORE_AFFECTED"
  | "RESTART_REQUIRED_SENSITIVE_CHANGE"
  | "CAPITAL_BEARING_FOUNDATION_AFFECTED"
  | "POLICY_MATCHED"
  | "APPROVAL_NOT_REQUIRED";

export type ApprovalEligibilityReasonCode =
  | ApprovalRequirementReasonCode
  | "APPROVAL_REQUIRED"
  | "APPROVAL_NOT_SATISFIED"
  | "APPROVAL_SATISFIED"
  | "APPROVAL_REJECTED"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_REVOKED"
  | "APPROVAL_SUPERSEDED"
  | "APPROVAL_STALE"
  | "APPROVAL_POLICY_FINGERPRINT_MISMATCH"
  | "APPROVAL_CONFIGURATION_FINGERPRINT_MISMATCH"
  | "APPROVAL_CHANGESET_MISMATCH"
  | "APPROVAL_SCHEMA_FINGERPRINT_MISMATCH"
  | "APPROVAL_VERSION_MISMATCH"
  | "APPROVAL_INTEGRITY_FAILED";

export type ApprovalPolicyCondition = Readonly<{
  keys?: readonly ConfigurationKey[];
  keyPrefixes?: readonly string[];
  domains?: readonly ConfigurationDomain[];
  scopeTypes?: readonly ConfigurationScopeType[];
  runtimeModes?: readonly RuntimeMode[];
  capabilityIds?: readonly CapabilityId[];
  minimumChangeCount?: number;
  governanceCategories?: readonly string[];
}>;

export type ConfigurationApprovalPolicy = Readonly<{
  policyId: ConfigurationApprovalPolicyId;
  displayName: string;
  description: string;
  version: number;
  enabled: boolean;
  classification: ApprovalClassification;
  approvalRequired: boolean;
  requiredAuthority: ApprovalAuthorityCategory;
  requiredApprovalCount: number;
  conditions: readonly ApprovalPolicyCondition[];
  reasonCodes: readonly ApprovalRequirementReasonCode[];
  expiresAfterMs?: number;
}>;

export type ConfigurationApprovalPolicyMatch = Readonly<{
  policyId: ConfigurationApprovalPolicyId;
  classification: ApprovalClassification;
  approvalRequired: boolean;
  requiredAuthority: ApprovalAuthorityCategory;
  requiredApprovalCount: number;
  reasonCodes: readonly ApprovalRequirementReasonCode[];
  expiresAfterMs?: number;
}>;

export type CapabilityImpactSummary = Readonly<{
  affectedCapabilities: readonly CapabilityId[];
  mandatoryCoreAffected: boolean;
  futureCapitalBearingAffected: boolean;
  restartRequiredAffected: boolean;
  fingerprint: ConfigurationFingerprint;
}>;

export type ApprovalRequirementEvaluation = Readonly<{
  evaluationId: ConfigurationApprovalEvaluationId;
  versionId: ConfigurationVersionId;
  streamId: ConfigurationVersionStreamId;
  runtimeMode: RuntimeMode;
  evaluatedAt: UtcTimestamp;
  approvalRequired: boolean;
  classification: ApprovalClassification;
  policyId: ConfigurationApprovalPolicyId;
  policyFingerprint: ConfigurationFingerprint;
  reasonCodes: readonly ApprovalRequirementReasonCode[];
  affectedKeys: readonly ConfigurationKey[];
  affectedScopes: readonly ConfigurationScope[];
  affectedCapabilities: readonly CapabilityId[];
  capabilityImpactFingerprint: ConfigurationFingerprint;
  requiredAuthority: ApprovalAuthorityCategory;
  requiredApprovalCount: number;
  expiresAfterMs?: number;
  policiesConsidered: readonly ConfigurationApprovalPolicyId[];
  policiesMatched: readonly ConfigurationApprovalPolicyMatch[];
  fingerprint: ConfigurationFingerprint;
}>;

export type ConfigurationApprovalRequest = Readonly<{
  requestId: ConfigurationApprovalRequestId;
  versionId: ConfigurationVersionId;
  streamId: ConfigurationVersionStreamId;
  runtimeMode: RuntimeMode;
  maker: Actor;
  changeSetId: ConfigurationChangeSetId;
  changeSetFingerprint: ConfigurationFingerprint;
  configurationFingerprint: ConfigurationFingerprint;
  schemaFingerprint: ConfigurationFingerprint;
  versionFingerprint: ConfigurationFingerprint;
  capabilityImpactFingerprint: ConfigurationFingerprint;
  affectedKeys: readonly ConfigurationKey[];
  affectedCapabilities: readonly CapabilityId[];
  policyId: ConfigurationApprovalPolicyId;
  policyFingerprint: ConfigurationFingerprint;
  classification: ApprovalClassification;
  approvalRequired: boolean;
  requiredAuthority: ApprovalAuthorityCategory;
  requiredApprovalCount: number;
  expiresAfterMs?: number;
  requestedAt: UtcTimestamp;
  reason: string;
  correlationId?: CorrelationId;
  causationId?: CausationId;
  idempotencyKey?: string;
  requestFingerprint: ConfigurationFingerprint;
}>;

export type ApprovalAuthorityEvidence = Readonly<{
  actorId: ActorId;
  authority: ApprovalAuthorityCategory;
  authorized: boolean;
  checkedAt: UtcTimestamp;
  evidence: string;
}>;

export type ApprovalAuthorityRequirement = Readonly<{
  classification: ApprovalClassification;
  requiredAuthority: ApprovalAuthorityCategory;
  runtimeMode: RuntimeMode;
  policyId: ConfigurationApprovalPolicyId;
}>;

export type ApprovalAuthorityResolver = Readonly<{
  resolve: (
    actor: Actor,
    requirement: ApprovalAuthorityRequirement,
  ) => ConfigurationResult<ApprovalAuthorityEvidence>;
}>;

export type ConfigurationApprovalDecision = Readonly<{
  decisionId: ConfigurationApprovalDecisionId;
  requestId: ConfigurationApprovalRequestId;
  versionId: ConfigurationVersionId;
  checker: Actor;
  decision: ApprovalDecisionType;
  reason: string;
  decidedAt: UtcTimestamp;
  policyId: ConfigurationApprovalPolicyId;
  policyFingerprint: ConfigurationFingerprint;
  authorityEvidence: ApprovalAuthorityEvidence;
  configurationFingerprint: ConfigurationFingerprint;
  changeSetFingerprint: ConfigurationFingerprint;
  schemaFingerprint: ConfigurationFingerprint;
  expiresAt?: UtcTimestamp;
  correlationId?: CorrelationId;
  causationId?: CausationId;
  idempotencyKey?: string;
  decisionFingerprint: ConfigurationFingerprint;
}>;

export type ConfigurationApprovalRevocation = Readonly<{
  revocationId: ConfigurationApprovalRevocationId;
  requestId: ConfigurationApprovalRequestId;
  decisionId: ConfigurationApprovalDecisionId;
  versionId: ConfigurationVersionId;
  revokedBy: Actor;
  reason: string;
  revokedAt: UtcTimestamp;
  authorityEvidence: ApprovalAuthorityEvidence;
  correlationId?: CorrelationId;
  causationId?: CausationId;
  idempotencyKey?: string;
  revocationFingerprint: ConfigurationFingerprint;
}>;

export type ApprovalEligibilityResult = Readonly<{
  versionId: ConfigurationVersionId;
  evaluatedAt: UtcTimestamp;
  approvalRequired: boolean;
  status: ApprovalLifecycleStatus;
  eligible: boolean;
  reasonCodes: readonly ApprovalEligibilityReasonCode[];
  policyId: ConfigurationApprovalPolicyId;
  policyFingerprint: ConfigurationFingerprint;
  requestId?: ConfigurationApprovalRequestId;
  validDecisionIds: readonly ConfigurationApprovalDecisionId[];
  maker?: Actor;
  checkers: readonly Actor[];
  expiresAt?: UtcTimestamp;
  evaluation: ApprovalRequirementEvaluation;
}>;

export type ApprovalRepositoryListFilter = Readonly<{
  versionId?: ConfigurationVersionId;
  requestId?: ConfigurationApprovalRequestId;
  makerActorId?: string;
  checkerActorId?: string;
  status?: ApprovalLifecycleStatus;
  limit?: number;
  offset?: number;
}>;

export type ConfigurationApprovalRepository = Readonly<{
  appendRequirementEvaluation: (
    evaluation: ApprovalRequirementEvaluation,
  ) => ConfigurationResult<ApprovalRequirementEvaluation>;
  appendRequest: (
    request: ConfigurationApprovalRequest,
  ) => ConfigurationResult<ConfigurationApprovalRequest>;
  appendDecision: (
    decision: ConfigurationApprovalDecision,
  ) => ConfigurationResult<ConfigurationApprovalDecision>;
  appendRevocation: (
    revocation: ConfigurationApprovalRevocation,
  ) => ConfigurationResult<ConfigurationApprovalRevocation>;
  getRequest: (
    requestId: ConfigurationApprovalRequestId,
  ) => ConfigurationResult<ConfigurationApprovalRequest>;
  getDecision: (
    decisionId: ConfigurationApprovalDecisionId,
  ) => ConfigurationResult<ConfigurationApprovalDecision>;
  requestsByVersion: (
    versionId: ConfigurationVersionId,
    limit?: number,
  ) => readonly ConfigurationApprovalRequest[];
  decisionsByRequest: (
    requestId: ConfigurationApprovalRequestId,
    limit?: number,
  ) => readonly ConfigurationApprovalDecision[];
  revocationsByRequest: (
    requestId: ConfigurationApprovalRequestId,
    limit?: number,
  ) => readonly ConfigurationApprovalRevocation[];
  listRequests: (filter?: ApprovalRepositoryListFilter) => readonly ConfigurationApprovalRequest[];
}>;

export type CreateApprovalRequestInput = Readonly<{
  version: ConfigurationVersion;
  reason: string;
  correlationId?: CorrelationId;
  causationId?: CausationId;
  idempotencyKey?: string;
}>;

export type SubmitApprovalDecisionInput = Readonly<{
  requestId: ConfigurationApprovalRequestId;
  checker: Actor;
  decision: ApprovalDecisionType;
  reason: string;
  correlationId?: CorrelationId;
  causationId?: CausationId;
  idempotencyKey?: string;
}>;

export type RevokeApprovalInput = Readonly<{
  requestId: ConfigurationApprovalRequestId;
  decisionId: ConfigurationApprovalDecisionId;
  revokedBy: Actor;
  reason: string;
  correlationId?: CorrelationId;
  causationId?: CausationId;
  idempotencyKey?: string;
}>;

export type ApprovalServiceDiagnostics = Readonly<{
  state: "CREATED" | "READY" | "DEGRADED" | "STOPPED" | "FAILED";
  runtimeMode: RuntimeMode;
  policyCount: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  expiredCount: number;
  revokedCount: number;
  supersededCount: number;
  sensitiveCount: number;
  criticalCount: number;
  authorityFailures: number;
  separationViolations: number;
  staleApprovalCount: number;
  integrityFailures: number;
  lastRequestAt?: UtcTimestamp;
  lastDecisionAt?: UtcTimestamp;
  recentErrors: readonly string[];
}>;

export type ConfigurationApprovalRuntimeService = Readonly<{
  managedService: RuntimeManagedService;
  evaluateApprovalRequirement: (
    version: ConfigurationVersion,
  ) => ConfigurationResult<ApprovalRequirementEvaluation>;
  createApprovalRequest: (
    input: CreateApprovalRequestInput,
  ) => ConfigurationResult<ConfigurationApprovalRequest>;
  submitDecision: (
    input: SubmitApprovalDecisionInput,
  ) => ConfigurationResult<ConfigurationApprovalDecision>;
  revokeApproval: (
    input: RevokeApprovalInput,
  ) => ConfigurationResult<ConfigurationApprovalRevocation>;
  isApprovalSatisfied: (
    version: ConfigurationVersion,
    currentVersionId?: ConfigurationVersionId,
  ) => ConfigurationResult<ApprovalEligibilityResult>;
  explainApprovalForVersion: (
    version: ConfigurationVersion,
  ) => ConfigurationResult<ApprovalEligibilityResult>;
  diagnostics: () => ApprovalServiceDiagnostics;
  checkHealth: () => HealthReport;
  checkReadiness: () => ReadinessReport;
  stop: () => void;
}>;
