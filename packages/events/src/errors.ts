import type { EventError, EventErrorCode, EventSeverity } from "./types.js";
import type { EventId, UtcTimestamp } from "@ate/domain";

export const eventError = (input: {
  code: EventErrorCode;
  message: string;
  severity?: EventSeverity;
  timestamp: UtcTimestamp;
  eventId?: EventId;
  eventType?: string;
  subscriptionId?: EventError["subscriptionId"];
  details?: Record<string, unknown>;
}): EventError => ({
  code: input.code,
  message: input.message,
  severity: input.severity ?? "ERROR",
  timestamp: input.timestamp,
  ...(input.eventId === undefined ? {} : { eventId: input.eventId }),
  ...(input.eventType === undefined ? {} : { eventType: input.eventType }),
  ...(input.subscriptionId === undefined ? {} : { subscriptionId: input.subscriptionId }),
  ...(input.details === undefined ? {} : { details: input.details }),
});

export const toSafeMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};
