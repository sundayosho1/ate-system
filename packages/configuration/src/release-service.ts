import type { Actor, ActorId, RuntimeMode } from "@ate/domain";
import {
  serviceDescriptor,
  type HealthReport,
  type ReadinessReport,
  type RuntimeManagedService,
  type ServiceId,
} from "@ate/runtime";
import type { Clock } from "@ate/time";

import type { ApprovalAuthorityResolver } from "./approval-types.js";
import type { ConfigurationApprovalRuntimeService } from "./approval-types.js";
import { evaluateCapabilities } from "./capability-evaluator.js";
import type { CapabilityRegistry, FeatureFlagRegistry } from "./capability-registry.js";
import type { CapabilitySnapshot } from "./capability-types.js";
import { freeze } from "./context.js";
import { configurationError, fail, ok } from "./errors.js";
import {
  ConfigurationPromotionGraph,
  promotionPolicyFingerprint,
  type ConfigurationPromotionPolicyRegistry,
} from "./release-policy.js";
import {
  activationId,
  knownGoodId,
  promotionDecisionId,
  promotionExecutionId,
  promotionPlanId,
  promotionRequestId,
  rollbackExecutionId,
  rollbackPlanId,
  rollbackRequestId,
} from "./release-repository.js";
import { ConfigurationResolver } from "./resolver.js";
import { fingerprint } from "./serialization.js";
import type { ConfigurationRegistry } from "./registry.js";
import type { ConfigurationSchemaRegistry } from "./schema-registry.js";
import { validateConfigurationSnapshot, validateEffectiveConfiguration } from "./validation.js";
import { combineValidationReports } from "./validation-report.js";
import type {
  ConfigurationEntry,
  ConfigurationFingerprint,
  ConfigurationResult,
  ConfigurationSnapshot,
} from "./types.js";
import { diffConfigurationVersions, snapshotFromVersionContent } from "./version-core.js";
import type { ConfigurationVersion, ConfigurationVersionRepository } from "./version-types.js";
import { configurationVersionServiceId } from "./version-service.js";
import { capabilityServiceId } from "./capability-service.js";
import { configurationApprovalServiceId } from "./approval-service.js";
import type {
  ConfigurationActivationRecord,
  ConfigurationEnvironment,
  ConfigurationEnvironmentState,
  ConfigurationPromotionDecision,
  ConfigurationPromotionEligibility,
  ConfigurationPromotionExecution,
  ConfigurationPromotionPlan,
  ConfigurationPromotionReasonCode,
  ConfigurationPromotionRequest,
  ConfigurationReleaseBlocker,
  ConfigurationReleaseLineage,
  ConfigurationReleaseRepository,
  ConfigurationReleaseRuntimeService,
  ConfigurationReleaseWarning,
  ConfigurationRollbackEligibility,
  ConfigurationRollbackExecution,
  ConfigurationRollbackPlan,
  ConfigurationRollbackReasonCode,
  ConfigurationRollbackRequest,
  CreatePromotionPlanInput,
  CreatePromotionRequestInput,
  CreateRollbackPlanInput,
  CreateRollbackRequestInput,
  ExecutePromotionInput,
  ExecuteRollbackInput,
  KnownGoodConfiguration,
  ReleaseServiceDiagnostics,
  RestartRequirement,
  SubmitPromotionDecisionInput,
} from "./release-types.js";

export const configurationReleaseServiceId = "configuration.release" as ServiceId;

export type ConfigurationReleaseServiceInput = Readonly<{
  runtimeMode: RuntimeMode;
  clock: Clock;
  registry: ConfigurationRegistry;
  schemaRegistry: ConfigurationSchemaRegistry;
  versionRepository: ConfigurationVersionRepository;
  releaseRepository: ConfigurationReleaseRepository;
  policyRegistry: ConfigurationPromotionPolicyRegistry;
  approvalService?: ConfigurationApprovalRuntimeService;
  authorityResolver?: ApprovalAuthorityResolver;
  capabilityRegistry?: CapabilityRegistry;
  featureFlagRegistry?: FeatureFlagRegistry;
  promotionGraph?: ConfigurationPromotionGraph;
  maxRecentErrors?: number;
}>;

export class ConfigurationReleaseService implements ConfigurationReleaseRuntimeService {
  public readonly managedService: RuntimeManagedService;

  private state: ReleaseServiceDiagnostics["state"] = "CREATED";
  private integrityFailures = 0;
  private unresolvedActivationUncertainty = 0;
  private readonly recentErrors: string[] = [];

  public constructor(private readonly input: ConfigurationReleaseServiceInput) {
    this.managedService = this.createManagedService();
  }

  public createPromotionRequest(
    input: CreatePromotionRequestInput,
  ): ConfigurationResult<ConfigurationPromotionRequest> {
    const source = this.input.versionRepository.get(input.sourceVersionId);
    if (!source.ok) {
      this.recordError(source.error.message);
      return fail({
        ...source.error,
        code: "PROMOTION_SOURCE_NOT_FOUND",
      });
    }
    if (source.value.runtimeMode !== input.sourceEnvironment) {
      return fail(
        configurationError({
          code: "PROMOTION_SOURCE_INVALID",
          message: "source version runtime mode does not match requested source environment",
          timestamp: this.input.clock.now(),
        }),
      );
    }
    const policy = this.input.policyRegistry.policyFor(
      input.sourceEnvironment,
      input.destinationEnvironment,
    );
    if (!policy.ok) {
      return policy;
    }
    const reasonError = validateReason(input.reason, this.input.clock);
    if (reasonError !== undefined) {
      return fail(reasonError);
    }
    const destinationState = this.input.releaseRepository.environmentState(
      input.destinationEnvironment,
    );
    const requestFingerprint = fingerprint({
      sourceEnvironment: input.sourceEnvironment,
      sourceVersionId: input.sourceVersionId,
      sourceConfigurationFingerprint: source.value.configurationFingerprint,
      sourceSchemaFingerprint: source.value.schemaFingerprint,
      destinationEnvironment: input.destinationEnvironment,
      destinationBaselineVersionId: destinationState?.activeVersionId,
      destinationBaselineFingerprint: destinationState?.activeConfigurationFingerprint,
      requestedBy: input.requestedBy,
      reason: input.reason.trim(),
      policyFingerprint: promotionPolicyFingerprint(policy.value),
      idempotencyKey: input.idempotencyKey,
    });
    const request: ConfigurationPromotionRequest = freeze({
      requestId: promotionRequestId(requestFingerprint),
      sourceEnvironment: input.sourceEnvironment,
      sourceVersionId: source.value.versionId,
      sourceStreamId: source.value.streamId,
      sourceConfigurationFingerprint: source.value.configurationFingerprint,
      sourceSchemaFingerprint: source.value.schemaFingerprint,
      destinationEnvironment: input.destinationEnvironment,
      destinationStreamId:
        `configuration.${input.destinationEnvironment.toLowerCase()}.release` as ConfigurationPromotionRequest["destinationStreamId"],
      ...(destinationState === undefined
        ? {}
        : {
            destinationBaselineVersionId: destinationState.activeVersionId,
            destinationBaselineFingerprint: destinationState.activeConfigurationFingerprint,
            destinationBaselineActivationId: destinationState.activationId,
          }),
      requestedBy: input.requestedBy,
      requestedAt: this.input.clock.now(),
      reason: input.reason.trim(),
      policyId: policy.value.policyId,
      policyFingerprint: promotionPolicyFingerprint(policy.value),
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
      ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
      requestFingerprint,
    });
    const appended = this.input.releaseRepository.appendPromotionRequest(request);
    if (!appended.ok) {
      this.recordError(appended.error.message);
      return appended;
    }
    this.state = "READY";
    return appended;
  }

