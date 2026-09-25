import type { Actor, ActorId, RuntimeMode } from "@ate/domain";
import {
  serviceDescriptor,
  type HealthReport,
  type ReadinessReport,
  type RuntimeManagedService,
  type ServiceId,
} from "@ate/runtime";
import { addDuration, compareInstants, durationMs, type Clock } from "@ate/time";

import { configurationError, fail, ok } from "./errors.js";
import { freeze } from "./context.js";
import { fingerprint } from "./serialization.js";
import { configurationVersionServiceId } from "./version-service.js";
import {
  evaluateApprovalRequirement,
  type ConfigurationApprovalPolicyRegistry,
} from "./approval-policy.js";
import type {
  ApprovalAuthorityCategory,
  ApprovalAuthorityEvidence,
  ApprovalAuthorityRequirement,
  ApprovalAuthorityResolver,
  ApprovalEligibilityResult,
  ApprovalLifecycleStatus,
  ApprovalServiceDiagnostics,
  ConfigurationApprovalDecision,
  ConfigurationApprovalDecisionId,
  ConfigurationApprovalRepository,
  ConfigurationApprovalRequest,
  ConfigurationApprovalRequestId,
  ConfigurationApprovalRevocationId,
  ConfigurationApprovalRevocation,
  ConfigurationApprovalRuntimeService,
  CreateApprovalRequestInput,
  RevokeApprovalInput,
  SubmitApprovalDecisionInput,
} from "./approval-types.js";
import type { CapabilityRegistry, FeatureFlagRegistry } from "./capability-registry.js";
import type { ConfigurationSchemaRegistry } from "./schema-registry.js";
import type {
  ConfigurationFingerprint,
  ConfigurationResult,
  ConfigurationSnapshot,
} from "./types.js";
import type { ConfigurationVersion, ConfigurationVersionId } from "./version-types.js";

export const configurationApprovalServiceId = "configuration.approval" as ServiceId;

export type ConfigurationApprovalServiceInput = Readonly<{
  runtimeMode: RuntimeMode;
  clock: Clock;
  policyRegistry: ConfigurationApprovalPolicyRegistry;
  repository: ConfigurationApprovalRepository;
  authorityResolver: ApprovalAuthorityResolver;
  schemaRegistry?: ConfigurationSchemaRegistry;
  capabilityRegistry?: CapabilityRegistry;
  featureFlagRegistry?: FeatureFlagRegistry;
  maxRecentErrors?: number;
}>;

export class ConfigurationApprovalService implements ConfigurationApprovalRuntimeService {
  public readonly managedService: RuntimeManagedService;

  private state: ApprovalServiceDiagnostics["state"] = "CREATED";
  private authorityFailures = 0;
  private separationViolations = 0;
  private staleApprovalCount = 0;
  private integrityFailures = 0;
  private lastRequestAt: ApprovalServiceDiagnostics["lastRequestAt"];
  private lastDecisionAt: ApprovalServiceDiagnostics["lastDecisionAt"];
  private readonly recentErrors: string[] = [];

  public constructor(private readonly input: ConfigurationApprovalServiceInput) {
    this.managedService = this.createManagedService();
  }

  public evaluateApprovalRequirement(version: ConfigurationVersion) {
    const evaluation = evaluateApprovalRequirement({
      version,
      policyRegistry: this.input.policyRegistry,
      clock: this.input.clock,
      ...(this.input.schemaRegistry === undefined
        ? {}
        : { schemaRegistry: this.input.schemaRegistry }),
      ...(this.input.capabilityRegistry === undefined
        ? {}
        : { capabilityRegistry: this.input.capabilityRegistry }),
      ...(this.input.featureFlagRegistry === undefined
        ? {}
        : { featureFlagRegistry: this.input.featureFlagRegistry }),
    });
    if (!evaluation.ok) {
      this.recordError(evaluation.error.message);
      return evaluation;
    }
    this.input.repository.appendRequirementEvaluation(evaluation.value);
    this.state = "READY";
    return evaluation;
  }

