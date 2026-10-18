import type {
  ProjectedFacet,
  FacetRequest,
  QualifiedObservation,
  ReportRequest,
} from "./contracts.js";
import type { JsonValue } from "@ate/research-insight-contracts";
import { freeze, known, unknownFact, demand, object } from "./validation.js";
export function projectFacet(
  f: FacetRequest,
  o: QualifiedObservation | undefined,
  r: ReportRequest,
): ProjectedFacet {
  const fields: Record<string, readonly string[]> = {
    LIFECYCLE: ["lifecycle", "state", "phase"],
    HEALTH: ["health"],
    READINESS: ["readiness"],
    QUALITY: ["quality"],
    AUTHORITY: ["currentAuthority"],
    COVERAGE: ["eligibleDenominator", "denominator", "coverageComplete"],
    OBLIGATION: [
      "pending",
      "obligation",
      "recoveryRequired",
      "floorDebt",
      "pendingPublications",
      "pendingSubmissions",
      "negativeProvenanceObligations",
    ],
  };
  demand(fields[f.axis]?.includes(f.field), "REPORTING:UNSUPPORTED_FACET");
  const reasons: string[] = [1, 2, 13].includes(f.prompt) ? ["REPORTING:UNSUPPORTED_FACET"] : [];
  let value: JsonValue | undefined;
  if (!o) reasons.push("REPORTING:EVIDENCE_UNAVAILABLE");
  else {
    const a = o.artifact;
    demand(
      a.prompt === f.prompt &&
        a.owner === f.owner &&
        JSON.stringify(a.subject) === JSON.stringify(f.subject) &&
        a.unit === f.unit,
      "REPORTING:CONTEXT_MISMATCH",
    );
    if (o.provenance !== "TRUSTED_CONTEXT_ANCHOR") reasons.push("REPORTING:SOURCE_UNAUTHENTICATED");
    if (o.pointInTime !== "ESTABLISHED")
      reasons.push(
        o.pointInTime === "OUTSIDE_CUTOFF"
          ? "REPORTING:KNOWLEDGE_CUTOFF"
          : "REPORTING:KNOWLEDGE_CUTOFF_UNPROVEN",
      );
    if (r.mode === "CURRENT") reasons.push("REPORTING:CURRENT_AUTHORITY_UNESTABLISHED");
    if (a.captured.selected === "FAILURE") reasons.push("REPORTING:OWNER_REJECTED");
    const v = a.captured.value;
    if (v !== null && typeof v === "object" && !Array.isArray(v) && Object.hasOwn(v, f.field))
      value = object(v)[f.field];
    if (value !== undefined && value !== null) {
      if (["LIFECYCLE", "HEALTH", "READINESS"].includes(f.axis))
        demand(typeof value === "string", "REPORTING:RESULT_INVALID");
      if (f.axis === "HEALTH")
        demand(
          typeof value === "string" && ["HEALTHY", "DEGRADED", "UNHEALTHY"].includes(value),
          "REPORTING:RESULT_INVALID",
        );
      if (f.axis === "READINESS")
        demand(
          typeof value === "string" && ["READY", "NOT_READY"].includes(value),
          "REPORTING:RESULT_INVALID",
        );
    }
    if (value === undefined || value === null) reasons.push("REPORTING:EVIDENCE_UNAVAILABLE");
    // Coverage and authority require more than a scalar in a native envelope; never promote these axes.
    if (f.axis === "COVERAGE" || f.axis === "AUTHORITY")
      reasons.push("REPORTING:CONSISTENCY_UNESTABLISHED");
  }
  const status = reasons.includes("REPORTING:UNSUPPORTED_FACET")
    ? "UNSUPPORTED"
    : reasons.length
      ? "UNAVAILABLE"
      : "OBSERVED";
  return freeze({
    facet: {
      schema: "ate.insights.diagnostic/1",
      id: f.id,
      owner: f.owner,
      subjectTuple: [...f.subject],
      axis: f.axis,
      nativeStatus: status === "OBSERVED" ? known(value!, [f.artifactId]) : unknownFact(reasons[0]),
      observationId: f.artifactId,
      temporalScope: r.mode === "HISTORICAL" ? "HISTORICAL" : "UNESTABLISHED",
      currentAuthority: unknownFact("REPORTING:CURRENT_AUTHORITY_UNESTABLISHED"),
      qualifications: ["C-Q01", "C-Q02", "C-Q03", "C-Q04", "T01", "M02"],
    },
    status,
    reasons,
    unit: f.unit,
  });
}
