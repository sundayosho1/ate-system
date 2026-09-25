import { fail, historicalError, ok } from "./errors.js";
import { inspectRecords } from "./schema-inspector.js";
import type {
  HistoricalDataParser,
  HistoricalFormat,
  HistoricalResourceLimits,
  HistoricalResult,
  HistoricalSourceArtifact,
  ParsedHistoricalRecord,
} from "./types.js";

export const createJsonAdapter = (): HistoricalDataParser => createJsonLikeAdapter("JSON");
export const createNdjsonAdapter = (): HistoricalDataParser => createJsonLikeAdapter("NDJSON");

const createJsonLikeAdapter = (format: HistoricalFormat): HistoricalDataParser => ({
  format,
  inspect: (content, artifact, limits, clock) => {
    const parsed =
      format === "JSON"
        ? parseJson(content, artifact, limits, limits.maxPreviewRecords)
        : parseNdjson(content, artifact, limits, limits.maxPreviewRecords);
    if (!parsed.ok) {
      return parsed;
    }
    return ok(inspectRecords({ format, records: parsed.value, inspectedAt: clock.now() }));
  },
  parse: async function* parse(content, artifact, limits) {
    await Promise.resolve();
    const parsed =
      format === "JSON"
        ? parseJson(content, artifact, limits)
        : parseNdjson(content, artifact, limits);
    if (!parsed.ok) {
      yield parsed;
      return;
    }
    for (const record of parsed.value) {
      yield ok(record);
    }
  },
});

const parseJson = (
  content: Uint8Array,
  artifact: HistoricalSourceArtifact,
  limits: HistoricalResourceLimits,
  maxRecords = limits.maxJsonArrayRecords,
): HistoricalResult<readonly ParsedHistoricalRecord[]> => {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(content);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return jsonFailure("HISTORICAL_RECORD_PARSE_FAILED", "JSON parse failed", artifact, {
      safeMessage: error instanceof Error ? error.message : String(error),
    });
  }
  if (jsonDepth(value) > limits.maxJsonDepth) {
    return jsonFailure(
      "HISTORICAL_RESOURCE_LIMIT_EXCEEDED",
      "JSON exceeds configured nesting depth",
      artifact,
    );
  }
  const rows = Array.isArray(value) ? value : [value];
  if (rows.length > maxRecords) {
    return jsonFailure(
      "HISTORICAL_RESOURCE_LIMIT_EXCEEDED",
      "JSON exceeds configured record count",
      artifact,
    );
  }
  return ok(
    rows.map((row, index) => {
      if (!isRecord(row)) {
        return {
          location: { kind: "JSON_INDEX" as const, recordIndex: index, jsonPath: `$[${index}]` },
          values: { value: JSON.stringify(row).slice(0, limits.maxFieldBytes) },
          sourceOrder: index,
        };
      }
      return {
        location: { kind: "JSON_INDEX" as const, recordIndex: index, jsonPath: `$[${index}]` },
        values: row,
        sourceOrder: index,
      };
    }),
  );
};

const parseNdjson = (
  content: Uint8Array,
  artifact: HistoricalSourceArtifact,
  limits: HistoricalResourceLimits,
  maxRecords = limits.maxRecords,
): HistoricalResult<readonly ParsedHistoricalRecord[]> => {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(content);
  const records: ParsedHistoricalRecord[] = [];
  const lines = text.split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) {
      continue;
    }
    if (line.length > limits.maxRowBytes) {
      return jsonFailure(
        "HISTORICAL_RESOURCE_LIMIT_EXCEEDED",
        "NDJSON line exceeds configured row limit",
        artifact,
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      return jsonFailure("HISTORICAL_RECORD_PARSE_FAILED", "NDJSON line parse failed", artifact, {
        lineNumber: index + 1,
        safeMessage: error instanceof Error ? error.message : String(error),
      });
    }
    if (!isRecord(value)) {
      return jsonFailure(
        "HISTORICAL_RECORD_PARSE_FAILED",
        "NDJSON line must contain one object record",
        artifact,
        {
          lineNumber: index + 1,
        },
      );
    }
    records.push({
      location: { kind: "NDJSON_LINE", lineNumber: index + 1 },
      values: value,
      sourceOrder: records.length,
    });
    if (records.length > maxRecords) {
      return jsonFailure(
        "HISTORICAL_RESOURCE_LIMIT_EXCEEDED",
        "NDJSON exceeds configured record count",
        artifact,
      );
    }
  }
  return ok(records);
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const jsonDepth = (value: unknown): number => {
  if (Array.isArray(value)) {
    return 1 + Math.max(0, ...value.map((item) => jsonDepth(item)));
  }
  if (isRecord(value)) {
    return 1 + Math.max(0, ...Object.values(value).map((item) => jsonDepth(item)));
  }
  return 0;
};

const jsonFailure = (
  code: "HISTORICAL_RECORD_PARSE_FAILED" | "HISTORICAL_RESOURCE_LIMIT_EXCEEDED",
  message: string,
  artifact: HistoricalSourceArtifact,
  details?: Record<string, unknown>,
): HistoricalResult<never> =>
  fail(
    historicalError({
      code,
      message,
      timestamp: artifact.importedAt,
      details: { artifactId: artifact.artifactId, ...(details ?? {}) },
    }),
  );
