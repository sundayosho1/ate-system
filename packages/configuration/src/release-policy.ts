import { runtimeModes, type RuntimeMode } from "@ate/domain";
import type { Clock } from "@ate/time";

import { freeze } from "./context.js";
import { configurationError, fail, ok } from "./errors.js";
import { fingerprint } from "./serialization.js";
import type { ConfigurationFingerprint, ConfigurationResult } from "./types.js";
import type {
  ConfigurationEnvironment,
  ConfigurationPromotionPolicy,
  ConfigurationPromotionPolicyId,
  ConfigurationPromotionPolicyMatch,
} from "./release-types.js";

const dottedIdPattern = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/u;

export const configurationPromotionPolicyId = (value: string): ConfigurationPromotionPolicyId => {
  if (!dottedIdPattern.test(value)) {
    throw new Error(`configuration promotion policy id is not canonical: ${value}`);
  }
  return value as ConfigurationPromotionPolicyId;
};

export const configurationEnvironments = runtimeModes;

export const canonicalPromotionEdges: readonly Readonly<{
  source: ConfigurationEnvironment;
  destination: ConfigurationEnvironment;
}>[] = [
  { source: "DEVELOPMENT", destination: "RESEARCH" },
  { source: "RESEARCH", destination: "BACKTEST" },
  { source: "BACKTEST", destination: "SIMULATION" },
  { source: "SIMULATION", destination: "PAPER" },
  { source: "PAPER", destination: "LIVE" },
];

export class ConfigurationPromotionGraph {
  private readonly edges: ReadonlySet<string>;

  public constructor(edges = canonicalPromotionEdges) {
    this.edges = new Set(edges.map(edgeIdentity));
  }

  public allows(
    source: ConfigurationEnvironment,
    destination: ConfigurationEnvironment,
    allowSameEnvironmentRelease = true,
  ): boolean {
    if (source === destination) {
      return allowSameEnvironmentRelease;
    }
    return this.edges.has(edgeIdentity({ source, destination }));
  }

  public all(): readonly Readonly<{
    source: ConfigurationEnvironment;
    destination: ConfigurationEnvironment;
  }>[] {
    return [...this.edges].map((edge) => {
      const [source, destination] = edge.split("->") as [
        ConfigurationEnvironment,
        ConfigurationEnvironment,
      ];
      return freeze({ source, destination });
    });
  }
}

export class ConfigurationPromotionPolicyRegistry {
  private readonly policies = new Map<
    ConfigurationPromotionPolicyId,
    ConfigurationPromotionPolicy
  >();

  public constructor(private readonly clock: Clock) {}

  public register(
    policy: ConfigurationPromotionPolicy,
  ): ConfigurationResult<ConfigurationPromotionPolicy> {
    if (this.policies.has(policy.policyId)) {
      return fail(
        configurationError({
          code: "PROMOTION_POLICY_CONFLICT",
          message: `configuration promotion policy already registered: ${policy.policyId}`,
          timestamp: this.clock.now(),
        }),
      );
    }
    const invalid = validatePromotionPolicy(policy, this.clock);
    if (invalid !== undefined) {
      return fail(invalid);
    }
    this.policies.set(policy.policyId, freeze({ ...policy }));
    return ok(policy);
  }

  public require(
    policyId: ConfigurationPromotionPolicyId,
  ): ConfigurationResult<ConfigurationPromotionPolicy> {
    const policy = this.policies.get(policyId);
    if (policy === undefined) {
      return fail(
        configurationError({
          code: "PROMOTION_POLICY_UNKNOWN",
          message: `configuration promotion policy not found: ${policyId}`,
          timestamp: this.clock.now(),
        }),
      );
    }
    return ok(policy);
  }

  public policyFor(
    source: ConfigurationEnvironment,
    destination: ConfigurationEnvironment,
  ): ConfigurationResult<ConfigurationPromotionPolicy> {
    const policy = this.all().find(
      (candidate) =>
        candidate.enabled && candidate.source === source && candidate.destination === destination,
    );
    if (policy === undefined) {
      return fail(
        configurationError({
          code: "PROMOTION_POLICY_UNKNOWN",
          message: `no promotion policy registered for ${source} -> ${destination}`,
          timestamp: this.clock.now(),
        }),
      );
    }
    return ok(policy);
  }

  public all(): readonly ConfigurationPromotionPolicy[] {
    return [...this.policies.values()].sort((left, right) =>
      left.policyId.localeCompare(right.policyId),
    );
  }

  public validate(): ConfigurationResult<readonly ConfigurationPromotionPolicy[]> {
    for (const policy of this.all()) {
      const invalid = validatePromotionPolicy(policy, this.clock);
      if (invalid !== undefined) {
        return fail(invalid);
      }
    }
    return ok(this.all());
  }

  public fingerprint(): ConfigurationFingerprint {
    return fingerprint(this.all().filter((policy) => policy.enabled));
  }
}

