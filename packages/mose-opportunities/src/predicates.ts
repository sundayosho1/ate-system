import { compareDecimal, schemas } from "@ate/domain";
import type { PredicateManifest, CapturedEvidence, Policy } from "./contracts.js";
import { demand, object } from "./validation.js";
import { nativePayload } from "./evidence.js";
export function compareOpportunityScalar(
  raw: string,
  operator: PredicateManifest["clauses"][number]["operator"],
  constant: string,
): boolean {
  demand(raw.length <= 128 && constant.length <= 128, "BUDGET_EXHAUSTED");
  const c = compareDecimal(schemas.decimal.parse(raw), schemas.decimal.parse(constant));
  switch (operator) {
    case "EQ":
      return c === 0;
    case "NE":
      return c !== 0;
    case "GT":
      return c > 0;
    case "GE":
      return c >= 0;
    case "LT":
      return c < 0;
    case "LE":
      return c <= 0;
  }
}
export function dimensionValue(
  evidence: readonly CapturedEvidence[],
  recordId: string,
  field: string,
) {
  const e = evidence.find((v) => v.recordId === recordId && v.family === "BAR");
  demand(e, "UNSUPPORTED_DIMENSION");
  const n = object(nativePayload(e));
  const value = n[field];
  if (field === "count") {
    demand(typeof value === "number" && Number.isSafeInteger(value) && value >= 0, "INPUT_INVALID");
    return String(value);
  }
  demand(typeof value === "string", "UNSUPPORTED_DIMENSION");
  return value;
}
export function evaluatePredicate(
  manifest: PredicateManifest,
  evidence: readonly CapturedEvidence[],
  policy: Policy,
): boolean {
  demand(
    manifest.requiredDimensions.length <= policy.limits.maxDimensions &&
      manifest.clauses.length <= policy.limits.maxClausesPerManifest,
    "BUDGET_EXHAUSTED",
  );
  if (!manifest.enabled) return false;
  demand(policy.promotionsEnabled, "POLICY_DISABLED");
  demand(
    manifest.clauses.length > 0 &&
      new Set(manifest.requiredDimensions).size === manifest.requiredDimensions.length,
    "INPUT_INVALID",
  );
  const stageFloor = manifest.toState === "QUALIFIED" ? 3 : 2;
  demand(manifest.minimumDistinctConfirmations >= stageFloor, "CONFIRMATIONS_MISSING");
  const observations = new Set(
    evidence.filter((e) => e.family === "OBSERVATION").map((e) => e.recordId),
  );
  demand(observations.size >= manifest.minimumDistinctConfirmations, "CONFIRMATIONS_MISSING");
  for (const dimension of manifest.requiredDimensions)
    demand(
      evidence.some((e) => e.family === "BAR" && e.recordId === dimension),
      "UNSUPPORTED_DIMENSION",
    );
  return manifest.clauses.every((clause) => {
    demand(manifest.requiredDimensions.includes(clause.dimensionRef), "UNSUPPORTED_DIMENSION");
    const e = evidence.find((v) => v.recordId === clause.dimensionRef && v.family === "BAR");
    demand(e, "UNSUPPORTED_DIMENSION");
    const native = object(nativePayload(e));
    demand(
      clause.unit === (clause.field === "count" ? "COUNT" : object(native.stream).priceCurrency),
      "UNIT_MISMATCH",
    );
    return compareOpportunityScalar(
      dimensionValue(evidence, clause.dimensionRef, clause.field),
      clause.operator,
      clause.decimalConstant,
    );
  });
}