  public createPromotionPlan(
    input: CreatePromotionPlanInput,
  ): ConfigurationResult<ConfigurationPromotionPlan> {
    const request = this.input.releaseRepository.getPromotionRequest(input.requestId);
    if (!request.ok) {
      return request;
    }
    const plan = this.buildPromotionPlan(request.value, input.plannedBy, {
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
      ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    });
    if (!plan.ok) {
      return plan;
    }
    return this.input.releaseRepository.appendPromotionPlan(plan.value);
  }

  public submitPromotionDecision(
    input: SubmitPromotionDecisionInput,
  ): ConfigurationResult<ConfigurationPromotionDecision> {
    const request = this.input.releaseRepository.getPromotionRequest(input.requestId);
    if (!request.ok) {
      return request;
    }
    const policy = this.input.policyRegistry.require(request.value.policyId);
    if (!policy.ok) {
      return policy;
    }
    const reasonError = validateReason(input.reason, this.input.clock);
    if (reasonError !== undefined) {
      return fail(reasonError);
    }
    const checkerActorId = stableActorId(input.checker);
    const requesterActorId = stableActorId(request.value.requestedBy);
    if (checkerActorId === undefined) {
      return fail(
        configurationError({
          code: "PROMOTION_APPROVAL_INVALID",
          message: "promotion checker requires stable actor identity",
          timestamp: this.input.clock.now(),
        }),
      );
    }
    if (requesterActorId !== undefined && requesterActorId === checkerActorId) {
      return fail(
        configurationError({
          code: "PROMOTION_APPROVAL_INVALID",
          message: "promotion requester cannot satisfy checker requirement",
          timestamp: this.input.clock.now(),
        }),
      );
    }
    if (this.input.authorityResolver !== undefined) {
      const authority = this.input.authorityResolver.resolve(input.checker, {
        classification: "SENSITIVE",
        requiredAuthority: policy.value.requiredPromotionAuthority,
        runtimeMode: request.value.destinationEnvironment,
        policyId: request.value.policyId as never,
      });
      if (!authority.ok || !authority.value.authorized) {
        return fail(
          configurationError({
            code: "PROMOTION_APPROVAL_INVALID",
            message: "promotion checker authority could not be verified",
            timestamp: this.input.clock.now(),
          }),
        );
      }
    }
    const decisionFingerprint = fingerprint({
      requestId: request.value.requestId,
      checker: input.checker,
      decision: input.decision,
      reason: input.reason.trim(),
      policyFingerprint: request.value.policyFingerprint,
      idempotencyKey: input.idempotencyKey,
    });
    const decision: ConfigurationPromotionDecision = freeze({
      decisionId: promotionDecisionId(decisionFingerprint),
      requestId: request.value.requestId,
      checker: input.checker,
      decision: input.decision,
      reason: input.reason.trim(),
      decidedAt: this.input.clock.now(),
      authority: policy.value.requiredPromotionAuthority,
      policyId: request.value.policyId,
      policyFingerprint: request.value.policyFingerprint,
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
      ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
      decisionFingerprint,
    });
    return this.input.releaseRepository.appendPromotionDecision(decision);
  }

  public executePromotion(
    input: ExecutePromotionInput,
  ): ConfigurationResult<ConfigurationPromotionExecution> {
    const plan = this.input.releaseRepository.getPromotionPlan(input.planId);
    if (!plan.ok) {
      return plan;
    }
    const request = this.input.releaseRepository.getPromotionRequest(plan.value.requestId);
    if (!request.ok) {
      return request;
    }
    const recheck = this.buildPromotionPlan(request.value, input.executedBy, {});
    if (!recheck.ok) {
      return recheck;
    }
    if (!recheck.value.eligibility.eligible) {
      return this.failedPromotionExecution(
        plan.value,
        input.executedBy,
        input,
        "promotion plan failed final pre-activation recheck",
      );
    }
    const activation = this.activationFromPromotion(recheck.value, input.executedBy, input);
    const appendedActivation = this.input.releaseRepository.appendActivation(
      activation,
      request.value.destinationBaselineVersionId,
    );
    if (!appendedActivation.ok) {
      return this.failedPromotionExecution(
        plan.value,
        input.executedBy,
        input,
        appendedActivation.error.message,
      );
    }
    this.recordKnownGoodFromActivation(appendedActivation.value);
    const executionFingerprint = fingerprint({
      planId: plan.value.planId,
      activationId: appendedActivation.value.activationId,
      executedBy: input.executedBy,
      result: "SUCCEEDED",
      idempotencyKey: input.idempotencyKey,
    });
    const execution = freeze({
      executionId: promotionExecutionId(executionFingerprint),
      requestId: plan.value.requestId,
      planId: plan.value.planId,
      activationId: appendedActivation.value.activationId,
      executedBy: input.executedBy,
      executedAt: this.input.clock.now(),
      result: "SUCCEEDED" as const,
      status: "SUCCEEDED" as const,
      reasonCodes: ["PROMOTION_ACTIVATED", "PROMOTION_VERIFIED", "KNOWN_GOOD_RECORDED"] as const,
      safeMessage: "promotion activated atomically and verified",
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
      ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
      executionFingerprint,
    });
    return this.input.releaseRepository.appendPromotionExecution(execution);
  }

