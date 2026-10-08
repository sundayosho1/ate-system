import { hash, freeze } from "@ate/multitimeframe";
import type {
  ReplayCheckpoint,
  ReplaySessionSpecification,
  ReplayEvidenceManifest,
  ReplayComparison,
  ReplayBranchEvidence,
} from "./types.js";
import { validateReplayCheckpoint } from "./checkpoint.js";
export function replayEvidenceManifest(
  spec: ReplaySessionSpecification,
  cp: ReplayCheckpoint,
): ReplayEvidenceManifest {
  validateReplayCheckpoint(cp, spec);
  const revisions = cp.aggregation.revisions.map((r) => r.revisionId).sort();
  const snapshots = cp.snapshots.map((s) => s.snapshotId).sort();
  if (revisions.length + snapshots.length > spec.resourceLimits.maxComparisonItems)
    throw Error("COMPARISON_CAPACITY");
  const semantic = {
    inputFingerprint: cp.inputFingerprint,
    softwareIdentity: spec.softwareIdentity,
    mode: spec.replayMode,
    clockPolicy: spec.clockMode,
    orderingPolicy: spec.orderingPolicy,
    configurationFingerprint: spec.configurationFingerprint,
    calendarFingerprint: spec.calendarFingerprint,
    logicalTime: cp.logicalTime,
    cursor: cp.cursor,
    snapshots,
    revisions,
    qualityFingerprint: hash(
      cp.aggregation.revisions.map((r) => ({
        id: r.revisionId,
        quality: r.quality,
        suppression: r.suppressionEvidence,
      })),
    ),
    continuityFingerprint: hash(cp.aggregation.watermarks),
  };
  return freeze({
    ...semantic,
    sessionId: spec.sessionId,
    specificationFingerprint: spec.fingerprint,
    state: cp.state,
    semanticCheckpointId: cp.checkpointId,
    ...(cp.branch ? { branch: cp.branch } : {}),
    semanticFingerprint: hash(semantic),
  });
}
export function verifyReplayEvidenceManifest(m: ReplayEvidenceManifest): void {
  const {
    sessionId: _sessionId,
    specificationFingerprint: _spec,
    state: _state,
    semanticCheckpointId: _checkpoint,
    branch: _branch,
    semanticFingerprint,
    ...semantic
  } = m;
  if (hash(semantic) !== semanticFingerprint) throw Error("REPLAY_EVIDENCE_INTEGRITY");
}
export function compareReplayEvidence(
  left: ReplayEvidenceManifest,
  right: ReplayEvidenceManifest,
): ReplayComparison {
  verifyReplayEvidenceManifest(left);
  verifyReplayEvidenceManifest(right);
  const reasons: string[] = [];
  let classification: ReplayComparison["classification"];
  if (
    left.mode !== right.mode ||
    left.inputFingerprint !== right.inputFingerprint ||
    left.softwareIdentity !== right.softwareIdentity ||
    left.clockPolicy !== right.clockPolicy ||
    left.orderingPolicy !== right.orderingPolicy ||
    left.logicalTime !== right.logicalTime ||
    left.cursor !== right.cursor
  ) {
    classification = "INCOMPARABLE";
    reasons.push("Input, software, temporal policy or checkpoint boundary differs.");
  } else if (left.semanticFingerprint === right.semanticFingerprint) {
    classification = "IDENTICAL";
    reasons.push("Qualified semantic evidence is identical.");
  } else if (
    right.branch?.parentSessionId === left.sessionId &&
    right.branch.parentCheckpointId === left.semanticCheckpointId &&
    right.branch.parentConfigurationFingerprint === left.configurationFingerprint &&
    right.branch.branchConfigurationFingerprint === right.configurationFingerprint &&
    right.branch.changedFields.length > 0 &&
    hash(left.revisions) === hash(right.revisions) &&
    hash(left.snapshots) === hash(right.snapshots) &&
    left.qualityFingerprint === right.qualityFingerprint &&
    left.continuityFingerprint === right.continuityFingerprint
  ) {
    classification = "EXPECTED_DIFFERENCE";
    reasons.push(
      "Recorded reconstructed branch changed configuration; this explains divergence scope, not research quality.",
    );
  } else {
    classification = "UNEXPLAINED_DIVERGENCE";
    reasons.push(
      "Equivalent comparison context has different semantic evidence without an applicable branch record.",
    );
  }
  const body = {
    classification,
    reasons,
    left: left.semanticFingerprint,
    right: right.semanticFingerprint,
  };
  return freeze({ ...body, fingerprint: hash(body) });
}
export function createReplayBranchEvidence(
  parent: ReplayCheckpoint,
  parentSpec: ReplaySessionSpecification,
  childSpec: ReplaySessionSpecification,
): ReplayBranchEvidence {
  validateReplayCheckpoint(parent, parentSpec);
  if (
    !parent.timestampComplete ||
    childSpec.sessionId === parentSpec.sessionId ||
    childSpec.startTime !== parentSpec.startTime ||
    childSpec.endTime < parent.logicalTime ||
    childSpec.softwareIdentity !== parentSpec.softwareIdentity ||
    hash(childSpec.datasetFingerprints) !== hash(parentSpec.datasetFingerprints) ||
    hash(childSpec.sourceManifestIds) !== hash(parentSpec.sourceManifestIds) ||
    childSpec.replayMode !== parentSpec.replayMode
  )
    throw Error("INCOMPATIBLE_BRANCH");
  const changedFields = (Object.keys(childSpec) as (keyof ReplaySessionSpecification)[]).filter(
    (k) => !["sessionId", "fingerprint"].includes(k) && hash(childSpec[k]) !== hash(parentSpec[k]),
  );
  const body = {
    parentSessionId: parentSpec.sessionId,
    parentSpecificationFingerprint: parentSpec.fingerprint,
    parentCheckpointId: parent.checkpointId,
    forkTime: parent.logicalTime,
    parentSourceFingerprints: parentSpec.datasetFingerprints,
    parentConfigurationFingerprint: parentSpec.configurationFingerprint,
    branchConfigurationFingerprint: childSpec.configurationFingerprint,
    softwareIdentity: childSpec.softwareIdentity,
    changedFields,
    reconstruction: "FROM_IMMUTABLE_INPUT_ORIGIN" as const,
  };
  return freeze({ ...body, branchId: hash({ childSessionId: childSpec.sessionId, ...body }) });
}
