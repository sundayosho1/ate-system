import type { Clock } from "@ate/time";

import { freeze } from "./context.js";
import { configurationError, fail, ok } from "./errors.js";
import { fingerprint } from "./serialization.js";
import type { ConfigurationResult } from "./types.js";
import type { ConfigurationVersionId } from "./version-types.js";
import type {
  ConfigurationActivationRecord,
  ConfigurationActivationId,
  ConfigurationEnvironment,
  ConfigurationEnvironmentState,
  ConfigurationPromotionDecision,
  ConfigurationPromotionDecisionId,
  ConfigurationPromotionExecution,
  ConfigurationPromotionExecutionId,
  ConfigurationPromotionPlan,
  ConfigurationPromotionPlanId,
  ConfigurationPromotionRequest,
  ConfigurationPromotionRequestId,
  ConfigurationReleaseRepository,
  ConfigurationRollbackExecution,
  ConfigurationRollbackExecutionId,
  ConfigurationRollbackPlan,
  ConfigurationRollbackPlanId,
  ConfigurationRollbackRequest,
  ConfigurationRollbackRequestId,
  KnownGoodConfiguration,
  KnownGoodConfigurationId,
} from "./release-types.js";

export type MutableConfigurationReleaseStore = {
  promotionRequests: Map<string, ConfigurationPromotionRequest>;
  promotionPlans: Map<string, ConfigurationPromotionPlan>;
  promotionDecisions: Map<string, ConfigurationPromotionDecision>;
  promotionExecutions: Map<string, ConfigurationPromotionExecution>;
  rollbackRequests: Map<string, ConfigurationRollbackRequest>;
  rollbackPlans: Map<string, ConfigurationRollbackPlan>;
  rollbackExecutions: Map<string, ConfigurationRollbackExecution>;
  activations: Map<string, ConfigurationActivationRecord>;
  environmentStates: Map<string, ConfigurationEnvironmentState>;
  knownGood: Map<string, KnownGoodConfiguration>;
  idempotency: Map<string, string>;
};

export const createEmptyConfigurationReleaseStore = (): MutableConfigurationReleaseStore => ({
  promotionRequests: new Map(),
  promotionPlans: new Map(),
  promotionDecisions: new Map(),
  promotionExecutions: new Map(),
  rollbackRequests: new Map(),
  rollbackPlans: new Map(),
  rollbackExecutions: new Map(),
  activations: new Map(),
  environmentStates: new Map(),
  knownGood: new Map(),
  idempotency: new Map(),
});

export class InMemoryConfigurationReleaseRepository implements ConfigurationReleaseRepository {
  public constructor(
    private readonly input: {
      clock: Clock;
      store: MutableConfigurationReleaseStore;
      maxPageSize?: number;
    },
  ) {}

  public appendPromotionRequest(
    request: ConfigurationPromotionRequest,
  ): ConfigurationResult<ConfigurationPromotionRequest> {
    const existing = this.idempotent(request.idempotencyKey, request.requestFingerprint);
    if (!existing.ok) {
      return existing;
    }
    if (existing.value !== undefined) {
      return this.getPromotionRequest(existing.value as ConfigurationPromotionRequestId);
    }
    return this.appendUnique(
      this.input.store.promotionRequests,
      request.requestId,
      request,
      "PROMOTION_REQUEST_ALREADY_EXISTS",
      request.idempotencyKey,
      request.requestFingerprint,
    );
  }

  public appendPromotionPlan(
    plan: ConfigurationPromotionPlan,
  ): ConfigurationResult<ConfigurationPromotionPlan> {
    const existing = this.idempotent(plan.idempotencyKey, plan.planFingerprint);
    if (!existing.ok) {
      return existing;
    }
    if (existing.value !== undefined) {
      return this.getPromotionPlan(existing.value as ConfigurationPromotionPlanId);
    }
    return this.appendUnique(
      this.input.store.promotionPlans,
      plan.planId,
      plan,
      "PROMOTION_PLAN_ALREADY_EXISTS",
      plan.idempotencyKey,
      plan.planFingerprint,
    );
  }

  public appendPromotionDecision(
    decision: ConfigurationPromotionDecision,
  ): ConfigurationResult<ConfigurationPromotionDecision> {
    const existing = this.idempotent(decision.idempotencyKey, decision.decisionFingerprint);
    if (!existing.ok) {
      return existing;
    }
    if (existing.value !== undefined) {
      const stored = this.input.store.promotionDecisions.get(existing.value);
      return stored === undefined
        ? this.notFound("promotion decision", existing.value)
        : ok(freeze(structuredClone(stored)));
    }
    return this.appendUnique(
      this.input.store.promotionDecisions,
      decision.decisionId,
      decision,
      "PROMOTION_DECISION_CONFLICT",
      decision.idempotencyKey,
      decision.decisionFingerprint,
    );
  }

