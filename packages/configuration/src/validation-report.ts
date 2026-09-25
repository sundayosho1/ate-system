import type { Clock } from "@ate/time";

import { freeze } from "./context.js";
import { fingerprint } from "./serialization.js";
import type {
  ConfigurationContext,
  ConfigurationFingerprint,
  ConfigurationSnapshotId,
  ConfigurationValidationIssue,
  ConfigurationValidationPhase,
  ConfigurationValidationReport,
  ConfigurationValidationSummary,
} from "./types.js";

export const validationPhases: readonly ConfigurationValidationPhase[] = [
  "SCHEMA",
  "SOURCE_ENTRY",
  "STRUCTURAL",
  "TYPE",
  "CONSTRAINT",
  "SCOPE_APPLICABILITY",
  "DEPENDENCY",
  "CONDITIONAL",
  "CROSS_FIELD",
  "EFFECTIVE_CONFIGURATION",
  "PUBLICATION_GATE",
];

export const summarizeValidationIssues = (
  issues: readonly ConfigurationValidationIssue[],
): ConfigurationValidationSummary => {
  const phaseCounts = Object.fromEntries(
    validationPhases.map((phase) => [
      phase,
      issues.filter((issue) => issue.phase === phase).length,
    ]),
  ) as Record<ConfigurationValidationPhase, number>;
  return freeze({
    issueCount: issues.length,
    blockingIssueCount: issues.filter(
      (issue) => issue.severity === "ERROR" || issue.severity === "CRITICAL",
    ).length,
    errorCount: issues.filter(
      (issue) => issue.severity === "ERROR" || issue.severity === "CRITICAL",
    ).length,
    warningCount: issues.filter((issue) => issue.severity === "WARNING").length,
    infoCount: issues.filter((issue) => issue.severity === "INFO").length,
    phaseCounts,
  });
};

export const createConfigurationValidationReport = (input: {
  clock: Clock;
  schemaFingerprint: ConfigurationFingerprint;
  issues: readonly ConfigurationValidationIssue[];
  snapshotId?: ConfigurationSnapshotId;
  context?: ConfigurationContext;
}): ConfigurationValidationReport => {
  const summary = summarizeValidationIssues(input.issues);
  const reportFingerprint = fingerprint({
    schemaFingerprint: input.schemaFingerprint,
    snapshotId: input.snapshotId,
    context: input.context,
    issues: input.issues,
    summary,
  });
  return freeze({
    reportId: `cfgval-${reportFingerprint.replace("sha256:", "").slice(0, 24)}`,
    fingerprint: reportFingerprint,
    generatedAt: input.clock.now(),
    schemaFingerprint: input.schemaFingerprint,
    ...(input.snapshotId === undefined ? {} : { snapshotId: input.snapshotId }),
    ...(input.context === undefined ? {} : { context: input.context }),
    issues: [...input.issues],
    summary,
    publicationAllowed: summary.blockingIssueCount === 0,
  });
};

export const combineValidationReports = (input: {
  clock: Clock;
  schemaFingerprint: ConfigurationFingerprint;
  reports: readonly ConfigurationValidationReport[];
  snapshotId?: ConfigurationSnapshotId;
  context?: ConfigurationContext;
}): ConfigurationValidationReport =>
  createConfigurationValidationReport({
    clock: input.clock,
    schemaFingerprint: input.schemaFingerprint,
    issues: input.reports.flatMap((report) => report.issues),
    ...(input.snapshotId === undefined ? {} : { snapshotId: input.snapshotId }),
    ...(input.context === undefined ? {} : { context: input.context }),
  });
