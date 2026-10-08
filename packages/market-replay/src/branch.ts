import {
  mkdirSync,
  lstatSync,
  realpathSync,
  existsSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
  opendirSync,
} from "node:fs";
import { join } from "node:path";
import { schemas } from "@ate/domain";
import type { Clock } from "@ate/time";
import { hash, freeze, safeClone } from "@ate/multitimeframe";
import { createReplaySpecification, createGovernedReplaySpecification } from "./specification.js";
import type { EffectiveConfiguration } from "@ate/configuration";
import { createReplayBranchEvidence } from "./evidence.js";
import { verifyReplaySpecification } from "./specification.js";
import { replayOperationId, validateReplayCheckpoint } from "./checkpoint.js";
import { ReplayController } from "./controller.js";
import { FilesystemReplayCheckpointRepository } from "./repository.js";
import type {
  ReplayBranchEvidence,
  ReplayCheckpoint,
  ReplaySessionSpecification,
  ReplayResolvedInputs,
} from "./types.js";
import type { ReplayLimits } from "./configuration.js";
export type BranchCreationStage =
  "BEFORE_RESERVATION" | "AFTER_RESERVATION" | "AFTER_CHILD_RECOVERY" | "AFTER_PUBLICATION";
export type ReplayBranchRecord = Readonly<{
  schemaVersion: 1;
  childSpecification: ReplaySessionSpecification;
  parentSpecification: ReplaySessionSpecification;
  parentCheckpoint: ReplayCheckpoint;
  inputFingerprint: string;
  evidence: ReplayBranchEvidence;
  fingerprint: string;
}>;
export type ReplayBranchResult =
  | Readonly<{ ok: true; record: ReplayBranchRecord; controller: ReplayController }>
  | Readonly<{
      ok: false;
      code: string;
      branchId: string | null;
      commitment: "CONFIRMED_NOT_COMMITTED" | "UNKNOWN_COMMITMENT";
    }>;
/** Include acknowledged operational read/loss history in the immutable reconstruction plan.
 * These actions run after the original same-time cohort/tasks, matching channel observation
 * admission at an already completed replay boundary. Never silently repair a parent gap.
 */
export function completeReplayBranchSpecification(
  parent: ReplayCheckpoint,
  parentSpec: ReplaySessionSpecification,
  desired: ReplaySessionSpecification,
): ReplaySessionSpecification {
  validateReplayCheckpoint(parent, parentSpec);
  const tasks = [...desired.tasks];
  const add = (task: ReplaySessionSpecification["tasks"][number]) => {
    const old = tasks.find((t) => t.taskId === task.taskId);
    if (old && hash(old) !== hash(task)) throw Error("FORK_INTEGRITY_IDENTITY_CONFLICT");
    if (!old) tasks.push(task);
  };
  for (const read of parent.evidence.filter((e) => e.kind === "CHANNEL_READ_PENDING"))
    for (const stream of parentSpec.streams)
      add({
        taskId: `fork-fence-${hash({ read, stream })}`,
        dueAt: read.at,
        action: {
          kind: "FORK_FENCE",
          streamId: hash(stream),
          reason: "INHERITED_CHANNEL_READ_SCOPE",
        },
      });
  for (const loss of Object.values(parent.aggregation.consumerLosses ?? {})) {
    const existing = parentSpec.tasks.some(
      (t) =>
        (t.action.kind === "LOSS" || t.action.kind === "FORK_LOSS") &&
        t.action.consumerId === loss.consumerId &&
        t.action.contextFingerprint === loss.contextFingerprint &&
        t.action.rejected === loss.rejected &&
        t.action.discarded === loss.discarded &&
        t.action.closed === loss.closed &&
        t.action.degraded === loss.degraded,
    );
    if (!existing)
      add({
        taskId: `fork-loss-${hash(loss)}`,
        dueAt: loss.observedAt,
        action: {
          kind: "FORK_LOSS",
          consumerId: loss.consumerId,
          contextFingerprint: loss.contextFingerprint,
          rejected: loss.rejected,
          discarded: loss.discarded,
          closed: loss.closed,
          degraded: loss.degraded,
        },
      });
  }
  const { fingerprint: _fp, ...raw } = desired;
  return createReplaySpecification({ ...raw, tasks });
}
/** An immutable branch reservation plus one publication marker is the branch transaction.
 * Child checkpoints are private to this registry until the marker is acknowledged. The
 * parent checkpoint/history is never written. Recovery always reconstructs changed policy
 * from the same immutable input origin, not inherited derived aggregate state.
 */
