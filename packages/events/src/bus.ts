import { domainSchemas, parseDomainContract } from "@ate/domain";
import type { EventId, UtcTimestamp } from "@ate/domain";
import type { RuntimeClock } from "@ate/runtime";

import { eventError, toSafeMessage } from "./errors.js";
import { deepFreeze, type EventFactory } from "./factory.js";
import type { EventRegistry, EventRegistryResult } from "./registry.js";
import type {
  ATEEvent,
  DeadLetterRecord,
  DeliveryPolicy,
  EventBusOptions,
  EventBusSnapshot,
  EventBusState,
  EventContext,
  EventDiagnostics,
  EventError,
  EventHandlerResult,
  EventSubscription,
  HandlerDeliveryResult,
  IdempotencyState,
  PublicationResult,
  RetryPolicy,
  SubscriptionId,
} from "./types.js";

export const defaultRetryPolicy: RetryPolicy = {
  enabled: false,
  maximumAttempts: 1,
  initialDelayMs: 0,
  maximumDelayMs: 0,
  backoffStrategy: "FIXED",
  jitter: "NONE",
};

export const defaultDeliveryPolicy: DeliveryPolicy = {
  retry: defaultRetryPolicy,
  deadLetterOnFailure: true,
  idempotent: true,
  ordered: false,
  handlerTimeoutMs: 1_000,
};

export const defaultEventBusOptions: EventBusOptions = {
  maxPendingEvents: 100,
  maxPendingPerSubscriber: 25,
  maxConcurrentDeliveries: 8,
  handlerTimeoutMs: 1_000,
  drainTimeoutMs: 1_000,
  maximumRetries: 3,
  retryDelayMs: 0,
  maximumCausationDepth: 16,
  idempotencyRetention: 1_000,
  deadLetterCapacity: 100,
  diagnosticRetention: 100,
  backpressurePolicy: "REJECT_NEW",
  eventSizeLimitBytes: 32_768,
};

export type InternalEventBusInput = Readonly<{
  registry: EventRegistry;
  factory: EventFactory;
  clock: RuntimeClock;
  options?: Partial<EventBusOptions>;
}>;

type IdempotencyRecord = Readonly<{
  key: string;
  state: IdempotencyState;
  updatedAt: UtcTimestamp;
}>;

type MutableCounters = {
  totalPublished: number;
  totalDelivered: number;
  totalDuplicate: number;
  totalFailed: number;
  totalRetried: number;
  totalDeadLettered: number;
};

export class InternalEventBus {
  private state: EventBusState = "CREATED";
  private readonly subscriptions = new Map<SubscriptionId, EventSubscription>();
  private readonly processedEventIds = new Set<EventId>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly deadLetters: DeadLetterRecord[] = [];
  private readonly recentErrors: EventError[] = [];
  private readonly deliveryHistory: HandlerDeliveryResult[] = [];
  private readonly orderingLocks = new Map<string, Promise<void>>();
  private readonly subscriberPending = new Map<SubscriptionId, number>();
  private pending = 0;
  private active = 0;
  private readonly counters: MutableCounters = {
    totalPublished: 0,
    totalDelivered: 0,
    totalDuplicate: 0,
    totalFailed: 0,
    totalRetried: 0,
    totalDeadLettered: 0,
  };

  public readonly options: EventBusOptions;

  public constructor(private readonly input: InternalEventBusInput) {
    this.options = validateOptions({ ...defaultEventBusOptions, ...input.options });
  }

  public start(): void {
    if (this.state === "CREATED" || this.state === "STOPPED") {
      this.state = "RUNNING";
    }
  }

  public register<TPayload>(
    subscription: EventSubscription<TPayload>,
  ): EventRegistryResult<EventSubscription<TPayload>> {
    if (this.subscriptions.has(subscription.subscriptionId)) {
      return {
        ok: false,
        error: eventError({
          code: "SUBSCRIPTION_DUPLICATE",
          message: `duplicate subscription id: ${subscription.subscriptionId}`,
          severity: "ERROR",
          timestamp: this.input.clock.now(),
          subscriptionId: subscription.subscriptionId,
        }),
      };
    }
    for (const eventType of subscription.eventTypes) {
      const registered = this.input.registry.require(eventType);
      if (!registered.ok) {
        return registered;
      }
    }
    assertPolicyValid(subscription.policy, this.options);
    this.subscriptions.set(
      subscription.subscriptionId,
      subscription as unknown as EventSubscription,
    );
    return { ok: true, value: subscription };
  }

