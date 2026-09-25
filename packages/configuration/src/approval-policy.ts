import type { Clock } from "@ate/time";

import { capabilityId } from "./capability-registry.js";
import type { CapabilityRegistry, FeatureFlagRegistry } from "./capability-registry.js";
import type { ConfigurationSchemaRegistry } from "./schema-registry.js";
import { freeze } from "./context.js";
import { configurationError, fail, ok } from "./errors.js";
import { fingerprint } from "./serialization.js";
import type {
  ApprovalClassification,
  ApprovalPolicyCondition,
  ApprovalRequirementEvaluation,
  ApprovalRequirementReasonCode,
  CapabilityImpactSummary,
  ConfigurationApprovalPolicy,
  ConfigurationApprovalPolicyId,
  ConfigurationApprovalPolicyMatch,
} from "./approval-types.js";
import type { CapabilityId } from "./capability-types.js";
import type {
  ConfigurationDomain,
  ConfigurationFingerprint,
  ConfigurationKey,
  ConfigurationResult,
  ConfigurationScope,
} from "./types.js";
import type { ConfigurationVersion } from "./version-types.js";

const dottedIdPattern = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/u;
const classificationRank: Readonly<Record<ApprovalClassification, number>> = {
  STANDARD: 0,
  SENSITIVE: 1,
  CRITICAL: 2,
};
const authorityRank = {
  CONFIGURATION_CHECKER: 0,
  SENSITIVE_CONFIGURATION_CHECKER: 1,
  CRITICAL_CONFIGURATION_CHECKER: 2,
} as const;

export const configurationApprovalPolicyId = (value: string): ConfigurationApprovalPolicyId => {
  if (!dottedIdPattern.test(value)) {
    throw new Error(`configuration approval policy id is not canonical: ${value}`);
  }
  return value as ConfigurationApprovalPolicyId;
};

export class ConfigurationApprovalPolicyRegistry {
  private readonly policies = new Map<ConfigurationApprovalPolicyId, ConfigurationApprovalPolicy>();

  public constructor(private readonly clock: Clock) {}

  public register(
    policy: ConfigurationApprovalPolicy,
  ): ConfigurationResult<ConfigurationApprovalPolicy> {
    if (this.policies.has(policy.policyId)) {
      return fail(
        configurationError({
          code: "APPROVAL_POLICY_DUPLICATE",
          message: `configuration approval policy already registered: ${policy.policyId}`,
          timestamp: this.clock.now(),
        }),
      );
    }
    const invalid = validatePolicy(policy, this.clock);
    if (invalid !== undefined) {
      return fail(invalid);
    }
    this.policies.set(policy.policyId, freeze({ ...policy }));
    return ok(policy);
  }

  public require(
    policyId: ConfigurationApprovalPolicyId,
  ): ConfigurationResult<ConfigurationApprovalPolicy> {
    const policy = this.policies.get(policyId);
    if (policy === undefined) {
      return fail(
        configurationError({
          code: "APPROVAL_POLICY_UNKNOWN",
          message: `configuration approval policy not found: ${policyId}`,
          timestamp: this.clock.now(),
        }),
      );
    }
    return ok(policy);
  }

  public all(): readonly ConfigurationApprovalPolicy[] {
    return [...this.policies.values()].sort((left, right) =>
      left.policyId.localeCompare(right.policyId),
    );
  }

  public fingerprint(): ConfigurationFingerprint {
    return fingerprint(this.all().filter((policy) => policy.enabled));
  }

  public validate(): ConfigurationResult<readonly ConfigurationApprovalPolicy[]> {
    for (const policy of this.all()) {
      const invalid = validatePolicy(policy, this.clock);
      if (invalid !== undefined) {
        return fail(invalid);
      }
    }
    return ok(this.all());
  }
}

export type ApprovalRequirementEvaluationInput = Readonly<{
  version: ConfigurationVersion;
  policyRegistry: ConfigurationApprovalPolicyRegistry;
  clock: Clock;
  schemaRegistry?: ConfigurationSchemaRegistry;
  capabilityRegistry?: CapabilityRegistry;
  featureFlagRegistry?: FeatureFlagRegistry;
}>;

