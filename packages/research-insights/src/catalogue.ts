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
    if (input.cancelled !== undefined && typeof input.cancelled !== "boolean")
      return issue("INSIGHT_SCHEMA_INVALID");
    if (input.cancelled === true) return issue("INSIGHT_CANCELLED");
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
    // References name entry IDs, not revisions. Union the outgoing relationships of
    // every retained revision under that ID; do not silently choose a latest revision.
    // Iterative three-colour DFS visits each ID and deduplicated edge once. Its
    // graph is bounded by the already checked 10000-entry/16MiB corpus; no recursion
    // or revision cross-product expansion can escape those bounds.
    const graph = new Map<string, Set<string>>();
    for (const entry of entries) {
      const edges = graph.get(entry.id) ?? new Set<string>();
      for (const target of entry.relatedEntryIds) edges.add(target);
      graph.set(entry.id, edges);
    }
    const colour = new Map<string, number>();
    let steps = 0;
    for (const id of graph.keys()) {
      if (colour.has(id)) continue;
      colour.set(id, 1);
      const stack = [{ id, edges: graph.get(id)!.values() }];
      while (stack.length) {
        if (steps++ % R1.cancellation.serializationBatchNodes === 0 && input.cancelled)
          return issue("INSIGHT_CANCELLED");
        const frame = stack[stack.length - 1]!,
          next = frame.edges.next();
        if (next.done) {
          colour.set(frame.id, 2);
          stack.pop();
        } else if (colour.get(next.value) === 1) {
          return issue("INSIGHT_CYCLIC_INPUT");
        } else if (!colour.has(next.value)) {
          colour.set(next.value, 1);
          stack.push({ id: next.value, edges: graph.get(next.value)!.values() });
        }
      }
    }
    const compare = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
    entries.sort(
      (a, b) =>
        compare(a.namespace, b.namespace) ||
        compare(a.type, b.type) ||
        compare(a.id, b.id) ||
        a.revision - b.revision,
    );
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
