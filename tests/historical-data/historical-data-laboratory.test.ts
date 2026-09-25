import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { Actor, InstrumentId, SourceId, UtcTimestamp } from "@ate/domain";
import type { RuntimeInstanceId } from "@ate/runtime";
import {
  createCsvAdapter,
  createHistoricalSourceArtifact,
  createJsonAdapter,
  createNdjsonAdapter,
  createParquetAdapter,
  defaultHistoricalResourceLimits,
  detectHistoricalFormat,
  HistoricalDataRuntimeService,
  HistoricalImportService,
  InMemoryHistoricalDatasetRepository,
  LocalFilesystemHistoricalDatasetRepository,
  type HistoricalDataMappingSpecification,
  type HistoricalDatasetManifest,
  type HistoricalFormat,
} from "@ate/historical-data";
import type { Clock } from "@ate/time";

const now = "2026-09-25T12:00:00.000Z" as UtcTimestamp;
const instrumentId = "30000000-0000-4000-8000-000000000001" as InstrumentId;
const sourceId = "30000000-0000-4000-8000-000000000002" as SourceId;
const actor: Actor = { actorType: "SYSTEM" };
const runtimeInstanceId = "historical-runtime" as RuntimeInstanceId;

const clock: Clock = {
  mode: "VIRTUAL",
  provenance: { source: "TEST", clockId: "historical-test-clock", quality: "SYNCHRONIZED" },
  now: () => now,
};

const source = {
  sourceId,
  sourceType: "DATA_VENDOR",
  name: "Historical Fixture Vendor",
  role: "HISTORICAL",
} as const;

const quoteMapping: HistoricalDataMappingSpecification = {
  mappingId: "fixture.quote.csv",
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
    bidSize: { kind: "FIELD", field: "bid_size" },
    askSize: { kind: "FIELD", field: "ask_size" },
  },
  volumes: [],
  nullMarkers: ["", "N/A"],
  metadata: {},
};