export const evaluateApprovalRequirement = (
  input: ApprovalRequirementEvaluationInput,
): ConfigurationResult<ApprovalRequirementEvaluation> => {
  const validPolicies = input.policyRegistry.validate();
  if (!validPolicies.ok) {
    return validPolicies;
  }
  const affectedKeys = uniqueKeys(
    input.version.changeSet.operations.map((operation) => operation.key),
  );
  const affectedScopes = freeze(
    input.version.changeSet.operations.map((operation) => operation.scope),
  );
  const affectedDomains = uniqueDomains(
    input.version.changeSet.operations.map((operation) => {
      const entry = input.version.content.entries.find(
        (candidate) => candidate.identity === operation.identity,
      );
      return entry?.domain;
    }),
  );
  const capabilityImpact = analyzeCapabilityImpact({
    affectedKeys,
    ...(input.capabilityRegistry === undefined
      ? {}
      : { capabilityRegistry: input.capabilityRegistry }),
    ...(input.featureFlagRegistry === undefined
      ? {}
      : { featureFlagRegistry: input.featureFlagRegistry }),
  });
  const policiesConsidered = validPolicies.value.map((policy) => policy.policyId);
  const matches = validPolicies.value
    .filter((policy) => policy.enabled)
    .filter((policy) =>
      policy.conditions.some((condition) =>
        conditionMatches({
          condition,
          version: input.version,
          affectedKeys,
          affectedScopes,
          affectedDomains,
          affectedCapabilities: capabilityImpact.affectedCapabilities,
          ...(input.schemaRegistry === undefined ? {} : { schemaRegistry: input.schemaRegistry }),
        }),
      ),
    )
    .map(policyToMatch);
  const effectiveMatches =
    matches.length > 0
      ? matches
      : [
          policyToMatch({
            policyId: configurationApprovalPolicyId("configuration.approval.standardChange"),
            displayName: "Implicit Standard Change",
            description: "Implicit standard approval-not-required classification.",
            version: 1,
            enabled: true,
            classification: "STANDARD",
            approvalRequired: false,
            requiredAuthority: "CONFIGURATION_CHECKER",
            requiredApprovalCount: 0,
            conditions: [{ minimumChangeCount: 0 }],
            reasonCodes: ["STANDARD_CHANGE", "APPROVAL_NOT_REQUIRED"],
          }),
        ];
  const classification = strictestClassification(effectiveMatches);
  const primaryMatch = strictestMatch(effectiveMatches);
  const approvalRequired = effectiveMatches.some((match) => match.approvalRequired);
  const requiredApprovalCount = approvalRequired
    ? Math.max(1, ...effectiveMatches.map((match) => match.requiredApprovalCount))
    : 0;
  const requiredAuthority = strictestAuthority(effectiveMatches);
  const expiresAfterMs = minDefined(effectiveMatches.map((match) => match.expiresAfterMs));
  const reasonCodes = uniqueReasons([
    ...effectiveMatches.flatMap((match) => match.reasonCodes),
    ...capabilityImpactReasons(capabilityImpact),
    ...(approvalRequired ? [] : (["APPROVAL_NOT_REQUIRED"] as const)),
  ]);
  const policyFingerprint = fingerprint({
    registry: input.policyRegistry.fingerprint(),
    matched: effectiveMatches,
  });
  const evaluationFingerprint = fingerprint({
    versionId: input.version.versionId,
    configurationFingerprint: input.version.configurationFingerprint,
    changeSetFingerprint: input.version.changeSetFingerprint,
    schemaFingerprint: input.version.schemaFingerprint,
    classification,
    approvalRequired,
    policyFingerprint,
    affectedKeys,
    affectedCapabilities: capabilityImpact.affectedCapabilities,
  });
  return ok(
    freeze({
      evaluationId: approvalEvaluationId(evaluationFingerprint),
      versionId: input.version.versionId,
      streamId: input.version.streamId,
      runtimeMode: input.version.runtimeMode,
      evaluatedAt: input.clock.now(),
      approvalRequired,
      classification,
      policyId: primaryMatch.policyId,
      policyFingerprint,
      reasonCodes,
      affectedKeys,
      affectedScopes,
      affectedCapabilities: capabilityImpact.affectedCapabilities,
      capabilityImpactFingerprint: capabilityImpact.fingerprint,
      requiredAuthority,
      requiredApprovalCount,
      ...(expiresAfterMs === undefined ? {} : { expiresAfterMs }),
      policiesConsidered,
      policiesMatched: effectiveMatches,
      fingerprint: evaluationFingerprint,
    }),
  );
};

