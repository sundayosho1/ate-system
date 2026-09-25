import type {
  DatasetCatalogueSnapshotId,
  DatasetFamilyId,
  DatasetFingerprint,
  DatasetIntegrityVerificationId,
  DatasetLineageEdgeId,
  DatasetTransformationId,
  DatasetVersionId,
} from "./types.js";
import { fingerprint, shortFingerprint } from "./serialization.js";

export const datasetFamilyId = (value: string): DatasetFamilyId => value as DatasetFamilyId;
export const datasetVersionId = (value: string): DatasetVersionId => value as DatasetVersionId;
export const datasetLineageEdgeId = (value: string): DatasetLineageEdgeId =>
  value as DatasetLineageEdgeId;
export const datasetTransformationId = (value: string): DatasetTransformationId =>
  value as DatasetTransformationId;
export const datasetCatalogueSnapshotId = (value: string): DatasetCatalogueSnapshotId =>
  value as DatasetCatalogueSnapshotId;
export const datasetIntegrityVerificationId = (value: string): DatasetIntegrityVerificationId =>
  value as DatasetIntegrityVerificationId;

export const createDatasetFamilyId = (semanticIdentity: unknown): DatasetFamilyId =>
  datasetFamilyId(shortFingerprint(semanticIdentity, "dsf"));

export const createDatasetVersionId = (semanticIdentity: unknown): DatasetVersionId =>
  datasetVersionId(shortFingerprint(semanticIdentity, "dsv"));

export const createDatasetLineageEdgeId = (semanticIdentity: unknown): DatasetLineageEdgeId =>
  datasetLineageEdgeId(shortFingerprint(semanticIdentity, "dle"));

export const createDatasetTransformationId = (semanticIdentity: unknown): DatasetTransformationId =>
  datasetTransformationId(shortFingerprint(semanticIdentity, "dst"));

export const createDatasetIntegrityVerificationId = (
  semanticIdentity: unknown,
): DatasetIntegrityVerificationId =>
  datasetIntegrityVerificationId(shortFingerprint(semanticIdentity, "div"));

export const createDatasetCatalogueSnapshotId = (
  semanticIdentity: unknown,
): DatasetCatalogueSnapshotId =>
  datasetCatalogueSnapshotId(shortFingerprint(semanticIdentity, "dcs"));

export const semanticFingerprint = (value: unknown): DatasetFingerprint => fingerprint(value);
