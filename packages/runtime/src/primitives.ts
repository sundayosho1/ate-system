import { parseUtcTimestamp, runtimeModes, type RuntimeMode, type UtcTimestamp } from "@ate/domain";

import type {
  LifecycleError,
  LifecycleErrorCode,
  RuntimeClock,
  RuntimeInstanceId,
  ServiceId,
} from "./types.js";

export class LifecycleTimeoutError extends Error {
  public constructor(public readonly lifecycleError: LifecycleError) {
    super(lifecycleError.message);
    this.name = "LifecycleTimeoutError";
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const serviceIdPattern = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/u;

export const systemClock: RuntimeClock = {
  now: () => {
    const parsed = parseUtcTimestamp(new Date().toISOString());
    if (!parsed.ok) {
      throw new Error("system clock produced an invalid UTC timestamp");
    }
    return parsed.value;
  },
};

export const parseRuntimeInstanceId = (value: unknown): RuntimeInstanceId | undefined =>
  typeof value === "string" && uuidPattern.test(value) ? (value as RuntimeInstanceId) : undefined;

export const parseServiceId = (value: unknown): ServiceId | undefined =>
  typeof value === "string" && serviceIdPattern.test(value) ? (value as ServiceId) : undefined;

export const parseRuntimeMode = (value: unknown): RuntimeMode | undefined =>
  typeof value === "string" && runtimeModes.includes(value as RuntimeMode)
    ? (value as RuntimeMode)
    : undefined;

export const lifecycleError = (
  code: LifecycleErrorCode,
  message: string,
  timestamp: UtcTimestamp,
  serviceId?: ServiceId,
  details?: Record<string, unknown>,
): LifecycleError => ({
  code,
  message,
  timestamp,
  ...(serviceId === undefined ? {} : { serviceId }),
  ...(details === undefined ? {} : { details }),
});

export const timeout = <T>(
  operation: Promise<T>,
  timeoutMs: number,
  onTimeout: () => LifecycleError,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new LifecycleTimeoutError(onTimeout())), timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });

export const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
