import { safeClone } from "./boundary.js";
import { z } from "zod";
import {
  fingerprint,
  type EffectiveConfiguration,
  type ConfigurationKey,
} from "@ate/configuration";
import { freeze } from "@ate/multitimeframe";
import { families, taxonomySchema, type Taxonomy } from "./contracts.js";
export const defaultTaxonomy: Taxonomy = {
  version: "T1",
  categories: [
    {
      code: "FX",
      family: "FX",
      kinds: ["SPOT", "FORWARD"],
      meaning: "Currency pair references, not currencies",
      deprecated: false,
    },
    {
      code: "EQUITY",
      family: "EQUITY",
      kinds: ["ORDINARY", "PREFERRED", "DEPOSITARY_RECEIPT"],
      meaning: "Distinct listed share classes",
      deprecated: false,
    },
    {
      code: "FUND",
      family: "FUND",
      kinds: ["ETF", "UNIT"],
      meaning: "Fund units distinct from tracked references",
      deprecated: false,
    },
    {
      code: "INDEX",
      family: "INDEX",
      kinds: ["EQUITY_INDEX", "VOLATILITY_INDEX", "REFERENCE_INDEX"],
      meaning: "Reference index variants",
      deprecated: false,
    },
    {
      code: "BOND",
      family: "BOND",
      kinds: ["GOVERNMENT", "CORPORATE", "OTHER_DEBT"],
      meaning: "Distinct debt issuances",
      deprecated: false,
    },
    {
      code: "COMMODITY",
      family: "COMMODITY",
      kinds: ["PHYSICAL", "BENCHMARK", "SYNTHETIC"],
      meaning: "Explicit physical benchmark or synthetic references",
      deprecated: false,
    },
    {
      code: "FUTURE",
      family: "FUTURE",
      kinds: ["EXPIRING", "CONTINUOUS"],
      meaning: "Expiring contracts distinct from research series",
      deprecated: false,
    },
    {
      code: "OPTION",
      family: "OPTION",
      kinds: ["CALL", "PUT"],
      meaning: "Option contracts distinct from underlying",
      deprecated: false,
    },
    {
      code: "DIGITAL",
      family: "DIGITAL",
      kinds: ["NATIVE", "TOKEN", "WRAPPED", "PAIR"],
      meaning: "Network assets distinct from venue pairs",
      deprecated: false,
    },
    {
      code: "RATE",
      family: "RATE",
      kinds: ["REFERENCE_RATE"],
      meaning: "Reference rate and tenor",
      deprecated: false,
    },
    {
      code: "OTHER",
      family: "OTHER",
      kinds: ["CURRENCY", "EXTENSION", "PROVISIONAL"],
      meaning: "Explicit governed extensions or candidates",
      deprecated: false,
    },
  ],
};
const bounded = z.number().int().min(1).max(10000);
export const policySchema = z
  .object({
    version: z.literal(1),
    normalizationVersion: z.literal("N1"),
    supportedFamilies: z.array(z.enum(families)).min(1).max(11),
    identifierSchemes: z
      .array(
        z.enum([
          "ISIN",
          "FIGI",
          "CFI",
          "CURRENCY",
          "EXCHANGE",
          "RESEARCH",
          "PROVIDER",
          "BROKER",
          "TERMINAL",
        ]),
      )
      .min(1)
      .max(9),
    currencies: z
      .array(z.string().regex(/^[A-Z]{3}$/))
      .min(1)
      .max(256),
    taxonomies: z.array(taxonomySchema).min(1).max(16),
    maxAliases: bounded,
    maxRelationships: bounded,
    maxRevisions: bounded,
    maxImportBatch: bounded,
    maxRecordBytes: z.number().int().min(256).max(1048576),
    maxCandidates: bounded,
    maxQueryResults: bounded,
    maxInstruments: bounded,
    maxSnapshots: bounded,
    maxSnapshotBytes: z.number().int().min(4096).max(67108864),
    maxRetainedSnapshotBytes: z.number().int().min(4096).max(1073741824),
    maxConflicts: bounded,
    maxImports: bounded,
    duplicatePolicy: z.literal("EXACT_IDEMPOTENT"),
    conflictPolicy: z.literal("RECORD_AND_REJECT"),
  })
  .strict();
