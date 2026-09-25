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

export const configurationCapabilitySnapshotPublishedEvent = {
  eventType: "configuration.capability.snapshot-published.v1",
  category: "OPERATIONAL",
  version: 1,
  schema: z
    .object({
      snapshotId: z.string(),
      fingerprint: z.string(),
      configurationSnapshotId: z.string(),
      configurationVersionId: z.string().optional(),
      runtimeMode: z.string(),
      capabilityCount: z.number().int().nonnegative(),
      enabledCount: z.number().int().nonnegative(),
      blockedCount: z.number().int().nonnegative(),
      unavailableCount: z.number().int().nonnegative(),
    })
    .strict(),
  description: "A safe effective capability snapshot was published.",
  owner: "@ate/configuration",
} satisfies EventTypeRegistration;

export const configurationCapabilityBlockedEvent = {
  eventType: "configuration.capability.blocked.v1",
  category: "OPERATIONAL",
  version: 1,
  schema: z
    .object({
      capabilityId: z.string(),
      runtimeMode: z.string(),
      reasonCodes: z.array(z.string()).min(1),
      configurationSnapshotId: z.string(),
      configurationVersionId: z.string().optional(),
      safeMessage: z.string(),
    })
    .strict(),
  description:
    "A capability was blocked, unavailable, or degraded without exposing configuration values.",
  owner: "@ate/configuration",
} satisfies EventTypeRegistration;

export const configurationApprovalRequestedEvent = {
  eventType: "configuration.approval.requested.v1",
  category: "AUDIT",
  version: 1,
  schema: z
    .object({
      requestId: z.string(),
      versionId: z.string(),
      streamId: z.string(),
      runtimeMode: z.string(),
      classification: z.string(),
      policyId: z.string(),
      policyFingerprint: z.string(),
      makerActorId: z.string().optional(),
      requiredAuthority: z.string(),
      requiredApprovalCount: z.number().int().nonnegative(),
      correlationId: z.string().optional(),
      causationId: z.string().optional(),
    })
    .strict(),
  description: "A configuration approval request was created for an exact immutable version.",
  owner: "@ate/configuration",
} satisfies EventTypeRegistration;

export const configurationApprovedEvent = {
  eventType: "configuration.approval.approved.v1",
  category: "AUDIT",
  version: 1,
  schema: z
    .object({
      requestId: z.string(),
      decisionId: z.string(),
      versionId: z.string(),
      checkerActorId: z.string(),
      policyId: z.string(),
      policyFingerprint: z.string(),
      expiresAt: z.string().optional(),
      correlationId: z.string().optional(),
      causationId: z.string().optional(),
    })
    .strict(),
  description: "An authorized independent checker approved a configuration approval request.",
  owner: "@ate/configuration",
} satisfies EventTypeRegistration;

export const configurationRejectedEvent = {
  eventType: "configuration.approval.rejected.v1",
  category: "AUDIT",
  version: 1,
  schema: z
    .object({
      requestId: z.string(),
      decisionId: z.string(),
      versionId: z.string(),
      checkerActorId: z.string(),
      policyId: z.string(),
      policyFingerprint: z.string(),
      safeReason: z.string(),
      correlationId: z.string().optional(),
      causationId: z.string().optional(),
    })
    .strict(),
  description: "An authorized independent checker rejected a configuration approval request.",
  owner: "@ate/configuration",
} satisfies EventTypeRegistration;

export const configurationApprovalRevokedEvent = {
  eventType: "configuration.approval.revoked.v1",
  category: "AUDIT",
  version: 1,
  schema: z
    .object({
      requestId: z.string(),
      decisionId: z.string(),
      revocationId: z.string(),
      versionId: z.string(),
      revokedByActorId: z.string(),
      policyId: z.string(),
      safeReason: z.string(),
      correlationId: z.string().optional(),
      causationId: z.string().optional(),
    })
    .strict(),
  description: "A configuration approval was revoked by an authorized governance actor.",
  owner: "@ate/configuration",
} satisfies EventTypeRegistration;

export const configurationApprovalInvalidatedEvent = {
  eventType: "configuration.approval.invalidated.v1",
  category: "OPERATIONAL",
  version: 1,
  schema: z
    .object({
      versionId: z.string(),
      requestId: z.string().optional(),
      runtimeMode: z.string(),
      reasonCodes: z.array(z.string()).min(1),
      policyId: z.string(),
      safeMessage: z.string(),
    })
    .strict(),
  description: "Previously recorded approval evidence no longer satisfies current eligibility.",
  owner: "@ate/configuration",
} satisfies EventTypeRegistration;

export const configurationPromotionRequestedEvent = {
  eventType: "configuration.promotion.requested.v1",
  category: "AUDIT",
  version: 1,
  schema: z
    .object({
      requestId: z.string(),
      sourceEnvironment: z.string(),
      sourceVersionId: z.string(),
      destinationEnvironment: z.string(),
      destinationBaselineVersionId: z.string().optional(),
      policyId: z.string(),
      policyFingerprint: z.string(),
      requestedByActorId: z.string().optional(),
      correlationId: z.string().optional(),
      causationId: z.string().optional(),
    })
    .strict(),
  description: "A configuration promotion request was recorded for an exact source version.",
  owner: "@ate/configuration",
} satisfies EventTypeRegistration;