  public async publish<TPayload>(event: ATEEvent<TPayload>): Promise<PublicationResult> {
    const started = Date.now();
    const errors: EventError[] = [];
    if (this.state === "DRAINING" || this.state === "STOPPING") {
      const error = this.recordError(
        eventError({
          code: "EVENT_BUS_DRAINING",
          message: "event bus is draining and rejects new publication",
          severity: "WARNING",
          timestamp: this.input.clock.now(),
          eventId: event.envelope.eventId,
          eventType: event.envelope.eventType,
        }),
      );
      return this.rejected(event, error, started);
    }
    if (this.state === "STOPPED") {
      const error = this.recordError(
        eventError({
          code: "EVENT_BUS_STOPPED",
          message: "event bus is stopped",
          severity: "ERROR",
          timestamp: this.input.clock.now(),
          eventId: event.envelope.eventId,
          eventType: event.envelope.eventType,
        }),
      );
      return this.rejected(event, error, started);
    }
    if (this.state !== "RUNNING" && this.state !== "DEGRADED") {
      const error = this.recordError(
        eventError({
          code: "EVENT_BUS_NOT_READY",
          message: `event bus is not ready in state ${this.state}`,
          severity: "ERROR",
          timestamp: this.input.clock.now(),
          eventId: event.envelope.eventId,
          eventType: event.envelope.eventType,
        }),
      );
      return this.rejected(event, error, started);
    }
    if (this.processedEventIds.has(event.envelope.eventId)) {
      this.counters.totalDuplicate += 1;
      return {
        status: "DUPLICATE",
        eventId: event.envelope.eventId,
        eventType: event.envelope.eventType,
        subscriberCount: 0,
        successfulDeliveries: 0,
        duplicateSkips: 1,
        failures: [],
        deliveries: [],
        deadLettered: false,
        retries: 0,
        durationMs: Date.now() - started,
        errors: [
          eventError({
            code: "EVENT_DUPLICATE",
            message: "duplicate publication event id skipped",
            severity: "INFO",
            timestamp: this.input.clock.now(),
            eventId: event.envelope.eventId,
            eventType: event.envelope.eventType,
          }),
        ],
      };
    }
    const validation = this.validatePublish(event);
    if (!validation.ok) {
      const error = this.recordError(validation.error);
      return this.rejected(event, error, started);
    }
    const serializedSize = JSON.stringify(event.envelope).length;
    if (serializedSize > this.options.eventSizeLimitBytes) {
      const error = this.recordError(
        eventError({
          code: "EVENT_SCHEMA_INVALID",
          message: "event exceeds configured size limit",
          severity: "ERROR",
          timestamp: this.input.clock.now(),
          eventId: event.envelope.eventId,
          eventType: event.envelope.eventType,
        }),
      );
      return this.rejected(event, error, started);
    }
    if (this.pending >= this.options.maxPendingEvents) {
      const error = this.recordError(
        eventError({
          code: "QUEUE_SATURATED",
          message: "event bus pending queue capacity exhausted",
          severity: "ERROR",
          timestamp: this.input.clock.now(),
          eventId: event.envelope.eventId,
          eventType: event.envelope.eventType,
        }),
      );
      this.state = "DEGRADED";
      return this.rejected(event, error, started);
    }
    const routes = this.route(event);
    this.pending += 1;
    this.processedEventIds.add(event.envelope.eventId);
    this.trimProcessedEvents();
    this.counters.totalPublished += 1;
    try {
      const deliveries = await Promise.all(
        routes.map((subscription) => this.deliver(event, subscription)),
      );
      const failures = deliveries.filter(
        (delivery) => delivery.status !== "SUCCESS" && delivery.status !== "DUPLICATE_SKIPPED",
      );
      const successfulDeliveries = deliveries.filter(
        (delivery) => delivery.status === "SUCCESS",
      ).length;
      const duplicateSkips = deliveries.filter(
        (delivery) => delivery.status === "DUPLICATE_SKIPPED",
      ).length;
      const deadLettered = deliveries.some((delivery) => delivery.status === "DEAD_LETTERED");
      for (const delivery of deliveries) {
        this.recordDelivery(delivery);
      }
      if (
        deliveries.some(
          (delivery) =>
            delivery.status !== "SUCCESS" &&
            this.subscriptions.get(delivery.subscriptionId)?.criticality === "CRITICAL",
        )
      ) {
        this.state = "DEGRADED";
      }
      return deepFreeze({
        status: deadLettered ? "DEAD_LETTERED" : failures.length === 0 ? "DELIVERED" : "ACCEPTED",
        eventId: event.envelope.eventId,
        eventType: event.envelope.eventType,
        subscriberCount: routes.length,
        successfulDeliveries,
        duplicateSkips,
        failures,
        deliveries,
        deadLettered,
        retries: deliveries.reduce((sum, delivery) => sum + Math.max(0, delivery.attempts - 1), 0),
        durationMs: Date.now() - started,
        errors,
      });
    } finally {
      this.pending -= 1;
    }
  }

