import { ok, type DomainResult } from "@ate/domain";
import { validateInsightRecord, type ConfigurationGuide } from "@ate/research-insight-contracts";
import { corpusRows, issue, frozen } from "./serialization.js";
import {
  sourceReferences,
  validateSourceManifest,
  type SourceManifest,
} from "./source-manifest.js";
export function validateConfigurationGuides(
  raw: unknown,
  manifest: SourceManifest,
): DomainResult<readonly ConfigurationGuide[]> {
  try {
    const corpus = corpusRows(raw);
    if (!corpus.ok) return corpus;
    const m = validateSourceManifest(manifest);
    if (!m.ok) return m;
    const entries: ConfigurationGuide[] = [],
      seen = new Set<string>();
    let bytes = 2;
    for (const row of corpus.value) {
      const r = validateInsightRecord("ConfigurationGuide", row);
      if (!r.ok) return r;
      const v = r.value as ConfigurationGuide,
        id = [v.owner, v.key, v.schemaRef, v.fieldPath].join("/");
      if (seen.has(id)) return issue("INSIGHT_DUPLICATE_IDENTITY");
      seen.add(id);
      if (!sourceReferences(v.sourceRefs, m.value))
        return issue("INSIGHT_SOURCE_REFERENCE_INVALID");
      bytes += Buffer.byteLength(JSON.stringify(v)) + 1;
      if (bytes > 16777216) return issue("INSIGHT_INPUT_BOUNDS");
      entries.push(v);
    }
    return ok(frozen(entries));
  } catch {
    return issue("INSIGHT_ACCESSOR_REJECTED");
  }
}
