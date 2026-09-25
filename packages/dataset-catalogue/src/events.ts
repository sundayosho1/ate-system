import type { EventTypeRegistration } from "@ate/events";
import { z } from "zod";

export const datasetCatalogueRegisteredEvent = {
  eventType: "dataset.catalogue.registered.v1",
  category: "AUDIT",
  version: 1,
  schema: z
    .object({
      familyId: z.string(),
      versionId: z.string(),
      registrationFingerprint: z.string(),
      contentFingerprint: z.string(),
      lifecycleState: z.string(),
      qualityReferenceCount: z.number().int().nonnegative(),
    })
    .strict(),
  description: "A governed dataset version was registered in the catalogue.",
  owner: "@ate/dataset-catalogue",
} satisfies EventTypeRegistration;

export const datasetCatalogueLifecycleChangedEvent = {
  eventType: "dataset.catalogue.lifecycle.changed.v1",
  category: "AUDIT",
  version: 1,
  schema: z
    .object({
      familyId: z.string(),
      versionId: z.string(),
      from: z.string().optional(),
      to: z.string(),
      reason: z.string(),
    })
    .strict(),
  description: "A dataset catalogue lifecycle state changed without mutating dataset content.",
  owner: "@ate/dataset-catalogue",
} satisfies EventTypeRegistration;

export const datasetCatalogueIntegrityFailedEvent = {
  eventType: "dataset.catalogue.integrity.failed.v1",
  category: "OPERATIONAL",
  version: 1,
  schema: z
    .object({
      familyId: z.string(),
      versionId: z.string(),
      integrityStatus: z.string(),
      issueCount: z.number().int().nonnegative(),
      safeMessage: z.string(),
    })
    .strict(),
  description: "Dataset catalogue integrity verification found a mismatch or broken reference.",
  owner: "@ate/dataset-catalogue",
} satisfies EventTypeRegistration;

export const datasetCatalogueQualityLinkedEvent = {
  eventType: "dataset.catalogue.quality.linked.v1",
  category: "AUDIT",
  version: 1,
  schema: z
    .object({
      familyId: z.string(),
      versionId: z.string(),
      reportId: z.string(),
      reportFingerprint: z.string(),
      qualification: z.string(),
    })
    .strict(),
  description: "A Prompt 15 quality report reference was linked to a catalogue dataset version.",
  owner: "@ate/dataset-catalogue",
} satisfies EventTypeRegistration;

export const datasetLineageRegisteredEvent = {
  eventType: "dataset.lineage.registered.v1",
  category: "AUDIT",
  version: 1,
  schema: z
    .object({
      versionId: z.string(),
      parentCount: z.number().int().nonnegative(),
      edgeCount: z.number().int().nonnegative(),
      lineageFingerprint: z.string(),
    })
    .strict(),
  description: "Dataset lineage relationships were registered as bounded summary metadata.",
  owner: "@ate/dataset-catalogue",
} satisfies EventTypeRegistration;

export const datasetCatalogueEventRegistrations: readonly EventTypeRegistration[] = [
  datasetCatalogueRegisteredEvent,
  datasetCatalogueLifecycleChangedEvent,
  datasetCatalogueIntegrityFailedEvent,
  datasetCatalogueQualityLinkedEvent,
  datasetLineageRegisteredEvent,
];