  public createApprovalRequest(
    input: CreateApprovalRequestInput,
  ): ConfigurationResult<ConfigurationApprovalRequest> {
    const requirement = this.evaluateApprovalRequirement(input.version);
    if (!requirement.ok) {
      return requirement;
    }
    const reasonError = validateReason(input.reason, "APPROVAL_REASON_REQUIRED", this.input.clock);
    if (reasonError !== undefined) {
      this.recordError(reasonError.message);
      return fail(reasonError);
    }
    const requestedAt = this.input.clock.now();
    const requestFingerprint = fingerprint({
      versionId: input.version.versionId,
      streamId: input.version.streamId,
      runtimeMode: input.version.runtimeMode,
      maker: input.version.actor,
      changeSetFingerprint: input.version.changeSetFingerprint,
      configurationFingerprint: input.version.configurationFingerprint,
      schemaFingerprint: input.version.schemaFingerprint,
      versionFingerprint: input.version.versionFingerprint,
      policyFingerprint: requirement.value.policyFingerprint,
      classification: requirement.value.classification,
      approvalRequired: requirement.value.approvalRequired,
      requiredApprovalCount: requirement.value.requiredApprovalCount,
      requestedAt,
      idempotencyKey: input.idempotencyKey,
    });
    const request: ConfigurationApprovalRequest = freeze({
      requestId: approvalRequestId(requestFingerprint),
      versionId: input.version.versionId,
      streamId: input.version.streamId,
      runtimeMode: input.version.runtimeMode,
      maker: input.version.actor,
      changeSetId: input.version.changeSetId,
      changeSetFingerprint: input.version.changeSetFingerprint,
      configurationFingerprint: input.version.configurationFingerprint,
      schemaFingerprint: input.version.schemaFingerprint,
      versionFingerprint: input.version.versionFingerprint,
      capabilityImpactFingerprint: requirement.value.capabilityImpactFingerprint,
      affectedKeys: requirement.value.affectedKeys,
      affectedCapabilities: requirement.value.affectedCapabilities,
      policyId: requirement.value.policyId,
      policyFingerprint: requirement.value.policyFingerprint,
      classification: requirement.value.classification,
      approvalRequired: requirement.value.approvalRequired,
      requiredAuthority: requirement.value.requiredAuthority,
      requiredApprovalCount: requirement.value.requiredApprovalCount,
      ...(requirement.value.expiresAfterMs === undefined
        ? {}
        : { expiresAfterMs: requirement.value.expiresAfterMs }),
      requestedAt,
      reason: input.reason.trim(),
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
      ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
      requestFingerprint,
    });
    const appended = this.input.repository.appendRequest(request);
    if (!appended.ok) {
      this.recordError(appended.error.message);
      return appended;
    }
    this.lastRequestAt = request.requestedAt;
    this.state = "READY";
    return appended;
  }

