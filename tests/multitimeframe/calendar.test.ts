import { describe, it, expect } from "vitest";
import {
  CalendarBoundaryResolver,
  TimeframeRegistry,
  standardTimeframes,
  utcCalendar,
  calendarSchema,
  hash,
} from "@ate/multitimeframe";
import { t } from "./fixtures.js";
const resolver = new CalendarBoundaryResolver(utcCalendar),
  registry = new TimeframeRegistry();
describe("Prompt 18 registry and half-open boundaries", () => {
  it("defines fixed and calendar standards using canonical extensions", () => {
    expect(registry.values()).toHaveLength(15);
    expect(registry.get("H4").durationMs).toBe(14400000);
    expect(() => registry.get("S1")).toThrow();
  });
  it("supports a bounded custom fixed definition with version identity", () => {
    const d = { ...registry.get("M1"), code: "CUSTOM", durationMs: 120000 };
    const r = new TimeframeRegistry([d]);
    expect(r.get("CUSTOM").durationMs).toBe(120000);
    expect(new TimeframeRegistry([{ ...d, version: "2" }]).get("CUSTOM").fingerprint).not.toBe(
      r.get("CUSTOM").fingerprint,
    );
  });
  it.each([0, -1, 1001, 604801000, Infinity, NaN])("rejects invalid duration %s", (durationMs) =>
    expect(() => new TimeframeRegistry([{ ...registry.get("M1"), durationMs }])).toThrow(),
  );
  it("rejects conflicting definitions and proliferation", () => {
    expect(() => new TimeframeRegistry([registry.get("M1"), registry.get("M1")])).toThrow();
    expect(() => new TimeframeRegistry(standardTimeframes(), 1)).toThrow();
  });
  it.each(["M1", "M5", "M15", "M30", "H1", "H4"])(
    "assigns exact %s edges without overlap",
    (code) => {
      const tf = registry.get(code),
        start = t("08:00:00"),
        end = new Date(Date.parse(start) + tf.durationMs!).toISOString();
      expect(resolver.resolve(tf, start).start).toBe(start);
      expect(resolver.resolve(tf, t(end)).start).toBe(end);
      expect(resolver.resolve(tf, t(new Date(Date.parse(end) - 1).toISOString())).end).toBe(end);
    },
  );
  it.each(["1969-12-31T23:59:59.999Z", "2024-02-29T23:59:59.999Z", "2026-12-31T23:59:59.999Z"])(
    "resolves negative epoch, leap and year edges %s",
    (at) => {
      const w = resolver.resolve(registry.get("M1"), t(at));
      expect(Date.parse(w.start)).toBeLessThanOrEqual(Date.parse(at));
      expect(Date.parse(w.end)).toBeGreaterThan(Date.parse(at));
    },
  );
  it.each(["D1", "W1", "MN1"])("resolves calendar %s midnight/week/month", (code) => {
    const w = resolver.resolve(registry.get(code), t("2024-02-29T10:00:00.000Z"));
    expect(w.start < w.end).toBe(true);
    if (code === "MN1") {
      expect(w.start).toBe(t("2024-02-01T00:00:00.000Z"));
      expect(w.end).toBe(t("2024-03-01T00:00:00.000Z"));
    }
  });
  it("generated fixed-seed cases prove unique ownership and repeated identity", () => {
    let seed = 177;
    for (let i = 0; i < 100; i++) {
      seed = (seed * 48271) % 2147483647;
      const event = t(new Date(seed * 1000 - 1000000000000).toISOString()),
        tf = registry.get("M15"),
        w = resolver.resolve(tf, event);
      expect(resolver.resolve(tf, event)).toEqual(w);
      expect(
        Date.parse(w.start) <= Date.parse(event) && Date.parse(event) < Date.parse(w.end),
      ).toBe(true);
    }
  });
});
describe("Prompt 18 calendar, session and DST policies", () => {
  it("daily timezone windows have 23/25 elapsed hours across DST", () => {
    const r = new CalendarBoundaryResolver(
      calendarSchema.parse({
        ...utcCalendar,
        id: "ny",
        kind: "TIMEZONE_CALENDAR",
        timezone: "America/New_York",
      }),
    );
    for (const [date, hours] of [
      ["2026-03-08T12:00:00.000Z", 23],
      ["2026-11-01T12:00:00.000Z", 25],
    ] as const) {
      const w = r.resolve(registry.get("D1"), t(date));
      expect(Date.parse(w.end) - Date.parse(w.start)).toBe(hours * 3600000);
    }
  }, 15000);
  it("rejects nonexistent local times and explicitly disambiguates DST fold", () => {
    const policy = calendarSchema.parse({
        ...utcCalendar,
        kind: "TIMEZONE_CALENDAR",
        timezone: "America/New_York",
      }),
      local = { year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0, millisecond: 0 };
    expect(() => new CalendarBoundaryResolver(policy).localBoundary(local)).toThrow("AMBIGUOUS");
    const a = new CalendarBoundaryResolver({ ...policy, fold: "EARLIER" }).localBoundary(local),
      b = new CalendarBoundaryResolver({ ...policy, fold: "LATER" }).localBoundary(local);
    expect(Date.parse(b) - Date.parse(a)).toBe(3600000);
    expect(() =>
      new CalendarBoundaryResolver(policy).localBoundary({ ...local, month: 3, day: 8, hour: 2 }),
    ).toThrow("NONEXISTENT");
  }, 15000);
  it("session anchoring, early close, overnight and breaks are explicit", () => {
    const r = new CalendarBoundaryResolver(
      calendarSchema.parse({
        ...utcCalendar,
        kind: "EXPLICIT_SESSION_SCHEDULE",
        sessions: [
          {
            id: "overnight",
            date: "2026-10-07",
            open: t("2026-10-07T22:00:00.000Z"),
            close: t("2026-10-08T05:00:00.000Z"),
            breaks: [{ start: t("2026-10-08T02:00:00.000Z"), end: t("2026-10-08T03:00:00.000Z") }],
          },
        ],
      }),
    );
    const tf = {
      ...registry.get("H4"),
      anchorRule: "SESSION_OPEN" as const,
      fingerprint: hash("session H4"),
    };
    expect(r.resolve(tf, t("2026-10-08T00:00:00.000Z")).start).toBe(t("2026-10-07T22:00:00.000Z"));
    expect(() => r.resolve(tf, t("2026-10-08T02:30:00.000Z"))).toThrow("SESSION_BREAK");
    expect(r.resolve(tf, t("2026-10-08T04:00:00.000Z")).end).toBe(t("2026-10-08T05:00:00.000Z"));
  });
  it("holidays, unknown sessions, timezone and policy versions fail closed", () => {
    expect(() => new CalendarBoundaryResolver({ ...utcCalendar, timezone: "bad-zone" })).toThrow();
    expect(() =>
      new CalendarBoundaryResolver({ ...utcCalendar, holidays: ["2026-10-08"] }).resolve(
        registry.get("H1"),
        t("10:00:00"),
      ),
    ).toThrow("SESSION_CLOSED");
    expect(() =>
      new CalendarBoundaryResolver({ ...utcCalendar, kind: "EXPLICIT_SESSION_SCHEDULE" }).resolve(
        registry.get("H1"),
        t("10:00:00"),
      ),
    ).toThrow();
    expect(new CalendarBoundaryResolver({ ...utcCalendar, version: "2" }).fingerprint).not.toBe(
      resolver.fingerprint,
    );
  });
});

