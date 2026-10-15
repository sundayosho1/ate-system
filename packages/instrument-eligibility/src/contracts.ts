import { z } from "zod";
import { schemas, actorSchema } from "@ate/domain";
import { canonicalId, digest } from "@ate/instrument-registry";
import { code, text, clockSchema } from "@ate/broker-symbol-catalogue";
import { calendarSchema } from "@ate/multitimeframe";
export { code, text, digest, clockSchema };
export const stages = [
  "DISCOVERED",
  "MAPPED",
  "DATA_QUALIFIED",
  "RESEARCH",
  "VALIDATED",
  "SIMULATION",
  "LIVE_ELIGIBLE",
  "ACTIVE",
] as const;
export const stageSchema = z.enum(stages);
export type Stage = z.infer<typeof stageSchema>;
export const dispositionSchema = z.enum([
  "NONE",
  "PENDING_EVIDENCE",
  "UNDER_REVIEW",
  "SUSPENDED",
  "REVOKED",
  "EXPIRED",
  "QUARANTINED",
  "RETIRED",
]);
export const capabilities = [
  "CATALOGUE_INSPECTION",
  "HISTORICAL_DATA_RESEARCH",
  "MULTI_TIMEFRAME_RESEARCH",
  "SPECIFICATION_COMPARISON",
  "STRATEGY_RESEARCH",
  "VALIDATION_REVIEW",
  "OFFLINE_SIMULATION",
] as const;
export const capabilitySchema = z.enum(capabilities);
const positive = z.number().int().min(1).max(10000);
export const policySchema = z
  .object({
    version: z.literal(1),
    policyId: code,
    approvalPolicyId: code,
    allowQualityWarnings: z.boolean(),
    maxRecords: positive,
    maxHistory: positive,
    maxEvidence: positive,
    maxDependencies: positive,
    maxRequests: positive,
    maxApprovals: positive,
    maxDiagnostics: positive,
    maxQueryResults: positive,
    maxInputBytes: z.number().int().min(1024).max(16777216),
    maxInputDepth: z.number().int().min(1).max(20),
    maxSnapshotBytes: z.number().int().min(4096).max(67108864),
    maxRetainedBytes: z.number().int().min(4096).max(1073741824),
    maxRecoverySteps: positive,
    maxEvidenceAgeMs: z.number().int().positive().max(31536000000),
    compatibleHistoryPolicies: z.array(digest).max(128),
    // Bind external declarations to explicitly configured source identities, not caller PASSED flags.
    validationSources: z
      .array(
        z.object({ sourceId: code, issuerId: schemas.actorId, methodologyVersion: code }).strict(),
      )
      .max(128),
  })
  .strict();
export type Policy = z.infer<typeof policySchema>;
export const datasetBindingSchema = z
  .object({
    versionId: code,
    versionFingerprint: digest,
    instrumentId: schemas.instrumentId,
    associationFingerprint: digest,
    contentFingerprint: z.string().min(1).max(256),
    qualityReportId: code,
    qualityFingerprint: z.string().min(1).max(256),
  })
  .strict();
export const contextSchema = z
  .object({
    instrumentId: canonicalId,
    revisionId: digest,
    mappingSet: digest,
    mappingFingerprint: digest,
    source: z
      .object({ ownerId: code, catalogueFingerprint: digest, observationFingerprint: digest })
      .strict(),
    timeframes: z.array(code).min(1).max(32),
    specification: digest.nullable(),
    datasets: z.array(datasetBindingSchema).max(128),
    calendar: calendarSchema.nullable(),
    calendarFingerprint: z.string().min(1).max(256).nullable(),
    subject: code.nullable(),
    hypothesis: code.nullable(),
    methodology: code.nullable(),
    methodologyVersion: code.nullable(),
    replay: z
      .object({
        leftSession: code,
        leftCheckpoint: z.string().min(1).max(256),
        rightSession: code,
        rightCheckpoint: z.string().min(1).max(256),
      })
      .strict()
      .nullable(),
    attestation: digest.nullable(),
  })
  .strict();
export type Context = z.infer<typeof contextSchema>;
export const attestationSchema = z
  .object({
    schemaVersion: z.literal(1),
    attestationId: code,
    sourceId: code,
    issuer: actorSchema,
    subject: code,
    instrumentId: canonicalId,
    hypothesis: code,
    methodology: code,
    methodologyVersion: code,
    policyId: code,
    policyVersion: z.literal(1),
    datasets: z.array(datasetBindingSchema).min(1).max(128),
    replay: contextSchema.shape.replay.unwrap(),
    evidenceReferences: z.array(text).min(1).max(128),
    outcome: z.enum(["PASSED", "FAILED", "INCONCLUSIVE"]),
    status: z.enum(["CURRENT", "REVOKED", "SUPERSEDED"]),
    supersededBy: digest.nullable(),
    issuedAt: schemas.timestamp,
    effectiveAt: schemas.timestamp,
    expiresAt: schemas.timestamp.nullable(),
    provenance: text,
    evidenceFingerprint: digest,
    fingerprint: digest,
  })
  .strict();
