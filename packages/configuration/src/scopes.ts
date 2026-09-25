import { runtimeModes } from "@ate/domain";
import type { RuntimeMode } from "@ate/domain";

import {
  configurationScopeTypes,
  type ConfigurationContext,
  type ConfigurationScope,
  type ConfigurationScopeType,
} from "./types.js";

const scopeIdPattern = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/u;

export const systemScope: ConfigurationScope = { scopeType: "SYSTEM" };

export const configurationScope = (
  scopeType: ConfigurationScopeType,
  scopeId?: string,
): ConfigurationScope => {
  validateScope(scopeType, scopeId);
  return scopeId === undefined ? { scopeType } : { scopeType, scopeId };
};

export const validateScope = (scopeType: ConfigurationScopeType, scopeId?: string): void => {
  if (!configurationScopeTypes.includes(scopeType)) {
    throw new Error(`invalid configuration scope type: ${scopeType}`);
  }
  if (scopeType === "SYSTEM") {
    if (scopeId !== undefined) {
      throw new Error("SYSTEM scope must not have a scope id");
    }
    return;
  }
  if (scopeId === undefined || scopeId.length === 0 || !scopeIdPattern.test(scopeId)) {
    throw new Error(`invalid scope id for ${scopeType}: ${scopeId ?? "<missing>"}`);
  }
  if (scopeType === "ENVIRONMENT" && !runtimeModes.includes(scopeId as RuntimeMode)) {
    throw new Error(`environment scope must use a runtime mode: ${scopeId}`);
  }
};

export const scopeIdentity = (scope: ConfigurationScope): string =>
  scope.scopeId === undefined ? scope.scopeType : `${scope.scopeType}:${scope.scopeId}`;

export const scopeAppliesToContext = (
  scope: ConfigurationScope,
  context: ConfigurationContext,
): boolean => {
  switch (scope.scopeType) {
    case "SYSTEM":
      return true;
    case "ENVIRONMENT":
      return context.runtimeMode === scope.scopeId;
    case "BROKER":
      return context.brokerId === scope.scopeId;
    case "ACCOUNT":
      return context.accountId === scope.scopeId;
    case "ASSET_CLASS":
      return context.assetClass === scope.scopeId;
    case "INSTRUMENT":
      return context.instrumentId === scope.scopeId;
    case "TIMEFRAME":
      return context.timeframe === scope.scopeId;
    case "REGIME":
      return context.regime === scope.scopeId;
    case "STRATEGY":
      return context.strategyId === scope.scopeId;
    case "PORTFOLIO":
      return context.portfolioId === scope.scopeId;
    default:
      return context.dimensions?.[scope.scopeType] === scope.scopeId;
  }
};
