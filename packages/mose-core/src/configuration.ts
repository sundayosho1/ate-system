import { TimeframeRegistry, standardTimeframes } from "@ate/multitimeframe";
import { configurationApprovalPolicyId } from "@ate/configuration";
import {
  configurationKey,
  configurationSchemaFromDefinition,
  type EffectiveConfiguration,
} from "@ate/configuration";
import { stateDomain, stateOwner, type StateOwnershipEntry } from "@ate/persistence";
import { mustParseUtc, type Clock } from "@ate/time";
import { policySchema } from "./contracts.js";
import { clone, freeze, parseJSON } from "./primitives.js";
export function moseConfigurationDefinitions(clock: Clock) {
  const key = configurationKey("surveillance.mose.policyJson", clock.now());
  if (!key.ok) throw Error("CONFIGURATION_INVALID");
  return [
    {
      key: key.value,
      domain: "SURVEILLANCE" as const,
      displayName: "Offline MOSE research surveillance",
      description: "Explicit versioned offline policy; no future funnel authority.",
      valueType: "STRING" as const,
      required: false,
      failClosed: true,
      allowedScopes: ["SYSTEM" as const],
      mergePolicy: "REPLACE" as const,
      sensitivity: "INTERNAL" as const,
      metadata: {
        purpose: "Bounded offline surveillance",
        riskImplication: "Missing evidence denies observation",
        reloadRequirement: "RESTART" as const,
        uiHint: "mose-core help",
      },
    },
  ];
}
export const moseConfigurationSchemas = (clock: Clock) =>
  moseConfigurationDefinitions(clock).map((d) =>
    configurationSchemaFromDefinition(d, {
      constraints: { minLength: 2, maxLength: 65536 },
      metadata: d.metadata,
    }),
  );
export function readPolicy(c: EffectiveConfiguration, clock: Clock) {
  if (
    c.context.runtimeMode !== "RESEARCH" ||
    c.conflicts.length ||
    c.diagnostics.missingRequiredKeys.length ||
    !["VIRTUAL", "SIMULATION", "REPLAY"].includes(clock.mode) ||
    !["ACCEPTABLE", "SYNCHRONIZED"].includes(clock.provenance.quality)
  )
    throw Error("CONFIGURATION_INVALID");
  const raw = [...c.values].find(([key]) => key === "surveillance.mose.policyJson")?.[1].value;
  if (typeof raw !== "string" || Buffer.byteLength(raw) > 65536)
    throw Error("CONFIGURATION_INVALID");
  let input: unknown;
  try {
    input = clone(parseJSON(raw, 65536), 65536);
  } catch {
    throw Error("CONFIGURATION_INVALID");
  }
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) throw Error("CONFIGURATION_INVALID");
  const policy = parsed.data;
  if (
    c.resolvedAt > clock.now() ||
    new Set(policy.requiredTimeframes).size !== policy.requiredTimeframes.length
  )
    throw Error("CONFIGURATION_INVALID");
  try {
    configurationApprovalPolicyId(policy.approvalPolicyId);
    const registry = new TimeframeRegistry(standardTimeframes());
    for (const tf of policy.requiredTimeframes) registry.get(tf);
  } catch {
    throw Error("CONFIGURATION_INVALID");
  }
  if (policy.effectiveAt > mustParseUtc(clock.now())) throw Error("POLICY_NOT_EFFECTIVE");
  return freeze({ policy, snapshotId: c.snapshotId, configurationFingerprint: c.fingerprint });
}
export function moseStateOwnership(): StateOwnershipEntry {
  return freeze({
    stateDomain: stateDomain("mose.surveillance"),
    owner: stateOwner("mose.core"),
    authorityType: "DERIVED",
    writeAuthority: "mose.core",
    readers: ["mose.core"],
    durable: true,
    historyRequired: true,
    reconciliationRequired: true,
    runtimeModes: ["RESEARCH"],
    description:
      "Offline MOSE observations and accounting only; no market, eligibility or execution authority.",
  });
}