  public createRollbackRequest(
    input: CreateRollbackRequestInput,
  ): ConfigurationResult<ConfigurationRollbackRequest> {
    const state = this.input.releaseRepository.environmentState(input.environment);
    if (state === undefined) {
      return fail(
        configurationError({
          code: "ROLLBACK_NOT_ELIGIBLE",
          message: `environment has no active configuration: ${input.environment}`,
          timestamp: this.input.clock.now(),
        }),
      );
    }
    const target = this.input.versionRepository.get(input.targetVersionId);
    if (!target.ok) {
      return fail({ ...target.error, code: "ROLLBACK_TARGET_NOT_FOUND" });
    }
    const policy = this.input.policyRegistry.policyFor(input.environment, input.environment);
    if (!policy.ok) {
      return policy;
    }
    const reasonError = validateReason(input.reason, this.input.clock);
    if (reasonError !== undefined) {
      return fail(reasonError);
    }
    const requestFingerprint = fingerprint({
      environment: input.environment,
      currentVersionId: state.activeVersionId,
      currentFingerprint: state.activeConfigurationFingerprint,
      targetVersionId: target.value.versionId,
      targetFingerprint: target.value.configurationFingerprint,
      requestedBy: input.requestedBy,
      reason: input.reason.trim(),
      policyFingerprint: promotionPolicyFingerprint(policy.value),
      idempotencyKey: input.idempotencyKey,
    });
    const request: ConfigurationRollbackRequest = freeze({
      requestId: rollbackRequestId(requestFingerprint),
      environment: input.environment,
      currentVersionId: state.activeVersionId,
      currentConfigurationFingerprint: state.activeConfigurationFingerprint,
      targetVersionId: target.value.versionId,
      targetConfigurationFingerprint: target.value.configurationFingerprint,
      requestedBy: input.requestedBy,
      reason: input.reason.trim(),
      requestedAt: this.input.clock.now(),
      ...(input.triggeringPromotionRequestId === undefined
        ? {}
        : { triggeringPromotionRequestId: input.triggeringPromotionRequestId }),
      policyId: policy.value.policyId,
      policyFingerprint: promotionPolicyFingerprint(policy.value),
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
      ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
      requestFingerprint,
    });
    return this.input.releaseRepository.appendRollbackRequest(request);
  }

  public createRollbackPlan(input: CreateRollbackPlanInput) {
    const request = this.input.releaseRepository.getRollbackRequest(input.requestId);
    if (!request.ok) {
      return request;
    }
    const plan = this.buildRollbackPlan(request.value, input.plannedBy, input);
    if (!plan.ok) {
      return plan;
    }
    return this.input.releaseRepository.appendRollbackPlan(plan.value);
  }

  public executeRollback(
    input: ExecuteRollbackInput,
  ): ConfigurationResult<ConfigurationRollbackExecution> {
    const plan = this.input.releaseRepository.getRollbackPlan(input.planId);
    if (!plan.ok) {
      return plan;
    }
    const request = this.input.releaseRepository.getRollbackRequest(plan.value.requestId);
    if (!request.ok) {
      return request;
    }
    const recheck = this.buildRollbackPlan(request.value, input.executedBy, {});
    if (!recheck.ok) {
      return recheck;
    }
    if (!recheck.value.eligibility.eligible) {
      return this.failedRollbackExecution(
        plan.value,
        input.executedBy,
        input,
        "rollback failed final restoration recheck",
      );
    }
    const activation = this.activationFromRollback(recheck.value, input.executedBy, input);
    const appendedActivation = this.input.releaseRepository.appendActivation(
      activation,
      request.value.currentVersionId,
    );
    if (!appendedActivation.ok) {
      return this.failedRollbackExecution(
        plan.value,
        input.executedBy,
        input,
        appendedActivation.error.message,
      );
    }
    this.recordKnownGoodFromActivation(appendedActivation.value);
    const executionFingerprint = fingerprint({
      planId: plan.value.planId,
      activationId: appendedActivation.value.activationId,
      executedBy: input.executedBy,
      result: "SUCCEEDED",
      idempotencyKey: input.idempotencyKey,
    });
    const execution = freeze({
      executionId: rollbackExecutionId(executionFingerprint),
      requestId: plan.value.requestId,
      planId: plan.value.planId,
      activationId: appendedActivation.value.activationId,
      executedBy: input.executedBy,
      executedAt: this.input.clock.now(),
      result: "SUCCEEDED" as const,
      status: "SUCCEEDED" as const,
      reasonCodes: [
        "ROLLBACK_ACTIVATED",
        "ROLLBACK_VERIFIED",
        "ROLLBACK_HISTORY_PRESERVED",
      ] as const,
      safeMessage: "rollback restored exact known-good target atomically",
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
      ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
      executionFingerprint,
    });
    return this.input.releaseRepository.appendRollbackExecution(execution);
  }

  public explainPromotion(requestId: ConfigurationPromotionRequest["requestId"]) {
    const request = this.input.releaseRepository.getPromotionRequest(requestId);
    if (!request.ok) {
      return request;
    }
    return this.buildPromotionPlan(request.value, request.value.requestedBy, {});
  }

  public explainRollback(requestId: ConfigurationRollbackRequest["requestId"]) {
    const request = this.input.releaseRepository.getRollbackRequest(requestId);
    if (!request.ok) {
      return request;
    }
    return this.buildRollbackPlan(request.value, request.value.requestedBy, {});
  }

  public explainActiveConfiguration(environment: ConfigurationEnvironment) {
    const state = this.input.releaseRepository.environmentState(environment);
    if (state === undefined) {
      return fail(
        configurationError({
          code: "ACTIVE_CONFIGURATION_INTEGRITY_FAILED",
          message: `no active configuration recorded for ${environment}`,
          timestamp: this.input.clock.now(),
        }),
      );
    }
    return ok(state);
  }

  public traceLineage(
    environment: ConfigurationEnvironment,
    versionId?: ConfigurationVersion["versionId"],
  ): ConfigurationResult<ConfigurationReleaseLineage> {
    const history = this.input.releaseRepository.activationHistory(environment, 100);
    const latest = history.at(-1);
    const targetVersionId =
      versionId ??
      latest?.resultingVersionId ??
      this.input.releaseRepository.environmentState(environment)?.activeVersionId;
    if (targetVersionId === undefined) {
      return fail(
        configurationError({
          code: "RELEASE_LINEAGE_INVALID",
          message: `no release lineage for ${environment}`,
          timestamp: this.input.clock.now(),
        }),
      );
    }
    const lineage = history
      .filter(
        (activation) =>
          activation.resultingVersionId === targetVersionId ||
          activation.sourceVersionId === targetVersionId ||
          activation.previousVersionId === targetVersionId,
      )
      .map((activation) => ({
        environment: activation.destinationEnvironment,
        versionId: activation.resultingVersionId,
        activationId: activation.activationId,
        operation: activation.operation,
      }));
    return ok(
      freeze({
        environment,
        versionId: targetVersionId,
        ...(latest === undefined ? {} : { activationId: latest.activationId }),
        ...(latest?.sourceVersionId === undefined
          ? {}
          : { sourceVersionId: latest.sourceVersionId }),
        ...(latest?.previousVersionId === undefined
          ? {}
          : { previousVersionId: latest.previousVersionId }),
        depth: lineage.length,
        lineage,
      }),
    );
  }

