import type { MarketObservation } from "@ate/domain";
import type { HistoricalDatasetManifest } from "@ate/historical-data";

import { dataQualityError, fail, ok, toSafeMessage } from "./errors.js";
import { createDefaultDataQualityRules } from "./rules.js";
import { fingerprint } from "./serialization.js";
import type {
  DataQualityAnalysisRequest,
  DataQualityClass,
  DataQualityDatasetSnapshot,
  DataQualityEngineInput,
  DataQualityError,
  DataQualityFinding,
  DataQualityReport,
  DataQualityReportId,
  DataQualityResult,
  DataQualityRule,
  DataQualityRuleExecution,
  DataQualityScore,
  DataQualitySeverity,
  DataQualitySummary,
} from "./types.js";

export class DataQualityEngine {
  private readonly recentReports: DataQualityReportId[] = [];
  private readonly recentFailures: DataQualityError[] = [];

  public constructor(private readonly input: DataQualityEngineInput) {}

  public async analyzeDataset(
    request: DataQualityAnalysisRequest,
  ): Promise<DataQualityResult<DataQualityReport>> {
    if ((request.runtimeMode as string) === "LIVE") {
      return fail(
        dataQualityError({
          code: "DATA_QUALITY_PROFILE_INVALID",
          message: "data quality analysis is not available in LIVE runtime mode",
          timestamp: this.input.clock.now(),
        }),
      );
    }

    const validProfile = validateProfile(request);
    if (!validProfile.ok) {
      this.recordFailure(validProfile.error);
      return validProfile;
    }

    const snapshot = await this.loadDataset(request);
    if (!snapshot.ok) {
      this.recordFailure(snapshot.error);
      return snapshot;
    }

    const rules = this.input.rules ?? createDefaultDataQualityRules(request.profile.rules);
    const ruleExecutions: DataQualityRuleExecution[] = [];
    const findings: DataQualityFinding[] = [];

    for (const rule of rules) {
      const result = await this.executeRule(rule, request, snapshot.value);
      if (!result.ok) {
        this.recordFailure(result.error);
        ruleExecutions.push({
          ruleId: rule.definition.ruleId,
          status: "FAILED",
          findingCount: 0,
          suppressedFindingCount: 0,
          durationMs: 0,
          message: result.error.message,
        });
        continue;
      }
      findings.push(...result.value.findings);
      ruleExecutions.push({
        ruleId: rule.definition.ruleId,
        status: result.value.status,
        findingCount: result.value.findings.length,
        suppressedFindingCount: result.value.suppressedFindingCount,
        durationMs: 0,
        ...(result.value.message === undefined ? {} : { message: result.value.message }),
      });
    }

    const summary = summarize(snapshot.value.manifest, ruleExecutions, findings);
    const score = scoreReport(request, summary, ruleExecutions, findings);
    const generatedAt = this.input.clock.now();
    const reportFingerprint = reportIdentityFingerprint({
      request,
      manifest: snapshot.value.manifest,
      ruleExecutions,
      findings,
      score,
      summary,
    });
    const reportId =
      `dqr-${reportFingerprint.replace("sha256:", "").slice(0, 32)}` as DataQualityReportId;
    const report: DataQualityReport = {
      reportId,
      datasetId: request.datasetId,
      datasetContentFingerprint: snapshot.value.manifest.contentFingerprint,
      profileId: request.profile.profileId,
      profileVersion: request.profile.version,
      profileFingerprint: request.profile.fingerprint,
      generatedAt,
      ...(request.actor === undefined ? {} : { generatedBy: request.actor }),
      runtimeMode: request.runtimeMode,
      structuralValidity: "PASSED_BEFORE_QUALITY",
      importValidity:
        snapshot.value.manifest.completenessStatus === "COMPLETED_WITH_REJECTIONS"
          ? "IMPORTED_WITH_REJECTIONS"
          : "IMPORTED",
      dataQuality: score.qualityClass,
      score,
      summary,
      ruleExecutions,
      findings,
      reportFingerprint,
    };

    const staged = await this.input.reportRepository.stageReport(report);
    if (!staged.ok) {
      this.recordFailure(staged.error);
      return staged;
    }
    const published = await this.input.reportRepository.publishReport(report.reportId);
    if (!published.ok) {
      this.recordFailure(published.error);
      return published;
    }
    this.recentReports.unshift(report.reportId);
    this.recentReports.splice(10);
    return ok(published.value);
  }

