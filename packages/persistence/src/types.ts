import type {
  Actor,
  CausationId,
  CorrelationId,
  EventEnvelope,
  EventId,
  RuntimeMode,
  UtcTimestamp,
} from "@ate/domain";
import type { ATEEvent, PublicationResult, SubscriptionId } from "@ate/events";
import type { ServiceId } from "@ate/runtime";

export type PersistenceId = string & { readonly __brand: "PersistenceId" };
export type MigrationId = string & { readonly __brand: "MigrationId" };
export type StateDomain = string & { readonly __brand: "StateDomain" };
export type StateOwner = string & { readonly __brand: "StateOwner" };
export type TransactionId = string & { readonly __brand: "TransactionId" };

export const persistenceStates = [
  "CREATED",
  "CONNECTING",
  "READY",
  "DEGRADED",
  "READ_ONLY",
  "DRAINING",
  "STOPPED",
  "FAILED",
] as const;
export type PersistenceState = (typeof persistenceStates)[number];

export const persistenceErrorCodes = [
  "PERSISTENCE_NOT_READY",
  "DATABASE_CONNECTION_FAILED",
  "DATABASE_TIMEOUT",
  "TRANSACTION_FAILED",
  "TRANSACTION_ROLLED_BACK",
  "TRANSACTION_TIMEOUT",
  "NESTED_TRANSACTION_REJECTED",
  "CONCURRENCY_CONFLICT",
  "CONSTRAINT_VIOLATION",
  "DUPLICATE_RECORD",
  "RECORD_NOT_FOUND",
  "SCHEMA_INCOMPATIBLE",
  "MIGRATION_REQUIRED",
  "MIGRATION_FAILED",
  "OUTBOX_DISPATCH_FAILED",
  "OUTBOX_RETRY_EXHAUSTED",
  "INBOX_CONFLICT",
  "DEAD_LETTER_PERSIST_FAILED",
  "AUDIT_WRITE_FAILED",
  "HISTORY_WRITE_FAILED",
  "INTEGRITY_CHECK_FAILED",
  "ENVIRONMENT_ISOLATION_VIOLATION",
] as const;
export type PersistenceErrorCode = (typeof persistenceErrorCodes)[number];

export type PersistenceSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export type PersistenceError = Readonly<{
  code: PersistenceErrorCode;
  message: string;
  severity: PersistenceSeverity;
  timestamp: UtcTimestamp;
  details?: Record<string, unknown>;
}>;

export type PersistenceResult<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: PersistenceError }>;

export const authorityTypes = [
  "INTERNAL_AUTHORITATIVE",
  "EXTERNAL_AUTHORITATIVE",
  "DERIVED",
  "PROJECTION",
  "CACHE",
  "EPHEMERAL",
] as const;
export type AuthorityType = (typeof authorityTypes)[number];

export type StateOwnershipEntry = Readonly<{
  stateDomain: StateDomain;
  owner: StateOwner;
  authorityType: AuthorityType;
  writeAuthority: string;
  readers: readonly string[];
  durable: boolean;
  historyRequired: boolean;
  reconciliationRequired: boolean;
  runtimeModes: readonly RuntimeMode[];
  description: string;
}>;

export type StateRecord<TPayload = unknown> = Readonly<{
  stateId: PersistenceId;
  stateDomain: StateDomain;
  owner: StateOwner;
  runtimeMode: RuntimeMode;
  version: number;
  payload: TPayload;
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
  correlationId?: CorrelationId;
  causationId?: CausationId;
}>;

export type StateMutation<TPayload = unknown> = Readonly<{
  stateId: PersistenceId;
  stateDomain: StateDomain;
  owner: StateOwner;
  runtimeMode: RuntimeMode;
  expectedVersion?: number;
  payload: TPayload;
  actor: Actor;
  transition: string;
  reason?: string;
  correlationId?: CorrelationId;
  causationId?: CausationId;
}>;

export type StateHistoryRecord = Readonly<{
  historyId: PersistenceId;
  stateId: PersistenceId;
  stateDomain: StateDomain;
  owner: StateOwner;
  runtimeMode: RuntimeMode;
  priorVersion?: number;
  newVersion: number;
  transition: string;
  occurredAt: UtcTimestamp;
  actor: Actor;
  correlationId?: CorrelationId;
  causationId?: CausationId;
  reason?: string;
  metadata: Record<string, unknown>;
}>;