  public appendPromotionExecution(
    execution: ConfigurationPromotionExecution,
  ): ConfigurationResult<ConfigurationPromotionExecution> {
    const existing = this.idempotent(execution.idempotencyKey, execution.executionFingerprint);
    if (!existing.ok) {
      return existing;
    }
    if (existing.value !== undefined) {
      const stored = this.input.store.promotionExecutions.get(existing.value);
      return stored === undefined
        ? this.notFound("promotion execution", existing.value)
        : ok(freeze(structuredClone(stored)));
    }
    return this.appendUnique(
      this.input.store.promotionExecutions,
      execution.executionId,
      execution,
      "PROMOTION_ALREADY_EXECUTED",
      execution.idempotencyKey,
      execution.executionFingerprint,
    );
  }

  public appendRollbackRequest(
    request: ConfigurationRollbackRequest,
  ): ConfigurationResult<ConfigurationRollbackRequest> {
    const existing = this.idempotent(request.idempotencyKey, request.requestFingerprint);
    if (!existing.ok) {
      return existing;
    }
    if (existing.value !== undefined) {
      return this.getRollbackRequest(existing.value as ConfigurationRollbackRequestId);
    }
    return this.appendUnique(
      this.input.store.rollbackRequests,
      request.requestId,
      request,
      "ROLLBACK_REQUEST_ALREADY_EXISTS",
      request.idempotencyKey,
      request.requestFingerprint,
    );
  }

  public appendRollbackPlan(
    plan: ConfigurationRollbackPlan,
  ): ConfigurationResult<ConfigurationRollbackPlan> {
    const existing = this.idempotent(plan.idempotencyKey, plan.planFingerprint);
    if (!existing.ok) {
      return existing;
    }
    if (existing.value !== undefined) {
      return this.getRollbackPlan(existing.value as ConfigurationRollbackPlanId);
    }
    return this.appendUnique(
      this.input.store.rollbackPlans,
      plan.planId,
      plan,
      "ROLLBACK_PLAN_ALREADY_EXISTS",
      plan.idempotencyKey,
      plan.planFingerprint,
    );
  }

  public appendRollbackExecution(
    execution: ConfigurationRollbackExecution,
  ): ConfigurationResult<ConfigurationRollbackExecution> {
    const existing = this.idempotent(execution.idempotencyKey, execution.executionFingerprint);
    if (!existing.ok) {
      return existing;
    }
    if (existing.value !== undefined) {
      const stored = this.input.store.rollbackExecutions.get(existing.value);
      return stored === undefined
        ? this.notFound("rollback execution", existing.value)
        : ok(freeze(structuredClone(stored)));
    }
    return this.appendUnique(
      this.input.store.rollbackExecutions,
      execution.executionId,
      execution,
      "ROLLBACK_EXECUTION_FAILED",
      execution.idempotencyKey,
      execution.executionFingerprint,
    );
  }

  public appendActivation(
    activation: ConfigurationActivationRecord,
    expectedActiveVersionId?: ConfigurationVersionId,
  ): ConfigurationResult<ConfigurationActivationRecord> {
    const existing = this.idempotent(activation.idempotencyKey, activation.activationFingerprint);
    if (!existing.ok) {
      return existing;
    }
    if (existing.value !== undefined) {
      const stored = this.input.store.activations.get(existing.value);
      return stored === undefined
        ? this.notFound("activation", existing.value)
        : ok(freeze(structuredClone(stored)));
    }
    const current = this.input.store.environmentStates.get(activation.destinationEnvironment);
    if (current?.activeVersionId !== expectedActiveVersionId) {
      return fail(
        configurationError({
          code: "PROMOTION_CONCURRENCY_CONFLICT",
          message: "active configuration changed before activation could commit",
          timestamp: this.input.clock.now(),
          details: {
            expectedActiveVersionId,
            actualActiveVersionId: current?.activeVersionId,
          },
        }),
      );
    }
    if (this.input.store.activations.has(activation.activationId)) {
      return fail(
        configurationError({
          code: "PROMOTION_ACTIVATION_FAILED",
          message: `activation already exists: ${activation.activationId}`,
          timestamp: this.input.clock.now(),
        }),
      );
    }
    this.input.store.activations.set(activation.activationId, freeze(structuredClone(activation)));
    if (activation.idempotencyKey !== undefined) {
      this.input.store.idempotency.set(
        activation.idempotencyKey,
        `${activation.activationFingerprint}|${activation.activationId}`,
      );
    }
    const state = environmentStateFromActivation(activation, current);
    this.input.store.environmentStates.set(activation.destinationEnvironment, state);
    return ok(activation);
  }

