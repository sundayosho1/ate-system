import { hash, freeze } from "@ate/multitimeframe";
import { validateReplayCheckpoint } from "./checkpoint.js";
import { ReplayAggregationPipeline } from "./pipeline.js";
import { createReplayBranchEvidence } from "./evidence.js";
import type { ReplayCheckpoint, ReplaySessionSpecification, ReplayComparison } from "./types.js";
export type ReplayComparisonInput = Readonly<{
  specification: ReplaySessionSpecification;
  checkpoint: ReplayCheckpoint;
}>;
function validated(input: ReplayComparisonInput) {
  const cp = validateReplayCheckpoint(input.checkpoint, input.specification);
  if (
    cp.aggregation.revisions.length +
      cp.snapshots.reduce((n, s) => n + Object.keys(s.aggregation.selected).length, 0) >
    input.specification.resourceLimits.maxComparisonItems
  )
    throw Error("COMPARISON_CAPACITY");
  // Ask the aggregate owner to validate inherited state and revision/quality lineage too.
  new ReplayAggregationPipeline(input.specification, cp);
  return cp;
}
export function replayOutputIdentity(input: ReplayComparisonInput): string {
  const cp = validated(input);
  const {
    generation: _generation,
    fingerprint: _fingerprint,
    publishedOperationIds: _operations,
    ...aggregation
  } = cp.aggregation;
  const normalizedAggregation = {
    ...aggregation,
    ...(aggregation.consumerLosses
      ? {
          consumerLosses: Object.fromEntries(
            Object.entries(aggregation.consumerLosses).map(
              ([key, { observations: _observations, ...loss }]) => [key, loss],
            ),
          ),
        }
      : {}),
  };
  return hash({
    aggregation: normalizedAggregation,
    snapshots: cp.snapshots.map((s) => ({
      logicalTime: s.logicalTime,
      inputCursor: s.inputCursor,
      mode: s.mode,
      aggregation: s.aggregation,
      continuityFingerprint: s.continuityFingerprint,
    })),
    executedTaskIds: cp.executedTaskIds,
    pendingTasks: cp.pendingTasks,
  });
}
/** Expected policy differences require both a validated immutable fork and a separately
 * reconstructed child-policy reference. A branch name or changed configuration is not proof.
 */
export function compareReplayCheckpoints(
  left: ReplayComparisonInput,
  right: ReplayComparisonInput,
  childReference?: ReplayComparisonInput,
): ReplayComparison {
  let classification: ReplayComparison["classification"] = "INCOMPARABLE";
  const reasons: string[] = [];
  let leftId = "UNVERIFIED",
    rightId = "UNVERIFIED";
  try {
    const a = validated(left),
      b = validated(right),
      x = left.specification,
      y = right.specification;
    leftId = replayOutputIdentity(left);
    rightId = replayOutputIdentity(right);
    const pendingRead = (c: ReplayCheckpoint) =>
      c.evidence.some(
        (e) =>
          e.kind === "CHANNEL_READ_PENDING" &&
          !c.evidence.some(
            (end) =>
              end.identity === e.identity &&
              ["CHANNEL_READ_COMPLETED", "CHANNEL_READ_RECONCILED"].includes(end.kind),
          ),
      );
    if (pendingRead(a) || pendingRead(b)) throw Error("UNRESOLVED_READ_EVIDENCE");
    const sections = (c: ReplayCheckpoint) => ({
      revisions: hash(c.aggregation.revisions),
      quality: hash(
        c.aggregation.revisions.map((r) => ({
          quality: r.quality,
          suppression: r.suppressionEvidence,
        })),
      ),
      lineage: hash(
        c.aggregation.revisions.map((r) => ({
          id: r.revisionId,
          parent: r.parentRevisionId ?? null,
          lineage: r.lineageFingerprint,
        })),
      ),
      continuity: hash(c.aggregation.watermarks),
      snapshots: hash(c.snapshots.map((s) => s.aggregation)),
      scheduledWork: hash({ pending: c.pendingTasks, executed: c.executedTaskIds }),
    });
    const ls = sections(a),
      rs = sections(b);
    const differing = Object.keys(ls).filter(
      (key) => ls[key as keyof typeof ls] !== rs[key as keyof typeof rs],
    );
    if (
      a.inputFingerprint !== b.inputFingerprint ||
      x.replayMode !== y.replayMode ||
      x.softwareIdentity !== y.softwareIdentity ||
      x.clockMode !== y.clockMode ||
      x.orderingPolicy !== y.orderingPolicy ||
      a.logicalTime !== b.logicalTime ||
      a.cursor !== b.cursor ||
      a.timestampComplete !== b.timestampComplete ||
      hash(x.streams) !== hash(y.streams) ||
      x.calendarFingerprint !== y.calendarFingerprint
    ) {
      reasons.push("Source, software, scope, calendar, mode or temporal boundary is incompatible.");
    } else if (
      x.configurationFingerprint === y.configurationFingerprint &&
      hash(x.aggregation) === hash(y.aggregation) &&
      hash(x.tasks) === hash(y.tasks)
    ) {
      classification = leftId === rightId ? "IDENTICAL" : "UNEXPLAINED_DIVERGENCE";
      reasons.push(
        classification === "IDENTICAL"
          ? "Validated owner outputs agree; lifecycle state, checkpoint generation and storage metadata are nonsemantic."
          : "Equivalent policy/context has differing owner outputs, quality, continuity, lineage or scheduled work.",
      );
    } else if (
      b.branch &&
      childReference &&
      hash(createReplayBranchEvidence(a, x, y)) === hash(b.branch)
    ) {
      const reference = validated(childReference);
      if (
        childReference.specification.fingerprint !== y.fingerprint ||
        reference.inputFingerprint !== b.inputFingerprint ||
        reference.logicalTime !== b.logicalTime ||
        reference.cursor !== b.cursor
      )
        throw Error("REFERENCE_CONTEXT");
      classification =
        replayOutputIdentity(childReference) === rightId
          ? "EXPECTED_DIFFERENCE"
          : "UNEXPLAINED_DIVERGENCE";
      reasons.push(
        classification === "EXPECTED_DIFFERENCE"
          ? "Immutable parent fork and an independent child-policy reconstruction explain every derived output difference; no performance ranking is implied."
          : "Child output differs from its independent policy reference.",
      );
    } else {
      reasons.push(
        "Changed policy lacks a verified parent fork and independent child-policy reference.",
      );
    }
    if (differing.length) reasons.push(`Differing semantic sections: ${differing.join(", ")}.`);
    if (classification === "EXPECTED_DIFFERENCE")
      reasons.push(`Validated branch changed: ${b.branch!.changedFields.join(", ")}.`);
  } catch {
    reasons.push("Missing, corrupt or owner-incompatible evidence cannot support comparison.");
  }
  const body = { classification, reasons, left: leftId, right: rightId };
  return freeze({ ...body, fingerprint: hash(body) });
}
