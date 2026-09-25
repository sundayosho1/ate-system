import type { EventId, RuntimeMode, UtcTimestamp } from "@ate/domain";
import type { ATEEvent, InternalEventBus, PublicationResult, SubscriptionId } from "@ate/events";
import type { RuntimeClock } from "@ate/runtime";

import { persistenceError, PersistenceOperationError, toSafeErrorMessage } from "./errors.js";
import { freeze } from "./state-authority.js";
import type { StateAuthorityRegistry } from "./state-authority.js";
import type {
  AppliedMigration,
  AuditRecord,
  DurableDeadLetterRecord,
  InboxRecord,
  MigrationDefinition,
  OutboxDispatchResult,
  OutboxRecord,
  PersistenceDiagnostics,
  PersistenceError,
  PersistenceId,
  PersistenceOptions,
  PersistenceResult,
  PersistenceSnapshot,
  PersistenceState,
  StateHistoryRecord,
  StateMutation,
  StateRecord,
  TransactionContext,
  TransactionId,
  TransactionOptions,
} from "./types.js";

export const defaultPersistenceOptions = (runtimeMode: RuntimeMode): PersistenceOptions => ({
  runtimeMode,
  connectionTimeoutMs: 1_000,
  transactionTimeoutMs: 1_000,
  queryTimeoutMs: 1_000,
  poolMin: 0,
  poolMax: 5,
  poolIdleTimeoutMs: 30_000,
  outboxBatchSize: 25,
  outboxRetryAttempts: 3,
  inboxProcessingLeaseMs: 30_000,
  deadLetterQueryLimit: 100,
  healthTimeoutMs: 500,
  shutdownDrainTimeoutMs: 1_000,
  migrationPolicy: "APPLY_PENDING",
});

export type InboxClaimResult = Readonly<{
  record: InboxRecord;
  duplicate: boolean;
  recoveredStaleClaim: boolean;
}>;

export type MutablePersistenceStore = {
  connected: boolean;
  schemaCompatible: boolean;
  appliedMigrations: AppliedMigration[];
  states: Map<string, StateRecord>;
  history: StateHistoryRecord[];
  audit: AuditRecord[];
  outbox: Map<string, OutboxRecord>;
  inbox: Map<string, InboxRecord>;
  deadLetters: Map<string, DurableDeadLetterRecord>;
};

type Counters = {
  activeTransactions: number;
  transactionAttempts: number;
  commits: number;
  rollbacks: number;
  transactionFailures: number;
  concurrencyConflicts: number;
  inboxDuplicates: number;
};

export class InMemoryPersistenceEngine {
  private state: PersistenceState = "CREATED";
  private activeTransactionId: TransactionId | undefined;
  private transactionStore: MutablePersistenceStore | undefined;
  private migrationLock = false;
  private readonly recentErrors: PersistenceError[] = [];
  private readonly counters: Counters = {
    activeTransactions: 0,
    transactionAttempts: 0,
    commits: 0,
    rollbacks: 0,
    transactionFailures: 0,
    concurrencyConflicts: 0,
    inboxDuplicates: 0,
  };

  public readonly options: PersistenceOptions;

  public constructor(
    private readonly durableStore: MutablePersistenceStore,
    private readonly clock: RuntimeClock,
    private readonly idGenerator: () => string,
    public readonly authority: StateAuthorityRegistry,
    options: Partial<PersistenceOptions> & Pick<PersistenceOptions, "runtimeMode">,
  ) {
    this.options = validatePersistenceOptions({
      ...defaultPersistenceOptions(options.runtimeMode),
      ...options,
    });
  }

  public connect(): PersistenceResult<void> {
    this.state = "CONNECTING";
    if (!this.durableStore.connected) {
      this.state = "FAILED";
      return {
        ok: false,
        error: this.recordError(
          persistenceError({
            code: "DATABASE_CONNECTION_FAILED",
            message: "persistence store is unavailable",
            timestamp: this.clock.now(),
            severity: "CRITICAL",
          }),
        ),
      };
    }
    this.state = this.durableStore.schemaCompatible ? "READY" : "DEGRADED";
    return { ok: true, value: undefined };
  }

  public disconnect(): void {
    this.state = "STOPPED";
  }

