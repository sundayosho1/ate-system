import type { CorrelationId, RuntimeMode, UtcTimestamp } from "@ate/domain";

import { buildDependencyGraph, type RuntimeGraph } from "./graph.js";
import { lifecycleError, systemClock, timeout, toErrorMessage } from "./primitives.js";
import type {
  DegradationReport,
  HealthReport,
  LifecycleError,
  LifecycleObserver,
  LifecycleRecord,
  ReadinessReport,
  ReadinessStatus,
  RuntimeCapability,
  RuntimeClock,
  RuntimeInstanceId,
  RuntimeManagedService,
  RuntimeOperationResult,
  RuntimeServiceSnapshot,
  RuntimeSnapshot,
  RuntimeState,
  ServiceId,
  ServiceState,
} from "./types.js";

const defaultTimeoutMs = 5_000;

export class ATERuntime {
  private state: RuntimeState = "CREATED";
  private readonly servicesById: ReadonlyMap<ServiceId, RuntimeManagedService>;
  private readonly graph: RuntimeGraph;
  private readonly serviceStates = new Map<ServiceId, ServiceState>();
  private readonly serviceHealth = new Map<ServiceId, HealthReport>();
  private readonly serviceReadiness = new Map<ServiceId, ReadinessReport>();
  private readonly failures: LifecycleError[] = [];
  private readonly degradations: DegradationReport[] = [];
  private readonly records: LifecycleRecord[] = [];
  private readonly observers: LifecycleObserver[] = [];
  private readonly abortController = new AbortController();
  private lifecycleGeneration = 0;
  private startedAt: UtcTimestamp | undefined;
  private transitioning = false;
  private stopOperation: Promise<RuntimeOperationResult> | undefined;

  public constructor(
    private readonly runtimeInstanceId: RuntimeInstanceId,
    private readonly runtimeVersion: string,
    private readonly runtimeMode: RuntimeMode,
    services: readonly RuntimeManagedService[],
    graph: RuntimeGraph,
    private readonly baseCapabilities: readonly RuntimeCapability[],
    private readonly clock: RuntimeClock = systemClock,
    private readonly timeoutMs: number = defaultTimeoutMs,
  ) {
    this.servicesById = graph.servicesById;
    this.graph = graph;
    for (const service of services) {
      this.serviceStates.set(service.descriptor.serviceId, "REGISTERED");
      this.serviceHealth.set(
        service.descriptor.serviceId,
        this.defaultHealth(service.descriptor.serviceId),
      );
      this.serviceReadiness.set(
        service.descriptor.serviceId,
        this.defaultReadiness(service.descriptor.serviceId),
      );
    }
    this.record("runtime.created");
  }

  public get mode(): RuntimeMode {
    return this.runtimeMode;
  }

  public get currentState(): RuntimeState {
    return this.state;
  }

  public addObserver(observer: LifecycleObserver): void {
    this.observers.push(observer);
  }

  public getLifecycleRecords(): readonly LifecycleRecord[] {
    return [...this.records];
  }

