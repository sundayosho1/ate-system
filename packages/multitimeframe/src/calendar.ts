import { z } from "zod";
import { canonicalTimeframeSchema, type UtcTimestamp } from "@ate/domain";
import {
  timeZoneId,
  utcToZoned,
  resolveLocalDateTime,
  convertFixedOffsetToUtc,
  fixedOffsetMinutes,
  type LocalDateTime,
  type TimeZoneId,
} from "@ate/time";
import { freeze, hash, instant, utc } from "./primitives.js";
import type { Window } from "./types.js";
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((s) => {
    const date = new Date(`${s}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === s;
  });
const stamp = z.string().transform(instant);
export const calendarSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/u),
    version: z.string().min(1).max(64),
    kind: z.enum(["UTC_CONTINUOUS", "TIMEZONE_CALENDAR", "EXPLICIT_SESSION_SCHEDULE"]),
    timezone: z.string().max(64),
    fold: z.enum(["REJECT", "EARLIER", "LATER"]).default("REJECT"),
    weekStart: z.number().int().min(0).max(6).default(1),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([0, 1, 2, 3, 4, 5, 6]),
    holidays: z.array(dateSchema).max(366).default([]),
    sessions: z
      .array(
        z
          .object({
            id: z.string().max(64),
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
            open: stamp,
            close: stamp,
            breaks: z
              .array(z.object({ start: stamp, end: stamp }).strict())
              .max(16)
              .default([]),
          })
          .strict(),
      )
      .max(366)
      .default([]),
  })
  .strict();
export type CalendarPolicy = z.infer<typeof calendarSchema>;
export const utcCalendar: CalendarPolicy = calendarSchema.parse({
  id: "utc",
  version: "1",
  kind: "UTC_CONTINUOUS",
  timezone: "Etc/UTC",
});
export type Timeframe = Readonly<{
  code: string;
  kind: "FIXED" | "CALENDAR";
  durationMs?: number;
  period?: "DAY" | "WEEK" | "MONTH";
  anchor: UtcTimestamp;
  anchorRule: "UTC" | "SESSION_OPEN";
  version: string;
  enabled: boolean;
  fingerprint: string;
}>;
const durations: Record<string, number> = {
  S1: 1000,
  S5: 5000,
  S15: 15000,
  S30: 30000,
  M1: 60000,
  M5: 300000,
  M15: 900000,
  M30: 1800000,
  H1: 3600000,
  H4: 14400000,
  H6: 21600000,
  H12: 43200000,
};
export class TimeframeRegistry {
  readonly #entries = new Map<string, Timeframe>();
  public constructor(
    definitions: readonly Omit<Timeframe, "fingerprint">[] = standardTimeframes(),
    private readonly limit = 32,
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32 || definitions.length > limit)
      throw Error("TIMEFRAME_BOUNDS");
    for (const d of definitions) {
      canonicalTimeframeSchema.parse({
        kind: d.kind,
        code: d.code,
        ...(d.kind === "FIXED" ? { length: d.durationMs! / 1000, unit: "SECOND" } : {}),
      });
      if (
        !/^[A-Za-z0-9_-]{1,16}$/u.test(d.code) ||
        !d.version ||
        !["UTC", "SESSION_OPEN"].includes(d.anchorRule)
      )
        throw Error("TIMEFRAME_INVALID");
      instant(d.anchor);
      if (
        d.kind === "FIXED" &&
        (!Number.isSafeInteger(d.durationMs) ||
          d.durationMs! < 1000 ||
          d.durationMs! > 604800000 ||
          d.durationMs! % 1000 !== 0)
      )
        throw Error("TIMEFRAME_DURATION");
      if (d.kind === "CALENDAR" && !["DAY", "WEEK", "MONTH"].includes(d.period!))
        throw Error("TIMEFRAME_PERIOD");
      if (this.#entries.has(d.code)) throw Error("TIMEFRAME_DUPLICATE");
      this.#entries.set(d.code, freeze({ ...d, fingerprint: hash(d) }));
    }
  }
  public get(code: string): Timeframe {
    const d = this.#entries.get(code);
    if (!d || !d.enabled) throw Error("TIMEFRAME_MISSING");
    return d;
  }
  public values(): readonly Timeframe[] {
    return [...this.#entries.values()];
  }
}
export function standardTimeframes(): Omit<Timeframe, "fingerprint">[] {
  return [
    ...Object.entries(durations).map(([code, durationMs]) => ({
      code,
      kind: "FIXED" as const,
      durationMs,
      anchor: utc(0),
      anchorRule: "UTC" as const,
      version: "1",
      enabled: !code.startsWith("S"),
    })),
    ...(["D1", "W1", "MN1"] as const).map((code, i) => ({
      code,
      kind: "CALENDAR" as const,
      period: (["DAY", "WEEK", "MONTH"] as const)[i]!,
      anchor: utc(0),
      anchorRule: "UTC" as const,
      version: "1",
      enabled: true,
    })),
  ];
}
export class CalendarBoundaryResolver {
  public readonly policy: CalendarPolicy;
  public readonly fingerprint: string;
  private readonly timezone: TimeZoneId;
  private readonly cache = new Map<string, UtcTimestamp>();
  public constructor(policy: CalendarPolicy) {
    this.policy = freeze(calendarSchema.parse(policy));
    const tz = timeZoneId(this.policy.timezone);
    if (!tz.ok) throw Error("CALENDAR_TIMEZONE");
    this.timezone = tz.value;
    if (policy.kind === "UTC_CONTINUOUS" && policy.timezone !== "Etc/UTC")
      throw Error("CALENDAR_UTC");
    let prior = -Infinity;
    for (const s of this.policy.sessions) {
      if (Date.parse(s.open) >= Date.parse(s.close) || Date.parse(s.open) < prior)
        throw Error("SESSION_OVERLAP");
      prior = Date.parse(s.close);
      let end = Date.parse(s.open);
      for (const b of s.breaks) {
        if (
          Date.parse(b.start) < end ||
          Date.parse(b.end) <= Date.parse(b.start) ||
          Date.parse(b.end) > Date.parse(s.close)
        )
          throw Error("SESSION_BREAK");
        end = Date.parse(b.end);
      }
    }
    this.fingerprint = hash({
      policy: this.policy,
      timezoneAuthority: process.versions.tz ?? "unknown",
    });
  }
  public localBoundary(local: LocalDateTime): UtcTimestamp {
    const key = JSON.stringify(local);
    const found = this.cache.get(key);
    if (found) return found;
    if (this.policy.timezone === "Etc/UTC")
      return convertFixedOffsetToUtc(local, fixedOffsetMinutes(0));
    const r = resolveLocalDateTime(local, this.timezone);
    let value: UtcTimestamp;
    if (r.ok) value = r.value[0]!;
    else if (r.error.code === "AMBIGUOUS_LOCAL_TIME" && this.policy.fold !== "REJECT") {
      const c = z.array(stamp).parse(r.error.details?.candidates);
      value = this.policy.fold === "EARLIER" ? c[0]! : c[c.length - 1]!;
    } else throw Error(r.error.code);
    if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, value);
    return value;
  }
  public segments(window: Window): readonly Readonly<{ start: UtcTimestamp; end: UtcTimestamp }>[] {
    if (this.policy.kind !== "EXPLICIT_SESSION_SCHEDULE")
      return [{ start: window.start, end: window.end }];
    const result: { start: UtcTimestamp; end: UtcTimestamp }[] = [];
    for (const s of this.policy.sessions) {
      if (
        s.close <= window.start ||
        s.open >= window.end ||
        this.policy.holidays.includes(s.date) ||
        !this.policy.weekdays.includes(new Date(`${s.date}T00:00:00.000Z`).getUTCDay())
      )
        continue;
      let cursor = s.open > window.start ? s.open : window.start;
      const close = s.close < window.end ? s.close : window.end;
      for (const b of s.breaks) {
        if (b.end <= cursor || b.start >= close) continue;
        if (b.start > cursor) result.push({ start: cursor, end: b.start });
        cursor = b.end;
      }
      if (cursor < close) result.push({ start: cursor, end: close });
    }
    return freeze(result);
  }
  public resolve(tf: Timeframe, event: UtcTimestamp): Window {
    const t = Date.parse(instant(event));
    const local = utcToZoned(event, this.timezone).local;
    const date = `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
    const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
    let start: number,
      end: number,
      sessionId = "continuous";
    const session =
      this.policy.kind === "EXPLICIT_SESSION_SCHEDULE"
        ? this.policy.sessions.find((s) => Date.parse(s.open) <= t && t < Date.parse(s.close))
        : undefined;
    if (this.policy.kind === "EXPLICIT_SESSION_SCHEDULE" && !session) throw Error("SESSION_CLOSED");
    const policyDate = session?.date ?? date;
    const policyWeekday = session ? new Date(`${session.date}T00:00:00.000Z`).getUTCDay() : weekday;
    if (!this.policy.weekdays.includes(policyWeekday) || this.policy.holidays.includes(policyDate))
      throw Error("SESSION_CLOSED");
    if (session) {
      sessionId = session.id;
      if (session.breaks.some((b) => Date.parse(b.start) <= t && t < Date.parse(b.end)))
        throw Error("SESSION_BREAK");
    }
    if (tf.kind === "FIXED") {
      if (tf.anchorRule === "SESSION_OPEN" && !session) throw Error("SESSION_ANCHOR_REQUIRED");
      const anchor =
          tf.anchorRule === "SESSION_OPEN" ? Date.parse(session!.open) : Date.parse(tf.anchor),
        d = tf.durationMs!;
      start = anchor + Math.floor((t - anchor) / d) * d;
      end = start + d;
    } else {
      const base = session
        ? new Date(`${session.date}T00:00:00.000Z`)
        : new Date(Date.UTC(local.year, local.month - 1, local.day));
      if (tf.period === "WEEK")
        base.setUTCDate(base.getUTCDate() - ((policyWeekday - this.policy.weekStart + 7) % 7));
      if (tf.period === "MONTH") base.setUTCDate(1);
      const next = new Date(base);
      if (tf.period === "MONTH") next.setUTCMonth(next.getUTCMonth() + 1);
      else next.setUTCDate(next.getUTCDate() + (tf.period === "WEEK" ? 7 : 1));
      const parts = (d: Date): LocalDateTime => ({
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
        hour: 0,
        minute: 0,
        second: 0,
        millisecond: 0,
      });
      start = Date.parse(this.localBoundary(parts(base)));
      end = Date.parse(this.localBoundary(parts(next)));
    }
    if (session && tf.kind === "CALENDAR" && tf.period !== "DAY") {
      const dateOf = (ms: number) => {
        const p = utcToZoned(utc(ms), this.timezone).local;
        return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
      };
      const periodStart = dateOf(start),
        periodEnd = dateOf(end);
      const sessions = this.policy.sessions.filter(
        (s) =>
          s.date >= periodStart &&
          s.date < periodEnd &&
          !this.policy.holidays.includes(s.date) &&
          this.policy.weekdays.includes(new Date(`${s.date}T00:00:00.000Z`).getUTCDay()),
      );
      if (!sessions.length) throw Error("SESSION_CLOSED");
      start = Date.parse(sessions[0]!.open);
      end = Date.parse(sessions.at(-1)!.close);
      sessionId = hash(sessions.map((s) => s.id));
    } else if (session) {
      if (tf.kind === "CALENDAR" && tf.period === "DAY") {
        start = Date.parse(session.open);
        end = Date.parse(session.close);
      }
      start = Math.max(start, Date.parse(session.open));
      end = Math.min(end, Date.parse(session.close));
      for (const b of session.breaks) {
        if (Date.parse(b.end) <= t) start = Math.max(start, Date.parse(b.end));
        else if (Date.parse(b.start) > t) end = Math.min(end, Date.parse(b.start));
      }
    }
    if (!(start <= t && t < end)) throw Error("WINDOW_INVALID");
    return freeze({
      start: utc(start),
      end: utc(end),
      sessionId,
      calendarFingerprint: this.fingerprint,
      timeframeFingerprint: tf.fingerprint,
    });
  }
}
