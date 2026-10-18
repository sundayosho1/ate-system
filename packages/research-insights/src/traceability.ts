import { ok, type DomainResult } from "@ate/domain";
import { type JsonValue } from "@ate/research-insight-contracts";
import { corpusRows, snapshot, issue, frozen } from "./serialization.js";
const classes = [
  "SUPPORTED_EXISTING_ACCEPTED_INTERFACE",
  "SUPPORTED_WITH_EXPLICIT_QUALIFICATIONS",
  "REQUIRING_NEW_READ_ONLY_ADAPTER",
  "BLOCKED_MISSING_PUBLIC_EVIDENCE_OR_AUTHORITY",
  "NOT_IMPLEMENTED_OR_OUTSIDE_APPROVED_SCOPE",
];
const fields = [
  "owner",
  "authoritativeContract",
  "documentation",
  "documentationCoverage",
  "glossaryTerms",
  "glossaryCoverage",
  "configurationGuidance",
  "diagnosticEvidence",
  "reportingReadiness",
  "improvementIntegration",
  "frontendReadiness",
];
export function validateCapabilityTraceability(
  raw: unknown,
  baselineIds: readonly string[],
): DomainResult<readonly JsonValue[]> {
  try {
    const corpus = corpusRows(raw);
    if (!corpus.ok) return corpus;
    const baseline = corpusRows(baselineIds);
    if (!baseline.ok) return baseline;
    if (baseline.value.some((id) => typeof id !== "string" || !id || Buffer.byteLength(id) > 256))
      return issue("INSIGHT_SCHEMA_INVALID");
    const seen = new Set<string>(),
      result: JsonValue[] = [];
    let bytes = 2;
    for (const row of corpus.value) {
      const r = snapshot(row, 32768);
      if (!r.ok) return r;
      const v = r.value as Record<string, JsonValue>;
      if (
        !v ||
        typeof v.id !== "string" ||
        !v.id ||
        typeof v.classification !== "string" ||
        !classes.includes(v.classification) ||
        fields.some(
          (f) => v[f] === undefined || v[f] === "" || (Array.isArray(v[f]) && !v[f].length),
        )
      )
        return issue("INSIGHT_SCHEMA_INVALID");
      if (
        Object.keys(v).some(
          (k) =>
            ![
              "authoritativeContract",
              "capability",
              "classification",
              "classificationScope",
              "configurationGuidance",
              "declaredImplemented",
              "diagnosticEvidence",
              "documentation",
              "documentationCoverage",
              "frontendReadiness",
              "glossaryCoverage",
              "glossaryTerms",
              "id",
              "improvementIntegration",
              "kind",
              "manifestEvidence",
              "owner",
              "prompts",
              "reportingReadiness",
              "sourceReview",
            ].includes(k),
        )
      )
        return issue("INSIGHT_SCHEMA_INVALID");
      if (seen.has(v.id)) return issue("INSIGHT_DUPLICATE_IDENTITY");
      seen.add(v.id);
      bytes += Buffer.byteLength(JSON.stringify(v)) + 1;
      if (bytes > 16777216) return issue("INSIGHT_INPUT_BOUNDS");
      result.push(v);
    }
    if (!baseline.value.every((id) => seen.has(id as string)))
      return issue("INSIGHT_REFERENCE_UNRESOLVED");
    return ok(frozen(result));
  } catch {
    return issue("INSIGHT_ACCESSOR_REJECTED");
  }
}
