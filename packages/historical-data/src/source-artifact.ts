import type { Actor, DataSourceRef } from "@ate/domain";
import type { Clock } from "@ate/time";

import { fail, historicalError, ok } from "./errors.js";
import { detectHistoricalFormat } from "./format.js";
import { fingerprint } from "./serialization.js";
import { sha256Bytes } from "./serialization.js";
import type {
  HistoricalFormat,
  HistoricalResourceLimits,
  HistoricalResult,
  HistoricalSourceArtifact,
  SafeMetadata,
} from "./types.js";

const windowsReservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/iu;

export const sanitizeOriginalFileName = (fileName: string): HistoricalResult<string> => {
  const trimmed = fileName.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 255 ||
    trimmed.includes("\0") ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("..") ||
    /^([a-z]:|\\\\)/iu.test(trimmed) ||
    windowsReservedNames.test(trimmed)
  ) {
    return fail(
      historicalError({
        code: "HISTORICAL_PATH_INVALID",
        message: "historical artifact filename is unsafe",
        timestamp: new Date(0).toISOString() as never,
        details: { fileName: "[unsafe]" },
      }),
    );
  }
  return ok(trimmed.replace(/[^a-zA-Z0-9._ -]/gu, "_"));
};

export const createHistoricalSourceArtifact = (input: {
  fileName: string;
  content: Uint8Array;
  declaredFormat?: HistoricalFormat;
  source: DataSourceRef;
  clock: Clock;
  importedBy?: Actor;
  limits: HistoricalResourceLimits;
  sourceDescription?: string;
  exportMetadata?: SafeMetadata;
  metadata?: SafeMetadata;
}): HistoricalResult<HistoricalSourceArtifact> => {
  if (input.content.byteLength > input.limits.maxArtifactBytes) {
    return fail(
      historicalError({
        code: "HISTORICAL_FILE_TOO_LARGE",
        message: "historical source artifact exceeds configured byte limit",
        timestamp: input.clock.now(),
        details: {
          byteSize: input.content.byteLength,
          maxArtifactBytes: input.limits.maxArtifactBytes,
        },
      }),
    );
  }

  const sanitized = sanitizeOriginalFileName(input.fileName);
  if (!sanitized.ok) {
    return fail({ ...sanitized.error, timestamp: input.clock.now() });
  }

  const detection = detectHistoricalFormat({
    fileName: sanitized.value,
    content: input.content,
    ...(input.declaredFormat === undefined ? {} : { declaredFormat: input.declaredFormat }),
    clock: input.clock,
  });
  if (!detection.ok) {
    return detection;
  }

  const checksum = sha256Bytes(input.content);
  const artifactId = `hsa-${fingerprint({
    checksum,
    fileName: sanitized.value,
    sourceId: input.source.sourceId,
  })
    .replace("sha256:", "")
    .slice(0, 32)}` as HistoricalSourceArtifact["artifactId"];

  return ok({
    artifactId,
    originalFileName: input.fileName,
    sanitizedFileName: sanitized.value,
    ...(input.declaredFormat === undefined ? {} : { declaredFormat: input.declaredFormat }),
    detectedFormat: detection.value.detectedFormat,
    byteSize: input.content.byteLength,
    checksum,
    importedAt: input.clock.now(),
    ...(input.importedBy === undefined ? {} : { importedBy: input.importedBy }),
    source: input.source,
    ...(input.sourceDescription === undefined
      ? {}
      : { sourceDescription: input.sourceDescription }),
    exportMetadata: input.exportMetadata ?? {},
    metadata: input.metadata ?? {},
  });
};