  public async start(correlationId?: CorrelationId): Promise<RuntimeOperationResult> {
    const started = Date.now();
    if (this.transitioning) {
      return this.operationResult(false, started, {
        errors: [
          lifecycleError(
            "LIFECYCLE_CONFLICT",
            "runtime lifecycle operation already in progress",
            this.now(),
          ),
        ],
      });
    }
    if (this.state !== "CREATED") {
      return this.operationResult(false, started, {
        errors: [
          lifecycleError(
            "INVALID_STATE_TRANSITION",
            `cannot start runtime from state ${this.state}`,
            this.now(),
          ),
        ],
      });
    }

    this.transitioning = true;
    const initializedOrStarted: ServiceId[] = [];
    const servicesStarted: ServiceId[] = [];
    const errors: LifecycleError[] = [];

    try {
      this.transitionRuntime("INITIALIZING", correlationId);
      for (const serviceId of this.graph.startupOrder) {
        const service = this.requireService(serviceId);
        this.serviceStates.set(serviceId, "INITIALIZING");
        this.record("service.initializing", correlationId, serviceId);
        try {
          await this.invokeService(service, "initialize", "INITIALIZATION_FAILED", correlationId);
          initializedOrStarted.push(serviceId);
          this.serviceStates.set(serviceId, "INITIALIZED");
        } catch (error) {
          errors.push(this.normalizeError(error, "INITIALIZATION_FAILED", serviceId));
          break;
        }
      }

      if (errors.length === 0) {
        this.transitionRuntime("STARTING", correlationId);
        for (const serviceId of this.graph.startupOrder) {
          const service = this.requireService(serviceId);
          this.serviceStates.set(serviceId, "STARTING");
          this.record("service.starting", correlationId, serviceId);
          try {
            await this.invokeService(service, "start", "STARTUP_FAILED", correlationId);
            this.serviceStates.set(serviceId, "RUNNING");
            this.record("service.started", correlationId, serviceId);
            if (!initializedOrStarted.includes(serviceId)) {
              initializedOrStarted.push(serviceId);
            }
            servicesStarted.push(serviceId);
          } catch (error) {
            errors.push(this.normalizeError(error, "STARTUP_FAILED", serviceId));
            break;
          }
        }
      }

      if (errors.length === 0) {
        await this.refreshHealthAndReadiness(correlationId);
        const health = this.aggregateHealth();
        const readiness = this.aggregateReadiness();
        if (health.status === "UNHEALTHY" || readiness.status === "NOT_READY") {
          errors.push(
            lifecycleError(
              "STARTUP_FAILED",
              "startup admission rejected by health/readiness gate",
              this.now(),
              undefined,
              { health: health.status, readiness: readiness.status },
            ),
          );
        }
      }

      if (errors.length > 0) {
        this.failures.push(...errors);
        await this.rollback(initializedOrStarted, correlationId, errors);
        this.transitionRuntime("FAILED", correlationId, errors[0]);
        return this.operationResult(false, started, { errors, servicesStarted });
      }

      this.startedAt = this.now();
      this.transitionRuntime(
        this.aggregateHealth().status === "DEGRADED" ? "DEGRADED" : "RUNNING",
        correlationId,
      );
      return this.operationResult(true, started, { servicesStarted });
    } finally {
      this.transitioning = false;
    }
  }

  public async stop(correlationId?: CorrelationId): Promise<RuntimeOperationResult> {
    if (this.stopOperation !== undefined) {
      return this.stopOperation;
    }
    const started = Date.now();
    if (this.transitioning) {
      return this.operationResult(false, started, {
        errors: [
          lifecycleError(
            "LIFECYCLE_CONFLICT",
            "runtime cannot stop while another lifecycle operation is in progress",
            this.now(),
          ),
        ],
      });
    }
    if (this.state === "STOPPED") {
      return this.operationResult(true, started);
    }

    this.stopOperation = this.stopInternal(started, correlationId);
    return this.stopOperation;
  }

  public async degradeService(
    serviceId: ServiceId,
    reasonMessage: string,
    correlationId?: CorrelationId,
  ): Promise<RuntimeOperationResult> {
    const started = Date.now();
    const service = this.servicesById.get(serviceId);
    if (service === undefined) {
      const error = lifecycleError(
        "SERVICE_NOT_FOUND",
        `service not found: ${serviceId}`,
        this.now(),
        serviceId,
      );
      return this.operationResult(false, started, { errors: [error] });
    }
    const error = lifecycleError("HEALTH_CHECK_FAILED", reasonMessage, this.now(), serviceId);
    try {
      await this.invokeService(service, "degrade", "HEALTH_CHECK_FAILED", correlationId, error);
    } catch (caught) {
      this.failures.push(this.normalizeError(caught, "HEALTH_CHECK_FAILED", serviceId));
    }
    this.serviceStates.set(
      serviceId,
      service.descriptor.criticality === "OPTIONAL" ? "DEGRADED" : "FAILED",
    );
    this.serviceHealth.set(serviceId, {
      status: service.descriptor.criticality === "OPTIONAL" ? "DEGRADED" : "UNHEALTHY",
      timestamp: this.now(),
      serviceId,
      reason: reasonMessage,
    });
    this.serviceReadiness.set(serviceId, {
      status: "NOT_READY",
      timestamp: this.now(),
      serviceId,
      reason: reasonMessage,
    });
    await this.refreshDependencyReadiness();
    const degradation = this.createDegradationReport(serviceId, error);
    this.degradations.push(degradation);
    this.transitionRuntime(
      this.aggregateHealth().status === "UNHEALTHY" ? "FAILED" : "DEGRADED",
      correlationId,
      error,
    );
    return this.operationResult(true, started, {
      warnings: [error],
    });
  }

