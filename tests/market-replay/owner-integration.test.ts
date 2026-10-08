import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { VirtualClock, DeterministicScheduler } from "@ate/time";
import { dataSourceRefSchema } from "@ate/domain";
import {
  RealtimeDataService,
  ScriptedAdapter,
  FilesystemCaptureRepository,
  defaultRealtimeOptions,
  fingerprint as realtimeFingerprint,
} from "@ate/realtime-data";
import { hash, CalendarBoundaryResolver, utcCalendar } from "@ate/multitimeframe";
import {
  createReplaySpecification,
  ReplayController,
  FilesystemReplayCheckpointRepository,
  resolveCaptureReplayInputs,
  immutableReplayInputs,
  defaultReplayLimits,
  type ReplayResolvedInputs,
  resolveHistoricalReplayInputs,
} from "@ate/market-replay";
import { replayFixture, stream, t } from "./fixtures.js";
import { historicalFixture } from "./historical-fixture.js";
import { unwrap } from "./integration-fixtures.js";
const roots: string[] = [];
afterEach(() => {
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
const root = () => {
  const p = mkdtempSync(join(tmpdir(), "ate-owner-e2e-"));
  roots.push(p);
  return p;
};
describe("existing package owners joined through their actual APIs", () => {
  it("captures two real offline adapters/four subscriptions and observes the actual shared consumer overflow", async () => {
    const clock = new VirtualClock(t("10:00:00"));
    const scheduler = new DeterministicScheduler(clock);
    const options = {
      ...defaultRealtimeOptions,
      enabled: true,
      captureEnabled: true,
      consumerQueueCapacity: 1,
    };
    const capture = new FilesystemCaptureRepository(
      root(),
      clock,
      options.captureMaxFileBytes,
      options.captureMaxSessions,
    );
    let n = 200;
    const service = new RealtimeDataService({
      clock,
      scheduler,
      options,
      configurationFingerprint: realtimeFingerprint(options),
      captureRepository: capture,
      idGenerator: () => `40000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    });
    const sources = [stream.sourceId, "40000000-0000-4000-8000-000000000011"].map((sourceId) =>
      dataSourceRefSchema.parse({
        sourceId,
        sourceType: "SIMULATION",
        name: "Recorded offline provider",
      }),
    );
    const adapters = sources.map((source) => new ScriptedAdapter(source));
    for (const a of adapters) unwrap(service.register(a));
    unwrap(await service.start());
    const channel = unwrap(service.consumer("shared-reader"));
    const streams = sources.flatMap((source, i) =>
      [0, 1].map((j) => ({
        ...stream,
        sourceId: source.sourceId,
        instrumentId: j ? "40000000-0000-4000-8000-000000000012" : stream.instrumentId,
        channel: `quotes-${j}`,
        sourceFingerprint: hash({ provider: i }),
      })),
    );
    for (const s of streams)
      unwrap(
        await service.subscribe({
          subscriptionId: s.channel,
          sourceId: s.sourceId,
          instrumentId: s.instrumentId,
          providerSymbol: s.channel,
          observationKind: "QUOTE",
          mode: "STREAM",
          expectedActivity: false,
        }),
      );
    for (let i = 0; i < 2; i++) unwrap(service.startCapture(sources[i]!.sourceId, `capture-${i}`));
    for (let i = 0; i < streams.length; i++) {
      const s = streams[i]!;
      unwrap(
        adapters[Math.floor(i / 2)]!.emit({
          sourceId: s.sourceId,
          subscriptionId: s.channel,
          observationKind: "QUOTE",
          payload: {
            eventTime: clock.now(),
            bid: { value: String(i + 1), instrumentId: s.instrumentId, quoteCurrency: "USD" },
          },
        }),
      );
    }
    await service.drain();
    expect(channel.queue.rejected).toBe(3);
    const calendarFingerprint = new CalendarBoundaryResolver(utcCalendar).fingerprint;
    const resolved: ReplayResolvedInputs[] = [];
    for (let i = 0; i < 2; i++) {
      const handoff = unwrap(service.finishCapture(sources[i]!.sourceId));
      expect(handoff.researchQualified).toBe(false);
      resolved.push(
        await resolveCaptureReplayInputs({
          manifestId: `capture-input-${i}`,
          repository: capture,
          captureId: `capture-${i}`,
          scopes: streams.slice(i * 2, i * 2 + 2),
          sourceFingerprint: streams[i * 2]!.sourceFingerprint,
          calendarFingerprint,
          limits: defaultReplayLimits,
        }),
      );
    }
    const inputs = immutableReplayInputs(
      resolved.flatMap((x) => x.manifests),
      async () => {
        for (const r of resolved) await r.verify();
      },
    );
    const { fingerprint: _fp, ...base } = replayFixture("VERIFIED_POINT_IN_TIME").spec;
    const spec = createReplaySpecification({
      ...base,
      sessionId: "actual-owner-session",
      streams,
      instrumentScope: [...new Set(streams.map((s) => s.instrumentId))],
      sourceScope: sources.map((s) => s.sourceId),
      channelScope: ["quotes-0", "quotes-1"],
      sourceManifestIds: inputs.manifests.map((m) => m.manifestId),
      datasetFingerprints: inputs.manifests.map((m) => m.contentFingerprint),
    });
    const repository = new FilesystemReplayCheckpointRepository(root(), clock, spec.resourceLimits);
    const controller = new ReplayController(spec, inputs, repository);
    const init = await controller.initialize();
    expect(init.ok).toBe(true);
    expect((await controller.runToTime(t("10:00:00"))).ok).toBe(true);
    const observed = await controller.observeConsumerChannel(channel, "capture-root");
    if (!observed.ok) throw Error(observed.code);
    const losses = Object.values(observed.checkpoint.aggregation.consumerLosses ?? {});
    expect(losses[0]).toMatchObject({ rejected: 3, scope: "UNKNOWN_CHANNEL_SCOPE" });
    expect([...losses[0]!.affectedStreams].sort()).toEqual(streams.map(hash).sort());
    expect(
      Object.values(observed.checkpoint.aggregation.watermarks).every((w) => w.status === "FENCED"),
    ).toBe(true);
    expect(observed.checkpoint.cursor).toBe(4);
    expect((await service.stop()).ok).toBe(true);
  });
  it("preserves a real Prompt 15 report through direct and hierarchical Prompt 18 replay outputs", async () => {
    const f = await historicalFixture();
    const inputs = await resolveHistoricalReplayInputs(f.options);
    const { fingerprint: _fp, ...base } = replayFixture().spec;
    const spec = createReplaySpecification({
      ...base,
      sourceManifestIds: inputs.manifests.map((m) => m.manifestId),
      datasetFingerprints: inputs.manifests.map((m) => m.contentFingerprint),
      aggregation: {
        ...base.aggregation,
        directTimeframes: ["M1"],
        edges: [{ child: "M1", parent: "M5" }],
      },
      tasks: [
        ...["10:00:00", "10:01:00", "10:02:00"].map((at, i) => ({
          taskId: `child-${i}`,
          dueAt: t("10:05:00"),
          action: {
            kind: "PUBLISH" as const,
            streamId: hash(stream),
            timeframe: "M1",
            eventAt: t(at),
            final: true,
          },
        })),
        {
          taskId: "owner-watermark",
          dueAt: t("10:05:00"),
          action: {
            kind: "WATERMARK",
            streamId: hash(stream),
            authorityReference: "recorded-offline-research",
            evidence: {
              sessionId: f.options.datasetId,
              through: t("10:05:00"),
              observedAt: t("10:05:00"),
              coverage: "INCOMPLETE",
              kind: "END_OF_STREAM",
              evidenceId: "partial-historical-coverage",
              reconciled: true,
            },
          },
        },
        {
          taskId: "zz-hierarchical-publication",
          dueAt: t("10:05:00"),
          action: {
            kind: "PUBLISH",
            streamId: hash(stream),
            timeframe: "M5",
            eventAt: t("10:01:00"),
            final: true,
          },
        },
      ],
    });
    const repository = new FilesystemReplayCheckpointRepository(
      root(),
      new VirtualClock(t("13:00:00")),
      spec.resourceLimits,
    );
    const controller = new ReplayController(spec, inputs, repository);
    expect((await controller.initialize()).ok).toBe(true);
    const result = await controller.runToEnd();
    if (!result.ok) throw Error(`${result.code}:${controller.diagnostics().lastFailureCode}`);
    expect(
      result.checkpoint.aggregation.revisions
        .filter((r) => r.timeframe === "M5")
        .some((r) => r.quality.some((q) => q.includes(f.report.reportFingerprint))),
    ).toBe(true);
    expect(
      result.checkpoint.aggregation.revisions
        .filter((r) => r.timeframe === "M5")
        .every((r) => r.coverage !== "COMPLETE_COVERAGE"),
    ).toBe(true);
  });
});
