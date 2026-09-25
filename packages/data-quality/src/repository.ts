import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, normalize, resolve } from "node:path";

import { dataQualityError, fail, ok } from "./errors.js";
import { stableStringify } from "./serialization.js";
import type {
  DataQualityReport,
  DataQualityReportId,
  DataQualityReportRepository,
  DataQualityResult,
  DataQualityStorageDiagnostics,
} from "./types.js";
import type { HistoricalDatasetId } from "@ate/historical-data";

export class InMemoryDataQualityReportRepository implements DataQualityReportRepository {
  private readonly staged = new Map<DataQualityReportId, DataQualityReport>();
  private readonly published = new Map<DataQualityReportId, DataQualityReport>();

  public async stageReport(report: DataQualityReport): Promise<DataQualityResult<void>> {
    await Promise.resolve();
    this.staged.set(report.reportId, report);
    return ok(undefined);
  }

  public async publishReport(
    reportId: DataQualityReportId,
  ): Promise<DataQualityResult<DataQualityReport>> {
    await Promise.resolve();
    const report = this.staged.get(reportId);
    if (report === undefined) {
      return fail(notFound(reportId));
    }
    this.published.set(reportId, report);
    this.staged.delete(reportId);
    return ok(report);
  }

  public async getReport(
    reportId: DataQualityReportId,
  ): Promise<DataQualityResult<DataQualityReport>> {
    await Promise.resolve();
    const report = this.published.get(reportId);
    return report === undefined ? fail(notFound(reportId)) : ok(report);
  }

  public async findByDataset(
    datasetId: HistoricalDatasetId,
    limit: number,
  ): Promise<DataQualityResult<readonly DataQualityReport[]>> {
    await Promise.resolve();
    if (!Number.isInteger(limit) || limit <= 0 || limit > 1000) {
      return fail(
        dataQualityError({
          code: "DATA_QUALITY_RESOURCE_LIMIT_EXCEEDED",
          message: "data quality report lookup limit must be between 1 and 1000",
          timestamp: new Date(0).toISOString() as never,
        }),
      );
    }
    return ok(
      [...this.published.values()]
        .filter((report) => report.datasetId === datasetId)
        .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
        .slice(0, limit),
    );
  }

  public async diagnostics(): Promise<DataQualityResult<DataQualityStorageDiagnostics>> {
    await Promise.resolve();
    return ok({
      stagedReportCount: this.staged.size,
      publishedReportCount: this.published.size,
      orphanedStagingCount: 0,
    });
  }
}

export class LocalFilesystemDataQualityReportRepository implements DataQualityReportRepository {
  public constructor(private readonly root: string) {}

  public async stageReport(report: DataQualityReport): Promise<DataQualityResult<void>> {
    const staging = safeJoin(resolve(this.root), "staging", report.reportId);
    if (!staging.ok) {
      return staging;
    }
    await mkdir(staging.value, { recursive: true });
    await writeFile(join(staging.value, "report.json"), stableStringify(report));
    return ok(undefined);
  }

  public async publishReport(
    reportId: DataQualityReportId,
  ): Promise<DataQualityResult<DataQualityReport>> {
    const root = resolve(this.root);
    const staging = safeJoin(root, "staging", reportId);
    const published = safeJoin(root, "published", reportId);
    if (!staging.ok) {
      return staging;
    }
    if (!published.ok) {
      return published;
    }
    await mkdir(join(root, "published"), { recursive: true });
    await rm(published.value, { recursive: true, force: true });
    await rename(staging.value, published.value);
    return this.getReport(reportId);
  }

  public async getReport(
    reportId: DataQualityReportId,
  ): Promise<DataQualityResult<DataQualityReport>> {
    const path = safeJoin(resolve(this.root), "published", reportId, "report.json");
    if (!path.ok) {
      return path;
    }
    try {
      return ok(JSON.parse(await readFile(path.value, "utf8")) as DataQualityReport);
    } catch {
      return fail(notFound(reportId));
    }
  }

  public async findByDataset(
    datasetId: HistoricalDatasetId,
    limit: number,
  ): Promise<DataQualityResult<readonly DataQualityReport[]>> {
    if (!Number.isInteger(limit) || limit <= 0 || limit > 1000) {
      return fail(
        dataQualityError({
          code: "DATA_QUALITY_RESOURCE_LIMIT_EXCEEDED",
          message: "data quality report lookup limit must be between 1 and 1000",
          timestamp: new Date(0).toISOString() as never,
        }),
      );
    }
    const root = safeJoin(resolve(this.root), "published");
    if (!root.ok) {
      return root;
    }
    try {
      const entries = await import("node:fs/promises").then((fs) =>
        fs.readdir(root.value, { withFileTypes: true }),
      );
      const reports = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => this.getReport(entry.name as DataQualityReportId)),
      );
      return ok(
        reports
          .filter(
            (result): result is Readonly<{ ok: true; value: DataQualityReport }> =>
              result.ok && result.value.datasetId === datasetId,
          )
          .map((result) => result.value)
          .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
          .slice(0, limit),
      );
    } catch {
      return ok([]);
    }
  }

  public async diagnostics(): Promise<DataQualityResult<DataQualityStorageDiagnostics>> {
    await Promise.resolve();
    return ok({
      stagedReportCount: 0,
      publishedReportCount: 0,
      storageRoot: this.root,
      orphanedStagingCount: 0,
    });
  }
}

const safeJoin = (root: string, ...segments: readonly string[]): DataQualityResult<string> => {
  const candidate = normalize(join(root, ...segments));
  if (!candidate.startsWith(root)) {
    return fail(
      dataQualityError({
        code: "DATA_QUALITY_PUBLICATION_FAILED",
        message: "data quality storage path escapes configured root",
        timestamp: new Date(0).toISOString() as never,
      }),
    );
  }
  return ok(candidate);
};

const notFound = (reportId: DataQualityReportId) =>
  dataQualityError({
    code: "DATA_QUALITY_REPORT_NOT_FOUND",
    message: "data quality report was not found",
    timestamp: new Date(0).toISOString() as never,
    details: { reportId },
  });
