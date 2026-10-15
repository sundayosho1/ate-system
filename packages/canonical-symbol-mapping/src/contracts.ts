import { z } from "zod";
import { schemas } from "@ate/domain";
import { canonicalId, digest, families } from "@ate/instrument-registry";
import {
  catalogueSchema,
  observationSchema,
  namespaceSchema,
  clockSchema,
  text,
  code,
  decisionSchema,
  proposalSchema,
} from "@ate/broker-symbol-catalogue";
export { digest, code, text };
export const outcomes = [
  "NO_CANDIDATE",
  "INSUFFICIENT_EVIDENCE",
  "UNIQUE_QUALIFIED_CANDIDATE",
  "MULTIPLE_CANDIDATES",
  "IDENTIFIER_CONFLICT",
  "TAXONOMY_CONFLICT",
  "SOURCE_METADATA_CONFLICT",
  "STALE_SOURCE",
  "STALE_REGISTRY",
  "POLICY_INCOMPATIBLE",
  "HISTORICAL_EVIDENCE_UNAVAILABLE",
  "CURRENT_AUTHORITY_UNAVAILABLE",
] as const;
export const referenceSchema = z
  .object({ ownerId: code, ownerSnapshot: digest, catalogueFingerprint: digest })
  .strict();
export const assertionSchema = z
  .object({
    ownerId: code,
    catalogueFingerprint: digest,
    observationFingerprint: digest,
    evidenceReference: text,
    contentFingerprint: digest,
    identity: z
      .object({
        underlying: canonicalId.optional(),
        venue: code.optional(),
        expiry: schemas.timestamp.optional(),
        maturity: schemas.timestamp.optional(),
        strike: z
          .string()
          .regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/)
          .optional(),
        kind: code.optional(),
        shareClass: code.optional(),
        network: code.optional(),
        contract: code.optional(),
      })
      .strict(),
  })
  .strict();
export const approvalRefSchema = z
  .object({
    ownerId: code,
    catalogueFingerprint: digest,
    observationFingerprint: digest,
    proposalId: digest,
  })
  .strict();
export const requestSchema = z
  .object({
    requestId: code,
    registrySnapshot: digest,
    sources: z.array(referenceSchema).min(1).max(128),
    assertions: z.array(assertionSchema).max(1024).default([]),
    approvals: z.array(approvalRefSchema).max(1024).default([]),
  })
  .strict();
export type Request = z.infer<typeof requestSchema>;
const count = z.number().int().min(1).max(10000);
export const policySchema = z
  .object({
    version: z.literal(1),
    maxCatalogues: count,
    maxNamespaces: count,
    maxObservations: count,
    maxClaims: z.number().int().min(1).max(16),
    maxCandidates: count,
    maxConflicts: count,
    maxGroupMembers: count,
    maxSets: count,
    maxSnapshotBytes: z.number().int().min(4096).max(67108864),
    maxRetainedBytes: z.number().int().min(4096).max(1073741824),
    maxInputBytes: z.number().int().min(1024).max(16777216),
    maxInputDepth: z.number().int().min(1).max(20),
    maxQueryResults: count,
    maxRegistryHistory: count,
    maxSourceAgeMs: z.number().int().min(1).max(31536000000),
    requireVerifiedIdentifiers: z.boolean(),
    minIndependentClaims: z.number().int().min(1).max(16),
    identifierSchemes: z.array(code).min(1).max(32),
    sourceQuality: z
      .array(z.enum(["SYNTHETIC", "UNVERIFIED_RECORDED", "EVIDENCED_RECORDED"]))
      .min(1)
      .max(3),
    canonicalQualification: z
      .array(z.enum(["EVIDENCE_QUALIFIED", "VERIFIED"]))
      .min(1)
      .max(2),
    compatibleHistoryPolicies: z.array(digest).max(128),
  })
  .strict();
