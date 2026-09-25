import { parquetMetadata, parquetReadObjects } from "hyparquet";
import type { AsyncBuffer, FileMetaData, ParquetRow } from "hyparquet";

import { fail, historicalError, ok } from "./errors.js";
import { inspectRecords } from "./schema-inspector.js";
import type {
  HistoricalDataParser,
  HistoricalResourceLimits,
  HistoricalResult,
  HistoricalSourceArtifact,
  ParsedHistoricalRecord,
} from "./types.js";

export const createParquetAdapter = (): HistoricalDataParser => ({
  format: "PARQUET",
  inspect: async (content, artifact, limits, clock) => {
    const metadata = await readMetadata(content, artifact);
    if (!metadata.ok) {
      return metadata;
    }
    const rows = await readRows(
      content,
      artifact,
      limits,
      limits.maxPreviewRecords,
      metadata.value,
    );
    if (!rows.ok) {
      return rows;
    }
    return ok(inspectRecords({ format: "PARQUET", records: rows.value, inspectedAt: clock.now() }));
  },
  parse: async function* parse(content, artifact, limits) {
    const metadata = await readMetadata(content, artifact);
    if (!metadata.ok) {
      yield metadata;
      return;
    }
    const rows = await readRows(content, artifact, limits, limits.maxRecords, metadata.value);
    if (!rows.ok) {
      yield rows;
      return;
    }
    for (const row of rows.value) {
      yield ok(row);
    }
  },
});

const readMetadata = async (
  content: Uint8Array,
  artifact: HistoricalSourceArtifact,
): Promise<HistoricalResult<FileMetaData>> => {
  await Promise.resolve();
  try {
    return ok(parquetMetadata(toArrayBuffer(content)));
  } catch (error) {
    return fail(
      historicalError({
        code: "HISTORICAL_SCHEMA_UNSUPPORTED",
        message: "Parquet metadata inspection failed",
        timestamp: artifact.importedAt,
        details: { artifactId: artifact.artifactId, safeMessage: safeMessage(error) },
      }),
    );
  }
};

const readRows = async (
  content: Uint8Array,
  artifact: HistoricalSourceArtifact,
  limits: HistoricalResourceLimits,
  maxRows: number,
  metadata: FileMetaData,
): Promise<HistoricalResult<readonly ParsedHistoricalRecord[]>> => {
  try {
    const rows = await parquetReadObjects({
      file: bufferFromBytes(content),
      metadata,
      rowFormat: "object",
      includeRowIndex: true,
      rowStart: 0,
      rowEnd: Math.min(Number(metadata.num_rows ?? BigInt(maxRows)), maxRows),
    });
    if (rows.length > limits.maxRecords) {
      return fail(
        historicalError({
          code: "HISTORICAL_RESOURCE_LIMIT_EXCEEDED",
          message: "Parquet row count exceeds configured limit",
          timestamp: artifact.importedAt,
        }),
      );
    }
    return ok(
      rows.map((row: ParquetRow, index: number) => ({
        location: { kind: "PARQUET_ROW" as const, recordIndex: index },
        values: Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            typeof value === "bigint" ? value.toString() : value,
          ]),
        ),
        sourceOrder: index,
      })),
    );
  } catch (error) {
    return fail(
      historicalError({
        code: "HISTORICAL_RECORD_PARSE_FAILED",
        message: "Parquet row parsing failed",
        timestamp: artifact.importedAt,
        details: { artifactId: artifact.artifactId, safeMessage: safeMessage(error) },
      }),
    );
  }
};

const bufferFromBytes = (content: Uint8Array): AsyncBuffer => ({
  byteLength: content.byteLength,
  slice: (start: number, end?: number) => {
    const sliced = content.slice(start, end);
    return Promise.resolve(
      sliced.buffer.slice(sliced.byteOffset, sliced.byteOffset + sliced.byteLength),
    );
  },
});

const toArrayBuffer = (content: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(content.byteLength);
  copy.set(content);
  return copy.buffer;
};

const safeMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
