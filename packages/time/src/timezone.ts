import type { UtcTimestamp } from "@ate/domain";

import { addDuration, durationMs, mustParseUtc } from "./clock.js";
import { temporalError } from "./errors.js";
import type {
  FixedOffsetMinutes,
  LocalDateTime,
  TemporalResult,
  TimeZoneId,
  ZonedDateTime,
} from "./types.js";

export const timeZoneId = (value: string): TemporalResult<TimeZoneId> => {
  if (/^[A-Z]{2,4}$/u.test(value)) {
    return {
      ok: false,
      error: temporalError({
        code: "INVALID_TIMEZONE",
        message: "timezone abbreviations are not canonical IANA identifiers",
      }),
    };
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(
      new Date("2026-01-01T00:00:00.000Z"),
    );
    return { ok: true, value: value as TimeZoneId };
  } catch {
    return {
      ok: false,
      error: temporalError({
        code: "INVALID_TIMEZONE",
        message: `invalid IANA timezone: ${value}`,
      }),
    };
  }
};

export const fixedOffsetMinutes = (value: number): FixedOffsetMinutes => {
  if (!Number.isInteger(value) || value < -14 * 60 || value > 14 * 60) {
    throw new Error(`invalid fixed offset minutes: ${value}`);
  }
  return value as FixedOffsetMinutes;
};

export const utcToZoned = (instant: UtcTimestamp, timezone: TimeZoneId): ZonedDateTime => {
  const local = formatInstantParts(instant, timezone);
  return {
    instant,
    timezone,
    local,
    offsetMinutes: calculateOffsetMinutes(instant, local),
  };
};

export const resolveLocalDateTime = (
  local: LocalDateTime,
  timezone: TimeZoneId,
): TemporalResult<readonly UtcTimestamp[]> => {
  const candidates: UtcTimestamp[] = [];
  const center = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
    local.millisecond,
  );
  for (let minutes = -36 * 60; minutes <= 36 * 60; minutes += 1) {
    const candidate = mustParseUtc(new Date(center + minutes * 60_000).toISOString());
    const parts = formatInstantParts(candidate, timezone);
    if (sameLocal(parts, local)) {
      candidates.push(candidate);
    }
  }
  if (candidates.length === 0) {
    return {
      ok: false,
      error: temporalError({
        code: "NONEXISTENT_LOCAL_TIME",
        message: "local time does not exist in timezone",
        details: { timezone, local },
      }),
    };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      error: temporalError({
        code: "AMBIGUOUS_LOCAL_TIME",
        message: "local time is ambiguous in timezone",
        details: { timezone, local, candidates },
      }),
    };
  }
  return { ok: true, value: candidates };
};

export const convertFixedOffsetToUtc = (
  local: LocalDateTime,
  offset: FixedOffsetMinutes,
): UtcTimestamp =>
  mustParseUtc(
    new Date(
      Date.UTC(
        local.year,
        local.month - 1,
        local.day,
        local.hour,
        local.minute,
        local.second,
        local.millisecond,
      ) -
        offset * 60_000,
    ).toISOString(),
  );

export const tradingDate = (instant: UtcTimestamp, timezone: TimeZoneId): string => {
  const local = utcToZoned(instant, timezone).local;
  return `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
};

export const addExactDuration = addDuration;
export const milliseconds = durationMs;

const formatInstantParts = (instant: UtcTimestamp, timezone: TimeZoneId): LocalDateTime => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    millisecond: Number(parts.fractionalSecond ?? 0),
  };
};

const sameLocal = (left: LocalDateTime, right: LocalDateTime): boolean =>
  left.year === right.year &&
  left.month === right.month &&
  left.day === right.day &&
  left.hour === right.hour &&
  left.minute === right.minute &&
  left.second === right.second &&
  left.millisecond === right.millisecond;

const calculateOffsetMinutes = (
  instant: UtcTimestamp,
  local: LocalDateTime,
): FixedOffsetMinutes => {
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
    local.millisecond,
  );
  return fixedOffsetMinutes(Math.round((asUtc - Date.parse(instant)) / 60_000));
};
