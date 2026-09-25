import type { CorrelationId, RuntimeMode, UtcTimestamp } from "@ate/domain";

export type RuntimeInstanceId = string & { readonly __brand: "RuntimeInstanceId" };
export type ServiceId = string & { readonly __brand: "ServiceId" };

export const runtimeStates = [
  "CREATED",
  "COMPOSING",
  "INITIALIZING",
  "STARTING",
  "RUNNING",
  "DEGRADED",
  "RECOVERING",
  "STOPPING",
  "STOPPED",
  "FAILED",
] as const;
export type RuntimeState = (typeof runtimeStates)[number];

export const serviceStates = [
  "REGISTERED",
  "INITIALIZING",
  "INITIALIZED",
  "STARTING",
  "RUNNING",
  "DEGRADED",
  "RECOVERING",
  "STOPPING",
  "STOPPED",
  "FAILED",
] as const;
export type ServiceState = (typeof serviceStates)[number];

export const serviceCriticalities = ["CRITICAL", "REQUIRED", "OPTIONAL"] as const;
export type ServiceCriticality = (typeof serviceCriticalities)[number];

export const startupPolicies = ["EAGER"] as const;
export type StartupPolicy = (typeof startupPolicies)[number];

export const shutdownPolicies = ["GRACEFUL"] as const;
export type ShutdownPolicy = (typeof shutdownPolicies)[number];

export const degradationPolicies = [
  "CONTINUE_WITHOUT_CAPABILITY",
  "MARK_RUNTIME_DEGRADED",
  "BLOCK_READINESS",
  "FAIL_RUNTIME",
] as const;
export type DegradationPolicy = (typeof degradationPolicies)[number];

export const healthStatuses = ["HEALTHY", "DEGRADED", "UNHEALTHY", "UNKNOWN"] as const;
export type RuntimeHealthStatus = (typeof healthStatuses)[number];

export const readinessStatuses = ["READY", "DEGRADED_READY", "NOT_READY"] as const;
export type ReadinessStatus = (typeof readinessStatuses)[number];

export const runtimeCapabilities = [
  "CORE_RUNTIME",
  "FOUNDATION_RUNTIME",
  "MARKET_DATA_READ",
  "RESEARCH_EXECUTION",
  "SIMULATION_EXECUTION",
  "PAPER_EXECUTION",
  "LIVE_EXECUTION",
  "CONFIGURATION_WRITE",
  "BROKER_CONNECTIVITY",
] as const;
export type RuntimeCapability = (typeof runtimeCapabilities)[number] | (string & {});

export const lifecycleErrorCodes = [
  "INVALID_RUNTIME_MODE",
  "INVALID_STATE_TRANSITION",
  "LIFECYCLE_CONFLICT",
  "DUPLICATE_SERVICE",
  "MISSING_DEPENDENCY",
  "CIRCULAR_DEPENDENCY",
  "UNSUPPORTED_RUNTIME_MODE",
  "INITIALIZATION_FAILED",
  "STARTUP_FAILED",
  "STARTUP_TIMEOUT",
  "HEALTH_CHECK_FAILED",
  "READINESS_FAILED",
  "RECOVERY_FAILED",
  "SHUTDOWN_FAILED",
  "SHUTDOWN_TIMEOUT",
  "SERVICE_NOT_FOUND",
] as const;
export type LifecycleErrorCode = (typeof lifecycleErrorCodes)[number];

export type LifecycleError = Readonly<{
  code: LifecycleErrorCode;
  message: string;
  timestamp: UtcTimestamp;
  serviceId?: ServiceId;
  details?: Record<string, unknown>;
}>;

export type LifecycleRecord = Readonly<{
  timestamp: UtcTimestamp;
  runtimeInstanceId: RuntimeInstanceId;
  runtimeMode: RuntimeMode;
  transition: string;
  correlationId?: CorrelationId;
  serviceId?: ServiceId;
  reason?: string;
  error?: LifecycleError;
  durationMs?: number;
}>;

export type HealthReport = Readonly<{
  status: RuntimeHealthStatus;
  timestamp: UtcTimestamp;
  serviceId?: ServiceId;
  reason?: string;
  details?: Record<string, unknown>;
}>;

export type ReadinessReport = Readonly<{
  status: ReadinessStatus;
  timestamp: UtcTimestamp;
  serviceId?: ServiceId;
  reason?: string;
  details?: Record<string, unknown>;
}>;

