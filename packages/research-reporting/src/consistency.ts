import type { ConsistencyEvidence } from "@ate/research-insight-contracts";
import type { QualifiedObservation } from "./contracts.js";
import { freeze, unknownFact } from "./validation.js";
export function consistencyEvidence(
  observations: readonly QualifiedObservation[],
  start: string,
  end: string,
): ConsistencyEvidence {
  return freeze({
    schema: "ate.insights.consistency/1",
    id: "report-consistency",
    scope: "EXPLICIT_REQUEST_EVIDENCE_VECTOR",
    mode: "SEQUENTIAL_UNESTABLISHED",
    identityVector: observations.map((o) => ({
      owner: o.artifact.owner,
      identity: o.artifact.nativeIdentity,
      captureDigest: o.captureDigest,
    })),
    readInterval: { start, end },
    completeness: unknownFact("REPORTING:CONSISTENCY_UNESTABLISHED"),
    reasons: ["REPORTING:CONSISTENCY_UNESTABLISHED"],
    barrierRef: unknownFact("REPORTING:NO_ACCEPTED_BARRIER"),
  });
}
