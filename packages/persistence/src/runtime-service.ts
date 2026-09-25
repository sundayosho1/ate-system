import type { HealthReport, ReadinessReport, RuntimeManagedService, ServiceId } from "@ate/runtime";
import { serviceDescriptor } from "@ate/runtime";

import type { InMemoryPersistenceEngine } from "./memory.js";

export const persistenceServiceId = "persistence" as ServiceId;
export const outboxDispatcherServiceId = "persistence.outbox" as ServiceId;

export const createPersistenceRuntimeService = (
  persistence: InMemoryPersistenceEngine,
): RuntimeManagedService => ({
  descriptor: serviceDescriptor({
    serviceId: persistenceServiceId,
    name: "ATE Persistence",
    version: "0.5.0-persistence.1",
    description:
      "Persistence/state authority foundation with transactions, migrations, history, audit, outbox, inbox and diagnostics.",
    criticality: "CRITICAL",
    supportedModes: ["DEVELOPMENT", "RESEARCH", "BACKTEST", "SIMULATION", "PAPER", "LIVE"],
    capabilities: ["PERSISTENCE", "STATE_AUTHORITY"],
    degradationPolicy: "FAIL_RUNTIME",
    healthCapability: true,
    readinessCapability: true,
    recoverable: true,
  }),
  initialize: () => {
    const result = persistence.connect();
    if (!result.ok) {
      throw new Error(result.error.message);
    }
  },
  stop: () => {
    persistence.disconnect();
  },
  checkHealth: (context): HealthReport => {
    const snapshot = persistence.snapshot();
    return {
      status:
        snapshot.health === "HEALTHY"
          ? "HEALTHY"
          : snapshot.health === "DEGRADED"
            ? "DEGRADED"
            : "UNHEALTHY",
      timestamp: context.now(),
      serviceId: persistenceServiceId,
      details: snapshot.diagnostics,
    };
  },
  checkReadiness: (context): ReadinessReport => ({
    status: persistence.snapshot().readiness,
    timestamp: context.now(),
    serviceId: persistenceServiceId,
    details: persistence.diagnostics(),
  }),
});