  public submitDecision(
    input: SubmitApprovalDecisionInput,
  ): ConfigurationResult<ConfigurationApprovalDecision> {
    const request = this.input.repository.getRequest(input.requestId);
    if (!request.ok) {
      this.recordError(request.error.message);
      return request;
    }
    const reasonError = validateReason(input.reason, "APPROVAL_REASON_REQUIRED", this.input.clock);
    if (reasonError !== undefined) {
      this.recordError(reasonError.message);
      return fail(reasonError);
    }
    const checkerActorId = stableActorId(input.checker);
    const makerActorId = stableActorId(request.value.maker);
    if (checkerActorId === undefined) {
      this.authorityFailures += 1;
      return fail(
        configurationError({
          code: "APPROVAL_CHECKER_UNAUTHORIZED",
          message: "checker requires stable actor identity",
          timestamp: this.input.clock.now(),
        }),
      );
    }
    if (makerActorId !== undefined && makerActorId === checkerActorId) {
      this.separationViolations += 1;
      return fail(
        configurationError({
          code: "APPROVAL_MAKER_CHECKER_CONFLICT",
          message: "maker cannot approve their own approval-required configuration version",
          timestamp: this.input.clock.now(),
        }),
      );
    }
    const existingFinal = this.finalStatusForRequest(request.value);
    if (input.idempotencyKey !== undefined) {
      const existingDecision = this.input.repository
        .decisionsByRequest(request.value.requestId)
        .find((decision) => decision.idempotencyKey === input.idempotencyKey);
      if (existingDecision !== undefined) {
        return ok(existingDecision);
      }
    }
    if (
      existingFinal === "APPROVED" ||
      existingFinal === "REJECTED" ||
      existingFinal === "REVOKED"
    ) {
      return fail(
        configurationError({
          code: "APPROVAL_ALREADY_DECIDED",
          message: `approval request is already ${existingFinal.toLowerCase()}`,
          timestamp: this.input.clock.now(),
        }),
      );
    }
    const authority = this.input.authorityResolver.resolve(input.checker, {
      classification: request.value.classification,
      requiredAuthority: request.value.requiredAuthority,
      runtimeMode: request.value.runtimeMode,
      policyId: request.value.policyId,
    });
    if (!authority.ok || !authority.value.authorized) {
      this.authorityFailures += 1;
      return fail(
        configurationError({
          code: "APPROVAL_CHECKER_UNAUTHORIZED",
          message: "checker authority could not be verified",
          timestamp: this.input.clock.now(),
        }),
      );
    }
    const decidedAt = this.input.clock.now();
    const expiresAt =
      input.decision === "APPROVE" && request.value.approvalRequired
        ? expiryForDecision(request.value, decidedAt)
        : undefined;
    const decisionFingerprint = fingerprint({
      requestId: request.value.requestId,
      versionId: request.value.versionId,
      checker: input.checker,
      decision: input.decision,
      reason: input.reason.trim(),
      decidedAt,
      policyFingerprint: request.value.policyFingerprint,
      configurationFingerprint: request.value.configurationFingerprint,
      changeSetFingerprint: request.value.changeSetFingerprint,
      schemaFingerprint: request.value.schemaFingerprint,
      authorityEvidence: authority.value,
      expiresAt,
      idempotencyKey: input.idempotencyKey,
    });
    const decision: ConfigurationApprovalDecision = freeze({
      decisionId: approvalDecisionId(decisionFingerprint),
      requestId: request.value.requestId,
      versionId: request.value.versionId,
      checker: input.checker,
      decision: input.decision,
      reason: input.reason.trim(),
      decidedAt,
      policyId: request.value.policyId,
      policyFingerprint: request.value.policyFingerprint,
      authorityEvidence: authority.value,
      configurationFingerprint: request.value.configurationFingerprint,
      changeSetFingerprint: request.value.changeSetFingerprint,
      schemaFingerprint: request.value.schemaFingerprint,
      ...(expiresAt === undefined ? {} : { expiresAt }),
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
      ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
      decisionFingerprint,
    });
    const appended = this.input.repository.appendDecision(decision);
    if (!appended.ok) {
      this.recordError(appended.error.message);
      return appended;
    }
    this.lastDecisionAt = decision.decidedAt;
    return appended;
  }

  public revokeApproval(
    input: RevokeApprovalInput,
  ): ConfigurationResult<ConfigurationApprovalRevocation> {
    const request = this.input.repository.getRequest(input.requestId);
    if (!request.ok) {
      return request;
    }
    const decision = this.input.repository.getDecision(input.decisionId);
    if (!decision.ok) {
      return decision;
    }
    const reasonError = validateReason(input.reason, "APPROVAL_REASON_REQUIRED", this.input.clock);
    if (reasonError !== undefined) {
      return fail(reasonError);
    }
    const authority = this.input.authorityResolver.resolve(input.revokedBy, {
      classification: request.value.classification,
      requiredAuthority: request.value.requiredAuthority,
      runtimeMode: request.value.runtimeMode,
      policyId: request.value.policyId,
    });
    if (!authority.ok || !authority.value.authorized) {
      this.authorityFailures += 1;
      return fail(
        configurationError({
          code: "APPROVAL_CHECKER_UNAUTHORIZED",
          message: "revocation authority could not be verified",
          timestamp: this.input.clock.now(),
        }),
      );
    }
    const revokedAt = this.input.clock.now();
    const revocationFingerprint = fingerprint({
      requestId: input.requestId,
      decisionId: input.decisionId,
      versionId: request.value.versionId,
      revokedBy: input.revokedBy,
      reason: input.reason.trim(),
      revokedAt,
      authorityEvidence: authority.value,
      idempotencyKey: input.idempotencyKey,
    });
    return this.input.repository.appendRevocation(
      freeze({
        revocationId: approvalRevocationId(revocationFingerprint),
        requestId: input.requestId,
        decisionId: input.decisionId,
        versionId: request.value.versionId,
        revokedBy: input.revokedBy,
        reason: input.reason.trim(),
        revokedAt,
        authorityEvidence: authority.value,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
        revocationFingerprint,
      }),
    );
  }