  public recordKnownGood(
    knownGood: KnownGoodConfiguration,
  ): ConfigurationResult<KnownGoodConfiguration> {
    return this.appendUnique(
      this.input.store.knownGood,
      knownGood.knownGoodId,
      knownGood,
      "PROMOTION_VERIFICATION_FAILED",
    );
  }

  public getPromotionRequest(
    requestId: ConfigurationPromotionRequestId,
  ): ConfigurationResult<ConfigurationPromotionRequest> {
    const request = this.input.store.promotionRequests.get(requestId);
    return request === undefined
      ? this.notFound("promotion request", requestId)
      : ok(freeze(structuredClone(request)));
  }

  public getPromotionPlan(
    planId: ConfigurationPromotionPlanId,
  ): ConfigurationResult<ConfigurationPromotionPlan> {
    const plan = this.input.store.promotionPlans.get(planId);
    return plan === undefined
      ? this.notFound("promotion plan", planId)
      : ok(freeze(structuredClone(plan)));
  }

  public getRollbackRequest(
    requestId: ConfigurationRollbackRequestId,
  ): ConfigurationResult<ConfigurationRollbackRequest> {
    const request = this.input.store.rollbackRequests.get(requestId);
    return request === undefined
      ? this.notFound("rollback request", requestId)
      : ok(freeze(structuredClone(request)));
  }

  public getRollbackPlan(
    planId: ConfigurationRollbackPlanId,
  ): ConfigurationResult<ConfigurationRollbackPlan> {
    const plan = this.input.store.rollbackPlans.get(planId);
    return plan === undefined
      ? this.notFound("rollback plan", planId)
      : ok(freeze(structuredClone(plan)));
  }

  public environmentState(
    environment: ConfigurationEnvironment,
  ): ConfigurationEnvironmentState | undefined {
    const state = this.input.store.environmentStates.get(environment);
    return state === undefined ? undefined : freeze(structuredClone(state));
  }

  public knownGoodForEnvironment(
    environment: ConfigurationEnvironment,
  ): readonly KnownGoodConfiguration[] {
    return freeze(
      [...this.input.store.knownGood.values()]
        .filter((candidate) => candidate.environment === environment)
        .sort((left, right) => left.verifiedAt.localeCompare(right.verifiedAt))
        .map((candidate) => structuredClone(candidate)),
    );
  }

  public promotionDecisionsByRequest(
    requestId: ConfigurationPromotionRequestId,
  ): readonly ConfigurationPromotionDecision[] {
    return freeze(
      [...this.input.store.promotionDecisions.values()]
        .filter((decision) => decision.requestId === requestId)
        .sort((left, right) => left.decidedAt.localeCompare(right.decidedAt))
        .map((decision) => structuredClone(decision)),
    );
  }

  public activationHistory(
    environment: ConfigurationEnvironment,
    limit = this.input.maxPageSize ?? 100,
  ): readonly ConfigurationActivationRecord[] {
    return freeze(
      [...this.input.store.activations.values()]
        .filter((activation) => activation.destinationEnvironment === environment)
        .sort((left, right) => left.activatedAt.localeCompare(right.activatedAt))
        .slice(-Math.max(0, limit))
        .map((activation) => structuredClone(activation)),
    );
  }

  public listPromotionRequests(): readonly ConfigurationPromotionRequest[] {
    return freeze(
      [...this.input.store.promotionRequests.values()]
        .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt))
        .map((request) => structuredClone(request)),
    );
  }

  public listRollbackRequests(): readonly ConfigurationRollbackRequest[] {
    return freeze(
      [...this.input.store.rollbackRequests.values()]
        .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt))
        .map((request) => structuredClone(request)),
    );
  }

  private appendUnique<T>(
    map: Map<string, T>,
    id: string,
    value: T,
    code: Parameters<typeof configurationError>[0]["code"],
    idempotencyKey?: string,
    idempotencyFingerprint?: string,
  ): ConfigurationResult<T> {
    if (map.has(id)) {
      return fail(
        configurationError({
          code,
          message: `configuration release evidence already exists: ${id}`,
          timestamp: this.input.clock.now(),
        }),
      );
    }
    map.set(id, freeze(structuredClone(value)));
    if (idempotencyKey !== undefined && idempotencyFingerprint !== undefined) {
      this.input.store.idempotency.set(idempotencyKey, `${idempotencyFingerprint}|${id}`);
    }
    return ok(value);
  }

  private idempotent(
    idempotencyKey: string | undefined,
    fingerprintValue: string,
  ): ConfigurationResult<string | undefined> {
    if (idempotencyKey === undefined) {
      return ok(undefined);
    }
    const existing = this.input.store.idempotency.get(idempotencyKey);
    if (existing === undefined) {
      return ok(undefined);
    }
    const [existingFingerprint, existingId] = existing.split("|") as [string, string];
    if (existingFingerprint !== fingerprintValue) {
      return fail(
        configurationError({
          code: "PROMOTION_IDEMPOTENCY_CONFLICT",
          message: "idempotency key was reused with different release semantics",
          timestamp: this.input.clock.now(),
        }),
      );
    }
    return ok(existingId);
  }

  private notFound<T>(kind: string, id: string): ConfigurationResult<T> {
    return fail(
      configurationError({
        code: kind.includes("rollback")
          ? "ROLLBACK_TARGET_NOT_FOUND"
          : "PROMOTION_SOURCE_NOT_FOUND",
        message: `${kind} not found: ${id}`,
        timestamp: this.input.clock.now(),
      }),
    );
  }
}

