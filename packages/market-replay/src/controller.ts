import { hash, freeze, instant } from "@ate/multitimeframe";
import type { UtcTimestamp } from "@ate/domain";
import type { ConsumerChannel } from "@ate/realtime-data";
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
function rejectionFailureCode(
  rejection: unknown,
  fallback: "UNCLASSIFIED_INITIALIZATION_FAILURE" | "UNCLASSIFIED_BOUNDARY_FAILURE",
): string {
  // Arbitrary verifier rejection values are not trusted diagnostic objects.
  // Read at most once; never coerce, inspect stacks or format the rejection.
  try {
    if (typeof rejection === "object" && rejection !== null) {
      const message = (rejection as { message?: unknown }).message;
      if (
        typeof message === "string" &&
        message.length <= 128 &&
        /^[A-Z][A-Z0-9_]{0,127}$/u.test(message)
      )
        return message;
    }
  } catch {
    // Diagnostic extraction cannot interrupt authoritative failure handling.
  }
  return fallback;
}
export class ReplayController {
  private readonly sequencer: DeterministicReplaySequencer;
  private checkpoint: ReplayCheckpoint | undefined;
  private state: ReplayState = "CREATED";
  private busy = false;
  private stopRequested = false;
  private pauseRequested = false;
  private lastFailureCode: string | null = null;
  private sourceVerification: "NOT_STARTED" | "IN_FLIGHT" | "VERIFIED" | "FAILED" = "NOT_STARTED";
  private repositoryPhase:
    | "NOT_INITIATED"
    | "RECOVERY_IN_FLIGHT"
    | "RECOVERED_EMPTY"
    | "RECOVERED_CONTENT"
    | "WRITE_INITIATED" = "NOT_INITIATED";
  private readonly observedChannels = new WeakSet<ConsumerChannel>();
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
      lastFailureCode: this.lastFailureCode,
      sourceVerification: this.sourceVerification,
      repositoryPhase: this.repositoryPhase,
      busy: this.busy,
      checkpointId: this.checkpoint?.checkpointId ?? null,
      cursor: this.checkpoint?.cursor ?? 0,
      logicalTime: this.checkpoint?.logicalTime ?? this.specification.startTime,
      obligation: this.obligation ?? null,
      remainingEvents: this.sequencer.events.length - (this.checkpoint?.cursor ?? 0),
      pendingConsumerReads:
        this.checkpoint?.evidence.filter(
          (e) =>
            e.kind === "CHANNEL_READ_PENDING" &&
            !this.checkpoint!.evidence.some(
              (x) =>
                x.identity === e.identity &&
                ["CHANNEL_READ_COMPLETED", "CHANNEL_READ_RECONCILED"].includes(x.kind),
            ),
        ).length ?? 0,
    });
  }
  /** Initialization provenance, not absence of a checkpoint, proves safe disposal.
   * An honest empty recovery may also certify cancellation before any write. */
  public canDisposeProvisionalAdmission(): boolean {
    return (
      !this.busy &&
      !this.checkpoint &&
      !this.obligation &&
      ((["FAILED", "STOPPING"].includes(this.state) &&
        ["FAILED", "NOT_STARTED", "VERIFIED"].includes(this.sourceVerification) &&
        this.repositoryPhase === "NOT_INITIATED") ||
        (this.state === "STOPPING" &&
          this.sourceVerification === "VERIFIED" &&
          ["NOT_INITIATED", "RECOVERED_EMPTY"].includes(this.repositoryPhase)))
    );
  }
  public currentCheckpoint(): ReplayCheckpoint | undefined {
    return this.checkpoint;
  }
  private finishInitializationFailure(rejection: unknown): ReplayCommandResult {
    // Complete lifecycle classification before optional diagnostic callbacks.
    if (this.sourceVerification === "IN_FLIGHT") this.sourceVerification = "FAILED";
    this.state = this.obligation ? "RECOVERY_REQUIRED" : "FAILED";
    this.lastFailureCode = rejectionFailureCode(rejection, "UNCLASSIFIED_INITIALIZATION_FAILURE");
    return this.fail("INITIALIZATION_FAILED");
  }
  /** Runtime containment for an exceptional initialization exit. Active owner work
   * cannot be certified settled or discarded by an outer exception handler. */
  public containInitializationException(rejection: unknown): ReplayCommandResult {
    if (this.busy) return this.fail("INITIALIZATION_FAILED");
    return this.finishInitializationFailure(rejection);
  }
  private finishBoundaryFailure(
    rejection: unknown,
    code: "REPLAY_BOUNDARY_FAILED" | "SNAPSHOT_REJECTED" | "SOURCE_VERIFICATION_FAILED",
  ): ReplayCommandResult {
    // Unlike provisional admission, this owner retains its acknowledged session.
    // Classify from authoritative state/obligations before optional callbacks.
    const failedState =
      this.obligation || this.state === "RECOVERY_REQUIRED" ? "RECOVERY_REQUIRED" : "FAILED";
    this.state = failedState;
    this.lastFailureCode = rejectionFailureCode(rejection, "UNCLASSIFIED_BOUNDARY_FAILURE");
    // A getter may request stop while busy; STOPPING cannot replace this failure.
    this.state = this.obligation ? "RECOVERY_REQUIRED" : failedState;
    return this.fail(code);
  }
  private fail(code: string, state: ReplayState = this.state): ReplayCommandResult {
    return { ok: false, code, state };
  }
  private publish(c: ReplayCheckpoint): ReplayCommandResult {
    if (this.stopRequested) return this.fail("STOP_REQUESTED", "STOPPING");
    const operationId = replayOperationId(c);
    this.obligation = freeze({ operationId, commitment: "UNKNOWN_COMMITMENT" });
    try {
      this.repositoryPhase = "WRITE_INITIATED";
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
    this.sourceVerification = "IN_FLIGHT";
    try {
      await this.inputs.verify();
      this.sourceVerification = "VERIFIED";
      if (this.stopRequested) return this.fail("STOP_REQUESTED", "STOPPING");
      this.obligation = freeze({
        operationId: hash(this.specification.sessionId),
        commitment: "UNKNOWN_COMMITMENT",
      });
      this.repositoryPhase = "RECOVERY_IN_FLIGHT";
      const recovered = this.repository.recover(this.specification);
      if (!recovered.ok) return this.storageFailure(recovered);
      this.obligation = undefined;
      this.repositoryPhase = recovered.value ? "RECOVERED_CONTENT" : "RECOVERED_EMPTY";
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
    } catch (error) {
      return this.finishInitializationFailure(error);
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
    mode: "EVENT" | "TIMESTAMP" | "BOUNDED",
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
        if (
          mode === "EVENT" ||
          (mode === "BOUNDED" &&
            cursor - old.cursor >= this.specification.resourceLimits.maxEventsPerBatch)
        )
          break;
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
        !this.diagnostics().pendingConsumerReads &&
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
    } catch (error) {
      return this.finishBoundaryFailure(error, "REPLAY_BOUNDARY_FAILED");
    } finally {
      this.busy = false;
    }
  }
  public async runToTime(raw: UtcTimestamp): Promise<ReplayCommandResult> {
    return this.runUntil(raw, "TIMESTAMP");
  }
  /** Reconstruct through the same atomic event boundaries without requiring an entire
   * equal-time cohort to fit a timestamp batch. Tasks/snapshots still wait for its end. */
  public async reconstructToTime(raw: UtcTimestamp): Promise<ReplayCommandResult> {
    return this.runUntil(raw, "BOUNDED");
  }
  private async runUntil(
    raw: UtcTimestamp,
    mode: "BOUNDED" | "TIMESTAMP",
  ): Promise<ReplayCommandResult> {
    const at = instant(raw);
    if (this.busy) return this.fail("REENTRANT_OPERATION");
    if (!this.checkpoint || at < this.checkpoint.logicalTime || at > this.specification.endTime)
      return this.fail("REPLAY_TIME_RANGE");
    // Even an already reached target cannot acknowledge a failed owner or
    // unresolved operation as successful. Stable completed/stopped reuse stays.
    if (this.obligation || ["FAILED", "RECOVERY_REQUIRED", "STOPPING"].includes(this.state))
      return this.fail("INVALID_LIFECYCLE");
    if (this.state === "PAUSED") return this.fail("SESSION_PAUSED");
    let result: ReplayCommandResult = { ok: true, checkpoint: this.checkpoint };
    while (this.checkpoint.logicalTime < at || !this.checkpoint.timestampComplete) {
      const before = this.checkpoint;
      result = await this.runBoundary(mode, at);
      if (
        !result.ok ||
        this.state === "COMPLETED" ||
        this.pauseRequested ||
        this.diagnostics().state === "PAUSED"
      )
        return result;
      if (
        this.checkpoint.logicalTime === before.logicalTime &&
        this.checkpoint.cursor === before.cursor &&
        this.checkpoint.executedTaskIds.length === before.executedTaskIds.length &&
        !this.checkpoint.timestampComplete
      )
        return this.fail("RECONSTRUCTION_NO_PROGRESS");
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
    if (this.diagnostics().pendingConsumerReads) return this.fail("CHANNEL_RECOVERY_OBLIGATION");
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
      try {
        await this.inputs.verify();
      } catch (error) {
        return this.finishBoundaryFailure(error, "SNAPSHOT_REJECTED");
      }
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
  /** Consume the real P17 transport as an integrity side-channel for immutable recorded inputs.
   * Source replay/cursor authority stays with the manifest. No channel read fabricates a source event.
   * A durable read fence precedes the await, so interruption cannot erase unknown loss scope.
   */
  public async observeConsumerChannel(
    consumer: ConsumerChannel,
    artifactId: string,
    limit = 1,
  ): Promise<ReplayCommandResult> {
    if (
      this.busy ||
      !this.checkpoint ||
      this.obligation ||
      !["READY", "RUNNING", "PAUSED"].includes(this.state)
    )
      return this.fail("INVALID_LIFECYCLE");
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > this.specification.resourceLimits.maxEventsPerBatch
    )
      return this.fail("CONSUMER_LIMIT");
    this.busy = true;
    const contextFingerprint = hash({ inputs: this.inputs.fingerprint, artifactId });
    const readId = hash({
      contextFingerprint,
      consumerId: consumer.consumerId,
      generation: this.checkpoint.generation,
    });
    try {
      await this.inputs.verify();
      const guarded = new ReplayAggregationPipeline(this.specification, this.checkpoint);
      for (const stream of this.specification.streams) {
        const fenced = guarded.engine.fence(hash(stream), "ASYNC_CHANNEL_READ_PENDING");
        if (!fenced.ok) throw Error(fenced.error.code);
      }
      const guard = guarded.engine.exportReplayCheckpoint();
      if (!guard.ok) throw Error(guard.error.code);
      if (
        this.checkpoint.evidence.length + 2 >
        this.specification.resourceLimits.maxEvidenceRecords
      )
        throw Error("EVIDENCE_CAPACITY");
      const persisted = this.publish(
        createReplayCheckpoint({
          ...this.checkpoint,
          generation: this.checkpoint.generation + 1,
          aggregation: guard.value,
          evidence: [
            ...this.checkpoint.evidence,
            { kind: "CHANNEL_READ_PENDING", identity: readId, at: this.checkpoint.logicalTime },
          ],
        }),
      );
      if (!persisted.ok) {
        // No channel read occurred. Admission itself is unacknowledged, and known loss
        // must not disappear merely because its guard could not be written.
        if (!this.obligation)
          this.obligation = freeze({
            operationId: readId,
            commitment: "CHANNEL_ADMISSION_UNACKNOWLEDGED",
          });
        this.state = "RECOVERY_REQUIRED";
        return persisted;
      }
      const pipeline = new ReplayAggregationPipeline(this.specification, this.checkpoint);
      const observe = () => {
        const discarded = consumer.queue.enqueued - consumer.queue.dequeued - consumer.queue.depth;
        const result = pipeline.engine.observeConsumerLoss({
          consumerId: consumer.consumerId,
          contextFingerprint,
          rejected: consumer.queue.rejected,
          discarded,
          degraded: consumer.degraded,
          closed: consumer.closed,
          newChannel: !this.observedChannels.has(consumer),
        });
        if (!result.ok) throw Error(result.error.code);
      };
      const eligible = new Set(
        this.sequencer.events
          .filter((e) => e.eligibilityAt <= this.checkpoint!.logicalTime)
          .map((e) => hash(e.record.input.observation)),
      );
      for (let i = 0; i < limit; i++) {
        observe();
        const accepted = await consumer.read();
        observe();
        if (this.stopRequested) break;
        if (!accepted) break;
        if (!eligible.has(hash(accepted.observation)))
          throw Error("UNRECORDED_OR_FUTURE_CHANNEL_OBSERVATION");
      }
      const aggregate = pipeline.engine.exportReplayCheckpoint();
      if (!aggregate.ok) throw Error(aggregate.error.code);
      if (this.stopRequested) {
        this.state = "RECOVERY_REQUIRED";
        this.obligation = freeze({ operationId: readId, commitment: "UNRESOLVED_CHANNEL_READ" });
        return this.fail("CHANNEL_READ_INTERRUPTED");
      }
      const result = this.publish(
        createReplayCheckpoint({
          ...this.checkpoint,
          generation: this.checkpoint.generation + 1,
          aggregation: aggregate.value,
          evidence: [
            ...this.checkpoint.evidence,
            { kind: "CHANNEL_READ_COMPLETED", identity: readId, at: this.checkpoint.logicalTime },
          ],
        }),
      );
      if (result.ok) this.observedChannels.add(consumer);
      return result;
    } catch {
      if (this.state !== "RECOVERY_REQUIRED") this.state = "FAILED";
      return this.fail("CONSUMER_INTEGRITY_FAILED");
    } finally {
      this.busy = false;
    }
  }
  public async reconcileConsumerRead(identity: string): Promise<ReplayCommandResult> {
    if (
      this.busy ||
      !this.checkpoint ||
      this.obligation ||
      !["READY", "RUNNING", "PAUSED"].includes(this.state)
    )
      return this.fail("INVALID_LIFECYCLE");
    const pending = this.checkpoint.evidence.find(
      (e) => e.identity === identity && e.kind === "CHANNEL_READ_PENDING",
    );
    if (
      !pending ||
      this.checkpoint.evidence.some(
        (e) =>
          e.identity === identity &&
          ["CHANNEL_READ_COMPLETED", "CHANNEL_READ_RECONCILED"].includes(e.kind),
      )
    )
      return this.fail("UNKNOWN_OR_COMPLETED_CHANNEL_READ");
    for (const m of Object.values(this.checkpoint.aggregation.watermarks)) {
      const proof = this.specification.tasks.find(
        (t) =>
          this.checkpoint!.executedTaskIds.includes(t.taskId) &&
          t.action.kind === "WATERMARK" &&
          t.action.evidence.evidenceId === m.evidenceId &&
          t.action.evidence.reconciled,
      );
      if (m.status !== "CONTINUOUS" || !m.observedAt || m.observedAt < pending.at || !proof)
        return this.fail("SOURCE_RECONCILIATION_REQUIRED");
    }
    if (this.checkpoint.evidence.length >= this.specification.resourceLimits.maxEvidenceRecords)
      return this.fail("EVIDENCE_CAPACITY");
    this.busy = true;
    try {
      try {
        await this.inputs.verify();
      } catch (error) {
        return this.finishBoundaryFailure(error, "SOURCE_VERIFICATION_FAILED");
      }
      return this.publish(
        createReplayCheckpoint({
          ...this.checkpoint,
          generation: this.checkpoint.generation + 1,
          evidence: [
            ...this.checkpoint.evidence,
            { kind: "CHANNEL_READ_RECONCILED", identity, at: this.checkpoint.logicalTime },
          ],
        }),
      );
    } finally {
      this.busy = false;
    }
  }
  /** @deprecated Authoritative branch registration belongs to FilesystemReplayBranchRegistry.
   * Retain the call shape but reject ungoverned parent metadata mutation. */
  public recordBranch(_evidence: ReplayBranchEvidence): Promise<ReplayCommandResult> {
    return Promise.resolve(this.fail("BRANCH_REGISTRY_REQUIRED"));
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
