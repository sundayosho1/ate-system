import type { Clock } from "@ate/time";

import { freeze } from "./context.js";
import { configurationError, fail, ok } from "./errors.js";
import type {
  ApprovalRepositoryListFilter,
  ConfigurationApprovalDecision,
  ConfigurationApprovalDecisionId,
  ConfigurationApprovalRepository,
  ConfigurationApprovalRequest,
  ConfigurationApprovalRequestId,
  ConfigurationApprovalRevocation,
  ApprovalRequirementEvaluation,
} from "./approval-types.js";
import type { ConfigurationResult } from "./types.js";
import type { ConfigurationVersionId } from "./version-types.js";

export type MutableConfigurationApprovalStore = {
  evaluations: Map<string, ApprovalRequirementEvaluation>;
  requests: Map<string, ConfigurationApprovalRequest>;
  decisions: Map<string, ConfigurationApprovalDecision>;
  revocations: Map<string, ConfigurationApprovalRevocation>;
  requestIdempotency: Map<string, ConfigurationApprovalRequestId>;
  decisionIdempotency: Map<string, ConfigurationApprovalDecisionId>;
  revocationIdempotency: Map<string, string>;
};

export const createEmptyConfigurationApprovalStore = (): MutableConfigurationApprovalStore => ({
  evaluations: new Map(),
  requests: new Map(),
  decisions: new Map(),
  revocations: new Map(),
  requestIdempotency: new Map(),
  decisionIdempotency: new Map(),
  revocationIdempotency: new Map(),
});

export class InMemoryConfigurationApprovalRepository implements ConfigurationApprovalRepository {
  public constructor(
    private readonly input: {
      clock: Clock;
      store: MutableConfigurationApprovalStore;
      maxPageSize?: number;
    },
  ) {}

  public appendRequirementEvaluation(
    evaluation: ApprovalRequirementEvaluation,
  ): ConfigurationResult<ApprovalRequirementEvaluation> {
    this.input.store.evaluations.set(evaluation.evaluationId, freeze(structuredClone(evaluation)));
    return ok(evaluation);
  }

  public appendRequest(
    request: ConfigurationApprovalRequest,
  ): ConfigurationResult<ConfigurationApprovalRequest> {
    if (request.idempotencyKey !== undefined) {
      const existing = this.input.store.requestIdempotency.get(request.idempotencyKey);
      if (existing !== undefined) {
        return this.getRequest(existing);
      }
    }
    if (this.input.store.requests.has(request.requestId)) {
      return fail(
        configurationError({
          code: "APPROVAL_REQUEST_ALREADY_EXISTS",
          message: `approval request already exists: ${request.requestId}`,
          timestamp: this.input.clock.now(),
        }),
      );
    }
    this.input.store.requests.set(request.requestId, freeze(structuredClone(request)));
    if (request.idempotencyKey !== undefined) {
      this.input.store.requestIdempotency.set(request.idempotencyKey, request.requestId);
    }
    return ok(request);
  }

  public appendDecision(
    decision: ConfigurationApprovalDecision,
  ): ConfigurationResult<ConfigurationApprovalDecision> {
    if (decision.idempotencyKey !== undefined) {
      const existing = this.input.store.decisionIdempotency.get(decision.idempotencyKey);
      if (existing !== undefined) {
        return this.getDecision(existing);
      }
    }
    if (this.input.store.decisions.has(decision.decisionId)) {
      return fail(
        configurationError({
          code: "APPROVAL_DECISION_CONFLICT",
          message: `approval decision already exists: ${decision.decisionId}`,
          timestamp: this.input.clock.now(),
        }),
      );
    }
    this.input.store.decisions.set(decision.decisionId, freeze(structuredClone(decision)));
    if (decision.idempotencyKey !== undefined) {
      this.input.store.decisionIdempotency.set(decision.idempotencyKey, decision.decisionId);
    }
    return ok(decision);
  }

