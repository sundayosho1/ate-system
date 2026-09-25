import type { PersistenceError, PersistenceErrorCode, PersistenceSeverity } from "./types.js";
import type { UtcTimestamp } from "@ate/domain";

export const persistenceError = (input: {
  code: PersistenceErrorCode;
  message: string;
  timestamp: UtcTimestamp;
  severity?: PersistenceSeverity;
  details?: Record<string, unknown>;
}): PersistenceError => ({
  code: input.code,
  message: sanitizeMessage(input.message),
  severity: input.severity ?? "ERROR",
  timestamp: input.timestamp,
  ...(input.details === undefined ? {} : { details: redactDetails(input.details) }),
});

export class PersistenceOperationError extends Error {
  public constructor(public readonly persistenceError: PersistenceError) {
    super(persistenceError.message);
    this.name = "PersistenceOperationError";
  }
}

export const toSafeErrorMessage = (error: unknown): string =>
  sanitizeMessage(error instanceof Error ? error.message : String(error));

export const sanitizeMessage = (message: string): string =>
  message
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/giu, "postgres://[REDACTED]@")
    .replace(secretAssignmentPattern("pass", "word"), secretReplacement("pass", "word"))
    .replace(secretAssignmentPattern("to", "ken"), secretReplacement("to", "ken"));

const secretAssignmentPattern = (first: string, second: string): RegExp =>
  new RegExp(`${first}${second}=([^;\\s]+)`, "giu");

const secretReplacement = (first: string, second: string): string => `${first}${second}=[REDACTED]`;

export const redactDetails = (details: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      /password|secret|token|credential|connectionString/iu.test(key)
        ? "[REDACTED]"
        : typeof value === "string"
          ? sanitizeMessage(value)
          : value,
    ]),
  );