export type Attestation = z.infer<typeof attestationSchema>;
export const certificateSchema = z
  .object({
    actorId: schemas.actorId,
    authority: z.literal("CONFIGURATION_CHECKER"),
    authorized: z.literal(true),
    checkedAt: schemas.timestamp,
    evidence: text,
  })
  .strict();
export type Certificate = z.infer<typeof certificateSchema>;
export const actionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("DISCOVER"),
      id: code,
      instrumentId: canonicalId,
      context: contextSchema,
      maker: actorSchema,
      occurredAt: schemas.timestamp,
      effectiveAt: schemas.timestamp,
    })
    .strict(),
  z
    .object({
      kind: z.literal("REQUEST"),
      id: code,
      instrumentId: canonicalId,
      context: contextSchema,
      destination: stageSchema,
      maker: actorSchema,
      occurredAt: schemas.timestamp,
      effectiveAt: schemas.timestamp,
      disposition: dispositionSchema.nullable(),
      reason: text,
    })
    .strict(),
  z
    .object({ kind: z.literal("APPROVE"), id: code, requestId: code, checker: actorSchema })
    .strict(),
  z.object({ kind: z.literal("COMMIT"), id: code, requestId: code, approvalId: code }).strict(),
  z
    .object({
      kind: z.literal("ATTEST"),
      id: code,
      attestation: attestationSchema,
      checker: actorSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("ATTEST_STATUS"),
      id: code,
      attestation: digest,
      status: z.enum(["REVOKED", "SUPERSEDED"]),
      checker: actorSchema,
      reason: text,
    })
    .strict(),
]);
export type Action = z.infer<typeof actionSchema>;
export const assessmentSchema = z
  .object({
    required: z.array(code).max(128),
    requiredApprovals: z.array(code).max(4),
    currentDisposition: dispositionSchema,
    commitAuthorized: z.literal(false),
    source: stageSchema,
    destination: stageSchema,
    allowed: z.boolean(),
    reasons: z.array(code).max(128),
    present: z.array(code).max(128),
    missing: z.array(code).max(128),
    contradictory: z.array(code).max(128),
    expired: z.array(code).max(128),
    dimensions: z.record(z.string(), z.array(code).max(128)),
    capabilities: z
      .array(
        z
          .object({
            capability: capabilitySchema,
            allowed: z.boolean(),
            reasons: z.array(code).max(128),
          })
          .strict(),
      )
      .length(7),
    replayReproducible: z.boolean(),
    validationAttested: z.boolean(),
    validationIndependentlyVerified: z.literal(false),
    policyFingerprint: digest,
    contextFingerprint: digest,
    evaluatedAt: schemas.timestamp,
    fingerprint: digest,
  })
  .strict();
export type Assessment = z.infer<typeof assessmentSchema>;
export const snapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    serviceId: code,
    generation: positive,
    previous: digest.nullable(),
    publishedAt: schemas.timestamp,
    observedAt: schemas.timestamp,
    clockProvenance: clockSchema,
    policy: policySchema,
    policyFingerprint: digest,
    configurationFingerprint: digest,
    action: actionSchema,
    assessment: assessmentSchema.nullable(),
    certificates: z.array(certificateSchema).max(2),
    fingerprint: digest,
  })
  .strict();
export type Snapshot = z.infer<typeof snapshotSchema>;
export type RecordState = Readonly<{
  instrumentId: string;
  stage: Stage;
  disposition: z.infer<typeof dispositionSchema>;
  context: Context;
  version: string;
  effectiveAt: string;
  decisionAt: string;
  approval: string | null;
  previous: string | null;
}>;
export type Result<T> = Readonly<
  { ok: true; value: T } | { ok: false; error: { code: string; commitment: "NONE" | "UNKNOWN" } }
>;
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T = never>(
  code: string,
  commitment: "NONE" | "UNKNOWN" = "NONE",
): Result<T> => ({ ok: false, error: { code, commitment } });
export interface Repository {
  load(): Promise<Result<readonly unknown[]>>;
  commit(s: Snapshot): Promise<Result<Snapshot>>;
}
