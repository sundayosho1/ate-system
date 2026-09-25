import type { Clock } from "@ate/time";

import { freeze } from "./context.js";
import { configurationError, fail, ok } from "./errors.js";
import { fingerprint } from "./serialization.js";
import type {
  CapabilityDefinition,
  CapabilityId,
  FeatureFlagDefinition,
  FeatureFlagId,
} from "./capability-types.js";
import type { ConfigurationFingerprint, ConfigurationResult } from "./types.js";

const dottedIdPattern = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/u;

export const capabilityId = (value: string): CapabilityId => {
  if (!dottedIdPattern.test(value)) {
    throw new Error(`capability id is not canonical: ${value}`);
  }
  return value as CapabilityId;
};

export const featureFlagId = (value: string): FeatureFlagId => {
  if (!dottedIdPattern.test(value)) {
    throw new Error(`feature flag id is not canonical: ${value}`);
  }
  return value as FeatureFlagId;
};

export class CapabilityRegistry {
  private readonly definitions = new Map<CapabilityId, CapabilityDefinition>();

  public constructor(private readonly clock: Clock) {}

  public register(definition: CapabilityDefinition): ConfigurationResult<CapabilityDefinition> {
    if (this.definitions.has(definition.capabilityId)) {
      return fail(
        configurationError({
          code: "CONFIGURATION_CAPABILITY_DUPLICATE",
          message: `capability already registered: ${definition.capabilityId}`,
          timestamp: this.clock.now(),
        }),
      );
    }
    if (
      definition.capabilityClass === "FUTURE_UNIMPLEMENTED" &&
      definition.implementationStatus !== "NOT_IMPLEMENTED"
    ) {
      return fail(
        configurationError({
          code: "CONFIGURATION_CAPABILITY_INVALID",
          message: `future capability must not be marked implemented: ${definition.capabilityId}`,
          timestamp: this.clock.now(),
        }),
      );
    }
    if (definition.capabilityClass === "MANDATORY_CORE" && definition.featureFlagId !== undefined) {
      return fail(
        configurationError({
          code: "CONFIGURATION_CAPABILITY_INVALID",
          message: `mandatory core capability cannot be controlled by an ordinary feature flag: ${definition.capabilityId}`,
          timestamp: this.clock.now(),
        }),
      );
    }
    const missingDependency = (definition.dependencies ?? []).find(
      (dependency) => dependency === definition.capabilityId,
    );
    if (missingDependency !== undefined) {
      return fail(
        configurationError({
          code: "CONFIGURATION_CAPABILITY_CYCLE_DETECTED",
          message: `capability cannot depend on itself: ${definition.capabilityId}`,
          timestamp: this.clock.now(),
        }),
      );
    }
    this.definitions.set(definition.capabilityId, freeze({ ...definition }));
    return ok(definition);
  }

  public require(capability: CapabilityId): ConfigurationResult<CapabilityDefinition> {
    const definition = this.definitions.get(capability);
    if (definition === undefined) {
      return fail(
        configurationError({
          code: "CONFIGURATION_CAPABILITY_UNKNOWN",
          message: `unknown capability: ${capability}`,
          timestamp: this.clock.now(),
        }),
      );
    }
    return ok(definition);
  }

  public all(): readonly CapabilityDefinition[] {
    return [...this.definitions.values()].sort((left, right) =>
      left.capabilityId.localeCompare(right.capabilityId),
    );
  }

  public fingerprint(): ConfigurationFingerprint {
    return fingerprint(this.all());
  }

  public validateGraph(): ConfigurationResult<readonly CapabilityDefinition[]> {
    for (const definition of this.all()) {
      for (const dependency of definition.dependencies ?? []) {
        if (!this.definitions.has(dependency)) {
          return fail(
            configurationError({
              code: "CONFIGURATION_CAPABILITY_DEPENDENCY_INVALID",
              message: `capability ${definition.capabilityId} depends on unknown capability ${dependency}`,
              timestamp: this.clock.now(),
            }),
          );
        }
      }
      for (const conflict of definition.conflictsWith ?? []) {
        if (!this.definitions.has(conflict)) {
          return fail(
            configurationError({
              code: "CONFIGURATION_CAPABILITY_DEPENDENCY_INVALID",
              message: `capability ${definition.capabilityId} conflicts with unknown capability ${conflict}`,
              timestamp: this.clock.now(),
            }),
          );
        }
      }
    }
    const cycle = findCycle(this.definitions);
    if (cycle !== undefined) {
      return fail(
        configurationError({
          code: "CONFIGURATION_CAPABILITY_CYCLE_DETECTED",
          message: `capability dependency cycle detected: ${cycle.join(" -> ")}`,
          timestamp: this.clock.now(),
        }),
      );
    }
    return ok(this.all());
  }
}

