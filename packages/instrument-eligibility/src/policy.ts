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
  allowQualityWarnings: false,
  policyId: "eligibility.research",
  approvalPolicyId: "eligibility.research",
  maxRecords: 128,
  maxHistory: 512,
  maxEvidence: 32,
  maxDependencies: 64,
  maxRequests: 128,
  maxApprovals: 128,
  maxDiagnostics: 128,
  maxQueryResults: 100,
  maxInputBytes: 65536,
  maxInputDepth: 20,
  maxSnapshotBytes: 1048576,
  maxRetainedBytes: 67108864,
  maxRecoverySteps: 512,
  maxEvidenceAgeMs: 604800000,
  compatibleHistoryPolicies: [],
  validationSources: [],
});
export function validatePolicy(raw: unknown): Policy {
  const p = policySchema.parse(safeClone(raw, 1048576));
  if (new Set(p.compatibleHistoryPolicies).size !== p.compatibleHistoryPolicies.length)
    throw Error("DUPLICATE_POLICY");
  if (new Set(p.validationSources.map((x) => x.sourceId)).size !== p.validationSources.length)
    throw Error("DUPLICATE_SOURCE");
  return freeze(p);
}
export function policyFromEffective(c: EffectiveConfiguration) {
  if (c.context.runtimeMode !== "RESEARCH") throw Error("RESEARCH_MODE_REQUIRED");
  if (c.conflicts.length || c.diagnostics.missingRequiredKeys.length)
    throw Error("CONFIGURATION_INVALID");
  const value = c.values.get("broker.eligibility.policyJson" as ConfigurationKey)?.value;
  if (typeof value !== "string") throw Error("POLICY_REQUIRED");
  return {
    policy: validatePolicy(parseJson(value, 1048576)),
    configurationFingerprint: c.fingerprint,
  };
}
export function eligibilityConfigurationDefinitions(clock: Clock) {
  const key = configurationKey("broker.eligibility.policyJson", clock.now());
  if (!key.ok) throw Error("CONFIGURATION_KEY");
  return [
    {
      key: key.value,
      domain: "BROKER" as const,
      displayName: "Offline governed instrument eligibility policy",
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
        uiHint: "Governed JSON; instrument-eligibility help",
      },
    },
  ];
}
export const eligibilityConfigurationSchemas = (clock: Clock) =>
  eligibilityConfigurationDefinitions(clock).map((d) =>
    configurationSchemaFromDefinition(d, {
      constraints: { minLength: 2, maxLength: 1048576 },
      metadata: { ...d.metadata, examples: [JSON.stringify(defaultPolicy)] },
    }),
  );
export function eligibilityStateOwnership(): StateOwnershipEntry {
  return freeze({
    stateDomain: stateDomain("instrument.eligibility"),
    owner: stateOwner("instrument.eligibility"),
    authorityType: "DERIVED",
    writeAuthority: "instrument.eligibility",
    readers: ["instrument.eligibility"],
    durable: true,
    historyRequired: true,
    reconciliationRequired: true,
    runtimeModes: ["RESEARCH"],
    description:
      "Immutable derived source-declared specification evidence; no identity or execution authority.",
  });
}
export const policyFingerprint = (p: Policy) => fingerprint(p);