  public isApprovalSatisfied(
    version: ConfigurationVersion,
    currentVersionId?: ConfigurationVersionId,
  ): ConfigurationResult<ApprovalEligibilityResult> {
    const evaluation = this.evaluateApprovalRequirement(version);
    if (!evaluation.ok) {
      return evaluation;
    }
    if (!evaluation.value.approvalRequired) {
      return ok(
        freeze({
          versionId: version.versionId,
          evaluatedAt: this.input.clock.now(),
          approvalRequired: false,
          status: "NOT_REQUIRED",
          eligible: true,
          reasonCodes: evaluation.value.reasonCodes,
          policyId: evaluation.value.policyId,
          policyFingerprint: evaluation.value.policyFingerprint,
          validDecisionIds: [],
          checkers: [],
          evaluation: evaluation.value,
        }),
      );
    }
    if (currentVersionId !== undefined && currentVersionId !== version.versionId) {
      return ok(this.ineligible(version, evaluation.value, "SUPERSEDED", ["APPROVAL_SUPERSEDED"]));
    }
    const matchingRequests = this.input.repository
      .requestsByVersion(version.versionId)
      .filter((request) => request.policyFingerprint === evaluation.value.policyFingerprint)
      .filter((request) => request.configurationFingerprint === version.configurationFingerprint)
      .filter((request) => request.changeSetFingerprint === version.changeSetFingerprint)
      .filter((request) => request.schemaFingerprint === version.schemaFingerprint);
    const request = matchingRequests.at(-1);
    if (request === undefined) {
      return ok(this.ineligible(version, evaluation.value, "PENDING", ["APPROVAL_REQUIRED"]));
    }
    const mismatch = bindingMismatch(request, version, evaluation.value.policyFingerprint);
    if (mismatch.length > 0) {
      this.staleApprovalCount += 1;
      return ok(this.ineligible(version, evaluation.value, "STALE", mismatch));
    }
    const decisions = this.input.repository.decisionsByRequest(request.requestId);
    const revocations = this.input.repository.revocationsByRequest(request.requestId);
    if (decisions.some((decision) => decision.decision === "REJECT")) {
      return ok(
        this.ineligible(version, evaluation.value, "REJECTED", ["APPROVAL_REJECTED"], request),
      );
    }
    const approvalDecisions = decisions.filter((decision) => decision.decision === "APPROVE");
    const revokedDecisionIds = new Set(revocations.map((revocation) => revocation.decisionId));
    const activeDecisions = approvalDecisions.filter(
      (decision) => !revokedDecisionIds.has(decision.decisionId),
    );
    const validDecisions = activeDecisions.filter(
      (decision) =>
        decision.expiresAt === undefined ||
        compareInstants(this.input.clock.now(), decision.expiresAt) <= 0,
    );
    const uniqueCheckers = uniqueCheckerDecisions(validDecisions);
    if (uniqueCheckers.length >= evaluation.value.requiredApprovalCount) {
      const expiresAt = earliestExpiry(uniqueCheckers);
      return ok(
        freeze({
          versionId: version.versionId,
          evaluatedAt: this.input.clock.now(),
          approvalRequired: true,
          status: "APPROVED",
          eligible: true,
          reasonCodes: [...evaluation.value.reasonCodes, "APPROVAL_SATISFIED"],
          policyId: evaluation.value.policyId,
          policyFingerprint: evaluation.value.policyFingerprint,
          requestId: request.requestId,
          validDecisionIds: uniqueCheckers.map((decision) => decision.decisionId),
          maker: request.maker,
          checkers: uniqueCheckers.map((decision) => decision.checker),
          ...(expiresAt === undefined ? {} : { expiresAt }),
          evaluation: evaluation.value,
        }),
      );
    }
    if (
      approvalDecisions.length > 0 &&
      approvalDecisions.every((decision) => revokedDecisionIds.has(decision.decisionId))
    ) {
      return ok(
        this.ineligible(version, evaluation.value, "REVOKED", ["APPROVAL_REVOKED"], request),
      );
    }
    if (
      activeDecisions.some(
        (decision) =>
          decision.expiresAt !== undefined &&
          compareInstants(this.input.clock.now(), decision.expiresAt) > 0,
      )
    ) {
      return ok(
        this.ineligible(version, evaluation.value, "EXPIRED", ["APPROVAL_EXPIRED"], request),
      );
    }
    return ok(
      this.ineligible(version, evaluation.value, "PENDING", ["APPROVAL_NOT_SATISFIED"], request),
    );
  }

