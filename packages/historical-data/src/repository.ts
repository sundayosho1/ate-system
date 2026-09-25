import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, normalize, resolve } from "node:path";

import { fail, historicalError, ok } from "./errors.js";
import { canonicalObservationOrder } from "./dataset.js";
import { fingerprint, stableStringify } from "./serialization.js";
import type {
  HistoricalDataset,
  HistoricalDatasetId,
  HistoricalDatasetManifest,
  HistoricalDatasetRepository,
  HistoricalQuery,
  HistoricalQueryPage,
  HistoricalResult,
  HistoricalStorageDiagnostics,
} from "./types.js";

export class InMemoryHistoricalDatasetRepository implements HistoricalDatasetRepository {
  private readonly staged = new Map<HistoricalDatasetId, HistoricalDataset>();
  private readonly published = new Map<HistoricalDatasetId, HistoricalDataset>();
  private quarantinedRecordCount = 0;

  public async stageDataset(dataset: HistoricalDataset): Promise<HistoricalResult<void>> {
    await Promise.resolve();
    this.staged.set(dataset.manifest.datasetId, dataset);
    return ok(undefined);
  }

  public async publishDataset(
    datasetId: HistoricalDatasetId,
  ): Promise<HistoricalResult<HistoricalDatasetManifest>> {
    await Promise.resolve();
    const dataset = this.staged.get(datasetId);
    if (dataset === undefined) {
      return fail(notFound(datasetId));
    }
    this.published.set(datasetId, dataset);
    this.staged.delete(datasetId);
    return ok(dataset.manifest);
  }

  public async getManifest(
    datasetId: HistoricalDatasetId,
  ): Promise<HistoricalResult<HistoricalDatasetManifest>> {
    await Promise.resolve();
    const dataset = this.published.get(datasetId);
    return dataset === undefined ? fail(notFound(datasetId)) : ok(dataset.manifest);
  }

  public async query(query: HistoricalQuery): Promise<HistoricalResult<HistoricalQueryPage>> {
    await Promise.resolve();
    const valid = validateQuery(query);
    if (!valid.ok) {
      return valid;
    }
    const dataset = this.published.get(query.datasetId);
    if (dataset === undefined) {
      return fail(notFound(query.datasetId));
    }
    return ok(pageDataset(dataset, query));
  }

  public async quarantine(records: readonly unknown[]): Promise<HistoricalResult<void>> {
    await Promise.resolve();
    this.quarantinedRecordCount += records.length;
    return ok(undefined);
  }

  public async diagnostics(): Promise<HistoricalResult<HistoricalStorageDiagnostics>> {
    await Promise.resolve();
    return ok({
      stagedDatasetCount: this.staged.size,
      publishedDatasetCount: this.published.size,
      quarantinedRecordCount: this.quarantinedRecordCount,
      orphanedStagingCount: 0,
    });
  }
}

export class LocalFilesystemHistoricalDatasetRepository implements HistoricalDatasetRepository {
  public constructor(private readonly root: string) {}

  public async stageDataset(dataset: HistoricalDataset): Promise<HistoricalResult<void>> {
    const safeRoot = resolve(this.root);
    const staging = safeJoin(safeRoot, "staging", dataset.manifest.datasetId);
    if (!staging.ok) {
      return staging;
    }
    await mkdir(staging.value, { recursive: true });
    await writeFile(join(staging.value, "manifest.json"), stableStringify(dataset.manifest));
    await writeFile(
      join(staging.value, "observations.jsonl"),
      dataset.observations.map((observation) => stableStringify(observation)).join("\n"),
    );
    await writeFile(
      join(staging.value, "rejections.jsonl"),
      dataset.rejections.map((rejection) => stableStringify(rejection)).join("\n"),
    );
    return ok(undefined);
  }

  public async publishDataset(
    datasetId: HistoricalDatasetId,
  ): Promise<HistoricalResult<HistoricalDatasetManifest>> {
    const safeRoot = resolve(this.root);
    const staging = safeJoin(safeRoot, "staging", datasetId);
    const published = safeJoin(safeRoot, "published", datasetId);
    if (!staging.ok) {
      return staging;
    }
    if (!published.ok) {
      return published;
    }
    await mkdir(join(safeRoot, "published"), { recursive: true });
    await rename(staging.value, published.value);
    return this.getManifest(datasetId);
  }

  public async getManifest(
    datasetId: HistoricalDatasetId,
  ): Promise<HistoricalResult<HistoricalDatasetManifest>> {
    const path = safeJoin(resolve(this.root), "published", datasetId, "manifest.json");
    if (!path.ok) {
      return path;
    }
    try {
      return ok(JSON.parse(await readFile(path.value, "utf8")) as HistoricalDatasetManifest);
    } catch {
      return fail(notFound(datasetId));
    }
  }

