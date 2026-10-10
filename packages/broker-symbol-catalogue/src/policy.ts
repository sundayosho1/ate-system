import { z } from "zod";
import {
  configurationSchemaFromDefinition,
  configurationKey,
  fingerprint,
  type EffectiveConfiguration,
  type ConfigurationKey,
  type ConfigurationDefinition,
} from "@ate/configuration";
import type { Clock } from "@ate/time";
import { freeze } from "@ate/multitimeframe";
import { safeClone, parseJson } from "./boundary.js";
import { code, text } from "./contracts.js";
const count = z.number().int().min(1).max(10000);
export const ruleSchema = z
  .object({
    id: code,
    version: z.literal("B1"),
    case: z.enum(["EXACT", "CASE"]),
    suffixes: z.array(text.max(32)).max(8),
  })
  .strict();
export const policySchema = z
  .object({
    version: z.literal(1),
    rules: z.array(ruleSchema).min(1).max(16),
    allowedSourceSystems: z
      .array(z.enum(["SYNTHETIC", "RECORDED_MT5_EXPORT", "RECORDED_OTHER"]))
      .min(1)
      .max(3),
    allowedQuality: z
      .array(z.enum(["SYNTHETIC", "UNVERIFIED_RECORDED", "EVIDENCED_RECORDED"]))
      .min(1)
      .max(3),
    maxNamespaces: count,
    maxCataloguesPerNamespace: count,
    maxRecordsPerCatalogue: count,
    maxSourceBytes: z.number().int().min(1024).max(16777216),
    maxRecordBytes: z.number().int().min(256).max(1048576),
    maxSnapshots: count,
    maxSnapshotBytes: z.number().int().min(4096).max(67108864),
    maxRetainedBytes: z.number().int().min(4096).max(1073741824),
    maxProposals: count,
    maxDecisions: count,
    maxDifferences: count,
    maxQueryResults: count,
    maxRegistryHistory: count,
    staleAfterMs: z.number().int().min(1).max(31536000000),
    approvalPolicyId: code,
  })
  .strict();
export type Policy = z.infer<typeof policySchema>;
export const defaultPolicy: Policy = freeze({
  version: 1,
  rules: [
    { id: "exact", version: "B1", case: "EXACT", suffixes: [] },
    { id: "case", version: "B1", case: "CASE", suffixes: [] },
  ],
  allowedSourceSystems: ["SYNTHETIC", "RECORDED_MT5_EXPORT", "RECORDED_OTHER"],
  allowedQuality: ["SYNTHETIC", "UNVERIFIED_RECORDED"],
  maxNamespaces: 16,
  maxCataloguesPerNamespace: 16,
  maxRecordsPerCatalogue: 256,
  maxSourceBytes: 1048576,
  maxRecordBytes: 8192,
  maxSnapshots: 128,
  maxSnapshotBytes: 4194304,
  maxRetainedBytes: 67108864,
  maxProposals: 128,
  maxDecisions: 256,
  maxDifferences: 512,
  maxQueryResults: 100,
  maxRegistryHistory: 512,
  staleAfterMs: 86400000,
  approvalPolicyId: "broker.catalogue.research",
});
export function validatePolicy(raw: unknown): Policy {
  const p = policySchema.parse(safeClone(raw, 1048576));
  for (const xs of [p.rules.map((r) => r.id), p.allowedSourceSystems, p.allowedQuality])
    if (new Set(xs).size !== xs.length) throw Error("DUPLICATE_POLICY");
  for (const r of p.rules) {
    if (
      new Set(r.suffixes).size !== r.suffixes.length ||
      r.suffixes.some(
        (s) =>
          s.trim() !== s ||
          s.normalize("NFC") !== s ||
          (r.case === "CASE" && s.toUpperCase().normalize("NFC") !== s),
      ) ||
      r.suffixes.some((s, i) => r.suffixes.some((other, j) => i !== j && other.endsWith(s)))
    )
      throw Error("AMBIGUOUS_SUFFIX_RULE");
  }
  return freeze(p);
}
export function policyFromEffective(e: EffectiveConfiguration): {
  policy: Policy;
  configurationFingerprint: string;
} {
  if (e.conflicts.length || e.diagnostics.missingRequiredKeys.length)
    throw Error("CONFIGURATION_INVALID");
  const value = e.values.get("broker.catalogue.policyJson" as ConfigurationKey)?.value;
  if (typeof value !== "string" || Buffer.byteLength(value) > 1048576)
    throw Error("POLICY_REQUIRED");
  return {
    policy: validatePolicy(parseJson(value, 1048576)),
    configurationFingerprint: e.fingerprint,
  };
}
export function brokerCatalogueConfigurationDefinitions(
  clock: Clock,
): readonly ConfigurationDefinition[] {
  const key = configurationKey("broker.catalogue.policyJson", clock.now());
  if (!key.ok) throw Error("INVALID_CONFIGURATION_KEY");
  return [
    {
      key: key.value,
      domain: "BROKER",
      displayName: "Offline broker catalogue research policy",
      description:
        "Bounded offline imports, normalization, immutable mapping review and recovery. No connectivity or execution.",
      valueType: "STRING",
      required: false,
      failClosed: true,
      allowedScopes: ["SYSTEM", "ENVIRONMENT"],
      mergePolicy: "REPLACE",
      sensitivity: "INTERNAL",
      metadata: {
        purpose: "Offline catalogue evidence only",
        riskImplication:
          "Missing/drifted policy fences service; historical evidence is never reinterpreted.",
        reloadRequirement: "RESTART",
        uiHint: "JSON policy; see broker-symbol-catalogue help",
      },
    },
  ];
}
export const policyFingerprint = (p: Policy): string => fingerprint(p);

export const brokerCatalogueConfigurationSchemas = (clock: Clock) =>
  brokerCatalogueConfigurationDefinitions(clock).map((d) =>
    configurationSchemaFromDefinition(d, {
      constraints: { minLength: 2, maxLength: 1048576 },
      metadata: { ...d.metadata, examples: ['{"version":1}'] },
    }),
  );