  public explainApprovalForVersion(version: ConfigurationVersion) {
    return this.isApprovalSatisfied(version);
  }

  public diagnostics(): ApprovalServiceDiagnostics {
    const requests = this.input.repository.listRequests();
    const statuses = requests.map((request) => this.finalStatusForRequest(request));
    return {
      state: this.state,
      runtimeMode: this.input.runtimeMode,
      policyCount: this.input.policyRegistry.all().length,
      pendingCount: statuses.filter((status) => status === "PENDING").length,
      approvedCount: statuses.filter((status) => status === "APPROVED").length,
      rejectedCount: statuses.filter((status) => status === "REJECTED").length,
      expiredCount: statuses.filter((status) => status === "EXPIRED").length,
      revokedCount: statuses.filter((status) => status === "REVOKED").length,
      supersededCount: statuses.filter((status) => status === "SUPERSEDED").length,
      sensitiveCount: requests.filter((request) => request.classification === "SENSITIVE").length,
      criticalCount: requests.filter((request) => request.classification === "CRITICAL").length,
      authorityFailures: this.authorityFailures,
      separationViolations: this.separationViolations,
      staleApprovalCount: this.staleApprovalCount,
      integrityFailures: this.integrityFailures,
      ...(this.lastRequestAt === undefined ? {} : { lastRequestAt: this.lastRequestAt }),
      ...(this.lastDecisionAt === undefined ? {} : { lastDecisionAt: this.lastDecisionAt }),
      recentErrors: [...this.recentErrors],
    };
  }

  public checkHealth(): HealthReport {
    const diagnostics = this.diagnostics();
    return {
      status:
        diagnostics.state === "FAILED" || diagnostics.integrityFailures > 0
          ? "UNHEALTHY"
          : diagnostics.authorityFailures > 0 || diagnostics.staleApprovalCount > 0
            ? "DEGRADED"
            : "HEALTHY",
      timestamp: this.input.clock.now(),
      serviceId: configurationApprovalServiceId,
      details: diagnostics,
    };
  }

  public checkReadiness(): ReadinessReport {
    const ready = this.input.policyRegistry.validate().ok && this.state !== "FAILED";
    return {
      status: ready ? "READY" : "NOT_READY",
      timestamp: this.input.clock.now(),
      serviceId: configurationApprovalServiceId,
      ...(ready ? {} : { reason: "configuration approval authority is not ready" }),
      details: this.diagnostics(),
    };
  }

  public stop(): void {
    this.state = "STOPPED";
  }

  private finalStatusForRequest(request: ConfigurationApprovalRequest): ApprovalLifecycleStatus {
    const decisions = this.input.repository.decisionsByRequest(request.requestId);
    const revocations = this.input.repository.revocationsByRequest(request.requestId);
    if (decisions.some((decision) => decision.decision === "REJECT")) {
      return "REJECTED";
    }
    const approvals = decisions.filter((decision) => decision.decision === "APPROVE");
    if (approvals.length === 0) {
      return "PENDING";
    }
    const revokedDecisionIds = new Set(revocations.map((revocation) => revocation.decisionId));
    const activeApprovals = approvals.filter(
      (decision) => !revokedDecisionIds.has(decision.decisionId),
    );
    if (activeApprovals.length === 0 && approvals.length > 0) {
      return "REVOKED";
    }
    if (
      activeApprovals.some(
        (decision) =>
          decision.expiresAt !== undefined &&
          compareInstants(this.input.clock.now(), decision.expiresAt) > 0,
      )
    ) {
      return "EXPIRED";
    }
    return uniqueCheckerDecisions(activeApprovals).length >= request.requiredApprovalCount
      ? "APPROVED"
      : "PENDING";
  }

