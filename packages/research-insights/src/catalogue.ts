import type { JsonValue } from "@ate/research-insight-contracts";
import { ok, parseUtcTimestamp, type DomainResult } from "@ate/domain";
import { R1, validateInsightRecord, type KnowledgeEntry } from "@ate/research-insight-contracts";
import { issue, frozen, snapshot, corpusRows } from "./serialization.js";
import {
  validateSourceManifest,
  sourceReferences,
  type SourceManifest,
} from "./source-manifest.js";
export type KnowledgeCatalogue = Readonly<{
  schema: "ate.insights.catalogue/1";
  generatedAt: string;
  baseline: string;
  entries: readonly KnowledgeEntry[];
}>;
export type CatalogueBuildInput = Readonly<{
  entries: readonly unknown[];
  sourceManifest: SourceManifest;
  qualificationIds: readonly string[];
  generatedAt: string;
  cancelled?: boolean;
}>;
export function createKnowledgeCatalogue(
  input: CatalogueBuildInput,
): DomainResult<KnowledgeCatalogue> {
  try {
    const ds = Object.getOwnPropertyDescriptors(input);
    if (
      Object.keys(ds).some(
        (k) =>
          !["entries", "sourceManifest", "qualificationIds", "generatedAt", "cancelled"].includes(
            k,
          ),
      ) ||
      Object.values(ds).some((d) => !("value" in d))
    )
      return issue("INSIGHT_ACCESSOR_REJECTED");
    input = {
      entries: ds.entries?.value as readonly unknown[],
      sourceManifest: ds.sourceManifest?.value as SourceManifest,
      qualificationIds: ds.qualificationIds?.value as readonly string[],
      generatedAt: ds.generatedAt?.value as string,
      ...(ds.cancelled ? { cancelled: ds.cancelled.value as boolean } : {}),
    };
    const descriptor = snapshot({
      generatedAt: input.generatedAt,
      qualificationIds: input.qualificationIds,
      ...(input.cancelled === undefined ? {} : { cancelled: input.cancelled }),
    });
    if (!descriptor.ok) return descriptor;
    const captured = descriptor.value as Record<string, JsonValue>;
    if (captured.cancelled !== undefined && typeof captured.cancelled !== "boolean")
      return issue("INSIGHT_SCHEMA_INVALID");
    input = {
      ...input,
      generatedAt: captured.generatedAt as string,
      qualificationIds: captured.qualificationIds as readonly string[],
      ...(captured.cancelled === undefined ? {} : { cancelled: captured.cancelled }),
    };
    const corpus = corpusRows(input.entries);
    if (!corpus.ok) return corpus;
    if (input.cancelled === true) return issue("INSIGHT_CANCELLED");
    const time = parseUtcTimestamp(input.generatedAt);
    if (!time.ok || time.value !== input.generatedAt)
      return issue("INSIGHT_TEMPORAL_INCONSISTENCY");
    const m = validateSourceManifest(input.sourceManifest);
    if (!m.ok) return m;
    if (
      !Array.isArray(input.qualificationIds) ||
      input.qualificationIds.length > 10000 ||
      input.qualificationIds.some((s) => typeof s !== "string" || Buffer.byteLength(s) > 256)
    )
      return issue("INSIGHT_INPUT_BOUNDS");
    const qualifications = new Set(input.qualificationIds),
      ids = new Set<string>(),
      entries: KnowledgeEntry[] = [];
    let bytes = 2;
    for (const raw of corpus.value) {
      if (input.cancelled) return issue("INSIGHT_CANCELLED");
      const result = validateInsightRecord("KnowledgeEntry", raw);
      if (!result.ok) return result;
      const entry = result.value as KnowledgeEntry,
        key = entry.id + ":" + String(entry.revision);
      if (ids.has(key)) return issue("INSIGHT_DUPLICATE_IDENTITY");
      ids.add(key);
      if (
        !sourceReferences(entry.sourceRefs, m.value) ||
        !(entry.qualifications as string[]).every((q) => qualifications.has(q))
      )
        return issue("INSIGHT_SOURCE_REFERENCE_INVALID");
      bytes += Buffer.byteLength(JSON.stringify(entry)) + (entries.length ? 1 : 0);
      if (bytes > R1.knowledge.maxBytes) return issue("INSIGHT_INPUT_BOUNDS");
      entries.push(entry);
    }
    const knownIds = new Set(entries.map((e) => e.id));
    for (const e of entries)
      if (!e.relatedEntryIds.every((id) => knownIds.has(id)))
        return issue("INSIGHT_REFERENCE_UNRESOLVED");
    entries.sort((a, b) => {
      const x = [a.namespace, a.type, a.id, String(a.revision)].join("/"),
        y = [b.namespace, b.type, b.id, String(b.revision)].join("/");
      return x < y ? -1 : x > y ? 1 : 0;
    });
    const result = {
      schema: "ate.insights.catalogue/1" as const,
      generatedAt: time.value,
      baseline: m.value.baseline,
      entries,
    };
    if (Buffer.byteLength(JSON.stringify(result)) > R1.knowledge.maxBytes)
      return issue("INSIGHT_INPUT_BOUNDS");
    return ok(frozen(result));
  } catch {
    return issue("INSIGHT_ACCESSOR_REJECTED");
  }
}
