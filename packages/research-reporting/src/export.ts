import { canonicalInsightBytes } from "@ate/research-insights";
import { checkedPolicy, createReportingPolicy } from "./policy.js";
import { validateBundle } from "./report.js";
import { guard, freeze, digest, demand, unknownFact } from "./validation.js";
import type { ReportingPolicy } from "./contracts.js";
/** Explicit safe field allowlist: no raw native values, paths, labels, source text or credential refs. */
export function serializeReportExport(raw: unknown, policy?: ReportingPolicy) {
  return guard(() => {
    const defaultPolicy = createReportingPolicy();
    demand(defaultPolicy.ok);
    const p = checkedPolicy(policy ?? defaultPolicy.value),
      b = validateBundle(raw);
    const projection = {
      schema: "ate.reporting.export/1",
      originalReportFingerprint: b.manifest.reportFingerprint,
      redactionPolicy: "SAFE_METADATA_ONLY_V1",
      sourceBaseline: b.request.baseline,
      generatedAt: b.manifest.generatedAt,
      counts: {
        facets: b.facets.length,
        observations: b.observations.length,
        charts: b.charts.length,
        improvements: b.improvements.length,
      },
      facetStates: b.facets.map((f) => ({
        axis: f.facet.axis,
        status: f.status,
        temporalScope: f.facet.temporalScope,
      })),
      omissions: [
        "RAW_NATIVE_VALUES",
        "SUBJECTS",
        "LABELS",
        "REASONS",
        "LOCATORS",
        "PROPOSAL_TEXT",
      ],
      currentAuthority: unknownFact("REPORTING:HISTORICAL_REPORT_NOT_CURRENT_AUTHORITY"),
    };
    const fingerprint = digest(projection),
      bytes = canonicalInsightBytes(
        { ...projection, projectionFingerprint: fingerprint },
        "EXPORT",
      );
    demand(bytes.ok && bytes.value.byteLength <= p.maxExportBytes, "REPORTING:BUDGET_EXHAUSTED");
    return freeze({
      bytes: Buffer.from(bytes.value).toString("utf8"),
      projectionFingerprint: fingerprint,
      originalReportFingerprint: b.manifest.reportFingerprint,
    });
  });
}