export const configurationPromotionPlannedEvent = {
  eventType: "configuration.promotion.planned.v1",
  category: "AUDIT",
  version: 1,
  schema: z
    .object({
      requestId: z.string(),
      planId: z.string(),
      sourceVersionId: z.string(),
      destinationEnvironment: z.string(),
      resultingFingerprint: z.string(),
      status: z.string(),
      reasonCodes: z.array(z.string()).min(1),
    })
    .strict(),
  description: "A deterministic configuration promotion plan was recorded.",
  owner: "@ate/configuration",
} satisfies EventTypeRegistration;

export const configurationPromotionBlockedEvent = {
  eventType: "configuration.promotion.blocked.v1",
  category: "OPERATIONAL",
  version: 1,
  schema: z
    .object({
      requestId: z.string(),
      planId: z.string().optional(),
      destinationEnvironment: z.string(),
      reasonCodes: z.array(z.string()).min(1),
      safeMessage: z.string(),
    })
    .strict(),
  description: "A configuration promotion was blocked without exposing configuration values.",
  owner: "@ate/configuration",
} satisfies EventTypeRegistration;

export const configurationPromotedEvent = {
  eventType: "configuration.promotion.promoted.v1",
  category: "AUDIT",
  version: 1,
  schema: z
    .object({
      activationId: z.string(),
      requestId: z.string(),
      planId: z.string(),
      destinationEnvironment: z.string(),
      resultingVersionId: z.string(),
      resultingFingerprint: z.string(),
      restartPending: z.boolean(),
    })
    .strict(),
  description: "A configuration promotion activated a destination release atomically.",
  owner: "@ate/configuration",
} satisfies EventTypeRegistration;

export const configurationPromotionFailedEvent = {
  eventType: "configuration.promotion.failed.v1",
  category: "OPERATIONAL",
  version: 1,
  schema: z
    .object({
      requestId: z.string(),
      planId: z.string().optional(),
      destinationEnvironment: z.string(),
      reasonCodes: z.array(z.string()).min(1),
      safeMessage: z.string(),
    })
    .strict(),
  description: "A configuration promotion failed while preserving previous active state.",
  owner: "@ate/configuration",
} satisfies EventTypeRegistration;

export const configurationPromotionStaleEvent = {
  eventType: "configuration.promotion.stale.v1",
  category: "OPERATIONAL",
  version: 1,
  schema: z
    .object({
      requestId: z.string(),
      planId: z.string().optional(),
      destinationEnvironment: z.string(),
      expectedVersionId: z.string().optional(),
      actualVersionId: z.string().optional(),
    })
    .strict(),
  description: "A configuration promotion became stale due to destination drift.",
  owner: "@ate/configuration",
} satisfies EventTypeRegistration;

export const configurationRollbackRequestedEvent = {
  eventType: "configuration.rollback.requested.v1",
  category: "AUDIT",
  version: 1,
  schema: z
    .object({
      requestId: z.string(),
      environment: z.string(),
      currentVersionId: z.string(),
      targetVersionId: z.string(),
      policyId: z.string(),
      requestedByActorId: z.string().optional(),
    })
    .strict(),
  description: "A controlled configuration rollback request was recorded.",
  owner: "@ate/configuration",
} satisfies EventTypeRegistration;

export const configurationRollbackCompletedEvent = {
  eventType: "configuration.rollback.completed.v1",
  category: "AUDIT",
  version: 1,
  schema: z
    .object({
      requestId: z.string(),
      planId: z.string(),
      activationId: z.string(),
      environment: z.string(),
      targetVersionId: z.string(),
      resultingFingerprint: z.string(),
    })
    .strict(),
  description: "A controlled configuration rollback restored an exact known-good target.",
  owner: "@ate/configuration",
} satisfies EventTypeRegistration;

export const configurationRollbackFailedEvent = {
  eventType: "configuration.rollback.failed.v1",
  category: "OPERATIONAL",
  version: 1,
  schema: z
    .object({
      requestId: z.string(),
      planId: z.string().optional(),
      environment: z.string(),
      reasonCodes: z.array(z.string()).min(1),
      safeMessage: z.string(),
    })
    .strict(),
  description: "A controlled configuration rollback failed without corrupting active state.",
  owner: "@ate/configuration",
} satisfies EventTypeRegistration;

export const configurationKnownGoodRecordedEvent = {
  eventType: "configuration.known-good.recorded.v1",
  category: "AUDIT",
  version: 1,
  schema: z
    .object({
      knownGoodId: z.string(),
      environment: z.string(),
      versionId: z.string(),
      activationId: z.string(),
      configurationFingerprint: z.string(),
      policyId: z.string(),
    })
    .strict(),
  description: "A configuration version became known-good after release verification.",
  owner: "@ate/configuration",
} satisfies EventTypeRegistration;

export const configurationEventRegistrations: readonly EventTypeRegistration[] = [
  configurationSnapshotPublishedEvent,
  configurationResolutionFailedEvent,
  configurationSourceDegradedEvent,
  configurationVersionCreatedEvent,
  configurationVersionIntegrityFailedEvent,
  configurationCapabilitySnapshotPublishedEvent,
  configurationCapabilityBlockedEvent,
  configurationApprovalRequestedEvent,
  configurationApprovedEvent,
  configurationRejectedEvent,
  configurationApprovalRevokedEvent,
  configurationApprovalInvalidatedEvent,
  configurationPromotionRequestedEvent,
  configurationPromotionPlannedEvent,
  configurationPromotionBlockedEvent,
  configurationPromotedEvent,
  configurationPromotionFailedEvent,
  configurationPromotionStaleEvent,
  configurationRollbackRequestedEvent,
  configurationRollbackCompletedEvent,
  configurationRollbackFailedEvent,
  configurationKnownGoodRecordedEvent,
];
