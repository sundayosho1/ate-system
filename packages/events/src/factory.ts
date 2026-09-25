import { randomUUID } from "node:crypto";

import { domainSchemas, parseDomainContract } from "@ate/domain";
import type { CausationId, CorrelationId, EventId, EventEnvelope } from "@ate/domain";

import { eventError } from "./errors.js";
import { eventVersionFromType, type EventRegistry, type EventRegistryResult } from "./registry.js";
import type { ATEEvent, ChildEventInput, EventFactoryContext, RootEventInput } from "./types.js";

const defaultSensitivity = "INTERNAL" as const;

export class EventFactory {
  public constructor(
    private readonly registry: EventRegistry,
    private readonly context: EventFactoryContext,
  ) {}

  public createRootEvent<TPayload>(
    input: RootEventInput<TPayload>,
  ): EventRegistryResult<ATEEvent<TPayload>> {
    const eventId = input.eventId ?? (this.context.idGenerator() as EventId);
    const correlationId = input.correlationId ?? (this.context.idGenerator() as CorrelationId);
    return this.createEvent({
      eventId,
      eventType: input.eventType,
      correlationId,
      payload: input.payload,
      metadata: {
        ...input.metadata,
        causationDepth: input.metadata?.causationDepth ?? 0,
      },
    });
  }

  public createChildEvent<TPayload>(
    input: ChildEventInput<TPayload>,
  ): EventRegistryResult<ATEEvent<TPayload>> {
    const eventId = input.eventId ?? (this.context.idGenerator() as EventId);
    if (eventId === input.parent.envelope.eventId) {
      return {
        ok: false,
        error: eventError({
          code: "CAUSATION_INVALID",
          message: "event cannot cause itself",
          severity: "ERROR",
          timestamp: this.context.clock.now(),
          eventId,
          eventType: input.eventType,
        }),
      };
    }
    const causationDepth = input.parent.metadata.causationDepth + 1;
    if (causationDepth > this.context.maxCausationDepth) {
      return {
        ok: false,
        error: eventError({
          code: "CAUSATION_DEPTH_EXCEEDED",
          message: `causation depth ${causationDepth} exceeds maximum ${this.context.maxCausationDepth}`,
          severity: "CRITICAL",
          timestamp: this.context.clock.now(),
          eventId,
          eventType: input.eventType,
        }),
      };
    }
    return this.createEvent({
      eventId,
      eventType: input.eventType,
      causationId: input.parent.envelope.eventId as string as CausationId,
      correlationId: input.parent.envelope.correlationId,
      payload: input.payload,
      metadata: {
        ...input.metadata,
        causationDepth,
      },
    });
  }

  private createEvent<TPayload>(input: {
    eventId: EventId;
    eventType: string;
    correlationId: CorrelationId;
    payload: TPayload;
    causationId?: CausationId;
    metadata: NonNullable<RootEventInput<TPayload>["metadata"]>;
  }): EventRegistryResult<ATEEvent<TPayload>> {
    const registration = this.registry.require(input.eventType);
    if (!registration.ok) {
      return registration;
    }
    const eventVersion = eventVersionFromType(input.eventType);
    const envelope: EventEnvelope = {
      schemaVersion: 1 as unknown as EventEnvelope["schemaVersion"],
      eventId: input.eventId,
      eventType: input.eventType,
      eventTimestamp: this.context.clock.now(),
      source: this.context.source,
      actor: this.context.actor,
      correlationId: input.correlationId,
      ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      runtimeMode: this.context.runtimeMode,
      payload: input.payload,
    };
    const envelopeResult = parseDomainContract(domainSchemas.eventEnvelope, envelope);
    if (!envelopeResult.ok) {
      return {
        ok: false,
        error: eventError({
          code: "EVENT_ENVELOPE_INVALID",
          message: "created event envelope failed domain validation",
          severity: "ERROR",
          timestamp: this.context.clock.now(),
          eventId: input.eventId,
          eventType: input.eventType,
          details: { issues: envelopeResult.issues },
        }),
      };
    }
    const event: ATEEvent<TPayload> = {
      envelope,
      category: registration.value.category,
      eventVersion,
      payload: input.payload,
      metadata: {
        causationDepth: input.metadata.causationDepth ?? 0,
        sensitivity: input.metadata.sensitivity ?? defaultSensitivity,
        ...(input.metadata.idempotencyKey === undefined
          ? { idempotencyKey: input.eventId }
          : { idempotencyKey: input.metadata.idempotencyKey }),
        ...(input.metadata.orderingKey === undefined
          ? {}
          : { orderingKey: input.metadata.orderingKey }),
        ...(input.metadata.priority === undefined ? {} : { priority: input.metadata.priority }),
        ...(input.metadata.provenance === undefined
          ? {}
          : { provenance: input.metadata.provenance }),
      },
    };
    const validation = this.registry.validateEvent(event);
    if (!validation.ok) {
      return validation;
    }
    return { ok: true, value: freezeEvent(event) };
  }
}

export const defaultEventIdGenerator = (): string => randomUUID();

export const freezeEvent = <TPayload>(event: ATEEvent<TPayload>): ATEEvent<TPayload> =>
  deepFreeze(structuredClone(event));

export const deepFreeze = <T>(value: T): T => {
  if (shouldSkipDeepFreeze(value)) {
    return value;
  }
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
};

const shouldSkipDeepFreeze = (value: unknown): boolean =>
  typeof value === "function" ||
  (typeof value === "object" &&
    value !== null &&
    ("_zod" in value || "_def" in value || value instanceof AbortSignal));

export const buildCausationChain = (events: readonly ATEEvent[]): readonly EventId[] => {
  const byId = new Map<string, ATEEvent>(events.map((event) => [event.envelope.eventId, event]));
  const child = events.at(-1);
  if (child === undefined) {
    return [];
  }
  const chain: EventId[] = [child.envelope.eventId];
  let cursor = child;
  while (cursor.envelope.causationId !== undefined) {
    const parent = byId.get(cursor.envelope.causationId);
    if (parent === undefined) {
      break;
    }
    chain.unshift(parent.envelope.eventId);
    cursor = parent;
  }
  return chain;
};
