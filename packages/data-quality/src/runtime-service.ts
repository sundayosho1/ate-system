import { runtimeModes, type RuntimeMode } from "@ate/domain";
import {
  serviceDescriptor,
  type HealthReport,
  type ReadinessReport,
  type RuntimeManagedService,
  type ServiceId,
} from "@ate/runtime";
import type { Clock } from "@ate/time";

import type { DataQualityEngine } from "./engine.js";
import type { DataQualityDiagnostics, DataQualityReportRepository } from "./types.js";

export const dataQualityServiceId = "data-quality-engine" as ServiceId;

export type DataQualityRuntimeServiceInput = Readonly<{
  runtimeMode: Exclude<RuntimeMode, "LIVE">;
  clock: Clock;
  engine: DataQualityEngine;
  reportRepository: DataQualityReportRepository;
  registeredRuleCount: number;
  configurationFingerprint?: string;
}>;

export class DataQualityRuntimeService {
  public readonly managedService: RuntimeManagedService;
  private state: DataQualityDiagnostics["state"] = "CREATED";

  public constructor(private readonly input: DataQualityRuntimeServiceInput) {
    this.managedService = this.createManagedService();
  }

  public async initialize(): Promise<void> {
    this.state = "INITIALIZING";
    const diagnostics = await this.input.reportRepository.diagnostics();
    this.state = diagnostics.ok ? "READY" : "FAILED";
  }

  public async stop(): Promise<void> {
    await Promise.resolve();
    this.state = "STOPPING";
    this.state = "STOPPED";
  }

  public async diagnostics(): Promise<DataQualityDiagnostics> {
    const storage = await this.input.reportRepository.diagnostics();
    return {
      state: this.state,
      registeredRuleCount: this.input.registeredRuleCount,
      recentReportIds: this.input.engine.recentReportIds(),
      recentFailures: this.input.engine.recentReportFailures(),
      storage: storage.ok
        ? storage.value
        : {
            stagedReportCount: 0,
            publishedReportCount: 0,
            orphanedStagingCount: 1,
          },
      ...(this.input.configurationFingerprint === undefined
        ? {}
        : { configurationFingerprint: this.input.configurationFingerprint }),
    };
  }

  private createManagedService(): RuntimeManagedService {
    return {
      descriptor: serviceDescriptor({
        serviceId: dataQualityServiceId,
        name: "Data Quality Engine",
        version: "0.15.0-data-quality.1",
        description:
          "Deterministic historical dataset quality assessment with immutable reports, bounded findings and non-trading qualification diagnostics.",
        criticality: "OPTIONAL",
        dependencies: [],
        optionalDependencies: [],
        supportedModes: runtimeModes.filter((mode) => mode !== "LIVE"),
        degradationPolicy: "CONTINUE_WITHOUT_CAPABILITY",
        capabilities: ["MARKET_DATA_READ", "DATA_QUALITY_ENGINE"],
        healthCapability: true,
        readinessCapability: true,
        recoverable: true,
      }),
      initialize: async () => this.initialize(),
      stop: async () => this.stop(),
      checkHealth: async () => this.health(),
      checkReadiness: async () => this.readiness(),
    };
  }

  private async health(): Promise<HealthReport> {
    const diagnostics = await this.diagnostics();
    const healthy = diagnostics.state === "READY" && diagnostics.storage.orphanedStagingCount === 0;
    return {
      status: healthy ? "HEALTHY" : "DEGRADED",
      timestamp: this.input.clock.now(),
      serviceId: dataQualityServiceId,
      reason: healthy ? "data quality engine is healthy" : "data quality engine is degraded",
      details: {
        registeredRuleCount: diagnostics.registeredRuleCount,
        publishedReportCount: diagnostics.storage.publishedReportCount,
      },
    };
  }

  private async readiness(): Promise<ReadinessReport> {
    const diagnostics = await this.diagnostics();
    const ready = diagnostics.state === "READY" && diagnostics.registeredRuleCount > 0;
    return {
      status: ready ? "READY" : "NOT_READY",
      timestamp: this.input.clock.now(),
      serviceId: dataQualityServiceId,
      reason: ready ? "data quality engine is ready" : "data quality engine is not ready",
      details: {
        registeredRuleCount: diagnostics.registeredRuleCount,
        storageRoot: diagnostics.storage.storageRoot,
      },
    };
  }
}