  public async publishChild<TPayload>(
    parent: ATEEvent,
    input: Omit<Parameters<EventFactory["createChildEvent"]>[0], "parent"> & { payload: TPayload },
  ): Promise<PublicationResult> {
    const child = this.input.factory.createChildEvent({ ...input, parent });
    if (!child.ok) {
      return {
        status: "REJECTED",
        subscriberCount: 0,
        successfulDeliveries: 0,
        duplicateSkips: 0,
        failures: [],
        deliveries: [],
        deadLettered: false,
        retries: 0,
        durationMs: 0,
        errors: [this.recordError(child.error)],
      };
    }
    return this.publish(child.value);
  }

  public deadLetterRecords(): readonly DeadLetterRecord[] {
    return deepFreeze([...this.deadLetters]);
  }

  public async replayDeadLetter(deadLetterId: string): Promise<PublicationResult> {
    const record = this.deadLetters.find((candidate) => candidate.deadLetterId === deadLetterId);
    if (record === undefined) {
      return {
        status: "REJECTED",
        subscriberCount: 0,
        successfulDeliveries: 0,
        duplicateSkips: 0,
        failures: [],
        deliveries: [],
        deadLettered: false,
        retries: 0,
        durationMs: 0,
        errors: [
          this.recordError(
            eventError({
              code: "SUBSCRIPTION_NOT_FOUND",
              message: `dead letter not found: ${deadLetterId}`,
              severity: "ERROR",
              timestamp: this.input.clock.now(),
            }),
          ),
        ],
      };
    }
    this.processedEventIds.delete(record.event.envelope.eventId);
    this.idempotency.delete(this.idempotencyKey(record.subscriptionId, record.event));
    return this.publish(record.event);
  }