describe("Prompt 18 scheduled calendar collections", () => {
  it("weekly schedule excludes closure gaps while preserving overnight session ownership", () => {
    const policy = calendarSchema.parse({
      ...utcCalendar,
      id: "scheduled",
      kind: "EXPLICIT_SESSION_SCHEDULE",
      sessions: [
        {
          id: "mon",
          date: "2026-10-05",
          open: t("2026-10-05T22:00:00.000Z"),
          close: t("2026-10-06T05:00:00.000Z"),
          breaks: [{ start: t("2026-10-06T01:00:00.000Z"), end: t("2026-10-06T02:00:00.000Z") }],
        },
        {
          id: "wed",
          date: "2026-10-07",
          open: t("2026-10-07T22:00:00.000Z"),
          close: t("2026-10-08T05:00:00.000Z"),
        },
      ],
    });
    const r = new CalendarBoundaryResolver(policy),
      w = r.resolve(registry.get("W1"), t("2026-10-06T00:00:00.000Z"));
    expect(w).toMatchObject({
      start: t("2026-10-05T22:00:00.000Z"),
      end: t("2026-10-08T05:00:00.000Z"),
    });
    expect(r.segments(w)).toHaveLength(3);
    expect(r.resolve(registry.get("D1"), t("2026-10-06T00:00:00.000Z"))).toMatchObject({
      start: t("2026-10-05T22:00:00.000Z"),
      end: t("2026-10-06T01:00:00.000Z"),
    });
  });
});
