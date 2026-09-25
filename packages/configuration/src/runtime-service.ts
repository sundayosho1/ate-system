import { runtimeModes, type RuntimeMode } from "@ate/domain";
import {
  serviceDescriptor,
  type HealthReport,
  type ReadinessReport,
  type RuntimeManagedService,
  type ServiceId,
} from "@ate/runtime";
import { clockRuntimeServiceId, type Clock } from "@ate/time";

import { ConfigurationResolutionCache } from "./cache.js";
import { scopeCounts } from "./diagnostics.js";
import { configurationError, fail, ok } from "./errors.js";
import type { ConfigurationRegistry } from "./registry.js";
import { ConfigurationResolver } from "./resolver.js";
import type { ConfigurationSchemaRegistry } from "./schema-registry.js";
import { buildConfigurationSnapshot } from "./snapshot.js";
import { combineValidationReports } from "./validation-report.js";
import { validateConfigurationSnapshot, validateEffectiveConfiguration } from "./validation.js";
import type {
  ConfigurationContext,
  ConfigurationDiagnostics,
  ConfigurationError,
  ConfigurationResult,
  ConfigurationSnapshot,
  ConfigurationSource,
  ConfigurationValidationReport,
  EffectiveConfiguration,
} from "./types.js";

export const configurationServiceId = "configuration" as ServiceId;

export type ConfigurationRuntimeServiceInput = Readonly<{
  runtimeMode: RuntimeMode;
  clock: Clock;
  registry: ConfigurationRegistry;
  schemaRegistry?: ConfigurationSchemaRegistry;
  sources: readonly ConfigurationSource[];
  cacheMaxEntries?: number;
  snapshotMaxEntries?: number;
}>;

export class ConfigurationRuntimeService {
  public readonly managedService: RuntimeManagedService;
  public readonly cache: ConfigurationResolutionCache;

  private state: ConfigurationDiagnostics["state"] = "CREATED";
  private activeSnapshot: ConfigurationSnapshot | undefined;
  private resolutionCount = 0;
  private resolutionFailures = 0;
  private lastSuccessfulLoad: ConfigurationDiagnostics["lastSuccessfulLoad"];
  private lastSourceFailure: ConfigurationDiagnostics["lastSourceFailure"];
  private lastValidationReport: ConfigurationValidationReport | undefined;
  private readonly recentErrors: ConfigurationError[] = [];

  public constructor(private readonly input: ConfigurationRuntimeServiceInput) {
    this.cache = new ConfigurationResolutionCache(input.cacheMaxEntries ?? 100);
    this.managedService = this.createManagedService();
  }

  public async initialize(): Promise<ConfigurationResult<ConfigurationSnapshot>> {
    this.state = "INITIALIZING";
    const refreshed = await this.refresh(this.input.sources);
    this.state = refreshed.ok ? "READY" : "FAILED";
    return refreshed;
  }

  public async refresh(
    sources: readonly ConfigurationSource[] = this.input.sources,
  ): Promise<ConfigurationResult<ConfigurationSnapshot>> {
    const candidate = await buildConfigurationSnapshot({
      registry: this.input.registry,
      sources,
      clock: this.input.clock,
      ...(this.input.snapshotMaxEntries === undefined
        ? {}
        : { maxEntries: this.input.snapshotMaxEntries }),
    });
    if (!candidate.ok) {
      this.recordError(candidate.error);
      this.lastSourceFailure = this.input.clock.now();
      return candidate;
    }
    if (this.input.schemaRegistry !== undefined) {
      const snapshotReport = validateConfigurationSnapshot({
        schemaRegistry: this.input.schemaRegistry,
        snapshot: candidate.value,
        clock: this.input.clock,
      });
      const effective = new ConfigurationResolver(
        this.input.registry,
        candidate.value,
        this.input.clock,
      ).resolve({ runtimeMode: this.input.runtimeMode });
      if (!effective.ok) {
        this.recordError(effective.error);
        this.lastSourceFailure = this.input.clock.now();
        return effective;
      }
      const effectiveReport = validateEffectiveConfiguration({
        schemaRegistry: this.input.schemaRegistry,
        effective: effective.value,
        clock: this.input.clock,
      });
      const publicationReport = combineValidationReports({
        clock: this.input.clock,
        schemaFingerprint: this.input.schemaRegistry.fingerprint(),
        reports: [snapshotReport, effectiveReport],
        snapshotId: candidate.value.snapshotId,
        context: effective.value.context,
      });
      this.lastValidationReport = publicationReport;
      if (!publicationReport.publicationAllowed) {
        const error = this.validationError(
          "candidate configuration failed schema validation",
          publicationReport,
        );
        this.recordError(error);
        this.lastSourceFailure = this.input.clock.now();
        return fail(error);
      }
    } else if (candidate.value.conflicts.length > 0) {
      const error = configurationError({
        code: "CONFIGURATION_SNAPSHOT_INVALID",
        message: "candidate configuration snapshot contains blocking conflicts",
        timestamp: this.input.clock.now(),
        severity: "CRITICAL",
        details: { conflicts: candidate.value.conflicts.map((conflict) => conflict.message) },
      });
      this.recordError(error);
      this.lastSourceFailure = this.input.clock.now();
      return fail(error);
    }
    this.activeSnapshot = candidate.value;
    this.cache.invalidate();
    this.lastSuccessfulLoad = this.input.clock.now();
    this.state = "READY";
    return ok(candidate.value);
  }