  public async drain(): Promise<void> {
    this.state = "DRAINING";
    const started = Date.now();
    while (
      (this.pending > 0 || this.active > 0) &&
      Date.now() - started < this.options.drainTimeoutMs
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    this.state = this.pending > 0 || this.active > 0 ? "DEGRADED" : "STOPPED";
  }

  public async stop(): Promise<void> {
    if (this.state === "STOPPED") {
      return;
    }
    this.state = "STOPPING";
    await this.drain();
  }

  public diagnostics(): EventDiagnostics {
    return deepFreeze({
      ...this.counters,
      pending: this.pending,
      active: this.active,
      queueUtilization: this.pending / this.options.maxPendingEvents,
      subscriptions: this.subscriptions.size,
      deadLetters: this.deadLetters.length,
    });
  }

  public health(): "HEALTHY" | "DEGRADED" | "UNHEALTHY" {
    if (this.state === "FAILED") {
      return "UNHEALTHY";
    }
    if (
      this.state === "DEGRADED" ||
      this.deadLetters.length > 0 ||
      this.pending >= this.options.maxPendingEvents
    ) {
      return "DEGRADED";
    }
    return "HEALTHY";
  }

  public readiness(): "READY" | "NOT_READY" | "DEGRADED_READY" {
    if (this.state !== "RUNNING" && this.state !== "DEGRADED") {
      return "NOT_READY";
    }
    if (this.pending >= this.options.maxPendingEvents) {
      return "NOT_READY";
    }
    return this.health() === "HEALTHY" ? "READY" : "DEGRADED_READY";
  }

  public snapshot(): EventBusSnapshot {
    const registeredEventTypes = this.input.registry.all();
    const subscriptions = [...this.subscriptions.values()].map(
      ({ handler: _handler, ...subscription }) => subscription,
    );
    return deepFreeze({
      state: this.state,
      registeredEventTypes,
      subscriptions,
      routes: registeredEventTypes.map((registration) => ({
        eventType: registration.eventType,
        subscriptionIds: this.routeByType(registration.eventType).map(
          (subscription) => subscription.subscriptionId,
        ),
      })),
      diagnostics: this.diagnostics(),
      health: this.health(),
      readiness: this.readiness(),
      errors: [...this.recentErrors],
    });
  }

  private validatePublish<TPayload>(event: ATEEvent<TPayload>): EventRegistryResult<void> {
    const envelope = parseDomainContract(domainSchemas.eventEnvelope, event.envelope);
    if (!envelope.ok) {
      return {
        ok: false,
        error: eventError({
          code: "EVENT_ENVELOPE_INVALID",
          message: "publication envelope failed domain validation",
          severity: "ERROR",
          timestamp: this.input.clock.now(),
          details: { issues: envelope.issues },
        }),
      };
    }
    if (event.envelope.eventId === (event.envelope.causationId as string | undefined)) {
      return {
        ok: false,
        error: eventError({
          code: "CAUSATION_INVALID",
          message: "event cannot cause itself",
          severity: "ERROR",
          timestamp: this.input.clock.now(),
          eventId: event.envelope.eventId,
          eventType: event.envelope.eventType,
        }),
      };
    }
    if (event.metadata.causationDepth > this.options.maximumCausationDepth) {
      return {
        ok: false,
        error: eventError({
          code: "CAUSATION_DEPTH_EXCEEDED",
          message: "event causation depth exceeds bus maximum",
          severity: "CRITICAL",
          timestamp: this.input.clock.now(),
          eventId: event.envelope.eventId,
          eventType: event.envelope.eventType,
        }),
      };
    }
    const validation = this.input.registry.validateEvent(event);
    if (!validation.ok) {
      return { ok: false, error: validation.error };
    }
    return { ok: true, value: undefined };
  }

  private route(event: ATEEvent): readonly EventSubscription[] {
    return [...this.subscriptions.values()].filter(
      (subscription) =>
        subscription.eventTypes.includes(event.envelope.eventType) ||
        (subscription.categories?.includes(event.category) ?? false),
    );
  }

  private routeByType(eventType: string): readonly EventSubscription[] {
    const registration = this.input.registry.require(eventType);
    if (!registration.ok) {
      return [];
    }
    return this.route({
      envelope: { eventType } as ATEEvent["envelope"],
      category: registration.value.category,
      eventVersion: registration.value.version,
      payload: {},
      metadata: { causationDepth: 0 },
    });
  }

  private async deliver(
    event: ATEEvent,
    subscription: EventSubscription,
  ): Promise<HandlerDeliveryResult> {
    const execute = async (): Promise<HandlerDeliveryResult> => {
      const subscriberPending = this.subscriberPending.get(subscription.subscriptionId) ?? 0;
      if (subscriberPending >= this.options.maxPendingPerSubscriber) {
        return {
          subscriptionId: subscription.subscriptionId,
          subscriberId: subscription.subscriberId,
          status: "FAILED",
          attempts: 0,
          durationMs: 0,
          error: this.recordError(
            eventError({
              code: "QUEUE_SATURATED",
              message: "subscriber pending delivery capacity exhausted",
              severity: "ERROR",
              timestamp: this.input.clock.now(),
              eventId: event.envelope.eventId,
              eventType: event.envelope.eventType,
              subscriptionId: subscription.subscriptionId,
            }),
          ),
        };
      }
      if (this.active >= this.options.maxConcurrentDeliveries) {
        return {
          subscriptionId: subscription.subscriptionId,
          subscriberId: subscription.subscriberId,
          status: "FAILED",
          attempts: 0,
          durationMs: 0,
          error: this.recordError(
            eventError({
              code: "QUEUE_SATURATED",
              message: "maximum concurrent deliveries exhausted",
              severity: "ERROR",
              timestamp: this.input.clock.now(),
              eventId: event.envelope.eventId,
              eventType: event.envelope.eventType,
              subscriptionId: subscription.subscriptionId,
            }),
          ),
        };
      }
      const idempotencyKey = this.idempotencyKey(subscription.subscriptionId, event);
      if (subscription.policy.idempotent) {
        const existing = this.idempotency.get(idempotencyKey);
        if (existing?.state === "PROCESSING" || existing?.state === "SUCCEEDED") {
          this.counters.totalDuplicate += 1;
          return {
            subscriptionId: subscription.subscriptionId,
            subscriberId: subscription.subscriberId,
            status: "DUPLICATE_SKIPPED",
            attempts: 0,
            durationMs: 0,
          };
        }
        this.setIdempotency(idempotencyKey, "PROCESSING");
      }
      this.subscriberPending.set(subscription.subscriptionId, subscriberPending + 1);
      try {
        return await this.invokeWithRetry(event, subscription, idempotencyKey);
      } finally {
        const pending = (this.subscriberPending.get(subscription.subscriptionId) ?? 1) - 1;
        if (pending <= 0) {
          this.subscriberPending.delete(subscription.subscriptionId);
        } else {
          this.subscriberPending.set(subscription.subscriptionId, pending);
        }
      }
    };

    if (subscription.policy.ordered && event.metadata.orderingKey !== undefined) {
      const previous = this.orderingLocks.get(event.metadata.orderingKey) ?? Promise.resolve();
      const execution = previous.then(execute, execute);
      const next = execution.then(
        () => undefined,
        () => undefined,
      );
      this.orderingLocks.set(event.metadata.orderingKey, next);
      const result = await execution;
      if (this.orderingLocks.get(event.metadata.orderingKey) === next) {
        this.orderingLocks.delete(event.metadata.orderingKey);
      }
      return result;
    }
    return execute();
  }

  private async invokeWithRetry(
    event: ATEEvent,
    subscription: EventSubscription,
    idempotencyKey: string,
  ): Promise<HandlerDeliveryResult> {
    const started = Date.now();
    const maxAttempts = subscription.policy.retry.enabled
      ? Math.min(subscription.policy.retry.maximumAttempts, this.options.maximumRetries)
      : 1;
    let attempts = 0;
    let lastFailure: EventError | undefined;
    while (attempts < maxAttempts) {
      attempts += 1;
      this.active += 1;
      try {
        const result = await this.invokeHandler(event, subscription, attempts);
        if (result.status === "SUCCESS" || result.status === undefined) {
          this.counters.totalDelivered += 1;
          this.setIdempotency(idempotencyKey, "SUCCEEDED");
          return {
            subscriptionId: subscription.subscriptionId,
            subscriberId: subscription.subscriberId,
            status: "SUCCESS",
            attempts,
            durationMs: Date.now() - started,
          };
        }
        if (result.status === "DUPLICATE_SKIPPED") {
          this.counters.totalDuplicate += 1;
          return {
            subscriptionId: subscription.subscriptionId,
            subscriberId: subscription.subscriberId,
            status: "DUPLICATE_SKIPPED",
            attempts,
            durationMs: Date.now() - started,
          };
        }
        lastFailure = result.error ?? this.failureFromResult(event, subscription, result);
        if (result.status === "NON_RETRYABLE_FAILURE" || result.status === "CANCELLED") {
          break;
        }
      } catch (error) {
        lastFailure = this.recordError(
          eventError({
            code: "HANDLER_FAILED",
            message: toSafeMessage(error),
            severity: "ERROR",
            timestamp: this.input.clock.now(),
            eventId: event.envelope.eventId,
            eventType: event.envelope.eventType,
            subscriptionId: subscription.subscriptionId,
          }),
        );
      } finally {
        this.active -= 1;
      }
      if (attempts < maxAttempts) {
        this.counters.totalRetried += 1;
        this.setIdempotency(idempotencyKey, "FAILED_RETRYABLE");
        await delay(
          Math.min(
            subscription.policy.retry.initialDelayMs,
            subscription.policy.retry.maximumDelayMs,
          ),
        );
      }
    }
    const failure =
      lastFailure ??
      this.recordError(
        eventError({
          code: "RETRY_EXHAUSTED",
          message: "handler retry attempts exhausted",
          severity: "ERROR",
          timestamp: this.input.clock.now(),
          eventId: event.envelope.eventId,
          eventType: event.envelope.eventType,
          subscriptionId: subscription.subscriptionId,
        }),
      );
    this.counters.totalFailed += 1;
    this.setIdempotency(idempotencyKey, "FAILED_FINAL");
    if (subscription.policy.deadLetterOnFailure) {
      const deadLetter = this.createDeadLetter(event, subscription, failure, attempts);
      this.deadLetters.push(deadLetter);
      this.trimDeadLetters();
      this.counters.totalDeadLettered += 1;
      return {
        subscriptionId: subscription.subscriptionId,
        subscriberId: subscription.subscriberId,
        status: "DEAD_LETTERED",
        attempts,
        durationMs: Date.now() - started,
        error: failure,
      };
    }
    return {
      subscriptionId: subscription.subscriptionId,
      subscriberId: subscription.subscriberId,
      status: failure.code === "HANDLER_TIMEOUT" ? "TIMEOUT" : "FAILED",
      attempts,
      durationMs: Date.now() - started,
      error: failure,
    };
  }

  private async invokeHandler(
    event: ATEEvent,
    subscription: EventSubscription,
    attempt: number,
  ): Promise<EventHandlerResult> {
    const controller = new AbortController();
    const timeoutMs = subscription.policy.handlerTimeoutMs;
    let timeout: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(
          new EventHandlerExecutionError(
            eventError({
              code: "HANDLER_TIMEOUT",
              message: "event handler timed out",
              severity: "ERROR",
              timestamp: this.input.clock.now(),
              eventId: event.envelope.eventId,
              eventType: event.envelope.eventType,
              subscriptionId: subscription.subscriptionId,
            }),
          ),
        );
      }, timeoutMs);
    });
    const context: EventContext = Object.freeze({
      event,
      subscriptionId: subscription.subscriptionId,
      attempt,
      signal: controller.signal,
      publishChild: (input) => this.publishChild(event, input),
    });
    try {
      const result = await Promise.race([subscription.handler(context), timeoutPromise]);
      return result ?? { status: "SUCCESS" };
    } catch (error) {
      if (error instanceof EventHandlerExecutionError) {
        return {
          status: error.eventError.code === "HANDLER_TIMEOUT" ? "TIMEOUT" : "RETRYABLE_FAILURE",
          error: error.eventError,
        };
      }
      if (isEventError(error)) {
        return {
          status: error.code === "HANDLER_TIMEOUT" ? "TIMEOUT" : "RETRYABLE_FAILURE",
          error,
        };
      }
      return {
        status: "RETRYABLE_FAILURE",
        error: this.recordError(
          eventError({
            code: "HANDLER_FAILED",
            message: toSafeMessage(error),
            severity: "ERROR",
            timestamp: this.input.clock.now(),
            eventId: event.envelope.eventId,
            eventType: event.envelope.eventType,
            subscriptionId: subscription.subscriptionId,
          }),
        ),
      };
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }

  private failureFromResult(
    event: ATEEvent,
    subscription: EventSubscription,
    result: EventHandlerResult,
  ): EventError {
    const code = result.status === "TIMEOUT" ? "HANDLER_TIMEOUT" : "HANDLER_FAILED";
    return this.recordError(
      eventError({
        code,
        message: result.reason ?? `handler returned ${result.status}`,
        severity: code === "HANDLER_TIMEOUT" ? "ERROR" : "WARNING",
        timestamp: this.input.clock.now(),
        eventId: event.envelope.eventId,
        eventType: event.envelope.eventType,
        subscriptionId: subscription.subscriptionId,
      }),
    );
  }

  private createDeadLetter(
    event: ATEEvent,
    subscription: EventSubscription,
    failure: EventError,
    attempts: number,
  ): DeadLetterRecord {
    const timestamp = this.input.clock.now();
    return deepFreeze({
      deadLetterId: `${event.envelope.eventId}:${subscription.subscriptionId}:${this.deadLetters.length + 1}`,
      event,
      subscriptionId: subscription.subscriptionId,
      failure,
      attempts,
      firstFailureAt: failure.timestamp,
      finalFailureAt: timestamp,
      correlationId: event.envelope.correlationId,
      ...(event.envelope.causationId === undefined
        ? {}
        : { causationId: event.envelope.causationId }),
      subscriberId: subscription.subscriberId,
      replayCount: 0,
    });
  }

  private idempotencyKey(subscriptionId: SubscriptionId, event: ATEEvent): string {
    return `${subscriptionId}:${event.metadata.idempotencyKey ?? event.envelope.eventId}`;
  }

  private setIdempotency(key: string, state: IdempotencyState): void {
    this.idempotency.set(key, { key, state, updatedAt: this.input.clock.now() });
    while (this.idempotency.size > this.options.idempotencyRetention) {
      const oldest = this.idempotency.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.idempotency.delete(oldest);
    }
  }

  private trimProcessedEvents(): void {
    while (this.processedEventIds.size > this.options.idempotencyRetention) {
      const oldest = this.processedEventIds.values().next().value;
      if (oldest === undefined) {
        break;
      }
      this.processedEventIds.delete(oldest);
    }
  }

  private trimDeadLetters(): void {
    while (this.deadLetters.length > this.options.deadLetterCapacity) {
      this.deadLetters.shift();
    }
  }

  private recordError(error: EventError): EventError {
    this.recentErrors.push(error);
    while (this.recentErrors.length > this.options.diagnosticRetention) {
      this.recentErrors.shift();
    }
    return error;
  }

  private recordDelivery(delivery: HandlerDeliveryResult): void {
    this.deliveryHistory.push(delivery);
    while (this.deliveryHistory.length > this.options.diagnosticRetention) {
      this.deliveryHistory.shift();
    }
  }

  private rejected(event: ATEEvent, error: EventError, started: number): PublicationResult {
    return deepFreeze({
      status: "REJECTED",
      eventId: event.envelope.eventId,
      eventType: event.envelope.eventType,
      subscriberCount: 0,
      successfulDeliveries: 0,
      duplicateSkips: 0,
      failures: [],
      deliveries: [],
      deadLettered: false,
      retries: 0,
      durationMs: Date.now() - started,
      errors: [error],
    });
  }
}

