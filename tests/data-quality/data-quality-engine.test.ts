import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { Actor, InstrumentId, SourceId, UtcTimestamp } from "@ate/domain";
import { EventRegistry } from "@ate/events";
import {
  createCsvAdapter,
  HistoricalImportService,
  InMemoryHistoricalDatasetRepository,
  type HistoricalDataMappingSpecification,
  type HistoricalDatasetId,
} from "@ate/historical-data";
import type { RuntimeInstanceId } from "@ate/runtime";
import type { Clock } from "@ate/time";
import {
  createDefaultDataQualityProfile,
  dataQualityEventRegistrations,
  DataQualityEngine,
  DataQualityRuntimeService,
  InMemoryDataQualityReportRepository,
  LocalFilesystemDataQualityReportRepository,
} from "@ate/data-quality";
import {
  foundationalCapabilityDefinitions,
  foundationalConfigurationDefinitions,
  foundationalConfigurationSchemas,
} from "@ate/configuration";

const instrumentId = "40000000-0000-4000-8000-000000000001" as InstrumentId;
const sourceId = "40000000-0000-4000-8000-000000000002" as SourceId;
const actor: Actor = { actorType: "SYSTEM" };
const runtimeInstanceId = "data-quality-runtime" as RuntimeInstanceId;
const now = "2026-09-25T12:00:00.000Z" as UtcTimestamp;

const clock: Clock = {
  mode: "VIRTUAL",
  provenance: { source: "TEST", clockId: "data-quality-test-clock", quality: "SYNCHRONIZED" },
  now: () => now,
};

const source = {
  sourceId,
  sourceType: "DATA_VENDOR",
  name: "Quality Fixture Vendor",
  role: "HISTORICAL",
} as const;

const quoteMapping: HistoricalDataMappingSpecification = {
  mappingId: "quality.quote.csv",
  version: "1.0.0",
  targetKind: "QUOTE",
  source,
  instrument: { kind: "FIXED", instrumentId },
  providerSymbol: { kind: "FIELD", field: "symbol" },
  eventTime: {
    field: "event_time",
    timezone: "UTC",
    precision: "MILLISECONDS",
    meaning: "EVENT_TIME",
  },
  fields: {
    bid: { kind: "FIELD", field: "bid" },
    ask: { kind: "FIELD", field: "ask" },
  },
  volumes: [],
  nullMarkers: ["", "N/A"],
  metadata: {},
};

const barMapping: HistoricalDataMappingSpecification = {
  mappingId: "quality.bar.csv",
  version: "1.0.0",
  targetKind: "BAR",
  source,
  instrument: { kind: "FIXED", instrumentId },
  providerSymbol: { kind: "FIELD", field: "symbol" },
  eventTime: {
    field: "interval_end",
    timezone: "UTC",
    precision: "SECONDS",
    meaning: "EVENT_TIME",
  },
  intervalStart: {
    field: "interval_start",
    timezone: "UTC",
    precision: "SECONDS",
    meaning: "INTERVAL_START",
  },
  intervalEnd: {
    field: "interval_end",
    timezone: "UTC",
    precision: "SECONDS",
    meaning: "INTERVAL_END",
  },
  timeframe: { kind: "FIXED", timeframe: { kind: "FIXED", code: "1m", length: 1, unit: "MINUTE" } },
  fields: {
    open: { kind: "FIELD", field: "open" },
    high: { kind: "FIELD", field: "high" },
    low: { kind: "FIELD", field: "low" },
    close: { kind: "FIELD", field: "close" },
  },
  volumes: [{ field: "tick_volume", volumeType: "TICK_VOLUME", unit: "TICKS" }],
  nullMarkers: ["", "N/A"],
  metadata: {},
};

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

const createHistoricalService = () => {
  const repository = new InMemoryHistoricalDatasetRepository();
  const service = new HistoricalImportService({
    clock,
    repository,
    parsers: [createCsvAdapter()],
    limits: { maxQueryLimit: 5000, maxRejections: 10 },
  });
  return { repository, service };
};

