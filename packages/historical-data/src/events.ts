import type { EventTypeRegistration } from "@ate/events";
import { z } from "zod";

export const historicalImportStartedEvent = {
  eventType: "historical.import.started.v1",
  category: "OPERATIONAL",
  version: 1,
  schema: z
    .object({
      sessionId: z.string(),
      artifactId: z.string(),
      planId: z.string(),
      artifactChecksum: z.string(),
      format: z.string(),
    })
    .strict(),
  description: "A historical data import session started without exposing source rows.",
  owner: "@ate/historical-data",
} satisfies EventTypeRegistration;

export const historicalImportCompletedEvent = {
  eventType: "historical.import.completed.v1",
  category: "OPERATIONAL",
  version: 1,
  schema: z
    .object({
      sessionId: z.string(),
      datasetId: z.string(),
      acceptedRecords: z.number().int().nonnegative(),
      rejectedRecords: z.number().int().nonnegative(),
      duplicateCandidates: z.number().int().nonnegative(),
      contentFingerprint: z.string(),
    })
    .strict(),
  description: "A historical data import completed and produced a published dataset.",
  owner: "@ate/historical-data",
} satisfies EventTypeRegistration;

export const historicalImportFailedEvent = {
  eventType: "historical.import.failed.v1",
  category: "OPERATIONAL",
  version: 1,
  schema: z
    .object({
      sessionId: z.string().optional(),
      artifactId: z.string().optional(),
      planId: z.string().optional(),
      errorCode: z.string(),
      safeMessage: z.string(),
    })
    .strict(),
  description: "A historical data import failed without exposing source rows.",
  owner: "@ate/historical-data",
} satisfies EventTypeRegistration;

export const historicalDatasetPublishedEvent = {
  eventType: "historical.dataset.published.v1",
  category: "AUDIT",
  version: 1,
  schema: z
    .object({
      datasetId: z.string(),
      artifactId: z.string(),
      planFingerprint: z.string(),
      contentFingerprint: z.string(),
      observationCount: z.number().int().nonnegative(),
      rejectionCount: z.number().int().nonnegative(),
      partitionCount: z.number().int().nonnegative(),
    })
    .strict(),
  description: "An immutable historical dataset became published for bounded research access.",
  owner: "@ate/historical-data",
} satisfies EventTypeRegistration;

export const historicalDataEventRegistrations = [
  historicalImportStartedEvent,
  historicalImportCompletedEvent,
  historicalImportFailedEvent,
  historicalDatasetPublishedEvent,
] as const;