  public async query(query: HistoricalQuery): Promise<HistoricalResult<HistoricalQueryPage>> {
    const valid = validateQuery(query);
    if (!valid.ok) {
      return valid;
    }
    const dataset = await this.readDataset(query.datasetId);
    if (!dataset.ok) {
      return dataset;
    }
    return ok(pageDataset(dataset.value, query));
  }

  public async quarantine(records: readonly unknown[]): Promise<HistoricalResult<void>> {
    const root = resolve(this.root);
    const quarantineDir = safeJoin(root, "quarantine");
    if (!quarantineDir.ok) {
      return quarantineDir;
    }
    await mkdir(quarantineDir.value, { recursive: true });
    await writeFile(
      join(
        quarantineDir.value,
        `${fingerprint(records).replace("sha256:", "").slice(0, 24)}-${records.length}.jsonl`,
      ),
      records.map(stableStringify).join("\n"),
    );
    return ok(undefined);
  }

  public async diagnostics(): Promise<HistoricalResult<HistoricalStorageDiagnostics>> {
    await Promise.resolve();
    return ok({
      stagedDatasetCount: 0,
      publishedDatasetCount: 0,
      quarantinedRecordCount: 0,
      storageRoot: this.root,
      orphanedStagingCount: 0,
    });
  }

  public async cleanupStaging(datasetId: HistoricalDatasetId): Promise<void> {
    const path = safeJoin(resolve(this.root), "staging", datasetId);
    if (path.ok) {
      await rm(path.value, { recursive: true, force: true });
    }
  }

  private async readDataset(
    datasetId: HistoricalDatasetId,
  ): Promise<HistoricalResult<HistoricalDataset>> {
    const root = safeJoin(resolve(this.root), "published", datasetId);
    if (!root.ok) {
      return root;
    }
    try {
      const manifest = JSON.parse(
        await readFile(join(root.value, "manifest.json"), "utf8"),
      ) as HistoricalDatasetManifest;
      const observationsText = await readFile(join(root.value, "observations.jsonl"), "utf8");
      return ok({
        manifest,
        observations: observationsText
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as HistoricalDataset["observations"][number]),
        rejections: [],
        duplicateEvidence: [],
      });
    } catch {
      return fail(notFound(datasetId));
    }
  }
}

const pageDataset = (dataset: HistoricalDataset, query: HistoricalQuery): HistoricalQueryPage => {
  const offset = query.cursor === undefined ? 0 : Number(query.cursor);
  const observations = dataset.observations
    .filter(
      (observation) =>
        (query.instrumentId === undefined || observation.instrumentId === query.instrumentId) &&
        (query.observationKind === undefined ||
          observation.observationKind === query.observationKind) &&
        (query.startInclusive === undefined || observation.eventTime >= query.startInclusive) &&
        (query.endExclusive === undefined || observation.eventTime < query.endExclusive) &&
        (query.sourceId === undefined || observation.source.sourceId === query.sourceId),
    )
    .sort(canonicalObservationOrder);
  const page = observations.slice(offset, offset + query.limit);
  return {
    observations: page,
    ...(offset + query.limit >= observations.length
      ? {}
      : { nextCursor: String(offset + query.limit) }),
  };
};

const validateQuery = (query: HistoricalQuery): HistoricalResult<void> => {
  if (!Number.isInteger(query.limit) || query.limit <= 0 || query.limit > 5000) {
    return fail(
      historicalError({
        code: "HISTORICAL_QUERY_LIMIT_EXCEEDED",
        message: "historical query limit must be between 1 and 5000",
        timestamp: new Date(0).toISOString() as never,
      }),
    );
  }
  if (
    query.startInclusive !== undefined &&
    query.endExclusive !== undefined &&
    query.startInclusive >= query.endExclusive
  ) {
    return fail(
      historicalError({
        code: "HISTORICAL_QUERY_INVALID",
        message: "historical query range must be [startInclusive, endExclusive)",
        timestamp: new Date(0).toISOString() as never,
      }),
    );
  }
  return ok(undefined);
};

const safeJoin = (root: string, ...segments: readonly string[]): HistoricalResult<string> => {
  const candidate = normalize(join(root, ...segments));
  if (!candidate.startsWith(root)) {
    return fail(
      historicalError({
        code: "HISTORICAL_PATH_INVALID",
        message: "historical storage path escapes configured root",
        timestamp: new Date(0).toISOString() as never,
      }),
    );
  }
  return ok(candidate);
};

const notFound = (datasetId: HistoricalDatasetId) =>
  historicalError({
    code: "HISTORICAL_DATASET_NOT_FOUND",
    message: "historical dataset was not found",
    timestamp: new Date(0).toISOString() as never,
    details: { datasetId },
  });
