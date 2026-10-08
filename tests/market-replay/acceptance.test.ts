import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { VirtualClock } from "@ate/time";
import { ConsumerChannel, type AcceptedObservation } from "@ate/realtime-data";
import { hash } from "@ate/multitimeframe";
import {
  ReplayController,
  FilesystemReplayCheckpointRepository,
  DeterministicReplaySequencer,
  compareReplayCheckpoints,
  FilesystemReplayBranchRegistry,
  completeReplayBranchSpecification,
  createReplaySpecification,
  type ReplayCommandResult,
} from "@ate/market-replay";
import { acceptanceFixture, cutoffs } from "./acceptance-fixture.js";
import { t } from "./fixtures.js";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const ok = (r: ReplayCommandResult) => {
  if (!r.ok) throw Error(r.code);
  return r.checkpoint;
};
function controller(f: Awaited<ReturnType<typeof acceptanceFixture>>) {
  const root = mkdtempSync(join(tmpdir(), "ate-whole-replay-"));
  roots.push(root);
  const repository = new FilesystemReplayCheckpointRepository(
    root,
    new VirtualClock(t("13:00:00")),
    f.spec.resourceLimits,
  );
  return { root, repository, c: new ReplayController(f.spec, f.inputs, repository) };
}
describe("whole-system offline acceptance timeline", () => {
  for (const mode of ["VERIFIED_POINT_IN_TIME", "EVENT_TIME_RECONSTRUCTION"] as const)
    it(`proves actual multi-provider cutoff selections, pause/restart and equivalent outputs: ${mode}`, async () => {
      const f = await acceptanceFixture(mode);
      const a = controller(f),
        b = controller(f);
      ok(await a.c.initialize());
      ok(await b.c.initialize());
      const sequencer = new DeterministicReplaySequencer(f.spec, f.inputs);
      expect(f.streams).toHaveLength(4);
      expect(new Set(f.streams.map((s) => s.instrumentId)).size).toBe(2);
      expect(new Set(f.streams.map((s) => s.sourceId)).size).toBe(2);
      expect(sequencer.events.some((e) => e.ordering === "SYNTHETIC_UNCERTAIN")).toBe(true);
      const overflow = async (c: ReplayController) => {
        ok(await c.runToTime(t("10:14:59")));
        const channel = new ConsumerChannel("whole-system-reader", 1);
        const accepted = (n: number): AcceptedObservation => {
          const input = sequencer.events[n]!.record.input;
          return {
            observation: input.observation,
            processedAt: t("10:14:59"),
            warnings: [],
            ingress: {
              ingressId: `whole-${n}`,
              sourceId: input.observation.source.sourceId,
              adapterId: "offline-fixture",
              adapterVersion: "1",
              sessionId: input.sessionId,
              subscriptionId: input.channel,
              providerSymbol: "TEST",
              observationKind: "QUOTE",
              receivedAt: input.observation.receivedAt,
              localSequence: n + 1,
              payloadFingerprint: hash(input.observation),
              configurationFingerprint: f.spec.configurationFingerprint,
            },
          };
        };
        expect(channel.deliver(accepted(0))).toBe(true);
        expect(channel.deliver(accepted(1))).toBe(false);
        const cp = ok(await c.observeConsumerChannel(channel, "whole-system-capture"));
        expect(Object.values(cp.aggregation.consumerLosses ?? {})[0]!.affectedStreams).toHaveLength(
          4,
        );
        expect(Object.values(cp.aggregation.watermarks).every((w) => w.status === "FENCED")).toBe(
          true,
        );
      };
      await overflow(a.c);
      await overflow(b.c);
      const paused = ok(await a.c.pause());
      expect(paused.cursor).toBe(12);
      expect(paused.pendingTasks.length).toBeGreaterThan(0);
      const { fingerprint: _parentFp, ...parentRaw } = f.spec;
      const child = completeReplayBranchSpecification(
        paused,
        f.spec,
        createReplaySpecification({
          ...parentRaw,
          sessionId: `${f.spec.sessionId}-branch`,
          configurationFingerprint: hash({
            parent: f.spec.configurationFingerprint,
            variant: "child-research-policy",
          }),
        }),
      );
      const branchRoot = mkdtempSync(join(tmpdir(), "ate-whole-branch-"));
      roots.push(branchRoot);
      const branches = new FilesystemReplayBranchRegistry(
        branchRoot,
        new VirtualClock(t("13:00:00")),
        f.spec.resourceLimits,
      );
      const branch = await branches.fork(a.c, child, f.inputs);
      if (!branch.ok) throw Error(branch.code);
      const childReference = controller({ ...f, spec: child });
      ok(await childReference.c.initialize());
      ok(await childReference.c.runToTime(paused.logicalTime));
      ok(await childReference.c.pause());
      const branchComparison = compareReplayCheckpoints(
        { specification: f.spec, checkpoint: paused },
        { specification: child, checkpoint: branch.controller.currentCheckpoint()! },
        { specification: child, checkpoint: childReference.c.currentCheckpoint()! },
      );
      expect(branchComparison.classification).toBe("EXPECTED_DIFFERENCE");
      expect(a.c.currentCheckpoint()).toEqual(paused);
      expect(
        Object.values(branch.controller.currentCheckpoint()!.aggregation.consumerLosses ?? {})[0]
          ?.rejected,
      ).toBe(1);
      const fresh = new ReplayController(f.spec, f.inputs, a.repository);
      expect(ok(await fresh.initialize())).toEqual(paused);
      ok(await fresh.resume());
      const final = ok(await fresh.runToEnd());
      const reference = ok(await b.c.runToEnd());
      const third = controller(f);
      ok(await third.c.initialize());
      await overflow(third.c);
      const repeated = ok(await third.c.runToEnd());
      expect(
        compareReplayCheckpoints(
          { specification: f.spec, checkpoint: reference },
          { specification: f.spec, checkpoint: repeated },
        ).classification,
      ).toBe("IDENTICAL");
      expect(
        compareReplayCheckpoints(
          { specification: f.spec, checkpoint: final },
          { specification: f.spec, checkpoint: reference },
        ).classification,
      ).toBe("IDENTICAL");
      for (const s of f.streams) {
        const id = hash(s);
        const snaps = final.snapshots.filter((x) => x.aggregation.streamId === id);
        expect(snaps.map((x) => x.logicalTime)).toEqual(cutoffs.map(t));
        const selections = snaps.map((x) => x.aggregation.selected);
        const first = selections[0]!;
        expect(first.H4!.window).toMatchObject({ start: t("04:00:00"), end: t("08:00:00") });
        expect(first.H4!.availableAt).toBe(t("08:00:05"));
        expect(selections[1]!.M15!.revisionId).toBe(first.M15!.revisionId);
        const next = selections[2]!.M15!;
        expect(next.availableAt).toBe(t("10:15:05"));
        expect(next.finalityAt).toBe(t("10:15:05"));
        for (const n of [3, 4, 5, 6]) expect(selections[n]!.M15!.revisionId).toBe(next.revisionId);
        for (const n of [4, 5]) expect(selections[n]!.H1!.revisionId).toBe(first.H1!.revisionId);
        expect(selections[6]!.H1!.parentRevisionId).toBe(first.H1!.revisionId);
        expect(selections[6]!.H1!.availableAt).toBe(t("11:00:06"));
        expect(
          final.aggregation.revisions
            .filter((r) => r.streamId === id && ["M1", "M5", "M15", "H1"].includes(r.timeframe))
            .some((r) => r.quality.some((q) => q.includes("SPREAD") || q.includes("CROSSED"))),
        ).toBe(true);
        expect(
          final.aggregation.revisions.some((r) => r.streamId === id && r.coverage === "INCOMPLETE"),
        ).toBe(true);
        for (const snap of snaps)
          for (const revision of Object.values(snap.aggregation.selected)) {
            expect(revision.availableAt <= snap.logicalTime).toBe(true);
            expect(revision.coverage).toBe("COMPLETE_COVERAGE");
          }
      }
      if (process.env.ATE_REPLAY_EVIDENCE_DIR) {
        writeFileSync(
          join(process.env.ATE_REPLAY_EVIDENCE_DIR, `acceptance-${mode}.json`),
          JSON.stringify(
            {
              specification: f.spec,
              events: sequencer.events.map(
                ({ eventId, eligibilityAt, sourceCursor, ordering }) => ({
                  eventId,
                  eligibilityAt,
                  sourceCursor,
                  ordering,
                }),
              ),
              checkpoint: final,
              branch: branch.record,
              branchCheckpoint: branch.controller.currentCheckpoint(),
              branchComparison,
              comparison: compareReplayCheckpoints(
                { specification: f.spec, checkpoint: final },
                { specification: f.spec, checkpoint: reference },
              ),
            },
            null,
            2,
          ),
        );
      }
    }, 120000);
});
