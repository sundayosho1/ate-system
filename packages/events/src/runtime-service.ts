import type {
  HealthReport,
  LifecycleRecord,
  ReadinessReport,
  RuntimeManagedService,
  ServiceId,
} from "@ate/runtime";
import { serviceDescriptor } from "@ate/runtime";
import { z } from "zod";

import type { InternalEventBus } from "./bus.js";
import type { EventFactory } from "./factory.js";
import type { EventRegistry } from "./registry.js";
import type { EventTypeRegistration, PublicationResult } from "./types.js";

export const eventBusServiceId = "event.bus" as ServiceId;

export const createEventBusRuntimeService = (bus: InternalEventBus): RuntimeManagedService => ({
  descriptor: serviceDescriptor({
    serviceId: eventBusServiceId,
    name: "ATE Internal Event Bus",
    version: "0.4.0-events.1",
    description:
      "In-process event routing, delivery, idempotency, retry, dead-letter, and diagnostics service.",
    criticality: "REQUIRED",
    dependencies: [],
    optionalDependencies: [],
    supportedModes: ["DEVELOPMENT", "RESEARCH", "BACKTEST", "SIMULATION", "PAPER", "LIVE"],
    degradationPolicy: "BLOCK_READINESS",
    capabilities: ["EVENT_BUS"],
    healthCapability: true,
    readinessCapability: true,
    recoverable: true,
  }),
  start: () => {
    bus.start();
  },
  stop: async () => {
    await bus.stop();
  },
  checkHealth: (context): HealthReport => ({
    status:
      bus.health() === "HEALTHY"
        ? "HEALTHY"
        : bus.health() === "DEGRADED"
          ? "DEGRADED"
          : "UNHEALTHY",
    timestamp: context.now(),
    serviceId: eventBusServiceId,
    details: bus.diagnostics(),
  }),
  checkReadiness: (context): ReadinessReport => ({
    status: bus.readiness(),
    timestamp: context.now(),
    serviceId: eventBusServiceId,
    details: bus.diagnostics(),
  }),
  degrade: () => undefined,
});

const lifecycleRecordSchema = z.object({
  timestamp: z.string(),
  runtimeInstanceId: z.string(),
  runtimeMode: z.enum(["DEVELOPMENT", "RESEARCH", "BACKTEST", "SIMULATION", "PAPER", "LIVE"]),
  transition: z.string(),
  correlationId: z.string().optional(),
  serviceId: z.string().optional(),
  reason: z.string().optional(),
  error: z.unknown().optional(),
  durationMs: z.number().optional(),
});

export const lifecycleEventRegistration: EventTypeRegistration<LifecycleRecord> = {
  eventType: "runtime.lifecycle.recorded.v1",
  category: "OPERATIONAL",
  version: 1,
  schema: lifecycleRecordSchema as unknown as z.ZodType<LifecycleRecord>,
  description:
    "Prompt 3 lifecycle record represented as a Prompt 4 operational event after event bus bootstrap.",
  owner: "@ate/runtime",
};

export const publishLifecycleRecord = async (
  bus: InternalEventBus,
  factory: EventFactory,
  record: LifecycleRecord,
): Promise<PublicationResult> => {
  const event = factory.createRootEvent({
    eventType: lifecycleEventRegistration.eventType,
    payload: record,
    ...(record.correlationId === undefined ? {} : { correlationId: record.correlationId }),
    metadata: {
      idempotencyKey: `${record.runtimeInstanceId}:${record.transition}:${record.timestamp}:${record.serviceId ?? "runtime"}`,
      provenance: {
        runtimeInstanceId: record.runtimeInstanceId,
        component: "runtime-lifecycle-bridge",
      },
    },
  });
  if (!event.ok) {
    return Promise.resolve({
      status: "REJECTED",
      subscriberCount: 0,
      successfulDeliveries: 0,
      duplicateSkips: 0,
      failures: [],
      deliveries: [],
      deadLettered: false,
      retries: 0,
      durationMs: 0,
      errors: [event.error],
    });
  }
  return bus.publish(event.value);
};

export const registerLifecycleBridgeEvent = (registry: EventRegistry): void => {
  const result = registry.register(lifecycleEventRegistration);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
};
