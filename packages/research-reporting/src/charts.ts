import { validateInsightRecord } from "@ate/research-insight-contracts";
import type { Chart, QualifiedObservation, ReportingPolicy } from "./contracts.js";
import { checkedPolicy } from "./policy.js";
import {
  array,
  data,
  object,
  exact,
  id,
  utc,
  demand,
  guard,
  freeze,
  digest,
} from "./validation.js";
import { TraversalBudget } from "./budgets.js";
import { ensureConsistentEvidence, validateArtifact } from "./evidence.js";
export function buildChartMetadata(
  raw: unknown,
  observations: readonly QualifiedObservation[],
  policy: ReportingPolicy,
) {
  return guard(() => {
    const result = buildChartsWithinBudget(
      raw,
      observations,
      policy,
      new TraversalBudget(checkedPolicy(policy)),
    );
    demand(result.ok, result.ok ? undefined : result.issues[0]?.code);
    return result.value;
  });
}
export function buildChartsWithinBudget(
  raw: unknown,
  observations: readonly QualifiedObservation[],
  policy: ReportingPolicy,
  work: TraversalBudget,
  artifactDepth = 2,
  chartDepth = 0,
) {
  return guard(() => {
    const p = checkedPolicy(policy),
      charts = data(raw, p.maxReportBytes, 32, 50000, work, chartDepth);
    demand(
      observations.length <= p.maxArtifacts && observations.length <= p.maxEvidenceRefs,
      "REPORTING:BUDGET_EXHAUSTED",
    );
    const artifacts = observations.map((o) => {
      const a = validateArtifact(o.artifact, work, artifactDepth);
      demand(o.captureDigest === digest(a, work, artifactDepth), "REPORTING:FINGERPRINT_MISMATCH");
      return a;
    });
    ensureConsistentEvidence(artifacts, work, artifactDepth + 1);
    demand(Array.isArray(charts) && charts.length <= p.maxCharts, "REPORTING:BUDGET_EXHAUSTED");
    let total = 0;
    const chartIds = new Set<string>();
    for (const entry of array(charts)) {
      const c = object(entry);
      exact(c, ["schema", "id", "kind", "label", "legend", "series"]);
      demand(c.schema === "ate.reporting.chart/1");
      id(c.id);
      demand(!chartIds.has(c.id));
      chartIds.add(c.id);
      demand(
        typeof c.kind === "string" &&
          ["TABLE", "TIMESERIES", "BAR", "SCATTER", "STATUS_TIMELINE"].includes(c.kind),
      );
      id(c.label);
      demand(typeof c.legend === "string" && Buffer.byteLength(c.legend) <= 1024);
      demand(
        Array.isArray(c.series) && c.series.length <= p.maxSeries,
        "REPORTING:BUDGET_EXHAUSTED",
      );
      let count = 0;
      const seriesIds = new Set<string>();
      for (const entry of array(c.series)) {
        const s = object(entry);
        exact(s, ["id", "points"]);
        id(s.id);
        demand(!seriesIds.has(s.id));
        seriesIds.add(s.id);
        demand(Array.isArray(s.points));
        const pointIds = new Set<string>();
        for (const entry of array(s.points)) {
          const x = object(entry);
          exact(x, [
            "id",
            "value",
            "unit",
            "at",
            "availableAt",
            "evidenceId",
            "correctionOf",
            "finality",
          ]);
          id(x.id);
          demand(!pointIds.has(x.id));
          pointIds.add(x.id);
          id(x.unit);
          id(x.evidenceId);
          utc(x.at);
          if (x.availableAt !== null) utc(x.availableAt);
          if (x.correctionOf !== null) id(x.correctionOf);
          demand(
            typeof x.finality === "string" &&
              ["FINAL", "PROVISIONAL", "UNKNOWN"].includes(x.finality),
          );
          demand(
            validateInsightRecord(
              "Fact",
              data(x.value, p.maxReportBytes, 32, 50000, work, chartDepth + 6),
            ).ok,
          );
          const o = observations.find((o) => o.artifact.id === x.evidenceId);
          demand(
            o &&
              o.provenance === "TRUSTED_CONTEXT_ANCHOR" &&
              o.pointInTime === "ESTABLISHED" &&
              o.artifact.unit === x.unit,
            "REPORTING:EVIDENCE_UNAVAILABLE",
          );
          demand(
            x.at === o.artifact.effectiveAt && x.availableAt === o.artifact.availableAt,
            "REPORTING:CONTEXT_MISMATCH",
          );
          const native = o.artifact.captured.value;
          const metadata =
            native !== null && typeof native === "object" && !Array.isArray(native)
              ? object(native)
              : object({});
          demand(
            x.finality === (metadata.finality ?? "UNKNOWN") &&
              x.correctionOf === (metadata.correctionOf ?? null),
            "REPORTING:CONTEXT_MISMATCH",
          );
          const fact = object(x.value!);
          if (fact.kind === "KNOWN") {
            demand(
              Array.isArray(fact.evidenceIds) &&
                fact.evidenceIds.length > 0 &&
                fact.evidenceIds.every((e) => e === x.evidenceId),
            );
            const v = o.artifact.captured.value;
            demand(
              v !== null &&
                typeof v === "object" &&
                !Array.isArray(v) &&
                Object.hasOwn(v, String(s.id)) &&
                JSON.stringify(object(v)[String(s.id)]) === JSON.stringify(fact.value),
              "REPORTING:CONTEXT_MISMATCH",
            );
            if (typeof fact.value === "number") demand(Number.isSafeInteger(fact.value));
          }
          count++;
          total++;
          demand(
            count <= p.maxPointsPerChart && total <= p.maxPoints,
            "REPORTING:BUDGET_EXHAUSTED",
          );
        }
      }
    }
    return freeze(charts) as readonly Chart[];
  });
}