const delay = async (durationMs: number): Promise<void> => {
  if (durationMs <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, durationMs));
};

const isEventError = (value: unknown): value is EventError =>
  typeof value === "object" && value !== null && "code" in value && "severity" in value;

class EventHandlerExecutionError extends Error {
  public constructor(public readonly eventError: EventError) {
    super(eventError.message);
    this.name = "EventHandlerExecutionError";
  }
}

const assertPolicyValid = (policy: DeliveryPolicy, options: EventBusOptions): void => {
  if (policy.retry.maximumAttempts < 1 || policy.retry.maximumAttempts > options.maximumRetries) {
    throw new Error("subscription retry maximumAttempts must be bounded by bus maximumRetries");
  }
  if (policy.handlerTimeoutMs <= 0 || policy.handlerTimeoutMs > options.handlerTimeoutMs) {
    throw new Error(
      "subscription handlerTimeoutMs must be positive and no greater than bus handlerTimeoutMs",
    );
  }
};

export const validateOptions = (options: EventBusOptions): EventBusOptions => {
  const positive = [
    ["maxPendingEvents", options.maxPendingEvents],
    ["maxPendingPerSubscriber", options.maxPendingPerSubscriber],
    ["maxConcurrentDeliveries", options.maxConcurrentDeliveries],
    ["handlerTimeoutMs", options.handlerTimeoutMs],
    ["drainTimeoutMs", options.drainTimeoutMs],
    ["maximumRetries", options.maximumRetries],
    ["idempotencyRetention", options.idempotencyRetention],
    ["deadLetterCapacity", options.deadLetterCapacity],
    ["diagnosticRetention", options.diagnosticRetention],
    ["eventSizeLimitBytes", options.eventSizeLimitBytes],
  ] as const;
  for (const [name, value] of positive) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`invalid event bus option ${name}: expected positive integer`);
    }
  }
  if (!Number.isInteger(options.maximumCausationDepth) || options.maximumCausationDepth < 0) {
    throw new Error("invalid event bus option maximumCausationDepth");
  }
  if (options.retryDelayMs < 0) {
    throw new Error("invalid event bus option retryDelayMs");
  }
  return options;
};
