import type { RuntimeMode, UtcTimestamp } from "@ate/domain";

export type DurationMilliseconds = number & { readonly __brand: "DurationMilliseconds" };
export type MonotonicMilliseconds = number & { readonly __brand: "MonotonicMilliseconds" };
export type TimeZoneId = string & { readonly __brand: "TimeZoneId" };
export type FixedOffsetMinutes = number & { readonly __brand: "FixedOffsetMinutes" };
export type ScheduledTaskId = string & { readonly __brand: "ScheduledTaskId" };

export const clockModes = ["SYSTEM", "VIRTUAL", "SIMULATION", "REPLAY"] as const;
export type ClockMode = (typeof clockModes)[number];

export const temporalSources = [
  "SYSTEM_UTC",
  "MONOTONIC",
  "EXTERNAL_SOURCE",
  "BROKER",
  "MARKET_DATA_PROVIDER",
  "MARKET",
  "SIMULATION",
  "REPLAY",
  "TEST",
  "DERIVED",
] as const;
export type TemporalSource = (typeof temporalSources)[number];

export const clockQualityStates = [
  "SYNCHRONIZED",
  "ACCEPTABLE",
  "DEGRADED",
  "UNTRUSTED",
  "UNKNOWN",
] as const;
export type ClockQualityState = (typeof clockQualityStates)[number];

export const temporalErrorCodes = [
  "INVALID_TIMESTAMP",
  "NAIVE_TIMESTAMP",
  "INVALID_TIMEZONE",
  "AMBIGUOUS_LOCAL_TIME",
  "NONEXISTENT_LOCAL_TIME",
  "CLOCK_NOT_READY",
  "CLOCK_MODE_INCOMPATIBLE",
  "CLOCK_MOVED_BACKWARD",
  "CLOCK_JUMP_DETECTED",
  "CLOCK_UNTRUSTED",
  "FUTURE_TIMESTAMP",
  "STALE_TIMESTAMP",
  "INVALID_DURATION",
  "INVALID_CLOCK_ADVANCE",
  "REPLAY_TIME_REGRESSION",
  "TIMER_LIMIT_EXCEEDED",
  "SCHEDULER_STOPPED",
  "TEMPORAL_ORDER_CONFLICT",
] as const;
export type TemporalErrorCode = (typeof temporalErrorCodes)[number];

export type TemporalError = Readonly<{
  code: TemporalErrorCode;
  message: string;
  severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  timestamp?: UtcTimestamp;
  source?: TemporalSource;
  details?: Record<string, unknown>;
}>;

export type TemporalResult<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: TemporalError }>;

export type ClockProvenance = Readonly<{
  source: TemporalSource;
  clockId: string;
  quality: ClockQualityState;
}>;

export type TemporalInstant = Readonly<{
  timestamp: UtcTimestamp;
  provenance: ClockProvenance;
}>;

export type Clock = Readonly<{
  mode: ClockMode;
  provenance: ClockProvenance;
  now: () => UtcTimestamp;
}>;

export type MonotonicClock = Readonly<{
  now: () => MonotonicMilliseconds;
}>;

export type TemporalContext = Readonly<{
  now: UtcTimestamp;
  runtimeMode: RuntimeMode;
  clockMode: ClockMode;
  provenance: ClockProvenance;
  timezone?: TimeZoneId;
  brokerTime?: BrokerTimeProfile;
  marketTime?: MarketTimeProfile;
}>;

export type BrokerTimeProfile = Readonly<{
  brokerId: string;
  timezone?: TimeZoneId;
  currentOffsetMinutes?: FixedOffsetMinutes;
  offsetSource: "BROKER_CONTRACT" | "OBSERVED" | "UNKNOWN";
  observedServerTime?: string;
  observedUtcTime?: UtcTimestamp;
  skewMs?: DurationMilliseconds;
  confidence: ClockQualityState;
  lastVerifiedAt?: UtcTimestamp;
}>;

export type MarketTimeProfile = Readonly<{
  marketId: string;
  timezone: TimeZoneId;
  tradingDate?: string;
  localDateTime?: string;
  utcInstant?: UtcTimestamp;
}>;

export type LocalDateTime = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}>;

export type ZonedDateTime = Readonly<{
  instant: UtcTimestamp;
  timezone: TimeZoneId;
  local: LocalDateTime;
  offsetMinutes: FixedOffsetMinutes;
}>;

export type FreshnessStatus = "FRESH" | "AGING" | "STALE" | "EXPIRED" | "FUTURE";

export type FreshnessThresholds = Readonly<{
  agingAfterMs: DurationMilliseconds;
  staleAfterMs: DurationMilliseconds;
  expiredAfterMs: DurationMilliseconds;
  futureSkewToleranceMs: DurationMilliseconds;
}>;

export type FreshnessResult = Readonly<{
  status: FreshnessStatus;
  ageMs: DurationMilliseconds;
  observedAt: UtcTimestamp;
  now: UtcTimestamp;
  error?: TemporalError;
}>;

export type ReplayMode = "STEP" | "AS_FAST_AS_POSSIBLE" | "ACCELERATED" | "REAL_TIME_EQUIVALENT";

export type ScheduledTask = Readonly<{
  taskId: ScheduledTaskId;
  dueAt: UtcTimestamp;
  priority: number;
  sequence: number;
  cancelled: boolean;
}>;

export type SchedulerSnapshot = Readonly<{
  stopped: boolean;
  scheduledTaskCount: number;
  executedTaskCount: number;
  cancelledTaskCount: number;
}>;

export type ClockDiagnostics = Readonly<{
  currentUtc: UtcTimestamp;
  clockMode: ClockMode;
  runtimeMode: RuntimeMode;
  source: TemporalSource;
  quality: ClockQualityState;
  monotonicAvailable: boolean;
  timezoneCapability: boolean;
  scheduledTaskCount: number;
  lastClockJump?: TemporalError;
  recentErrors: readonly TemporalError[];
}>;

export type ClockRuntimeOptions = Readonly<{
  runtimeMode: RuntimeMode;
  clockMode: ClockMode;
  maximumFutureSkewMs: DurationMilliseconds;
  clockJumpWarningThresholdMs: DurationMilliseconds;
  clockJumpCriticalThresholdMs: DurationMilliseconds;
  schedulerMaxTasks: number;
}>;
