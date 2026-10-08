import { hash, freeze, instant } from "@ate/multitimeframe";
import type { UtcTimestamp } from "@ate/domain";
import { DeterministicReplaySequencer } from "./input.js";
import { verifyReplaySpecification } from "./specification.js";
import {
  createReplayCheckpoint,
  validateReplayCheckpoint,
  replayOperationId,
} from "./checkpoint.js";
import { ReplayAggregationPipeline } from "./pipeline.js";
import type { ReplayCheckpointRepository, ReplayStorageResult } from "./repository.js";
import type {
  ReplayCheckpoint,
  ReplayResolvedInputs,
  ReplaySessionSpecification,
  ReplayState,
  ReplayBranchEvidence,
} from "./types.js";
export type ReplayCommandResult =
  | Readonly<{ ok: true; checkpoint: ReplayCheckpoint }>
  | Readonly<{ ok: false; code: string; state: ReplayState }>;
export class ReplayController {
  private readonly sequencer: DeterministicReplaySequencer;
  private checkpoint: ReplayCheckpoint | undefined;
  private state: ReplayState = "CREATED";
  private busy = false;
  private stopRequested = false;
  private pauseRequested = false;
  private obligation: Readonly<{ operationId: string; commitment: string }> | undefined;
  public constructor(
    public readonly specification: ReplaySessionSpecification,
    private readonly inputs: ReplayResolvedInputs,
    private readonly repository: ReplayCheckpointRepository,
    private readonly branch?: ReplayBranchEvidence,
  ) {
    verifyReplaySpecification(specification);
    this.sequencer = new DeterministicReplaySequencer(specification, inputs);
  }
  public diagnostics() {
    return freeze({
      state: this.state,
      busy: this.busy,
      checkpointId: this.checkpoint?.checkpointId ?? null,
      cursor: this.checkpoint?.cursor ?? 0,
      logicalTime: this.checkpoint?.logicalTime ?? this.specification.startTime,
      obligation: this.obligation ?? null,
      remainingEvents: this.sequencer.events.length - (this.checkpoint?.cursor ?? 0),
    });
  }
  public currentCheckpoint(): ReplayCheckpoint | undefined {
    return this.checkpoint;
  }
  private fail(code: string, state: ReplayState = this.state): ReplayCommandResult {
    return { ok: false, code, state };
  }
  private publish(c: ReplayCheckpoint): ReplayCommandResult {
    if (this.stopRequested) return this.fail("STOP_REQUESTED", "STOPPING");
    const operationId = replayOperationId(c);
    this.obligation = freeze({ operationId, commitment: "UNKNOWN_COMMITMENT" });
    try {
      const committed = this.repository.commit(c);
      if (!committed.ok) return this.storageFailure(committed);
      this.obligation = freeze({ operationId, commitment: "COMMITTED" });
      if (this.stopRequested) {
        this.state = "RECOVERY_REQUIRED";
        return this.fail("COMMITTED_DURING_SHUTDOWN");
      }
      const visible = this.repository.publish(operationId);
      if (!visible.ok) return this.storageFailure(visible);
      if (this.stopRequested) {
        this.state = "RECOVERY_REQUIRED";
        return this.fail("PUBLISHED_DURING_SHUTDOWN");
      }
      this.obligation = undefined;
      this.checkpoint = c;
      this.state = c.state;
      return { ok: true, checkpoint: c };
    } catch {
      this.state = "RECOVERY_REQUIRED";
      return this.fail("STORAGE_EXCEPTION");
    }
  }

