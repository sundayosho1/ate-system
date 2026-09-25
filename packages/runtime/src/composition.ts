import type { RuntimeMode } from "@ate/domain";

import { buildDependencyGraph } from "./graph.js";
import {
  lifecycleError,
  parseRuntimeInstanceId,
  parseRuntimeMode,
  parseServiceId,
  systemClock,
} from "./primitives.js";
import { createRuntime, type ATERuntime } from "./runtime.js";
import type {
  DegradationPolicy,
  LifecycleError,
  RuntimeCapability,
  RuntimeClock,
  RuntimeManagedService,
  ServiceCriticality,
  ServiceDescriptor,
  ServiceId,
} from "./types.js";

export type BuildRuntimeInput = Readonly<{
  runtimeInstanceId: unknown;
  runtimeVersion: string;
  mode?: unknown;
  services: readonly RuntimeManagedService[];
  capabilities?: readonly RuntimeCapability[];
  defaultTimeoutMs?: number;
  clock?: RuntimeClock;
}>;

export type BuildRuntimeResult =
  | Readonly<{
      ok: true;
      runtime: ATERuntime;
    }>
  | Readonly<{
      ok: false;
      errors: readonly LifecycleError[];
    }>;

export const buildRuntime = (input: BuildRuntimeInput): BuildRuntimeResult => {
  const clock = input.clock ?? systemClock;
  const runtimeInstanceId = parseRuntimeInstanceId(input.runtimeInstanceId);
  const mode = parseRuntimeMode(input.mode);
  const errors: LifecycleError[] = [];

  if (runtimeInstanceId === undefined) {
    errors.push(
      lifecycleError("INVALID_RUNTIME_MODE", "runtime instance ID must be a UUID", clock.now()),
    );
  }
  if (mode === undefined) {
    errors.push(
      lifecycleError(
        "INVALID_RUNTIME_MODE",
        "runtime mode is required and must be explicit",
        clock.now(),
      ),
    );
  }
  if (
    input.defaultTimeoutMs !== undefined &&
    (!Number.isInteger(input.defaultTimeoutMs) || input.defaultTimeoutMs <= 0)
  ) {
    errors.push(
      lifecycleError("STARTUP_TIMEOUT", "default timeout must be a positive integer", clock.now()),
    );
  }
  if (errors.length > 0 || runtimeInstanceId === undefined || mode === undefined) {
    return { ok: false, errors };
  }

  const graph = buildDependencyGraph(input.services, mode, clock);
  if (!graph.ok) {
    return { ok: false, errors: graph.errors };
  }

  return createRuntime({
    runtimeInstanceId,
    runtimeVersion: input.runtimeVersion,
    mode,
    services: input.services,
    capabilities: input.capabilities,
    defaultTimeoutMs: input.defaultTimeoutMs,
    clock,
  });
};

export const serviceId = (value: string): ServiceId => {
  const parsed = parseServiceId(value);
  if (parsed === undefined) {
    throw new Error(`invalid service ID: ${value}`);
  }
  return parsed;
};

export const serviceDescriptor = (input: {
  serviceId: ServiceId;
  name: string;
  version: string;
  description: string;
  criticality: ServiceCriticality;
  supportedModes: readonly RuntimeMode[];
  dependencies?: readonly ServiceId[];
  optionalDependencies?: readonly ServiceId[];
  capabilities?: readonly RuntimeCapability[];
  degradationPolicy?: DegradationPolicy;
  healthCapability?: boolean;
  readinessCapability?: boolean;
  recoverable?: boolean;
}): ServiceDescriptor => ({
  serviceId: input.serviceId,
  name: input.name,
  version: input.version,
  description: input.description,
  criticality: input.criticality,
  dependencies: input.dependencies ?? [],
  optionalDependencies: input.optionalDependencies ?? [],
  supportedModes: input.supportedModes,
  startupPolicy: "EAGER",
  shutdownPolicy: "GRACEFUL",
  degradationPolicy:
    input.degradationPolicy ??
    (input.criticality === "OPTIONAL" ? "MARK_RUNTIME_DEGRADED" : "BLOCK_READINESS"),
  capabilities: input.capabilities ?? [],
  healthCapability: input.healthCapability ?? true,
  readinessCapability: input.readinessCapability ?? true,
  recoverable: input.recoverable ?? false,
});