  private ineligible(
    version: ConfigurationVersion,
    evaluation: ApprovalEligibilityResult["evaluation"],
    status: ApprovalLifecycleStatus,
    reasonCodes: ApprovalEligibilityResult["reasonCodes"],
    request?: ConfigurationApprovalRequest,
  ): ApprovalEligibilityResult {
    return freeze({
      versionId: version.versionId,
      evaluatedAt: this.input.clock.now(),
      approvalRequired: evaluation.approvalRequired,
      status,
      eligible: false,
      reasonCodes: [...evaluation.reasonCodes, ...reasonCodes],
      policyId: evaluation.policyId,
      policyFingerprint: evaluation.policyFingerprint,
      ...(request === undefined ? {} : { requestId: request.requestId }),
      validDecisionIds: [],
      ...(request === undefined ? {} : { maker: request.maker }),
      checkers: [],
      evaluation,
    });
  }

  private createManagedService(): RuntimeManagedService {
    return {
      descriptor: serviceDescriptor({
        serviceId: configurationApprovalServiceId,
        name: "ATE Configuration Approval Authority",
        version: "0.11.0-config-approval.1",
        description:
          "Maker-checker governance authority for exact-version configuration approval evidence, separation of duties and eligibility diagnostics.",
        criticality: "CRITICAL",
        dependencies: [configurationVersionServiceId],
        supportedModes: ["DEVELOPMENT", "RESEARCH", "BACKTEST", "SIMULATION", "PAPER", "LIVE"],
        capabilities: ["CONFIGURATION_APPROVAL", "MAKER_CHECKER"],
        degradationPolicy: "BLOCK_READINESS",
        healthCapability: true,
        readinessCapability: true,
        recoverable: true,
      }),
      initialize: () => {
        this.state = this.input.policyRegistry.validate().ok ? "READY" : "FAILED";
      },
      stop: () => {
        this.stop();
      },
      checkHealth: () => this.checkHealth(),
      checkReadiness: () => this.checkReadiness(),
    };
  }

  private recordError(message: string): void {
    this.recentErrors.unshift(message);
    this.recentErrors.splice(this.input.maxRecentErrors ?? 20);
  }
}

export class StaticApprovalAuthorityResolver implements ApprovalAuthorityResolver {
  public constructor(
    private readonly input: {
      clock: Clock;
      grants: Readonly<Record<string, readonly ApprovalAuthorityCategory[]>>;
      available?: boolean;
    },
  ) {}

  public resolve(
    actor: Actor,
    requirement: ApprovalAuthorityRequirement,
  ): ConfigurationResult<ApprovalAuthorityEvidence> {
    if (this.input.available === false) {
      return fail(
        configurationError({
          code: "APPROVAL_CHECKER_UNAUTHORIZED",
          message: "approval authority resolver is unavailable",
          timestamp: this.input.clock.now(),
        }),
      );
    }
    const actorId = actor.actorId;
    if (actorId === undefined) {
      return fail(
        configurationError({
          code: "APPROVAL_CHECKER_UNAUTHORIZED",
          message: "checker has no stable actor id",
          timestamp: this.input.clock.now(),
        }),
      );
    }
    const grants = this.input.grants[actorId] ?? [];
    const authorized = grants.some(
      (grant) => authorityRankValue(grant) >= authorityRankValue(requirement.requiredAuthority),
    );
    return ok(
      freeze({
        actorId,
        authority: requirement.requiredAuthority,
        authorized,
        checkedAt: this.input.clock.now(),
        evidence: authorized
          ? `actor ${actorId} has ${requirement.requiredAuthority}`
          : `actor ${actorId} lacks ${requirement.requiredAuthority}`,
      }),
    );
  }
}

export type GovernedConfigurationPublicationGate = Readonly<{
  appliedVersionId: () => ConfigurationVersionId | undefined;
  appliedSnapshot: () => ConfigurationSnapshot | undefined;
  evaluateApplication: (
    version: ConfigurationVersion,
  ) => ConfigurationResult<ApprovalEligibilityResult>;
  applyIfEligible: (
    version: ConfigurationVersion,
    snapshot: ConfigurationSnapshot,
  ) => ConfigurationResult<{ applied: boolean; eligibility: ApprovalEligibilityResult }>;
}>;

