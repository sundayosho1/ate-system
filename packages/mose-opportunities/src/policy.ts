import { z } from "zod";
import { stateDomain, stateOwner, type StateOwnershipEntry } from "@ate/persistence";
import { configurationKey, configurationSchemaFromDefinition } from "@ate/configuration";
import type { Clock } from "@ate/time";
import { id, type Policy, type Limits } from "./contracts.js";
import { operationBudget, inOperation, demand, guarded, freeze, object } from "./validation.js";
export const O1: Readonly<Limits> = freeze({
  maxLiveKeys: 32,
  maxJournalRecords: 256,
  maxRecordBytes: 65536,
  maxRequestBytes: 65536,
  maxRetainedJournalBytes: 16777216,
  maxOperationNodes: 10000,
  maxDepth: 16,
  maxEvidenceRefs: 32,
  maxTimeframes: 4,
  maxDimensions: 8,
  maxClausesPerManifest: 16,
  maxEdgeManifests: 9,
  maxIdentifierBytes: 128,
  maxReasons: 16,
  defaultPageSize: 20,
  maxPageSize: 50,
  maxOffset: 256,
  maxOutputBytes: 65536,
  maxSnapshotsPerRecord: 1,
  maxSnapshotBytesWithinRecord: 65536,
  maxReplayRecords: 256,
  writerConcurrency: 1,
  maxUnresolvedOperations: 1,
  defaultOwnerReads: 0,
  maxExplicitApprovedOwnerReads: 8,
  ownerReadConcurrency: 1,
  automaticRetries: 0,
  explicitRecoveryAttemptsPerRequest: 1,
  defaultEvidenceMaxAgeMs: 300000,
  defaultExpiryMs: 3600000,
  maxExpiryMs: 86400000,
});
export const defaultOpportunityPolicy: Policy = freeze({
  schema: "ate.opportunity-policy/1",
  id: "offline-opportunities",
  version: "1",
  limits: O1,
  compositionDriverEnabled: false,
  filesystemEnabled: false,
  promotionsEnabled: false,
  tradingAuthorized: false,
});
const validatedPolicies = new WeakSet<object>([defaultOpportunityPolicy]);
const limitKeys = Object.keys(O1) as (keyof Limits)[];
export function createOpportunityPolicy(
  raw: unknown = defaultOpportunityPolicy,
  original: Policy = defaultOpportunityPolicy,
) {
  return inOperation(O1, () =>
    guarded(() => {
      const meter = operationBudget(O1);
      const r = object(meter.capture(raw));
      demand(Object.keys(r).sort().join() === Object.keys(defaultOpportunityPolicy).sort().join());
      demand(
        r.schema === "ate.opportunity-policy/1" &&
          r.compositionDriverEnabled === false &&
          typeof r.promotionsEnabled === "boolean" &&
          r.tradingAuthorized === false &&
          typeof r.filesystemEnabled === "boolean",
      );
      id.parse(r.id);
      id.parse(r.version);
      const l = object(r.limits);
      demand(Object.keys(l).sort().join() === limitKeys.slice().sort().join());
      const limits = { ...O1 };
      for (const k of limitKeys) {
        const v = l[k];
        demand(typeof v === "number" && Number.isSafeInteger(v) && v >= 0);
        limits[k] = Math.min(v, O1[k], original.limits[k]);
      }
      demand(
        limits.maxDepth >= 1 &&
          limits.maxOperationNodes >= 1 &&
          limits.maxRequestBytes >= 1 &&
          limits.maxRecordBytes >= 1 &&
          limits.defaultPageSize >= 1 &&
          limits.defaultPageSize <= limits.maxPageSize &&
          limits.defaultExpiryMs <= limits.maxExpiryMs &&
          limits.maxSnapshotBytesWithinRecord <= limits.maxRecordBytes &&
          limits.maxRecordBytes <= limits.maxRetainedJournalBytes &&
          limits.writerConcurrency === 1 &&
          limits.maxUnresolvedOperations === 1 &&
          limits.ownerReadConcurrency === 1,
      );
      const result = freeze({
        schema: "ate.opportunity-policy/1" as const,
        id: id.parse(r.id),
        version: id.parse(r.version),
        limits,
        compositionDriverEnabled: false as const,
        filesystemEnabled: r.filesystemEnabled,
        promotionsEnabled: r.promotionsEnabled,
        tradingAuthorized: false as const,
      });
      validatedPolicies.add(result);
      return result;
    }),
  );
}
export function effectivePolicy(original: Policy, lower?: unknown): Policy {
  if (lower === undefined && validatedPolicies.has(original)) return original;
  const p = createOpportunityPolicy(lower ?? original, original);
  demand(p.ok, "INPUT_INVALID");
  return p.value;
}
export function opportunityStateOwnership(durable = false): StateOwnershipEntry {
  return freeze({
    stateDomain: stateDomain("surveillance.opportunity"),
    owner: stateOwner("mose.opportunities"),
    authorityType: "DERIVED",
    writeAuthority: "mose.opportunities",
    readers: ["mose.opportunities"],
    durable,
    historyRequired: true,
    reconciliationRequired: true,
    runtimeModes: ["RESEARCH"],
    description: "Own bounded offline opportunity lifecycle; no current or financial authority",
  });
}
export function opportunityConfigurationDefinitions(clock: Clock) {
  const k = configurationKey("surveillance.opportunity.policyJson", clock.now());
  demand(k.ok, "CONFIGURATION_INVALID");
  return [
    {
      key: k.value,
      domain: "SURVEILLANCE" as const,
      displayName: "Offline opportunities",
      description: "Bounded historical opportunity lifecycle; no trading",
      valueType: "STRING" as const,
      required: true,
      failClosed: true,
      allowedScopes: ["SYSTEM" as const],
      mergePolicy: "REPLACE" as const,
      sensitivity: "INTERNAL" as const,
      metadata: {
        purpose: "Historical research lifecycle",
        riskImplication: "Unverified evidence cannot establish current authority",
        reloadRequirement: "RESTART" as const,
        uiHint: "mose-opportunities help",
      },
    },
  ];
}
export const opportunityConfigurationSchemas = (clock: Clock) =>
  opportunityConfigurationDefinitions(clock).map((d) =>
    configurationSchemaFromDefinition(d, {
      constraints: { minLength: 2, maxLength: 65536 },
      metadata: d.metadata,
    }),
  );
export const policyConfigurationValue = z.string().max(65536);
