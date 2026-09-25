import type { EventTypeRegistration } from "@ate/events";
import { z } from "zod";

export const dataQualityReportPublishedEvent = {
  eventType: "data-quality.report.published.v1",
  category: "AUDIT",
  version: 1,
  schema: z
    .object({
      reportId: z.string(),
      datasetId: z.string(),
      profileId: z.string(),
      profileFingerprint: z.string(),
      reportFingerprint: z.string(),
      qualityClass: z.string(),
      score: z.number().min(0).max(100),
      findingCount: z.number().int().nonnegative(),
      suppressedFindingCount: z.number().int().nonnegative(),
      qualification: z.string(),
      doesNotAuthorizeTrading: z.literal(true),
    })
    .strict(),
  description:
    "An immutable data-quality report was published with summary-only quality diagnostics.",
  owner: "@ate/data-quality",
} satisfies EventTypeRegistration;

export const dataQualityAnalysisFailedEvent = {
  eventType: "data-quality.analysis.failed.v1",
  category: "OPERATIONAL",
  version: 1,
  schema: z
    .object({
      datasetId: z.string().optional(),
      profileId: z.string().optional(),
      errorCode: z.string(),
      safeMessage: z.string(),
    })
    .strict(),
  description: "A data-quality analysis failed without exposing row-level findings.",
  owner: "@ate/data-quality",
} satisfies EventTypeRegistration;

export const dataQualityEventRegistrations: readonly EventTypeRegistration[] = [
  dataQualityReportPublishedEvent,
  dataQualityAnalysisFailedEvent,
];
