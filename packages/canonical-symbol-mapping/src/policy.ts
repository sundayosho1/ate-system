import {
  configurationKey,
  configurationSchemaFromDefinition,
  fingerprint,
  type ConfigurationKey,
  type EffectiveConfiguration,
} from "@ate/configuration";
import type { Clock } from "@ate/time";
import { stateDomain, stateOwner, type StateOwnershipEntry } from "@ate/persistence";
import { freeze } from "@ate/multitimeframe";
import { policySchema, type Policy } from "./contracts.js";
import { safeClone, parseJson } from "./boundary.js";
export const defaultPolicy: Policy = freeze({
  version: 1,
  maxCatalogues: 16,
  maxNamespaces: 16,
  maxObservations: 256,
  maxClaims: 16,
  maxCandidates: 128,
  maxConflicts: 512,
  maxGroupMembers: 256,
  maxSets: 128,
  maxSnapshotBytes: 4194304,
  maxRetainedBytes: 67108864,
  maxInputBytes: 65536,
  maxInputDepth: 20,
  maxQueryResults: 100,
  maxRegistryHistory: 512,
  maxSourceAgeMs: 86400000,
  requireVerifiedIdentifiers: false,
  minIndependentClaims: 1,
  identifierSchemes: ["RESEARCH", "ISIN", "FIGI"],
  sourceQuality: ["SYNTHETIC", "UNVERIFIED_RECORDED"],
  canonicalQualification: ["EVIDENCE_QUALIFIED", "VERIFIED"],
  compatibleHistoryPolicies: [],
});
export function validatePolicy(raw: unknown): Policy {
  const p = policySchema.parse(safeClone(raw, 1048576));
  for (const xs of [
    p.identifierSchemes,
    p.sourceQuality,
    p.canonicalQualification,
    p.compatibleHistoryPolicies,
  ])
    if (new Set(xs).size !== xs.length) throw Error("DUPLICATE_POLICY");
  return freeze(p);
}
export function policyFromEffective(c: EffectiveConfiguration) {
  if (c.context.runtimeMode !== "RESEARCH") throw Error("RESEARCH_MODE_REQUIRED");
  if (c.conflicts.length || c.diagnostics.missingRequiredKeys.length)
    throw Error("CONFIGURATION_INVALID");
  const value = c.values.get("broker.mapping.policyJson" as ConfigurationKey)?.value;
  if (typeof value !== "string") throw Error("POLICY_REQUIRED");
  return {
    policy: validatePolicy(parseJson(value, 1048576)),
    configurationFingerprint: c.fingerprint,
  };
}
export function mappingConfigurationDefinitions(clock: Clock) {
  const key = configurationKey("broker.mapping.policyJson", clock.now());
  if (!key.ok) throw Error("CONFIGURATION_KEY");
  return [
    {
      key: key.value,
      domain: "BROKER" as const,
      displayName: "Offline canonical mapping evidence policy",
      description: "Bounded derived whole-observation qualification; no trading authority.",
      valueType: "STRING" as const,
      required: false,
      failClosed: true,
      allowedScopes: ["SYSTEM" as const, "ENVIRONMENT" as const],
      mergePolicy: "REPLACE" as const,
      sensitivity: "INTERNAL" as const,
      metadata: {
        purpose: "Offline evidence qualification",
        riskImplication: "Insufficient or conflicting claims cannot qualify identity",
        reloadRequirement: "RESTART" as const,
        uiHint: "Governed JSON; canonical-symbol-mapping help",
      },
    },
  ];
}
export const mappingConfigurationSchemas = (clock: Clock) =>
  mappingConfigurationDefinitions(clock).map((d) =>
    configurationSchemaFromDefinition(d, {
      constraints: { minLength: 2, maxLength: 1048576 },
      metadata: { ...d.metadata, examples: [JSON.stringify(defaultPolicy)] },
    }),
  );
export function mappingStateOwnership(): StateOwnershipEntry {
  return freeze({
    stateDomain: stateDomain("canonical.mapping"),
    owner: stateOwner("canonical.mapping"),
    authorityType: "DERIVED",
    writeAuthority: "canonical.mapping",
    readers: ["canonical.mapping"],
    durable: true,
    historyRequired: true,
    reconciliationRequired: true,
    runtimeModes: ["RESEARCH"],
    description:
      "Immutable offline derived mapping sets; upstream identity and approvals remain authoritative.",
  });
}
export const policyFingerprint = (p: Policy) => fingerprint(p);