export const foundationalApprovalPolicies = (): readonly ConfigurationApprovalPolicy[] => [
  {
    policyId: configurationApprovalPolicyId("configuration.approval.standardChange"),
    displayName: "Standard Configuration Change",
    description: "Standard valid configuration changes do not require independent review.",
    version: 1,
    enabled: true,
    classification: "STANDARD",
    approvalRequired: false,
    requiredAuthority: "CONFIGURATION_CHECKER",
    requiredApprovalCount: 0,
    conditions: [{ minimumChangeCount: 0 }],
    reasonCodes: ["STANDARD_CHANGE", "APPROVAL_NOT_REQUIRED"],
  },
  {
    policyId: configurationApprovalPolicyId("configuration.approval.sensitiveConfiguration"),
    displayName: "Sensitive Configuration Change",
    description:
      "Sensitive configuration keys and capability-control flags require an independent checker.",
    version: 1,
    enabled: true,
    classification: "SENSITIVE",
    approvalRequired: true,
    requiredAuthority: "SENSITIVE_CONFIGURATION_CHECKER",
    requiredApprovalCount: 1,
    conditions: [
      { keyPrefixes: ["system.feature."] },
      { governanceCategories: ["SENSITIVE", "CAPABILITY_CONTROL"] },
    ],
    reasonCodes: ["SENSITIVE_KEY_CHANGED"],
  },
  {
    policyId: configurationApprovalPolicyId("configuration.approval.governancePolicyChange"),
    displayName: "Governance Policy Change",
    description:
      "Changes that could weaken approval governance are critical and require critical checker authority.",
    version: 1,
    enabled: true,
    classification: "CRITICAL",
    approvalRequired: true,
    requiredAuthority: "CRITICAL_CONFIGURATION_CHECKER",
    requiredApprovalCount: 1,
    conditions: [{ keyPrefixes: ["system.approval.", "system.governance."] }],
    reasonCodes: ["GOVERNANCE_POLICY_CHANGED", "CRITICAL_KEY_CHANGED"],
  },
];

export const registerApprovalPolicies = (
  registry: ConfigurationApprovalPolicyRegistry,
  policies: readonly ConfigurationApprovalPolicy[] = foundationalApprovalPolicies(),
): ConfigurationResult<readonly ConfigurationApprovalPolicy[]> => {
  for (const policy of policies) {
    const registered = registry.register(policy);
    if (!registered.ok) {
      return registered;
    }
  }
  return registry.validate();
};

const validatePolicy = (policy: ConfigurationApprovalPolicy, clock: Clock) => {
  if (!policy.enabled) {
    return undefined;
  }
  if (policy.conditions.length === 0) {
    return configurationError({
      code: "APPROVAL_POLICY_INVALID",
      message: `approval policy has no bounded conditions: ${policy.policyId}`,
      timestamp: clock.now(),
    });
  }
  if (policy.requiredApprovalCount < 0 || !Number.isInteger(policy.requiredApprovalCount)) {
    return configurationError({
      code: "APPROVAL_POLICY_INVALID",
      message: `approval policy has invalid approval count: ${policy.policyId}`,
      timestamp: clock.now(),
    });
  }
  if (policy.approvalRequired && policy.requiredApprovalCount < 1) {
    return configurationError({
      code: "APPROVAL_POLICY_INVALID",
      message: `approval-required policy must require at least one checker: ${policy.policyId}`,
      timestamp: clock.now(),
    });
  }
  if (policy.expiresAfterMs !== undefined && policy.expiresAfterMs <= 0) {
    return configurationError({
      code: "APPROVAL_POLICY_INVALID",
      message: `approval policy expiry must be positive: ${policy.policyId}`,
      timestamp: clock.now(),
    });
  }
  return undefined;
};

