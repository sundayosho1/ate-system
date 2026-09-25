import { freeze } from "./context.js";
import { configurationError, fail, ok } from "./errors.js";
import { fingerprint } from "./serialization.js";
import type { CapabilityRegistry, FeatureFlagRegistry } from "./capability-registry.js";
import type {
  CapabilityDefinition,
  CapabilityEvaluationInput,
  CapabilityExplanation,
  CapabilityId,
  CapabilityReasonCode,
  CapabilitySnapshot,
  CapabilitySnapshotId,
  EffectiveCapability,
  EffectiveCapabilityState,
  EffectiveFeatureFlag,
  FeatureFlagDefinition,
} from "./capability-types.js";
import type { ConfigurationResult } from "./types.js";

export type EvaluateCapabilitiesInput = Readonly<{
  capabilityRegistry: CapabilityRegistry;
  featureFlagRegistry: FeatureFlagRegistry;
  evaluation: CapabilityEvaluationInput;
}>;

export const evaluateCapabilities = (
  input: EvaluateCapabilitiesInput,
): ConfigurationResult<CapabilitySnapshot> => {
  const graph = input.capabilityRegistry.validateGraph();
  if (!graph.ok) {
    return graph;
  }
  const flags = evaluateFeatureFlags(input.featureFlagRegistry.all(), input.evaluation);
  const flagById = new Map(flags.map((flag) => [flag.flagId, flag]));
  const stateByCapability = new Map<CapabilityId, EffectiveCapability>();
  const evaluating = new Set<CapabilityId>();

  const evaluateCapability = (
    definition: CapabilityDefinition,
  ): ConfigurationResult<EffectiveCapability> => {
    const existing = stateByCapability.get(definition.capabilityId);
    if (existing !== undefined) {
      return ok(existing);
    }
    if (evaluating.has(definition.capabilityId)) {
      return fail(
        configurationError({
          code: "CONFIGURATION_CAPABILITY_CYCLE_DETECTED",
          message: `capability dependency cycle detected at ${definition.capabilityId}`,
          timestamp: input.evaluation.now,
        }),
      );
    }
    evaluating.add(definition.capabilityId);

    const dependencyStates: Record<string, EffectiveCapabilityState> = {};
    const reasons: CapabilityReasonCode[] = [];
    let state: EffectiveCapabilityState = "ENABLED";
    let requested = definition.capabilityClass === "MANDATORY_CORE";
    let pendingRestart = false;

    const flag =
      definition.featureFlagId === undefined ? undefined : flagById.get(definition.featureFlagId);
    if (flag !== undefined) {
      requested = flag.enabled;
      reasons.push(...flag.reasonCodes);
      if (!flag.allowedInRuntimeMode) {
        state = "BLOCKED";
        reasons.push("ENVIRONMENT_NOT_ALLOWED");
      }
      const applied = input.evaluation.appliedFeatureFlags?.[flag.flagId];
      if (
        applied !== undefined &&
        applied !== flag.enabled &&
        flag.reloadBehavior === "RESTART_REQUIRED"
      ) {
        pendingRestart = true;
        state = "BLOCKED";
        reasons.push("RESTART_REQUIRED");
      }
    }

    if (definition.capabilityClass === "MANDATORY_CORE") {
      requested = true;
      reasons.push("ENABLED_BY_MANDATORY_CORE");
    } else if (!requested) {
      state = state === "BLOCKED" ? state : "DISABLED";
      reasons.push("DISABLED_BY_CONFIGURATION");
    } else {
      reasons.push("ENABLED_BY_CONFIGURATION");
    }

    if (definition.implementationStatus === "NOT_IMPLEMENTED") {
      state = requested ? "UNAVAILABLE" : state;
      reasons.push("NOT_IMPLEMENTED");
    }

    if (requested && !definition.supportedRuntimeModes.includes(input.evaluation.runtimeMode)) {
      state = "BLOCKED";
      reasons.push("ENVIRONMENT_NOT_ALLOWED");
    }

    for (const dependencyId of requested ? (definition.dependencies ?? []) : []) {
      const dependencyDefinition = input.capabilityRegistry.require(dependencyId);
      if (!dependencyDefinition.ok) {
        return dependencyDefinition;
      }
      const dependency = evaluateCapability(dependencyDefinition.value);
      if (!dependency.ok) {
        return dependency;
      }
      dependencyStates[dependencyId] = dependency.value.state;
      if (dependency.value.state === "UNAVAILABLE") {
        state = "BLOCKED";
        reasons.push("DEPENDENCY_UNAVAILABLE");
      } else if (dependency.value.state === "DISABLED" || dependency.value.state === "BLOCKED") {
        state = "BLOCKED";
        reasons.push("DEPENDENCY_DISABLED");
      } else if (dependency.value.state === "DEGRADED" && state === "ENABLED") {
        state = "DEGRADED";
        reasons.push("SERVICE_NOT_READY");
      }
    }

    const conflictingCapabilities: CapabilityId[] = [];
    for (const conflictId of requested ? (definition.conflictsWith ?? []) : []) {
      const conflictDefinition = input.capabilityRegistry.require(conflictId);
      if (!conflictDefinition.ok) {
        return conflictDefinition;
      }
      const conflict = evaluateCapability(conflictDefinition.value);
      if (!conflict.ok) {
        return conflict;
      }
      if (requested && conflict.value.requested && conflict.value.state === "ENABLED") {
        conflictingCapabilities.push(conflictId);
        state = "BLOCKED";
        reasons.push("CONFLICTING_CAPABILITY");
      }
    }

    for (const serviceId of requested ? (definition.requiredServices ?? []) : []) {
      const readiness = input.evaluation.serviceReadiness?.[serviceId];
      if (readiness !== undefined && readiness !== "READY") {
        state = state === "BLOCKED" || state === "UNAVAILABLE" ? state : "DEGRADED";
        reasons.push("SERVICE_NOT_READY");
      }
    }

    const capability = freeze({
      capabilityId: definition.capabilityId,
      state,
      requested,
      implemented: definition.implementationStatus === "IMPLEMENTED",
      mandatoryCore: definition.capabilityClass === "MANDATORY_CORE",
      reloadBehavior: definition.reloadBehavior,
      supportedRuntimeModes: [...definition.supportedRuntimeModes],
      reasonCodes: uniqueReasons(reasons),
      dependencyStates,
      conflictingCapabilities,
      requiredServices: [...(definition.requiredServices ?? [])],
      ...(definition.featureFlagId === undefined
        ? {}
        : { featureFlagId: definition.featureFlagId }),
      pendingRestart,
    } satisfies EffectiveCapability);
    evaluating.delete(definition.capabilityId);
    stateByCapability.set(definition.capabilityId, capability);
    return ok(capability);
  };

  for (const definition of input.capabilityRegistry.all()) {
    const evaluated = evaluateCapability(definition);
    if (!evaluated.ok) {
      return evaluated;
    }
  }

  const capabilities = [...stateByCapability.values()].sort((left, right) =>
    left.capabilityId.localeCompare(right.capabilityId),
  );
  const snapshotFingerprint = fingerprint({
    runtimeMode: input.evaluation.runtimeMode,
    configurationSnapshotId: input.evaluation.effectiveConfiguration.snapshotId,
    configurationFingerprint: input.evaluation.effectiveConfiguration.fingerprint,
    configurationVersionId: input.evaluation.configurationVersionId,
    schemaFingerprint: input.evaluation.schemaFingerprint,
    capabilities,
    flags,
  });
  return ok(
    freeze({
      snapshotId: capabilitySnapshotId(snapshotFingerprint),
      fingerprint: snapshotFingerprint,
      createdAt: input.evaluation.now,
      runtimeMode: input.evaluation.runtimeMode,
      configurationSnapshotId: input.evaluation.effectiveConfiguration.snapshotId,
      configurationFingerprint: input.evaluation.effectiveConfiguration.fingerprint,
      ...(input.evaluation.configurationVersionId === undefined
        ? {}
        : { configurationVersionId: input.evaluation.configurationVersionId }),
      ...(input.evaluation.schemaFingerprint === undefined
        ? {}
        : { schemaFingerprint: input.evaluation.schemaFingerprint }),
      capabilities,
      featureFlags: flags,
    }),
  );
};