  private storageFailure(
    r: Extract<ReplayStorageResult<unknown>, { ok: false }>,
  ): ReplayCommandResult {
    if (r.commitment !== "CONFIRMED_NOT_COMMITTED") {
      this.obligation = freeze({ operationId: r.operationId, commitment: r.commitment });
      this.state = "RECOVERY_REQUIRED";
    } else {
      this.obligation = undefined;
      this.state = this.checkpoint?.state ?? "FAILED";
    }
    return this.fail(r.code);
  }
  public async initialize(): Promise<ReplayCommandResult> {
    if (this.busy || this.state !== "CREATED") return this.fail("INVALID_LIFECYCLE");
    this.busy = true;
    this.state = "VALIDATING";
    try {
      await this.inputs.verify();
      if (this.stopRequested) return this.fail("STOP_REQUESTED", "STOPPING");
      this.obligation = freeze({
        operationId: hash(this.specification.sessionId),
        commitment: "UNKNOWN_COMMITMENT",
      });
      const recovered = this.repository.recover(this.specification);
      if (!recovered.ok) return this.storageFailure(recovered);
      this.obligation = undefined;
      if (recovered.value) {
        const c = validateReplayCheckpoint(recovered.value.checkpoint, this.specification);
        this.validateCursor(c);
        new ReplayAggregationPipeline(this.specification, c);
        this.checkpoint = c;
        this.state = c.state;
        return { ok: true, checkpoint: c };
      }
      const pipeline = new ReplayAggregationPipeline(this.specification);
      const a = pipeline.engine.exportReplayCheckpoint();
      if (!a.ok) throw Error(a.error.code);
      return this.publish(
        createReplayCheckpoint({
          schemaVersion: 1,
          specificationFingerprint: this.specification.fingerprint,
          sessionId: this.specification.sessionId,
          inputFingerprint: this.inputs.fingerprint,
          generation: 1,
          cursor: 0,
          lastEventId: null,
          logicalTime: this.specification.startTime,
          state: "READY",
          timestampComplete:
            !this.sequencer.events.some((e) => e.eligibilityAt === this.specification.startTime) &&
            !this.specification.tasks.some((t) => t.dueAt === this.specification.startTime),
          pendingTasks: this.specification.tasks,
          executedTaskIds: [],
          aggregation: a.value,
          snapshots: [],
          ...(this.branch ? { branch: this.branch } : {}),
          children: [],
          evidence: [],
        }),
      );
    } catch {
      this.state = this.obligation ? "RECOVERY_REQUIRED" : "FAILED";
      return this.fail("INITIALIZATION_FAILED");
    } finally {
      this.busy = false;
    }
  }
  private validateCursor(c: ReplayCheckpoint): void {
    if (
      c.inputFingerprint !== this.inputs.fingerprint ||
      c.cursor > this.sequencer.events.length ||
      c.lastEventId !== (this.sequencer.events[c.cursor - 1]?.eventId ?? null) ||
      this.sequencer.events.slice(0, c.cursor).some((e) => e.eligibilityAt > c.logicalTime) ||
      (this.sequencer.events[c.cursor]?.eligibilityAt ?? c.logicalTime) < c.logicalTime
    )
      throw Error("CURSOR_INTEGRITY");
    if (c.state === "COMPLETED" && c.cursor !== this.sequencer.events.length)
      throw Error("COMPLETION_OBLIGATION");
  }
  public async stepEvent(): Promise<ReplayCommandResult> {
    return this.runBoundary("EVENT");
  }
  public async stepTimestamp(): Promise<ReplayCommandResult> {
    return this.runBoundary("TIMESTAMP");
  }
  private async runBoundary(
    mode: "EVENT" | "TIMESTAMP",
    target?: UtcTimestamp,
  ): Promise<ReplayCommandResult> {
    if (this.busy) return this.fail("REENTRANT_OPERATION");
    if (!this.checkpoint || !["READY", "RUNNING", "PAUSED"].includes(this.state) || this.obligation)
      return this.fail("INVALID_LIFECYCLE");
    this.busy = true;
    try {
      await this.inputs.verify();
      if (this.stopRequested) {
        this.state = "STOPPING";
        return this.fail("STOP_REQUESTED");
      }
      const old = this.checkpoint;
      const nextEvent = this.sequencer.events[old.cursor];
      const nextTask = old.pendingTasks[0];
      const candidates = [nextEvent?.eligibilityAt, nextTask?.dueAt]
        .filter((t): t is UtcTimestamp => t !== undefined)
        .sort();
      const next = candidates[0];
      const at = target && (!next || target < next) ? target : (next ?? this.specification.endTime);
      if (at < old.logicalTime || at > this.specification.endTime) throw Error("REPLAY_TIME_RANGE");
      if (
        mode === "TIMESTAMP" &&
        this.sequencer.events.filter((e, index) => index >= old.cursor && e.eligibilityAt === at)
          .length > this.specification.resourceLimits.maxEventsPerBatch
      )
        return this.fail("TIMESTAMP_BATCH_CAPACITY");
      const pipeline = new ReplayAggregationPipeline(this.specification, old);
      pipeline.advance(at);
      let cursor = old.cursor;
      while (this.sequencer.events[cursor]?.eligibilityAt === at) {
        pipeline.ingest(this.sequencer.events[cursor]!);
        cursor++;
        if (mode === "EVENT") break;
      }
      const cohortComplete = this.sequencer.events[cursor]?.eligibilityAt !== at;
      const due = cohortComplete ? old.pendingTasks.filter((t) => t.dueAt === at) : [];
      const snapshots = [...old.snapshots, ...(await pipeline.execute(due, cursor))];
      if (snapshots.length > this.specification.resourceLimits.maxSnapshots)
        throw Error("SNAPSHOT_CAPACITY");
      const pending = old.pendingTasks.filter((t) => !due.includes(t));
      const aggregate = pipeline.engine.exportReplayCheckpoint();
      if (!aggregate.ok) throw Error(aggregate.error.code);
      const completed =
        cursor === this.sequencer.events.length &&
        !pending.length &&
        cohortComplete &&
        at === this.specification.endTime;
      const state = completed
        ? "COMPLETED"
        : this.pauseRequested || old.state === "PAUSED"
          ? "PAUSED"
          : "RUNNING";
      const c = createReplayCheckpoint({
        ...old,
        generation: old.generation + 1,
        cursor,
        lastEventId: this.sequencer.events[cursor - 1]?.eventId ?? null,
        logicalTime: at,
        state,
        timestampComplete: cohortComplete && !pending.some((t) => t.dueAt === at),
        pendingTasks: pending,
        executedTaskIds: [...old.executedTaskIds, ...due.map((t) => t.taskId)],
        aggregation: aggregate.value,
        snapshots,
      });
      const result = this.publish(c);
      this.pauseRequested = false;
      return result;
    } catch {
      if (this.state !== "RECOVERY_REQUIRED") this.state = "FAILED";
      return this.fail("REPLAY_BOUNDARY_FAILED");
    } finally {
      this.busy = false;
    }
  }
  public async runToTime(raw: UtcTimestamp): Promise<ReplayCommandResult> {
    const at = instant(raw);
    if (this.busy) return this.fail("REENTRANT_OPERATION");
    if (!this.checkpoint || at < this.checkpoint.logicalTime || at > this.specification.endTime)
      return this.fail("REPLAY_TIME_RANGE");
    if (this.state === "PAUSED") return this.fail("SESSION_PAUSED");
    let result: ReplayCommandResult = { ok: true, checkpoint: this.checkpoint };
    while (this.checkpoint.logicalTime < at || !this.checkpoint.timestampComplete) {
      result = await this.runBoundary("TIMESTAMP", at);
      if (
        !result.ok ||
        this.state === "COMPLETED" ||
        this.pauseRequested ||
        this.diagnostics().state === "PAUSED"
      )
        return result;
    }
    return result;
  }
  public async runToEnd(): Promise<ReplayCommandResult> {
    return this.runToTime(this.specification.endTime);
  }
  public async pause(): Promise<ReplayCommandResult> {
    if (this.busy) {
      this.pauseRequested = true;
      return this.fail("PAUSE_PENDING_BOUNDARY");
    }
    return this.control("PAUSED");
  }
  public async resume(): Promise<ReplayCommandResult> {
    if (this.state !== "PAUSED") return this.fail("INVALID_LIFECYCLE");
    return this.control("RUNNING");
  }
  public async stop(): Promise<ReplayCommandResult> {
    if (this.busy) {
      this.stopRequested = true;
      this.state = "STOPPING";
      return this.fail("SHUTDOWN_IN_PROGRESS");
    }
    if (this.obligation || this.state === "RECOVERY_REQUIRED")
      return this.fail("RECOVERY_OBLIGATION");
    if (this.state === "STOPPED" && this.checkpoint)
      return { ok: true, checkpoint: this.checkpoint };
    this.stopRequested = false;
    return this.control("STOPPED");
  }
  private async control(state: "PAUSED" | "RUNNING" | "STOPPED"): Promise<ReplayCommandResult> {
    if (
      this.busy ||
      !this.checkpoint ||
      this.obligation ||
      !["READY", "RUNNING", "PAUSED", "STOPPING"].includes(this.state)
    )
      return this.fail("INVALID_LIFECYCLE");
    this.busy = true;
    try {
      await this.inputs.verify();
      return this.publish(
        createReplayCheckpoint({
          ...this.checkpoint,
          generation: this.checkpoint.generation + 1,
          state,
        }),
      );
    } catch {
      this.state = "FAILED";
      return this.fail("SOURCE_VERIFICATION_FAILED");
    } finally {
      this.busy = false;
    }
  }
  public async snapshot(
    streamId: string,
    timeframes: readonly string[],
    includeIncomplete = false,
  ): Promise<ReplayCommandResult> {
    if (
      this.busy ||
      !this.checkpoint ||
      this.obligation ||
      !["READY", "RUNNING", "PAUSED", "COMPLETED"].includes(this.state)
    )
      return this.fail("INVALID_LIFECYCLE");
    if (!this.checkpoint.timestampComplete) return this.fail("INCOMPLETE_TIMESTAMP_BOUNDARY");
    if (this.checkpoint.snapshots.length >= this.specification.resourceLimits.maxSnapshots)
      return this.fail("SNAPSHOT_CAPACITY");
    this.busy = true;
    try {
      await this.inputs.verify();
      const pipeline = new ReplayAggregationPipeline(this.specification, this.checkpoint);
      const snapshot = pipeline.snapshot(
        streamId,
        timeframes,
        this.checkpoint.cursor,
        includeIncomplete,
        this.checkpoint.pendingTasks,
      );
      return this.publish(
        createReplayCheckpoint({
          ...this.checkpoint,
          generation: this.checkpoint.generation + 1,
          snapshots: [...this.checkpoint.snapshots, snapshot],
        }),
      );
    } catch {
      return this.fail("SNAPSHOT_REJECTED");
    } finally {
      this.busy = false;
    }
  }
  public async recordBranch(evidence: ReplayBranchEvidence): Promise<ReplayCommandResult> {
    if (this.busy || !this.checkpoint || this.obligation || !this.checkpoint.timestampComplete)
      return this.fail("INVALID_BRANCH_BOUNDARY");
    const prior = this.checkpoint.children.find((b) => b.branchId === evidence.branchId);
    if (prior)
      return hash(prior) === hash(evidence)
        ? { ok: true, checkpoint: this.checkpoint }
        : this.fail("BRANCH_IDENTITY_CONFLICT");
    if (
      evidence.parentCheckpointId !== this.checkpoint.checkpointId ||
      evidence.parentSessionId !== this.specification.sessionId ||
      evidence.parentSpecificationFingerprint !== this.specification.fingerprint ||
      evidence.forkTime !== this.checkpoint.logicalTime
    )
      return this.fail("BRANCH_CONTEXT");
    if (this.checkpoint.children.length >= this.specification.resourceLimits.maxBranches)
      return this.fail("BRANCH_CAPACITY");
    this.busy = true;
    try {
      await this.inputs.verify();
      return this.publish(
        createReplayCheckpoint({
          ...this.checkpoint,
          generation: this.checkpoint.generation + 1,
          children: [...this.checkpoint.children, evidence],
        }),
      );
    } finally {
      this.busy = false;
    }
  }
  public semanticFingerprint(): string | undefined {
    return this.checkpoint
      ? hash({
          input: this.checkpoint.inputFingerprint,
          cursor: this.checkpoint.cursor,
          time: this.checkpoint.logicalTime,
          aggregation: this.checkpoint.aggregation,
          snapshots: this.checkpoint.snapshots,
          pending: this.checkpoint.pendingTasks,
        })
      : undefined;
  }
}