export type ServiceDescriptor = Readonly<{
  serviceId: ServiceId;
  name: string;
  version: string;
  description: string;
  criticality: ServiceCriticality;
  dependencies: readonly ServiceId[];
  optionalDependencies: readonly ServiceId[];
  supportedModes: readonly RuntimeMode[];
  startupPolicy: StartupPolicy;
  shutdownPolicy: ShutdownPolicy;
  degradationPolicy: DegradationPolicy;
  capabilities: readonly RuntimeCapability[];
  healthCapability: boolean;
  readinessCapability: boolean;
  recoverable: boolean;
}>;

export type LifecycleContext = Readonly<{
  runtimeInstanceId: RuntimeInstanceId;
  runtimeMode: RuntimeMode;
  correlationId?: CorrelationId;
  signal: AbortSignal;
  now: () => UtcTimestamp;
}>;

export type RuntimeManagedService = Readonly<{
  descriptor: ServiceDescriptor;
  initialize?: (context: LifecycleContext) => Promise<void> | void;
  start?: (context: LifecycleContext) => Promise<void> | void;
  stop?: (context: LifecycleContext) => Promise<void> | void;
  dispose?: (context: LifecycleContext) => Promise<void> | void;
  checkHealth?: (context: LifecycleContext) => Promise<HealthReport> | HealthReport;
  checkReadiness?: (context: LifecycleContext) => Promise<ReadinessReport> | ReadinessReport;
  degrade?: (context: LifecycleContext, reason: LifecycleError) => Promise<void> | void;
  recover?: (context: LifecycleContext) => Promise<void> | void;
}>;

export type RetryPolicy = Readonly<{
  enabled: boolean;
  maximumAttempts: number;
  initialDelayMs: number;
  maximumDelayMs: number;
  backoffStrategy: "FIXED" | "EXPONENTIAL";
  jitter: "NONE" | "FULL";
  retryableFailureCategories: readonly LifecycleErrorCode[];
}>;

export type RestartPolicy = Readonly<{
  strategy: "NONE" | "SERVICE_RESTART" | "PROCESS_RESTART" | "OPERATOR_INTERVENTION";
  maximumAttempts: number;
}>;

export type RuntimeOptions = Readonly<{
  runtimeInstanceId: RuntimeInstanceId;
  runtimeVersion: string;
  mode: RuntimeMode;
  services: readonly RuntimeManagedService[];
  capabilities?: readonly RuntimeCapability[];
  defaultTimeoutMs?: number;
  clock?: RuntimeClock;
}>;

export type RuntimeClock = Readonly<{
  now: () => UtcTimestamp;
}>;

export type RuntimeServiceSnapshot = Readonly<{
  descriptor: ServiceDescriptor;
  state: ServiceState;
  health: HealthReport;
  readiness: ReadinessReport;
}>;

export type DegradationReport = Readonly<{
  timestamp: UtcTimestamp;
  serviceId: ServiceId;
  criticality: ServiceCriticality;
  affectedCapabilities: readonly RuntimeCapability[];
  affectedDependants: readonly ServiceId[];
  reason: LifecycleError;
  recoverable: boolean;
  operationMayContinue: boolean;
  currentReadiness: ReadinessStatus;
}>;

export type RuntimeSnapshot = Readonly<{
  runtimeInstanceId: RuntimeInstanceId;
  runtimeVersion: string;
  runtimeMode: RuntimeMode;
  state: RuntimeState;
  health: HealthReport;
  readiness: ReadinessReport;
  startedAt?: UtcTimestamp;
  observedAt: UtcTimestamp;
  lifecycleGeneration: number;
  services: readonly RuntimeServiceSnapshot[];
  availableCapabilities: readonly RuntimeCapability[];
  degradedCapabilities: readonly RuntimeCapability[];
  failures: readonly LifecycleError[];
  degradations: readonly DegradationReport[];
}>;

export type RuntimeOperationResult = Readonly<{
  ok: boolean;
  runtimeInstanceId: RuntimeInstanceId;
  state: RuntimeState;
  health: HealthReport;
  readiness: ReadinessReport;
  servicesStarted: readonly ServiceId[];
  servicesStopped: readonly ServiceId[];
  availableCapabilities: readonly RuntimeCapability[];
  degradedCapabilities: readonly RuntimeCapability[];
  warnings: readonly LifecycleError[];
  errors: readonly LifecycleError[];
  durationMs: number;
}>;

export type LifecycleObserver = (record: LifecycleRecord) => void;

export type ProcessSignal = "SIGINT" | "SIGTERM";

export type ProcessSignalSource = Readonly<{
  onSignal: (signal: ProcessSignal, handler: () => void) => void;
  offSignal: (signal: ProcessSignal, handler: () => void) => void;
}>;