export type AuditRecord = Readonly<{
  auditId: PersistenceId;
  occurredAt: UtcTimestamp;
  runtimeMode: RuntimeMode;
  actor: Actor;
  action: string;
  outcome: "SUCCESS" | "FAILURE";
  affectedResource: string;
  correlationId?: CorrelationId;
  causationId?: CausationId;
  eventId?: EventId;
  reason?: string;
  metadata: Record<string, unknown>;
}>;

export const outboxStates = [
  "PENDING",
  "DISPATCHING",
  "PUBLISHED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL",
] as const;
export type OutboxState = (typeof outboxStates)[number];

export type OutboxRecord = Readonly<{
  outboxId: PersistenceId;
  eventId: EventId;
  eventType: string;
  eventVersion: number;
  event: ATEEvent;
  envelope: EventEnvelope;
  payload: unknown;
  state: OutboxState;
  runtimeMode: RuntimeMode;
  createdAt: UtcTimestamp;
  attemptCount: number;
  nextAttemptAt?: UtcTimestamp;
  publishedAt?: UtcTimestamp;
  claimedAt?: UtcTimestamp;
  failure?: PersistenceError;
}>;

export const inboxStates = [
  "RECEIVED",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL",
] as const;
export type InboxState = (typeof inboxStates)[number];

export type InboxRecord = Readonly<{
  subscriptionId: SubscriptionId;
  idempotencyKey: string;
  eventId: EventId;
  state: InboxState;
  runtimeMode: RuntimeMode;
  attempts: number;
  receivedAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
  claimExpiresAt?: UtcTimestamp;
  failure?: PersistenceError;
}>;

export type DurableDeadLetterRecord = Readonly<{
  deadLetterId: PersistenceId;
  event: ATEEvent;
  subscriptionId: SubscriptionId;
  failure: PersistenceError;
  attempts: number;
  firstFailureAt: UtcTimestamp;
  finalFailureAt: UtcTimestamp;
  correlationId: CorrelationId;
  causationId?: CausationId;
  subscriberId: ServiceId | string;
  runtimeMode: RuntimeMode;
  replayCount: number;
  replayedAt?: UtcTimestamp;
}>;

export type MigrationDefinition = Readonly<{
  migrationId: MigrationId;
  description: string;
  checksum: string;
  apply: (context: TransactionContext) => void;
}>;

export type AppliedMigration = Readonly<{
  migrationId: MigrationId;
  checksum: string;
  description: string;
  appliedAt: UtcTimestamp;
}>;

export type TransactionContext = Readonly<{
  transactionId: TransactionId;
  runtimeMode: RuntimeMode;
  startedAt: UtcTimestamp;
  signal: AbortSignal;
}>;

export type TransactionOptions = Readonly<{
  runtimeMode: RuntimeMode;
  timeoutMs?: number;
  signal?: AbortSignal;
}>;

export type PersistenceOptions = Readonly<{
  runtimeMode: RuntimeMode;
  connectionTimeoutMs: number;
  transactionTimeoutMs: number;
  queryTimeoutMs: number;
  poolMin: number;
  poolMax: number;
  poolIdleTimeoutMs: number;
  outboxBatchSize: number;
  outboxRetryAttempts: number;
  inboxProcessingLeaseMs: number;
  deadLetterQueryLimit: number;
  healthTimeoutMs: number;
  shutdownDrainTimeoutMs: number;
  migrationPolicy: "VALIDATE_ONLY" | "APPLY_PENDING";
}>;

export type PersistenceDiagnostics = Readonly<{
  state: PersistenceState;
  runtimeMode: RuntimeMode;
  databaseReachable: boolean;
  schemaVersion: string;
  migrationStatus: "CURRENT" | "PENDING" | "FAILED" | "INCOMPATIBLE";
  activeTransactions: number;
  transactionAttempts: number;
  commits: number;
  rollbacks: number;
  transactionFailures: number;
  concurrencyConflicts: number;
  pendingOutbox: number;
  failedOutbox: number;
  inboxDuplicates: number;
  deadLetters: number;
  recentErrors: readonly PersistenceError[];
}>;

export type PersistenceSnapshot = Readonly<{
  state: PersistenceState;
  health: "HEALTHY" | "DEGRADED" | "UNHEALTHY";
  readiness: "READY" | "DEGRADED_READY" | "NOT_READY";
  diagnostics: PersistenceDiagnostics;
  ownership: readonly StateOwnershipEntry[];
}>;

export type OutboxDispatchResult = Readonly<{
  claimed: number;
  published: number;
  failedRetryable: number;
  failedFinal: number;
  publicationResults: readonly PublicationResult[];
}>;
