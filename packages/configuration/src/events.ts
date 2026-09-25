import type { EventTypeRegistration } from "@ate/events";
import { z } from "zod";

export const configurationSnapshotPublishedEvent = {
  eventType: "configuration.snapshot.published.v1",
  category: "OPERATIONAL",
  version: 1,
  schema: z
    .object({
      snapshotId: z.string(),
      fingerprint: z.string(),
      keyCount: z.number().int().nonnegative(),
      sourceCount: z.number().int().nonnegative(),
      runtimeMode: z.string(),
    })
    .strict(),
  description: "A coherent effective configuration snapshot was published.",
  owner: "@ate/configuration",
} satisfies EventTypeRegistration;

export const configurationResolutionFailedEvent = {
  eventType: "configuration.resolution.failed.v1",
  category: "OPERATIONAL",
  version: 1,
  schema: z
    .object({
      snapshotId: z.string().optional(),
      key: z.string().optional(),
      runtimeMode: z.string(),
      errorCode: z.string(),
      safeMessage: z.string(),
    })
    .strict(),
  description: "A configuration resolution failed without exposing configuration values.",
  owner: "@ate/configuration",
} satisfies EventTypeRegistration;

export const configurationSourceDegradedEvent = {
  eventType: "configuration.source.degraded.v1",
  category: "OPERATIONAL",
  version: 1,
  schema: z
    .object({
      sourceId: z.string(),
      health: z.string(),
      runtimeMode: z.string(),
      safeMessage: z.string().optional(),
    })
    .strict(),
  description: "A configuration source became degraded, stale, or unavailable.",
  owner: "@ate/configuration",
} satisfies EventTypeRegistration;

export const configurationEventRegistrations: readonly EventTypeRegistration[] = [
  configurationSnapshotPublishedEvent,
  configurationResolutionFailedEvent,
  configurationSourceDegradedEvent,
];