  public async recoverService(
    serviceId: ServiceId,
    correlationId?: CorrelationId,
  ): Promise<RuntimeOperationResult> {
    const started = Date.now();
    const service = this.servicesById.get(serviceId);
    if (service === undefined) {
      const error = lifecycleError(
        "SERVICE_NOT_FOUND",
        `service not found: ${serviceId}`,
        this.now(),
        serviceId,
      );
      return this.operationResult(false, started, { errors: [error] });
    }
    if (!service.descriptor.recoverable || service.recover === undefined) {
      const error = lifecycleError(
        "RECOVERY_FAILED",
        `service ${serviceId} is not recoverable`,
        this.now(),
        serviceId,
      );
      return this.operationResult(false, started, { errors: [error] });
    }

    this.transitionRuntime("RECOVERING", correlationId);
    this.serviceStates.set(serviceId, "RECOVERING");
    try {
      await this.invokeService(service, "recover", "RECOVERY_FAILED", correlationId);
      this.serviceStates.set(serviceId, "RUNNING");
      await this.refreshHealthAndReadiness(correlationId);
      this.transitionRuntime(
        this.aggregateHealth().status === "DEGRADED" ? "DEGRADED" : "RUNNING",
        correlationId,
      );
      return this.operationResult(true, started);
    } catch (error) {
      const normalized = this.normalizeError(error, "RECOVERY_FAILED", serviceId);
      this.failures.push(normalized);
      this.serviceStates.set(serviceId, "FAILED");
      this.transitionRuntime("FAILED", correlationId, normalized);
      return this.operationResult(false, started, { errors: [normalized] });
    }
  }

  public snapshot(): RuntimeSnapshot {
    return deepFreeze({
      runtimeInstanceId: this.runtimeInstanceId,
      runtimeVersion: this.runtimeVersion,
      runtimeMode: this.runtimeMode,
      state: this.state,
      health: this.aggregateHealth(),
      readiness: this.aggregateReadiness(),
      ...(this.startedAt === undefined ? {} : { startedAt: this.startedAt }),
      observedAt: this.now(),
      lifecycleGeneration: this.lifecycleGeneration,
      services: this.serviceSnapshots(),
      availableCapabilities: this.availableCapabilities(),
      degradedCapabilities: this.degradedCapabilities(),
      failures: [...this.failures],
      degradations: [...this.degradations],
    });
  }

  private async stopInternal(
    started: number,
    correlationId?: CorrelationId,
  ): Promise<RuntimeOperationResult> {
    const errors: LifecycleError[] = [];
    const servicesStopped: ServiceId[] = [];
    this.transitionRuntime("STOPPING", correlationId);
    this.abortController.abort();

    for (const serviceId of this.graph.shutdownOrder) {
      const service = this.requireService(serviceId);
      if (this.serviceStates.get(serviceId) === "REGISTERED") {
        continue;
      }
      this.serviceStates.set(serviceId, "STOPPING");
      try {
        await this.invokeService(service, "stop", "SHUTDOWN_FAILED", correlationId);
        servicesStopped.push(serviceId);
      } catch (error) {
        errors.push(this.normalizeError(error, "SHUTDOWN_FAILED", serviceId));
      }
      try {
        await this.invokeService(service, "dispose", "SHUTDOWN_FAILED", correlationId);
      } catch (error) {
        errors.push(this.normalizeError(error, "SHUTDOWN_FAILED", serviceId));
      }
      this.serviceStates.set(serviceId, "STOPPED");
      this.record("service.stopped", correlationId, serviceId);
    }

    this.failures.push(...errors);
    this.transitionRuntime("STOPPED", correlationId, errors[0]);
    return this.operationResult(errors.length === 0, started, { errors, servicesStopped });
  }

  private async rollback(
    serviceIds: readonly ServiceId[],
    correlationId: CorrelationId | undefined,
    errors: LifecycleError[],
  ): Promise<void> {
    for (const serviceId of [...serviceIds].reverse()) {
      const service = this.requireService(serviceId);
      try {
        await this.invokeService(service, "stop", "SHUTDOWN_FAILED", correlationId);
      } catch (error) {
        errors.push(this.normalizeError(error, "SHUTDOWN_FAILED", serviceId));
      }
      try {
        await this.invokeService(service, "dispose", "SHUTDOWN_FAILED", correlationId);
      } catch (error) {
        errors.push(this.normalizeError(error, "SHUTDOWN_FAILED", serviceId));
      }
      this.serviceStates.set(serviceId, "STOPPED");
    }
  }

