import type {
  ConfigurationDefinition,
  ConfigurationScopeType,
  ScopePrecedencePolicy,
} from "./types.js";

export const defaultScopePrecedencePolicy: ScopePrecedencePolicy = {
  policyId: "default-foundation-scope-precedence",
  rules: [
    { scopeType: "SYSTEM", rank: 0, reason: "SYSTEM provides base inherited values." },
    { scopeType: "ENVIRONMENT", rank: 10, reason: "Runtime environment narrows system values." },
    { scopeType: "BROKER", rank: 20, reason: "Broker context narrows environment values." },
    {
      scopeType: "ACCOUNT",
      rank: 30,
      reason: "Account context narrows broker/environment values.",
    },
    { scopeType: "ASSET_CLASS", rank: 40, reason: "Asset-class context narrows broad values." },
    { scopeType: "INSTRUMENT", rank: 50, reason: "Instrument context narrows asset class values." },
    { scopeType: "TIMEFRAME", rank: 60, reason: "Timeframe context narrows instrument values." },
    { scopeType: "REGIME", rank: 70, reason: "Regime context narrows timeframe values." },
    { scopeType: "STRATEGY", rank: 80, reason: "Strategy context narrows regime values." },
    { scopeType: "PORTFOLIO", rank: 90, reason: "Portfolio context is most specific by default." },
    { scopeType: "RISK", rank: 100, reason: "Domain-specific risk scope is explicit." },
    { scopeType: "EXECUTION", rank: 100, reason: "Domain-specific execution scope is explicit." },
    {
      scopeType: "SURVEILLANCE",
      rank: 100,
      reason: "Domain-specific surveillance scope is explicit.",
    },
    { scopeType: "DATA", rank: 100, reason: "Domain-specific data scope is explicit." },
    { scopeType: "NEWS", rank: 100, reason: "Domain-specific news scope is explicit." },
    { scopeType: "LEARNING", rank: 100, reason: "Domain-specific learning scope is explicit." },
    { scopeType: "REPORTING", rank: 100, reason: "Domain-specific reporting scope is explicit." },
  ],
};

export const precedencePolicyFor = (definition: ConfigurationDefinition): ScopePrecedencePolicy =>
  definition.precedence ?? defaultScopePrecedencePolicy;

export const precedenceRank = (
  policy: ScopePrecedencePolicy,
  scopeType: ConfigurationScopeType,
): number | undefined => policy.rules.find((rule) => rule.scopeType === scopeType)?.rank;

export const precedenceReason = (
  policy: ScopePrecedencePolicy,
  scopeType: ConfigurationScopeType,
): string =>
  policy.rules.find((rule) => rule.scopeType === scopeType)?.reason ??
  `No explicit precedence rule for ${scopeType}.`;