  public appendRevocation(
    revocation: ConfigurationApprovalRevocation,
  ): ConfigurationResult<ConfigurationApprovalRevocation> {
    if (revocation.idempotencyKey !== undefined) {
      const existing = this.input.store.revocationIdempotency.get(revocation.idempotencyKey);
      if (existing !== undefined) {
        const stored = this.input.store.revocations.get(existing);
        if (stored !== undefined) {
          return ok(structuredClone(stored));
        }
      }
    }
    if (this.input.store.revocations.has(revocation.revocationId)) {
      return fail(
        configurationError({
          code: "APPROVAL_DECISION_CONFLICT",
          message: `approval revocation already exists: ${revocation.revocationId}`,
          timestamp: this.input.clock.now(),
        }),
      );
    }
    this.input.store.revocations.set(revocation.revocationId, freeze(structuredClone(revocation)));
    if (revocation.idempotencyKey !== undefined) {
      this.input.store.revocationIdempotency.set(
        revocation.idempotencyKey,
        revocation.revocationId,
      );
    }
    return ok(revocation);
  }

  public getRequest(
    requestId: ConfigurationApprovalRequestId,
  ): ConfigurationResult<ConfigurationApprovalRequest> {
    const request = this.input.store.requests.get(requestId);
    if (request === undefined) {
      return fail(
        configurationError({
          code: "APPROVAL_REQUEST_NOT_FOUND",
          message: `approval request not found: ${requestId}`,
          timestamp: this.input.clock.now(),
        }),
      );
    }
    return ok(freeze(structuredClone(request)));
  }

  public getDecision(
    decisionId: ConfigurationApprovalDecisionId,
  ): ConfigurationResult<ConfigurationApprovalDecision> {
    const decision = this.input.store.decisions.get(decisionId);
    if (decision === undefined) {
      return fail(
        configurationError({
          code: "APPROVAL_REQUEST_NOT_FOUND",
          message: `approval decision not found: ${decisionId}`,
          timestamp: this.input.clock.now(),
        }),
      );
    }
    return ok(freeze(structuredClone(decision)));
  }

  public requestsByVersion(
    versionId: ConfigurationVersionId,
    limit = this.input.maxPageSize ?? 100,
  ): readonly ConfigurationApprovalRequest[] {
    return freeze(
      [...this.input.store.requests.values()]
        .filter((request) => request.versionId === versionId)
        .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt))
        .slice(0, Math.max(0, limit))
        .map((request) => structuredClone(request)),
    );
  }

  public decisionsByRequest(
    requestId: ConfigurationApprovalRequestId,
    limit = this.input.maxPageSize ?? 100,
  ): readonly ConfigurationApprovalDecision[] {
    return freeze(
      [...this.input.store.decisions.values()]
        .filter((decision) => decision.requestId === requestId)
        .sort((left, right) => left.decidedAt.localeCompare(right.decidedAt))
        .slice(0, Math.max(0, limit))
        .map((decision) => structuredClone(decision)),
    );
  }

  public revocationsByRequest(
    requestId: ConfigurationApprovalRequestId,
    limit = this.input.maxPageSize ?? 100,
  ): readonly ConfigurationApprovalRevocation[] {
    return freeze(
      [...this.input.store.revocations.values()]
        .filter((revocation) => revocation.requestId === requestId)
        .sort((left, right) => left.revokedAt.localeCompare(right.revokedAt))
        .slice(0, Math.max(0, limit))
        .map((revocation) => structuredClone(revocation)),
    );
  }

  public listRequests(
    filter: ApprovalRepositoryListFilter = {},
  ): readonly ConfigurationApprovalRequest[] {
    const limit = Math.min(
      Math.max(0, filter.limit ?? this.input.maxPageSize ?? 100),
      this.input.maxPageSize ?? 100,
    );
    const offset = Math.max(0, filter.offset ?? 0);
    return freeze(
      [...this.input.store.requests.values()]
        .filter(
          (request) => filter.versionId === undefined || request.versionId === filter.versionId,
        )
        .filter(
          (request) => filter.requestId === undefined || request.requestId === filter.requestId,
        )
        .filter(
          (request) =>
            filter.makerActorId === undefined || request.maker.actorId === filter.makerActorId,
        )
        .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt))
        .slice(offset, offset + limit)
        .map((request) => structuredClone(request)),
    );
  }
}