  private async refreshHealthAndReadiness(correlationId?: CorrelationId): Promise<void> {
    for (const serviceId of this.graph.startupOrder) {
      const service = this.requireService(serviceId);
      this.serviceHealth.set(serviceId, await this.checkServiceHealth(service, correlationId));
      this.serviceReadiness.set(
        serviceId,
        await this.checkServiceReadiness(service, correlationId),
      );
    }
    await this.refreshDependencyReadiness();
  }

  private async refreshDependencyReadiness(): Promise<void> {
    for (const serviceId of this.graph.startupOrder) {
      const service = this.requireService(serviceId);
      for (const dependencyId of service.descriptor.dependencies) {
        const dependencyReadiness = this.serviceReadiness.get(dependencyId);
        if (dependencyReadiness?.status === "NOT_READY") {
          this.serviceReadiness.set(serviceId, {
            status: "NOT_READY",
            timestamp: this.now(),
            serviceId,
            reason: `required dependency ${dependencyId} is not ready`,
          });
        }
      }
    }
  }

  private async checkServiceHealth(
    service: RuntimeManagedService,
    correlationId?: CorrelationId,
  ): Promise<HealthReport> {
    if (!service.descriptor.healthCapability || service.checkHealth === undefined) {
      return this.defaultHealth(service.descriptor.serviceId);
    }
    try {
      return await this.invokeService(service, "checkHealth", "HEALTH_CHECK_FAILED", correlationId);
    } catch (error) {
      const normalized = this.normalizeError(
        error,
        "HEALTH_CHECK_FAILED",
        service.descriptor.serviceId,
      );
      this.failures.push(normalized);
      return {
        status: "UNHEALTHY",
        timestamp: this.now(),
        serviceId: service.descriptor.serviceId,
        reason: normalized.message,
      };
    }
  }

  private async checkServiceReadiness(
    service: RuntimeManagedService,
    correlationId?: CorrelationId,
  ): Promise<ReadinessReport> {
    if (!service.descriptor.readinessCapability || service.checkReadiness === undefined) {
      return this.defaultReadiness(service.descriptor.serviceId);
    }
    try {
      return await this.invokeService(service, "checkReadiness", "READINESS_FAILED", correlationId);
    } catch (error) {
      const normalized = this.normalizeError(
        error,
        "READINESS_FAILED",
        service.descriptor.serviceId,
      );
      this.failures.push(normalized);
      return {
        status: "NOT_READY",
        timestamp: this.now(),
        serviceId: service.descriptor.serviceId,
        reason: normalized.message,
      };
    }
  }

  private async invokeService<TMethod extends keyof RuntimeManagedService>(
    service: RuntimeManagedService,
    method: TMethod,
    timeoutCode:
      | "INITIALIZATION_FAILED"
      | "STARTUP_FAILED"
      | "HEALTH_CHECK_FAILED"
      | "READINESS_FAILED"
      | "RECOVERY_FAILED"
      | "SHUTDOWN_FAILED",
    correlationId?: CorrelationId,
    ...args: readonly unknown[]
  ): Promise<Awaited<ReturnType<NonNullable<RuntimeManagedService[TMethod]>>>> {
    const fn = service[method];
    if (typeof fn !== "function") {
      return undefined as Awaited<ReturnType<NonNullable<RuntimeManagedService[TMethod]>>>;
    }
    const context = this.context(correlationId);
    return timeout(
      Promise.resolve(
        (
          fn as (
            ...values: unknown[]
          ) => Awaited<ReturnType<NonNullable<RuntimeManagedService[TMethod]>>>
        )(context, ...args),
      ),
      this.timeoutMs,
      () =>
        lifecycleError(
          timeoutCode === "SHUTDOWN_FAILED" ? "SHUTDOWN_TIMEOUT" : "STARTUP_TIMEOUT",
          `${String(method)} timed out for service ${service.descriptor.serviceId}`,
          this.now(),
          service.descriptor.serviceId,
        ),
    );
  }

