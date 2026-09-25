import { runtimeModes, type RuntimeMode } from "@ate/domain";
import {
  serviceDescriptor,
  type HealthReport,
  type ReadinessReport,
  type RuntimeManagedService,
  type ServiceId,
} from "@ate/runtime";

import { ClockQualityMonitor } from "./quality.js";
import { DeterministicScheduler } from "./scheduler.js";
import { temporalError } from "./errors.js";
import type {
  Clock,
  ClockDiagnostics,
  ClockQualityState,
  ClockRuntimeOptions,
  MonotonicClock,
  TemporalError,
  TemporalResult,
} from "./types.js";

export const clockRuntimeServiceId = "time.clock" as ServiceId;

export type ClockRuntimeServiceInput = Readonly<{
  clock: Clock;
  monotonicClock?: MonotonicClock;
  scheduler?: DeterministicScheduler;
  options: ClockRuntimeOptions;
  timezoneCapability?: boolean;
}>;

export class ClockRuntimeService {
  public readonly managedService: RuntimeManagedService;
  public readonly scheduler: DeterministicScheduler;

  private readonly qualityMonitor: ClockQualityMonitor;
  private readonly recentErrors: TemporalError[] = [];
  private started = false;

  public constructor(private readonly input: ClockRuntimeServiceInput) {
    this.scheduler =
      input.scheduler ??
      new DeterministicScheduler(input.clock, undefined, {
        maxScheduledTasks: input.options.schedulerMaxTasks,
      });
    this.qualityMonitor = new ClockQualityMonitor(
      input.options.clockJumpWarningThresholdMs,
      input.options.clockJumpCriticalThresholdMs,
    );
    this.managedService = this.createManagedService();
  }

  public initialize(): TemporalResult<void> {
    const compatibility = this.validateCompatibility();
    if (!compatibility.ok) {
      this.recordError(compatibility.error);
      return compatibility;
    }
    this.started = true;
    this.observeQuality();
    return { ok: true, value: undefined };
  }

  public stop(): void {
    this.started = false;
    this.scheduler.stop();
  }

  public diagnostics(): ClockDiagnostics {
    const lastClockJump = this.qualityMonitor.lastClockJump();
    return {
      currentUtc: this.input.clock.now(),
      clockMode: this.input.clock.mode,
      runtimeMode: this.input.options.runtimeMode,
      source: this.input.clock.provenance.source,
      quality: this.currentQuality(),
      monotonicAvailable: this.input.monotonicClock !== undefined,
      timezoneCapability: this.input.timezoneCapability ?? true,
      scheduledTaskCount: this.scheduler.snapshot().scheduledTaskCount,
      ...(lastClockJump === undefined ? {} : { lastClockJump }),
      recentErrors: [...this.recentErrors],
    };
  }

  public checkHealth(timestamp = this.input.clock.now()): HealthReport {
    const quality = this.currentQuality();
    return {
      status:
        quality === "UNTRUSTED"
          ? "UNHEALTHY"
          : quality === "DEGRADED" || !this.started
            ? "DEGRADED"
            : "HEALTHY",
      timestamp,
      serviceId: clockRuntimeServiceId,
      details: this.diagnostics(),
    };
  }

  public checkReadiness(timestamp = this.input.clock.now()): ReadinessReport {
    const compatibility = this.validateCompatibility();
    if (!compatibility.ok) {
      this.recordError(compatibility.error);
      return {
        status: "NOT_READY",
        timestamp,
        serviceId: clockRuntimeServiceId,
        reason: compatibility.error.message,
        details: this.diagnostics(),
      };
    }
    const quality = this.currentQuality();
    return {
      status: quality === "UNTRUSTED" || !this.started ? "NOT_READY" : "READY",
      timestamp,
      serviceId: clockRuntimeServiceId,
      details: this.diagnostics(),
    };
  }

  public observeQuality(): ClockQualityState {
    if (this.input.monotonicClock === undefined) {
      return this.input.clock.provenance.quality;
    }
    return this.qualityMonitor.observe({
      wallClock: this.input.clock.now(),
      monotonic: this.input.monotonicClock.now(),
    });
  }

  public validateCompatibility(): TemporalResult<void> {
    const { runtimeMode, clockMode } = this.input.options;
    if (clockMode !== this.input.clock.mode) {
      return this.incompatible(
        runtimeMode,
        `configured clock mode ${clockMode} does not match clock implementation ${this.input.clock.mode}`,
      );
    }
    if (runtimeMode === "LIVE" && clockMode !== "SYSTEM") {
      return this.incompatible(runtimeMode, "LIVE runtime requires the system UTC clock");
    }
    if (runtimeMode === "PAPER" && (clockMode === "SIMULATION" || clockMode === "REPLAY")) {
      return this.incompatible(runtimeMode, "PAPER runtime cannot use simulation or replay clocks");
    }
    return { ok: true, value: undefined };
  }

  private createManagedService(): RuntimeManagedService {
    return {
      descriptor: serviceDescriptor({
        serviceId: clockRuntimeServiceId,
        name: "ATE Time Authority",
        version: "0.6.0-time.1",
        description:
          "Authoritative UTC clock, monotonic duration, virtual/simulation/replay clocks, deterministic scheduler and temporal diagnostics.",
        criticality: "CRITICAL",
        supportedModes: runtimeModes,
        capabilities: ["TIME_AUTHORITY", "DETERMINISTIC_SCHEDULER"],
        degradationPolicy: "FAIL_RUNTIME",
        healthCapability: true,
        readinessCapability: true,
        recoverable: true,
      }),
      initialize: () => {
        const result = this.initialize();
        if (!result.ok) {
          throw new Error(result.error.message);
        }
      },
      stop: () => {
        this.stop();
      },
      checkHealth: (context) => this.checkHealth(context.now()),
      checkReadiness: (context) => this.checkReadiness(context.now()),
    };
  }

  private currentQuality(): ClockQualityState {
    const monitored = this.qualityMonitor.currentQuality();
    return monitored === "UNKNOWN" ? this.input.clock.provenance.quality : monitored;
  }

  private incompatible(runtimeMode: RuntimeMode, message: string): TemporalResult<void> {
    return {
      ok: false,
      error: temporalError({
        code: "CLOCK_MODE_INCOMPATIBLE",
        message,
        timestamp: this.input.clock.now(),
        source: this.input.clock.provenance.source,
        details: { runtimeMode, clockMode: this.input.clock.mode },
      }),
    };
  }

  private recordError(error: TemporalError): void {
    this.recentErrors.unshift(error);
    this.recentErrors.splice(20);
  }
}

export const createClockRuntimeService = (input: ClockRuntimeServiceInput): ClockRuntimeService =>
  new ClockRuntimeService(input);
