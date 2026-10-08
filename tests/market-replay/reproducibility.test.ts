import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, afterEach } from "vitest";
import { VirtualClock } from "@ate/time";
import { hash } from "@ate/multitimeframe";
import {
  ReplayController,
  FilesystemReplayCheckpointRepository,
  createReplaySpecification,
  immutableReplayInputs,
  compareReplayCheckpoints,
  resolveHistoricalReplayInputs,
  type ReplayCommandResult,
} from "@ate/market-replay";
import { replayFixture, stream, t } from "./fixtures.js";
import { historicalFixture } from "./historical-fixture.js";
const roots: string[] = [];
afterEach(() => {
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
const ok = (r: ReplayCommandResult) => {
  if (!r.ok) throw Error(r.code);
  return r.checkpoint;
};
describe("reproducibility across operational variations", () => {
  it("resolves exactly the same governed source identity across different owner page sizes", async () => {
    const f = await historicalFixture();
    const a = await resolveHistoricalReplayInputs(f.options),
      b = await resolveHistoricalReplayInputs({
        ...f.options,
        limits: { ...f.options.limits, maxEventsPerBatch: 2 },
      });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.manifests).toEqual(b.manifests);
    await a.verify();
    await b.verify();
  });
  it("produces identical owner outputs with event/batch stepping, host delays, storage timestamps and pause boundaries", async () => {
    const f = replayFixture(undefined, undefined, [
      {
        taskId: "wm",
        dueAt: t("10:02:00"),
        action: {
          kind: "WATERMARK",
          streamId: hash(stream),
          authorityReference: "fixture-source",
          evidence: {
            sessionId: "session-1",
            through: t("10:02:00"),
            observedAt: t("10:02:00"),
            coverage: "COMPLETE_COVERAGE",
            kind: "END_OF_STREAM",
            evidenceId: "eos",
            reconciled: true,
          },
        },
      },
      {
        taskId: "final",
        dueAt: t("10:02:00"),
        action: {
          kind: "PUBLISH",
          streamId: hash(stream),
          timeframe: "M1",
          eventAt: t("10:00:00"),
          final: true,
        },
      },
    ]);
    const outputs = [];
    for (const variation of [0, 1, 2]) {
      const { fingerprint: _fp, ...raw } = f.spec;
      const spec = createReplaySpecification({
        ...raw,
        resourceLimits: { ...raw.resourceLimits, maxEventsPerBatch: variation === 1 ? 1 : 64 },
      });
      const root = mkdtempSync(join(tmpdir(), "ate-repro-"));
      roots.push(root);
      const repository = new FilesystemReplayCheckpointRepository(
        root,
        new VirtualClock(t(variation === 0 ? "13:00:00" : "14:00:00")),
        spec.resourceLimits,
      );
      const inputs = immutableReplayInputs(f.inputs.manifests, async () => {
        for (let turn = 0; turn < variation * 4; turn++) await Promise.resolve();
      });
      let c = new ReplayController(spec, inputs, repository);
      ok(await c.initialize());
      if (variation === 0) ok(await c.runToEnd());
      else {
        ok(await c.stepEvent());
        if (variation === 2) {
          ok(await c.pause());
          c = new ReplayController(spec, inputs, repository);
          ok(await c.initialize());
          ok(await c.resume());
        }
        while (c.diagnostics().state !== "COMPLETED") ok(await c.stepEvent());
      }
      const checkpoint = ok(await c.snapshot(hash(stream), ["M1"]));
      outputs.push({ specification: spec, checkpoint });
    }
    for (const output of outputs.slice(1))
      expect(compareReplayCheckpoints(outputs[0]!, output).classification).toBe("IDENTICAL");
  });
});
