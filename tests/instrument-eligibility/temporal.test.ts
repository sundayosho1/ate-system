import { it, expect, beforeAll } from "vitest";
import { CalendarBoundaryResolver, utcCalendar } from "@ate/multitimeframe";
import { mustParseUtc } from "@ate/time";
import { fixture, take, time } from "./fixtures.js";
let temporalFixture: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  temporalFixture = await fixture();
  await temporalFixture.toResearch();
});
for (const [label, at] of [
  ["autumn DST fold", "2026-11-01T06:30:00.000Z"],
  ["spring DST gap", "2027-03-14T07:30:00.000Z"],
])
  it(`P24 delegates ${label} calendar interpretation to the P18 owner`, async () => {
    const f = temporalFixture;
    const calendar = {
      ...utcCalendar,
      id: "synthetic-new-york-calendar",
      kind: "TIMEZONE_CALENDAR" as const,
      timezone: "America/New_York",
      fold: "EARLIER" as const,
    };
    take(f.spec.mapping.base.clock.advanceTo(mustParseUtc(at!)));
    const c = {
      ...f.context,
      timeframes: ["D1", "H1"],
      calendar,
      calendarFingerprint: new CalendarBoundaryResolver(calendar).fingerprint,
    };
    const assessment = take(
      await f.service.evaluateTransition({
        instrumentId: c.instrumentId,
        destination: "RESEARCH",
        context: c,
      }),
    );
    expect(assessment.dimensions.temporal).toEqual([]);
    expect(assessment.present).toContain("CALENDAR_BOUND");
    expect(assessment.allowed).toBe(false); // Old mapping/data do not become fresh because a calendar is valid.
  });
it("future source occurrence and effective dates cannot publish knowledge into earlier time", async () => {
  const f = await fixture();
  for (const changes of [
    { occurredAt: "2027-01-01T00:00:00.000Z" },
    { effectiveAt: "2027-01-01T00:00:00.000Z" },
  ])
    expect(
      (
        await f.service.publish({
          kind: "DISCOVER",
          id: "future",
          instrumentId: f.context.instrumentId,
          context: f.context,
          maker: { actorType: "SYSTEM" },
          occurredAt: time,
          effectiveAt: time,
          ...changes,
        })
      ).ok,
    ).toBe(false);
  expect(f.service.diagnostics().history).toBe(0);
});
it("canonical revision recorded in a later owner-clock context cannot establish earlier discovery", async () => {
  const f = await fixture();
  const canonical = f.spec.mapping.base.canonical;
  const old = take(canonical.registry.get(f.context.instrumentId))!;
  take(canonical.clock.advanceTo(mustParseUtc("2026-10-11T09:00:00.000Z")));
  const future = take(
    await canonical.registry.revise(
      f.context.instrumentId,
      old.revisionId,
      { ...old.definition, displayName: "Future recorded canonical revision" },
      "Explicit future-time negative control",
    ),
  );
  const result = await f.service.publish({
    kind: "DISCOVER",
    id: "future-canonical",
    instrumentId: f.context.instrumentId,
    context: { ...f.context, revisionId: future.revisionId },
    maker: { actorType: "SYSTEM" },
    occurredAt: time,
    effectiveAt: time,
  });
  expect(result.ok).toBe(false);
  expect(f.service.diagnostics().history).toBe(0);
});