  private operationResult(
    ok: boolean,
    started: number,
    values: Partial<
      Pick<RuntimeOperationResult, "errors" | "warnings" | "servicesStarted" | "servicesStopped">
    > = {},
  ): RuntimeOperationResult {
    return {
      ok,
      runtimeInstanceId: this.runtimeInstanceId,
      state: this.state,
      health: this.aggregateHealth(),
      readiness: this.aggregateReadiness(),
      servicesStarted: values.servicesStarted ?? [],
      servicesStopped: values.servicesStopped ?? [],
      availableCapabilities: this.availableCapabilities(),
      degradedCapabilities: this.degradedCapabilities(),
      warnings: values.warnings ?? [],
      errors: values.errors ?? [],
      durationMs: Date.now() - started,
    };
  }

  private aggregateHealth(): HealthReport {
    let status: HealthReport["status"] = "HEALTHY";
    const reasons: string[] = [];
    for (const service of this.servicesById.values()) {
      const report =
        this.serviceHealth.get(service.descriptor.serviceId) ??
        this.defaultHealth(service.descriptor.serviceId);
      if (
        service.descriptor.criticality === "CRITICAL" &&
        (report.status === "UNHEALTHY" || report.status === "UNKNOWN")
      ) {
        status = "UNHEALTHY";
      } else if (
        report.status === "UNHEALTHY" ||
        report.status === "UNKNOWN" ||
        report.status === "DEGRADED"
      ) {
        if (status !== "UNHEALTHY") {
          status = "DEGRADED";
        }
      }
      if (report.reason !== undefined) {
        reasons.push(`${service.descriptor.serviceId}: ${report.reason}`);
      }
    }
    return {
      status,
      timestamp: this.now(),
      reason: reasons.length === 0 ? undefined : reasons.join("; "),
    };
  }

  private aggregateReadiness(): ReadinessReport {
    let status: ReadinessStatus = "READY";
    const reasons: string[] = [];
    for (const service of this.servicesById.values()) {
      const readiness =
        this.serviceReadiness.get(service.descriptor.serviceId) ??
        this.defaultReadiness(service.descriptor.serviceId);
      if (
        service.descriptor.criticality !== "OPTIONAL" &&
        (readiness.status === "NOT_READY" ||
          this.serviceStates.get(service.descriptor.serviceId) === "FAILED")
      ) {
        status = "NOT_READY";
      } else if (readiness.status !== "READY" && status !== "NOT_READY") {
        status = "DEGRADED_READY";
      }
      if (readiness.reason !== undefined) {
        reasons.push(`${service.descriptor.serviceId}: ${readiness.reason}`);
      }
    }
    return {
      status,
      timestamp: this.now(),
      reason: reasons.length === 0 ? undefined : reasons.join("; "),
    };
  }

  private availableCapabilities(): readonly RuntimeCapability[] {
    const capabilities = new Set<RuntimeCapability>(this.baseCapabilities);
    for (const service of this.servicesById.values()) {
      const state = this.serviceStates.get(service.descriptor.serviceId);
      const health = this.serviceHealth.get(service.descriptor.serviceId);
      const readiness = this.serviceReadiness.get(service.descriptor.serviceId);
      if (
        state === "RUNNING" &&
        health?.status !== "UNHEALTHY" &&
        health?.status !== "UNKNOWN" &&
        readiness?.status !== "NOT_READY"
      ) {
        for (const capability of service.descriptor.capabilities) {
          capabilities.add(capability);
        }
      }
    }
    capabilities.delete("LIVE_EXECUTION");
    return [...capabilities].sort();
  }

  private degradedCapabilities(): readonly RuntimeCapability[] {
    const unavailable = new Set<RuntimeCapability>();
    for (const service of this.servicesById.values()) {
      const state = this.serviceStates.get(service.descriptor.serviceId);
      const readiness = this.serviceReadiness.get(service.descriptor.serviceId);
      if (state === "DEGRADED" || state === "FAILED" || readiness?.status === "NOT_READY") {
        for (const capability of service.descriptor.capabilities) {
          unavailable.add(capability);
        }
      }
    }
    return [...unavailable].sort();
  }

  private createDegradationReport(serviceId: ServiceId, reason: LifecycleError): DegradationReport {
    const service = this.requireService(serviceId);
    const affectedDependants = this.graph.dependantsById.get(serviceId) ?? [];
    return {
      timestamp: this.now(),
      serviceId,
      criticality: service.descriptor.criticality,
      affectedCapabilities: service.descriptor.capabilities,
      affectedDependants,
      reason,
      recoverable: service.descriptor.recoverable,
      operationMayContinue: service.descriptor.criticality === "OPTIONAL",
      currentReadiness: this.aggregateReadiness().status,
    };
  }