  public resolve(context: ConfigurationContext): ConfigurationResult<EffectiveConfiguration> {
    if (this.activeSnapshot === undefined) {
      const error = configurationError({
        code: "CONFIGURATION_SNAPSHOT_INVALID",
        message: "configuration service has no active snapshot",
        timestamp: this.input.clock.now(),
        severity: "CRITICAL",
      });
      this.recordError(error);
      return fail(error);
    }
    const cached = this.cache.get(this.activeSnapshot.snapshotId, context);
    if (cached !== undefined) {
      return ok(cached);
    }
    const resolver = new ConfigurationResolver(
      this.input.registry,
      this.activeSnapshot,
      this.input.clock,
    );
    const resolved = resolver.resolve(context);
    this.resolutionCount += 1;
    if (!resolved.ok || resolved.value.conflicts.length > 0) {
      this.resolutionFailures += 1;
    }
    if (resolved.ok) {
      if (this.input.schemaRegistry !== undefined) {
        const report = validateEffectiveConfiguration({
          schemaRegistry: this.input.schemaRegistry,
          effective: resolved.value,
          clock: this.input.clock,
        });
        this.lastValidationReport = report;
        if (!report.publicationAllowed) {
          this.resolutionFailures += 1;
          const error = this.validationError(
            "effective configuration failed schema validation",
            report,
          );
          this.recordError(error);
          return fail(error);
        }
      }
      this.cache.set(resolved.value);
    } else {
      this.recordError(resolved.error);
    }
    return resolved;
  }

  public explain(
    key: Parameters<ConfigurationResolver["explain"]>[0],
    context: ConfigurationContext,
  ) {
    if (this.activeSnapshot === undefined) {
      return fail(
        configurationError({
          code: "CONFIGURATION_SNAPSHOT_INVALID",
          message: "configuration service has no active snapshot",
          timestamp: this.input.clock.now(),
          severity: "CRITICAL",
          key,
        }),
      );
    }
    return new ConfigurationResolver(
      this.input.registry,
      this.activeSnapshot,
      this.input.clock,
    ).explain(key, context);
  }

  public stop(): void {
    this.state = "STOPPED";
    this.cache.invalidate();
  }

