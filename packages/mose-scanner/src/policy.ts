import {
  configurationKey,
  configurationSchemaFromDefinition,
  type EffectiveConfiguration,
} from "@ate/configuration";
import { stateDomain, stateOwner, type StateOwnershipEntry } from "@ate/persistence";
import type { Clock } from "@ate/time";
import { validatePlan } from "./planner.js";
import { policySchema, planSchema } from "./contracts.js";
import { boundedClone, frozen, parsePolicyJson } from "./primitives.js";
export function scannerConfigurationDefinitions(clock: Clock) {
  return ["surveillance.scanner.policyJson", "surveillance.scanner.planJson"].map((name) => {
    const key = configurationKey(name, clock.now());
    if (!key.ok) throw Error("CONFIGURATION_INVALID");
    return {
      key: key.value,
      domain: "SURVEILLANCE" as const,
      displayName: "Offline multi-speed research scanner",
      description: "Versioned bounded scanner policy/plan; no trading authority",
      valueType: "STRING" as const,
      required: true,
      failClosed: true,
      allowedScopes: ["SYSTEM" as const],
      mergePolicy: "REPLACE" as const,
      sensitivity: "INTERNAL" as const,
      metadata: {
        purpose: "Offline work scheduling",
        riskImplication: "Unverified work never completes",
        reloadRequirement: "RESTART" as const,
        uiHint: "mose-scanner help",
      },
    };
  });
}
export const scannerConfigurationSchemas = (clock: Clock) =>
  scannerConfigurationDefinitions(clock).map((d) =>
    configurationSchemaFromDefinition(d, {
      constraints: { minLength: 2, maxLength: 65536 },
      metadata: d.metadata,
    }),
  );
export function readScannerPolicy(c: EffectiveConfiguration, clock: Clock) {
  if (
    c.context.runtimeMode !== "RESEARCH" ||
    c.conflicts.length ||
    c.diagnostics.missingRequiredKeys.length ||
    !["VIRTUAL", "REPLAY", "SIMULATION"].includes(clock.mode) ||
    !["ACCEPTABLE", "SYNCHRONIZED"].includes(clock.provenance.quality) ||
    c.resolvedAt > clock.now()
  )
    throw Error("CONFIGURATION_INVALID");
  const raw = [...c.values].find(([k]) => k === "surveillance.scanner.policyJson")?.[1].value;
  if (typeof raw !== "string" || Buffer.byteLength(raw) > 65536)
    throw Error("CONFIGURATION_INVALID");
  const p = policySchema.parse(boundedClone(parsePolicyJson(raw), 65536, 24));
  if (
    p.effectiveAt > clock.now() ||
    new Set(p.enabledModes).size !== p.enabledModes.length ||
    p.maxBatch > p.maxOwnerCalls ||
    p.maxQueue > p.maxRequests
  )
    throw Error("CONFIGURATION_INVALID");
  const rawPlan = [...c.values].find(([key]) => key === "surveillance.scanner.planJson")?.[1].value;
  if (typeof rawPlan !== "string" || Buffer.byteLength(rawPlan) > 65536)
    throw Error("CONFIGURATION_PLAN_INVALID");
  const plan = validatePlan(
    planSchema.parse(boundedClone(parsePolicyJson(rawPlan), p.maxInputBytes, p.maxInputDepth)),
    p,
  );
  return frozen({ policy: p, configuration: c.fingerprint, plan });
}
export function scannerStateOwnership(): StateOwnershipEntry {
  return frozen({
    stateDomain: stateDomain("mose.scanner"),
    owner: stateOwner("mose.scanner"),
    authorityType: "DERIVED",
    writeAuthority: "mose.scanner",
    readers: ["mose.scanner"],
    durable: true,
    historyRequired: true,
    reconciliationRequired: true,
    runtimeModes: ["RESEARCH"],
    description: "Derived scanner work only; MOSE owns observations and coverage.",
  });
}
