import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, afterEach } from "vitest";
import { VirtualClock } from "@ate/time";
import {
  AggregationEngine,
  MemoryAggregationRepository,
  TimeframeRegistry,
  utcCalendar,
  defaultOptions,
  hash,
} from "@ate/multitimeframe";
import {
  ReplayController,
  FilesystemReplayCheckpointRepository,
  createReplaySpecification,
  type ReplayCommandResult,
} from "@ate/market-replay";
import { acceptanceFixture, cutoffs } from "./acceptance-fixture.js";
import { replayFixture, observation, stream, t } from "./fixtures.js";
import { unwrap } from "../multitimeframe/fixtures.js";
import { config } from "../multitimeframe/fixtures.js";
const roots: string[] = [];
afterEach(() => {
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
const ok = (r: ReplayCommandResult) => {
  if (!r.ok) throw Error(r.code);
  return r.checkpoint;
};
function storage(spec: ReturnType<typeof createReplaySpecification>) {
  const root = mkdtempSync(join(tmpdir(), "ate-original-cutoff-"));
  roots.push(root);
  return new FilesystemReplayCheckpointRepository(
    root,
    new VirtualClock(t("13:00:00")),
    spec.resourceLimits,
  );
}
describe("accepted Prompt 18 cutoff fixture reused without changing its authorities", () => {
  it("derives exact H4/H1/M15 identities against the actual original owner runtime", async () => {
    const template = await acceptanceFixture("VERIFIED_POINT_IN_TIME", false);
    const records = [
      ["07:50:00", "08:00:05"],
      ["09:50:00", "10:00:05"],
      ["10:01:00", "10:14:59"],
      ["10:20:00", "10:30:00"],
      ["09:50:01", "11:00:06"],
    ].map(([event, known], i) => ({
      input: {
        ...observation(t(event!), i + 1, i === 4 ? "9" : "1"),
        sessionId: i === 3 ? "session-2" : "session-1",
        continuity: i === 3 ? ("GAP" as const) : ("CONTINUOUS" as const),
      },
      evidence: {
        kind: "CANONICAL_FIXTURE" as const,
        availableAt: t(known!),
        fingerprint: hash({ event, known }),
      },
    }));
    const f = replayFixture("VERIFIED_POINT_IN_TIME", records);
    const { fingerprint: _fp, ...base } = f.spec;
    const spec = createReplaySpecification({
      ...base,
      startTime: t("07:00:00"),
      aggregation: { ...base.aggregation, directTimeframes: ["M15", "H1", "H4"] },
      tasks: template.spec.tasks
        .filter(
          (task) =>
            task.action.kind !== "PUBLISH" || ["H4", "H1", "M15"].includes(task.action.timeframe),
        )
        .map((task) =>
          task.action.kind === "SNAPSHOT"
            ? { ...task, action: { ...task.action, timeframes: ["H4", "H1", "M15"] } }
            : task,
        ),
    });
    const replay = new ReplayController(spec, f.inputs, storage(spec));
    ok(await replay.initialize());
    const result = ok(await replay.runToEnd());
    const clock = new VirtualClock(t("08:00:05"));
    const engine = new AggregationEngine({
      clock,
      repository: new MemoryAggregationRepository(clock),
      registry: new TimeframeRegistry(),
      calendar: utcCalendar,
      configurationFingerprint: config,
      options: { ...defaultOptions, enabled: true },
      directTimeframes: ["M15", "H1", "H4"],
    });
    unwrap(engine.start());
    const id = unwrap(engine.registerStream(stream));
    const advance = (at: string) => unwrap(clock.advanceTo(t(at)));
    const wm = (
      sessionId = "session-1",
      coverage: "COMPLETE_COVERAGE" | "INCOMPLETE" = "COMPLETE_COVERAGE",
    ) =>
      unwrap(
        engine.watermark(id, {
          sessionId,
          through: clock.now(),
          observedAt: clock.now(),
          coverage,
          kind: "END_OF_STREAM",
          evidenceId: "trusted-eos",
          reconciled: true,
        }),
      );
    const pub = (code: string, event: string, final = true) =>
      unwrap(engine.publishWindow(id, code, t(event), final));
    const snap = () =>
      unwrap(
        engine.snapshot({
          streamId: id,
          timeframes: ["H4", "H1", "M15"],
          asOf: clock.now(),
          cutoff: clock.now(),
        }),
      );
    unwrap(engine.ingest(id, records[0]!.input));
    wm();
    for (const code of ["H4", "H1", "M15"]) pub(code, "07:50:00");
    advance("10:00:05");
    unwrap(engine.ingest(id, records[1]!.input));
    wm();
    pub("H1", "09:50:00");
    pub("M15", "09:50:00");
    advance("10:14:59");
    unwrap(engine.ingest(id, records[2]!.input));
    pub("M15", "10:01:00", false);
    const expected = [snap()];
    advance("10:15:00");
    expected.push(snap());
    advance("10:15:05");
    wm();
    pub("M15", "10:01:00");
    expected.push(snap());
    advance("10:30:00");
    unwrap(engine.fence(id, "RECONNECT"));
    unwrap(engine.ingest(id, records[3]!.input));
    expect(engine.publishWindow(id, "M15", t("10:20:00"), true).ok).toBe(false);
    expected.push(snap());
    advance("11:00:00");
    expected.push(snap());
    advance("11:00:05");
    wm("session-2", "INCOMPLETE");
    pub("H1", "10:01:00");
    expected.push(snap());
    wm();
    advance("11:00:06");
    unwrap(engine.ingest(id, records[4]!.input));
    expected.push(snap());
    const actual = result.snapshots;
    expect(actual.map((s) => s.logicalTime)).toEqual(cutoffs.map(t));
    for (let i = 0; i < expected.length; i++)
      expect(
        Object.fromEntries(
          Object.entries(actual[i]!.aggregation.selected).map(([k, r]) => [
            k,
            {
              id: r.revisionId,
              availableAt: r.availableAt,
              finalityAt: r.finalityAt,
              state: r.state,
            },
          ]),
        ),
      ).toEqual(
        Object.fromEntries(
          Object.entries(expected[i]!.selected).map(([k, r]) => [
            k,
            {
              id: r.revisionId,
              availableAt: r.availableAt,
              finalityAt: r.finalityAt,
              state: r.state,
            },
          ]),
        ),
      );
    if (process.env.ATE_REPLAY_EVIDENCE_DIR)
      writeFileSync(
        join(process.env.ATE_REPLAY_EVIDENCE_DIR, "original-cutoffs.json"),
        JSON.stringify({ specification: spec, snapshots: actual, checkpoint: result }, null, 2),
      );
  }, 30000);
  it("does not reset the finalized correction horizon after fresh-instance recovery", async () => {
    const f = replayFixture(
      "VERIFIED_POINT_IN_TIME",
      [
        {
          input: observation(t("09:00:01"), 1),
          evidence: {
            kind: "CANONICAL_FIXTURE",
            availableAt: t("09:15:03"),
            fingerprint: hash("first"),
          },
        },
        {
          input: observation(t("09:01:01"), 2, "3"),
          evidence: {
            kind: "CANONICAL_FIXTURE",
            availableAt: t("09:22:11"),
            fingerprint: hash("late"),
          },
        },
      ],
      [
        {
          taskId: "complete",
          dueAt: t("09:15:03"),
          action: {
            kind: "WATERMARK",
            streamId: hash(stream),
            authorityReference: "recorded-fixture",
            evidence: {
              sessionId: "session-1",
              through: t("09:15:03"),
              observedAt: t("09:15:03"),
              coverage: "COMPLETE_COVERAGE",
              kind: "END_OF_STREAM",
              evidenceId: "complete",
              reconciled: true,
            },
          },
        },
        {
          taskId: "publish",
          dueAt: t("09:15:03"),
          action: {
            kind: "PUBLISH",
            streamId: hash(stream),
            timeframe: "M15",
            eventAt: t("09:00:01"),
            final: true,
          },
        },
      ],
    );
    const { fingerprint: _fp, ...base } = f.spec;
    const spec = createReplaySpecification({
      ...base,
      aggregation: {
        ...base.aggregation,
        directTimeframes: ["M15"],
        options: { ...base.aggregation.options!, correctionHorizonMs: 60000 },
      },
    });
    const repository = storage(spec);
    const c = new ReplayController(spec, f.inputs, repository);
    ok(await c.initialize());
    ok(await c.runToTime(t("09:18:00")));
    ok(await c.pause());
    const fresh = new ReplayController(spec, f.inputs, repository);
    ok(await fresh.initialize());
    ok(await fresh.resume());
    const prior = fresh.currentCheckpoint();
    expect(await fresh.runToTime(t("09:25:00"))).toMatchObject({ ok: false });
    expect(fresh.diagnostics().lastFailureCode).toBe("CORRECTION_HORIZON");
    expect(fresh.currentCheckpoint()?.aggregation.revisions).toEqual(prior?.aggregation.revisions);
  });
});
