import type { RuntimeMode } from "@ate/domain";
import type { StateAuthorityRegistry } from "@ate/persistence";
import { stateDomain, stateOwner } from "@ate/persistence";

export const configurationStateDomain = stateDomain("configuration.controlplane");
export const configurationVersionHistoryStateDomain = stateDomain("configuration.versionhistory");
export const configurationCapabilityControlStateDomain = stateDomain(
  "configuration.capabilitycontrol",
);
export const configurationApprovalStateDomain = stateDomain("configuration.approval");
export const configurationStateOwner = stateOwner("configuration");
export const configurationVersionHistoryStateOwner = stateOwner("configuration.versioning");
export const configurationCapabilityControlStateOwner = stateOwner("configuration.capabilities");
export const configurationApprovalStateOwner = stateOwner("configuration.approval");

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
      "Configuration control-plane authority for current managed configuration snapshots. Immutable version history is owned separately by configuration.versionhistory.",
  });

export const registerConfigurationVersionHistoryStateAuthority = (
  authority: StateAuthorityRegistry,
  runtimeModes: readonly RuntimeMode[],
): ReturnType<StateAuthorityRegistry["register"]> =>
  authority.register({
    stateDomain: configurationVersionHistoryStateDomain,
    owner: configurationVersionHistoryStateOwner,
    authorityType: "INTERNAL_AUTHORITATIVE",
    writeAuthority: "@ate/configuration",
    readers: ["@ate/runtime", "@ate/events", "future-control-center"],
    durable: true,
    historyRequired: true,
    reconciliationRequired: false,
    runtimeModes,
    description:
      "Append-only immutable configuration version-history authority, including current-version pointer, lineage, change sets, diffs and reconstruction metadata.",
  });

export const registerConfigurationCapabilityControlStateAuthority = (
  authority: StateAuthorityRegistry,
  runtimeModes: readonly RuntimeMode[],
): ReturnType<StateAuthorityRegistry["register"]> =>
  authority.register({
    stateDomain: configurationCapabilityControlStateDomain,
    owner: configurationCapabilityControlStateOwner,
    authorityType: "INTERNAL_AUTHORITATIVE",
    writeAuthority: "@ate/configuration",
    readers: ["@ate/runtime", "@ate/events", "future-control-center"],
    durable: true,
    historyRequired: true,
    reconciliationRequired: false,
    runtimeModes,
    description:
      "Capability-control authority for effective capability snapshots derived from build truth, managed configuration flags, runtime-mode gates and dependency state.",
  });

export const registerConfigurationApprovalStateAuthority = (
  authority: StateAuthorityRegistry,
  runtimeModes: readonly RuntimeMode[],
): ReturnType<StateAuthorityRegistry["register"]> =>
  authority.register({
    stateDomain: configurationApprovalStateDomain,
    owner: configurationApprovalStateOwner,
    authorityType: "INTERNAL_AUTHORITATIVE",
    writeAuthority: "@ate/configuration",
    readers: ["@ate/runtime", "@ate/events", "future-control-center"],
    durable: true,
    historyRequired: true,
    reconciliationRequired: false,
    runtimeModes,
    description:
      "Maker-checker configuration approval authority for policies, requests, decisions, revocations, derived eligibility and exact-version governance evidence.",
  });