export const explainCapability = (input: {
  capabilityRegistry: CapabilityRegistry;
  featureFlagRegistry: FeatureFlagRegistry;
  snapshot: CapabilitySnapshot;
  capabilityId: CapabilityId;
}): ConfigurationResult<CapabilityExplanation> => {
  const definition = input.capabilityRegistry.require(input.capabilityId);
  if (!definition.ok) {
    return definition;
  }
  const capability = input.snapshot.capabilities.find(
    (candidate) => candidate.capabilityId === input.capabilityId,
  );
  if (capability === undefined) {
    return fail(
      configurationError({
        code: "CONFIGURATION_CAPABILITY_UNKNOWN",
        message: `capability not present in snapshot: ${input.capabilityId}`,
        timestamp: input.snapshot.createdAt,
      }),
    );
  }
  const featureFlag =
    definition.value.featureFlagId === undefined
      ? undefined
      : input.snapshot.featureFlags.find((flag) => flag.flagId === definition.value.featureFlagId);
  const dependencyChain = (definition.value.dependencies ?? [])
    .map((dependencyId) =>
      input.snapshot.capabilities.find((candidate) => candidate.capabilityId === dependencyId),
    )
    .filter((dependency): dependency is EffectiveCapability => dependency !== undefined);
  return ok(
    freeze({
      capability,
      definition: definition.value,
      ...(featureFlag === undefined ? {} : { featureFlag }),
      dependencyChain,
      configurationSnapshotId: input.snapshot.configurationSnapshotId,
      configurationFingerprint: input.snapshot.configurationFingerprint,
      ...(input.snapshot.configurationVersionId === undefined
        ? {}
        : { configurationVersionId: input.snapshot.configurationVersionId }),
      ...(input.snapshot.schemaFingerprint === undefined
        ? {}
        : { schemaFingerprint: input.snapshot.schemaFingerprint }),
    }),
  );
};