const importQuotes = async () => {
  const { repository, service } = createHistoricalService();
  const imported = await service.importHistoricalData({
    fileName: "quotes.csv",
    content: encode(
      [
        "event_time,symbol,bid,ask",
        "2026-09-25T11:59:00.000Z,EURUSD.raw,1.1000,1.1002",
        "2026-09-25T11:59:00.000Z,EURUSD.raw,1.1000,1.1002",
        "2026-09-25T12:00:00.000Z,EURUSD.raw,1.3000,1.0000",
      ].join("\n"),
    ),
    source,
    mapping: quoteMapping,
    actor,
  });
  expect(imported.ok).toBe(true);
  if (!imported.ok || imported.value.outputDatasetId === undefined) {
    throw new Error("quote import failed");
  }
  return { repository, datasetId: imported.value.outputDatasetId };
};

const analyze = async (
  datasetId: HistoricalDatasetId,
  repository: InMemoryHistoricalDatasetRepository,
) => {
  const reportRepository = new InMemoryDataQualityReportRepository();
  const profile = createDefaultDataQualityProfile();
  const engine = new DataQualityEngine({
    clock,
    historicalRepository: repository,
    reportRepository,
  });
  const report = await engine.analyzeDataset({
    datasetId,
    profile,
    actor,
    runtimeMode: "RESEARCH",
    asOf: now,
  });
  expect(report.ok).toBe(true);
  if (!report.ok) {
    throw new Error(report.error.message);
  }
  return { report: report.value, reportRepository, profile, engine };
};

