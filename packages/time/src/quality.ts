import type { UtcTimestamp } from "@ate/domain";

import { durationMs } from "./clock.js";
import { temporalError } from "./errors.js";
import type {
  ClockQualityState,
  DurationMilliseconds,
  MonotonicMilliseconds,
  TemporalError,
} from "./types.js";

export type ClockQualitySample = Readonly<{
  wallClock: UtcTimestamp;
  monotonic: MonotonicMilliseconds;
}>;

export class ClockQualityMonitor {
  private previous: ClockQualitySample | undefined;
  private quality: ClockQualityState = "UNKNOWN";
  private lastJump: TemporalError | undefined;

  public constructor(
    private readonly warningThresholdMs: DurationMilliseconds,
    private readonly criticalThresholdMs: DurationMilliseconds,
  ) {}

  public observe(sample: ClockQualitySample): ClockQualityState {
    if (this.previous === undefined) {
      this.previous = sample;
      this.quality = "ACCEPTABLE";
      return this.quality;
    }
    const wallDelta = Date.parse(sample.wallClock) - Date.parse(this.previous.wallClock);
    const monotonicDelta = sample.monotonic - this.previous.monotonic;
    const discrepancy = Math.abs(wallDelta - monotonicDelta);
    if (wallDelta < 0) {
      this.lastJump = temporalError({
        code: "CLOCK_MOVED_BACKWARD",
        message: "wall clock moved backward relative to prior sample",
        timestamp: sample.wallClock,
        severity: "CRITICAL",
      });
      this.quality = "UNTRUSTED";
    } else if (discrepancy >= this.criticalThresholdMs) {
      this.lastJump = temporalError({
        code: "CLOCK_JUMP_DETECTED",
        message: "critical wall-clock jump detected",
        timestamp: sample.wallClock,
        severity: "CRITICAL",
        details: { discrepancyMs: durationMs(discrepancy) },
      });
      this.quality = "UNTRUSTED";
    } else if (discrepancy >= this.warningThresholdMs) {
      this.lastJump = temporalError({
        code: "CLOCK_JUMP_DETECTED",
        message: "wall-clock jump detected",
        timestamp: sample.wallClock,
        severity: "WARNING",
        details: { discrepancyMs: durationMs(discrepancy) },
      });
      this.quality = "DEGRADED";
    } else {
      this.quality = "SYNCHRONIZED";
    }
    this.previous = sample;
    return this.quality;
  }

  public currentQuality(): ClockQualityState {
    return this.quality;
  }

  public lastClockJump(): TemporalError | undefined {
    return this.lastJump;
  }
}
