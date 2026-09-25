import type { UtcTimestamp } from "@ate/domain";

import type { HistoricalError, HistoricalErrorCode, HistoricalResult } from "./types.js";

export const historicalError = (input: {
  code: HistoricalErrorCode;
  message: string;
  timestamp: UtcTimestamp;
  severity?: HistoricalError["severity"];
  details?: Record<string, unknown>;
}): HistoricalError => ({
  code: input.code,
  message: input.message,
  severity: input.severity ?? "ERROR",
  timestamp: input.timestamp,
  ...(input.details === undefined ? {} : { details: input.details }),
});

export const ok = <T>(value: T): HistoricalResult<T> => ({ ok: true, value });

export const fail = <T = never>(error: HistoricalError): HistoricalResult<T> => ({
  ok: false,
  error,
});

export const toSafeMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
