import { z } from "zod";
import { runtimeModes } from "@ate/domain";
import type { EventFactory, EventTypeRegistration, InternalEventBus } from "@ate/events";
import { serviceDescriptor, type RuntimeManagedService, type ServiceId } from "@ate/runtime";
import type { Clock } from "@ate/time";
import type { RealtimeDataService } from "./service.js";

export const realtimeControlEvent = {
  eventType: "data.realtime.control.changed.v1",
  category: "OPERATIONAL",
  version: 1,
  schema: z
    .object({
      kind: z.enum(["CONNECTION", "SUBSCRIPTION", "GAP", "CAPTURE", "HEALTH"]),
      sourceId: z.string().max(128),
      sessionId: z.string().max(128),
      state: z.string().max(64),
      timestamp: z.string().max(64),
    })
    .strict(),
  description:
    "Bounded realtime lifecycle, integrity and capture summaries; never individual observations.",
  owner: "@ate/realtime-data",
} satisfies EventTypeRegistration;
export const flushRealtimeControl = async (
  service: RealtimeDataService,
  factory: EventFactory,
  bus: InternalEventBus,
  limit: number,
): Promise<Readonly<{ published: number; failed: number }>> => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new Error("control flush bounds");
  let published = 0,
    failed = 0;
  for (let i = 0; i < limit; i++) {
    const record = service.readControl();
    if (!record) break;
    const event = factory.createRootEvent({
      eventType: realtimeControlEvent.eventType,
      payload: record,
    });
    if (!event.ok) {
      failed++;
      continue;
    }
    const result = await bus.publish(event.value);
    if (result.status === "DELIVERED" || result.status === "ACCEPTED") published++;
    else failed++;
  }
  return { published, failed };
};
export class RealtimeRuntimeService {
  public readonly managedService: RuntimeManagedService;
  public constructor(
    private readonly service: RealtimeDataService,
    clock: Clock,
  ) {
    const serviceId = "realtime-data-ingestion" as ServiceId;
    this.managedService = {
      descriptor: serviceDescriptor({
        serviceId,
        name: "Realtime Data Ingestion",
        version: "0.17.0-realtime-data.1",
        description: "Bounded data-only ingestion and capture.",
        criticality: "OPTIONAL",
        dependencies: [],
        optionalDependencies: [],
        supportedModes: runtimeModes,
        degradationPolicy: "CONTINUE_WITHOUT_CAPABILITY",
        capabilities: ["MARKET_DATA_READ"],
        healthCapability: true,
        readinessCapability: true,
        recoverable: true,
      }),
      initialize: async () => {
        const result = await service.start();
        if (!result.ok) throw new Error(result.error.code);
      },
      stop: async () => {
        const result = await service.stop();
        if (!result.ok) throw new Error(result.error.code);
      },
      checkHealth: async () => {
        await Promise.resolve();
        const d = service.diagnostics();
        return {
          status:
            d.state === "READY" && d.providers.every((p) => p.state !== "FAILED")
              ? "HEALTHY"
              : "DEGRADED",
          timestamp: clock.now(),
          serviceId,
          reason: "ingestion health is separate from stream quality",
          details: { providerCount: d.providers.length },
        };
      },
      checkReadiness: async () => {
        await Promise.resolve();
        return {
          status: service.readiness() ? "READY" : "NOT_READY",
          timestamp: clock.now(),
          serviceId,
          reason: "configured required-source policy; no trading authority",
          details: { tradingAuthorized: false },
        };
      },
    };
  }
  public diagnostics() {
    return this.service.diagnostics();
  }
}
