import {
  ReplayController,
  FilesystemReplayCheckpointRepository,
  resolveHistoricalReplayInputs,
  createReplaySpecification,
  type ReplayTaskDescriptor,
} from "@ate/market-replay";
import { hash } from "@ate/multitimeframe";
import { eligibilityFixture, take, root } from "./fixtures.js";
import { replayFixture, stream, t } from "../market-replay/fixtures.js";
export async function temporalOwners(mode: "forming" | "future" | "available") {
  const base = await eligibilityFixture(),
    inputs = await resolveHistoricalReplayInputs(base.h.options),
    due = mode === "future" ? t("10:05:00") : t("10:03:00"),
    streamId = hash(stream),
    timeframe = mode === "available" ? "M1" : "M5";
  const tasks: ReplayTaskDescriptor[] = [];
  if (mode !== "forming")
    tasks.push({
      taskId: "mose-source-end",
      dueAt: due,
      action: {
        kind: "WATERMARK",
        streamId,
        authorityReference: "mose-synthetic-file-end",
        evidence: {
          sessionId: inputs.manifests[0]!.records[0]!.input.sessionId,
          through: due,
          observedAt: due,
          coverage: "COMPLETE_COVERAGE",
          kind: "END_OF_STREAM",
          evidenceId: "mose-known-finite-file",
          reconciled: true,
        },
      },
    });
  for (const [i, eventAt] of (mode === "available"
    ? [t("10:00:00"), t("10:01:00"), t("10:02:00")]
    : [t("10:00:00")]
  ).entries())
    tasks.push({
      taskId: "mose-publish-" + i,
      dueAt: due,
      action: { kind: "PUBLISH", streamId, timeframe, eventAt, final: mode !== "forming" },
    });
  tasks.push({
    taskId: "mose-snapshot",
    dueAt: due,
    action: { kind: "SNAPSHOT", streamId, timeframes: [timeframe], includeIncomplete: true },
  });
  base.replays.clear();
  for (const sessionId of ["mose-temporal-left", "mose-temporal-right"]) {
    const { fingerprint: ignored, ...body } = replayFixture().spec;
    void ignored;
    const spec = createReplaySpecification({
        ...body,
        sessionId,
        tasks,
        sourceManifestIds: inputs.manifests.map((m) => m.manifestId),
        datasetFingerprints: inputs.manifests.map((m) => m.contentFingerprint),
      }),
      controller = new ReplayController(
        spec,
        inputs,
        new FilesystemReplayCheckpointRepository(root(), base.h.clock, spec.resourceLimits),
      );
    const initialized = await controller.initialize();
    if (!initialized.ok) throw Error(initialized.code);
    const done = await controller.runToEnd();
    if (!done.ok) throw Error(done.code);
    base.replays.set(sessionId, { specification: spec, checkpoint: done.checkpoint, inputs });
  }
  base.context.replay = {
    leftSession: "mose-temporal-left",
    leftCheckpoint: base.replays.get("mose-temporal-left")!.checkpoint.fingerprint,
    rightSession: "mose-temporal-right",
    rightCheckpoint: base.replays.get("mose-temporal-right")!.checkpoint.fingerprint,
  };
  await base.toResearch();
  take(await base.service.getEligibility(base.context.instrumentId));
  return base;
}