const conditionMatches = (input: {
  condition: ApprovalPolicyCondition;
  version: ConfigurationVersion;
  affectedKeys: readonly ConfigurationKey[];
  affectedScopes: readonly ConfigurationScope[];
  affectedDomains: readonly ConfigurationDomain[];
  affectedCapabilities: readonly CapabilityId[];
  schemaRegistry?: ConfigurationSchemaRegistry;
}): boolean => {
  const checks: boolean[] = [];
  const condition = input.condition;
  if (condition.keys !== undefined) {
    checks.push(condition.keys.some((key) => input.affectedKeys.includes(key)));
  }
  if (condition.keyPrefixes !== undefined) {
    checks.push(
      condition.keyPrefixes.some((prefix) =>
        input.affectedKeys.some((key) => key.startsWith(prefix)),
      ),
    );
  }
  if (condition.domains !== undefined) {
    checks.push(condition.domains.some((domain) => input.affectedDomains.includes(domain)));
  }
  if (condition.scopeTypes !== undefined) {
    checks.push(
      condition.scopeTypes.some((scopeType) =>
        input.affectedScopes.some((scope) => scope.scopeType === scopeType),
      ),
    );
  }
  if (condition.runtimeModes !== undefined) {
    checks.push(condition.runtimeModes.includes(input.version.runtimeMode));
  }
  if (condition.capabilityIds !== undefined) {
    checks.push(
      condition.capabilityIds.some((capability) => input.affectedCapabilities.includes(capability)),
    );
  }
  if (condition.minimumChangeCount !== undefined) {
    checks.push(input.version.changeSet.operationCount >= condition.minimumChangeCount);
  }
  if (condition.governanceCategories !== undefined) {
    const categories = input.affectedKeys.flatMap((key) => {
      const schema = input.schemaRegistry?.require(key);
      const metadata = schema?.ok === true ? schema.value.metadata : undefined;
      return [
        metadata?.approvalClassification,
        metadata?.governanceCategory,
        metadata?.approvalRequired === true ? "SENSITIVE" : undefined,
      ].filter((value): value is string => value !== undefined);
    });
    checks.push(condition.governanceCategories.some((category) => categories.includes(category)));
  }
  return checks.length > 0 && checks.every(Boolean);
};

const policyToMatch = (policy: ConfigurationApprovalPolicy): ConfigurationApprovalPolicyMatch =>
  freeze({
    policyId: policy.policyId,
    classification: policy.classification,
    approvalRequired: policy.approvalRequired,
    requiredAuthority: policy.requiredAuthority,
    requiredApprovalCount: policy.requiredApprovalCount,
    reasonCodes: policy.reasonCodes,
    ...(policy.expiresAfterMs === undefined ? {} : { expiresAfterMs: policy.expiresAfterMs }),
  });

export const analyzeCapabilityImpact = (input: {
  affectedKeys: readonly ConfigurationKey[];
  capabilityRegistry?: CapabilityRegistry;
  featureFlagRegistry?: FeatureFlagRegistry;
}): CapabilityImpactSummary => {
  const affectedCapabilities = uniqueCapabilities(
    input.affectedKeys.flatMap(
      (key) =>
        input.featureFlagRegistry
          ?.all()
          .filter((flag) => flag.key === key)
          .flatMap((flag) => flag.controls) ?? [],
    ),
  );
  const definitions = affectedCapabilities
    .map((id) => input.capabilityRegistry?.require(id))
    .filter((result) => result?.ok === true)
    .map((result) => result.value);
  const mandatoryCoreAffected = definitions.some(
    (definition) => definition.capabilityClass === "MANDATORY_CORE",
  );
  const futureCapitalBearingAffected = definitions.some(
    (definition) =>
      definition.implementationStatus === "NOT_IMPLEMENTED" &&
      (definition.capabilityId === capabilityId("execution.liveTrading") ||
        definition.capabilityId === capabilityId("execution.mt5") ||
        definition.capabilityId === capabilityId("data.marketData")),
  );
  const restartRequiredAffected = definitions.some(
    (definition) => definition.reloadBehavior === "RESTART_REQUIRED",
  );
  return freeze({
    affectedCapabilities,
    mandatoryCoreAffected,
    futureCapitalBearingAffected,
    restartRequiredAffected,
    fingerprint: fingerprint({
      affectedCapabilities,
      mandatoryCoreAffected,
      futureCapitalBearingAffected,
      restartRequiredAffected,
    }),
  });
};

