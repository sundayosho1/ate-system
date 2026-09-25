import type { UtcTimestamp } from "@ate/domain";

import type {
  ConfigurationError,
  ConfigurationErrorCode,
  ConfigurationKey,
  ConfigurationResult,
} from "./types.js";

export const configurationError = (input: {
  code: ConfigurationErrorCode;
  message: string;
  timestamp: UtcTimestamp;
  severity?: ConfigurationError["severity"];
  key?: ConfigurationKey;
  details?: Record<string, unknown>;
}): ConfigurationError => ({
  code: input.code,
  message: input.message,
  severity: input.severity ?? "ERROR",
  timestamp: input.timestamp,
  ...(input.key === undefined ? {} : { key: input.key }),
  ...(input.details === undefined ? {} : { details: input.details }),
});

export const ok = <T>(value: T): ConfigurationResult<T> => ({ ok: true, value });

export const fail = <T = never>(error: ConfigurationError): ConfigurationResult<T> => ({
  ok: false,
  error,
});

export const toSafeConfigurationMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