  public diagnostics(): ReleaseServiceDiagnostics {
    const requests = this.input.releaseRepository.listPromotionRequests();
    const rollbacks = this.input.releaseRepository.listRollbackRequests();
    const activeEnvironments = [
      "DEVELOPMENT",
      "RESEARCH",
      "BACKTEST",
      "SIMULATION",
      "PAPER",
      "LIVE",
    ].filter(
      (environment): environment is ConfigurationEnvironment =>
        this.input.releaseRepository.environmentState(environment as ConfigurationEnvironment) !==
        undefined,
    );
    const states = activeEnvironments.map((environment) =>
      this.input.releaseRepository.environmentState(environment),
    );
    return {
      state: this.state,
      environmentCount: activeEnvironments.length,
      activeEnvironments,
      pendingPromotionCount: requests.length,
      blockedPromotionCount: 0,
      stalePlanCount: 0,
      failedActivationCount: this.input.releaseRepository
        .activationHistory("LIVE", 1_000)
        .filter((activation) => activation.result === "FAILED").length,
      pendingRestartCount: states.filter((state) => state?.restartPending === true).length,
      rollbackCount: rollbacks.length,
      knownGoodCount: activeEnvironments.flatMap((environment) =>
        this.input.releaseRepository.knownGoodForEnvironment(environment),
      ).length,
      policyFingerprint: this.input.policyRegistry.fingerprint(),
      integrityFailures: this.integrityFailures,
      unresolvedActivationUncertainty: this.unresolvedActivationUncertainty,
      recentErrors: [...this.recentErrors],
    };
  }

  public checkHealth(): HealthReport {
    const diagnostics = this.diagnostics();
    return {
      status:
        diagnostics.unresolvedActivationUncertainty > 0 || diagnostics.integrityFailures > 0
          ? "UNHEALTHY"
          : diagnostics.recentErrors.length > 0
            ? "DEGRADED"
            : "HEALTHY",
      timestamp: this.input.clock.now(),
      serviceId: configurationReleaseServiceId,
      details: diagnostics,
    };
  }

  public checkReadiness(): ReadinessReport {
    const ready = this.input.policyRegistry.validate().ok && this.state !== "FAILED";
    return {
      status: ready ? "READY" : "NOT_READY",
      timestamp: this.input.clock.now(),
      serviceId: configurationReleaseServiceId,
      ...(ready ? {} : { reason: "configuration release authority is not ready" }),
      details: this.diagnostics(),
    };
  }

  public stop(): void {
    this.state = "STOPPED";
  }

