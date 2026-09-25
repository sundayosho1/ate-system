import { runtimeModes, type RuntimeMode } from "@ate/domain";
import {
  serviceDescriptor,
  type HealthReport,
  type ReadinessReport,
  type RuntimeManagedService,
  type ServiceId,
} from "@ate/runtime";
import type { Clock } from "@ate/time";

import type { HistoricalImportService } from "./import-service.js";
import type { HistoricalDatasetRepository, HistoricalDiagnostics } from "./types.js";

export const historicalDataServiceId = "historical-data-laboratory" as ServiceId;

export type HistoricalDataRuntimeServiceInput = Readonly<{
  runtimeMode: RuntimeMode;
  clock: Clock;
  importService: HistoricalImportService;
  repository: HistoricalDatasetRepository;
  supportedFormats: readonly string[];
  configurationFingerprint?: string;
}>;

export class HistoricalDataRuntimeService {
  public readonly managedService: RuntimeManagedService;
  private state: HistoricalDiagnostics["state"] = "CREATED";

  public constructor(private readonly input: HistoricalDataRuntimeServiceInput) {
    this.managedService = this.createManagedService();
  }

  public async initialize(): Promise<void> {
    this.state = "INITIALIZING";
    const diagnostics = await this.input.repository.diagnostics();
    this.state = diagnostics.ok ? "READY" : "FAILED";
  }

  public async stop(): Promise<void> {
    await Promise.resolve();
    this.state = "STOPPING";
    this.state = "STOPPED";
  }

  public async diagnostics(): Promise<HistoricalDiagnostics> {
    const storage = await this.input.repository.diagnostics();
    return {
      state: this.state,
      supportedFormats: this.input.supportedFormats as HistoricalDiagnostics["supportedFormats"],
      parserCount: this.input.supportedFormats.length,
      activeImports: this.input.importService.activeImportCount(),
      recentImports: this.input.importService.recentImportSessions(),
      recentFailures: this.input.importService.recentImportFailures(),
      storage: storage.ok
        ? storage.value
        : {
            stagedDatasetCount: 0,
            publishedDatasetCount: 0,
            quarantinedRecordCount: 0,
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
        serviceId: historicalDataServiceId,
        name: "Historical Data Laboratory",
        version: "0.14.0-historical-data.1",
        description:
          "Controlled offline historical-data artifact intake, canonical normalization, immutable dataset publication, and bounded research query access.",
        criticality: "REQUIRED",
        dependencies: [],
        optionalDependencies: [],
        supportedModes: runtimeModes.filter((mode) => mode !== "LIVE"),
        degradationPolicy: "BLOCK_READINESS",
        capabilities: ["MARKET_DATA_READ", "HISTORICAL_DATA_LAB"],
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
      serviceId: historicalDataServiceId,
      reason: healthy
        ? "historical data laboratory is healthy"
        : "historical data laboratory is degraded",
      details: {
        supportedFormats: diagnostics.supportedFormats,
        activeImports: diagnostics.activeImports,
        publishedDatasetCount: diagnostics.storage.publishedDatasetCount,
      },
    };
  }

  private async readiness(): Promise<ReadinessReport> {
    const diagnostics = await this.diagnostics();
    const ready = diagnostics.state === "READY" && diagnostics.parserCount > 0;
    return {
      status: ready ? "READY" : "NOT_READY",
      timestamp: this.input.clock.now(),
      serviceId: historicalDataServiceId,
      reason: ready
        ? "historical data laboratory is ready"
        : "historical data laboratory is not ready",
      details: {
        parserCount: diagnostics.parserCount,
        storageRoot: diagnostics.storage.storageRoot,
      },
    };
  }
}
