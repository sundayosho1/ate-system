import type {
  Actor,
  CausationId,
  CorrelationId,
  EventEnvelope,
  EventId,
  RuntimeMode,
  UtcTimestamp,
} from "@ate/domain";
import type { RuntimeClock, ServiceId } from "@ate/runtime";
import type { ZodType } from "zod";

export const eventCategories = [
  "DOMAIN",
  "APPLICATION",
  "INTEGRATION",
  "AUDIT",
  "OPERATIONAL",
] as const;
export type EventCategory = (typeof eventCategories)[number];

export const eventBusStates = [
  "CREATED",
  "STARTING",
  "RUNNING",
  "DEGRADED",
  "DRAINING",
  "STOPPING",
  "STOPPED",
  "FAILED",
] as const;
export type EventBusState = (typeof eventBusStates)[number];

export const eventErrorCodes = [
  "EVENT_TYPE_UNREGISTERED",
  "EVENT_SCHEMA_INVALID",
  "EVENT_ENVELOPE_INVALID",
  "EVENT_DUPLICATE",
  "SUBSCRIPTION_DUPLICATE",
  "SUBSCRIPTION_NOT_FOUND",
  "ROUTE_INVALID",
  "HANDLER_FAILED",
  "HANDLER_TIMEOUT",
  "DELIVERY_CANCELLED",
  "QUEUE_SATURATED",
  "BACKPRESSURE_TIMEOUT",
  "RETRY_EXHAUSTED",
  "DEAD_LETTERED",
  "CAUSATION_INVALID",
  "CAUSATION_DEPTH_EXCEEDED",
  "ORDERING_VIOLATION",
  "EVENT_BUS_NOT_READY",
  "EVENT_BUS_DRAINING",
  "EVENT_BUS_STOPPED",
] as const;
export type EventErrorCode = (typeof eventErrorCodes)[number];

export const eventSeverities = ["INFO", "WARNING", "ERROR", "CRITICAL"] as const;
export type EventSeverity = (typeof eventSeverities)[number];

export type EventError = Readonly<{
  code: EventErrorCode;
  message: string;
  severity: EventSeverity;
  timestamp: UtcTimestamp;
  eventId?: EventId;
  eventType?: string;
  subscriptionId?: SubscriptionId;
  details?: Record<string, unknown>;
}>;

export type SubscriptionId = string & { readonly __brand: "SubscriptionId" };

export type EventTypeRegistration<TPayload = unknown> = Readonly<{
  eventType: string;
  category: EventCategory;
  version: number;
  schema: ZodType<TPayload>;
  description: string;
  owner: string;
  deprecated?: boolean;
}>;

export type EventMetadata = Readonly<{
  idempotencyKey?: string;
  orderingKey?: string;
  priority?: number;
  sensitivity?: "PUBLIC" | "INTERNAL" | "SENSITIVE";
  causationDepth: number;
  provenance?: Record<string, unknown>;
}>;

export type ATEEvent<TPayload = unknown> = Readonly<{
  envelope: EventEnvelope;
  category: EventCategory;
  eventVersion: number;
  payload: TPayload;
  metadata: EventMetadata;
}>;

export type EventFactoryContext = Readonly<{
  runtimeMode: RuntimeMode;
  source: EventEnvelope["source"];
  actor: Actor;
  clock: RuntimeClock;
  idGenerator: () => string;
  maxCausationDepth: number;
}>;

export type RootEventInput<TPayload> = Readonly<{
  eventType: string;
  payload: TPayload;
  correlationId?: CorrelationId;
  eventId?: EventId;
  metadata?: Partial<EventMetadata>;
}>;

export type ChildEventInput<TPayload> = Readonly<{
  parent: ATEEvent;
  eventType: string;
  payload: TPayload;
  eventId?: EventId;
  metadata?: Partial<EventMetadata>;
}>;

export type EventHandlerStatus =
  | "SUCCESS"
  | "DUPLICATE_SKIPPED"
  | "RETRYABLE_FAILURE"
  | "NON_RETRYABLE_FAILURE"
  | "TIMEOUT"
  | "CANCELLED";

export type EventHandlerResult = Readonly<{
  status: EventHandlerStatus;
  reason?: string;
  error?: EventError;
}>;

export type DeliveryStatus =
  "SUCCESS" | "DUPLICATE_SKIPPED" | "FAILED" | "TIMEOUT" | "DEAD_LETTERED" | "CANCELLED";

