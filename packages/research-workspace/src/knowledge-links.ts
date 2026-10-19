import { createKnowledgeCatalogue } from "@ate/research-insights";
import type { CatalogueBuildInput } from "@ate/research-insights";
import { array, object, exact, demand, dependency } from "./validation.js";
import { fingerprint } from "./serialization.js";
import { baselines } from "./contracts.js";
import type { ObjectValue } from "./contracts.js";
import type { Budget } from "./budgets.js";
export function knowledgeWithin(raw: ObjectValue, generatedAt: string, work: Budget) {
  exact(raw, ["catalogue", "sourceManifest", "qualificationIds"]);
  const c = object(raw.catalogue!),
    m = object(raw.sourceManifest!);
  exact(c, ["baseline", "entries"], ["schema", "generatedAt"]);
  demand(c.schema === undefined || c.schema === "ate.insights.catalogue/1");
  demand(c.baseline === baselines.knowledge && m.baseline === baselines.knowledge);
  const sourceHashes = new Map<string, string>();
  for (const rawSource of Object.values(object(m.sources!))) {
    const source = object(rawSource);
    demand(typeof source.path === "string" && typeof source.sha256 === "string");
    demand(
      !sourceHashes.has(source.path) || sourceHashes.get(source.path) === source.sha256,
      "WORKSPACE:SOURCE_BINDING_MISMATCH",
    );
    sourceHashes.set(source.path, source.sha256);
  }
  const entries = array(c.entries);
  demand(entries.length <= work.policy.maxKnowledge, "WORKSPACE:BUDGET_EXHAUSTED");
  const input = {
    entries,
    sourceManifest: m,
    qualificationIds: array(raw.qualificationIds),
    generatedAt,
  };
  work.reserve(input, 16);
  const result = createKnowledgeCatalogue(input as unknown as CatalogueBuildInput);
  if (!result.ok)
    dependency(
      "@ate/research-insights:createKnowledgeCatalogue",
      result.issues[0]!.code,
      result.issues[0]!.message,
    );
  return {
    catalogue: result.value,
    fingerprint: fingerprint(result.value, work),
    scope: "SUBSET_NOT_TOTAL",
  };
}
