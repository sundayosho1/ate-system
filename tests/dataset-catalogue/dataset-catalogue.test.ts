import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createDefaultDataQualityProfile,
  DataQualityEngine,
  InMemoryDataQualityReportRepository,
} from "@ate/data-quality";
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
  datasetCatalogueEventRegistrations,
  DatasetCatalogueRuntimeService,
  DefaultDatasetCatalogueService,
  InMemoryDatasetCatalogueRepository,
  LocalFilesystemDatasetCatalogueRepository,
  type DatasetFamilyId,
  type DatasetVersionId,
} from "@ate/dataset-catalogue";
import {
  foundationalCapabilityDefinitions,
  foundationalConfigurationDefinitions,
  foundationalConfigurationSchemas,
} from "@ate/configuration";

const now = "2026-09-25T12:00:00.000Z" as UtcTimestamp;
const instrumentId = "50000000-0000-4000-8000-000000000001" as InstrumentId;
const sourceId = "50000000-0000-4000-8000-000000000002" as SourceId;
const actor: Actor = { actorType: "SYSTEM" };
const runtimeInstanceId = "dataset-catalogue-runtime" as RuntimeInstanceId;

const clock: Clock = {
  mode: "VIRTUAL",
  provenance: { source: "TEST", clockId: "dataset-catalogue-test-clock", quality: "SYNCHRONIZED" },
  now: () => now,
};

const source = {
  sourceId,
  sourceType: "DATA_VENDOR",
  name: "Catalogue Fixture Vendor",
  provider: "FixtureProvider",
  role: "HISTORICAL",
} as const;

