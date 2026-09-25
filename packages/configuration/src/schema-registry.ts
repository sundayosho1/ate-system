import type { Clock } from "@ate/time";

import { freeze } from "./context.js";
import { domainFromKey } from "./domains.js";
import { configurationError, fail, ok } from "./errors.js";
import { assertDefinitionKeyMatchesDomain } from "./keys.js";
import { fingerprint } from "./serialization.js";
import type { ConfigurationSchema } from "./schema-types.js";
import { validateValueAgainstSchema } from "./validators.js";
import type {
  ConfigurationFingerprint,
  ConfigurationKey,
  ConfigurationResult,
  ConfigurationValidationIssue,
} from "./types.js";

export class ConfigurationSchemaRegistry {
  private readonly schemas = new Map<ConfigurationKey, ConfigurationSchema>();

  public constructor(private readonly clock: Clock) {}

  public register(schema: ConfigurationSchema): ConfigurationResult<ConfigurationSchema> {
    const definitionCheck = assertDefinitionKeyMatchesDomain(schema, this.clock.now());
    if (!definitionCheck.ok) {
      return definitionCheck;
    }
    if (this.schemas.has(schema.key)) {
      return fail(
        configurationError({
          code: "CONFIGURATION_KEY_DUPLICATE",
          message: `configuration schema already registered: ${schema.key}`,
          timestamp: this.clock.now(),
          key: schema.key,
        }),
      );
    }
    const issues = validateSchemaSelfConsistency(schema);
    if (issues.length > 0) {
      return fail(
        configurationError({
          code: "CONFIGURATION_SCHEMA_INVALID",
          message: `configuration schema is invalid: ${schema.key}`,
          timestamp: this.clock.now(),
          severity: "CRITICAL",
          key: schema.key,
          details: { issues },
        }),
      );
    }
    this.schemas.set(schema.key, freeze({ ...schema }));
    return ok(schema);
  }

  public require(key: ConfigurationKey): ConfigurationResult<ConfigurationSchema> {
    const schema = this.schemas.get(key);
    if (schema === undefined) {
      return fail(
        configurationError({
          code: "CONFIGURATION_KEY_UNKNOWN",
          message: `configuration schema is not registered: ${key}`,
          timestamp: this.clock.now(),
          key,
        }),
      );
    }
    return ok(schema);
  }

  public all(): readonly ConfigurationSchema[] {
    return freeze([...this.schemas.values()].map((schema) => ({ ...schema })));
  }

  public keys(): readonly ConfigurationKey[] {
    return [...this.schemas.keys()].sort();
  }

  public fingerprint(): ConfigurationFingerprint {
    return fingerprint(
      this.all().map((schema) => ({
        key: schema.key,
        domain: schema.domain,
        valueType: schema.valueType,
        required: schema.required,
        failClosed: schema.failClosed,
        allowedScopes: [...schema.allowedScopes].sort(),
        allowedRuntimeModes: [...(schema.allowedRuntimeModes ?? [])].sort(),
        mergePolicy: schema.mergePolicy,
        sensitivity: schema.sensitivity,
        defaultValue: schema.defaultValue,
        constraints: schema.constraints,
        dependencies: schema.dependencies,
        mutuallyExclusiveWith: schema.mutuallyExclusiveWith,
        conditionals: schema.conditionals,
        crossFieldRules: schema.crossFieldRules,
      })),
    );
  }
}

export const validateSchemaSelfConsistency = (
  schema: ConfigurationSchema,
): readonly ConfigurationValidationIssue[] => {
  const issues: ConfigurationValidationIssue[] = [];
  if (domainFromKey(schema.key) !== schema.domain) {
    issues.push(
      schemaIssue(schema, `schema key ${schema.key} does not match domain ${schema.domain}`),
    );
  }
  if (schema.allowedScopes.length === 0) {
    issues.push(schemaIssue(schema, "schema must declare at least one allowed scope"));
  }
  if (schema.valueType === "ENUM" && (schema.constraints?.enumValues?.length ?? 0) === 0) {
    issues.push(schemaIssue(schema, "ENUM schemas must declare enumValues"));
  }
  if (
    (schema.mergePolicy === "APPEND" || schema.mergePolicy === "SET_UNION") &&
    schema.valueType !== "LIST"
  ) {
    issues.push(schemaIssue(schema, `${schema.mergePolicy} merge policy requires LIST valueType`));
  }
  if (schema.mergePolicy === "DEEP_MERGE" && schema.valueType !== "OBJECT") {
    issues.push(schemaIssue(schema, "DEEP_MERGE merge policy requires OBJECT valueType"));
  }
  if (schema.defaultValue !== undefined) {
    issues.push(
      ...validateValueAgainstSchema({
        schema,
        value: schema.defaultValue,
        phase: "SCHEMA",
        path: "defaultValue",
      }).map((issue) => ({ ...issue, phase: "SCHEMA" as const })),
    );
  }
  return issues;
};

export const registerConfigurationSchemas = (
  registry: ConfigurationSchemaRegistry,
  schemas: readonly ConfigurationSchema[],
): ConfigurationResult<readonly ConfigurationSchema[]> => {
  const registered: ConfigurationSchema[] = [];
  for (const schema of schemas) {
    const result = registry.register(schema);
    if (!result.ok) {
      return result;
    }
    registered.push(result.value);
  }
  return ok(registered);
};

const schemaIssue = (
  schema: ConfigurationSchema,
  message: string,
): ConfigurationValidationIssue => ({
  phase: "SCHEMA",
  severity: "ERROR",
  key: schema.key,
  message,
});