const environmentStateFromActivation = (
  activation: ConfigurationActivationRecord,
  current: ConfigurationEnvironmentState | undefined,
): ConfigurationEnvironmentState =>
  freeze({
    environment: activation.destinationEnvironment,
    streamId:
      `configuration.${activation.destinationEnvironment.toLowerCase()}.release` as ConfigurationEnvironmentState["streamId"],
    activeVersionId: activation.resultingVersionId,
    activeConfigurationFingerprint: activation.resultingConfigurationFingerprint,
    activeSchemaFingerprint: activation.resultingSchemaFingerprint,
    activationId: activation.activationId,
    activatedAt: activation.activatedAt,
    activatedBy: activation.activatedBy,
    ...(current === undefined ? {} : { previousActiveVersionId: current.activeVersionId }),
    ...(current?.previousKnownGoodVersionId === undefined
      ? {}
      : { previousKnownGoodVersionId: current.previousKnownGoodVersionId }),
    restartRequired: activation.restartRequirement === "RESTART_REQUIRED",
    restartPending: activation.restartRequirement === "RESTART_REQUIRED",
    ...(activation.restartRequirement === "RESTART_REQUIRED" && current !== undefined
      ? { runningVersionId: current.activeVersionId }
      : {}),
    ...(activation.restartRequirement === "RESTART_REQUIRED"
      ? { targetPostRestartVersionId: activation.resultingVersionId }
      : {}),
    stateFingerprint: fingerprint({
      environment: activation.destinationEnvironment,
      activeVersionId: activation.resultingVersionId,
      activeConfigurationFingerprint: activation.resultingConfigurationFingerprint,
      activationId: activation.activationId,
      restartRequirement: activation.restartRequirement,
    }),
  });

export const knownGoodId = (value: string): KnownGoodConfigurationId =>
  `cfggood-${fingerprint(value).replace("sha256:", "").slice(0, 24)}` as KnownGoodConfigurationId;

export const promotionRequestId = (value: string): ConfigurationPromotionRequestId =>
  `cfgpreq-${fingerprint(value).replace("sha256:", "").slice(0, 24)}` as ConfigurationPromotionRequestId;

export const promotionPlanId = (value: string): ConfigurationPromotionPlanId =>
  `cfgplan-${fingerprint(value).replace("sha256:", "").slice(0, 24)}` as ConfigurationPromotionPlanId;

export const promotionDecisionId = (value: string): ConfigurationPromotionDecisionId =>
  `cfgpdec-${fingerprint(value).replace("sha256:", "").slice(0, 24)}` as ConfigurationPromotionDecisionId;

export const promotionExecutionId = (value: string): ConfigurationPromotionExecutionId =>
  `cfgpexe-${fingerprint(value).replace("sha256:", "").slice(0, 24)}` as ConfigurationPromotionExecutionId;

export const rollbackRequestId = (value: string): ConfigurationRollbackRequestId =>
  `cfgrreq-${fingerprint(value).replace("sha256:", "").slice(0, 24)}` as ConfigurationRollbackRequestId;

export const rollbackPlanId = (value: string): ConfigurationRollbackPlanId =>
  `cfgrpln-${fingerprint(value).replace("sha256:", "").slice(0, 24)}` as ConfigurationRollbackPlanId;

export const rollbackExecutionId = (value: string): ConfigurationRollbackExecutionId =>
  `cfgrexe-${fingerprint(value).replace("sha256:", "").slice(0, 24)}` as ConfigurationRollbackExecutionId;

export const activationId = (value: string): ConfigurationActivationId =>
  `cfgact-${fingerprint(value).replace("sha256:", "").slice(0, 24)}` as ConfigurationActivationId;
