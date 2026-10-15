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
  maxSpecifications: 128,
  maxRevisions: 128,
  maxFields: 128,
  maxPriceTiers: 32,
  maxQuantityTiers: 32,
  maxSessionIntervals: 366,
  maxLifecycleEvents: 32,
  maxComparisons: 128,
  maxDiagnostics: 256,
  maxHistoryDepth: 128,
  maxSnapshotBytes: 4194304,
  maxRetainedBytes: 67108864,
  maxInputBytes: 65536,
  maxInputDepth: 20,
  maxQueryResults: 100,
  maxSourceAgeMs: 86400000,
  compatibleHistoryPolicies: [],
});
export function validatePolicy(raw: unknown): Policy {
  const p = policySchema.parse(safeClone(raw, 1048576));
  if (new Set(p.compatibleHistoryPolicies).size !== p.compatibleHistoryPolicies.length)
    throw Error("DUPLICATE_POLICY");
  return freeze(p);
}
export function policyFromEffective(c: EffectiveConfiguration) {
  if (c.context.runtimeMode !== "RESEARCH") throw Error("RESEARCH_MODE_REQUIRED");
  if (c.conflicts.length || c.diagnostics.missingRequiredKeys.length)
    throw Error("CONFIGURATION_INVALID");
  const value = c.values.get("broker.specifications.policyJson" as ConfigurationKey)?.value;
  if (typeof value !== "string") throw Error("POLICY_REQUIRED");
  return {
    policy: validatePolicy(parseJson(value, 1048576)),
    configurationFingerprint: c.fingerprint,
  };
}
export function specificationConfigurationDefinitions(clock: Clock) {
  const key = configurationKey("broker.specifications.policyJson", clock.now());
  if (!key.ok) throw Error("CONFIGURATION_KEY");
  return [
    {
      key: key.value,
      domain: "BROKER" as const,
      displayName: "Offline instrument specification validation policy",
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
        uiHint: "Governed JSON; instrument-specifications help",
      },
    },
  ];
}
export const specificationConfigurationSchemas = (clock: Clock) =>
  specificationConfigurationDefinitions(clock).map((d) =>
    configurationSchemaFromDefinition(d, {
      constraints: { minLength: 2, maxLength: 1048576 },
      metadata: { ...d.metadata, examples: [JSON.stringify(defaultPolicy)] },
    }),
  );
export function specificationStateOwnership(): StateOwnershipEntry {
  return freeze({
    stateDomain: stateDomain("instrument.specifications"),
    owner: stateOwner("instrument.specifications"),
    authorityType: "DERIVED",
    writeAuthority: "instrument.specifications",
    readers: ["instrument.specifications"],
    durable: true,
    historyRequired: true,
    reconciliationRequired: true,
    runtimeModes: ["RESEARCH"],
    description:
      "Immutable derived source-declared specification evidence; no identity or execution authority.",
  });
}
export const policyFingerprint = (p: Policy) => fingerprint(p);
