import type { RuntimeMode } from "@ate/domain";

import { scopeIdentity } from "./scopes.js";
import { stableStringify } from "./serialization.js";
import type {
  ConfigurationConditionalPredicate,
  ConfigurationSchema,
  ConfigurationValueConstraints,
} from "./schema-types.js";
import type {
  ConfigurationContext,
  ConfigurationKey,
  ConfigurationScope,
  ConfigurationValidationIssue,
  ConfigurationValidationPhase,
  ConfigurationValue,
  ConfigurationValueType,
  EffectiveConfiguration,
} from "./types.js";

export const validateValueAgainstSchema = (input: {
  schema: ConfigurationSchema;
  value: ConfigurationValue | undefined;
  phase: ConfigurationValidationPhase;
  scope?: ConfigurationScope;
  path?: string;
}): readonly ConfigurationValidationIssue[] => {
  if (input.value === undefined) {
    return [];
  }
  return validateTypedValue({
    key: input.schema.key,
    value: input.value,
    valueType: input.schema.valueType,
    constraints: input.schema.constraints,
    phase: input.phase,
    scope: input.scope,
    path: input.path,
    sensitivity: input.schema.sensitivity,
  });
};

export const valueMatchesSchema = (
  value: ConfigurationValue | undefined,
  valueType: ConfigurationValueType,
  constraints?: ConfigurationValueConstraints,
): boolean =>
  validateTypedValue({
    value,
    valueType,
    constraints,
    phase: "TYPE",
  }).length === 0;

export const effectiveValue = (
  effective: EffectiveConfiguration,
  key: ConfigurationKey,
): ConfigurationValue | undefined => effective.values.get(key)?.value;

export const effectiveValuePresent = (
  effective: EffectiveConfiguration,
  key: ConfigurationKey,
): boolean => effective.values.get(key)?.present === true;

export const predicateMatches = (
  effective: EffectiveConfiguration,
  predicate: ConfigurationConditionalPredicate,
): boolean => {
  const present = effectiveValuePresent(effective, predicate.key);
  const value = effectiveValue(effective, predicate.key);
  if (predicate.present !== undefined && predicate.present !== present) {
    return false;
  }
  if (predicate.equals !== undefined && !configurationValuesEqual(value, predicate.equals)) {
    return false;
  }
  if (
    predicate.oneOf !== undefined &&
    !predicate.oneOf.some((allowed) => configurationValuesEqual(value, allowed))
  ) {
    return false;
  }
  return true;
};

export const configurationValuesEqual = (
  left: ConfigurationValue | undefined,
  right: ConfigurationValue | undefined,
): boolean => stableStringify(left) === stableStringify(right);

export const configurationValueTypeName = (value: ConfigurationValue | undefined): string => {
  if (value === undefined) {
    return "undefined";
  }
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "list";
  }
  if (typeof value === "object" && "kind" in value && value.kind === "SECRET_REFERENCE") {
    return "secret_reference";
  }
  return typeof value;
};

export const runtimeModeFromContext = (context: ConfigurationContext): RuntimeMode | undefined =>
  context.runtimeMode;

const validateTypedValue = (input: {
  key?: ConfigurationKey | undefined;
  value: ConfigurationValue | undefined;
  valueType: ConfigurationValueType;
  constraints?: ConfigurationValueConstraints | undefined;
  phase: ConfigurationValidationPhase;
  scope?: ConfigurationScope | undefined;
  path?: string | undefined;
  sensitivity?: string | undefined;
}): readonly ConfigurationValidationIssue[] => {
  const issues: ConfigurationValidationIssue[] = [];
  if (!matchesValueType(input.value, input.valueType)) {
    issues.push(
      issue(input, {
        expected: input.valueType,
        message: `configuration value must be ${input.valueType}`,
        phase: "TYPE",
        receivedType: configurationValueTypeName(input.value),
      }),
    );
    return issues;
  }
  if (input.sensitivity === "SECRET_REFERENCE" && !isSecretReference(input.value)) {
    issues.push(
      issue(input, {
        expected: "SECRET_REFERENCE",
        message: "secret material is forbidden; use a secret reference",
        phase: "TYPE",
        receivedType: configurationValueTypeName(input.value),
      }),
    );
  }
  if (
    input.sensitivity !== undefined &&
    input.sensitivity !== "SECRET_REFERENCE" &&
    isSecretReference(input.value)
  ) {
    issues.push(
      issue(input, {
        expected: "non-secret configuration value",
        message: "secret references are only valid for SECRET_REFERENCE settings",
        phase: "TYPE",
        receivedType: configurationValueTypeName(input.value),
      }),
    );
  }
  issues.push(...validateConstraints(input));
  return issues;
};

