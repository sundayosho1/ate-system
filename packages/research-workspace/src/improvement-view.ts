import { projectImprovementRegister } from "@ate/research-reporting";
import type { JsonValue } from "./contracts.js";
import { array, demand, dependency } from "./validation.js";
import type { Budget } from "./budgets.js";
export function improvementsWithin(raw: JsonValue, evidence: readonly string[], work: Budget) {
  demand(array(raw).length <= work.policy.maxImprovements, "WORKSPACE:BUDGET_EXHAUSTED");
  work.reserve(raw, 8);
  const r = projectImprovementRegister(raw, evidence);
  if (!r.ok)
    dependency(
      "@ate/research-reporting:projectImprovementRegister",
      r.issues[0]!.code,
      r.issues[0]!.message,
    );
  return { ...r.value, decisionAuthority: "NOT_ESTABLISHED", mutationAuthority: false };
}
