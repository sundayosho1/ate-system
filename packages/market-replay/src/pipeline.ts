import { VirtualClock, DeterministicScheduler } from "@ate/time";
import {
  AggregationEngine,
  MemoryAggregationRepository,
  TimeframeRegistry,
  hash,
  freeze,
} from "@ate/multitimeframe";
import type { UtcTimestamp } from "@ate/domain";
import type {
  ReplaySessionSpecification,
  ReplayCheckpoint,
  ReplayEventEnvelope,
  ReplaySnapshot,
  ReplayTaskDescriptor,
} from "./types.js";
import { taskOrder, taskPhase } from "./specification.js";
const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: { code: string } }): T => {
  if (!r.ok) throw Error(r.error.code);
  return r.value;
};
// This staging engine has no externally visible repository. Its full owner checkpoint
// is published only as part of the replay cursor/checkpoint transaction.
export class ReplayAggregationPipeline {
  public readonly clock: VirtualClock;
  public readonly engine: AggregationEngine;
  public constructor(
    private readonly spec: ReplaySessionSpecification,
    checkpoint?: ReplayCheckpoint,
  ) {
    this.clock = new VirtualClock(
      checkpoint?.logicalTime ?? spec.startTime,
      "REPLAY",
      "replay-session-clock",
    );
    this.engine = new AggregationEngine({
      clock: this.clock,
      repository: new MemoryAggregationRepository(this.clock, spec.resourceLimits.maxCheckpoints),
      registry: new TimeframeRegistry(spec.aggregation.timeframes),
      calendar: spec.aggregation.calendar,
      configurationFingerprint: spec.configurationFingerprint,
      directTimeframes: spec.aggregation.directTimeframes,
      ...(spec.aggregation.options ? { options: spec.aggregation.options } : {}),
      ...(spec.aggregation.edges ? { edges: spec.aggregation.edges } : {}),
    });
    if (checkpoint)
      unwrap(this.engine.startFromReplayCheckpoint(checkpoint.aggregation, checkpoint.logicalTime));
    else {
      unwrap(this.engine.start());
      for (const stream of spec.streams) unwrap(this.engine.registerStream(stream));
    }
  }
  public advance(at: UtcTimestamp): void {
    unwrap(this.clock.advanceTo(at));
  }
  public ingest(e: ReplayEventEnvelope): void {
    if (e.eligibilityAt > this.clock.now()) throw Error("EVENT_NOT_ELIGIBLE");
    const stream = this.spec.streams.find(
      (s) =>
        s.sourceId === e.sourceId && s.instrumentId === e.instrumentId && s.channel === e.channel,
    )!;
    const manifestGap = e.record.input.continuity !== "CONTINUOUS";
    if (manifestGap) unwrap(this.engine.fence(hash(stream), "RECORDED_SOURCE_GAP"));
    unwrap(this.engine.ingestReplay(hash(stream), e.record.input, this.spec.replayMode));
  }
  public snapshot(
    streamId: string,
    timeframes: readonly string[],
    cursor: number,
    includeIncomplete: boolean,
    pending: readonly ReplayTaskDescriptor[],
  ): ReplaySnapshot {
    const aggregation = unwrap(
      this.engine.snapshot({
        streamId,
        timeframes,
        asOf: this.clock.now(),
        cutoff: this.clock.now(),
        evidenceClass: this.spec.replayMode,
        includeIncomplete,
        includeProvisional: false,
      }),
    );
    const body = {
      sessionId: this.spec.sessionId,
      specificationFingerprint: this.spec.fingerprint,
      logicalTime: this.clock.now(),
      inputCursor: cursor,
      sourceManifestFingerprints: this.spec.datasetFingerprints,
      mode: this.spec.replayMode,
      publicationClass: "REPLAY_DERIVED" as const,
      registryContext: "CURRENT_GOVERNED_CONTEXT" as const,
      configurationFingerprint: this.spec.configurationFingerprint,
      calendarFingerprint: this.spec.calendarFingerprint,
      clockSchedulerFingerprint: hash({ clock: this.clock.now(), pending }),
      aggregation,
      continuityFingerprint: hash(unwrap(this.engine.exportReplayCheckpoint()).watermarks),
    };
    const semanticFingerprint = hash(body);
    return freeze({ ...body, snapshotId: semanticFingerprint, semanticFingerprint });
  }
  public async execute(
    tasks: readonly ReplayTaskDescriptor[],
    cursor: number,
  ): Promise<readonly ReplaySnapshot[]> {
    const snapshots: ReplaySnapshot[] = [];
    const scheduler = new DeterministicScheduler(this.clock, undefined, {
      maxScheduledTasks: this.spec.resourceLimits.maxPendingTasks,
    });
    const scheduled: { taskId: string; id: Parameters<DeterministicScheduler["cancel"]>[0] }[] = [];
    const entered = new Set<string>();
    try {
      for (const task of [...tasks].sort(taskOrder)) {
        scheduled.push({
          taskId: task.taskId,
          id: unwrap(
            scheduler.scheduleAt(
              task.dueAt,
              () => {
                entered.add(task.taskId);
                const a = task.action;
                switch (a.kind) {
                  case "FORK_FENCE":
                  case "FENCE":
                    unwrap(this.engine.fence(a.streamId, a.reason));
                    break;
                  case "FORK_LOSS":
                  case "LOSS": {
                    const { kind: _kind, ...loss } = a;
                    unwrap(this.engine.observeConsumerLoss({ ...loss, newChannel: true }));
                    break;
                  }
                  case "WATERMARK":
                    unwrap(this.engine.watermark(a.streamId, a.evidence));
                    break;
                  case "PUBLISH":
                    unwrap(this.engine.publishWindow(a.streamId, a.timeframe, a.eventAt, a.final));
                    break;
                  case "SNAPSHOT":
                    snapshots.push(
                      this.snapshot(a.streamId, a.timeframes, cursor, a.includeIncomplete, []),
                    );
                    break;
                }
              },
              4 - taskPhase(task),
            ),
          ),
        });
      }
      unwrap(await scheduler.runDueTasks());
      return freeze(snapshots);
    } catch (error) {
      // Some tasks may already have run inside the private staging engine. No output
      // transaction is published on failure. Cancellation failure is explicit.
      const failed = scheduled
        .filter((task) => !entered.has(task.taskId))
        .map((task) => scheduler.cancel(task.id))
        .some((ok) => !ok);
      if (failed) throw Error("SCHEDULER_CANCELLATION_FAILED", { cause: error });
      throw error;
    } finally {
      scheduler.stop();
    }
  }
}