  private transitionRuntime(
    state: RuntimeState,
    correlationId?: CorrelationId,
    error?: LifecycleError,
  ): void {
    this.state = state;
    this.lifecycleGeneration += 1;
    this.record(`runtime.${state.toLowerCase()}`, correlationId, undefined, error);
  }

  private record(
    transition: string,
    correlationId?: CorrelationId,
    serviceId?: ServiceId,
    error?: LifecycleError,
  ): void {
    const record: LifecycleRecord = {
      timestamp: this.now(),
      runtimeInstanceId: this.runtimeInstanceId,
      runtimeMode: this.runtimeMode,
      transition,
      ...(correlationId === undefined ? {} : { correlationId }),
      ...(serviceId === undefined ? {} : { serviceId }),
      ...(error === undefined ? {} : { error, reason: error.message }),
    };
    this.records.push(record);
    for (const observer of this.observers) {
      observer(record);
    }
  }

  private serviceSnapshots(): readonly RuntimeServiceSnapshot[] {
    return this.graph.startupOrder.map((serviceId) => {
      const service = this.requireService(serviceId);
      return {
        descriptor: service.descriptor,
        state: this.serviceStates.get(serviceId) ?? "REGISTERED",
        health: this.serviceHealth.get(serviceId) ?? this.defaultHealth(serviceId),
        readiness: this.serviceReadiness.get(serviceId) ?? this.defaultReadiness(serviceId),
      };
    });
  }

  private context(correlationId?: CorrelationId): {
    runtimeInstanceId: RuntimeInstanceId;
    runtimeMode: RuntimeMode;
    correlationId?: CorrelationId;
    signal: AbortSignal;
    now: () => UtcTimestamp;
  } {
    return {
      runtimeInstanceId: this.runtimeInstanceId,
      runtimeMode: this.runtimeMode,
      ...(correlationId === undefined ? {} : { correlationId }),
      signal: this.abortController.signal,
      now: () => this.now(),
    };
  }

  private requireService(serviceId: ServiceId): RuntimeManagedService {
    const service = this.servicesById.get(serviceId);
    if (service === undefined) {
      throw new Error(`service not found: ${serviceId}`);
    }
    return service;
  }

  private normalizeError(
    error: unknown,
    code: LifecycleError["code"],
    serviceId?: ServiceId,
  ): LifecycleError {
    if (isLifecycleError(error)) {
      return error;
    }
    return lifecycleError(code, toErrorMessage(error), this.now(), serviceId);
  }

  private defaultHealth(serviceId: ServiceId): HealthReport {
    return {
      status: "UNKNOWN",
      timestamp: this.now(),
      serviceId,
      reason: "health has not been evaluated",
    };
  }

  private defaultReadiness(serviceId: ServiceId): ReadinessReport {
    return {
      status: "NOT_READY",
      timestamp: this.now(),
      serviceId,
      reason: "readiness has not been evaluated",
    };
  }

  private now(): UtcTimestamp {
    return this.clock.now();
  }
}

export const createRuntime = (options: {
  runtimeInstanceId: RuntimeInstanceId;
  runtimeVersion: string;
  mode: RuntimeMode;
  services: readonly RuntimeManagedService[];
  capabilities?: readonly RuntimeCapability[];
  defaultTimeoutMs?: number;
  clock?: RuntimeClock;
}): { ok: true; runtime: ATERuntime } | { ok: false; errors: readonly LifecycleError[] } => {
  const clock = options.clock ?? systemClock;
  const graph = buildDependencyGraph(options.services, options.mode, clock);
  if (!graph.ok) {
    return { ok: false, errors: graph.errors };
  }
  return {
    ok: true,
    runtime: new ATERuntime(
      options.runtimeInstanceId,
      options.runtimeVersion,
      options.mode,
      options.services,
      graph.graph,
      options.capabilities ?? ["CORE_RUNTIME", "FOUNDATION_RUNTIME"],
      clock,
      options.defaultTimeoutMs ?? defaultTimeoutMs,
    ),
  };
};

const isLifecycleError = (value: unknown): value is LifecycleError =>
  typeof value === "object" &&
  value !== null &&
  "code" in value &&
  "message" in value &&
  "timestamp" in value;

const deepFreeze = <T>(value: T): T => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const nestedValue of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nestedValue);
  }
  return value;
};