  public setConnected(connected: boolean): void {
    this.durableStore.connected = connected;
    this.state = connected ? "READY" : "DEGRADED";
  }

  public async execute<T>(
    options: TransactionOptions,
    operation: (context: TransactionContext) => Promise<T> | T,
  ): Promise<PersistenceResult<T>> {
    if (this.state !== "READY") {
      return {
        ok: false,
        error: this.recordError(
          persistenceError({
            code: "PERSISTENCE_NOT_READY",
            message: `persistence is not ready in state ${this.state}`,
            timestamp: this.clock.now(),
          }),
        ),
      };
    }
    if (options.runtimeMode !== this.options.runtimeMode) {
      return {
        ok: false,
        error: this.recordError(
          persistenceError({
            code: "ENVIRONMENT_ISOLATION_VIOLATION",
            message: `transaction runtime mode ${options.runtimeMode} cannot use ${this.options.runtimeMode} persistence`,
            timestamp: this.clock.now(),
            severity: "CRITICAL",
          }),
        ),
      };
    }
    if (this.activeTransactionId !== undefined) {
      return {
        ok: false,
        error: this.recordError(
          persistenceError({
            code: "NESTED_TRANSACTION_REJECTED",
            message: "nested transactions are prohibited in Prompt 5",
            timestamp: this.clock.now(),
          }),
        ),
      };
    }

    const controller = new AbortController();
    const transactionId = this.nextId() as TransactionId;
    const context: TransactionContext = freeze({
      transactionId,
      runtimeMode: options.runtimeMode,
      startedAt: this.clock.now(),
      signal: controller.signal,
    });
    const timeoutMs = options.timeoutMs ?? this.options.transactionTimeoutMs;
    this.activeTransactionId = transactionId;
    this.transactionStore = cloneStore(this.durableStore);
    this.counters.activeTransactions += 1;
    this.counters.transactionAttempts += 1;
    let timeout: NodeJS.Timeout | undefined;
    try {
      if (options.signal?.aborted) {
        throw new PersistenceOperationError(
          persistenceError({
            code: "TRANSACTION_ROLLED_BACK",
            message: "transaction cancelled before start",
            timestamp: this.clock.now(),
          }),
        );
      }
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(
            new PersistenceOperationError(
              persistenceError({
                code: "TRANSACTION_TIMEOUT",
                message: "transaction timed out and was rolled back",
                timestamp: this.clock.now(),
                severity: "ERROR",
              }),
            ),
          );
        }, timeoutMs);
      });
      const value = await Promise.race([operation(context), timeoutPromise]);
      commitStore(this.durableStore, this.transactionStore);
      this.counters.commits += 1;
      return { ok: true, value };
    } catch (error) {
      controller.abort();
      this.counters.rollbacks += 1;
      this.counters.transactionFailures += 1;
      const persistenceFailure =
        error instanceof PersistenceOperationError
          ? error.persistenceError
          : persistenceError({
              code: "TRANSACTION_ROLLED_BACK",
              message: toSafeErrorMessage(error),
              timestamp: this.clock.now(),
            });
      return { ok: false, error: this.recordError(persistenceFailure) };
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      this.activeTransactionId = undefined;
      this.transactionStore = undefined;
      this.counters.activeTransactions -= 1;
    }
  }

  public applyMigrations(
    migrations: readonly MigrationDefinition[],
  ): PersistenceResult<readonly AppliedMigration[]> {
    if (this.migrationLock) {
      return {
        ok: false,
        error: this.recordError(
          persistenceError({
            code: "MIGRATION_FAILED",
            message: "migration lock is already held",
            timestamp: this.clock.now(),
          }),
        ),
      };
    }
    this.migrationLock = true;
    try {
      for (const migration of migrations) {
        const applied = this.durableStore.appliedMigrations.find(
          (candidate) => candidate.migrationId === migration.migrationId,
        );
        if (applied !== undefined && applied.checksum !== migration.checksum) {
          this.durableStore.schemaCompatible = false;
          return {
            ok: false,
            error: this.recordError(
              persistenceError({
                code: "SCHEMA_INCOMPATIBLE",
                message: `migration checksum mismatch: ${migration.migrationId}`,
                timestamp: this.clock.now(),
                severity: "CRITICAL",
              }),
            ),
          };
        }
        if (applied === undefined) {
          if (this.options.migrationPolicy !== "APPLY_PENDING") {
            return {
              ok: false,
              error: this.recordError(
                persistenceError({
                  code: "MIGRATION_REQUIRED",
                  message: `pending migration: ${migration.migrationId}`,
                  timestamp: this.clock.now(),
                }),
              ),
            };
          }
          const tx = this.createSyntheticMigrationContext();
          migration.apply(tx);
          this.durableStore.appliedMigrations.push({
            migrationId: migration.migrationId,
            checksum: migration.checksum,
            description: migration.description,
            appliedAt: this.clock.now(),
          });
        }
      }
      this.durableStore.schemaCompatible = true;
      return { ok: true, value: freeze([...this.durableStore.appliedMigrations]) };
    } catch (error) {
      return {
        ok: false,
        error: this.recordError(
          persistenceError({
            code: "MIGRATION_FAILED",
            message: toSafeErrorMessage(error),
            timestamp: this.clock.now(),
          }),
        ),
      };
    } finally {
      this.migrationLock = false;
    }
  }

  public saveState<TPayload>(
    context: TransactionContext,
    mutation: StateMutation<TPayload>,
  ): PersistenceResult<StateRecord<TPayload>> {
    const store = this.requireTransaction(context);
    const authority = this.authority.validateMutation(mutation);
    if (!authority.ok) {
      return authority;
    }
    const existing = store.states.get(mutation.stateId);
    if (existing !== undefined && existing.runtimeMode !== mutation.runtimeMode) {
      return {
        ok: false,
        error: this.recordError(
          persistenceError({
            code: "ENVIRONMENT_ISOLATION_VIOLATION",
            message: "state runtime mode mismatch",
            timestamp: this.clock.now(),
          }),
        ),
      };
    }
    if (existing !== undefined && mutation.expectedVersion !== existing.version) {
      this.counters.concurrencyConflicts += 1;
      return {
        ok: false,
        error: this.recordError(
          persistenceError({
            code: "CONCURRENCY_CONFLICT",
            message: `expected version ${mutation.expectedVersion ?? "undefined"} but current version is ${existing.version}`,
            timestamp: this.clock.now(),
          }),
        ),
      };
    }
    if (
      existing === undefined &&
      mutation.expectedVersion !== undefined &&
      mutation.expectedVersion !== 0
    ) {
      return {
        ok: false,
        error: this.recordError(
          persistenceError({
            code: "CONCURRENCY_CONFLICT",
            message: "new state expected version must be omitted or 0",
            timestamp: this.clock.now(),
          }),
        ),
      };
    }
    const now = this.clock.now();
    const next: StateRecord<TPayload> = freeze({
      stateId: mutation.stateId,
      stateDomain: mutation.stateDomain,
      owner: mutation.owner,
      runtimeMode: mutation.runtimeMode,
      version: existing === undefined ? 1 : existing.version + 1,
      payload: mutation.payload,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(mutation.correlationId === undefined ? {} : { correlationId: mutation.correlationId }),
      ...(mutation.causationId === undefined ? {} : { causationId: mutation.causationId }),
    });
    store.states.set(mutation.stateId, next);
    const history = this.createHistoryRecord(mutation, existing, next);
    store.history.push(history);
    return { ok: true, value: next };
  }

  public loadState<TPayload>(
    stateId: PersistenceId,
    runtimeMode: RuntimeMode,
  ): PersistenceResult<StateRecord<TPayload>> {
    const record = this.durableStore.states.get(stateId);
    if (record === undefined || record.runtimeMode !== runtimeMode) {
      return {
        ok: false,
        error: persistenceError({
          code: "RECORD_NOT_FOUND",
          message: `state record not found: ${stateId}`,
          timestamp: this.clock.now(),
        }),
      };
    }
    return { ok: true, value: freeze(cloneValue(record) as StateRecord<TPayload>) };
  }

  public historyForState(stateId: PersistenceId, limit = 100): readonly StateHistoryRecord[] {
    return freeze(
      this.durableStore.history
        .filter((record) => record.stateId === stateId)
        .slice(0, Math.max(0, limit))
        .map((record) => cloneValue(record)),
    );
  }

  public appendAudit(
    context: TransactionContext,
    audit: Omit<AuditRecord, "auditId" | "occurredAt">,
  ): PersistenceResult<AuditRecord> {
    const store = this.requireTransaction(context);
    const record: AuditRecord = freeze({
      ...audit,
      auditId: this.nextId() as PersistenceId,
      occurredAt: this.clock.now(),
    });
    store.audit.push(record);
    return { ok: true, value: record };
  }

  public auditRecords(limit = 100): readonly AuditRecord[] {
    return freeze(
      this.durableStore.audit.slice(0, Math.max(0, limit)).map((record) => cloneValue(record)),
    );
  }

  public appendOutbox(
    context: TransactionContext,
    event: ATEEvent,
  ): PersistenceResult<OutboxRecord> {
    const store = this.requireTransaction(context);
    if (store.outbox.has(event.envelope.eventId)) {
      return {
        ok: false,
        error: this.recordError(
          persistenceError({
            code: "DUPLICATE_RECORD",
            message: `outbox event already exists: ${event.envelope.eventId}`,
            timestamp: this.clock.now(),
          }),
        ),
      };
    }
    const record: OutboxRecord = freeze({
      outboxId: this.nextId() as PersistenceId,
      eventId: event.envelope.eventId,
      eventType: event.envelope.eventType,
      eventVersion: event.eventVersion,
      event,
      envelope: event.envelope,
      payload: event.payload,
      state: "PENDING",
      runtimeMode: event.envelope.runtimeMode,
      createdAt: this.clock.now(),
      attemptCount: 0,
    });
    store.outbox.set(record.eventId, record);
    return { ok: true, value: record };
  }

  public claimPendingOutbox(limit = this.options.outboxBatchSize): readonly OutboxRecord[] {
    const claimed: OutboxRecord[] = [];
    for (const record of this.durableStore.outbox.values()) {
      if (claimed.length >= limit) {
        break;
      }
      if (record.state === "PENDING" || record.state === "FAILED_RETRYABLE") {
        const updated: OutboxRecord = freeze({
          ...record,
          state: "DISPATCHING",
          claimedAt: this.clock.now(),
          attemptCount: record.attemptCount + 1,
        });
        this.durableStore.outbox.set(record.eventId, updated);
        claimed.push(updated);
      }
    }
    return freeze(claimed);
  }

  public markOutboxPublished(
    eventId: EventId,
    result: PublicationResult,
  ): PersistenceResult<OutboxRecord> {
    const record = this.durableStore.outbox.get(eventId);
    if (record === undefined) {
      return this.notFound(`outbox record not found: ${eventId}`);
    }
    const { failure: _failure, nextAttemptAt: _nextAttemptAt, ...baseRecord } = record;
    const updated: OutboxRecord = freeze({
      ...baseRecord,
      state: "PUBLISHED",
      publishedAt: this.clock.now(),
    });
    this.durableStore.outbox.set(eventId, updated);
    void result;
    return { ok: true, value: updated };
  }

  public markOutboxFailed(
    eventId: EventId,
    failure: PersistenceError,
  ): PersistenceResult<OutboxRecord> {
    const record = this.durableStore.outbox.get(eventId);
    if (record === undefined) {
      return this.notFound(`outbox record not found: ${eventId}`);
    }
    const final = record.attemptCount >= this.options.outboxRetryAttempts;
    const { nextAttemptAt: _nextAttemptAt, ...baseRecord } = record;
    const updated: OutboxRecord = freeze({
      ...baseRecord,
      state: final ? "FAILED_FINAL" : "FAILED_RETRYABLE",
      failure,
      ...(final ? {} : { nextAttemptAt: this.clock.now() }),
    });
    this.durableStore.outbox.set(eventId, updated);
    return { ok: true, value: updated };
  }

  public async dispatchOutbox(
    bus: InternalEventBus,
    limit = this.options.outboxBatchSize,
  ): Promise<OutboxDispatchResult> {
    const claimed = this.claimPendingOutbox(limit);
    const publicationResults: PublicationResult[] = [];
    let published = 0;
    let failedRetryable = 0;
    let failedFinal = 0;
    for (const record of claimed) {
      const result = await bus.publish(record.event);
      publicationResults.push(result);
      if (result.status === "DELIVERED" || result.status === "DUPLICATE") {
        this.markOutboxPublished(record.eventId, result);
        published += 1;
      } else {
        const failure = persistenceError({
          code: "OUTBOX_DISPATCH_FAILED",
          message: result.errors.at(0)?.message ?? `event publication returned ${result.status}`,
          timestamp: this.clock.now(),
        });
        const marked = this.markOutboxFailed(record.eventId, failure);
        if (marked.ok && marked.value.state === "FAILED_FINAL") {
          failedFinal += 1;
        } else {
          failedRetryable += 1;
        }
      }
    }
    return freeze({
      claimed: claimed.length,
      published,
      failedRetryable,
      failedFinal,
      publicationResults,
    });
  }

  public claimInbox(input: {
    subscriptionId: SubscriptionId;
    idempotencyKey: string;
    eventId: EventId;
    runtimeMode: RuntimeMode;
  }): PersistenceResult<InboxClaimResult> {
    const key = inboxKey(input.subscriptionId, input.idempotencyKey);
    const existing = this.durableStore.inbox.get(key);
    const now = this.clock.now();
    if (existing?.state === "SUCCEEDED") {
      this.counters.inboxDuplicates += 1;
      return { ok: true, value: { record: existing, duplicate: true, recoveredStaleClaim: false } };
    }
    if (
      existing?.state === "PROCESSING" &&
      existing.claimExpiresAt !== undefined &&
      existing.claimExpiresAt > now
    ) {
      this.counters.inboxDuplicates += 1;
      return { ok: true, value: { record: existing, duplicate: true, recoveredStaleClaim: false } };
    }
    const recoveredStaleClaim = existing?.state === "PROCESSING";
    const record: InboxRecord = freeze({
      subscriptionId: input.subscriptionId,
      idempotencyKey: input.idempotencyKey,
      eventId: input.eventId,
      state: "PROCESSING",
      runtimeMode: input.runtimeMode,
      attempts: (existing?.attempts ?? 0) + 1,
      receivedAt: existing?.receivedAt ?? now,
      updatedAt: now,
      claimExpiresAt: addMilliseconds(now, this.options.inboxProcessingLeaseMs) as UtcTimestamp,
    });
    this.durableStore.inbox.set(key, record);
    return { ok: true, value: { record, duplicate: false, recoveredStaleClaim } };
  }

  public markInboxSucceeded(
    subscriptionId: SubscriptionId,
    idempotencyKey: string,
  ): PersistenceResult<InboxRecord> {
    return this.updateInbox(subscriptionId, idempotencyKey, "SUCCEEDED");
  }

  public markInboxFailed(
    subscriptionId: SubscriptionId,
    idempotencyKey: string,
    final: boolean,
    failure: PersistenceError,
  ): PersistenceResult<InboxRecord> {
    return this.updateInbox(
      subscriptionId,
      idempotencyKey,
      final ? "FAILED_FINAL" : "FAILED_RETRYABLE",
      failure,
    );
  }

  public persistDeadLetter(
    record: Omit<DurableDeadLetterRecord, "deadLetterId">,
  ): PersistenceResult<DurableDeadLetterRecord> {
    const persisted: DurableDeadLetterRecord = freeze({
      ...record,
      deadLetterId: this.nextId() as PersistenceId,
    });
    this.durableStore.deadLetters.set(persisted.deadLetterId, persisted);
    return { ok: true, value: persisted };
  }

  public deadLetters(
    limit = this.options.deadLetterQueryLimit,
  ): readonly DurableDeadLetterRecord[] {
    return freeze(
      [...this.durableStore.deadLetters.values()]
        .slice(0, Math.max(0, limit))
        .map((record) => cloneValue(record)),
    );
  }

  public markDeadLetterReplayed(
    deadLetterId: PersistenceId,
  ): PersistenceResult<DurableDeadLetterRecord> {
    const record = this.durableStore.deadLetters.get(deadLetterId);
    if (record === undefined) {
      return this.notFound(`dead letter not found: ${deadLetterId}`);
    }
    const updated: DurableDeadLetterRecord = freeze({
      ...record,
      replayCount: record.replayCount + 1,
      replayedAt: this.clock.now(),
    });
    this.durableStore.deadLetters.set(deadLetterId, updated);
    return { ok: true, value: updated };
  }

  public snapshot(): PersistenceSnapshot {
    const diagnostics = this.diagnostics();
    return freeze({
      state: this.state,
      health: diagnostics.databaseReachable
        ? diagnostics.failedOutbox > 0 || diagnostics.deadLetters > 0
          ? "DEGRADED"
          : "HEALTHY"
        : "UNHEALTHY",
      readiness:
        this.state === "READY" && diagnostics.migrationStatus === "CURRENT" ? "READY" : "NOT_READY",
      diagnostics,
      ownership: this.authority.all(),
    });
  }

  public diagnostics(): PersistenceDiagnostics {
    const failedOutbox = [...this.durableStore.outbox.values()].filter(
      (record) => record.state === "FAILED_FINAL" || record.state === "FAILED_RETRYABLE",
    ).length;
    const pendingOutbox = [...this.durableStore.outbox.values()].filter(
      (record) => record.state === "PENDING" || record.state === "FAILED_RETRYABLE",
    ).length;
    return freeze({
      state: this.state,
      runtimeMode: this.options.runtimeMode,
      databaseReachable: this.durableStore.connected,
      schemaVersion: this.durableStore.appliedMigrations.at(-1)?.migrationId ?? "none",
      migrationStatus: this.durableStore.schemaCompatible ? "CURRENT" : "INCOMPATIBLE",
      activeTransactions: this.counters.activeTransactions,
      transactionAttempts: this.counters.transactionAttempts,
      commits: this.counters.commits,
      rollbacks: this.counters.rollbacks,
      transactionFailures: this.counters.transactionFailures,
      concurrencyConflicts: this.counters.concurrencyConflicts,
      pendingOutbox,
      failedOutbox,
      inboxDuplicates: this.counters.inboxDuplicates,
      deadLetters: this.durableStore.deadLetters.size,
      recentErrors: [...this.recentErrors],
    });
  }

  private requireTransaction(context: TransactionContext): MutablePersistenceStore {
    if (this.activeTransactionId !== context.transactionId || this.transactionStore === undefined) {
      throw new PersistenceOperationError(
        persistenceError({
          code: "TRANSACTION_FAILED",
          message: "operation requires the active transaction context",
          timestamp: this.clock.now(),
        }),
      );
    }
    if (context.signal.aborted) {
      throw new PersistenceOperationError(
        persistenceError({
          code: "TRANSACTION_ROLLED_BACK",
          message: "transaction context was cancelled",
          timestamp: this.clock.now(),
        }),
      );
    }
    return this.transactionStore;
  }

  private createHistoryRecord<TPayload>(
    mutation: StateMutation<TPayload>,
    existing: StateRecord | undefined,
    next: StateRecord,
  ): StateHistoryRecord {
    return freeze({
      historyId: this.nextId() as PersistenceId,
      stateId: mutation.stateId,
      stateDomain: mutation.stateDomain,
      owner: mutation.owner,
      runtimeMode: mutation.runtimeMode,
      ...(existing === undefined ? {} : { priorVersion: existing.version }),
      newVersion: next.version,
      transition: mutation.transition,
      occurredAt: this.clock.now(),
      actor: mutation.actor,
      ...(mutation.correlationId === undefined ? {} : { correlationId: mutation.correlationId }),
      ...(mutation.causationId === undefined ? {} : { causationId: mutation.causationId }),
      ...(mutation.reason === undefined ? {} : { reason: mutation.reason }),
      metadata: {},
    });
  }

  private updateInbox(
    subscriptionId: SubscriptionId,
    idempotencyKey: string,
    state: InboxRecord["state"],
    failure?: PersistenceError,
  ): PersistenceResult<InboxRecord> {
    const key = inboxKey(subscriptionId, idempotencyKey);
    const existing = this.durableStore.inbox.get(key);
    if (existing === undefined) {
      return this.notFound(`inbox record not found: ${key}`);
    }
    const { claimExpiresAt: _claimExpiresAt, failure: _failure, ...baseRecord } = existing;
    const updated: InboxRecord = freeze({
      ...baseRecord,
      state,
      updatedAt: this.clock.now(),
      ...(failure === undefined ? {} : { failure }),
    });
    this.durableStore.inbox.set(key, updated);
    return { ok: true, value: updated };
  }

  private notFound<T>(message: string): PersistenceResult<T> {
    return {
      ok: false,
      error: persistenceError({
        code: "RECORD_NOT_FOUND",
        message,
        timestamp: this.clock.now(),
      }),
    };
  }

  private recordError(error: PersistenceError): PersistenceError {
    this.recentErrors.push(error);
    while (this.recentErrors.length > 25) {
      this.recentErrors.shift();
    }
    return error;
  }

  private nextId(): string {
    return this.idGenerator();
  }

  private createSyntheticMigrationContext(): TransactionContext {
    return freeze({
      transactionId: this.nextId() as TransactionId,
      runtimeMode: this.options.runtimeMode,
      startedAt: this.clock.now(),
      signal: new AbortController().signal,
    });
  }
}

