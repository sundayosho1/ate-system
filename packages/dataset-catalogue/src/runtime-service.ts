import { runtimeModes, type RuntimeMode } from "@ate/domain";
import {
  serviceDescriptor,
  type HealthReport,
  type ReadinessReport,
  type RuntimeManagedService,
  type ServiceId,
} from "@ate/runtime";
import type { Clock } from "@ate/time";

import type {
  DatasetCatalogueDiagnostics,
  DatasetCatalogueRepository,
  DatasetCatalogueService,
} from "./types.js";

export const datasetCatalogueServiceId = "dataset-catalogue-lineage" as ServiceId;

export type DatasetCatalogueRuntimeServiceInput = Readonly<{
  runtimeMode: Exclude<RuntimeMode, "LIVE">;
  clock: Clock;
  service: DatasetCatalogueService;
  repository: DatasetCatalogueRepository;
  configurationFingerprint?: string;
}>;

export class DatasetCatalogueRuntimeService {
  public readonly managedService: RuntimeManagedService;
  private state: DatasetCatalogueDiagnostics["state"] = "CREATED";

  public constructor(private readonly input: DatasetCatalogueRuntimeServiceInput) {
    this.managedService = this.createManagedService();
  }

  public async initialize(): Promise<void> {
    this.state = "INITIALIZING";
    const diagnostics = await this.input.repository.diagnostics();
    this.state =
      diagnostics.ok && diagnostics.value.brokenLineageCount === 0 ? "READY" : "DEGRADED";
  }

  public async stop(): Promise<void> {
    await Promise.resolve();
    this.state = "STOPPING";
    this.state = "STOPPED";
  }

  public async diagnostics(): Promise<DatasetCatalogueDiagnostics> {
    const diagnostics = await this.input.service.diagnostics();
    if (!diagnostics.ok) {
      return {
        state: "FAILED",
        familyCount: 0,
        versionCount: 0,
        activeCount: 0,
        qualifiedCount: 0,
        quarantinedCount: 0,
        invalidatedCount: 0,
        retiredCount: 0,
        integrityMismatchCount: 0,
        brokenLineageCount: 1,
        orphanCount: 0,
        qualityLinkedCount: 0,
        lineageEdgeCount: 0,
        maximumObservedLineageDepth: 0,
        recentRegistrations: [],
        recentFailures: [diagnostics.error],
        repositoryStatus: "FAILED",
      };
    }
    return {
      ...diagnostics.value,
      state: this.state,
      ...(this.input.configurationFingerprint === undefined
        ? {}
        : { configurationFingerprint: this.input.configurationFingerprint }),
    };
  }

  private createManagedService(): RuntimeManagedService {
    return {
      descriptor: serviceDescriptor({
        serviceId: datasetCatalogueServiceId,
        name: "Dataset Catalogue and Lineage",
        version: "0.16.0-dataset-catalogue.1",
        description:
          "Governs dataset family/version identity, provenance, lineage, integrity, quality references, lifecycle, eligibility and reproducibility metadata.",
        criticality: "OPTIONAL",
        dependencies: [],
        optionalDependencies: [],
        supportedModes: runtimeModes.filter((mode) => mode !== "LIVE"),
        degradationPolicy: "BLOCK_READINESS",
        capabilities: ["MARKET_DATA_READ", "DATASET_CATALOGUE"],
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
    const healthy =
      diagnostics.state === "READY" &&
      diagnostics.repositoryStatus === "READY" &&
      diagnostics.brokenLineageCount === 0;
    return {
      status: healthy ? "HEALTHY" : "DEGRADED",
      timestamp: this.input.clock.now(),
      serviceId: datasetCatalogueServiceId,
      reason: healthy ? "dataset catalogue is healthy" : "dataset catalogue is degraded",
      details: {
        familyCount: diagnostics.familyCount,
        versionCount: diagnostics.versionCount,
        brokenLineageCount: diagnostics.brokenLineageCount,
      },
    };
  }

  private async readiness(): Promise<ReadinessReport> {
    const diagnostics = await this.diagnostics();
    const ready =
      diagnostics.state === "READY" &&
      diagnostics.repositoryStatus === "READY" &&
      diagnostics.brokenLineageCount === 0;
    return {
      status: ready ? "READY" : "NOT_READY",
      timestamp: this.input.clock.now(),
      serviceId: datasetCatalogueServiceId,
      reason: ready ? "dataset catalogue is ready" : "dataset catalogue is not ready",
      details: {
        activeCount: diagnostics.activeCount,
        lineageEdgeCount: diagnostics.lineageEdgeCount,
        integrityMismatchCount: diagnostics.integrityMismatchCount,
      },
    };
  }
}
