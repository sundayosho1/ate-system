import type { RuntimeMode } from "@ate/domain";
import type { Clock } from "@ate/time";

import { createConfigurationValidationReport } from "./validation-report.js";
import type { ConfigurationSchemaRegistry } from "./schema-registry.js";
import {
  configurationValuesEqual,
  effectiveValue,
  effectiveValuePresent,
  predicateMatches,
  runtimeModeFromContext,
  validateValueAgainstSchema,
} from "./validators.js";
import type {
  ConfigurationConflict,
  ConfigurationKey,
  ConfigurationSnapshot,
  ConfigurationValidationIssue,
  ConfigurationValidationReport,
  ConfigurationValue,
  EffectiveConfiguration,
} from "./types.js";

export const validateConfigurationSnapshot = (input: {
  schemaRegistry: ConfigurationSchemaRegistry;
  snapshot: ConfigurationSnapshot;
  clock: Clock;
}): ConfigurationValidationReport => {
  const issues: ConfigurationValidationIssue[] = [
    ...input.snapshot.conflicts.map(conflictToValidationIssue),
  ];
  for (const entry of input.snapshot.entries) {
    const schema = input.schemaRegistry.require(entry.key);
    if (!schema.ok) {
      issues.push({
        phase: "SOURCE_ENTRY",
        severity: "ERROR",
        key: entry.key,
        scope: entry.scope,
        message: schema.error.message,
      });
      continue;
    }
    if (!schema.value.allowedScopes.includes(entry.scope.scopeType)) {
      issues.push({
        phase: "SCOPE_APPLICABILITY",
        severity: "ERROR",
        key: entry.key,
        scope: entry.scope,
        message: `scope ${entry.scope.scopeType} is not allowed for ${entry.key}`,
      });
    }
    if (
      entry.scope.scopeType === "ENVIRONMENT" &&
      schema.value.allowedRuntimeModes !== undefined &&
      !schema.value.allowedRuntimeModes.includes(entry.scope.scopeId as RuntimeMode)
    ) {
      issues.push({
        phase: "SCOPE_APPLICABILITY",
        severity: "ERROR",
        key: entry.key,
        scope: entry.scope,
        message: `environment scope ${entry.scope.scopeId ?? "<missing>"} is not allowed for ${entry.key}`,
      });
    }
    if (entry.operation === "UNSET") {
      if (entry.value !== undefined) {
        issues.push({
          phase: "SOURCE_ENTRY",
          severity: "ERROR",
          key: entry.key,
          scope: entry.scope,
          message: "UNSET entries must not carry a value",
        });
      }
      continue;
    }
    issues.push(
      ...validateValueAgainstSchema({
        schema: schema.value,
        value: entry.value,
        phase: "SOURCE_ENTRY",
        scope: entry.scope,
      }),
    );
  }
  return createConfigurationValidationReport({
    clock: input.clock,
    schemaFingerprint: input.schemaRegistry.fingerprint(),
    issues,
    snapshotId: input.snapshot.snapshotId,
  });
};

export const validateEffectiveConfiguration = (input: {
  schemaRegistry: ConfigurationSchemaRegistry;
  effective: EffectiveConfiguration;
  clock: Clock;
}): ConfigurationValidationReport => {
  const issues: ConfigurationValidationIssue[] = [
    ...input.effective.conflicts.map(conflictToValidationIssue),
  ];
  for (const schema of input.schemaRegistry.all()) {
    const present = effectiveValuePresent(input.effective, schema.key);
    const value = effectiveValue(input.effective, schema.key);
    if ((schema.required || schema.failClosed) && !present) {
      issues.push({
        phase: "EFFECTIVE_CONFIGURATION",
        severity: schema.failClosed ? "CRITICAL" : "ERROR",
        key: schema.key,
        message: `required configuration value is missing: ${schema.key}`,
      });
    }
    if (present) {
      issues.push(
        ...validateValueAgainstSchema({
          schema,
          value,
          phase: "EFFECTIVE_CONFIGURATION",
        }),
      );
    }
    issues.push(
      ...validateDependencies(schema.key, input.effective, schema.dependencies ?? []),
      ...validateMutualExclusions(schema.key, input.effective, schema.mutuallyExclusiveWith ?? []),
      ...validateConditionals(schema.key, input.effective, schema.conditionals ?? []),
      ...validateCrossFieldRules(schema.key, input.effective, schema.crossFieldRules ?? []),
    );
  }
  return createConfigurationValidationReport({
    clock: input.clock,
    schemaFingerprint: input.schemaRegistry.fingerprint(),
    issues,
    snapshotId: input.effective.snapshotId,
    context: input.effective.context,
  });
};

const validateDependencies = (
  key: ConfigurationKey,
  effective: EffectiveConfiguration,
  dependencies: readonly {
    key: ConfigurationKey;
    required?: boolean;
    allowedValues?: readonly ConfigurationValue[];
    message?: string;
  }[],
): readonly ConfigurationValidationIssue[] => {
  const issues: ConfigurationValidationIssue[] = [];
  for (const dependency of dependencies) {
    const present = effectiveValuePresent(effective, dependency.key);
    const value = effectiveValue(effective, dependency.key);
    if (dependency.required === true && !present) {
      issues.push({
        phase: "DEPENDENCY",
        severity: "ERROR",
        key,
        dependencyKey: dependency.key,
        message: dependency.message ?? `configuration ${key} requires ${dependency.key}`,
      });
    }
    if (
      present &&
      dependency.allowedValues !== undefined &&
      !dependency.allowedValues.some((allowed) => configurationValuesEqual(value, allowed))
    ) {
      issues.push({
        phase: "DEPENDENCY",
        severity: "ERROR",
        key,
        dependencyKey: dependency.key,
        message:
          dependency.message ??
          `configuration ${key} requires ${dependency.key} to have an allowed value`,
      });
    }
  }
  return issues;
};