  private buildPromotionPlan(
    request: ConfigurationPromotionRequest,
    actor: Actor,
    metadata: {
      correlationId?: ConfigurationPromotionPlan["correlationId"];
      causationId?: ConfigurationPromotionPlan["causationId"];
      idempotencyKey?: string;
    },
  ): ConfigurationResult<ConfigurationPromotionPlan> {
    const source = this.input.versionRepository.get(request.sourceVersionId);
    if (!source.ok) {
      return fail({ ...source.error, code: "PROMOTION_SOURCE_NOT_FOUND" });
    }
    const policy = this.input.policyRegistry.require(request.policyId);
    if (!policy.ok) {
      return policy;
    }
    const destinationState = this.input.releaseRepository.environmentState(
      request.destinationEnvironment,
    );
    const destinationBaseline =
      destinationState === undefined
        ? undefined
        : this.input.versionRepository.get(destinationState.activeVersionId);
    const destinationVersion =
      destinationBaseline?.ok === true ? destinationBaseline.value : undefined;
    const composition = this.composeDestinationSnapshot(
      source.value,
      destinationVersion,
      request.destinationEnvironment,
    );
    const validationReport = this.validateDestinationSnapshot(
      composition.snapshot,
      request.destinationEnvironment,
    );
    const capabilitySnapshot = this.evaluateDestinationCapabilities(
      composition.snapshot,
      request.destinationEnvironment,
      source.value.versionId,
      source.value.schemaFingerprint,
      destinationVersion,
    );
    const capability = capabilitySnapshot.ok ? capabilitySnapshot.value : undefined;
    const safeDiff =
      destinationVersion === undefined
        ? diffConfigurationVersions(source.value, source.value)
        : diffConfigurationVersions(destinationVersion, source.value);
    const decisions = this.input.releaseRepository
      .promotionDecisionsByRequest(request.requestId)
      .filter((decision) => decision.decision === "APPROVE");
    const eligibility = this.evaluatePromotionEligibility({
      request,
      source: source.value,
      destinationState,
      policyFingerprint: promotionPolicyFingerprint(policy.value),
      policy: policy.value,
      destinationBaseline,
      validationReport,
      ...(capability === undefined ? {} : { capabilitySnapshot: capability }),
      nonPromotableBlocked: composition.nonPromotableBlocked,
      destinationLocalPreserved: composition.destinationLocalPreserved,
      promotionDecisionCount: new Set(
        decisions.map((decision) => stableActorId(decision.checker)).filter(Boolean),
      ).size,
    });
    const planFingerprint = fingerprint({
      requestId: request.requestId,
      sourceVersionId: source.value.versionId,
      destinationBaselineVersionId: destinationState?.activeVersionId,
      resultingConfigurationFingerprint: composition.snapshot.fingerprint,
      validationFingerprint: validationReport.fingerprint,
      capabilityFingerprint: capability?.fingerprint,
      eligibility,
      policyFingerprint: promotionPolicyFingerprint(policy.value),
      idempotencyKey: metadata.idempotencyKey,
    });
    return ok(
      freeze({
        planId: promotionPlanId(planFingerprint),
        requestId: request.requestId,
        sourceEnvironment: request.sourceEnvironment,
        destinationEnvironment: request.destinationEnvironment,
        sourceVersionId: source.value.versionId,
        ...(destinationState === undefined
          ? {}
          : {
              destinationBaselineVersionId: destinationState.activeVersionId,
              destinationBaselineFingerprint: destinationState.activeConfigurationFingerprint,
            }),
        resultingVersionId: source.value.versionId,
        resultingConfigurationFingerprint: composition.snapshot.fingerprint,
        resultingSchemaFingerprint: this.input.schemaRegistry.fingerprint(),
        resultingSnapshotId: composition.snapshot.snapshotId,
        plannedAt: this.input.clock.now(),
        plannedBy: actor,
        safeDiff,
        validationReport,
        ...(capability === undefined ? {} : { capabilitySnapshot: capability }),
        capabilityImpact:
          capability === undefined
            ? []
            : capability.capabilities
                .filter((capability) => capability.requested)
                .map((capability) => ({
                  capabilityId: capability.capabilityId,
                  state: capability.state,
                  pendingRestart: capability.pendingRestart,
                })),
        promotionDecisionIds: decisions.map((decision) => decision.decisionId),
        restartRequirement: restartRequirement(capability),
        policyId: policy.value.policyId,
        policyFingerprint: promotionPolicyFingerprint(policy.value),
        eligibility,
        planFingerprint,
        ...(metadata.correlationId === undefined ? {} : { correlationId: metadata.correlationId }),
        ...(metadata.causationId === undefined ? {} : { causationId: metadata.causationId }),
        ...(metadata.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: metadata.idempotencyKey }),
      }),
    );
  }

  private evaluatePromotionEligibility(input: {
    request: ConfigurationPromotionRequest;
    source: ConfigurationVersion;
    destinationState: ConfigurationEnvironmentState | undefined;
    policy: ReturnType<ConfigurationPromotionPolicyRegistry["all"]>[number];
    policyFingerprint: ConfigurationFingerprint;
    destinationBaseline: ConfigurationResult<ConfigurationVersion> | undefined;
    validationReport: ReturnType<typeof validateConfigurationSnapshot>;
    capabilitySnapshot?: CapabilitySnapshot;
    nonPromotableBlocked: boolean;
    destinationLocalPreserved: boolean;
    promotionDecisionCount: number;
  }): ConfigurationPromotionEligibility {
    const blockers: ConfigurationReleaseBlocker[] = [];
    const warnings: ConfigurationReleaseWarning[] = [];
    const reasonCodes: ConfigurationPromotionReasonCode[] = ["PROMOTION_POLICY_OF_RECORD"];
    const graph = this.input.promotionGraph ?? new ConfigurationPromotionGraph();
    const transitionAllowed = graph.allows(
      input.request.sourceEnvironment,
      input.request.destinationEnvironment,
      input.policy.allowSameEnvironmentRelease,
    );
    if (transitionAllowed) {
      reasonCodes.push(
        input.request.sourceEnvironment === input.request.destinationEnvironment
          ? "SAME_ENVIRONMENT_RELEASE"
          : "TRANSITION_ALLOWED",
      );
    } else {
      blockers.push({
        code: "TRANSITION_NOT_ALLOWED",
        message: "promotion transition is not allowed",
      });
      reasonCodes.push("TRANSITION_NOT_ALLOWED");
    }
    const sourceIntegrity = this.input.versionRepository.verifyIntegrity(input.source.versionId);
    const sourceIntegrityOk = sourceIntegrity.ok && sourceIntegrity.value.ok;
    reasonCodes.push(sourceIntegrityOk ? "SOURCE_INTEGRITY_VERIFIED" : "SOURCE_INTEGRITY_FAILED");
    if (!sourceIntegrityOk) {
      blockers.push({
        code: "SOURCE_INTEGRITY_FAILED",
        message: "source version integrity failed",
      });
      this.integrityFailures += 1;
    }
    const destinationBaselineCurrent =
      input.destinationState?.activeVersionId === input.request.destinationBaselineVersionId;
    reasonCodes.push(
      destinationBaselineCurrent ? "DESTINATION_BASELINE_CURRENT" : "DESTINATION_DRIFTED",
    );
    if (!destinationBaselineCurrent) {
      blockers.push({
        code: "DESTINATION_DRIFTED",
        message: "destination active baseline changed",
      });
    }
    const schemaCompatible =
      input.policy.allowSchemaFingerprintChange ||
      input.source.schemaFingerprint === this.input.schemaRegistry.fingerprint();
    reasonCodes.push(
      schemaCompatible ? "DESTINATION_SCHEMA_COMPATIBLE" : "DESTINATION_SCHEMA_INCOMPATIBLE",
    );
    if (!schemaCompatible) {
      blockers.push({
        code: "DESTINATION_SCHEMA_INCOMPATIBLE",
        message: "destination schema fingerprint is incompatible with promotion policy",
      });
    }
    const destinationValidationPassed = input.validationReport.publicationAllowed;
    reasonCodes.push(
      destinationValidationPassed
        ? "DESTINATION_VALIDATION_PASSED"
        : "DESTINATION_VALIDATION_FAILED",
      "DESTINATION_EFFECTIVE_CONFIGURATION_VALIDATED",
    );
    if (!destinationValidationPassed) {
      blockers.push({
        code: "DESTINATION_VALIDATION_FAILED",
        message: "resulting destination effective configuration failed validation",
      });
    }
    if (input.nonPromotableBlocked) {
      reasonCodes.push("NON_PROMOTABLE_CONFIGURATION");
      blockers.push({
        code: "NON_PROMOTABLE_CONFIGURATION",
        message: "source changes include configuration marked non-promotable",
      });
    }
    if (input.destinationLocalPreserved) {
      reasonCodes.push("DESTINATION_LOCAL_OVERRIDE_PRESERVED");
    }
    const capabilityEligible =
      input.capabilitySnapshot === undefined ||
      input.capabilitySnapshot.capabilities
        .filter((capability) => capability.requested)
        .every(
          (capability) => capability.state !== "UNAVAILABLE" && capability.state !== "BLOCKED",
        );
    reasonCodes.push(capabilityEligible ? "CAPABILITY_ELIGIBLE" : "CAPABILITY_BLOCKED");
    if (!capabilityEligible) {
      blockers.push({
        code: "CAPABILITY_BLOCKED",
        message: "destination capability evaluation blocked requested capability",
      });
    }
    const approvalEligible = this.approvalEligible(input);
    reasonCodes.push(...approvalEligible.reasonCodes);
    blockers.push(...approvalEligible.blockers);
    const restart = restartRequirement(input.capabilitySnapshot);
    if (restart === "RESTART_REQUIRED") {
      reasonCodes.push("RESTART_REQUIRED");
      warnings.push({
        code: "RESTART_REQUIRED",
        message: "promotion activates a release with pending restart state",
      });
      if (!input.policy.allowRestartRequiredActivation) {
        blockers.push({
          code: "RESTART_REQUIRED",
          message: "promotion policy does not allow restart-required activation",
        });
      }
    }
    const eligible = blockers.length === 0;
    if (eligible) {
      reasonCodes.push("PROMOTION_ELIGIBLE", "PROMOTION_PLAN_CURRENT");
    }
    return freeze({
      eligible,
      evaluatedAt: this.input.clock.now(),
      status: eligible ? "READY" : destinationBaselineCurrent ? "BLOCKED" : "STALE",
      reasonCodes: unique(reasonCodes),
      blockers,
      warnings,
      sourceIntegrityOk,
      transitionAllowed,
      destinationBaselineCurrent,
      schemaCompatible,
      destinationValidationPassed,
      capabilityEligible,
      approvalEligible: approvalEligible.ok,
      restartRequirement: restart,
      policyId: input.policy.policyId,
      policyFingerprint: input.policyFingerprint,
    });
  }

  private approvalEligible(input: {
    request: ConfigurationPromotionRequest;
    source: ConfigurationVersion;
    policy: ReturnType<ConfigurationPromotionPolicyRegistry["all"]>[number];
    promotionDecisionCount: number;
  }): {
    ok: boolean;
    reasonCodes: ConfigurationPromotionReasonCode[];
    blockers: ConfigurationReleaseBlocker[];
  } {
    if (input.policy.approvalRequirement === "NONE") {
      return { ok: true, reasonCodes: ["APPROVAL_NOT_REQUIRED"], blockers: [] };
    }
    if (input.policy.approvalRequirement === "PROMOTION_APPROVAL") {
      const ok = input.promotionDecisionCount >= input.policy.requiredPromotionApprovalCount;
      return {
        ok,
        reasonCodes: ok ? ["PROMOTION_APPROVAL_SATISFIED"] : ["PROMOTION_APPROVAL_REQUIRED"],
        blockers: ok
          ? []
          : [
              {
                code: "APPROVAL_NOT_SATISFIED",
                message: "promotion checker approval is required by destination policy",
              },
            ],
      };
    }
    const approval = this.input.approvalService?.isApprovalSatisfied(input.source);
    const ok = approval?.ok === true && approval.value.eligible;
    return {
      ok,
      reasonCodes: ok ? ["APPROVAL_SATISFIED"] : ["APPROVAL_REQUIRED", "APPROVAL_NOT_SATISFIED"],
      blockers: ok
        ? []
        : [
            {
              code: "APPROVAL_NOT_SATISFIED",
              message: "source version approval is required by destination policy",
            },
          ],
    };
  }

  private composeDestinationSnapshot(
    source: ConfigurationVersion,
    destination: ConfigurationVersion | undefined,
    destinationEnvironment: ConfigurationEnvironment,
  ): {
    snapshot: ConfigurationSnapshot;
    nonPromotableBlocked: boolean;
    destinationLocalPreserved: boolean;
  } {
    const sourceSnapshot = snapshotFromVersionContent(source, this.input.clock);
    const destinationSnapshot =
      destination === undefined
        ? undefined
        : snapshotFromVersionContent(destination, this.input.clock);
    const destinationLocalKeys = new Set(
      this.input.schemaRegistry
        .all()
        .filter((schema) => schema.metadata?.releaseScope === "DESTINATION_LOCAL")
        .map((schema) => schema.key),
    );
    const nonPromotableKeys = new Set(
      this.input.schemaRegistry
        .all()
        .filter((schema) => schema.metadata?.releaseScope === "NON_PROMOTABLE")
        .map((schema) => schema.key),
    );
    const nonPromotableBlocked = source.changeSet.operations.some((operation) =>
      nonPromotableKeys.has(operation.key),
    );
    const existingDestinationLocalEntries = (
      destinationSnapshot?.entries.filter((entry) => destinationLocalKeys.has(entry.key)) ?? []
    ).map((entry) => destinationLocalEntry(entry, destinationEnvironment));
    const destinationLocalEntries =
      existingDestinationLocalEntries.length > 0
        ? existingDestinationLocalEntries
        : sourceSnapshot.entries
            .filter((entry) => destinationLocalKeys.has(entry.key))
            .map((entry) => destinationLocalEntry(entry, destinationEnvironment));
    const sourceEntries = sourceSnapshot.entries.filter(
      (entry) => !destinationLocalKeys.has(entry.key),
    );
    const entries = [...sourceEntries, ...destinationLocalEntries].sort((left, right) =>
      `${left.key}|${left.scope.scopeType}|${left.scope.scopeId ?? ""}`.localeCompare(
        `${right.key}|${right.scope.scopeType}|${right.scope.scopeId ?? ""}`,
      ),
    );
    const snapshotFingerprint = fingerprint({
      registryFingerprint: sourceSnapshot.registryFingerprint,
      sourceVersionId: source.versionId,
      destinationVersionId: destination?.versionId,
      entries,
    });
    return {
      snapshot: freeze({
        snapshotId:
          `cfgsnap-${snapshotFingerprint.replace("sha256:", "").slice(0, 24)}` as ConfigurationSnapshot["snapshotId"],
        fingerprint: snapshotFingerprint,
        createdAt: this.input.clock.now(),
        registryFingerprint: sourceSnapshot.registryFingerprint,
        sourceFingerprints: sourceSnapshot.sourceFingerprints,
        sourceHealth: sourceSnapshot.sourceHealth,
        entries,
        conflicts: [],
      }),
      nonPromotableBlocked,
      destinationLocalPreserved: destinationLocalEntries.length > 0,
    };
  }

  private validateDestinationSnapshot(
    snapshot: ConfigurationSnapshot,
    environment: ConfigurationEnvironment,
  ) {
    const snapshotReport = validateConfigurationSnapshot({
      schemaRegistry: this.input.schemaRegistry,
      snapshot,
      clock: this.input.clock,
    });
    const effective = new ConfigurationResolver(
      this.input.registry,
      snapshot,
      this.input.clock,
    ).resolve({ runtimeMode: environment });
    if (!effective.ok) {
      return combineValidationReports({
        clock: this.input.clock,
        schemaFingerprint: this.input.schemaRegistry.fingerprint(),
        reports: [snapshotReport],
        snapshotId: snapshot.snapshotId,
      });
    }
    return combineValidationReports({
      clock: this.input.clock,
      schemaFingerprint: this.input.schemaRegistry.fingerprint(),
      reports: [
        snapshotReport,
        validateEffectiveConfiguration({
          schemaRegistry: this.input.schemaRegistry,
          effective: effective.value,
          clock: this.input.clock,
        }),
      ],
      snapshotId: snapshot.snapshotId,
      context: effective.value.context,
    });
  }

  private evaluateDestinationCapabilities(
    snapshot: ConfigurationSnapshot,
    environment: ConfigurationEnvironment,
    versionId: ConfigurationVersion["versionId"],
    schemaFingerprint: ConfigurationFingerprint,
    baselineVersion?: ConfigurationVersion,
  ): ConfigurationResult<CapabilitySnapshot | undefined> {
    if (
      this.input.capabilityRegistry === undefined ||
      this.input.featureFlagRegistry === undefined
    ) {
      return ok(undefined);
    }
    const effective = new ConfigurationResolver(
      this.input.registry,
      snapshot,
      this.input.clock,
    ).resolve({ runtimeMode: environment });
    if (!effective.ok) {
      return effective;
    }
    const appliedFeatureFlags = this.appliedFeatureFlags(environment, baselineVersion);
    return evaluateCapabilities({
      capabilityRegistry: this.input.capabilityRegistry,
      featureFlagRegistry: this.input.featureFlagRegistry,
      evaluation: {
        runtimeMode: environment,
        effectiveConfiguration: {
          snapshotId: snapshot.snapshotId,
          fingerprint: effective.value.fingerprint,
          values: effective.value.values,
        },
        now: this.input.clock.now(),
        configurationVersionId: versionId,
        schemaFingerprint,
        ...(appliedFeatureFlags === undefined ? {} : { appliedFeatureFlags }),
      },
    });
  }

  private appliedFeatureFlags(
    environment: ConfigurationEnvironment,
    baselineVersion: ConfigurationVersion | undefined,
  ): Readonly<Record<string, boolean>> | undefined {
    if (baselineVersion === undefined || this.input.featureFlagRegistry === undefined) {
      return undefined;
    }
    const snapshot = snapshotFromVersionContent(baselineVersion, this.input.clock);
    const effective = new ConfigurationResolver(
      this.input.registry,
      snapshot,
      this.input.clock,
    ).resolve({ runtimeMode: environment });
    if (!effective.ok) {
      return undefined;
    }
    return Object.fromEntries(
      this.input.featureFlagRegistry.all().flatMap((flag) => {
        const value = effective.value.values.get(flag.key)?.value;
        return typeof value === "boolean" ? [[flag.flagId, value]] : [];
      }),
    );
  }

  private buildRollbackPlan(
    request: ConfigurationRollbackRequest,
    actor: Actor,
    metadata: {
      correlationId?: ConfigurationRollbackPlan["correlationId"];
      causationId?: ConfigurationRollbackPlan["causationId"];
      idempotencyKey?: string;
    },
  ): ConfigurationResult<ConfigurationRollbackPlan> {
    const current = this.input.versionRepository.get(request.currentVersionId);
    const target = this.input.versionRepository.get(request.targetVersionId);
    if (!target.ok) {
      return fail({ ...target.error, code: "ROLLBACK_TARGET_NOT_FOUND" });
    }
    const policy = this.input.policyRegistry.require(request.policyId);
    if (!policy.ok) {
      return policy;
    }
    const currentVersion = current.ok ? current.value : undefined;
    const composition = this.composeDestinationSnapshot(
      target.value,
      currentVersion,
      request.environment,
    );
    const snapshot = composition.snapshot;
    const validationReport = this.validateDestinationSnapshot(snapshot, request.environment);
    const capabilitySnapshot = this.evaluateDestinationCapabilities(
      snapshot,
      request.environment,
      target.value.versionId,
      target.value.schemaFingerprint,
    );
    const capability = capabilitySnapshot.ok ? capabilitySnapshot.value : undefined;
    const knownGood = this.input.releaseRepository
      .knownGoodForEnvironment(request.environment)
      .some((candidate) => candidate.versionId === target.value.versionId);
    const state = this.input.releaseRepository.environmentState(request.environment);
    const targetIntegrity = this.input.versionRepository.verifyIntegrity(target.value.versionId);
    const blockers: ConfigurationReleaseBlocker[] = [];
    const reasonCodes: ConfigurationRollbackReasonCode[] = [];
    const targetExists = target.ok;
    reasonCodes.push(targetExists ? "ROLLBACK_TARGET_FOUND" : "ROLLBACK_TARGET_NOT_FOUND");
    reasonCodes.push(knownGood ? "ROLLBACK_TARGET_KNOWN_GOOD" : "ROLLBACK_TARGET_NOT_KNOWN_GOOD");
    if (!knownGood) {
      blockers.push({
        code: "ROLLBACK_TARGET_NOT_KNOWN_GOOD",
        message: "rollback target is not recorded as known-good",
      });
    }
    const targetIntegrityOk = targetIntegrity.ok && targetIntegrity.value.ok;
    reasonCodes.push(
      targetIntegrityOk ? "ROLLBACK_TARGET_INTEGRITY_VERIFIED" : "ROLLBACK_TARGET_INVALID",
    );
    if (!targetIntegrityOk) {
      blockers.push({
        code: "ROLLBACK_TARGET_INVALID",
        message: "rollback target integrity failed",
      });
    }
    const validationPassed = validationReport.publicationAllowed;
    reasonCodes.push(
      validationPassed ? "ROLLBACK_VALIDATION_PASSED" : "ROLLBACK_VALIDATION_FAILED",
    );
    if (!validationPassed) {
      blockers.push({
        code: "ROLLBACK_VALIDATION_FAILED",
        message: "rollback target no longer validates for destination",
      });
    }
    const planCurrent = state?.activeVersionId === request.currentVersionId;
    reasonCodes.push(planCurrent ? "ROLLBACK_PLAN_CURRENT" : "ROLLBACK_PLAN_STALE");
    if (!planCurrent) {
      blockers.push({ code: "ROLLBACK_PLAN_STALE", message: "rollback current baseline drifted" });
    }
    const approvalEligible = !policy.value.rollbackRequiresApproval;
    reasonCodes.push(
      approvalEligible ? "ROLLBACK_APPROVAL_NOT_REQUIRED" : "ROLLBACK_APPROVAL_REQUIRED",
    );
    if (!approvalEligible) {
      blockers.push({
        code: "ROLLBACK_APPROVAL_REQUIRED",
        message: "rollback approval is required by destination policy",
      });
    }
    const restart = restartRequirement(capability);
    if (restart === "RESTART_REQUIRED") {
      reasonCodes.push("RESTART_REQUIRED");
    }
    const eligibility: ConfigurationRollbackEligibility = freeze({
      eligible: blockers.length === 0,
      evaluatedAt: this.input.clock.now(),
      status: blockers.length === 0 ? "READY" : planCurrent ? "BLOCKED" : "STALE",
      reasonCodes: unique(reasonCodes),
      blockers,
      warnings:
        restart === "RESTART_REQUIRED"
          ? [{ code: "RESTART_REQUIRED", message: "rollback target requires restart" }]
          : [],
      targetExists,
      targetKnownGood: knownGood,
      targetIntegrityOk,
      schemaCompatible: true,
      validationPassed,
      approvalEligible,
      restartRequirement: restart,
      policyId: policy.value.policyId,
      policyFingerprint: promotionPolicyFingerprint(policy.value),
    });
    const safeDiff = current.ok
      ? diffConfigurationVersions(current.value, target.value)
      : diffConfigurationVersions(target.value, target.value);
    const planFingerprint = fingerprint({
      requestId: request.requestId,
      targetVersionId: target.value.versionId,
      currentVersionId: request.currentVersionId,
      validationFingerprint: validationReport.fingerprint,
      eligibility,
      idempotencyKey: metadata.idempotencyKey,
    });
    return ok(
      freeze({
        planId: rollbackPlanId(planFingerprint),
        requestId: request.requestId,
        environment: request.environment,
        currentVersionId: request.currentVersionId,
        targetVersionId: target.value.versionId,
        resultingVersionId: target.value.versionId,
        resultingConfigurationFingerprint: snapshot.fingerprint,
        resultingSchemaFingerprint: this.input.schemaRegistry.fingerprint(),
        plannedAt: this.input.clock.now(),
        plannedBy: actor,
        safeDiff,
        validationReport,
        ...(capability === undefined ? {} : { capabilitySnapshot: capability }),
        restartRequirement: restart,
        policyId: policy.value.policyId,
        policyFingerprint: promotionPolicyFingerprint(policy.value),
        eligibility,
        planFingerprint,
        ...(metadata.correlationId === undefined ? {} : { correlationId: metadata.correlationId }),
        ...(metadata.causationId === undefined ? {} : { causationId: metadata.causationId }),
        ...(metadata.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: metadata.idempotencyKey }),
      }),
    );
  }

  private activationFromPromotion(
    plan: ConfigurationPromotionPlan,
    actor: Actor,
    input: ExecutePromotionInput,
  ): ConfigurationActivationRecord {
    const activationFingerprint = fingerprint({
      planId: plan.planId,
      operation: "PROMOTION",
      resultingVersionId: plan.resultingVersionId,
      resultingConfigurationFingerprint: plan.resultingConfigurationFingerprint,
      actor,
      idempotencyKey: input.idempotencyKey,
    });
    return freeze({
      activationId: activationId(activationFingerprint),
      operation: "PROMOTION",
      promotionRequestId: plan.requestId,
      promotionPlanId: plan.planId,
      sourceVersionId: plan.sourceVersionId,
      destinationEnvironment: plan.destinationEnvironment,
      ...(plan.destinationBaselineVersionId === undefined
        ? {}
        : { previousVersionId: plan.destinationBaselineVersionId }),
      resultingVersionId: plan.resultingVersionId,
      ...(plan.destinationBaselineFingerprint === undefined
        ? {}
        : { expectedPreviousFingerprint: plan.destinationBaselineFingerprint }),
      resultingConfigurationFingerprint: plan.resultingConfigurationFingerprint,
      resultingSchemaFingerprint: plan.resultingSchemaFingerprint,
      activatedBy: actor,
      policyId: plan.policyId,
      policyFingerprint: plan.policyFingerprint,
      approvalEvidenceIds: [
        ...(plan.approvalEvidenceRequestId === undefined ? [] : [plan.approvalEvidenceRequestId]),
        ...plan.promotionDecisionIds,
      ],
      activatedAt: this.input.clock.now(),
      result: "SUCCEEDED",
      restartRequirement: plan.restartRequirement,
      safeMessage: "configuration promotion activated",
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
      ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
      activationFingerprint,
    });
  }

  private activationFromRollback(
    plan: ConfigurationRollbackPlan,
    actor: Actor,
    input: ExecuteRollbackInput,
  ): ConfigurationActivationRecord {
    const activationFingerprint = fingerprint({
      planId: plan.planId,
      operation: "ROLLBACK",
      resultingVersionId: plan.resultingVersionId,
      actor,
      idempotencyKey: input.idempotencyKey,
    });
    return freeze({
      activationId: activationId(activationFingerprint),
      operation: "ROLLBACK",
      rollbackRequestId: plan.requestId,
      rollbackPlanId: plan.planId,
      sourceVersionId: plan.targetVersionId,
      destinationEnvironment: plan.environment,
      previousVersionId: plan.currentVersionId,
      resultingVersionId: plan.resultingVersionId,
      resultingConfigurationFingerprint: plan.resultingConfigurationFingerprint,
      resultingSchemaFingerprint: plan.resultingSchemaFingerprint,
      activatedBy: actor,
      policyId: plan.policyId,
      policyFingerprint: plan.policyFingerprint,
      approvalEvidenceIds: [],
      activatedAt: this.input.clock.now(),
      result: "SUCCEEDED",
      restartRequirement: plan.restartRequirement,
      safeMessage: "configuration rollback restored known-good target",
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
      ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
      activationFingerprint,
    });
  }

  private recordKnownGoodFromActivation(activation: ConfigurationActivationRecord): void {
    const knownGoodFingerprint = fingerprint({
      activationId: activation.activationId,
      versionId: activation.resultingVersionId,
      fingerprint: activation.resultingConfigurationFingerprint,
      verifiedAt: this.input.clock.now(),
    });
    const knownGood: KnownGoodConfiguration = freeze({
      knownGoodId: knownGoodId(knownGoodFingerprint),
      environment: activation.destinationEnvironment,
      versionId: activation.resultingVersionId,
      configurationFingerprint: activation.resultingConfigurationFingerprint,
      schemaFingerprint: activation.resultingSchemaFingerprint,
      activationId: activation.activationId,
      verifiedAt: this.input.clock.now(),
      verificationResult:
        activation.restartRequirement === "RESTART_REQUIRED"
          ? "VERIFIED_WITH_PENDING_RESTART"
          : "VERIFIED",
      policyId: activation.policyId,
      policyFingerprint: activation.policyFingerprint,
      knownGoodFingerprint,
    });
    this.input.releaseRepository.recordKnownGood(knownGood);
  }

  private failedPromotionExecution(
    plan: ConfigurationPromotionPlan,
    actor: Actor,
    input: ExecutePromotionInput,
    message: string,
  ) {
    const executionFingerprint = fingerprint({
      planId: plan.planId,
      actor,
      result: "FAILED",
      message,
      idempotencyKey: input.idempotencyKey,
    });
    const execution = freeze({
      executionId: promotionExecutionId(executionFingerprint),
      requestId: plan.requestId,
      planId: plan.planId,
      executedBy: actor,
      executedAt: this.input.clock.now(),
      result: "FAILED" as const,
      status: "FAILED" as const,
      reasonCodes: ["PROMOTION_STALE"] as const,
      safeMessage: message,
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
      ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
      executionFingerprint,
    });
    return this.input.releaseRepository.appendPromotionExecution(execution);
  }

  private failedRollbackExecution(
    plan: ConfigurationRollbackPlan,
    actor: Actor,
    input: ExecuteRollbackInput,
    message: string,
  ) {
    const executionFingerprint = fingerprint({
      planId: plan.planId,
      actor,
      result: "FAILED",
      message,
      idempotencyKey: input.idempotencyKey,
    });
    const execution = freeze({
      executionId: rollbackExecutionId(executionFingerprint),
      requestId: plan.requestId,
      planId: plan.planId,
      executedBy: actor,
      executedAt: this.input.clock.now(),
      result: "FAILED" as const,
      status: "FAILED" as const,
      reasonCodes: ["ROLLBACK_PLAN_STALE"] as const,
      safeMessage: message,
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
      ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
      executionFingerprint,
    });
    return this.input.releaseRepository.appendRollbackExecution(execution);
  }

  private createManagedService(): RuntimeManagedService {
    return {
      descriptor: serviceDescriptor({
        serviceId: configurationReleaseServiceId,
        name: "ATE Configuration Release Authority",
        version: "0.12.0-config-promotion.1",
        description:
          "Controlled configuration promotion, activation, active release state, known-good and rollback authority.",
        criticality: "CRITICAL",
        dependencies: [
          configurationVersionServiceId,
          capabilityServiceId,
          configurationApprovalServiceId,
        ],
        supportedModes: ["DEVELOPMENT", "RESEARCH", "BACKTEST", "SIMULATION", "PAPER", "LIVE"],
        capabilities: ["CONFIGURATION_PROMOTION", "CONFIGURATION_ROLLBACK"],
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

export const createConfigurationReleaseService = (
  input: ConfigurationReleaseServiceInput,
): ConfigurationReleaseService => new ConfigurationReleaseService(input);

const validateReason = (reason: string, clock: Clock) => {
  if (reason.trim().length === 0 || reason.length > 500 || /[\r\n]/u.test(reason)) {
    return configurationError({
      code: "PROMOTION_REASON_REQUIRED",
      message: "release reason must be 1-500 characters without line breaks",
      timestamp: clock.now(),
    });
  }
  return undefined;
};

const stableActorId = (actor: Actor): ActorId | undefined => actor.actorId;

const destinationLocalEntry = (
  entry: ConfigurationEntry,
  destinationEnvironment: ConfigurationEnvironment,
): ConfigurationEntry =>
  freeze({
    ...entry,
    ...(entry.key === "system.runtimeMode"
      ? { value: destinationEnvironment }
      : entry.value === undefined
        ? {}
        : { value: entry.value }),
  } satisfies ConfigurationEntry);

const restartRequirement = (snapshot: CapabilitySnapshot | undefined): RestartRequirement =>
  snapshot?.capabilities.some((capability) => capability.pendingRestart)
    ? "RESTART_REQUIRED"
    : "DYNAMIC_ONLY";

const unique = <T>(values: readonly T[]): readonly T[] => freeze([...new Set(values)]);