export const createEmptyPersistenceStore = (): MutablePersistenceStore => ({
  connected: true,
  schemaCompatible: true,
  appliedMigrations: [],
  states: new Map(),
  history: [],
  audit: [],
  outbox: new Map(),
  inbox: new Map(),
  deadLetters: new Map(),
});

export const persistenceId = (value: string): PersistenceId => value as PersistenceId;

export const validatePersistenceOptions = (options: PersistenceOptions): PersistenceOptions => {
  const positive = [
    ["connectionTimeoutMs", options.connectionTimeoutMs],
    ["transactionTimeoutMs", options.transactionTimeoutMs],
    ["queryTimeoutMs", options.queryTimeoutMs],
    ["poolMax", options.poolMax],
    ["poolIdleTimeoutMs", options.poolIdleTimeoutMs],
    ["outboxBatchSize", options.outboxBatchSize],
    ["outboxRetryAttempts", options.outboxRetryAttempts],
    ["inboxProcessingLeaseMs", options.inboxProcessingLeaseMs],
    ["deadLetterQueryLimit", options.deadLetterQueryLimit],
    ["healthTimeoutMs", options.healthTimeoutMs],
    ["shutdownDrainTimeoutMs", options.shutdownDrainTimeoutMs],
  ] as const;
  for (const [name, value] of positive) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`invalid persistence option ${name}: expected positive integer`);
    }
  }
  if (
    !Number.isInteger(options.poolMin) ||
    options.poolMin < 0 ||
    options.poolMin > options.poolMax
  ) {
    throw new Error("invalid persistence pool bounds");
  }
  return options;
};

