import { runtimeModes } from "@ate/domain";

import { configurationError, fail, ok } from "./errors.js";
import type { ConfigurationContext, ConfigurationResult } from "./types.js";
import type { UtcTimestamp } from "@ate/domain";

const dimensionKeyPattern = /^[A-Z][A-Z0-9_]{0,63}$/u;
const dimensionValuePattern = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/u;

export const configurationContext = (
  context: ConfigurationContext,
  timestamp: UtcTimestamp,
): ConfigurationResult<ConfigurationContext> => {
  if (context.runtimeMode !== undefined && !runtimeModes.includes(context.runtimeMode)) {
    return fail(
      configurationError({
        code: "CONFIGURATION_CONTEXT_INVALID",
        message: `invalid runtime mode in configuration context: ${context.runtimeMode}`,
        timestamp,
      }),
    );
  }
  for (const [key, value] of Object.entries(context.dimensions ?? {})) {
    if (!dimensionKeyPattern.test(key) || !dimensionValuePattern.test(value)) {
      return fail(
        configurationError({
          code: "CONFIGURATION_CONTEXT_INVALID",
          message: `invalid context dimension ${key}`,
          timestamp,
          details: { key },
        }),
      );
    }
  }
  return ok(freeze({ ...context, dimensions: { ...(context.dimensions ?? {}) } }));
};

export const contextFingerprintInput = (
  context: ConfigurationContext,
): Record<string, unknown> => ({
  runtimeMode: context.runtimeMode,
  brokerId: context.brokerId,
  accountId: context.accountId,
  assetClass: context.assetClass,
  instrumentId: context.instrumentId,
  timeframe: context.timeframe,
  regime: context.regime,
  strategyId: context.strategyId,
  portfolioId: context.portfolioId,
  dimensions: context.dimensions ?? {},
});

export const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      freeze(nested);
    }
  }
  return value;
};