const matchesValueType = (
  value: ConfigurationValue | undefined,
  valueType: ConfigurationValueType,
): boolean => {
  if (value === undefined) {
    return true;
  }
  switch (valueType) {
    case "BOOLEAN":
      return typeof value === "boolean";
    case "INTEGER":
    case "DURATION_MS":
      return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value);
    case "DECIMAL":
      return (
        (typeof value === "number" && Number.isFinite(value)) ||
        (typeof value === "string" && value.trim().length > 0 && Number.isFinite(Number(value)))
      );
    case "STRING":
    case "ENUM":
    case "TIMESTAMP":
    case "TIMEZONE":
    case "IDENTIFIER":
      return typeof value === "string";
    case "OBJECT":
      return isPlainObject(value) && !isSecretReference(value);
    case "LIST":
      return Array.isArray(value);
    case "SECRET_REFERENCE":
      return isSecretReference(value);
    case "UNKNOWN":
      return true;
  }
};

const validateConstraints = (input: {
  key?: ConfigurationKey | undefined;
  value: ConfigurationValue | undefined;
  valueType: ConfigurationValueType;
  constraints?: ConfigurationValueConstraints | undefined;
  phase: ConfigurationValidationPhase;
  scope?: ConfigurationScope | undefined;
  path?: string | undefined;
}): readonly ConfigurationValidationIssue[] => {
  if (input.value === undefined || input.constraints === undefined) {
    return [];
  }
  const issues: ConfigurationValidationIssue[] = [];
  const constraints = input.constraints;
  if (
    constraints.enumValues !== undefined &&
    !constraints.enumValues.some((allowed) => configurationValuesEqual(input.value, allowed))
  ) {
    issues.push(
      issue(input, {
        constraint: "enumValues",
        expected: constraints.enumValues.map((value) => stableStringify(value)).join(", "),
        message: "configuration value is not one of the allowed values",
        phase: "CONSTRAINT",
        receivedType: configurationValueTypeName(input.value),
      }),
    );
  }
  const numericValue = numericConstraintValue(input.value);
  if (
    numericValue !== undefined &&
    constraints.minimum !== undefined &&
    numericValue < constraints.minimum
  ) {
    issues.push(
      issue(input, {
        constraint: "minimum",
        expected: `>= ${constraints.minimum}`,
        message: "configuration value is below the minimum",
        phase: "CONSTRAINT",
        receivedType: configurationValueTypeName(input.value),
      }),
    );
  }
  if (
    numericValue !== undefined &&
    constraints.maximum !== undefined &&
    numericValue > constraints.maximum
  ) {
    issues.push(
      issue(input, {
        constraint: "maximum",
        expected: `<= ${constraints.maximum}`,
        message: "configuration value is above the maximum",
        phase: "CONSTRAINT",
        receivedType: configurationValueTypeName(input.value),
      }),
    );
  }
  if (typeof input.value === "string") {
    if (constraints.minLength !== undefined && input.value.length < constraints.minLength) {
      issues.push(
        issue(input, {
          constraint: "minLength",
          expected: `length >= ${constraints.minLength}`,
          message: "configuration string is shorter than allowed",
          phase: "CONSTRAINT",
          receivedType: "string",
        }),
      );
    }
    if (constraints.maxLength !== undefined && input.value.length > constraints.maxLength) {
      issues.push(
        issue(input, {
          constraint: "maxLength",
          expected: `length <= ${constraints.maxLength}`,
          message: "configuration string is longer than allowed",
          phase: "CONSTRAINT",
          receivedType: "string",
        }),
      );
    }
    if (
      constraints.pattern !== undefined &&
      !new RegExp(constraints.pattern, "u").test(input.value)
    ) {
      issues.push(
        issue(input, {
          constraint: "pattern",
          expected: constraints.pattern,
          message: "configuration string does not match the required pattern",
          phase: "CONSTRAINT",
          receivedType: "string",
        }),
      );
    }
  }
  if (isConfigurationArray(input.value)) {
    if (constraints.minItems !== undefined && input.value.length < constraints.minItems) {
      issues.push(
        issue(input, {
          constraint: "minItems",
          expected: `items >= ${constraints.minItems}`,
          message: "configuration list has too few items",
          phase: "CONSTRAINT",
          receivedType: "list",
        }),
      );
    }
    if (constraints.maxItems !== undefined && input.value.length > constraints.maxItems) {
      issues.push(
        issue(input, {
          constraint: "maxItems",
          expected: `items <= ${constraints.maxItems}`,
          message: "configuration list has too many items",
          phase: "CONSTRAINT",
          receivedType: "list",
        }),
      );
    }
    if (constraints.itemValueType !== undefined) {
      const itemValueType = constraints.itemValueType;
      input.value.forEach((item, index) => {
        issues.push(
          ...validateTypedValue({
            value: item,
            valueType: itemValueType,
            phase: "CONSTRAINT",
            path: pathJoin(input.path, String(index)),
            key: input.key,
            scope: input.scope,
          }),
        );
      });
    }
  }
  if (isPlainObject(input.value) && !isSecretReference(input.value)) {
    for (const requiredProperty of constraints.requiredProperties ?? []) {
      if (!(requiredProperty in input.value)) {
        issues.push(
          issue(input, {
            constraint: "requiredProperties",
            expected: requiredProperty,
            message: `required object property is missing: ${requiredProperty}`,
            path: pathJoin(input.path, requiredProperty),
            phase: "CONSTRAINT",
            receivedType: "object",
          }),
        );
      }
    }
    const propertySchemas = constraints.properties ?? {};
    if (constraints.allowUnknownProperties === false) {
      for (const propertyName of Object.keys(input.value)) {
        if (propertySchemas[propertyName] === undefined) {
          issues.push(
            issue(input, {
              constraint: "allowUnknownProperties",
              expected: "declared properties only",
              message: `unknown object property is not allowed: ${propertyName}`,
              path: pathJoin(input.path, propertyName),
              phase: "CONSTRAINT",
              receivedType: "object",
            }),
          );
        }
      }
    }
    for (const [propertyName, propertySchema] of Object.entries(propertySchemas)) {
      const propertyValue = input.value[propertyName];
      if (propertyValue === undefined && propertySchema.required === true) {
        issues.push(
          issue(input, {
            constraint: "property.required",
            expected: propertyName,
            message: `required object property is missing: ${propertyName}`,
            path: pathJoin(input.path, propertyName),
            phase: "CONSTRAINT",
            receivedType: "object",
          }),
        );
        continue;
      }
      issues.push(
        ...validateTypedValue({
          value: propertyValue,
          valueType: propertySchema.valueType,
          constraints: propertySchema.constraints,
          phase: "CONSTRAINT",
          path: pathJoin(input.path, propertyName),
          key: input.key,
          scope: input.scope,
        }),
      );
    }
  }
  if (isSecretReference(input.value)) {
    if (
      constraints.secretProviders !== undefined &&
      input.value.provider !== undefined &&
      !constraints.secretProviders.includes(input.value.provider)
    ) {
      issues.push(
        issue(input, {
          constraint: "secretProviders",
          expected: constraints.secretProviders.join(", "),
          message: "secret reference provider is not allowed",
          phase: "CONSTRAINT",
          receivedType: "secret_reference",
        }),
      );
    }
    if (
      constraints.secretRefPattern !== undefined &&
      !new RegExp(constraints.secretRefPattern, "u").test(input.value.ref)
    ) {
      issues.push(
        issue(input, {
          constraint: "secretRefPattern",
          expected: constraints.secretRefPattern,
          message: "secret reference identifier does not match the required pattern",
          phase: "CONSTRAINT",
          receivedType: "secret_reference",
        }),
      );
    }
  }
  return issues;
};