  public diagnostics(): ConfigurationDiagnostics {
    const environmentResolution =
      this.activeSnapshot === undefined
        ? undefined
        : new ConfigurationResolver(
            this.input.registry,
            this.activeSnapshot,
            this.input.clock,
          ).resolve({ runtimeMode: this.input.runtimeMode });
    const missingRequiredValues =
      environmentResolution?.ok === true
        ? environmentResolution.value.diagnostics.missingRequiredKeys
        : [];
    return {
      state: this.state,
      runtimeMode: this.input.runtimeMode,
      ...(this.activeSnapshot === undefined
        ? {}
        : { activeSnapshotId: this.activeSnapshot.snapshotId }),
      ...(this.activeSnapshot === undefined
        ? {}
        : { activeFingerprint: this.activeSnapshot.fingerprint }),
      registeredKeyCount: this.input.registry.keys().length,
      sourceCount: this.input.sources.length,
      sourceHealth: this.activeSnapshot?.sourceHealth ?? {},
      scopeCounts: scopeCounts(this.activeSnapshot),
      resolutionCount: this.resolutionCount,
      resolutionFailures: this.resolutionFailures,
      conflictCount: this.activeSnapshot?.conflicts.length ?? 0,
      missingRequiredValues,
      cache: this.cache.snapshot(),
      ...(this.lastSuccessfulLoad === undefined
        ? {}
        : { lastSuccessfulLoad: this.lastSuccessfulLoad }),
      ...(this.lastSourceFailure === undefined
        ? {}
        : { lastSourceFailure: this.lastSourceFailure }),
      recentErrors: [...this.recentErrors],
      ...(this.input.schemaRegistry === undefined
        ? {}
        : {
            schema: {
              registeredSchemaCount: this.input.schemaRegistry.keys().length,
              schemaFingerprint: this.input.schemaRegistry.fingerprint(),
              ...(this.lastValidationReport === undefined
                ? {}
                : { lastReportFingerprint: this.lastValidationReport.fingerprint }),
              ...(this.lastValidationReport === undefined
                ? {}
                : { lastReportSummary: this.lastValidationReport.summary }),
              blockingIssueCount: this.lastValidationReport?.summary.blockingIssueCount ?? 0,
            },
          }),
    };
  }

  public checkHealth(timestamp = this.input.clock.now()): HealthReport {
    const diagnostics = this.diagnostics();
    return {
      status:
        diagnostics.state === "FAILED"
          ? "UNHEALTHY"
          : diagnostics.conflictCount > 0 || diagnostics.resolutionFailures > 0
            ? "DEGRADED"
            : "HEALTHY",
      timestamp,
      serviceId: configurationServiceId,
      details: diagnostics,
    };
  }

  public checkReadiness(timestamp = this.input.clock.now()): ReadinessReport {
    const diagnostics = this.diagnostics();
    const ready =
      diagnostics.state === "READY" &&
      diagnostics.activeSnapshotId !== undefined &&
      diagnostics.conflictCount === 0 &&
      (diagnostics.schema?.blockingIssueCount ?? 0) === 0 &&
      diagnostics.missingRequiredValues.length === 0;
    return {
      status: ready ? "READY" : "NOT_READY",
      timestamp,
      serviceId: configurationServiceId,
      ...(ready ? {} : { reason: "configuration snapshot is not ready" }),
      details: diagnostics,
    };
  }

  private createManagedService(): RuntimeManagedService {
    return {
      descriptor: serviceDescriptor({
        serviceId: configurationServiceId,
        name: "ATE Configuration Authority",
        version: "0.8.0-config-schema.1",
        description:
          "Hierarchical configuration control-plane foundation with schema validation, scoped resolution, provenance, snapshots and diagnostics.",
        criticality: "CRITICAL",
        dependencies: [clockRuntimeServiceId],
        supportedModes: runtimeModes,
        capabilities: [
          "CONFIGURATION_AUTHORITY",
          "CONFIGURATION_RESOLUTION",
          "CONFIGURATION_SCHEMA_VALIDATION",
        ],
        degradationPolicy: "FAIL_RUNTIME",
        healthCapability: true,
        readinessCapability: true,
        recoverable: true,
      }),
      initialize: async () => {
        const result = await this.initialize();
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

  private recordError(error: ConfigurationError): void {
    this.recentErrors.unshift(error);
    this.recentErrors.splice(20);
  }

  private validationError(
    message: string,
    report: ConfigurationValidationReport,
  ): ConfigurationError {
    return configurationError({
      code: "CONFIGURATION_VALIDATION_FAILED",
      message,
      timestamp: this.input.clock.now(),
      severity: "CRITICAL",
      details: {
        reportId: report.reportId,
        reportFingerprint: report.fingerprint,
        summary: report.summary,
        issues: report.issues.map((issue) => ({
          phase: issue.phase,
          severity: issue.severity,
          message: issue.message,
          key: issue.key,
          scope: issue.scope,
          path: issue.path,
          expected: issue.expected,
          receivedType: issue.receivedType,
          constraint: issue.constraint,
          dependencyKey: issue.dependencyKey,
        })),
      },
    });
  }
}

export const createConfigurationRuntimeService = (
  input: ConfigurationRuntimeServiceInput,
): ConfigurationRuntimeService => new ConfigurationRuntimeService(input);