export const foundationalPromotionPolicies = (): readonly ConfigurationPromotionPolicy[] => [
  ...canonicalPromotionEdges.map((edge) =>
    promotionPolicy({
      policyId: configurationPromotionPolicyId(
        `configuration.release.${edge.source.toLowerCase()}To${capitalize(edge.destination.toLowerCase())}`,
      ),
      displayName: `${edge.source} to ${edge.destination}`,
      description:
        "Default explicit adjacent environment promotion policy for configuration release governance.",
      source: edge.source,
      destination: edge.destination,
      approvalRequirement: edge.destination === "LIVE" ? "SOURCE_VERSION_APPROVAL" : "NONE",
    }),
  ),
  ...runtimeModes.map((mode) =>
    promotionPolicy({
      policyId: configurationPromotionPolicyId(
        `configuration.release.${mode.toLowerCase()}Activation`,
      ),
      displayName: `${mode} same-environment activation`,
      description:
        "Default same-environment release policy for activating a newer governed configuration version.",
      source: mode,
      destination: mode,
      approvalRequirement: mode === "LIVE" ? "SOURCE_VERSION_APPROVAL" : "NONE",
    }),
  ),
];

export const registerPromotionPolicies = (
  registry: ConfigurationPromotionPolicyRegistry,
  policies: readonly ConfigurationPromotionPolicy[] = foundationalPromotionPolicies(),
): ConfigurationResult<readonly ConfigurationPromotionPolicy[]> => {
  for (const policy of policies) {
    const registered = registry.register(policy);
    if (!registered.ok) {
      return registered;
    }
  }
  return registry.validate();
};

export const promotionPolicyFingerprint = (
  policy: ConfigurationPromotionPolicy,
): ConfigurationFingerprint => fingerprint(policyToMatch(policy));

export const policyToMatch = (
  policy: ConfigurationPromotionPolicy,
): ConfigurationPromotionPolicyMatch =>
  freeze({
    policyId: policy.policyId,
    source: policy.source,
    destination: policy.destination,
    approvalRequirement: policy.approvalRequirement,
    requiredPromotionAuthority: policy.requiredPromotionAuthority,
    requiredPromotionApprovalCount: policy.requiredPromotionApprovalCount,
    rollbackRequiresApproval: policy.rollbackRequiresApproval,
    allowSchemaFingerprintChange: policy.allowSchemaFingerprintChange,
    allowRestartRequiredActivation: policy.allowRestartRequiredActivation,
  });

const promotionPolicy = (
  input: Readonly<{
    policyId: ConfigurationPromotionPolicyId;
    displayName: string;
    description: string;
    source: RuntimeMode;
    destination: RuntimeMode;
    approvalRequirement: ConfigurationPromotionPolicy["approvalRequirement"];
  }>,
): ConfigurationPromotionPolicy =>
  freeze({
    policyId: input.policyId,
    displayName: input.displayName,
    description: input.description,
    version: 1,
    enabled: true,
    source: input.source,
    destination: input.destination,
    allowSameEnvironmentRelease: input.source === input.destination,
    approvalRequirement: input.approvalRequirement,
    requiredPromotionAuthority: "SENSITIVE_CONFIGURATION_CHECKER",
    requiredPromotionApprovalCount: input.approvalRequirement === "PROMOTION_APPROVAL" ? 1 : 0,
    rollbackRequiresApproval: input.destination === "LIVE",
    allowSchemaFingerprintChange: true,
    allowRestartRequiredActivation: true,
  });

const validatePromotionPolicy = (
  policy: ConfigurationPromotionPolicy,
  clock: Clock,
): ReturnType<typeof configurationError> | undefined => {
  if (!policy.enabled) {
    return undefined;
  }
  if (
    !configurationEnvironments.includes(policy.source) ||
    !configurationEnvironments.includes(policy.destination)
  ) {
    return configurationError({
      code: "PROMOTION_POLICY_INVALID",
      message: `promotion policy uses unknown environment: ${policy.policyId}`,
      timestamp: clock.now(),
    });
  }
  if (policy.source === policy.destination && !policy.allowSameEnvironmentRelease) {
    return configurationError({
      code: "PROMOTION_POLICY_INVALID",
      message: `same-environment policy must explicitly allow same-environment release: ${policy.policyId}`,
      timestamp: clock.now(),
    });
  }
  if (
    policy.requiredPromotionApprovalCount < 0 ||
    !Number.isInteger(policy.requiredPromotionApprovalCount)
  ) {
    return configurationError({
      code: "PROMOTION_POLICY_INVALID",
      message: `promotion policy has invalid approval count: ${policy.policyId}`,
      timestamp: clock.now(),
    });
  }
  if (
    policy.approvalRequirement === "PROMOTION_APPROVAL" &&
    policy.requiredPromotionApprovalCount < 1
  ) {
    return configurationError({
      code: "PROMOTION_POLICY_INVALID",
      message: `promotion-approval policy must require at least one checker: ${policy.policyId}`,
      timestamp: clock.now(),
    });
  }
  if (policy.maxPlanAgeMs !== undefined && policy.maxPlanAgeMs <= 0) {
    return configurationError({
      code: "PROMOTION_POLICY_INVALID",
      message: `promotion policy max plan age must be positive: ${policy.policyId}`,
      timestamp: clock.now(),
    });
  }
  return undefined;
};

const edgeIdentity = (edge: {
  source: ConfigurationEnvironment;
  destination: ConfigurationEnvironment;
}): string => `${edge.source}->${edge.destination}`;

const capitalize = (value: string): string => `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