export const createGovernedConfigurationPublicationGate = (input: {
  approvalService: ConfigurationApprovalRuntimeService;
  initialAppliedVersion?: ConfigurationVersion;
  initialAppliedSnapshot?: ConfigurationSnapshot;
}): GovernedConfigurationPublicationGate => {
  let appliedVersion = input.initialAppliedVersion;
  let appliedSnapshot = input.initialAppliedSnapshot;
  return {
    appliedVersionId: () => appliedVersion?.versionId,
    appliedSnapshot: () => appliedSnapshot,
    evaluateApplication: (version) => input.approvalService.isApprovalSatisfied(version),
    applyIfEligible: (version, snapshot) => {
      const eligibility = input.approvalService.isApprovalSatisfied(version);
      if (!eligibility.ok) {
        return eligibility;
      }
      if (!eligibility.value.eligible) {
        return ok({ applied: false, eligibility: eligibility.value });
      }
      appliedVersion = version;
      appliedSnapshot = snapshot;
      return ok({ applied: true, eligibility: eligibility.value });
    },
  };
};

export const createConfigurationApprovalService = (
  input: ConfigurationApprovalServiceInput,
): ConfigurationApprovalService => new ConfigurationApprovalService(input);

const stableActorId = (actor: Actor): ActorId | undefined => actor.actorId;

const validateReason = (reason: string, code: "APPROVAL_REASON_REQUIRED", clock: Clock) => {
  if (reason.trim().length === 0 || reason.length > 500 || /[\r\n]/u.test(reason)) {
    return configurationError({
      code,
      message: "approval reason must be 1-500 characters without line breaks",
      timestamp: clock.now(),
    });
  }
  return undefined;
};

const bindingMismatch = (
  request: ConfigurationApprovalRequest,
  version: ConfigurationVersion,
  currentPolicyFingerprint: ConfigurationFingerprint,
): ApprovalEligibilityResult["reasonCodes"] => [
  ...(request.versionId !== version.versionId ? (["APPROVAL_VERSION_MISMATCH"] as const) : []),
  ...(request.configurationFingerprint !== version.configurationFingerprint
    ? (["APPROVAL_CONFIGURATION_FINGERPRINT_MISMATCH"] as const)
    : []),
  ...(request.changeSetFingerprint !== version.changeSetFingerprint
    ? (["APPROVAL_CHANGESET_MISMATCH"] as const)
    : []),
  ...(request.schemaFingerprint !== version.schemaFingerprint
    ? (["APPROVAL_SCHEMA_FINGERPRINT_MISMATCH"] as const)
    : []),
  ...(request.policyFingerprint !== currentPolicyFingerprint
    ? (["APPROVAL_POLICY_FINGERPRINT_MISMATCH"] as const)
    : []),
];

const expiryForDecision = (
  request: ConfigurationApprovalRequest,
  decidedAt: ConfigurationApprovalDecision["decidedAt"],
) => {
  const expiresAfterMs = request.expiresAfterMs;
  return expiresAfterMs === undefined
    ? undefined
    : addDuration(decidedAt, durationMs(expiresAfterMs));
};

const approvalRequestId = (value: string): ConfigurationApprovalRequestId =>
  `appreq-${value.replace("sha256:", "").slice(0, 24)}` as ConfigurationApprovalRequestId;

const approvalDecisionId = (value: string): ConfigurationApprovalDecisionId =>
  `appdec-${value.replace("sha256:", "").slice(0, 24)}` as ConfigurationApprovalDecisionId;

const approvalRevocationId = (value: string): ConfigurationApprovalRevocationId =>
  `apprev-${value.replace("sha256:", "").slice(0, 24)}` as ConfigurationApprovalRevocationId;

const authorityRankValue = (authority: ApprovalAuthorityCategory): number =>
  ({
    CONFIGURATION_CHECKER: 0,
    SENSITIVE_CONFIGURATION_CHECKER: 1,
    CRITICAL_CONFIGURATION_CHECKER: 2,
  })[authority];

const uniqueCheckerDecisions = (
  decisions: readonly ConfigurationApprovalDecision[],
): readonly ConfigurationApprovalDecision[] => [
  ...new Map(
    decisions
      .map((decision) => [stableActorId(decision.checker), decision] as const)
      .filter(
        (entry): entry is readonly [ActorId, ConfigurationApprovalDecision] =>
          entry[0] !== undefined,
      ),
  ).values(),
];

const earliestExpiry = (
  decisions: readonly ConfigurationApprovalDecision[],
): ConfigurationApprovalDecision["expiresAt"] => {
  const expiries = decisions
    .map((decision) => decision.expiresAt)
    .filter((expiresAt): expiresAt is NonNullable<typeof expiresAt> => expiresAt !== undefined)
    .sort((left, right) => compareInstants(left, right));
  return expiries[0];
};