export class FilesystemReplayBranchRegistry {
  private readonly root: string;
  private busy = false;
  public constructor(
    root: string,
    private readonly clock: Clock,
    private readonly limits: ReplayLimits,
    private readonly stage?: (stage: BranchCreationStage) => void,
  ) {
    mkdirSync(root, { recursive: true });
    if (lstatSync(root).isSymbolicLink()) throw Error("UNSAFE_BRANCH_ROOT");
    this.root = realpathSync(root);
    const sessions = join(this.root, "sessions");
    mkdirSync(sessions, { recursive: true });
    if (lstatSync(sessions).isSymbolicLink()) throw Error("UNSAFE_BRANCH_NAMESPACE");
  }
  private path(id: string, suffix: string): string {
    if (!/^[a-f0-9]{64}$/u.test(id)) throw Error("BRANCH_IDENTITY");
    const path = join(this.root, id + suffix);
    if (existsSync(path)) {
      const st = lstatSync(path);
      if (
        !st.isFile() ||
        st.isSymbolicLink() ||
        st.nlink !== 1 ||
        st.size > (suffix.includes("visible") ? 2048 : this.limits.maxCheckpointBytes)
      )
        throw Error("UNSAFE_BRANCH_ARTIFACT");
    }
    return path;
  }
  private inventory(): string[] {
    const ids = new Set<string>();
    const dir = opendirSync(this.root);
    let count = 0;
    try {
      let entry;
      while ((entry = dir.readSync()) !== null) {
        if (entry.name === "sessions") {
          if (!entry.isDirectory() || entry.isSymbolicLink())
            throw Error("UNSAFE_BRANCH_NAMESPACE");
          continue;
        }
        if (
          ++count > this.limits.maxBranches * 4 ||
          !/^[a-f0-9]{64}\.(json|visible)(\.tmp)?$/u.test(entry.name)
        )
          throw Error("BRANCH_CAPACITY_OR_ARTIFACT");
        this.path(entry.name.slice(0, 64), entry.name.slice(64));
        ids.add(entry.name.slice(0, 64));
      }
    } finally {
      dir.closeSync();
    }
    if (ids.size > this.limits.maxBranches) throw Error("BRANCH_CAPACITY");
    return [...ids];
  }
  private write(id: string, suffix: string, content: string): void {
    const temporary = this.path(id, suffix + ".tmp");
    const fd = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, this.path(id, suffix));
  }
  private validate(record: ReplayBranchRecord, id: string): void {
    const { fingerprint, ...body } = record;
    if (hash(body) !== fingerprint || record.schemaVersion !== 1 || record.evidence.branchId !== id)
      throw Error("BRANCH_INTEGRITY");
    verifyReplaySpecification(record.parentSpecification);
    verifyReplaySpecification(record.childSpecification);
    validateReplayCheckpoint(record.parentCheckpoint, record.parentSpecification);
    if (
      hash(
        createReplayBranchEvidence(
          record.parentCheckpoint,
          record.parentSpecification,
          record.childSpecification,
        ),
      ) !== hash(record.evidence)
    )
      throw Error("BRANCH_LINEAGE");
  }
  private read(id: string): ReplayBranchRecord {
    const record = safeClone(
      JSON.parse(readFileSync(this.path(id, ".json"), "utf8")),
      this.limits.maxCheckpointBytes,
    ) as ReplayBranchRecord;
    this.validate(record, id);
    return freeze(record);
  }
  private repository(spec: ReplaySessionSpecification): FilesystemReplayCheckpointRepository {
    const namespace = join(this.root, "sessions", hash(spec.sessionId));
    if (existsSync(namespace) && lstatSync(namespace).isSymbolicLink())
      throw Error("UNSAFE_BRANCH_NAMESPACE");
    return new FilesystemReplayCheckpointRepository(namespace, this.clock, spec.resourceLimits);
  }
  public records(): readonly ReplayBranchRecord[] {
    return freeze(
      this.inventory()
        .filter((id) => existsSync(this.path(id, ".visible")))
        .map((id) => {
          const record = this.read(id);
          const marker = JSON.parse(readFileSync(this.path(id, ".visible"), "utf8")) as {
            recordFingerprint: string;
            childCheckpointId: string;
            childOperationId: string;
            publishedAt: string;
            fingerprint: string;
          };
          const { fingerprint, ...body } = marker;
          if (
            !schemas.timestamp.safeParse(marker.publishedAt).success ||
            marker.publishedAt > this.clock.now() ||
            hash(body) !== fingerprint ||
            marker.recordFingerprint !== record.fingerprint ||
            !/^[a-f0-9]{64}$/u.test(marker.childCheckpointId)
          )
            throw Error("BRANCH_MARKER_INTEGRITY");
          const checkpoint = this.repository(record.childSpecification).readPublished(
            marker.childOperationId,
            record.childSpecification,
          );
          if (
            !checkpoint.ok ||
            checkpoint.value.checkpoint.checkpointId !== marker.childCheckpointId ||
            hash(checkpoint.value.checkpoint.branch) !== hash(record.evidence)
          )
            throw Error("BRANCH_CHILD_COMMITMENT");
          return record;
        }),
    );
  }
  public async forkGoverned(
    parent: ReplayController,
    rawChild: unknown,
    inputs: ReplayResolvedInputs,
    effective: EffectiveConfiguration,
  ): Promise<ReplayBranchResult> {
    try {
      return await this.fork(
        parent,
        createGovernedReplaySpecification(rawChild, effective),
        inputs,
      );
    } catch {
      return {
        ok: false,
        code: "GOVERNED_BRANCH_CONFIGURATION",
        branchId: null,
        commitment: "CONFIRMED_NOT_COMMITTED",
      };
    }
  }
  public async fork(
    parent: ReplayController,
    child: ReplaySessionSpecification,
    inputs: ReplayResolvedInputs,
  ): Promise<ReplayBranchResult> {
    const cp = parent.currentCheckpoint();
    if (
      !cp ||
      parent.diagnostics().busy ||
      parent.diagnostics().obligation ||
      parent.diagnostics().pendingConsumerReads
    )
      return {
        ok: false,
        code: "PARENT_NOT_FORKABLE",
        branchId: null,
        commitment: "CONFIRMED_NOT_COMMITTED",
      };
    let evidence: ReplayBranchEvidence;
    try {
      evidence = createReplayBranchEvidence(cp, parent.specification, child);
    } catch {
      return {
        ok: false,
        code: "INCOMPATIBLE_BRANCH",
        branchId: null,
        commitment: "CONFIRMED_NOT_COMMITTED",
      };
    }
    return this.create(
      {
        schemaVersion: 1,
        parentSpecification: parent.specification,
        parentCheckpoint: cp,
        childSpecification: child,
        inputFingerprint: inputs.fingerprint,
        evidence,
        fingerprint: "",
      },
      inputs,
    );
  }
  public async recover(
    branchId: string,
    inputs: ReplayResolvedInputs,
  ): Promise<ReplayBranchResult> {
    try {
      return await this.create(this.read(branchId), inputs);
    } catch {
      return {
        ok: false,
        code: "BRANCH_RECOVERY_REQUIRED",
        branchId,
        commitment: "UNKNOWN_COMMITMENT",
      };
    }
  }
  private async create(
    candidate: ReplayBranchRecord,
    inputs: ReplayResolvedInputs,
  ): Promise<ReplayBranchResult> {
    const id = candidate.evidence.branchId;
    if (this.busy)
      return {
        ok: false,
        code: "REENTRANT_BRANCH_CREATION",
        branchId: id,
        commitment: "CONFIRMED_NOT_COMMITTED",
      };
    this.busy = true;
    let attempted = false;
    try {
      await inputs.verify();
      verifyReplaySpecification(candidate.childSpecification);
      if (inputs.fingerprint !== candidate.inputFingerprint) throw Error("BRANCH_INPUT_CONTEXT");
      if (
        completeReplayBranchSpecification(
          candidate.parentCheckpoint,
          candidate.parentSpecification,
          candidate.childSpecification,
        ).fingerprint !== candidate.childSpecification.fingerprint
      )
        throw Error("FORK_INTEGRITY_PLAN_REQUIRED");
      const parent = candidate.parentSpecification,
        child = candidate.childSpecification;
      if (
        hash(child.streams) !== hash(parent.streams) ||
        child.calendarFingerprint !== parent.calendarFingerprint ||
        hash(child.instrumentScope) !== hash(parent.instrumentScope) ||
        hash(child.sourceScope) !== hash(parent.sourceScope) ||
        hash(child.channelScope) !== hash(parent.channelScope)
      )
        throw Error("INCOMPATIBLE_BRANCH_CONTEXT");
      const { fingerprint: _fingerprint, ...body } = candidate;
      const record = freeze({ ...body, fingerprint: hash(body) });
      this.validate(record, id);
      const inventory = this.inventory(),
        path = this.path(id, ".json");
      if (existsSync(path)) {
        attempted = true;
        if (this.read(id).fingerprint !== record.fingerprint)
          throw Error("BRANCH_IDENTITY_CONFLICT");
      } else {
        if (inventory.length >= Math.min(this.limits.maxBranches, this.limits.maxSessions))
          throw Error("BRANCH_CAPACITY");
        for (const existingId of inventory) {
          if (!existsSync(this.path(existingId, ".json")))
            throw Error("UNRESOLVED_BRANCH_ARTIFACT");
          if (this.read(existingId).childSpecification.sessionId === child.sessionId)
            throw Error("CHILD_SESSION_IDENTITY_CONFLICT");
        }
        if (Buffer.byteLength(JSON.stringify(record)) > this.limits.maxCheckpointBytes)
          throw Error("BRANCH_BYTE_LIMIT");
        this.stage?.("BEFORE_RESERVATION");
        attempted = true;
        this.write(id, ".json", JSON.stringify(record));
        this.stage?.("AFTER_RESERVATION");
      }
      const controller = new ReplayController(
        child,
        inputs,
        this.repository(child),
        record.evidence,
      );
      const initialized = await controller.initialize();
      if (!initialized.ok) throw Error(initialized.code);
      this.stage?.("AFTER_CHILD_RECOVERY");
      const markerPath = this.path(id, ".visible");
      if (!existsSync(markerPath)) {
        const cp = controller.currentCheckpoint()!;
        if (cp.logicalTime > record.evidence.forkTime) throw Error("UNPUBLISHED_BRANCH_ADVANCED");
        if (cp.state === "PAUSED") {
          const resumed = await controller.resume();
          if (!resumed.ok) throw Error(resumed.code);
        }
        const run = await controller.runToTime(record.evidence.forkTime);
        if (!run.ok) throw Error(run.code);
        const paused = run.checkpoint.state === "COMPLETED" ? run : await controller.pause();
        if (!paused.ok) throw Error(paused.code);
        const markerBody = {
          recordFingerprint: record.fingerprint,
          childCheckpointId: paused.checkpoint.checkpointId,
          childOperationId: replayOperationId(paused.checkpoint),
          publishedAt: this.clock.now(),
        };
        this.write(
          id,
          ".visible",
          JSON.stringify({ ...markerBody, fingerprint: hash(markerBody) }),
        );
        this.stage?.("AFTER_PUBLICATION");
      }
      const published = this.records().find((r) => r.evidence.branchId === id);
      if (!published) throw Error("BRANCH_PUBLICATION_MISSING");
      const recovered = controller.currentCheckpoint()!;
      if (hash(recovered.branch) !== hash(record.evidence)) throw Error("CHILD_LINEAGE_CONTEXT");
      return { ok: true, record: published, controller };
    } catch {
      return {
        ok: false,
        code: "BRANCH_CREATION_REQUIRED_RECOVERY",
        branchId: id,
        commitment: attempted ? "UNKNOWN_COMMITMENT" : "CONFIRMED_NOT_COMMITTED",
      };
    } finally {
      this.busy = false;
    }
  }
}
