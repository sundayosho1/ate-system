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
// These are projection metadata types, never effective owner values or authority.
const dimensions = {
  owner: "id",
  authoritativeContract: "references",
  documentation: "references",
  documentationCoverage: "text",
  glossaryTerms: "terms",
  glossaryCoverage: "text",
  configurationGuidance: "text",
  diagnosticEvidence: "text",
  reportingReadiness: "text",
  improvementIntegration: "text",
  frontendReadiness: "text",
} as const;
const boundedText = (value: JsonValue | undefined, maxBytes: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && Buffer.byteLength(value) <= maxBytes;
function dimension(type: string, value: JsonValue | undefined): boolean {
  if (type === "id") return boundedText(value, 256);
  if (type === "text") return boundedText(value, 32768);
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 10000 &&
    (value as readonly JsonValue[]).every((item) =>
      boundedText(item, type === "terms" ? 256 : 32768),
    )
  );
}
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
        !boundedText(v.id, 256) ||
        typeof v.classification !== "string" ||
        !classes.includes(v.classification) ||
        Object.entries(dimensions).some(([field, type]) => !dimension(type, v[field]))
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
