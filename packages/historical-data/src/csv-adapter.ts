import { fail, historicalError, ok } from "./errors.js";
import type {
  HistoricalDataParser,
  HistoricalResourceLimits,
  HistoricalResult,
  HistoricalSourceArtifact,
  ParsedHistoricalRecord,
} from "./types.js";
import { inspectRecords } from "./schema-inspector.js";

export type CsvAdapterOptions = Readonly<{
  delimiter?: "," | ";" | "\t";
  quote?: '"';
  hasHeader?: boolean;
  header?: readonly string[];
}>;

export const createCsvAdapter = (options: CsvAdapterOptions = {}): HistoricalDataParser => ({
  format: "CSV",
  inspect: (content, artifact, limits, clock) => {
    const parsed = parseCsv(content, artifact, limits, options, limits.maxPreviewRecords);
    if (!parsed.ok) {
      return parsed;
    }
    return ok(
      inspectRecords({
        format: "CSV",
        records: parsed.value.records,
        inspectedAt: clock.now(),
      }),
    );
  },
  parse: async function* parse(content, artifact, limits) {
    await Promise.resolve();
    const parsed = parseCsv(content, artifact, limits, options);
    if (!parsed.ok) {
      yield parsed;
      return;
    }
    for (const record of parsed.value.records) {
      yield ok(record);
    }
  },
});

const parseCsv = (
  content: Uint8Array,
  artifact: HistoricalSourceArtifact,
  limits: HistoricalResourceLimits,
  options: CsvAdapterOptions,
  maxRows = limits.maxRecords,
): HistoricalResult<Readonly<{ records: readonly ParsedHistoricalRecord[] }>> => {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(content);
  const rows: string[][] = [];
  let currentField = "";
  let currentRow: string[] = [];
  let inQuotes = false;
  let rowStartIndex = 0;
  const delimiter = options.delimiter ?? ",";
  const quote = options.quote ?? '"';

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === quote) {
      if (inQuotes && text[index + 1] === quote) {
        currentField += quote;
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      pushField(currentRow, currentField, limits, artifact);
      currentField = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      pushField(currentRow, currentField, limits, artifact);
      currentField = "";
      if (text.slice(rowStartIndex, index).length > limits.maxRowBytes) {
        return csvFailure(
          "HISTORICAL_RESOURCE_LIMIT_EXCEEDED",
          "CSV row exceeds configured limit",
          artifact,
        );
      }
      rows.push(currentRow);
      currentRow = [];
      rowStartIndex = index + 1;
      if (rows.length > maxRows + 1) {
        break;
      }
    } else {
      currentField += char ?? "";
      if (currentField.length > limits.maxFieldBytes) {
        return csvFailure(
          "HISTORICAL_RESOURCE_LIMIT_EXCEEDED",
          "CSV field exceeds configured limit",
          artifact,
        );
      }
    }
  }

  if (inQuotes) {
    return csvFailure(
      "HISTORICAL_RECORD_PARSE_FAILED",
      "CSV contains an unterminated quoted field",
      artifact,
    );
  }
  if (currentField.length > 0 || currentRow.length > 0) {
    pushField(currentRow, currentField, limits, artifact);
    rows.push(currentRow);
  }

  const nonEmptyRows = rows.filter((row) => row.some((field) => field.length > 0));
  if (nonEmptyRows.length === 0) {
    return csvFailure("HISTORICAL_RECORD_PARSE_FAILED", "CSV has no records", artifact);
  }

  const hasHeader = options.hasHeader ?? true;
  const header = hasHeader ? nonEmptyRows[0] : options.header;
  if (header === undefined) {
    return csvFailure(
      "HISTORICAL_MAPPING_INVALID",
      "headerless CSV requires explicit header fields",
      artifact,
    );
  }
  if (header.length > limits.maxColumns) {
    return csvFailure(
      "HISTORICAL_RESOURCE_LIMIT_EXCEEDED",
      "CSV exceeds configured column limit",
      artifact,
    );
  }

  const dataRows = hasHeader ? nonEmptyRows.slice(1) : nonEmptyRows;
  const records = dataRows.slice(0, maxRows).map((row, rowIndex) => ({
    location: { kind: "CSV_ROW" as const, rowNumber: rowIndex + (hasHeader ? 2 : 1) },
    values: Object.fromEntries(header.map((field, index) => [field, row[index] ?? ""])),
    sourceOrder: rowIndex,
  }));

  return ok({ records });
};

const pushField = (
  row: string[],
  field: string,
  limits: HistoricalResourceLimits,
  artifact: HistoricalSourceArtifact,
): HistoricalResult<void> => {
  if (field.length > limits.maxFieldBytes) {
    return csvFailure(
      "HISTORICAL_RESOURCE_LIMIT_EXCEEDED",
      "CSV field exceeds configured limit",
      artifact,
    );
  }
  row.push(field);
  if (row.length > limits.maxColumns) {
    return csvFailure(
      "HISTORICAL_RESOURCE_LIMIT_EXCEEDED",
      "CSV exceeds configured column limit",
      artifact,
    );
  }
  return ok(undefined);
};

const csvFailure = (
  code:
    | "HISTORICAL_RECORD_PARSE_FAILED"
    | "HISTORICAL_RESOURCE_LIMIT_EXCEEDED"
    | "HISTORICAL_MAPPING_INVALID",
  message: string,
  artifact: HistoricalSourceArtifact,
): HistoricalResult<never> =>
  fail(
    historicalError({
      code,
      message,
      timestamp: artifact.importedAt,
      details: { artifactId: artifact.artifactId },
    }),
  );