const issue = (
  input: {
    key?: ConfigurationKey | undefined;
    scope?: ConfigurationScope | undefined;
    path?: string | undefined;
  },
  details: {
    message: string;
    phase: ConfigurationValidationPhase;
    expected?: string;
    receivedType?: string;
    constraint?: string;
    path?: string;
  },
): ConfigurationValidationIssue => {
  const path = details.path ?? input.path;
  return {
    phase: details.phase,
    severity: "ERROR",
    message: details.message,
    ...(input.key === undefined ? {} : { key: input.key }),
    ...(input.scope === undefined ? {} : { scope: input.scope }),
    ...(path === undefined ? {} : { path }),
    ...(details.expected === undefined ? {} : { expected: details.expected }),
    ...(details.receivedType === undefined ? {} : { receivedType: details.receivedType }),
    ...(details.constraint === undefined ? {} : { constraint: details.constraint }),
    ...(input.scope === undefined ? {} : { metadata: { scope: scopeIdentity(input.scope) } }),
  };
};

const numericConstraintValue = (value: ConfigurationValue | undefined): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
};

const isPlainObject = (
  value: ConfigurationValue | undefined,
): value is Readonly<Record<string, ConfigurationValue>> =>
  value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value);

const isConfigurationArray = (
  value: ConfigurationValue | undefined,
): value is readonly ConfigurationValue[] => Array.isArray(value);

const isSecretReference = (
  value: ConfigurationValue | undefined,
): value is Readonly<{ kind: "SECRET_REFERENCE"; ref: string; provider?: string }> =>
  value !== undefined &&
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  "kind" in value &&
  value.kind === "SECRET_REFERENCE" &&
  "ref" in value &&
  typeof value.ref === "string";

const pathJoin = (base: string | undefined, segment: string): string =>
  base === undefined || base.length === 0 ? segment : `${base}.${segment}`;
