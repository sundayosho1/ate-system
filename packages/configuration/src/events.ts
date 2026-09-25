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

export const configurationVersionCreatedEvent = {
  eventType: "configuration.version.created.v1",
  category: "AUDIT",
  version: 1,
  schema: z
    .object({
      versionId: z.string(),
      parentVersionId: z.string().optional(),
      derivedFromVersionId: z.string().optional(),
      streamId: z.string(),
      sequence: z.number().int().positive(),
      configurationFingerprint: z.string(),
      schemaFingerprint: z.string(),
      changeCount: z.number().int().nonnegative(),
      runtimeMode: z.string(),
      actorType: z.string(),
      correlationId: z.string().optional(),
      causationId: z.string().optional(),
    })
    .strict(),
  description:
    "An immutable configuration version was created without exposing configuration values.",
  owner: "@ate/configuration",
} satisfies EventTypeRegistration;

export const configurationVersionIntegrityFailedEvent = {
  eventType: "configuration.version.integrity-failed.v1",
  category: "OPERATIONAL",
  version: 1,
  schema: z
    .object({
      versionId: z.string(),
      streamId: z.string(),
      runtimeMode: z.string(),
      issueCount: z.number().int().positive(),
      safeMessage: z.string(),
    })
    .strict(),
  description: "Configuration version-history integrity verification failed.",
  owner: "@ate/configuration",
} satisfies EventTypeRegistration;

export const configurationEventRegistrations: readonly EventTypeRegistration[] = [
  configurationSnapshotPublishedEvent,
  configurationResolutionFailedEvent,
  configurationSourceDegradedEvent,
  configurationVersionCreatedEvent,
  configurationVersionIntegrityFailedEvent,
];
