import { hash, freeze, safeClone, instant } from "@ate/multitimeframe";
import type { ReplayCheckpoint, ReplaySessionSpecification } from "./types.js";

export type ReplayCheckpointBody = Omit<ReplayCheckpoint, "checkpointId" | "fingerprint">;
export function createReplayCheckpoint(body: ReplayCheckpointBody): ReplayCheckpoint {
  const { checkpointId: _priorId, fingerprint: _priorHash, ...clean } = body as ReplayCheckpoint;
  const { generation: _generation, state: _state, ...semantic } = clean;
  const checkpointId = hash(semantic);
  return freeze({ ...clean, checkpointId, fingerprint: hash({ ...clean, checkpointId }) });
}
export function validateReplayCheckpoint(
  raw: unknown,
  spec: ReplaySessionSpecification,
): ReplayCheckpoint {
  const c = safeClone(raw, spec.resourceLimits.maxCheckpointBytes) as ReplayCheckpoint;
  const { checkpointId, fingerprint, ...body } = c;
  const expected = createReplayCheckpoint(body);
  if (
    fingerprint !== expected.fingerprint ||
    checkpointId !== expected.checkpointId ||
    c.schemaVersion !== 1 ||
    c.sessionId !== spec.sessionId ||
    c.specificationFingerprint !== spec.fingerprint ||
    !Number.isSafeInteger(c.generation) ||
    c.generation < 1 ||
    c.generation > spec.resourceLimits.maxCheckpoints ||
    !Number.isSafeInteger(c.cursor) ||
    c.cursor < 0 ||
    c.cursor > spec.resourceLimits.maxEventsPerSession ||
    typeof c.timestampComplete !== "boolean" ||
    !["READY", "RUNNING", "PAUSED", "STOPPED", "COMPLETED"].includes(c.state) ||
    c.logicalTime < spec.startTime ||
    c.logicalTime > spec.endTime ||
    c.snapshots.length > spec.resourceLimits.maxSnapshots ||
    c.children.length > spec.resourceLimits.maxBranches ||
    c.evidence.length > spec.resourceLimits.maxEvidenceRecords ||
    c.pendingTasks.length > spec.resourceLimits.maxPendingTasks
  )
    throw Error("CHECKPOINT_INTEGRITY");
  instant(c.logicalTime);
  const expectedTasks = new Map(spec.tasks.map((t) => [t.taskId, hash(t)]));
  const ids = [...c.pendingTasks.map((t) => t.taskId), ...c.executedTaskIds];
  if (
    new Set(ids).size !== ids.length ||
    ids.length !== spec.tasks.length ||
    ids.some((id) => !expectedTasks.has(id)) ||
    c.pendingTasks.some(
      (t) => expectedTasks.get(t.taskId) !== hash(t) || t.dueAt < c.logicalTime,
    ) ||
    c.executedTaskIds.some((id) => spec.tasks.find((t) => t.taskId === id)!.dueAt > c.logicalTime)
  )
    throw Error("CHECKPOINT_TASK_INTEGRITY");
  if (
    c.state === "COMPLETED" &&
    (!c.timestampComplete || c.pendingTasks.length || c.logicalTime !== spec.endTime)
  )
    throw Error("COMPLETION_OBLIGATION");
  const { fingerprint: aggregateFingerprint, ...aggregateBody } = c.aggregation;
  if (
    hash(aggregateBody) !== aggregateFingerprint ||
    c.aggregation.configurationFingerprint !== spec.configurationFingerprint
  )
    throw Error("AGGREGATION_CHECKPOINT_INTEGRITY");
  for (const snapshot of c.snapshots) {
    const { snapshotId, semanticFingerprint, ...snapshotBody } = snapshot;
    if (
      snapshotId !== semanticFingerprint ||
      semanticFingerprint !== hash(snapshotBody) ||
      snapshot.logicalTime > c.logicalTime ||
      snapshot.inputCursor > c.cursor ||
      snapshot.specificationFingerprint !== spec.fingerprint ||
      snapshot.sessionId !== spec.sessionId
    )
      throw Error("SNAPSHOT_INTEGRITY");
  }
  return freeze(c);
}
export const replayOperationId = (c: ReplayCheckpoint) =>
  hash({
    sessionId: c.sessionId,
    specificationFingerprint: c.specificationFingerprint,
    generation: c.generation,
    fingerprint: c.fingerprint,
  });
