import { runtimeModes } from "@ate/domain";
import type { StateAuthorityRegistry, StateDomain, StateOwner } from "@ate/persistence";
export const registerRealtimeStateAuthority = (registry: StateAuthorityRegistry) => {
  const session = registry.register({
    stateDomain: "data.realtime.sessions" as StateDomain,
    owner: "realtime-data" as StateOwner,
    authorityType: "EPHEMERAL",
    writeAuthority: "@ate/realtime-data",
    readers: ["@ate/runtime", "@ate/events"],
    durable: false,
    historyRequired: false,
    reconciliationRequired: true,
    runtimeModes,
    description:
      "Bounded connection/subscription/stream evidence; desired subscriptions are supplied by authorized configuration.",
  });
  if (!session.ok) return session;
  return registry.register({
    stateDomain: "data.realtime.captures" as StateDomain,
    owner: "realtime-data" as StateOwner,
    authorityType: "INTERNAL_AUTHORITATIVE",
    writeAuthority: "@ate/realtime-data",
    readers: ["@ate/historical-data", "@ate/data-quality", "@ate/dataset-catalogue"],
    durable: true,
    historyRequired: false,
    reconciliationRequired: true,
    runtimeModes,
    description:
      "Capture manifest/content integrity only; no dataset, quality or catalogue ownership.",
  });
};
