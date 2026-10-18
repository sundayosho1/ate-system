import { R1 } from "@ate/research-insight-contracts";
import { data, object, demand, freeze, guard } from "./validation.js";
import type { ReportingPolicy, ReportingResult } from "./contracts.js";
export const D1 = freeze({
  maxArtifacts: 32,
  maxNativeBytes: 1048576,
  maxDepth: 32,
  maxNodes: 50000,
  maxReportBytes: R1.report.maxBytes,
  maxEvidenceRefs: 1000,
  maxFacets: 2000,
  maxClockReads: 8,
  maxCalls: 64,
  maxCharts: 8,
  maxSeries: 8,
  maxPointsPerChart: 1000,
  maxPoints: 2000,
  maxImprovements: 256,
  maxExportBytes: R1.export.maxBytes,
});
export function createReportingPolicy(raw: unknown = {}): ReportingResult<ReportingPolicy> {
  return guard<ReportingPolicy>(() => {
    const supplied = object(data(raw));
    for (const [key, v] of Object.entries(supplied)) {
      demand(
        key in D1 &&
          typeof v === "number" &&
          Number.isSafeInteger(v) &&
          v >= 1 &&
          v <= D1[key as keyof typeof D1],
        "REPORTING:POLICY_INVALID",
      );
    }
    return freeze({
      schema: "ate.reporting.policy/1",
      ...D1,
      ...supplied,
      ownerReads: false,
      refresh: false,
      retries: 0,
    });
  });
}
/** Revalidate every use; arbitrary structurally typed policies cannot raise ceilings or activate routes. */
export function checkedPolicy(raw: unknown): ReportingPolicy {
  const x = object(data(raw));
  demand(
    x.schema === "ate.reporting.policy/1" &&
      x.ownerReads === false &&
      x.refresh === false &&
      x.retries === 0,
    "REPORTING:POLICY_INVALID",
  );
  const limits: Record<string, number> = {};
  for (const k of Object.keys(D1)) {
    const v = x[k];
    demand(
      typeof v === "number" && Number.isSafeInteger(v) && v >= 1 && v <= D1[k as keyof typeof D1],
      "REPORTING:POLICY_INVALID",
    );
    limits[k] = v;
  }
  demand(Object.keys(x).length === Object.keys(D1).length + 4, "REPORTING:POLICY_INVALID");
  return freeze({
    schema: "ate.reporting.policy/1",
    ...limits,
    ownerReads: false,
    refresh: false,
    retries: 0,
  }) as ReportingPolicy;
}

/** Internal minima; no operation can weaken an embedded policy. */
export function effectivePolicy(
  embedded: ReportingPolicy,
  override?: ReportingPolicy,
): ReportingPolicy {
  const a = checkedPolicy(embedded),
    b = override === undefined ? a : checkedPolicy(override);
  const limits: Record<string, number> = {};
  for (const k of Object.keys(D1) as (keyof typeof D1)[]) limits[k] = Math.min(a[k], b[k]);
  const result = createReportingPolicy(limits);
  demand(result.ok, "REPORTING:POLICY_INVALID");
  return result.value;
}
export function embeddedPolicy(raw: unknown): ReportingPolicy {
  demand(raw !== null && typeof raw === "object", "REPORTING:POLICY_INVALID");
  const descriptor = Object.getOwnPropertyDescriptor(raw, "policy");
  demand(descriptor && "value" in descriptor && descriptor.enumerable, "REPORTING:POLICY_INVALID");
  const value: unknown = descriptor.value;
  return checkedPolicy(value);
}
