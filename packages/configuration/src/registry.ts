import type { Clock } from "@ate/time";

import { freeze } from "./context.js";
import { domainFromKey } from "./domains.js";
import { configurationError, fail, ok } from "./errors.js";
import { assertDefinitionKeyMatchesDomain } from "./keys.js";
import { fingerprint } from "./serialization.js";
import type {
  ConfigurationDefinition,
  ConfigurationFingerprint,
  ConfigurationKey,
  ConfigurationResult,
  ConfigurationScopeType,
} from "./types.js";

export class ConfigurationRegistry {
  private readonly definitions = new Map<ConfigurationKey, ConfigurationDefinition>();

  public constructor(private readonly clock: Clock) {}

  public register(
    definition: ConfigurationDefinition,
  ): ConfigurationResult<ConfigurationDefinition> {
    const domainCheck = assertDefinitionKeyMatchesDomain(definition, this.clock.now());
    if (!domainCheck.ok) {
      return domainCheck;
    }
    if (this.definitions.has(definition.key)) {
      return fail(
        configurationError({
          code: "CONFIGURATION_KEY_DUPLICATE",
          message: `configuration key already registered: ${definition.key}`,
          timestamp: this.clock.now(),
          key: definition.key,
        }),
      );
    }
    const keyDomain = domainFromKey(definition.key);
    if (keyDomain !== definition.domain) {
      return fail(
        configurationError({
          code: "CONFIGURATION_KEY_UNKNOWN",
          message: `configuration key ${definition.key} does not match domain ${definition.domain}`,
          timestamp: this.clock.now(),
          key: definition.key,
        }),
      );
    }
    this.definitions.set(definition.key, freeze({ ...definition }));
    return ok(definition);
  }

  public require(key: ConfigurationKey): ConfigurationResult<ConfigurationDefinition> {
    const definition = this.definitions.get(key);
    if (definition === undefined) {
      return fail(
        configurationError({
          code: "CONFIGURATION_KEY_UNKNOWN",
          message: `configuration key is not registered: ${key}`,
          timestamp: this.clock.now(),
          key,
        }),
      );
    }
    return ok(definition);
  }

  public all(): readonly ConfigurationDefinition[] {
    return freeze([...this.definitions.values()].map((definition) => ({ ...definition })));
  }

  public keys(): readonly ConfigurationKey[] {
    return [...this.definitions.keys()].sort();
  }

  public fingerprint(): ConfigurationFingerprint {
    return fingerprint(
      this.all().map((definition) => ({
        key: definition.key,
        domain: definition.domain,
        required: definition.required,
        failClosed: definition.failClosed,
        allowedScopes: [...definition.allowedScopes].sort(),
        mergePolicy: definition.mergePolicy,
        sensitivity: definition.sensitivity,
        valueType: definition.valueType,
        defaultValue: definition.defaultValue,
        precedence: definition.precedence,
      })),
    );
  }
}

export const assertScopeAllowed = (
  definition: ConfigurationDefinition,
  scopeType: ConfigurationScopeType,
): boolean => definition.allowedScopes.includes(scopeType);
