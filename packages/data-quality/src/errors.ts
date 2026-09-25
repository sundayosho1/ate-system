import type { UtcTimestamp } from "@ate/domain";

import type { DataQualityError, DataQualityErrorCode, DataQualityResult } from "./types.js";

export const dataQualityError = (input: {
  code: DataQualityErrorCode;
  message: string;
  timestamp: UtcTimestamp;
  severity?: DataQualityError["severity"];
  details?: Record<string, unknown>;
}): DataQualityError => ({
  code: input.code,
  message: input.message,
  severity: input.severity ?? "ERROR",
  timestamp: input.timestamp,
  ...(input.details === undefined ? {} : { details: input.details }),
});

export const ok = <T>(value: T): DataQualityResult<T> => ({ ok: true, value });

export const fail = <T = never>(error: DataQualityError): DataQualityResult<T> => ({
  ok: false,
  error,
});

export const toSafeMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
