import { domainSchemas, parseDomainContract } from "@ate/domain";
import type { UtcTimestamp } from "@ate/domain";

import { eventError } from "./errors.js";
import type { EventError, EventTypeRegistration, EventCategory } from "./types.js";
import type { RuntimeClock } from "@ate/runtime";

const eventNamePattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){2,}\.v[1-9][0-9]*$/u;

export type EventRegistryResult<T = unknown> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: EventError }>;

export class EventRegistry {
  private readonly registrations = new Map<string, EventTypeRegistration>();

  public constructor(private readonly clock: RuntimeClock) {}

  public register<TPayload>(
    registration: EventTypeRegistration<TPayload>,
  ): EventRegistryResult<EventTypeRegistration<TPayload>> {
    const nameValidation = validateEventName(registration.eventType);
    if (!nameValidation.ok) {
      return { ok: false, error: nameValidation.error };
    }
    const parsedVersion = eventVersionFromType(registration.eventType);
    if (parsedVersion !== registration.version) {
      return {
        ok: false,
        error: eventError({
          code: "EVENT_SCHEMA_INVALID",
          message: `event registration version ${registration.version} does not match ${registration.eventType}`,
          severity: "ERROR",
          timestamp: this.clock.now(),
          eventType: registration.eventType,
        }),
      };
    }
    if (this.registrations.has(registration.eventType)) {
      return {
        ok: false,
        error: eventError({
          code: "EVENT_SCHEMA_INVALID",
          message: `duplicate event type registration: ${registration.eventType}`,
          severity: "ERROR",
          timestamp: this.clock.now(),
          eventType: registration.eventType,
        }),
      };
    }
    this.registrations.set(registration.eventType, registration);
    return { ok: true, value: registration };
  }

  public require(eventType: string): EventRegistryResult<EventTypeRegistration> {
    const registration = this.registrations.get(eventType);
    if (registration === undefined) {
      return {
        ok: false,
        error: eventError({
          code: "EVENT_TYPE_UNREGISTERED",
          message: `event type is not registered: ${eventType}`,
          severity: "ERROR",
          timestamp: this.clock.now(),
          eventType,
        }),
      };
    }
    return { ok: true, value: registration };
  }

  public validateEvent<TPayload>(event: {
    envelope: unknown;
    payload: TPayload;
    eventVersion: number;
  }): EventRegistryResult<EventTypeRegistration<TPayload>> {
    const envelopeResult = parseDomainContract(domainSchemas.eventEnvelope, event.envelope);
    if (!envelopeResult.ok) {
      return {
        ok: false,
        error: eventError({
          code: "EVENT_ENVELOPE_INVALID",
          message: "event envelope failed domain validation",
          severity: "ERROR",
          timestamp: this.clock.now(),
          details: { issues: envelopeResult.issues },
        }),
      };
    }
    const registrationResult = this.require(envelopeResult.value.eventType);
    if (!registrationResult.ok) {
      return registrationResult;
    }
    if (registrationResult.value.version !== event.eventVersion) {
      return {
        ok: false,
        error: eventError({
          code: "EVENT_SCHEMA_INVALID",
          message: "event version does not match registered event type",
          severity: "ERROR",
          timestamp: this.clock.now(),
          eventId: envelopeResult.value.eventId,
          eventType: envelopeResult.value.eventType,
        }),
      };
    }
    const payloadResult = registrationResult.value.schema.safeParse(event.payload);
    if (!payloadResult.success) {
      return {
        ok: false,
        error: eventError({
          code: "EVENT_SCHEMA_INVALID",
          message: "event payload failed registered schema validation",
          severity: "ERROR",
          timestamp: this.clock.now(),
          eventId: envelopeResult.value.eventId,
          eventType: envelopeResult.value.eventType,
          details: { issues: payloadResult.error.issues.map((issue) => issue.message) },
        }),
      };
    }
    return {
      ok: true,
      value: registrationResult.value as EventTypeRegistration<TPayload>,
    };
  }

  public all(): readonly EventTypeRegistration[] {
    return [...this.registrations.values()].map((registration) => ({ ...registration }));
  }
}

export const validateEventName = (eventType: string): EventRegistryResult<string> => {
  if (!eventNamePattern.test(eventType)) {
    return {
      ok: false,
      error: eventError({
        code: "EVENT_SCHEMA_INVALID",
        message: `invalid event type name: ${eventType}`,
        severity: "ERROR",
        timestamp: new Date(0).toISOString() as UtcTimestamp,
        eventType,
      }),
    };
  }
  return { ok: true, value: eventType };
};

export const eventVersionFromType = (eventType: string): number => {
  const version = /\.v([1-9][0-9]*)$/u.exec(eventType)?.[1];
  return version === undefined ? 0 : Number(version);
};

export const isEventCategory = (value: string): value is EventCategory =>
  value === "DOMAIN" ||
  value === "APPLICATION" ||
  value === "INTEGRATION" ||
  value === "AUDIT" ||
  value === "OPERATIONAL";