export class FeatureFlagRegistry {
  private readonly definitions = new Map<FeatureFlagId, FeatureFlagDefinition>();

  public constructor(
    private readonly clock: Clock,
    private readonly capabilityRegistry: CapabilityRegistry,
  ) {}

  public register(definition: FeatureFlagDefinition): ConfigurationResult<FeatureFlagDefinition> {
    if (this.definitions.has(definition.flagId)) {
      return fail(
        configurationError({
          code: "CONFIGURATION_FEATURE_FLAG_DUPLICATE",
          message: `feature flag already registered: ${definition.flagId}`,
          timestamp: this.clock.now(),
        }),
      );
    }
    for (const controlledCapability of definition.controls) {
      const capability = this.capabilityRegistry.require(controlledCapability);
      if (!capability.ok) {
        return fail({
          ...capability.error,
          code: "CONFIGURATION_FEATURE_FLAG_INVALID",
        });
      }
      if (capability.value.capabilityClass === "MANDATORY_CORE") {
        return fail(
          configurationError({
            code: "CONFIGURATION_FEATURE_FLAG_INVALID",
            message: `feature flag ${definition.flagId} cannot control mandatory core capability ${controlledCapability}`,
            timestamp: this.clock.now(),
          }),
        );
      }
      if (capability.value.featureFlagId !== definition.flagId) {
        return fail(
          configurationError({
            code: "CONFIGURATION_FEATURE_FLAG_INVALID",
            message: `feature flag ${definition.flagId} does not match capability ${controlledCapability}`,
            timestamp: this.clock.now(),
          }),
        );
      }
    }
    this.definitions.set(definition.flagId, freeze({ ...definition }));
    return ok(definition);
  }

  public require(flagId: FeatureFlagId): ConfigurationResult<FeatureFlagDefinition> {
    const definition = this.definitions.get(flagId);
    if (definition === undefined) {
      return fail(
        configurationError({
          code: "CONFIGURATION_FEATURE_FLAG_UNKNOWN",
          message: `unknown feature flag: ${flagId}`,
          timestamp: this.clock.now(),
        }),
      );
    }
    return ok(definition);
  }

  public byCapability(capability: CapabilityId): FeatureFlagDefinition | undefined {
    return this.all().find((definition) => definition.controls.includes(capability));
  }

  public all(): readonly FeatureFlagDefinition[] {
    return [...this.definitions.values()].sort((left, right) =>
      left.flagId.localeCompare(right.flagId),
    );
  }

  public fingerprint(): ConfigurationFingerprint {
    return fingerprint(this.all());
  }
}

const findCycle = (
  definitions: ReadonlyMap<CapabilityId, CapabilityDefinition>,
): readonly CapabilityId[] | undefined => {
  const visiting = new Set<CapabilityId>();
  const visited = new Set<CapabilityId>();

  const visit = (
    capability: CapabilityId,
    path: readonly CapabilityId[],
  ): readonly CapabilityId[] | undefined => {
    if (visiting.has(capability)) {
      const start = path.indexOf(capability);
      return [...path.slice(start), capability];
    }
    if (visited.has(capability)) {
      return undefined;
    }
    visiting.add(capability);
    for (const dependency of definitions.get(capability)?.dependencies ?? []) {
      const cycle: readonly CapabilityId[] | undefined = visit(dependency, [...path, dependency]);
      if (cycle !== undefined) {
        return cycle;
      }
    }
    visiting.delete(capability);
    visited.add(capability);
    return undefined;
  };

  for (const capability of definitions.keys()) {
    const cycle = visit(capability, [capability]);
    if (cycle !== undefined) {
      return cycle;
    }
  }
  return undefined;
};