const validateMutualExclusions = (
  key: ConfigurationKey,
  effective: EffectiveConfiguration,
  exclusions: readonly { key: ConfigurationKey; message?: string }[],
): readonly ConfigurationValidationIssue[] =>
  exclusions
    .filter(
      (exclusion) =>
        effectiveValuePresent(effective, key) && effectiveValuePresent(effective, exclusion.key),
    )
    .map((exclusion) => ({
      phase: "DEPENDENCY" as const,
      severity: "ERROR" as const,
      key,
      dependencyKey: exclusion.key,
      message:
        exclusion.message ?? `configuration ${key} is mutually exclusive with ${exclusion.key}`,
    }));

const validateConditionals = (
  key: ConfigurationKey,
  effective: EffectiveConfiguration,
  conditionals: readonly {
    when: {
      key: ConfigurationKey;
      present?: boolean;
      equals?: ConfigurationValue;
      oneOf?: readonly ConfigurationValue[];
    };
    then: {
      required?: boolean;
      forbidden?: boolean;
      allowedValues?: readonly ConfigurationValue[];
    };
    message?: string;
  }[],
): readonly ConfigurationValidationIssue[] => {
  const issues: ConfigurationValidationIssue[] = [];
  for (const conditional of conditionals) {
    if (!predicateMatches(effective, conditional.when)) {
      continue;
    }
    const present = effectiveValuePresent(effective, key);
    const value = effectiveValue(effective, key);
    if (conditional.then.required === true && !present) {
      issues.push({
        phase: "CONDITIONAL",
        severity: "ERROR",
        key,
        dependencyKey: conditional.when.key,
        message: conditional.message ?? `configuration ${key} is required by conditional rule`,
      });
    }
    if (conditional.then.forbidden === true && present) {
      issues.push({
        phase: "CONDITIONAL",
        severity: "ERROR",
        key,
        dependencyKey: conditional.when.key,
        message: conditional.message ?? `configuration ${key} is forbidden by conditional rule`,
      });
    }
    if (
      present &&
      conditional.then.allowedValues !== undefined &&
      !conditional.then.allowedValues.some((allowed) => configurationValuesEqual(value, allowed))
    ) {
      issues.push({
        phase: "CONDITIONAL",
        severity: "ERROR",
        key,
        dependencyKey: conditional.when.key,
        message:
          conditional.message ??
          `configuration ${key} is outside the values allowed by conditional rule`,
      });
    }
  }
  return issues;
};

const validateCrossFieldRules = (
  key: ConfigurationKey,
  effective: EffectiveConfiguration,
  rules: readonly {
    ruleId: "RUNTIME_MODE_MATCHES_CONTEXT" | "VALUES_MUST_DIFFER" | "VALUES_MUST_MATCH";
    keys: readonly ConfigurationKey[];
    message?: string;
  }[],
): readonly ConfigurationValidationIssue[] => {
  const issues: ConfigurationValidationIssue[] = [];
  for (const rule of rules) {
    if (rule.ruleId === "RUNTIME_MODE_MATCHES_CONTEXT") {
      const contextRuntimeMode = runtimeModeFromContext(effective.context);
      const runtimeValue = effectiveValue(effective, key);
      if (
        contextRuntimeMode !== undefined &&
        runtimeValue !== undefined &&
        !configurationValuesEqual(runtimeValue, contextRuntimeMode)
      ) {
        issues.push({
          phase: "CROSS_FIELD",
          severity: "ERROR",
          key,
          message:
            rule.message ?? `configuration ${key} must match the resolution runtime mode context`,
        });
      }
      continue;
    }
    const comparedValues = rule.keys.map((comparedKey) => effectiveValue(effective, comparedKey));
    if (comparedValues.some((value) => value === undefined)) {
      continue;
    }
    const [firstValue, ...remainingValues] = comparedValues;
    const allMatch = remainingValues.every((value) => configurationValuesEqual(firstValue, value));
    if (rule.ruleId === "VALUES_MUST_MATCH" && !allMatch) {
      issues.push({
        phase: "CROSS_FIELD",
        severity: "ERROR",
        key,
        message: rule.message ?? `configuration values must match for ${rule.keys.join(", ")}`,
      });
    }
    if (rule.ruleId === "VALUES_MUST_DIFFER" && allMatch) {
      issues.push({
        phase: "CROSS_FIELD",
        severity: "ERROR",
        key,
        message: rule.message ?? `configuration values must differ for ${rule.keys.join(", ")}`,
      });
    }
  }
  return issues;
};

const conflictToValidationIssue = (
  conflict: ConfigurationConflict,
): ConfigurationValidationIssue => ({
  phase: "STRUCTURAL",
  severity:
    conflict.type === "SOURCE_FAILURE" || conflict.type === "MISSING_REQUIRED_CONFIGURATION"
      ? "CRITICAL"
      : "ERROR",
  message: conflict.message,
  ...(conflict.key === undefined ? {} : { key: conflict.key }),
});
