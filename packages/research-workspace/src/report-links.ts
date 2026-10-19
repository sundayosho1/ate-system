import { queryReport, createReportingPolicy, D1 } from "@ate/research-reporting";
import { array, object, demand, dependency } from "./validation.js";
import type { JsonValue } from "./contracts.js";
import type { Budget } from "./budgets.js";
export function reportWithin(raw: JsonValue, work: Budget) {
  if (raw === null) return null;
  const r = object(raw);
  demand(
    array(r.observations).length <= work.policy.maxArtifacts &&
      array(r.facets).length <= work.policy.maxFacets &&
      array(r.charts).length <= work.policy.maxCharts &&
      array(r.improvements).length <= work.policy.maxImprovements,
    "WORKSPACE:BUDGET_EXHAUSTED",
  );
  const points = array(r.charts).reduce<number>(
    (n, c) =>
      n + array(object(c).series).reduce<number>((m, s) => m + array(object(s).points).length, 0),
    0,
  );
  demand(points <= work.policy.maxPoints, "WORKSPACE:BUDGET_EXHAUSTED");
  // Public D1 traversal policy supplies an enforceable pre-call bound. Reserve it
  // in full; unused credits are not refunded or reset. Fixed policy validation
  // overhead is separately reserved before constructing the owner policy.
  const embedded = object(r.policy!);
  const allowedKeys = [...Object.keys(D1), "schema", "ownerReads", "refresh", "retries"];
  demand(
    Object.keys(embedded).length === allowedKeys.length &&
      Object.keys(embedded).every((k) => allowedKeys.includes(k)),
  );
  demand(
    embedded.schema === "ate.reporting.policy/1" &&
      embedded.ownerReads === false &&
      embedded.refresh === false &&
      embedded.retries === 0,
  );
  for (const k of Object.keys(D1) as (keyof typeof D1)[])
    demand(
      Number.isSafeInteger(embedded[k]) && Number(embedded[k]) >= 1 && Number(embedded[k]) <= D1[k],
    );
  work.reserveBound(512, 65536);
  const allowance = Math.floor(work.remainingNodes() / 2);
  demand(allowance >= 1, "WORKSPACE:BUDGET_EXHAUSTED");
  const policy = createReportingPolicy({
    maxNodes: allowance,
    maxDepth: work.policy.maxDepth,
    maxArtifacts: work.policy.maxArtifacts,
    maxFacets: work.policy.maxFacets,
    maxCharts: work.policy.maxCharts,
    maxPoints: work.policy.maxPoints,
    maxImprovements: work.policy.maxImprovements,
  });
  demand(policy.ok, "WORKSPACE:BUDGET_EXHAUSTED");
  work.reserveBound(allowance, Buffer.byteLength(JSON.stringify(raw)) * 32);
  const result = queryReport(raw, { offset: 0, limit: 50, owner: null }, policy.value);
  if (!result.ok)
    dependency(
      "@ate/research-reporting:queryReport",
      result.issues[0]!.code,
      result.issues[0]!.message,
    );
  return {
    originalReportFingerprint: result.value.reportFingerprint,
    report: raw,
    scope: result.value.scope,
  };
}