  public recentReportIds(): readonly DataQualityReportId[] {
    return [...this.recentReports];
  }

  public recentReportFailures(): readonly DataQualityError[] {
    return [...this.recentFailures];
  }

  private async executeRule(
    rule: DataQualityRule,
    request: DataQualityAnalysisRequest,
    snapshot: DataQualityDatasetSnapshot,
  ) {
    try {
      return await rule.evaluate({
        request,
        manifest: snapshot.manifest,
        observations: snapshot.observations,
        observationLimitReached: snapshot.observationLimitReached,
        clock: this.input.clock,
      });
    } catch (error) {
      return fail(
        dataQualityError({
          code: "DATA_QUALITY_RULE_FAILED",
          message: toSafeMessage(error),
          timestamp: this.input.clock.now(),
          details: { ruleId: rule.definition.ruleId },
        }),
      );
    }
  }

  private async loadDataset(
    request: DataQualityAnalysisRequest,
  ): Promise<DataQualityResult<DataQualityDatasetSnapshot>> {
    const manifest = await this.input.historicalRepository.getManifest(request.datasetId);
    if (!manifest.ok) {
      return fail(
        dataQualityError({
          code: "DATA_QUALITY_DATASET_NOT_FOUND",
          message: "historical dataset manifest was not found for quality analysis",
          timestamp: this.input.clock.now(),
          details: { datasetId: request.datasetId, cause: manifest.error.code },
        }),
      );
    }

    const observations: MarketObservation[] = [];
    let cursor: string | undefined;
    while (observations.length < request.profile.maxObservations) {
      const limit = Math.min(5000, request.profile.maxObservations - observations.length);
      const page = await this.input.historicalRepository.query({
        datasetId: request.datasetId,
        limit,
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (!page.ok) {
        return fail(
          dataQualityError({
            code: "DATA_QUALITY_QUERY_FAILED",
            message: "historical dataset query failed during quality analysis",
            timestamp: this.input.clock.now(),
            details: { datasetId: request.datasetId, cause: page.error.code },
          }),
        );
      }
      observations.push(...page.value.observations);
      cursor = page.value.nextCursor;
      if (cursor === undefined) {
        break;
      }
    }

    return ok({
      manifest: manifest.value,
      observations,
      observationLimitReached: cursor !== undefined,
    });
  }

  private recordFailure(error: DataQualityError): void {
    this.recentFailures.unshift(error);
    this.recentFailures.splice(10);
  }
}

const validateProfile = (
  request: DataQualityAnalysisRequest,
): DataQualityResult<DataQualityAnalysisRequest> => {
  if (request.profile.rules.length === 0) {
    return fail(
      dataQualityError({
        code: "DATA_QUALITY_PROFILE_INVALID",
        message: "data quality profile must contain at least one rule",
        timestamp: request.asOf ?? (new Date(0).toISOString() as never),
      }),
    );
  }
  if (request.profile.minimumScore < 0 || request.profile.minimumScore > 100) {
    return fail(
      dataQualityError({
        code: "DATA_QUALITY_PROFILE_INVALID",
        message: "data quality profile minimumScore must be between 0 and 100",
        timestamp: request.asOf ?? (new Date(0).toISOString() as never),
      }),
    );
  }
  if (request.profile.maxObservations <= 0) {
    return fail(
      dataQualityError({
        code: "DATA_QUALITY_PROFILE_INVALID",
        message: "data quality profile maxObservations must be positive",
        timestamp: request.asOf ?? (new Date(0).toISOString() as never),
      }),
    );
  }
  return ok(request);
};

const summarize = (
  manifest: HistoricalDatasetManifest,
  executions: readonly DataQualityRuleExecution[],
  findings: readonly DataQualityFinding[],
): DataQualitySummary => ({
  observationCount: manifest.observationCount,
  partitionCount: manifest.partitions.length,
  findingCount: findings.length,
  suppressedFindingCount: executions.reduce(
    (total, execution) => total + execution.suppressedFindingCount,
    0,
  ),
  severityCounts: {
    INFO: findings.filter((finding) => finding.severity === "INFO").length,
    WARNING: findings.filter((finding) => finding.severity === "WARNING").length,
    ERROR: findings.filter((finding) => finding.severity === "ERROR").length,
    CRITICAL: findings.filter((finding) => finding.severity === "CRITICAL").length,
  },
  statusCounts: {
    PASS: executions.filter((execution) => execution.status === "PASS").length,
    FINDINGS: executions.filter((execution) => execution.status === "FINDINGS").length,
    NOT_APPLICABLE: executions.filter((execution) => execution.status === "NOT_APPLICABLE").length,
    INSUFFICIENT_EVIDENCE: executions.filter(
      (execution) => execution.status === "INSUFFICIENT_EVIDENCE",
    ).length,
    FAILED: executions.filter((execution) => execution.status === "FAILED").length,
  },
});

const scoreReport = (
  request: DataQualityAnalysisRequest,
  summary: DataQualitySummary,
  executions: readonly DataQualityRuleExecution[],
  findings: readonly DataQualityFinding[],
): DataQualityScore => {
  const findingPenalty = findings.reduce(
    (total, finding) => total + severityPenalty(finding.severity),
    0,
  );
  const coveragePenalty =
    summary.statusCounts.INSUFFICIENT_EVIDENCE * 5 +
    summary.statusCounts.FAILED * 20 +
    (summary.suppressedFindingCount > 0 ? 5 : 0);
  const value = Math.max(0, Math.min(100, 100 - findingPenalty - coveragePenalty));
  const qualityClass = classify(value, executions);
  const hasFailingSeverity = findings.some((finding) =>
    request.profile.failOnSeverities.includes(finding.severity),
  );
  const qualification =
    summary.statusCounts.INSUFFICIENT_EVIDENCE > 0
      ? "INSUFFICIENT_EVIDENCE"
      : value < request.profile.minimumScore ||
          hasFailingSeverity ||
          summary.statusCounts.FAILED > 0
        ? "NOT_QUALIFIED"
        : summary.findingCount > 0
          ? "QUALIFIED_WITH_WARNINGS"
          : "QUALIFIED";
  return {
    value,
    max: 100,
    qualityClass,
    findingPenalty,
    coveragePenalty,
    qualification,
    intendedUses: request.profile.intendedUses,
    fitnessForPurpose: "ASSESSMENT_REQUIRED",
    doesNotAuthorizeTrading: true,
  };
};

const severityPenalty = (severity: DataQualitySeverity): number => {
  switch (severity) {
    case "INFO":
      return 1;
    case "WARNING":
      return 5;
    case "ERROR":
      return 15;
    case "CRITICAL":
      return 30;
  }
};

const classify = (
  value: number,
  executions: readonly DataQualityRuleExecution[],
): DataQualityClass => {
  if (executions.some((execution) => execution.status === "INSUFFICIENT_EVIDENCE")) {
    return "INSUFFICIENT_EVIDENCE";
  }
  if (value >= 95) return "EXCELLENT";
  if (value >= 85) return "GOOD";
  if (value >= 70) return "WATCHLIST";
  if (value >= 50) return "POOR";
  return "UNUSABLE";
};

const reportIdentityFingerprint = (input: {
  request: DataQualityAnalysisRequest;
  manifest: HistoricalDatasetManifest;
  ruleExecutions: readonly DataQualityRuleExecution[];
  findings: readonly DataQualityFinding[];
  score: DataQualityScore;
  summary: DataQualitySummary;
}) =>
  fingerprint({
    datasetId: input.request.datasetId,
    datasetContentFingerprint: input.manifest.contentFingerprint,
    profileId: input.request.profile.profileId,
    profileVersion: input.request.profile.version,
    profileFingerprint: input.request.profile.fingerprint,
    runtimeMode: input.request.runtimeMode,
    asOf: input.request.asOf,
    ruleExecutions: input.ruleExecutions.map((execution) => ({
      ruleId: execution.ruleId,
      status: execution.status,
      findingCount: execution.findingCount,
      suppressedFindingCount: execution.suppressedFindingCount,
      message: execution.message,
    })),
    findings: input.findings,
    score: input.score,
    summary: input.summary,
  });
