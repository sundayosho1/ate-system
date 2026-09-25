import type { UtcTimestamp } from "@ate/domain";

import { durationBetween, durationMs } from "./clock.js";
import { temporalError } from "./errors.js";
import type { FreshnessResult, FreshnessThresholds } from "./types.js";

export const classifyFreshness = (
  observedAt: UtcTimestamp,
  now: UtcTimestamp,
  thresholds: FreshnessThresholds,
): FreshnessResult => {
  const observedMs = Date.parse(observedAt);
  const nowMs = Date.parse(now);
  if (observedMs - nowMs > thresholds.futureSkewToleranceMs) {
    return {
      status: "FUTURE",
      ageMs: durationMs(0),
      observedAt,
      now,
      error: temporalError({
        code: "FUTURE_TIMESTAMP",
        message: "observation timestamp is beyond permitted future skew",
        timestamp: now,
      }),
    };
  }
  const ageMs = durationBetween(observedAt, now);
  if (ageMs >= thresholds.expiredAfterMs) {
    return { status: "EXPIRED", ageMs, observedAt, now };
  }
  if (ageMs >= thresholds.staleAfterMs) {
    return { status: "STALE", ageMs, observedAt, now };
  }
  if (ageMs >= thresholds.agingAfterMs) {
    return { status: "AGING", ageMs, observedAt, now };
  }
  return { status: "FRESH", ageMs, observedAt, now };
};