const evaluateFeatureFlags = (
  definitions: readonly FeatureFlagDefinition[],
  input: CapabilityEvaluationInput,
): readonly EffectiveFeatureFlag[] =>
  freeze(
    definitions.map((definition) => {
      const effective = input.effectiveConfiguration.values.get(definition.key);
      const configured = effective?.present === true;
      const configuredValue = effective?.value;
      const validBoolean = typeof configuredValue === "boolean";
      const enabled = configured && validBoolean ? configuredValue : definition.defaultEnabled;
      const allowedInRuntimeMode =
        definition.allowedRuntimeModes === undefined ||
        definition.allowedRuntimeModes.includes(input.runtimeMode);
      const reasons: CapabilityReasonCode[] = [];
      if (!configured) {
        reasons.push("FLAG_DEFAULT_USED");
      }
      if (configured && !validBoolean) {
        reasons.push("FLAG_VALUE_INVALID");
      }
      reasons.push(enabled ? "ENABLED_BY_CONFIGURATION" : "DISABLED_BY_CONFIGURATION");
      if (!allowedInRuntimeMode) {
        reasons.push("ENVIRONMENT_NOT_ALLOWED");
      }
      return freeze({
        flagId: definition.flagId,
        key: definition.key,
        enabled,
        configured,
        defaulted: !configured,
        allowedInRuntimeMode,
        reloadBehavior: definition.reloadBehavior,
        reasonCodes: uniqueReasons(reasons),
      });
    }),
  );

const capabilitySnapshotId = (value: string): CapabilitySnapshotId =>
  `capsnap-${value.replace("sha256:", "").slice(0, 24)}` as CapabilitySnapshotId;

const uniqueReasons = (
  reasons: readonly CapabilityReasonCode[],
): readonly CapabilityReasonCode[] => [...new Set(reasons)];
