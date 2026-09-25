import { runtimeModes, type RuntimeMode } from "@ate/domain";
import {
  serviceDescriptor,
  type HealthReport,
  type ReadinessReport,
  type RuntimeManagedService,
  type ServiceId,
} from "@ate/runtime";
import { clockRuntimeServiceId, type Clock } from "@ate/time";

import { configurationError, fail, ok } from "./errors.js";
import type { ConfigurationRegistry } from "./registry.js";
import { ConfigurationResolver } from "./resolver.js";
import type { ConfigurationSchemaRegistry } from "./schema-registry.js";
import { combineValidationReports } from "./validation-report.js";
import { validateConfigurationSnapshot, validateEffectiveConfiguration } from "./validation.js";
import type {
  ConfigurationResult,
  ConfigurationSnapshot,
  ConfigurationValidationReport,
} from "./types.js";
import { configurationVersionStreamId } from "./version-repository.js";
import type {
  ConfigurationVersion,
  ConfigurationVersionDiagnostics,
  ConfigurationVersionId,
  ConfigurationVersionRepository,
  ConfigurationVersionRuntimeService,
  ConfigurationVersionStreamId,
  CreateConfigurationVersionInput,
} from "./version-types.js";

export const configurationVersionServiceId = "configuration.versioning" as ServiceId;

export type ConfigurationVersionServiceInput = Readonly<{
  runtimeMode: RuntimeMode;
  clock: Clock;
  registry: ConfigurationRegistry;
  schemaRegistry: ConfigurationSchemaRegistry;
  repository: ConfigurationVersionRepository;
  streamId?: ConfigurationVersionStreamId;
  maxRecentErrors?: number;
}>;

export class ConfigurationVersionService implements ConfigurationVersionRuntimeService {
  public readonly managedService: RuntimeManagedService;

  private state: ConfigurationVersionDiagnostics["state"] = "CREATED";
  private reconstructionCount = 0;
  private reconstructionFailures = 0;
  private concurrencyConflicts = 0;
  private noOpRejections = 0;
  private diffRequests = 0;
  private candidateFromHistoryCount = 0;
  private readonly recentErrors: string[] = [];

  public constructor(private readonly input: ConfigurationVersionServiceInput) {
    this.managedService = this.createManagedService();
  }

  public createVersion(
    input: CreateConfigurationVersionInput,
  ): ConfigurationResult<ConfigurationVersion> {
    const validation = this.validateSnapshotForVersion(input.snapshot);
    if (!validation.ok) {
      return validation;
    }
    const appended = this.input.repository.append({
      ...input,
      schemaFingerprint: this.input.schemaRegistry.fingerprint(),
      validationReport: validation.value,
    });
    if (!appended.ok) {
      this.recordRepositoryFailure(appended.error.message);
      if (appended.error.code === "CONFIGURATION_VERSION_CONCURRENCY_CONFLICT") {
        this.concurrencyConflicts += 1;
      }
      if (appended.error.code === "CONFIGURATION_VERSION_NO_SEMANTIC_CHANGE") {
        this.noOpRejections += 1;
      }
      return appended;
    }
    this.state = "READY";
    return appended;
  }

  public createCandidateFromVersion(
    versionId: ConfigurationVersionId,
    input: Omit<CreateConfigurationVersionInput, "snapshot" | "derivedFromVersionId">,
  ): ConfigurationResult<ConfigurationVersion> {
    const reconstruction = this.reconstruct(versionId);
    if (!reconstruction.ok) {
      return reconstruction;
    }
    const created = this.createVersion({
      ...input,
      snapshot: reconstruction.value.snapshot,
      derivedFromVersionId: versionId,
      ...(input.allowNoSemanticChange === undefined
        ? {}
        : { allowNoSemanticChange: input.allowNoSemanticChange }),
    });
    if (created.ok) {
      this.candidateFromHistoryCount += 1;
    }
    return created;
  }

  public reconstruct(versionId: ConfigurationVersionId) {
    const reconstruction = this.input.repository.reconstruct(versionId);
    this.reconstructionCount += 1;
    if (!reconstruction.ok) {
      this.reconstructionFailures += 1;
      this.recordRepositoryFailure(reconstruction.error.message);
    }
    return reconstruction;
  }

  public diff(
    fromVersionId: ConfigurationVersionId,
    toVersionId: ConfigurationVersionId,
    limit?: number,
  ) {
    this.diffRequests += 1;
    return this.input.repository.diff(fromVersionId, toVersionId, limit);
  }

  public revalidateHistoricalVersion(versionId: ConfigurationVersionId) {
    const reconstruction = this.reconstruct(versionId);
    if (!reconstruction.ok) {
      return reconstruction;
    }
    return this.validateSnapshotForVersion(reconstruction.value.snapshot);
  }

