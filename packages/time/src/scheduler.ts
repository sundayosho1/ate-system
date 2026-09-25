import type { UtcTimestamp } from "@ate/domain";

import { addDuration, compareInstants } from "./clock.js";
import { temporalError } from "./errors.js";
import type {
  Clock,
  DurationMilliseconds,
  ScheduledTask,
  ScheduledTaskId,
  SchedulerSnapshot,
  TemporalResult,
} from "./types.js";

export type ScheduledTaskContext = Readonly<{
  taskId: ScheduledTaskId;
  scheduledAt: UtcTimestamp;
  dueAt: UtcTimestamp;
  clock: Clock;
}>;

export type ScheduledTaskHandler = (context: ScheduledTaskContext) => Promise<void> | void;

export type SchedulerOptions = Readonly<{
  maxScheduledTasks: number;
}>;

type InternalScheduledTask = ScheduledTask &
  Readonly<{
    scheduledAt: UtcTimestamp;
    handler: ScheduledTaskHandler;
  }>;

const defaultSchedulerOptions: SchedulerOptions = {
  maxScheduledTasks: 1_000,
};

export class DeterministicScheduler {
  private readonly tasks = new Map<ScheduledTaskId, InternalScheduledTask>();
  private stopped = false;
  private sequence = 0;
  private executedTaskCount = 0;
  private cancelledTaskCount = 0;

  public constructor(
    private readonly clock: Clock,
    private readonly idGenerator: (sequence: number) => ScheduledTaskId = defaultTaskId,
    private readonly options: SchedulerOptions = defaultSchedulerOptions,
  ) {}

  public scheduleAfter(
    delay: DurationMilliseconds,
    handler: ScheduledTaskHandler,
    priority = 0,
  ): TemporalResult<ScheduledTaskId> {
    return this.scheduleAt(addDuration(this.clock.now(), delay), handler, priority);
  }

  public scheduleAt(
    dueAt: UtcTimestamp,
    handler: ScheduledTaskHandler,
    priority = 0,
  ): TemporalResult<ScheduledTaskId> {
    if (this.stopped) {
      return {
        ok: false,
        error: temporalError({
          code: "SCHEDULER_STOPPED",
          message: "scheduler is stopped",
          timestamp: this.clock.now(),
        }),
      };
    }
    if (this.pendingTaskCount() >= this.options.maxScheduledTasks) {
      return {
        ok: false,
        error: temporalError({
          code: "TIMER_LIMIT_EXCEEDED",
          message: "scheduler task capacity exhausted",
          timestamp: this.clock.now(),
          details: { maxScheduledTasks: this.options.maxScheduledTasks },
        }),
      };
    }
    if (compareInstants(dueAt, this.clock.now()) < 0) {
      return {
        ok: false,
        error: temporalError({
          code: "INVALID_CLOCK_ADVANCE",
          message: "scheduled task dueAt cannot be earlier than scheduler clock",
          timestamp: this.clock.now(),
          details: { dueAt },
        }),
      };
    }

    this.sequence += 1;
    const taskId = this.idGenerator(this.sequence);
    this.tasks.set(taskId, {
      taskId,
      dueAt,
      priority,
      sequence: this.sequence,
      cancelled: false,
      scheduledAt: this.clock.now(),
      handler,
    });
    return { ok: true, value: taskId };
  }

  public cancel(taskId: ScheduledTaskId): boolean {
    const task = this.tasks.get(taskId);
    if (task === undefined || task.cancelled) {
      return false;
    }
    this.tasks.set(taskId, { ...task, cancelled: true });
    this.cancelledTaskCount += 1;
    return true;
  }

  public async runDueTasks(): Promise<TemporalResult<readonly ScheduledTaskId[]>> {
    if (this.stopped) {
      return {
        ok: false,
        error: temporalError({
          code: "SCHEDULER_STOPPED",
          message: "scheduler is stopped",
          timestamp: this.clock.now(),
        }),
      };
    }

    const executed: ScheduledTaskId[] = [];
    const dueTasks = [...this.tasks.values()]
      .filter((task) => !task.cancelled && compareInstants(task.dueAt, this.clock.now()) <= 0)
      .sort(compareScheduledTasks);

    for (const task of dueTasks) {
      this.tasks.delete(task.taskId);
      await task.handler({
        taskId: task.taskId,
        scheduledAt: task.scheduledAt,
        dueAt: task.dueAt,
        clock: this.clock,
      });
      this.executedTaskCount += 1;
      executed.push(task.taskId);
    }

    this.pruneCancelledTasks();
    return { ok: true, value: executed };
  }

  public snapshot(): SchedulerSnapshot {
    return {
      stopped: this.stopped,
      scheduledTaskCount: this.pendingTaskCount(),
      executedTaskCount: this.executedTaskCount,
      cancelledTaskCount: this.cancelledTaskCount,
    };
  }

  public stop(): void {
    this.stopped = true;
    this.tasks.clear();
  }

  private pendingTaskCount(): number {
    return [...this.tasks.values()].filter((task) => !task.cancelled).length;
  }

  private pruneCancelledTasks(): void {
    for (const task of this.tasks.values()) {
      if (task.cancelled) {
        this.tasks.delete(task.taskId);
      }
    }
  }
}

const compareScheduledTasks = (
  left: InternalScheduledTask,
  right: InternalScheduledTask,
): number => {
  const dueOrder = compareInstants(left.dueAt, right.dueAt);
  if (dueOrder !== 0) {
    return dueOrder;
  }
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }
  return left.sequence - right.sequence;
};

const defaultTaskId = (sequence: number): ScheduledTaskId =>
  `scheduled-task-${sequence}` as ScheduledTaskId;
