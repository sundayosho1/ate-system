import type { WorkspacePolicy } from "./contracts.js";
import { guard, object, demand, freeze } from "./validation.js";
import { snapshot } from "./serialization.js";
export const W1 = Object.freeze({
  maxInputBytes: 4194304,
  maxDepth: 16,
  maxNodes: 10000,
  maxKnowledge: 128,
  maxReports: 1,
  maxArtifacts: 8,
  maxLinks: 128,
  maxFacets: 64,
  maxImprovements: 32,
  maxCharts: 4,
  maxPoints: 256,
  maxOutputBytes: 1048576,
  maxExportBytes: 1048576,
  maxCalls: 8,
  maxClockReads: 2,
  maxQuery: 50,
});
export function checkedPolicy(raw: unknown): WorkspacePolicy {
  const p = object(snapshot(raw));
  demand(Object.keys(p).length === Object.keys(W1).length, "WORKSPACE:POLICY_INVALID");
  for (const k of Object.keys(W1) as (keyof typeof W1)[])
    demand(
      Number.isSafeInteger(p[k]) && Number(p[k]) >= 1 && Number(p[k]) <= W1[k],
      "WORKSPACE:POLICY_INVALID",
    );
  return freeze(p as WorkspacePolicy);
}
export function createWorkspacePolicy(raw: unknown = {}) {
  return guard(() => {
    const p = object(snapshot(raw));
    demand(
      Object.keys(p).every((k) => k in W1),
      "WORKSPACE:POLICY_INVALID",
    );
    return checkedPolicy({ ...W1, ...p });
  });
}
export function minima(a: WorkspacePolicy, b?: WorkspacePolicy): WorkspacePolicy {
  a = checkedPolicy(a);
  b = b === undefined ? a : checkedPolicy(b);
  return freeze(
    Object.fromEntries(
      Object.keys(W1).map((k) => [k, Math.min(a[k as keyof typeof W1], b[k as keyof typeof W1])]),
    ) as WorkspacePolicy,
  );
}