  public diagnostics(): ConfigurationVersionDiagnostics {
    const streamId = this.input.streamId ?? configurationVersionStreamId(this.input.runtimeMode);
    const current = this.input.repository.getCurrent(streamId);
    const integrity = current.ok
      ? this.input.repository.verifyIntegrity(current.value.versionId)
      : undefined;
    const list = this.input.repository.list({ streamId, limit: 1_000 });
    return {
      state: this.state,
      runtimeMode: this.input.runtimeMode,
      streamId,
      ...(current.ok ? { currentVersionId: current.value.versionId } : {}),
      ...(current.ok ? { rootVersionId: current.value.rootVersionId } : {}),
      versionCount: list.length,
      latestSequence: current.ok ? current.value.sequence : 0,
      ...(current.ok ? { lastVersionCreatedAt: current.value.createdAt } : {}),
      ...(current.ok ? { lastActorType: current.value.actor.actorType } : {}),
      reconstructionCount: this.reconstructionCount,
      reconstructionFailures: this.reconstructionFailures,
      concurrencyConflicts: this.concurrencyConflicts,
      noOpRejections: this.noOpRejections,
      diffRequests: this.diffRequests,
      candidateFromHistoryCount: this.candidateFromHistoryCount,
      integrityOk: integrity?.ok === true && integrity.value.ok,
      recentErrors: [...this.recentErrors],
    };
  }

  public checkHealth(): HealthReport {
    const diagnostics = this.diagnostics();
    return {
      status:
        diagnostics.state === "FAILED" || !diagnostics.integrityOk
          ? "UNHEALTHY"
          : diagnostics.reconstructionFailures > 0 || diagnostics.recentErrors.length > 0
            ? "DEGRADED"
            : "HEALTHY",
      timestamp: this.input.clock.now(),
      serviceId: configurationVersionServiceId,
      details: diagnostics,
    };
  }

  public checkReadiness(): ReadinessReport {
    const diagnostics = this.diagnostics();
    const ready =
      diagnostics.state === "READY" &&
      diagnostics.currentVersionId !== undefined &&
      diagnostics.integrityOk;
    return {
      status: ready ? "READY" : "NOT_READY",
      timestamp: this.input.clock.now(),
      serviceId: configurationVersionServiceId,
      ...(ready ? {} : { reason: "configuration version history is not ready" }),
      details: diagnostics,
    };
  }

  public stop(): void {
    this.state = "STOPPED";
  }

  private validateSnapshotForVersion(
    snapshot: ConfigurationSnapshot,
  ): ConfigurationResult<ConfigurationValidationReport> {
    const snapshotReport = validateConfigurationSnapshot({
      schemaRegistry: this.input.schemaRegistry,
      snapshot,
      clock: this.input.clock,
    });
    const effective = new ConfigurationResolver(
      this.input.registry,
      snapshot,
      this.input.clock,
    ).resolve({ runtimeMode: this.input.runtimeMode });
    if (!effective.ok) {
      return effective;
    }
    const effectiveReport = validateEffectiveConfiguration({
      schemaRegistry: this.input.schemaRegistry,
      effective: effective.value,
      clock: this.input.clock,
    });
    const report = combineValidationReports({
      clock: this.input.clock,
      schemaFingerprint: this.input.schemaRegistry.fingerprint(),
      reports: [snapshotReport, effectiveReport],
      snapshotId: snapshot.snapshotId,
      context: effective.value.context,
    });
    if (!report.publicationAllowed) {
      return fail(
        configurationError({
          code: "CONFIGURATION_VALIDATION_FAILED",
          message: "configuration version candidate failed schema validation",
          timestamp: this.input.clock.now(),
          severity: "CRITICAL",
          details: { reportId: report.reportId, summary: report.summary },
        }),
      );
    }
    return ok(report);
  }

  private createManagedService(): RuntimeManagedService {
    return {
      descriptor: serviceDescriptor({
        serviceId: configurationVersionServiceId,
        name: "ATE Configuration Version History",
        version: "0.9.0-config-versioning.1",
        description:
          "Immutable configuration version-history authority with lineage, change sets, diffs, reconstruction and integrity diagnostics.",
        criticality: "CRITICAL",
        dependencies: [clockRuntimeServiceId],
        supportedModes: runtimeModes,
        capabilities: ["CONFIGURATION_VERSION_HISTORY", "CONFIGURATION_RECONSTRUCTION"],
        degradationPolicy: "FAIL_RUNTIME",
        healthCapability: true,
        readinessCapability: true,
        recoverable: true,
      }),
      initialize: () => {
        this.state = this.diagnostics().currentVersionId === undefined ? "DEGRADED" : "READY";
      },
      stop: () => {
        this.stop();
      },
      checkHealth: () => this.checkHealth(),
      checkReadiness: () => this.checkReadiness(),
    };
  }

  private recordRepositoryFailure(message: string): void {
    this.recentErrors.unshift(message);
    this.recentErrors.splice(this.input.maxRecentErrors ?? 20);
  }
}

export const createConfigurationVersionService = (
  input: ConfigurationVersionServiceInput,
): ConfigurationVersionService => new ConfigurationVersionService(input);