describe("Prompt 15 data-quality engine", () => {
  it("publishes immutable reports with bounded findings, scores, and no trading authorization", async () => {
    const { repository, datasetId } = await importQuotes();
    const { report, reportRepository } = await analyze(datasetId, repository);

    expect(report.reportId).toMatch(/^dqr-/u);
    expect(report.reportFingerprint).toMatch(/^sha256:/u);
    expect(report.structuralValidity).toBe("PASSED_BEFORE_QUALITY");
    expect(report.importValidity).toBe("IMPORTED");
    expect(report.score.doesNotAuthorizeTrading).toBe(true);
    expect(report.score.intendedUses).not.toContain("LIVE");
    expect(report.findings.map((finding) => finding.category)).toEqual(
      expect.arrayContaining(["QUOTE_SPREAD_ANOMALY", "DUPLICATE_OBSERVATION"]),
    );
    expect(report.ruleExecutions.some((execution) => execution.status === "FINDINGS")).toBe(true);

    const fetched = await reportRepository.getReport(report.reportId);
    expect(fetched.ok && fetched.value.reportFingerprint).toBe(report.reportFingerprint);
  });

  it("detects bar coverage gaps and volume evidence without repairing observations", async () => {
    const { repository, service } = createHistoricalService();
    const imported = await service.importHistoricalData({
      fileName: "bars.csv",
      content: encode(
        [
          "interval_start,interval_end,symbol,open,high,low,close,tick_volume",
          "2026-09-25T11:00:00Z,2026-09-25T11:01:00Z,EURUSD.raw,1.10,1.11,1.09,1.10,0",
          "2026-09-25T11:02:00Z,2026-09-25T11:03:00Z,EURUSD.raw,1.10,1.12,1.09,1.11,5",
        ].join("\n"),
      ),
      source,
      mapping: barMapping,
      actor,
    });
    expect(imported.ok).toBe(true);
    if (!imported.ok || imported.value.outputDatasetId === undefined) return;

    const { report } = await analyze(imported.value.outputDatasetId, repository);
    expect(report.findings.map((finding) => finding.category)).toEqual(
      expect.arrayContaining(["COVERAGE_GAP", "VOLUME_ANOMALY"]),
    );
    const page = await repository.query({ datasetId: imported.value.outputDatasetId, limit: 10 });
    expect(page.ok && page.value.observations).toHaveLength(2);
  });

  it("uses deterministic report fingerprints that exclude generatedAt and runtime durations", async () => {
    const { repository, datasetId } = await importQuotes();
    const first = await analyze(datasetId, repository);
    const laterClock: Clock = {
      ...clock,
      now: () => "2026-09-25T13:00:00.000Z" as UtcTimestamp,
    };
    const secondEngine = new DataQualityEngine({
      clock: laterClock,
      historicalRepository: repository,
      reportRepository: new InMemoryDataQualityReportRepository(),
    });
    const second = await secondEngine.analyzeDataset({
      datasetId,
      profile: first.profile,
      runtimeMode: "RESEARCH",
      asOf: now,
    });

    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.generatedAt).not.toBe(first.report.generatedAt);
      expect(second.value.reportFingerprint).toBe(first.report.reportFingerprint);
      expect(second.value.reportId).toBe(first.report.reportId);
    }
  });

  it("provides filesystem report publication and runtime health/readiness diagnostics", async () => {
    const { repository, datasetId } = await importQuotes();
    const root = await mkdtemp(join(tmpdir(), "ate-quality-"));
    try {
      const reportRepository = new LocalFilesystemDataQualityReportRepository(root);
      const profile = createDefaultDataQualityProfile();
      const engine = new DataQualityEngine({
        clock,
        historicalRepository: repository,
        reportRepository,
      });
      const report = await engine.analyzeDataset({
        datasetId,
        profile,
        runtimeMode: "RESEARCH",
      });
      expect(report.ok).toBe(true);
      if (!report.ok) return;

      const found = await reportRepository.findByDataset(datasetId, 10);
      expect(found.ok && found.value[0]?.reportId).toBe(report.value.reportId);

      const runtime = new DataQualityRuntimeService({
        runtimeMode: "RESEARCH",
        clock,
        engine,
        reportRepository,
        registeredRuleCount: profile.rules.length,
      });
      await runtime.initialize();
      const health = await runtime.managedService.checkHealth?.({
        runtimeInstanceId,
        runtimeMode: "RESEARCH",
        signal: new AbortController().signal,
        now: clock.now,
      });
      const readiness = await runtime.managedService.checkReadiness?.({
        runtimeInstanceId,
        runtimeMode: "RESEARCH",
        signal: new AbortController().signal,
        now: clock.now,
      });
      expect(health?.status).toBe("HEALTHY");
      expect(readiness?.status).toBe("READY");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("registers truthful config, capability and low-volume events while guarding boundaries", () => {
    const definitions = foundationalConfigurationDefinitions(clock);
    expect(definitions.map((definition) => definition.key)).toEqual(
      expect.arrayContaining([
        "data.quality.maxObservations",
        "data.quality.evidenceLimitPerRule",
        "data.quality.defaultFreshnessMaxAgeMs",
        "data.quality.reportStorageRoot",
      ]),
    );
    const schemas = foundationalConfigurationSchemas(clock);
    expect(schemas.map((schema) => schema.key)).toContain("data.quality.maxObservations");

    const capability = foundationalCapabilityDefinitions().find(
      (definition) => definition.capabilityId === "data.dataQualityEngine",
    );
    expect(capability?.supportedRuntimeModes).toEqual([
      "DEVELOPMENT",
      "RESEARCH",
      "BACKTEST",
      "SIMULATION",
    ]);
    expect(capability?.dependencies).toEqual([
      "data.marketDataContracts",
      "data.historicalDataLaboratory",
    ]);
    expect(capability?.safetyNotes).toContain("do not authorize");

    const registry = new EventRegistry({ now: clock.now });
    for (const registration of dataQualityEventRegistrations) {
      expect(registry.register(registration).ok).toBe(true);
    }
  });

  it("does not introduce provider, strategy, risk, execution, replay or catalogue dependencies", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const sourceDir = join(process.cwd(), "packages", "data-quality", "src");
    const prohibited = [
      /tradingview/iu,
      /metatrader|mt5|mql5/iu,
      /^axios$/iu,
      /^ws$/iu,
      /websocket/iu,
      /strategy/iu,
      /risk/iu,
      /execution-engine/iu,
      /dataset-catalogue/iu,
      /replay-engine/iu,
      /^child_process$/iu,
    ];
    const importPattern = /from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/gu;

    for (const file of readdirSync(sourceDir).filter((entry) => entry.endsWith(".ts"))) {
      const content = readFileSync(join(sourceDir, file), "utf8");
      const importedModules = Array.from(
        content.matchAll(importPattern),
        (match) => match[1] ?? match[2] ?? "",
      );
      for (const importedModule of importedModules) {
        for (const blocked of prohibited) {
          expect(blocked.test(importedModule), `${file} imports ${importedModule}`).toBe(false);
        }
      }
      expect(content).not.toMatch(/\beval\s*\(/u);
    }
  });
});