const inboxKey = (subscriptionId: SubscriptionId, idempotencyKey: string): string =>
  `${subscriptionId}:${idempotencyKey}`;

const addMilliseconds = (timestamp: UtcTimestamp, milliseconds: number): string =>
  new Date(Date.parse(timestamp) + milliseconds).toISOString();

const cloneStore = (store: MutablePersistenceStore): MutablePersistenceStore => ({
  connected: store.connected,
  schemaCompatible: store.schemaCompatible,
  appliedMigrations: cloneValue(store.appliedMigrations),
  states: new Map([...store.states.entries()].map(([key, value]) => [key, cloneValue(value)])),
  history: cloneValue(store.history),
  audit: cloneValue(store.audit),
  outbox: new Map([...store.outbox.entries()].map(([key, value]) => [key, cloneValue(value)])),
  inbox: new Map([...store.inbox.entries()].map(([key, value]) => [key, cloneValue(value)])),
  deadLetters: new Map(
    [...store.deadLetters.entries()].map(([key, value]) => [key, cloneValue(value)]),
  ),
});

const commitStore = (
  target: MutablePersistenceStore,
  source: MutablePersistenceStore | undefined,
): void => {
  if (source === undefined) {
    throw new Error("transaction store missing");
  }
  target.connected = source.connected;
  target.schemaCompatible = source.schemaCompatible;
  target.appliedMigrations = source.appliedMigrations;
  target.states = source.states;
  target.history = source.history;
  target.audit = source.audit;
  target.outbox = source.outbox;
  target.inbox = source.inbox;
  target.deadLetters = source.deadLetters;
};

const cloneValue = <T>(value: T): T => structuredClone(value);
