import { describe, it, expect } from "vitest";
import { dataSourceRefSchema } from "@ate/domain";
import { DeterministicScheduler } from "@ate/time";
import { RealtimeDataService, ScriptedAdapter, defaultRealtimeOptions } from "@ate/realtime-data";
import { consumeRealtime, canonicalBar, hash } from "@ate/multitimeframe";
import { fixture, unwrap, t, sourceId, instrumentId, observation, evidence } from "./fixtures.js";
describe("Prompt 18 actual Prompt 17 consumer boundary", () => {
  it("consumes canonical scripted ingress without duplicating connection or time authority", async () => {
    const f = fixture(["M1"]),
      scheduler = new DeterministicScheduler(f.clock);
    let seq = 10;
    const adapter = new ScriptedAdapter(
      dataSourceRefSchema.parse({ sourceId, sourceType: "SIMULATION", name: "integration" }),
    );
    const service = new RealtimeDataService({
      clock: f.clock,
      scheduler,
      options: { ...defaultRealtimeOptions, enabled: true },
      configurationFingerprint: "sha256:" + hash("realtime-config"),
      idGenerator: () => `40000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`,
    });
    unwrap(service.register(adapter));
    unwrap(await service.start());
    unwrap(
      await service.subscribe({
        subscriptionId: "quotes",
        sourceId,
        instrumentId,
        providerSymbol: "TEST",
        observationKind: "QUOTE",
        mode: "STREAM",
        expectedActivity: false,
      }),
    );
    const consumer = unwrap(service.consumer("aggregation"));
    unwrap(
      adapter.emit({
        subscriptionId: "quotes",
        sourceId,
        observationKind: "QUOTE",
        sourceTime: t("12:00:00"),
        eventId: "quote-1",
        sequence: "1",
        payload: {
          eventTime: t("12:00:00"),
          bid: { value: "2", instrumentId, quoteCurrency: "USD" },
        },
      }),
    );
    await service.drain();
    expect(
      unwrap(
        await consumeRealtime(
          f.engine,
          consumer,
          f.streamId,
          Object.values(f.engine.diagnostics().streams)[0]!.sourceFingerprint,
          "scripted-ingress-test",
          10,
        ),
      ),
    ).toBe(1);
    expect(f.engine.diagnostics().windowCount).toBe(1);
    unwrap(await service.stop());
  });
  it("preserves prefixed Prompt 15 report fingerprints instead of inventing scores", () => {
    const f = fixture(["M1"]);
    unwrap(
      f.engine.ingest(f.streamId, {
        ...observation(t("10:00:05"), 1),
        quality: {
          reportId: "dqr-real",
          reportFingerprint: "sha256:" + hash("report"),
          findings: [
            { findingId: "finding" as never, category: "COVERAGE_GAP", severity: "WARNING" },
          ],
          suppressed: 2,
        },
      }),
    );
    evidence(f, f.clock.now());
    const r = f.engine.readRevision(
      unwrap(f.engine.publishWindow(f.streamId, "M1", t("10:00:00"), true)),
    )!;
    expect(r.quality.some((s) => s.includes("sha256:"))).toBe(true);
    expect(canonicalBar(r).metadata["aggregation.qualityfingerprint"]).toBe(hash(r.quality));
  });
});

import {
  HistoricalImportService,
  InMemoryHistoricalDatasetRepository,
  createCsvAdapter,
  type HistoricalDataMappingSpecification,
} from "@ate/historical-data";
import { consumeHistorical } from "@ate/multitimeframe";
describe("Prompt 18 actual Prompt 14 paginated historical boundary", () => {
  it("consumes each published dataset page with continuation and honest unknown historical availability", async () => {
    const f = fixture(["M1"]);
    const repository = new InMemoryHistoricalDatasetRepository();
    const importer = new HistoricalImportService({
      clock: f.clock,
      repository,
      parsers: [createCsvAdapter()],
      limits: { maxArtifactBytes: 1048576, maxRejections: 10, maxQueryLimit: 100 },
    });
    const source = dataSourceRefSchema.parse({
      sourceId,
      sourceType: "DATA_VENDOR",
      name: "historical integration",
    });
    const mapping: HistoricalDataMappingSpecification = {
      mappingId: "aggregation.csv",
      version: "1",
      targetKind: "QUOTE",
      source,
      instrument: { kind: "FIXED", instrumentId: instrumentId as never },
      eventTime: {
        field: "event_time",
        timezone: "UTC",
        precision: "MILLISECONDS",
        meaning: "EVENT_TIME",
      },
      fields: { bid: { kind: "FIELD", field: "bid" }, ask: { kind: "FIELD", field: "ask" } },
      volumes: [],
      nullMarkers: [""],
      metadata: {},
    };
    const imported = unwrap(
      await importer.importHistoricalData({
        fileName: "research.csv",
        content: new TextEncoder().encode(
          "event_time,bid,ask\n2026-10-08T10:00:05.000Z,1,1\n2026-10-08T10:00:06.000Z,2,2\n",
        ),
        source,
        mapping,
        actor: { actorType: "SYSTEM" },
      }),
    );
    const dataset = imported.outputDatasetId!;
    const first = unwrap(
      await consumeHistorical(
        f.engine,
        repository,
        dataset,
        f.streamId,
        Object.values(f.engine.diagnostics().streams)[0]!.sourceFingerprint,
        "quotes",
        1,
      ),
    );
    expect(first.count).toBe(1);
    expect(first.nextCursor).toBeDefined();
    const second = unwrap(
      await consumeHistorical(
        f.engine,
        repository,
        dataset,
        f.streamId,
        Object.values(f.engine.diagnostics().streams)[0]!.sourceFingerprint,
        "quotes",
        1,
        undefined,
        first.nextCursor,
      ),
    );
    expect(second.count).toBe(1);
    expect(second.nextCursor).toBeUndefined();
    evidence(f, f.clock.now());
    const id = unwrap(f.engine.publishWindow(f.streamId, "M1", t("10:00:00"), true));
    expect(f.engine.readRevision(id)).toMatchObject({
      count: 2,
      open: "1",
      close: "2",
      availability: "UNKNOWN",
    });
  });
});
