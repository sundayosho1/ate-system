import { ok, type DomainResult } from "@ate/domain";
import { type JsonValue } from "@ate/research-insight-contracts";
import { corpusRows, snapshot, issue, frozen } from "./serialization.js";
import {
  validateSourceManifest,
  sourceReferences,
  type SourceManifest,
} from "./source-manifest.js";
export function validateGlossary(
  raw: unknown,
  manifest: SourceManifest,
  requiredIds: readonly string[] = [],
): DomainResult<readonly JsonValue[]> {
  try {
    const corpus = corpusRows(raw);
    if (!corpus.ok) return corpus;
    const required = corpusRows(requiredIds);
    if (!required.ok) return required;
    if (required.value.some((id) => typeof id !== "string" || !id || Buffer.byteLength(id) > 256))
      return issue("INSIGHT_SCHEMA_INVALID");
    const m = validateSourceManifest(manifest);
    if (!m.ok) return m;
    const values: JsonValue[] = [],
      seen = new Set<string>();
    let bytes = 2;
    for (const row of corpus.value) {
      const r = snapshot(row, 32768);
      if (!r.ok) return r;
      const v = r.value as Record<string, JsonValue>;
      if (
        !v ||
        typeof v.id !== "string" ||
        typeof v.term !== "string" ||
        !v.term ||
        typeof v.definition !== "string" ||
        !v.definition ||
        typeof v.namespace !== "string" ||
        !v.namespace ||
        !Array.isArray(v.aliases) ||
        !v.aliases.every((a) => typeof a === "string") ||
        !Array.isArray(v.overloadedMeaningRefs) ||
        !v.overloadedMeaningRefs.every((a) => typeof a === "string") ||
        typeof v.futureReserved !== "boolean" ||
        !sourceReferences(v.sourceRefs!, m.value)
      )
        return issue("INSIGHT_SCHEMA_INVALID");
      const allowed = [
        "id",
        "term",
        "namespace",
        "definition",
        "aliases",
        "overloadedMeaningRefs",
        "futureReserved",
        "sourceRefs",
        "originalDefinition",
        "sourceState",
        "applicableSourceCommit",
        "qualifiedCurrentExplanation",
      ];
      if (
        Object.keys(v).some((k) => !allowed.includes(k)) ||
        [v.id, v.term, v.namespace].some(
          (x) => typeof x !== "string" || !x || Buffer.byteLength(x) > 256,
        ) ||
        v.aliases.some((x) => !x || Buffer.byteLength(x) > 256)
      )
        return issue("INSIGHT_SCHEMA_INVALID");
      if (seen.has(v.id)) return issue("INSIGHT_DUPLICATE_IDENTITY");
      seen.add(v.id);
      bytes += Buffer.byteLength(JSON.stringify(v)) + 1;
      if (bytes > 16777216) return issue("INSIGHT_INPUT_BOUNDS");
      values.push(v);
    }
    if (!required.value.every((id) => seen.has(id as string)))
      return issue("INSIGHT_REFERENCE_UNRESOLVED");
    for (const v of values as Record<string, JsonValue>[])
      if (!(v.overloadedMeaningRefs as string[]).every((id) => seen.has(id)))
        return issue("INSIGHT_REFERENCE_UNRESOLVED");
    return ok(frozen(values));
  } catch {
    return issue("INSIGHT_ACCESSOR_REJECTED");
  }
}
