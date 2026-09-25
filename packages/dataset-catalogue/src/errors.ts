import type { UtcTimestamp } from "@ate/domain";

import type {
  DatasetCatalogueError,
  DatasetCatalogueErrorCode,
  DatasetCatalogueResult,
} from "./types.js";

export const datasetCatalogueError = (input: {
  code: DatasetCatalogueErrorCode;
  message: string;
  timestamp: UtcTimestamp;
  severity?: DatasetCatalogueError["severity"];
  details?: Record<string, unknown>;
}): DatasetCatalogueError => ({
  code: input.code,
  message: input.message,
  severity: input.severity ?? "ERROR",
  timestamp: input.timestamp,
  ...(input.details === undefined ? {} : { details: input.details }),
});

export const ok = <T>(value: T): DatasetCatalogueResult<T> => ({ ok: true, value });

export const fail = <T = never>(error: DatasetCatalogueError): DatasetCatalogueResult<T> => ({
  ok: false,
  error,
});

export const toSafeMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
