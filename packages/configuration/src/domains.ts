import { configurationDomains, type ConfigurationDomain, type ConfigurationKey } from "./types.js";

export const domainKeyPrefixes: Record<ConfigurationDomain, string> = {
  SYSTEM: "system",
  ENVIRONMENT: "environment",
  BROKER: "broker",
  ACCOUNT: "account",
  ASSET_CLASS: "assetClass",
  INSTRUMENT: "instrument",
  TIMEFRAME: "timeframe",
  REGIME: "regime",
  STRATEGY: "strategy",
  RISK: "risk",
  PORTFOLIO: "portfolio",
  EXECUTION: "execution",
  SURVEILLANCE: "surveillance",
  DATA: "data",
  NEWS: "news",
  LEARNING: "learning",
  REPORTING: "reporting",
};

export const isConfigurationDomain = (value: string): value is ConfigurationDomain =>
  configurationDomains.includes(value as ConfigurationDomain);

export const domainFromKey = (key: ConfigurationKey): ConfigurationDomain | undefined => {
  const prefix = key.split(".")[0];
  return configurationDomains.find((domain) => domainKeyPrefixes[domain] === prefix);
};
