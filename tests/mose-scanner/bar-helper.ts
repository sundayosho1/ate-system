import type { DataQualityReportId } from "@ate/data-quality";
import { DeterministicReplaySequencer } from "@ate/market-replay";
import type { Input } from "@ate/multitimeframe";
import { qualityEvidence } from "@ate/multitimeframe";
import type { fixture } from "./fixtures.js";
import { take } from "./fixtures.js";
export async function seed(
  f: Awaited<ReturnType<typeof fixture>>,
  mutate: (input: Input) => Input = (input) => input,
  withholdLast = false,
) {
  const source = f.universe.members[0]!.source,
    replay = f.ports.replayEvidence(source.sessionId, source.checkpoint)!;
  const events = new DeterministicReplaySequencer(replay.specification, replay.inputs).events;
  const stream = replay.inputs.manifests[0]!.scopes[0]!,
    streamId = take(f.engine.registerStream(stream));
  const report = take(
    await f.mose.ports.quality.getReport(
      f.universe.plan[0]!.qualityReportId as DataQualityReportId,
    ),
  );
  for (const event of withholdLast ? events.slice(0, -1) : events)
    take(
      f.engine.ingest(
        streamId,
        mutate({ ...event.record.input, quality: qualityEvidence(report) }),
      ),
    );
  take(
    f.engine.watermark(streamId, {
      sessionId: events[0]!.record.input.sessionId,
      through: f.clock.now(),
      observedAt: f.clock.now(),
      coverage: "COMPLETE_COVERAGE",
      kind: "END_OF_STREAM",
      evidenceId: "scanner-end",
      reconciled: true,
    }),
  );
  return {
    streamId,
    events,
    releaseLast: () =>
      take(
        f.engine.ingest(streamId, {
          ...events.at(-1)!.record.input,
          quality: qualityEvidence(report),
        }),
      ),
    inspect: (timeframe: string) =>
      f.engine.snapshot({
        streamId,
        timeframes: [timeframe],
        asOf: f.clock.now(),
        cutoff: f.clock.now(),
        evidenceClass: replay.specification.replayMode,
        requireQualityEvidence: true,
      }),
    publish: (timeframe: string) =>
      take(f.engine.publishWindow(streamId, timeframe, events.at(-1)!.eventAt, true)),
  };
}