export type Policy = z.infer<typeof policySchema>;
export const defaultPolicy: Policy = {
  version: 1,
  normalizationVersion: "N1",
  supportedFamilies: [...families],
  identifierSchemes: [
    "ISIN",
    "FIGI",
    "CFI",
    "CURRENCY",
    "EXCHANGE",
    "RESEARCH",
    "PROVIDER",
    "BROKER",
    "TERMINAL",
  ],
  currencies: ["EUR", "USD", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD"],
  taxonomies: [defaultTaxonomy],
  maxAliases: 32,
  maxRelationships: 32,
  maxRevisions: 64,
  maxImportBatch: 64,
  maxRecordBytes: 65536,
  maxCandidates: 64,
  maxQueryResults: 64,
  maxInstruments: 256,
  maxSnapshots: 512,
  maxSnapshotBytes: 16777216,
  maxRetainedSnapshotBytes: 67108864,
  maxConflicts: 256,
  maxImports: 512,
  duplicatePolicy: "EXACT_IDEMPOTENT",
  conflictPolicy: "RECORD_AND_REJECT",
};
export function validatePolicy(raw: unknown): Policy {
  const p = policySchema.parse(safeClone(raw, 1048576));
  for (const k of [p.supportedFamilies, p.identifierSchemes, p.currencies])
    if (new Set(k).size !== k.length) throw Error("DUPLICATE_POLICY_VALUE");
  const versions = new Set<string>();
  for (const t of p.taxonomies) {
    if (versions.has(t.version)) throw Error("DUPLICATE_TAXONOMY_VERSION");
    versions.add(t.version);
    validateTaxonomy(t);
  }
  return freeze(p);
}
export function validateTaxonomy(t: Taxonomy): void {
  const map = new Map(t.categories.map((c) => [c.code, c]));
  if (map.size !== t.categories.length) throw Error("DUPLICATE_CATEGORY");
  for (const c of t.categories) {
    if (new Set(c.kinds).size !== c.kinds.length) throw Error("DUPLICATE_KIND");
    const seen = new Set<string>([c.code]);
    let parent = c.parent;
    while (parent) {
      if (seen.has(parent)) throw Error("TAXONOMY_CYCLE");
      seen.add(parent);
      const next = map.get(parent);
      if (!next) throw Error("UNDEFINED_PARENT");
      if (next.family !== c.family) throw Error("CONFLICTING_PARENT_FAMILY");
      parent = next.parent;
    }
  }
}
export function policyFromEffective(effective: EffectiveConfiguration): {
  policy: Policy;
  configurationFingerprint: string;
} {
  if (effective.conflicts.length > 0 || effective.diagnostics.missingRequiredKeys.length > 0)
    throw Error("CONFIGURATION_NOT_VALID");
  const raw = effective.values.get("instrument.registry.policyJson" as ConfigurationKey)?.value;
  if (typeof raw !== "string" || raw.length > 1048576) throw Error("CONFIGURATION_POLICY_REQUIRED");
  return {
    policy: validatePolicy(JSON.parse(raw)),
    configurationFingerprint: effective.fingerprint,
  };
}
export const policyFingerprint = (p: Policy): string => fingerprint(p);

export function taxonomyVersionFingerprint(raw: Taxonomy): string {
  const t = taxonomySchema.parse(safeClone(raw, 1048576));
  validateTaxonomy(t);
  t.categories.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  for (const c of t.categories) c.kinds.sort();
  return fingerprint(t);
}
freeze(defaultTaxonomy);
freeze(defaultPolicy);
