import { performance } from "node:perf_hooks";

import { parseUtcTimestamp, type UtcTimestamp } from "@ate/domain";

import { temporalError } from "./errors.js";
import type {
  Clock,
  ClockMode,
  ClockProvenance,
  DurationMilliseconds,
  MonotonicClock,
  MonotonicMilliseconds,
  TemporalResult,
} from "./types.js";

export const durationMs = (value: number): DurationMilliseconds => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`invalid duration milliseconds: ${value}`);
  }
  return value as DurationMilliseconds;
};

export const parseCanonicalUtc = (value: unknown): TemporalResult<UtcTimestamp> => {
  if (typeof value === "string" && Number.isNaN(Date.parse(value))) {
    return {
      ok: false,
      error: temporalError({
        code: "INVALID_TIMESTAMP",
        message: "timestamp is not a valid UTC-normalizable instant",
      }),
    };
  }
  if (typeof value === "string" && !/[zZ]|[+-]\d{2}:\d{2}$/u.test(value)) {
    return {
      ok: false,
      error: temporalError({
        code: "NAIVE_TIMESTAMP",
        message: "timestamp lacks timezone or offset",
      }),
    };
  }
  const parsed = parseUtcTimestamp(value);
  if (!parsed.ok) {
    return {
      ok: false,
      error: temporalError({
        code: "INVALID_TIMESTAMP",
        message: "timestamp is not a valid UTC-normalizable instant",
      }),
    };
  }
  return { ok: true, value: parsed.value };
};

export const compareInstants = (left: UtcTimestamp, right: UtcTimestamp): number =>
  Date.parse(left) - Date.parse(right);

export const addDuration = (instant: UtcTimestamp, duration: DurationMilliseconds): UtcTimestamp =>
  mustParseUtc(new Date(Date.parse(instant) + duration).toISOString());

export const durationBetween = (start: UtcTimestamp, end: UtcTimestamp): DurationMilliseconds =>
  durationMs(Math.max(0, Date.parse(end) - Date.parse(start)));

export const createSystemUtcClock = (): Clock => ({
  mode: "SYSTEM",
  provenance: {
    source: "SYSTEM_UTC",
    clockId: "system-utc",
    quality: "UNKNOWN",
  },
  now: () => mustParseUtc(new Date().toISOString()),
});

export const createPerformanceMonotonicClock = (): MonotonicClock => ({
  now: () => performance.now() as MonotonicMilliseconds,
});

export class VirtualClock implements Clock {
  public readonly mode: ClockMode;
  public readonly provenance: ClockProvenance;

  public constructor(
    initialInstant: UtcTimestamp,
    mode: Extract<ClockMode, "VIRTUAL" | "SIMULATION" | "REPLAY"> = "VIRTUAL",
    clockId = "virtual-clock",
  ) {
    this.current = initialInstant;
    this.mode = mode;
    this.provenance = {
      source: mode === "REPLAY" ? "REPLAY" : mode === "SIMULATION" ? "SIMULATION" : "TEST",
      clockId,
      quality: "SYNCHRONIZED",
    };
  }

  protected current: UtcTimestamp;
  private paused = false;

  public now(): UtcTimestamp {
    return this.current;
  }

  public pause(): void {
    this.paused = true;
  }

  public resume(): void {
    this.paused = false;
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public advanceBy(duration: DurationMilliseconds): TemporalResult<UtcTimestamp> {
    return this.advanceTo(addDuration(this.current, duration));
  }

  public advanceTo(instant: UtcTimestamp): TemporalResult<UtcTimestamp> {
    if (compareInstants(instant, this.current) < 0) {
      return {
        ok: false,
        error: temporalError({
          code: this.mode === "REPLAY" ? "REPLAY_TIME_REGRESSION" : "INVALID_CLOCK_ADVANCE",
          message: "clock cannot move backward",
          timestamp: this.current,
          source: this.provenance.source,
        }),
      };
    }
    this.current = instant;
    return { ok: true, value: this.current };
  }

  protected resetTo(instant: UtcTimestamp): void {
    this.current = instant;
  }
}

export class ReplayClock extends VirtualClock {
  private cursor = 0;

  public constructor(private readonly sequence: readonly UtcTimestamp[]) {
    if (sequence.length === 0) {
      throw new Error("replay clock requires at least one timestamp");
    }
    super(sequence[0]!, "REPLAY", "replay-clock");
  }

  public step(): TemporalResult<UtcTimestamp> {
    if (this.cursor >= this.sequence.length - 1) {
      return { ok: true, value: this.now() };
    }
    this.cursor += 1;
    return this.advanceTo(this.sequence[this.cursor]!);
  }

  public reset(): void {
    this.cursor = 0;
    this.resetTo(this.sequence[0]!);
  }
}

export const createSimulationClock = (initialInstant: UtcTimestamp): VirtualClock =>
  new VirtualClock(initialInstant, "SIMULATION", "simulation-clock");

export const mustParseUtc = (value: string): UtcTimestamp => {
  const parsed = parseCanonicalUtc(value);
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return parsed.value;
};
