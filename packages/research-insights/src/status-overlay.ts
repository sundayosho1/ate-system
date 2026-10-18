import { ok, type DomainResult } from "@ate/domain";
import { type JsonValue } from "@ate/research-insight-contracts";
import { snapshot, issue, frozen } from "./serialization.js";
import {
  validateSourceManifest,
  sourceReferences,
  type SourceManifest,
} from "./source-manifest.js";
export function createStatusOverlay(
  raw: unknown,
  manifest: SourceManifest,
): DomainResult<JsonValue> {
  const m = validateSourceManifest(manifest);
  if (!m.ok) return m;
  const r = snapshot(raw);
  if (!r.ok) return r;
  const v = r.value as Record<string, JsonValue>;
  if (!v || !sourceReferences(v.sourceRefs!, m.value) || !Array.isArray(v.records))
    return issue("INSIGHT_SOURCE_REFERENCE_INVALID");
  if (
    Object.keys(v).some(
      (k) => !["sourceRefs", "records", "foundationStatus", "futurePrompts", "scope"].includes(k),
    )
  )
    return issue("INSIGHT_SCHEMA_INVALID");
  const isObject = (v: JsonValue): v is Record<string, JsonValue> =>
    v !== null && typeof v === "object" && !Array.isArray(v);
  for (const row of v.records as readonly JsonValue[]) {
    if (!isObject(row)) return issue("INSIGHT_SCHEMA_INVALID");
    if (
      Object.keys(row).some(
        (k) =>
          ![
            "prompt",
            "implementationSHA",
            "governanceSHA",
            "governance",
            "frozenManifestCompletedPrompt",
            "rootVersion",
            "currentAuthority",
            "currentReadiness",
            "evidenceMeaning",
            "sourceRefs",
            "qualificationIds",
          ].includes(k),
      )
    )
      return issue("INSIGHT_SCHEMA_INVALID");
    if (
      !sourceReferences(row.sourceRefs!, m.value) ||
      row.currentAuthority !== "UNESTABLISHED" ||
      row.currentReadiness !== "UNESTABLISHED" ||
      row.evidenceMeaning !== "SOURCE_BYTES_NOT_EXTERNAL_AUTHENTICATION"
    )
      return issue("INSIGHT_AUTHORITY_UNESTABLISHED");
  }
  return ok(
    frozen({
      ...v,
      sourceBaseline: m.value.baseline,
      authentication: "SUPPLIED_SOURCE_MANIFEST_INTEGRITY_ONLY",
      grantsAuthority: false,
    }),
  );
}
