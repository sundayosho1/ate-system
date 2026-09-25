import type { Clock } from "@ate/time";

import { fail, historicalError, ok } from "./errors.js";
import type { FormatDetectionEvidence, HistoricalFormat, HistoricalResult } from "./types.js";

const parquetMagic = new Uint8Array([0x50, 0x41, 0x52, 0x31]);

export const detectHistoricalFormat = (input: {
  fileName: string;
  content: Uint8Array;
  declaredFormat?: HistoricalFormat;
  clock: Clock;
}): HistoricalResult<FormatDetectionEvidence> => {
  const extension = extensionFromFileName(input.fileName);
  const byExtension = formatFromExtension(extension);
  const bySignature = formatFromSignature(input.content);
  const byProbe = probeTextFormat(input.content);
  const detectedFormat = bySignature ?? byProbe ?? byExtension;

  if (detectedFormat === undefined) {
    return fail(
      historicalError({
        code: "HISTORICAL_FORMAT_UNSUPPORTED",
        message: "historical source artifact format is unsupported or ambiguous",
        timestamp: input.clock.now(),
        details: { extension },
      }),
    );
  }

  if (input.declaredFormat !== undefined && input.declaredFormat !== detectedFormat) {
    return fail(
      historicalError({
        code: "HISTORICAL_FORMAT_MISMATCH",
        message: "declared historical format does not match detected content format",
        timestamp: input.clock.now(),
        details: { declaredFormat: input.declaredFormat, detectedFormat, extension },
      }),
    );
  }

  return ok({
    ...(extension === undefined ? {} : { extension }),
    ...(bySignature === undefined ? {} : { signature: bySignature }),
    parserProbe: byProbe === undefined ? "NOT_RUN" : "MATCHED",
    ...(input.declaredFormat === undefined ? {} : { declaredFormat: input.declaredFormat }),
    detectedFormat,
  });
};

const extensionFromFileName = (fileName: string): string | undefined => {
  const index = fileName.lastIndexOf(".");
  return index < 0 ? undefined : fileName.slice(index + 1).toLowerCase();
};

const formatFromExtension = (extension: string | undefined): HistoricalFormat | undefined => {
  switch (extension) {
    case "csv":
      return "CSV";
    case "json":
      return "JSON";
    case "jsonl":
    case "ndjson":
      return "NDJSON";
    case "parquet":
      return "PARQUET";
    default:
      return undefined;
  }
};

const formatFromSignature = (content: Uint8Array): HistoricalFormat | undefined => {
  if (content.byteLength >= 4 && parquetMagic.every((byte, index) => content[index] === byte)) {
    return "PARQUET";
  }
  return undefined;
};

const probeTextFormat = (content: Uint8Array): HistoricalFormat | undefined => {
  const text = new TextDecoder("utf-8", { fatal: false })
    .decode(content.slice(0, Math.min(content.byteLength, 4096)))
    .trimStart();
  if (text.length === 0) {
    return undefined;
  }
  const firstLine = text.split(/\r?\n/u)[0] ?? "";
  if (firstLine.trimStart().startsWith("{") && text.includes("\n")) {
    return "NDJSON";
  }
  if (text.startsWith("{") || text.startsWith("[")) {
    return "JSON";
  }
  if (firstLine.includes(",") || firstLine.includes(";") || firstLine.includes("\t")) {
    return "CSV";
  }
  return undefined;
};
