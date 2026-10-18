import {
  configurationKey,
  configurationSchemaFromDefinition,
  type EffectiveConfiguration,
} from "@ate/configuration";
import { stateDomain, stateOwner, type StateOwnershipEntry } from "@ate/persistence";
import type { Clock } from "@ate/time";
import { readScannerPolicy } from "@ate/mose-scanner";
import { policySchema } from "./contracts.js";
import { boundedClone, frozen } from "./primitives.js";
export function attentionConfigurationDefinitions(clock: Clock) {
  const key = configurationKey("surveillance.attention.policyJson", clock.now());
  if (!key.ok) throw Error("CONFIGURATION_INVALID");
  return [
    {
      key: key.value,
      domain: "SURVEILLANCE" as const,
      displayName: "Offline adaptive attention",
      description: "Bounded research recommendations; no opportunity or financial authority",
      valueType: "STRING" as const,
      required: true,
      failClosed: true,
      allowedScopes: ["SYSTEM" as const],
      mergePolicy: "REPLACE" as const,
      sensitivity: "INTERNAL" as const,
      metadata: {
        purpose: "Research computational attention",
        riskImplication: "Unknown evidence cannot enhance attention",
        reloadRequirement: "RESTART" as const,
        uiHint: "mose-attention help",
      },
    },
  ];
}
export const attentionConfigurationSchemas = (clock: Clock) =>
  attentionConfigurationDefinitions(clock).map((d) =>
    configurationSchemaFromDefinition(d, {
      constraints: { minLength: 2, maxLength: 65536 },
      metadata: d.metadata,
    }),
  );
export function readAttentionPolicy(c: EffectiveConfiguration, clock: Clock) {
  const scanner = readScannerPolicy(c, clock);
  const raw = [...c.values].find(([k]) => k === "surveillance.attention.policyJson")?.[1].value;
  if (typeof raw !== "string" || Buffer.byteLength(raw) > 65536)
    throw Error("CONFIGURATION_INVALID");
  const policy = policySchema.parse(boundedClone(JSON.parse(raw) as unknown, 65536, 20));
  if (
    policy.effectiveAt > clock.now() ||
    policy.anchor > clock.now() ||
    policy.maxDispatchBatch > scanner.policy.maxBatch ||
    policy.maxProposalsPerEpoch > scanner.policy.maxRequests ||
    ((policy.submissionEnabled || policy.dispatchEnabled) && policy.actor === null)
  )
    throw Error("CONFIGURATION_INVALID");
  return frozen({
    policy,
    scannerPolicy: scanner.policy,
    plan: scanner.plan,
    configuration: c.fingerprint,
    configurationResolvedAt: c.resolvedAt,
  });
}
export function attentionStateOwnership(): StateOwnershipEntry {
  return frozen({
    stateDomain: stateDomain("mose.attention"),
    owner: stateOwner("mose.attention"),
    authorityType: "DERIVED",
    writeAuthority: "mose.attention",
    readers: ["mose.attention"],
    durable: true,
    historyRequired: true,
    reconciliationRequired: true,
    runtimeModes: ["RESEARCH"],
    description: "Own attention assessments and recommendation debt only",
  });
}
