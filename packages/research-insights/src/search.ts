import { ok, parseUtcTimestamp, type DomainResult } from "@ate/domain";
import {
  validateInsightRecord,
  type JsonValue,
  type KnowledgeEntry,
} from "@ate/research-insight-contracts";
import { snapshot, issue, frozen } from "./serialization.js";
import type { KnowledgeCatalogue } from "./catalogue.js";
const fold = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
export function searchKnowledge(
  catalogue: KnowledgeCatalogue,
  request: unknown,
): DomainResult<JsonValue> {
  const q = snapshot(request);
  if (!q.ok) return q;
  const v = q.value as Record<string, JsonValue>;
  if (
    !v ||
    Object.keys(v).some((k) => !["query", "maxHits", "cancelled"].includes(k)) ||
    typeof v.query !== "string" ||
    Buffer.byteLength(v.query) > 256
  )
    return issue("INSIGHT_INPUT_BOUNDS");
  const tokens = fold(v.query)
    .split(/[ \t\r\n\f\v]+/)
    .filter(Boolean);
  if (tokens.length > 20) return issue("INSIGHT_INPUT_BOUNDS");
  const limit = v.maxHits ?? 20;
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    return issue("INSIGHT_INPUT_BOUNDS");
  if (v.cancelled === true) return issue("INSIGHT_CANCELLED");
  // Revalidate the entire supplied catalogue, not a caller's TypeScript cast.
  const c = snapshot(catalogue, 16777216, 32, 10000 * 10000);
  if (!c.ok) return c;
  const cat = c.value as unknown as KnowledgeCatalogue;
  if (
    !cat ||
    typeof cat !== "object" ||
    Array.isArray(cat) ||
    cat.schema !== "ate.insights.catalogue/1" ||
    !Array.isArray(cat.entries) ||
    cat.entries.length > 10000
  )
    return issue("INSIGHT_SCHEMA_INVALID");
  const timestamp = parseUtcTimestamp(cat.generatedAt);
  if (
    typeof cat.baseline !== "string" ||
    !/^[a-f0-9]{40}$/.test(cat.baseline) ||
    !timestamp.ok ||
    timestamp.value !== cat.generatedAt ||
    Object.keys(cat).sort().join(",") !== "baseline,entries,generatedAt,schema"
  )
    return issue("INSIGHT_SCHEMA_INVALID");
  const identities = new Set<string>();
  const matches: KnowledgeEntry[] = [];
  for (const e of cat.entries as readonly KnowledgeEntry[]) {
    const validated = validateInsightRecord("KnowledgeEntry", e);
    if (!validated.ok) return validated;
    if (
      typeof e.definition !== "string" ||
      typeof e.id !== "string" ||
      typeof e.revision !== "number"
    )
      return issue("INSIGHT_SCHEMA_INVALID");
    const identity = e.id + ":" + String(e.revision);
    if (identities.has(identity)) return issue("INSIGHT_DUPLICATE_IDENTITY");
    identities.add(identity);
    if (tokens.every((t) => fold(String(e.id) + " " + e.definition).includes(t))) matches.push(e);
  }
  matches.sort((a, b) =>
    String(a.id) < String(b.id)
      ? -1
      : String(a.id) > String(b.id)
        ? 1
        : Number(a.revision) - Number(b.revision),
  );
  return ok(
    frozen({
      records: matches.slice(0, limit),
      totalMatches: matches.length,
      hasMore: matches.length > limit,
      scope: "STATIC_KNOWLEDGE_NOT_MARKET_COVERAGE",
    }),
  );
}
