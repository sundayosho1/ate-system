import type { RuntimeMode } from "@ate/domain";

import type {
  ConfigurationDefinition,
  ConfigurationDefinitionMetadata,
  ConfigurationDomain,
  ConfigurationKey,
  ConfigurationMergePolicy,
  ConfigurationScopeType,
  ConfigurationSensitivity,
  ConfigurationValue,
  ConfigurationValueType,
} from "./types.js";

export type ConfigurationObjectPropertySchema = Readonly<{
  valueType: ConfigurationValueType;
  required?: boolean;
  constraints?: ConfigurationValueConstraints;
}>;

export type ConfigurationValueConstraints = Readonly<{
  enumValues?: readonly ConfigurationValue[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  unit?: "milliseconds" | "seconds" | "percent" | "count" | "identifier";
  requiredProperties?: readonly string[];
  properties?: Readonly<Record<string, ConfigurationObjectPropertySchema>>;
  allowUnknownProperties?: boolean;
  minItems?: number;
  maxItems?: number;
  itemValueType?: ConfigurationValueType;
  secretProviders?: readonly string[];
  secretRefPattern?: string;
}>;

export type ConfigurationDependencyRule = Readonly<{
  key: ConfigurationKey;
  required?: boolean;
  allowedValues?: readonly ConfigurationValue[];
  message?: string;
}>;

export type ConfigurationMutualExclusionRule = Readonly<{
  key: ConfigurationKey;
  message?: string;
}>;

export type ConfigurationConditionalPredicate = Readonly<{
  key: ConfigurationKey;
  present?: boolean;
  equals?: ConfigurationValue;
  oneOf?: readonly ConfigurationValue[];
}>;

export type ConfigurationConditionalConsequence = Readonly<{
  required?: boolean;
  forbidden?: boolean;
  allowedValues?: readonly ConfigurationValue[];
}>;

export type ConfigurationConditionalRule = Readonly<{
  when: ConfigurationConditionalPredicate;
  then: ConfigurationConditionalConsequence;
  message?: string;
}>;

export type ConfigurationCrossFieldRule = Readonly<{
  ruleId: "RUNTIME_MODE_MATCHES_CONTEXT" | "VALUES_MUST_DIFFER" | "VALUES_MUST_MATCH";
  keys: readonly ConfigurationKey[];
  message?: string;
}>;

export type ConfigurationSchemaMetadata = ConfigurationDefinitionMetadata &
  Readonly<{
    helpText?: string;
    examples?: readonly ConfigurationValue[];
    invalidExamples?: readonly ConfigurationValue[];
    units?: string;
    approvalClassification?: "STANDARD" | "SENSITIVE" | "CRITICAL";
    approvalRequired?: boolean;
    governanceCategory?: string;
    requiredCheckerAuthority?:
      | "CONFIGURATION_CHECKER"
      | "SENSITIVE_CONFIGURATION_CHECKER"
      | "CRITICAL_CONFIGURATION_CHECKER";
    governanceHelpText?: string;
  }>;

export type ConfigurationSchema = Readonly<{
  key: ConfigurationKey;
  domain: ConfigurationDomain;
  displayName: string;
  description: string;
  valueType: ConfigurationValueType;
  required: boolean;
  failClosed: boolean;
  allowedScopes: readonly ConfigurationScopeType[];
  allowedRuntimeModes?: readonly RuntimeMode[];
  mergePolicy: ConfigurationMergePolicy;
  sensitivity: ConfigurationSensitivity;
  defaultValue?: ConfigurationValue;
  constraints?: ConfigurationValueConstraints;
  dependencies?: readonly ConfigurationDependencyRule[];
  mutuallyExclusiveWith?: readonly ConfigurationMutualExclusionRule[];
  conditionals?: readonly ConfigurationConditionalRule[];
  crossFieldRules?: readonly ConfigurationCrossFieldRule[];
  metadata?: ConfigurationSchemaMetadata;
}>;

export const configurationSchemaFromDefinition = (
  definition: ConfigurationDefinition,
  overrides: Partial<ConfigurationSchema> = {},
): ConfigurationSchema => ({
  key: definition.key,
  domain: definition.domain,
  displayName: definition.displayName,
  description: definition.description,
  valueType: definition.valueType,
  required: definition.required,
  failClosed: definition.failClosed,
  allowedScopes: definition.allowedScopes,
  mergePolicy: definition.mergePolicy,
  sensitivity: definition.sensitivity,
  ...(definition.defaultValue === undefined ? {} : { defaultValue: definition.defaultValue }),
  ...(definition.metadata === undefined ? {} : { metadata: definition.metadata }),
  ...overrides,
});