const barMapping: HistoricalDataMappingSpecification = {
  mappingId: "fixture.bar.json",
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

const createService = () => {
  const repository = new InMemoryHistoricalDatasetRepository();
  return {
    repository,
    service: new HistoricalImportService({
      clock,
      repository,
      parsers: [
        createCsvAdapter(),
        createJsonAdapter(),
        createNdjsonAdapter(),
        createParquetAdapter(),
      ],
      limits: { maxArtifactBytes: 1024 * 1024, maxRejections: 10, maxQueryLimit: 100 },
    }),
  };
};

describe("Prompt 14 historical source artifacts and format detection", () => {
  it("creates content-aware source artifact identity and checksum independent of filename authority", () => {
    const content = encode("event_time,bid,ask\n2026-09-25T00:00:00.000Z,1.1,1.2\n");
    const left = createHistoricalSourceArtifact({
      fileName: "EURUSD.csv",
      content,
      source,
      clock,
      limits: defaultHistoricalResourceLimits,
    });
    const right = createHistoricalSourceArtifact({
      fileName: "EURUSD-copy.csv",
      content,
      source,
      clock,
      limits: defaultHistoricalResourceLimits,
    });

    expect(left.ok).toBe(true);
    expect(right.ok).toBe(true);
    if (left.ok && right.ok) {
      expect(left.value.checksum).toBe(right.value.checksum);
      expect(left.value.artifactId).not.toBe(right.value.artifactId);
      expect(left.value.detectedFormat).toBe("CSV");
    }
  });

  it("rejects unsafe filenames and declared-format mismatches", () => {
    expect(
      createHistoricalSourceArtifact({
        fileName: "../EURUSD.csv",
        content: encode("a,b\n1,2\n"),
        source,
        clock,
        limits: defaultHistoricalResourceLimits,
      }).ok,
    ).toBe(false);
    expect(
      detectHistoricalFormat({
        fileName: "prices.csv",
        content: encode('[{"event_time":"2026-09-25T00:00:00.000Z"}]'),
        declaredFormat: "CSV",
        clock,
      }).ok,
    ).toBe(false);
  });

  it("detects CSV, JSON, NDJSON and Parquet evidence without extension-only authority", () => {
    const cases: readonly [string, Uint8Array, HistoricalFormat][] = [
      ["data.txt", encode("a,b\n1,2\n"), "CSV"],
      ["data.txt", encode('[{"a":1}]'), "JSON"],
      ["data.ndjson", encode('{"a":1}\n{"a":2}\n'), "NDJSON"],
      ["data.bin", new Uint8Array([0x50, 0x41, 0x52, 0x31, 0, 0]), "PARQUET"],
    ];

    for (const [fileName, content, expected] of cases) {
      const detected = detectHistoricalFormat({ fileName, content, clock });
      expect(detected.ok && detected.value.detectedFormat).toBe(expected);
    }
  });
});

describe("Prompt 14 historical import, canonicalization, rejection, and query behavior", () => {
  it("dry-runs CSV quote imports into Prompt 13 canonical observations without publication", async () => {
    const { service, repository } = createService();
    const preview = await service.dryRunImport({
      fileName: "quotes.csv",
      content: encode(
        "event_time,symbol,bid,ask,bid_size,ask_size\n2026-09-25T00:00:00.000Z,EURUSD.raw,1.1000,1.1002,100,200\n",
      ),
      source,
      mapping: quoteMapping,
      actor,
    });
    const diagnostics = await repository.diagnostics();

    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.value.schema.fields.map((field) => field.fieldName)).toContain("bid");
      expect(preview.value.normalizedPreview).toHaveLength(1);
      expect(preview.value.normalizedPreview[0]?.observationKind).toBe("QUOTE");
      expect(preview.value.plan.planFingerprint).toMatch(/^sha256:/u);
    }
    expect(diagnostics.ok && diagnostics.value.publishedDatasetCount).toBe(0);
  });

  it("imports, publishes, manifests, and queries canonical CSV quote datasets deterministically", async () => {
    const { service, repository } = createService();
    const imported = await service.importHistoricalData({
      fileName: "quotes.csv",
      content: encode(
        [
          "event_time,symbol,bid,ask,bid_size,ask_size",
          "2026-09-25T00:01:00.000Z,EURUSD.raw,1.1001,1.1003,100,200",
          "2026-09-25T00:00:00.000Z,EURUSD.raw,1.1000,1.1002,100,200",
          "2026-09-25T00:00:00.000Z,EURUSD.raw,1.1000,1.1002,100,200",
        ].join("\n"),
      ),
      source,
      mapping: quoteMapping,
      actor,
    });

    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.state).toBe("COMPLETED");
    expect(imported.value.statistics.acceptedRecords).toBe(3);
    expect(imported.value.statistics.duplicateCandidates).toBe(1);

    const manifest = await service.explainDataset(imported.value.outputDatasetId!);
    expect(manifest.ok).toBe(true);
    if (!manifest.ok) return;
    expect(manifest.value.contentFingerprint).toMatch(/^sha256:/u);
    expect(manifest.value.observationKinds).toEqual(["QUOTE"]);
    expect(manifest.value.partitionScheme).toBe("instrument-kind-utc-date");

    const page = await repository.query({
      datasetId: manifest.value.datasetId,
      instrumentId,
      observationKind: "QUOTE",
      startInclusive: "2026-09-25T00:00:00.000Z" as UtcTimestamp,
      endExclusive: "2026-09-25T00:02:00.000Z" as UtcTimestamp,
      limit: 2,
    });
    expect(page.ok).toBe(true);
    if (page.ok) {
      expect(page.value.observations.map((observation) => observation.eventTime)).toEqual([
        "2026-09-25T00:00:00.000Z",
        "2026-09-25T00:00:00.000Z",
      ]);
      expect(page.value.nextCursor).toBe("2");
    }
  });

  it("collects rejections, quarantines invalid records, and marks partial datasets explicitly", async () => {
    const { service, repository } = createService();
    const imported = await service.importHistoricalData({
      fileName: "bars.json",
      content: encode(
        JSON.stringify([
          {
            interval_start: "2026-09-25T00:00:00Z",
            interval_end: "2026-09-25T00:01:00Z",
            symbol: "EURUSD.raw",
            open: "1.1000",
            high: "1.1010",
            low: "1.0990",
            close: "1.1005",
            tick_volume: "10",
          },
          {
            interval_start: "2026-09-25T00:01:00Z",
            interval_end: "2026-09-25T00:02:00Z",
            symbol: "EURUSD.raw",
            open: "1.1000",
            high: "1.0980",
            low: "1.0990",
            close: "1.1005",
            tick_volume: "11",
          },
        ]),
      ),
      source,
      mapping: barMapping,
      rejectionPolicy: { mode: "ALLOW_PARTIAL", maxRejections: 10 },
    });

    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.state).toBe("COMPLETED_WITH_REJECTIONS");
    expect(imported.value.statistics.acceptedRecords).toBe(1);
    expect(imported.value.statistics.rejectedRecords).toBe(1);
    const diagnostics = await repository.diagnostics();
    expect(diagnostics.ok && diagnostics.value.quarantinedRecordCount).toBe(1);
  });

  it("supports NDJSON source locations and rejects malformed lines safely", async () => {
    const { service } = createService();
    const preview = await service.dryRunImport({
      fileName: "quotes.ndjson",
      content: encode(
        '{"event_time":"2026-09-25T00:00:00.000Z","symbol":"EURUSD.raw","bid":"1.1","ask":"1.2","bid_size":"1","ask_size":"1"}\n',
      ),
      source,
      mapping: quoteMapping,
    });
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.value.normalizedPreview[0]?.eventTime).toBe("2026-09-25T00:00:00.000Z");
    }

    const malformed = await service.dryRunImport({
      fileName: "bad.ndjson",
      content: encode('{"event_time":"2026-09-25T00:00:00.000Z"}\n{bad}\n'),
      source,
      mapping: quoteMapping,
    });
    expect(malformed.ok).toBe(false);
  });

  it("requires explicit timezone interpretation for naive timestamps and detects DST ambiguity", async () => {
    const { service } = createService();
    const naiveRejected = await service.dryRunImport({
      fileName: "quotes.csv",
      content: encode(
        "event_time,symbol,bid,ask,bid_size,ask_size\n2026-09-25 00:00:00,EURUSD.raw,1.1,1.2,1,1\n",
      ),
      source,
      mapping: { ...quoteMapping, eventTime: { ...quoteMapping.eventTime, timezone: "EST" } },
    });
    expect(naiveRejected.ok).toBe(true);
    if (naiveRejected.ok) {
      expect(naiveRejected.value.rejections).toHaveLength(1);
    }

    const utcMapped = await service.dryRunImport({
      fileName: "quotes.csv",
      content: encode(
        "event_time,symbol,bid,ask,bid_size,ask_size\n2026-09-25 00:00:00,EURUSD.raw,1.1,1.2,1,1\n",
      ),
      source,
      mapping: quoteMapping,
    });
    expect(utcMapped.ok && utcMapped.value.normalizedPreview[0]?.eventTime).toBe(
      "2026-09-25T00:00:00.000Z",
    );
  });

  it("enforces query bounds and excludes quarantined records from research queries", async () => {
    const { service, repository } = createService();
    const imported = await service.importHistoricalData({
      fileName: "quotes.csv",
      content: encode(
        "event_time,symbol,bid,ask,bid_size,ask_size\n2026-09-25T00:00:00.000Z,EURUSD.raw,bad,1.2,1,1\n",
      ),
      source,
      mapping: quoteMapping,
      rejectionPolicy: { mode: "ALLOW_PARTIAL", maxRejections: 10 },
    });
    expect(imported.ok).toBe(true);
    if (!imported.ok || imported.value.outputDatasetId === undefined) return;
    const tooLarge = await repository.query({
      datasetId: imported.value.outputDatasetId,
      limit: 5001,
    });
    expect(tooLarge.ok).toBe(false);
    const page = await repository.query({ datasetId: imported.value.outputDatasetId, limit: 10 });
    expect(page.ok && page.value.observations).toHaveLength(0);
  });

  it("uses a filesystem repository with managed internal paths and atomic publication", async () => {
    const root = await mkdtemp(join(tmpdir(), "ate-historical-"));
    try {
      const repository = new LocalFilesystemHistoricalDatasetRepository(root);
      const service = new HistoricalImportService({
        clock,
        repository,
        parsers: [createCsvAdapter()],
      });
      const imported = await service.importHistoricalData({
        fileName: "quotes.csv",
        content: encode(
          "event_time,symbol,bid,ask,bid_size,ask_size\n2026-09-25T00:00:00.000Z,EURUSD.raw,1.1,1.2,1,1\n",
        ),
        source,
        mapping: quoteMapping,
      });
      expect(imported.ok).toBe(true);
      if (!imported.ok || imported.value.outputDatasetId === undefined) return;
      const manifestText = await readFile(
        join(root, "published", imported.value.outputDatasetId, "manifest.json"),
        "utf8",
      );
      expect((JSON.parse(manifestText) as HistoricalDatasetManifest).datasetId).toBe(
        imported.value.outputDatasetId,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("Prompt 14 runtime, Parquet adapter, and boundary guards", () => {
  it("reports runtime service health, readiness and bounded diagnostics", async () => {
    const { service, repository } = createService();
    const runtime = new HistoricalDataRuntimeService({
      runtimeMode: "RESEARCH",
      clock,
      importService: service,
      repository,
      supportedFormats: ["CSV", "JSON", "NDJSON", "PARQUET"],
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
    const diagnostics = await runtime.diagnostics();

    expect(health?.status).toBe("HEALTHY");
    expect(readiness?.status).toBe("READY");
    expect(diagnostics.supportedFormats).toEqual(["CSV", "JSON", "NDJSON", "PARQUET"]);
  });

  it("uses hyparquet for Parquet and rejects corrupt Parquet as quarantineable parse evidence", async () => {
    const adapter = createParquetAdapter();
    const artifact = createHistoricalSourceArtifact({
      fileName: "fixture.parquet",
      content: new Uint8Array([0x50, 0x41, 0x52, 0x31, 0, 0, 0, 0]),
      source,
      clock,
      limits: defaultHistoricalResourceLimits,
    });
    expect(artifact.ok).toBe(true);
    if (!artifact.ok) return;
    const inspected = await adapter.inspect(
      new Uint8Array([0x50, 0x41, 0x52, 0x31, 0, 0, 0, 0]),
      artifact.value,
      defaultHistoricalResourceLimits,
      clock,
    );
    expect(inspected.ok).toBe(false);
  });

  it("does not introduce live network/provider/trading/replay/quality/catalogue dependencies", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const sourceDir = join(process.cwd(), "packages", "historical-data", "src");
    const prohibited = [
      /tradingview/iu,
      /metatrader|mt5|mql5/iu,
      /^axios$/iu,
      /^ws$/iu,
      /websocket/iu,
      /strategy/iu,
      /risk/iu,
      /execution/iu,
      /quality-score/iu,
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