export type SubscriptionCriticality = "CRITICAL" | "REQUIRED" | "OPTIONAL";

export type RetryPolicy = Readonly<{
  enabled: boolean;
  maximumAttempts: number;
  initialDelayMs: number;
  maximumDelayMs: number;
  backoffStrategy: "FIXED" | "EXPONENTIAL";
  jitter: "NONE";
}>;

export type DeliveryPolicy = Readonly<{
  retry: RetryPolicy;
  deadLetterOnFailure: boolean;
  idempotent: boolean;
  ordered: boolean;
  handlerTimeoutMs: number;
}>;

export type EventContext<TPayload = unknown> = Readonly<{
  event: ATEEvent<TPayload>;
  subscriptionId: SubscriptionId;
  attempt: number;
  signal: AbortSignal;
  publishChild: <TChildPayload>(
    input: Omit<ChildEventInput<TChildPayload>, "parent">,
  ) => Promise<PublicationResult>;
}>;

export type EventHandler<TPayload = unknown> = (
  context: EventContext<TPayload>,
) => Promise<EventHandlerResult | void> | EventHandlerResult | void;

export type EventSubscription<TPayload = unknown> = Readonly<{
  subscriptionId: SubscriptionId;
  subscriberId: ServiceId | string;
  description: string;
  eventTypes: readonly string[];
  categories?: readonly EventCategory[];
  criticality: SubscriptionCriticality;
  policy: DeliveryPolicy;
  handler: EventHandler<TPayload>;
}>;

export type HandlerDeliveryResult = Readonly<{
  subscriptionId: SubscriptionId;
  subscriberId: ServiceId | string;
  status: DeliveryStatus;
  attempts: number;
  durationMs: number;
  error?: EventError;
}>;

export type PublicationStatus =
  "DELIVERED" | "ACCEPTED" | "REJECTED" | "DUPLICATE" | "DEAD_LETTERED";

export type PublicationResult = Readonly<{
  status: PublicationStatus;
  eventId?: EventId;
  eventType?: string;
  subscriberCount: number;
  successfulDeliveries: number;
  duplicateSkips: number;
  failures: readonly HandlerDeliveryResult[];
  deliveries: readonly HandlerDeliveryResult[];
  deadLettered: boolean;
  retries: number;
  durationMs: number;
  errors: readonly EventError[];
}>;

export type IdempotencyState =
  "RECEIVED" | "PROCESSING" | "SUCCEEDED" | "FAILED_RETRYABLE" | "FAILED_FINAL";

export type DeadLetterRecord = Readonly<{
  deadLetterId: string;
  event: ATEEvent;
  subscriptionId: SubscriptionId;
  failure: EventError;
  attempts: number;
  firstFailureAt: UtcTimestamp;
  finalFailureAt: UtcTimestamp;
  correlationId: CorrelationId;
  causationId?: CausationId;
  subscriberId: ServiceId | string;
  replayCount: number;
}>;

export const subscriptionId = (value: string): SubscriptionId => {
  if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/u.test(value)) {
    throw new Error(`invalid subscription ID: ${value}`);
  }
  return value as SubscriptionId;
};

export type EventDiagnostics = Readonly<{
  totalPublished: number;
  totalDelivered: number;
  totalDuplicate: number;
  totalFailed: number;
  totalRetried: number;
  totalDeadLettered: number;
  pending: number;
  active: number;
  queueUtilization: number;
  subscriptions: number;
  deadLetters: number;
}>;

export type EventBusSnapshot = Readonly<{
  state: EventBusState;
  registeredEventTypes: readonly EventTypeRegistration[];
  subscriptions: readonly Omit<EventSubscription, "handler">[];
  routes: readonly { eventType: string; subscriptionIds: readonly SubscriptionId[] }[];
  diagnostics: EventDiagnostics;
  health: "HEALTHY" | "DEGRADED" | "UNHEALTHY";
  readiness: "READY" | "NOT_READY" | "DEGRADED_READY";
  errors: readonly EventError[];
}>;

export type EventBusOptions = Readonly<{
  maxPendingEvents: number;
  maxPendingPerSubscriber: number;
  maxConcurrentDeliveries: number;
  handlerTimeoutMs: number;
  drainTimeoutMs: number;
  maximumRetries: number;
  retryDelayMs: number;
  maximumCausationDepth: number;
  idempotencyRetention: number;
  deadLetterCapacity: number;
  diagnosticRetention: number;
  backpressurePolicy: "REJECT_NEW";
  eventSizeLimitBytes: number;
}>;
