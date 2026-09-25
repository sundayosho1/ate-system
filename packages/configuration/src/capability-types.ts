import type { RuntimeMode, UtcTimestamp } from "@ate/domain";
import type { ReadinessReport, RuntimeManagedService, ServiceId } from "@ate/runtime";

import type {
  ConfigurationFingerprint,
  ConfigurationKey,
  ConfigurationResult,
  ConfigurationSnapshotId,
} from "./types.js";
import type { ConfigurationVersionId } from "./version-types.js";

export type CapabilityId = string & { readonly __brand: "CapabilityId" };
export type FeatureFlagId = string & { readonly __brand: "FeatureFlagId" };
export type CapabilitySnapshotId = string & { readonly __brand: "CapabilitySnapshotId" };

export type CapabilityClass = "MANDATORY_CORE" | "OPTIONAL" | "FUTURE_UNIMPLEMENTED";
export type CapabilityImplementationStatus = "IMPLEMENTED" | "NOT_IMPLEMENTED";
export type CapabilityReloadBehavior = "DYNAMIC" | "RESTART_REQUIRED" | "STARTUP_ONLY";
export type EffectiveCapabilityState =
  "ENABLED" | "DISABLED" | "UNAVAILABLE" | "BLOCKED" | "DEGRADED";

export type CapabilityReasonCode =
  | "ENABLED_BY_CONFIGURATION"
  | "ENABLED_BY_MANDATORY_CORE"
  | "DISABLED_BY_CONFIGURATION"
  | "NOT_IMPLEMENTED"
  | "ENVIRONMENT_NOT_ALLOWED"
  | "DEPENDENCY_DISABLED"
  | "DEPENDENCY_UNAVAILABLE"
  | "SERVICE_NOT_READY"
  | "CONFLICTING_CAPABILITY"
  | "SAFETY_GATE_BLOCKED"
  | "RESTART_REQUIRED"
  | "UNKNOWN_CAPABILITY"
  | "FLAG_DEFAULT_USED"
  | "FLAG_VALUE_INVALID";

export type CapabilityDefinition = Readonly<{
  capabilityId: CapabilityId;
  displayName: string;
  description: string;
  owner: string;
  capabilityClass: CapabilityClass;
  implementationStatus: CapabilityImplementationStatus;
  reloadBehavior: CapabilityReloadBehavior;
  supportedRuntimeModes: readonly RuntimeMode[];
  dependencies?: readonly CapabilityId[];
  conflictsWith?: readonly CapabilityId[];
  requiredServices?: readonly ServiceId[];
  featureFlagId?: FeatureFlagId;
  versionIntroduced: string;
  safetyNotes?: string;
}>;

export type FeatureFlagDefinition = Readonly<{
  flagId: FeatureFlagId;
  key: ConfigurationKey;
  displayName: string;
  description: string;
  defaultEnabled: boolean;
  controls: readonly CapabilityId[];
  reloadBehavior: CapabilityReloadBehavior;
  allowedRuntimeModes?: readonly RuntimeMode[];
  owner: string;
  safetyNotes?: string;
}>;

export type EffectiveFeatureFlag = Readonly<{
  flagId: FeatureFlagId;
  key: ConfigurationKey;
  enabled: boolean;
  configured: boolean;
  defaulted: boolean;
  allowedInRuntimeMode: boolean;
  reloadBehavior: CapabilityReloadBehavior;
  reasonCodes: readonly CapabilityReasonCode[];
}>;

export type EffectiveCapability = Readonly<{
  capabilityId: CapabilityId;
  state: EffectiveCapabilityState;
  requested: boolean;
  implemented: boolean;
  mandatoryCore: boolean;
  reloadBehavior: CapabilityReloadBehavior;
  supportedRuntimeModes: readonly RuntimeMode[];
  reasonCodes: readonly CapabilityReasonCode[];
  dependencyStates: Readonly<Record<string, EffectiveCapabilityState>>;
  conflictingCapabilities: readonly CapabilityId[];
  requiredServices: readonly ServiceId[];
  featureFlagId?: FeatureFlagId;
  pendingRestart: boolean;
}>;

export type CapabilitySnapshot = Readonly<{
  snapshotId: CapabilitySnapshotId;
  fingerprint: ConfigurationFingerprint;
  createdAt: UtcTimestamp;
  runtimeMode: RuntimeMode;
  configurationSnapshotId: ConfigurationSnapshotId;
  configurationFingerprint: ConfigurationFingerprint;
  configurationVersionId?: ConfigurationVersionId;
  schemaFingerprint?: ConfigurationFingerprint;
  capabilities: readonly EffectiveCapability[];
  featureFlags: readonly EffectiveFeatureFlag[];
}>;

export type CapabilityExplanation = Readonly<{
  capability: EffectiveCapability;
  definition: CapabilityDefinition;
  featureFlag?: EffectiveFeatureFlag;
  dependencyChain: readonly EffectiveCapability[];
  configurationSnapshotId: ConfigurationSnapshotId;
  configurationFingerprint: ConfigurationFingerprint;
  configurationVersionId?: ConfigurationVersionId;
  schemaFingerprint?: ConfigurationFingerprint;
}>;

export type CapabilityServiceDiagnostics = Readonly<{
  state: "CREATED" | "READY" | "DEGRADED" | "STOPPED" | "FAILED";
  runtimeMode: RuntimeMode;
  snapshotId?: CapabilitySnapshotId;
  fingerprint?: ConfigurationFingerprint;
  configurationSnapshotId?: ConfigurationSnapshotId;
  configurationVersionId?: ConfigurationVersionId;
  capabilityCount: number;
  enabledCount: number;
  disabledCount: number;
  unavailableCount: number;
  blockedCount: number;
  degradedCount: number;
  pendingRestartCount: number;
  recentErrors: readonly string[];
}>;

export type CapabilityEvaluationInput = Readonly<{
  runtimeMode: RuntimeMode;
  effectiveConfiguration: {
    snapshotId: ConfigurationSnapshotId;
    fingerprint: ConfigurationFingerprint;
    values: ReadonlyMap<ConfigurationKey, Readonly<{ value?: unknown; present: boolean }>>;
  };
  now: UtcTimestamp;
  configurationVersionId?: ConfigurationVersionId;
  schemaFingerprint?: ConfigurationFingerprint;
  appliedFeatureFlags?: Readonly<Record<string, boolean>>;
  serviceReadiness?: Readonly<Record<string, ReadinessReport["status"]>>;
}>;

export type CapabilityRuntimeService = Readonly<{
  managedService: RuntimeManagedService;
  evaluate: (input: CapabilityEvaluationInput) => ConfigurationResult<CapabilitySnapshot>;
  currentSnapshot: () => CapabilitySnapshot | undefined;
  explain: (capabilityId: CapabilityId) => ConfigurationResult<CapabilityExplanation>;
  diagnostics: () => CapabilityServiceDiagnostics;
  stop: () => void;
}>;