const quoteMapping: HistoricalDataMappingSpecification = {
  mappingId: "catalogue.quote.csv",
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

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

const createHistoricalDataset = async (rows: readonly string[]) => {
  const historicalRepository = new InMemoryHistoricalDatasetRepository();
  const importService = new HistoricalImportService({
    clock,
    repository: historicalRepository,
    parsers: [createCsvAdapter()],
  });
  const imported = await importService.importHistoricalData({
    fileName: "quotes.csv",
    content: encode(["event_time,symbol,bid,ask", ...rows].join("\n")),
    source,
    mapping: quoteMapping,
    actor,
  });
  expect(imported.ok).toBe(true);
  if (!imported.ok || imported.value.outputDatasetId === undefined) {
    throw new Error("historical import failed");
  }
  return { historicalRepository, datasetId: imported.value.outputDatasetId };
};

const createQualityReport = async (
  historicalRepository: InMemoryHistoricalDatasetRepository,
  datasetId: HistoricalDatasetId,
) => {
  const qualityRepository = new InMemoryDataQualityReportRepository();
  const engine = new DataQualityEngine({
    clock,
    historicalRepository,
    reportRepository: qualityRepository,
  });
  const report = await engine.analyzeDataset({
    datasetId,
    profile: createDefaultDataQualityProfile(),
    runtimeMode: "RESEARCH",
    actor,
    asOf: now,
  });
  expect(report.ok).toBe(true);
  if (!report.ok) throw new Error(report.error.message);
  return { qualityRepository, report: report.value };
};

const createCatalogueService = (
  historicalRepository: InMemoryHistoricalDatasetRepository,
  qualityRepository = new InMemoryDataQualityReportRepository(),
) => {
  const catalogueRepository = new InMemoryDatasetCatalogueRepository();
  const service = new DefaultDatasetCatalogueService({
    clock,
    repository: catalogueRepository,
    historicalRepository,
    qualityRepository,
    requireVerifiedIntegrity: true,
    requireQualityForQualification: false,
  });
  return { catalogueRepository, service };
};

describe("Prompt 16 dataset catalogue and lineage", () => {
  it("registers Prompt 14 datasets with distinct family/version/content identities and Prompt 15 quality references", async () => {
    const { historicalRepository, datasetId } = await createHistoricalDataset([
      "2026-09-25T11:58:00.000Z,EURUSD.raw,1.1000,1.1002",
      "2026-09-25T11:59:00.000Z,EURUSD.raw,1.1001,1.1003",
    ]);
    const { qualityRepository, report } = await createQualityReport(
      historicalRepository,
      datasetId,
    );
    const { service } = createCatalogueService(historicalRepository, qualityRepository);

    const registered = await service.registerDataset({
      historicalDatasetId: datasetId,
      qualityReportIds: [report.reportId],
      intendedUses: ["RESEARCH_EXPLORATION"],
      setActive: true,
      reason: "initial governed registration",
      actor,
      runtimeMode: "RESEARCH",
    });

    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    const entry = registered.value.entry;
    expect(entry.family.familyId).toMatch(/^dsf-/u);
    expect(entry.version.versionId).toMatch(/^dsv-/u);
    expect(entry.version.versionId).not.toBe(entry.version.content.contentFingerprint);
    expect(entry.version.content.historicalDatasetId).toBe(datasetId);
    expect(entry.version.qualityReferences[0]?.reportId).toBe(report.reportId);
    expect(entry.version.integrity.status).toBe("VERIFIED");
    expect(entry.version.lifecycleState).toBe("ACTIVE");
    expect(entry.version.eligibility[0]?.status).toMatch(/ELIGIBLE/u);
    expect(entry.version.registrationFingerprint).toMatch(/^sha256:/u);
    expect(entry.version.versionFingerprint).toMatch(/^sha256:/u);
    expect(entry.version.catalogueStateFingerprint).toMatch(/^sha256:/u);
  });

  it("is idempotent for equivalent registration and rejects mismatched quality report references", async () => {
    const first = await createHistoricalDataset([
      "2026-09-25T11:58:00.000Z,EURUSD.raw,1.1000,1.1002",
    ]);
    const second = await createHistoricalDataset([
      "2026-09-25T11:58:00.000Z,EURUSD.raw,1.2000,1.2002",
    ]);
    const firstQuality = await createQualityReport(first.historicalRepository, first.datasetId);
    const secondQuality = await createQualityReport(second.historicalRepository, second.datasetId);
    const { service } = createCatalogueService(
      first.historicalRepository,
      firstQuality.qualityRepository,
    );

    const request = {
      historicalDatasetId: first.datasetId,
      qualityReportIds: [firstQuality.report.reportId],
      reason: "idempotent registration",
      actor,
      runtimeMode: "RESEARCH" as const,
    };
    const one = await service.registerDataset(request);
    const two = await service.registerDataset(request);
    expect(one.ok && one.value.idempotent).toBe(false);
    expect(two.ok && two.value.idempotent).toBe(true);

    const mismatchedQuality = await service.registerDataset({
      historicalDatasetId: first.datasetId,
      qualityReportIds: [secondQuality.report.reportId],
      reason: "bad quality link",
      actor,
      runtimeMode: "RESEARCH",
    });
    expect(mismatchedQuality.ok).toBe(false);
  });

  it("supports parent/child lineage, ancestry, descendants, root sources and impact analysis", async () => {
    const { historicalRepository, datasetId } = await createHistoricalDataset([
      "2026-09-25T11:58:00.000Z,EURUSD.raw,1.1000,1.1002",
    ]);
    const { service } = createCatalogueService(historicalRepository);
    const root = await service.registerDataset({
      historicalDatasetId: datasetId,
      reason: "root import",
      actor,
      runtimeMode: "RESEARCH",
    });
    expect(root.ok).toBe(true);
    if (!root.ok) return;
    const child = await service.registerDataset({
      historicalDatasetId: datasetId,
      parentDatasetVersionIds: [root.value.entry.version.versionId],
      metadata: { derivation: "quality gated selection" },
      reason: "derived registration",
      actor,
      runtimeMode: "RESEARCH",
    });
    expect(child.ok).toBe(true);
    if (!child.ok) return;

    const lineage = await service.explainLineage(child.value.entry.version.versionId);
    expect(lineage.ok).toBe(true);
    if (lineage.ok) {
      expect(lineage.value.directParents).toEqual([root.value.entry.version.versionId]);
      expect(lineage.value.ancestry.nodes.map((node) => node.versionId)).toContain(
        root.value.entry.version.versionId,
      );
      expect(lineage.value.rootSources.artifactIds).toContain(
        child.value.entry.version.historicalManifest?.artifactId,
      );
    }

    const impact = await service.analyzeDatasetImpact(root.value.entry.version.versionId);
    expect(impact.ok).toBe(true);
    if (impact.ok) {
      expect(impact.value.transitiveDependants).toContain(child.value.entry.version.versionId);
      expect(impact.value.reason).toContain("does not invalidate");
    }
  });

  it("enforces unknown parent rejection, active pointer concurrency and lifecycle evidence", async () => {
    const { historicalRepository, datasetId } = await createHistoricalDataset([
      "2026-09-25T11:58:00.000Z,EURUSD.raw,1.1000,1.1002",
    ]);
    const { service } = createCatalogueService(historicalRepository);
    const unknownParent = await service.registerDataset({
      historicalDatasetId: datasetId,
      parentDatasetVersionIds: ["dsv-missing-parent" as DatasetVersionId],
      reason: "unknown parent",
      actor,
      runtimeMode: "RESEARCH",
    });
    expect(unknownParent.ok).toBe(false);

    const first = await service.registerDataset({
      historicalDatasetId: datasetId,
      family: { familyId: "dsf-active-test" as DatasetFamilyId },
      reason: "first",
      setActive: true,
      actor,
      runtimeMode: "RESEARCH",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const stale = await service.setActiveVersion(
      first.value.entry.family.familyId,
      first.value.entry.version.versionId,
      "dsv-stale" as DatasetVersionId,
    );
    expect(stale.ok).toBe(false);
  });

  it("persists catalogue metadata locally and reports runtime health/readiness", async () => {
    const { historicalRepository, datasetId } = await createHistoricalDataset([
      "2026-09-25T11:58:00.000Z,EURUSD.raw,1.1000,1.1002",
    ]);
    const root = mkdtempSync(join(tmpdir(), "ate-catalogue-"));
    try {
      const repository = new LocalFilesystemDatasetCatalogueRepository(root);
      const service = new DefaultDatasetCatalogueService({
        clock,
        repository,
        historicalRepository,
      });
      const registered = await service.registerDataset({
        historicalDatasetId: datasetId,
        reason: "filesystem registration",
        actor,
        runtimeMode: "RESEARCH",
      });
      expect(registered.ok).toBe(true);
      const reloaded = new LocalFilesystemDatasetCatalogueRepository(root);
      await reloaded.load();
      const fetched = registered.ok
        ? await reloaded.getVersion(registered.value.entry.version.versionId)
        : undefined;
      expect(fetched?.ok).toBe(true);

      const runtime = new DatasetCatalogueRuntimeService({
        runtimeMode: "RESEARCH",
        clock,
        service,
        repository,
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
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("registers configuration, capability and event contracts truthfully", () => {
    const definitions = foundationalConfigurationDefinitions(clock);
    expect(definitions.map((definition) => definition.key)).toEqual(
      expect.arrayContaining([
        "data.catalogue.maxQueryPageSize",
        "data.catalogue.maxLineageDepth",
        "data.catalogue.maxLineageNodes",
        "data.catalogue.maxParentsPerDataset",
        "data.catalogue.requireQualityForQualification",
        "data.catalogue.requireVerifiedIntegrity",
        "data.catalogue.storageRoot",
      ]),
    );
    expect(foundationalConfigurationSchemas(clock).map((schema) => schema.key)).toContain(
      "data.catalogue.maxQueryPageSize",
    );
    const capability = foundationalCapabilityDefinitions().find(
      (definition) => definition.capabilityId === "data.datasetCatalogue",
    );
    expect(capability?.dependencies).toEqual([
      "data.marketDataContracts",
      "data.historicalDataLaboratory",
    ]);
    expect(capability?.safetyNotes).toContain("do not authorize");

    const registry = new EventRegistry({ now: clock.now });
    for (const registration of datasetCatalogueEventRegistrations) {
      expect(registry.register(registration).ok).toBe(true);
    }
  });

  it("does not introduce ingestion, provider, aggregation, replay, strategy, risk, execution or trading dependencies", () => {
    const sourceDir = join(process.cwd(), "packages", "dataset-catalogue", "src");
    const prohibited = [
      /tradingview/iu,
      /metatrader|mt5|mql5/iu,
      /^axios$/iu,
      /^ws$/iu,
      /websocket/iu,
      /strategy/iu,
      /risk/iu,
      /execution-engine/iu,
      /replay-engine/iu,
      /aggregation-engine/iu,
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
      expect(content).not.toMatch(/\bDate\.now\s*\(/u);
    }
  });
});
