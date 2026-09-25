import type { RuntimeMode } from "@ate/domain";
import type { StateAuthorityRegistry } from "@ate/persistence";
import { stateDomain, stateOwner } from "@ate/persistence";

export const configurationStateDomain = stateDomain("configuration.controlplane");
export const configurationStateOwner = stateOwner("configuration");

export const registerConfigurationStateAuthority = (
  authority: StateAuthorityRegistry,
  runtimeModes: readonly RuntimeMode[],
): ReturnType<StateAuthorityRegistry["register"]> =>
  authority.register({
    stateDomain: configurationStateDomain,
    owner: configurationStateOwner,
    authorityType: "INTERNAL_AUTHORITATIVE",
    writeAuthority: "@ate/configuration",
    readers: ["@ate/runtime", "@ate/events", "future-control-center"],
    durable: true,
    historyRequired: true,
    reconciliationRequired: false,
    runtimeModes,
    description:
      "Configuration control-plane authority for current managed configuration snapshots. Full version lifecycle is Prompt 9 scope.",
  });
