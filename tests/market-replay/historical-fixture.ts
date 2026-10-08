import { VirtualClock } from "@ate/time";
import {
  createCsvAdapter,
  HistoricalImportService,
  InMemoryHistoricalDatasetRepository,
  type HistoricalDataMappingSpecification,
} from "@ate/historical-data";
import {
  DataQualityEngine,
  InMemoryDataQualityReportRepository,
  createDefaultDataQualityProfile,
} from "@ate/data-quality";
import {
  DefaultDatasetCatalogueService,
  InMemoryDatasetCatalogueRepository,
} from "@ate/dataset-catalogue";
import { CalendarBoundaryResolver, utcCalendar } from "@ate/multitimeframe";
import { defaultReplayLimits, type HistoricalReplaySourceOptions } from "@ate/market-replay";
import { schemas } from "@ate/domain";
import { stream, t } from "./fixtures.js";
import { unwrap } from "./integration-fixtures.js";
export async function historicalFixture(
  settings: { stream?: typeof stream; at?: string; rows?: string } = {},
) {
  const selectedStream = settings.stream ?? stream;
  const clock = new VirtualClock(t(settings.at ?? "10:03:00"));
  const source = {
    sourceId: schemas.sourceId.parse(selectedStream.sourceId),
    sourceType: "DATA_VENDOR" as const,
    name: "Offline historical provider",
  };
  const mapping: HistoricalDataMappingSpecification = {
    mappingId: "replay.quote.csv",
    version: "1.0.0",
    targetKind: "QUOTE",
    source,
    instrument: {
      kind: "FIXED",
      instrumentId: schemas.instrumentId.parse(selectedStream.instrumentId),
    },
    providerSymbol: { kind: "FIELD", field: "symbol" },
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
  const repository = new InMemoryHistoricalDatasetRepository();
  const importer = new HistoricalImportService({
    clock,
    repository,
    parsers: [createCsvAdapter()],
  });
  const imported = unwrap(
    await importer.importHistoricalData({
      fileName: "offline.csv",
      content: new TextEncoder().encode(
        "event_time,symbol,bid,ask\n" +
          (settings.rows ??
            "2026-10-08T10:00:00.000Z,TEST,1,1\n2026-10-08T10:01:00.000Z,TEST,2,1\n2026-10-08T10:02:00.000Z,TEST,3,3"),
      ),
      source,
      mapping,
      actor: { actorType: "SYSTEM" },
    }),
  );
  if (!imported.outputDatasetId) throw Error("IMPORT_FAILED");
  const datasetId = imported.outputDatasetId;
  const qualityRepository = new InMemoryDataQualityReportRepository();
  const report = unwrap(
    await new DataQualityEngine({
      clock,
      historicalRepository: repository,
      reportRepository: qualityRepository,
    }).analyzeDataset({
      datasetId,
      profile: createDefaultDataQualityProfile(),
      runtimeMode: "RESEARCH",
      actor: { actorType: "SYSTEM" },
      asOf: clock.now(),
    }),
  );
  const catalogueRepository = new InMemoryDatasetCatalogueRepository();
  const catalogueService = new DefaultDatasetCatalogueService({
    clock,
    repository: catalogueRepository,
    historicalRepository: repository,
    qualityRepository,
    requireVerifiedIntegrity: true,
    requireQualityForQualification: false,
  });
  const registration = unwrap(
    await catalogueService.registerDataset({
      historicalDatasetId: datasetId,
      qualityReportIds: [report.reportId],
      intendedUses: ["RESEARCH_EXPLORATION"],
      setActive: true,
      reason: "replay owner fixture",
      actor: { actorType: "SYSTEM" },
      runtimeMode: "RESEARCH",
    }),
  );
  const options: HistoricalReplaySourceOptions = {
    manifestId: "historical-owner",
    repository,
    datasetId,
    stream: selectedStream,
    calendarFingerprint: new CalendarBoundaryResolver(utcCalendar).fingerprint,
    limits: { ...defaultReplayLimits, maxEventsPerBatch: 1 },
    quality: {
      repository: qualityRepository,
      reportId: report.reportId,
      expectedFingerprint: report.reportFingerprint,
    },
    catalogue: {
      repository: catalogueRepository,
      versionId: registration.entry.version.versionId,
      expectedVersionFingerprint: registration.entry.version.versionFingerprint,
    },
  };
  return {
    options,
    repository,
    qualityRepository,
    catalogueRepository,
    report,
    registration,
    clock,
  };
}
