import type { UtcTimestamp } from "@ate/domain";

import { domainFromKey } from "./domains.js";
import { configurationError, fail, ok } from "./errors.js";
import type { ConfigurationDefinition, ConfigurationKey, ConfigurationResult } from "./types.js";

const keyPattern = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/u;

export const configurationKey = (
  value: string,
  timestamp: UtcTimestamp,
): ConfigurationResult<ConfigurationKey> => {
  if (!keyPattern.test(value)) {
    return fail(
      configurationError({
        code: "CONFIGURATION_KEY_UNKNOWN",
        message: `configuration key is not canonical: ${value}`,
        timestamp,
      }),
    );
  }
  const key = value as ConfigurationKey;
  if (domainFromKey(key) === undefined) {
    return fail(
      configurationError({
        code: "CONFIGURATION_KEY_UNKNOWN",
        message: `configuration key has no known domain prefix: ${value}`,
        timestamp,
        key,
      }),
    );
  }
  return ok(key);
};

export const assertDefinitionKeyMatchesDomain = (
  definition: ConfigurationDefinition,
  timestamp: UtcTimestamp,
): ConfigurationResult<ConfigurationDefinition> => {
  const domain = domainFromKey(definition.key);
  if (domain !== definition.domain) {
    return fail(
      configurationError({
        code: "CONFIGURATION_KEY_UNKNOWN",
        message: `configuration key ${definition.key} does not belong to domain ${definition.domain}`,
        timestamp,
        key: definition.key,
      }),
    );
  }
  return ok(definition);
};
