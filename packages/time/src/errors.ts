import type { TemporalError, TemporalErrorCode, TemporalSource } from "./types.js";
import type { UtcTimestamp } from "@ate/domain";

export const temporalError = (input: {
  code: TemporalErrorCode;
  message: string;
  severity?: TemporalError["severity"];
  timestamp?: UtcTimestamp;
  source?: TemporalSource;
  details?: Record<string, unknown>;
}): TemporalError => ({
  code: input.code,
  message: input.message,
  severity: input.severity ?? "ERROR",
  ...(input.timestamp === undefined ? {} : { timestamp: input.timestamp }),
  ...(input.source === undefined ? {} : { source: input.source }),
  ...(input.details === undefined ? {} : { details: input.details }),
});
