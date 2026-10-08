import { describe, it, expect } from "vitest";
import { VirtualClock } from "@ate/time";
import {
  AggregationEngine,
  MemoryAggregationRepository,
  TimeframeRegistry,
  utcCalendar,
  defaultOptions,
} from "@ate/multitimeframe";
import { unwrap, t, observation, stream, config, set } from "./fixtures.js";
const create = (at: string) => {
  const clock = new VirtualClock(t(at));
  const repository = new MemoryAggregationRepository(clock);
  const engine = new AggregationEngine({
    clock,
    repository,
    registry: new TimeframeRegistry(),
    calendar: utcCalendar,
    configurationFingerprint: config,
    options: { ...defaultOptions, enabled: true },
    directTimeframes: ["M15", "H1", "H4"],
  });
  unwrap(engine.start());
  const streamId = unwrap(engine.registerStream(stream));
  return { clock, repository, engine, streamId };
};
const finalize = (f: ReturnType<typeof create>, code: string, event: string) => {
  unwrap(
    f.engine.watermark(f.streamId, {
      sessionId: "session-1",
      through: f.clock.now(),
      observedAt: f.clock.now(),
      coverage: "COMPLETE_COVERAGE",
      kind: "END_OF_STREAM",
      evidenceId: "trusted-eos",
      reconciled: true,
    }),
  );
  return unwrap(f.engine.publishWindow(f.streamId, code, t(event), true));
};
describe("Prompt 18 mandatory H4/H1/M15 point-in-time timeline", () => {
  it("selects exact closed windows at each required cutoff, preserving delayed finality and corrections", () => {
    const f = create("08:00:05");
    unwrap(f.engine.ingest(f.streamId, observation(t("07:50:00"), 1)));
    const prev = {
      H4: finalize(f, "H4", "07:50:00"),
      H1: finalize(f, "H1", "07:50:00"),
      M15: finalize(f, "M15", "07:50:00"),
    };
    set(f, t("10:00:05"));
    unwrap(f.engine.ingest(f.streamId, observation(t("09:50:00"), 2)));
    const h1 = finalize(f, "H1", "09:50:00");
    const old15 = finalize(f, "M15", "09:50:00");
    set(f, t("10:14:59"));
    unwrap(f.engine.ingest(f.streamId, observation(t("10:01:00"), 3)));
    unwrap(f.engine.publishWindow(f.streamId, "M15", t("10:01:00")));
    const snapshot = (at: string) =>
      unwrap(
        f.engine.snapshot({
          streamId: f.streamId,
          timeframes: ["H4", "H1", "M15"],
          asOf: t(at),
          cutoff: t(at),
        }),
      );
    const initial = snapshot("10:14:59");
    expect(
      Object.fromEntries(Object.entries(initial.selected).map(([k, r]) => [k, r.revisionId])),
    ).toEqual({ H4: prev.H4, H1: h1, M15: old15 });
    expect(initial.selected.H4!.window).toMatchObject({ start: t("04:00:00"), end: t("08:00:00") });
    set(f, t("10:15:00"));
    expect(snapshot("10:15:00").selected.M15!.revisionId).toBe(old15);
    set(f, t("10:15:05"));
    const next15 = finalize(f, "M15", "10:01:00");
    expect(snapshot("10:15:05").selected.M15).toMatchObject({
      revisionId: next15,
      availableAt: t("10:15:05"),
      finalityAt: t("10:15:05"),
      window: { start: t("10:00:00"), end: t("10:15:00") },
    });
    set(f, t("10:30:00"));
    unwrap(f.engine.fence(f.streamId, "RECONNECT"));
    unwrap(
      f.engine.ingest(f.streamId, {
        ...observation(t("10:20:00"), 4),
        sessionId: "session-2",
        continuity: "GAP",
      }),
    );
    expect(f.engine.publishWindow(f.streamId, "M15", t("10:20:00"), true).ok).toBe(false);
    expect(snapshot("10:30:00").selected.M15!.revisionId).toBe(next15);
    set(f, t("11:00:00"));
    expect(snapshot("11:00:00").selected.H1!.revisionId).toBe(h1);
    set(f, t("11:00:05"));
    unwrap(
      f.engine.watermark(f.streamId, {
        sessionId: "session-2",
        through: f.clock.now(),
        observedAt: f.clock.now(),
        coverage: "INCOMPLETE",
        kind: "END_OF_STREAM",
        evidenceId: "reconcile-partial",
        reconciled: true,
      }),
    );
    const incomplete = unwrap(f.engine.publishWindow(f.streamId, "H1", t("10:01:00"), true));
    expect(f.engine.readRevision(incomplete)!.coverage).toBe("INCOMPLETE");
    expect(snapshot("11:00:05").selected.H1!.revisionId).toBe(h1);
    expect(snapshot("11:00:05").selected.H4!.revisionId).toBe(prev.H4);
    unwrap(
      f.engine.watermark(f.streamId, {
        sessionId: "session-1",
        through: f.clock.now(),
        observedAt: f.clock.now(),
        coverage: "COMPLETE_COVERAGE",
        kind: "END_OF_STREAM",
        evidenceId: "reconcile-original",
        reconciled: true,
      }),
    );
    set(f, t("11:00:06"));
    unwrap(f.engine.ingest(f.streamId, observation(t("09:50:01"), 5, "9")));
    const corrected = snapshot("11:00:06");
    expect(corrected.selected.M15!.revisionId).toBe(next15);
    const correctedOld = unwrap(f.engine.history(f.engine.readRevision(old15)!.barId)).at(-1)!;
    expect(correctedOld.parentRevisionId).toBe(old15);
    expect(corrected.selected.H1!.parentRevisionId).toBe(h1);
    expect(corrected.selected.H4!.revisionId).toBe(prev.H4);
    expect(snapshot("10:14:59").contentFingerprint).toBe(initial.contentFingerprint);
  });
  it("uses 09:15:03 publication and 09:22:11 correction knowledge at 09:18 and 09:25", () => {
    const f = create("09:15:03");
    unwrap(f.engine.ingest(f.streamId, observation(t("09:00:01"), 1)));
    const first = finalize(f, "M15", "09:00:01");
    set(f, t("09:18:00"));
    const req = {
      streamId: f.streamId,
      timeframes: ["M15"],
      asOf: t("09:18:00"),
      cutoff: t("09:18:00"),
    };
    const old = unwrap(f.engine.snapshot(req));
    expect(old.selected.M15!.revisionId).toBe(first);
    set(f, t("09:22:11"));
    unwrap(f.engine.ingest(f.streamId, observation(t("09:01:01"), 2, "3")));
    set(f, t("09:25:00"));
    const latest = unwrap(
      f.engine.snapshot({ ...req, asOf: f.clock.now(), cutoff: f.clock.now() }),
    );
    expect(latest.selected.M15).toMatchObject({
      parentRevisionId: first,
      availableAt: t("09:22:11"),
    });
    expect(unwrap(f.engine.snapshot(req))).toEqual(old);
  });
});