export type Policy = z.infer<typeof policySchema>;
export const claimResultSchema = z
  .object({
    index: z.number().int().min(0),
    claim: z.record(z.string(), z.unknown()),
    status: code,
    candidateIds: z.array(canonicalId).max(10000),
    resolution: z.record(z.string(), z.unknown()),
    policySupported: z.boolean(),
    evidenceIdentity: digest,
  })
  .strict();
export const targetSchema = z
  .object({ instrumentId: canonicalId, revisionId: digest, family: z.enum(families) })
  .strict();
export const mappingSchema = z
  .object({
    qualificationVersion: z.literal(1),
    registryId: code,
    registrySnapshot: digest,
    policyFingerprint: digest,
    configurationFingerprint: digest,
    evaluatedAt: schemas.timestamp,
    clockProvenance: clockSchema,
    fingerprint: digest,
    source: referenceSchema
      .extend({
        contextSnapshot: digest,
        namespaceKey: digest,
        namespace: namespaceSchema,
        observationFingerprint: digest,
        version: z.number().int().positive(),
      })
      .strict(),
    observation: observationSchema,
    normalizationFingerprint: digest,
    assertion: assertionSchema.nullable(),
    claims: z.array(claimResultSchema).max(16),
    lookupEvidence: z.array(z.record(z.string(), z.unknown())).max(16),
    candidateIds: z.array(canonicalId).max(10000),
    target: targetSchema.nullable(),
    outcome: z.enum(outcomes),
    reasonCodes: z.array(code).max(10000),
    approval: z
      .object({
        proposal: proposalSchema,
        decision: decisionSchema.nullable(),
        consistent: z.boolean(),
      })
      .strict()
      .nullable(),
    tradingAuthority: z.literal(false),
  })
  .strict();
export type Mapping = z.infer<typeof mappingSchema>;
export const conflictSchema = z
  .object({
    code: code,
    key: text,
    mappings: z.array(digest).max(10000),
    candidateIds: z.array(canonicalId).max(10000),
    fingerprint: digest,
  })
  .strict();
export const groupSchema = z
  .object({
    instrumentId: canonicalId,
    revisionId: digest,
    registrySnapshot: digest,
    members: z.array(digest).max(10000),
    contractEquivalence: z.literal("NOT_ESTABLISHED"),
    tradingAuthority: z.literal(false),
    fingerprint: digest,
  })
  .strict();
export const preparedSchema = z
  .object({
    request: requestSchema,
    policy: policySchema,
    policyFingerprint: digest,
    configurationFingerprint: digest,
    evaluatedAt: schemas.timestamp,
    clockProvenance: clockSchema,
    context: z
      .object({
        registryCurrent: digest,
        sourceCurrent: z.array(z.object({ ownerId: code, snapshot: digest }).strict()).max(128),
      })
      .strict(),
    catalogues: z
      .array(z.object({ reference: referenceSchema, catalogue: catalogueSchema }).strict())
      .max(128),
    mappings: z.array(mappingSchema).max(10000),
    conflicts: z.array(conflictSchema).max(10000),
    groups: z.array(groupSchema).max(10000),
    inputFingerprint: digest,
    fingerprint: digest,
  })
  .strict();
export type Prepared = z.infer<typeof preparedSchema>;
export const snapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    serviceId: code,
    generation: z.number().int().positive(),
    previous: digest.nullable(),
    publishedAt: schemas.timestamp,
    clockProvenance: clockSchema,
    prepared: preparedSchema,
    supersedes: z.array(z.object({ before: digest, after: digest }).strict()).max(10000),
    fingerprint: digest,
  })
  .strict();
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Result<T> = Readonly<
  | { ok: true; value: T }
  | { ok: false; error: Readonly<{ code: string; commitment: "NONE" | "UNKNOWN" }> }
>;
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T = never>(
  code: string,
  commitment: "NONE" | "UNKNOWN" = "NONE",
): Result<T> => ({ ok: false, error: { code, commitment } });
export interface Repository {
  load(): Promise<Result<readonly unknown[]>>;
  commit(snapshot: Snapshot): Promise<Result<Snapshot>>;
}
