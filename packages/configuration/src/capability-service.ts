import { runtimeModes, type RuntimeMode } from "@ate/domain";
import {
  serviceDescriptor,
  type HealthReport,
  type ReadinessReport,
  type RuntimeManagedService,
  type ServiceId,
} from "@ate/runtime";
import { clockRuntimeServiceId, type Clock } from "@ate/time";

import { evaluateCapabilities, explainCapability } from "./capability-evaluator.js";
import type { CapabilityRegistry, FeatureFlagRegistry } from "./capability-registry.js";
import { configurationError, fail } from "./errors.js";
import type {
  CapabilityEvaluationInput,
  CapabilityExplanation,
  CapabilityId,
  CapabilityRuntimeService,
  CapabilityServiceDiagnostics,
  CapabilitySnapshot,
} from "./capability-types.js";
import type { ConfigurationResult } from "./types.js";
import { configurationServiceId } from "./runtime-service.js";

export const capabilityServiceId = "configuration.capabilities" as ServiceId;

export type CapabilityServiceInput = Readonly<{
  runtimeMode: RuntimeMode;
  clock: Clock;
  capabilityRegistry: CapabilityRegistry;
  featureFlagRegistry: FeatureFlagRegistry;
  maxRecentErrors?: number;
}>;

export class ConfigurationCapabilityService implements CapabilityRuntimeService {
  public readonly managedService: RuntimeManagedService;

  private state: CapabilityServiceDiagnostics["state"] = "CREATED";
  private snapshot: CapabilitySnapshot | undefined;
  private readonly recentErrors: string[] = [];

  public constructor(private readonly input: CapabilityServiceInput) {
    this.managedService = this.createManagedService();
  }

  public evaluate(evaluation: CapabilityEvaluationInput): ConfigurationResult<CapabilitySnapshot> {
    const result = evaluateCapabilities({
      capabilityRegistry: this.input.capabilityRegistry,
      featureFlagRegistry: this.input.featureFlagRegistry,
      evaluation,
    });
    if (!result.ok) {
      this.recordError(result.error.message);
      this.state = "FAILED";
      return result;
    }
    this.snapshot = result.value;
    this.state = result.value.capabilities.some((capability) => capability.state === "BLOCKED")
      ? "DEGRADED"
      : "READY";
    return result;
  }

  public currentSnapshot(): CapabilitySnapshot | undefined {
    return this.snapshot;
  }

  public explain(capabilityId: CapabilityId): ConfigurationResult<CapabilityExplanation> {
    if (this.snapshot === undefined) {
      return fail(
        configurationError({
          code: "CONFIGURATION_CAPABILITY_SNAPSHOT_INVALID",
          message: "capability service has no active snapshot",
          timestamp: this.input.clock.now(),
          severity: "CRITICAL",
        }),
      );
    }
    return explainCapability({
      capabilityRegistry: this.input.capabilityRegistry,
      featureFlagRegistry: this.input.featureFlagRegistry,
      snapshot: this.snapshot,
      capabilityId,
    });
  }

  public diagnostics(): CapabilityServiceDiagnostics {
    const capabilities = this.snapshot?.capabilities ?? [];
    return {
      state: this.state,
      runtimeMode: this.input.runtimeMode,
      ...(this.snapshot === undefined ? {} : { snapshotId: this.snapshot.snapshotId }),
      ...(this.snapshot === undefined ? {} : { fingerprint: this.snapshot.fingerprint }),
      ...(this.snapshot === undefined
        ? {}
        : { configurationSnapshotId: this.snapshot.configurationSnapshotId }),
      ...(this.snapshot?.configurationVersionId === undefined
        ? {}
        : { configurationVersionId: this.snapshot.configurationVersionId }),
      capabilityCount: capabilities.length,
      enabledCount: capabilities.filter((capability) => capability.state === "ENABLED").length,
      disabledCount: capabilities.filter((capability) => capability.state === "DISABLED").length,
      unavailableCount: capabilities.filter((capability) => capability.state === "UNAVAILABLE")
        .length,
      blockedCount: capabilities.filter((capability) => capability.state === "BLOCKED").length,
      degradedCount: capabilities.filter((capability) => capability.state === "DEGRADED").length,
      pendingRestartCount: capabilities.filter((capability) => capability.pendingRestart).length,
      recentErrors: [...this.recentErrors],
    };
  }

  public checkHealth(): HealthReport {
    const diagnostics = this.diagnostics();
    return {
      status:
        diagnostics.state === "FAILED"
          ? "UNHEALTHY"
          : diagnostics.degradedCount > 0 || diagnostics.recentErrors.length > 0
            ? "DEGRADED"
            : "HEALTHY",
      timestamp: this.input.clock.now(),
      serviceId: capabilityServiceId,
      details: diagnostics,
    };
  }

  public checkReadiness(): ReadinessReport {
    const diagnostics = this.diagnostics();
    const ready =
      diagnostics.state === "READY" &&
      diagnostics.snapshotId !== undefined &&
      diagnostics.unavailableCount >= 0;
    return {
      status: ready ? "READY" : "NOT_READY",
      timestamp: this.input.clock.now(),
      serviceId: capabilityServiceId,
      ...(ready ? {} : { reason: "capability control snapshot is not ready" }),
      details: diagnostics,
    };
  }

  public stop(): void {
    this.state = "STOPPED";
  }

  private createManagedService(): RuntimeManagedService {
    return {
      descriptor: serviceDescriptor({
        serviceId: capabilityServiceId,
        name: "ATE Capability Control",
        version: "0.10.0-capabilities.1",
        description:
          "Feature flag and capability control foundation with build-truth registry, dependency gating, runtime-mode checks, safe snapshots and diagnostics.",
        criticality: "CRITICAL",
        dependencies: [clockRuntimeServiceId, configurationServiceId],
        supportedModes: runtimeModes,
        capabilities: ["CONFIGURATION_CAPABILITY_CONTROL", "FEATURE_FLAGS"],
        degradationPolicy: "BLOCK_READINESS",
        healthCapability: true,
        readinessCapability: true,
        recoverable: true,
      }),
      checkHealth: () => this.checkHealth(),
      checkReadiness: () => this.checkReadiness(),
      stop: () => {
        this.stop();
      },
    };
  }

  private recordError(message: string): void {
    this.recentErrors.unshift(message);
    this.recentErrors.splice(this.input.maxRecentErrors ?? 20);
  }
}

export const createConfigurationCapabilityService = (
  input: CapabilityServiceInput,
): ConfigurationCapabilityService => new ConfigurationCapabilityService(input);