const capabilityImpactReasons = (
  impact: CapabilityImpactSummary,
): ApprovalRequirementReasonCode[] => [
  ...(impact.affectedCapabilities.length > 0 ? (["SENSITIVE_CAPABILITY_AFFECTED"] as const) : []),
  ...(impact.mandatoryCoreAffected ? (["MANDATORY_CORE_AFFECTED"] as const) : []),
  ...(impact.futureCapitalBearingAffected
    ? (["CAPITAL_BEARING_FOUNDATION_AFFECTED"] as const)
    : []),
  ...(impact.restartRequiredAffected ? (["RESTART_REQUIRED_SENSITIVE_CHANGE"] as const) : []),
];

const approvalEvaluationId = (value: string) =>
  `appreval-${value.replace("sha256:", "").slice(0, 24)}` as ApprovalRequirementEvaluation["evaluationId"];

const strictestClassification = (
  matches: readonly ConfigurationApprovalPolicyMatch[],
): ApprovalClassification =>
  matches.reduce<ApprovalClassification>(
    (strictest, match) =>
      classificationRank[match.classification] > classificationRank[strictest]
        ? match.classification
        : strictest,
    "STANDARD",
  );

const strictestAuthority = (
  matches: readonly ConfigurationApprovalPolicyMatch[],
): ConfigurationApprovalPolicyMatch["requiredAuthority"] =>
  matches.reduce<ConfigurationApprovalPolicyMatch["requiredAuthority"]>(
    (strictest, match) =>
      authorityRank[match.requiredAuthority] > authorityRank[strictest]
        ? match.requiredAuthority
        : strictest,
    "CONFIGURATION_CHECKER",
  );

const strictestMatch = (
  matches: readonly ConfigurationApprovalPolicyMatch[],
): ConfigurationApprovalPolicyMatch =>
  [...matches].sort(
    (left, right) =>
      classificationRank[right.classification] - classificationRank[left.classification] ||
      authorityRank[right.requiredAuthority] - authorityRank[left.requiredAuthority] ||
      right.requiredApprovalCount - left.requiredApprovalCount ||
      left.policyId.localeCompare(right.policyId),
  )[0]!;

const minDefined = (values: readonly (number | undefined)[]): number | undefined => {
  const defined = values.filter((value): value is number => value !== undefined);
  return defined.length === 0 ? undefined : Math.min(...defined);
};

const uniqueKeys = (keys: readonly ConfigurationKey[]): readonly ConfigurationKey[] =>
  freeze([...new Set(keys)].sort((left, right) => left.localeCompare(right)));

const uniqueDomains = (
  domains: readonly (ConfigurationDomain | undefined)[],
): readonly ConfigurationDomain[] =>
  freeze(
    [
      ...new Set(domains.filter((domain): domain is ConfigurationDomain => domain !== undefined)),
    ].sort(),
  );

const uniqueCapabilities = (capabilities: readonly CapabilityId[]): readonly CapabilityId[] =>
  freeze([...new Set(capabilities)].sort((left, right) => left.localeCompare(right)));

const uniqueReasons = (
  reasons: readonly ApprovalRequirementReasonCode[],
): readonly ApprovalRequirementReasonCode[] => freeze([...new Set(reasons)]);
