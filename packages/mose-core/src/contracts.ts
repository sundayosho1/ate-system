import { z } from "zod";
import { actorSchema, schemas } from "@ate/domain";
import {
  contextSchema,
  certificateSchema,
  code,
  digest,
  clockSchema,
} from "@ate/instrument-eligibility";
export { code, digest };
export const reasons = {
  CANONICAL_PLAN_MISMATCH:
    "Retained obligations or metadata differ from canonical accepted source evidence.",
  CANONICAL_PLAN_UNVERIFIED:
    "Canonical source-plan verification remains unresolved; no affirmative coverage authority.",
  OBSERVED: "Qualified offline observation; no signal or permission to act.",
  INSTRUMENT_INELIGIBLE: "Current owner capability does not permit this research activity.",
  UNIVERSE_NOT_AUTHORIZED: "Universe identity or governed approval is unavailable.",
  SOURCE_UNAVAILABLE: "A required immutable source cannot currently be resolved.",
  DATA_STALE: "Evidence exceeds the governed age budget at its research boundary.",
  DATA_QUALITY_FAILED: "Owner quality evidence is missing or contains blocking findings.",
  PROVENANCE_INCOMPLETE: "The full immutable dataset and replay binding is not established.",
  TEMPORAL_INCONSISTENCY: "Evidence was unavailable, incomplete or future at this boundary.",
  DUPLICATE_OBSERVATION: "An existing logical receipt must not be counted twice.",
  OUT_OF_ORDER_OBSERVATION: "Admission does not follow the immutable owner event order.",
  CONFIGURATION_INVALID: "Current configuration does not match the governed research policy.",
  POLICY_NOT_EFFECTIVE: "Research policy is not yet effective.",
  RUNTIME_NOT_READY: "Runtime lifecycle does not permit this operation.",
  RESOURCE_BUDGET_EXCEEDED: "The operation exceeds a declared bounded resource budget.",
  REPLAY_EVIDENCE_INVALID: "Replay specification, checkpoint or input identity is invalid.",
  PROCESSING_DEFERRED: "The observation remains an outstanding processing obligation.",
  UNKNOWN_EVIDENCE: "Required evidence identity is unknown.",
} as const;
export const reasonSchema = z.enum(
  Object.keys(reasons) as [keyof typeof reasons, ...(keyof typeof reasons)[]],
);
export type Reason = z.infer<typeof reasonSchema>;
export const funnelStages = [
  "OBSERVED",
  "INTERESTING",
  "SETUP_FORMING",
  "CANDIDATE",
  "QUALIFIED",
  "RISK_ELIGIBLE",
  "PORTFOLIO_ELIGIBLE",
  "DECISION_APPROVED",
  "ALLOCATED",
  "EXECUTED",
  "OUTCOME",
] as const;
/** Reserved vocabulary only: future owners require separate authorization and contracts. */
export type FunnelStage = (typeof funnelStages)[number];
export interface ReservedFunnelEventEnvelopeV1 {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly opportunityCorrelationId: string;
  readonly observationId: string;
  readonly instrumentId: string;
  readonly stageOwner: string;
  readonly previousStage: FunnelStage | null;
  readonly newStage: FunnelStage;
  readonly at: string;
  readonly reason: string;
  readonly sourceVersion: string;
  readonly evidenceVersions: readonly string[];
  readonly policyVersion: number;
  readonly policyFingerprint: string;
  readonly authorityReference: string;
  readonly evidenceReferences: readonly string[];
  readonly outcome: string;
  readonly auditTrace: string;
}
export const terminalDispositions = [
  "INVALIDATED",
  "EXPIRED",
  "REJECTED",
  "DEFERRED",
  "NO_ACTION",
] as const;
const limit = z.number().int().min(1).max(10000);
export const policySchema = z
  .object({
    version: z.literal(1),
    enabled: z.literal(true),
    policyId: code,
    approvalPolicyId: code,
    effectiveAt: schemas.timestamp,
    capability: z.enum(["HISTORICAL_DATA_RESEARCH", "MULTI_TIMEFRAME_RESEARCH"]),
    maxSessions: limit,
    maxInstruments: limit,
    maxQueued: limit,
    maxRetained: limit,
    maxInputBytes: z.number().int().min(1024).max(1048576),
    maxInputDepth: z.number().int().min(1).max(20),
    maxBatch: limit,
    maxOutstandingAcknowledgments: z.literal(1),
    maxRecoverySteps: limit,
    maxAuditBatch: limit,
    maxHistory: limit,
    maxCheckpointBytes: z.number().int().min(4096).max(16777216),
    maxRetainedBytes: z.number().int().min(4096).max(1073741824),
    maxEvidenceAgeMs: z.number().int().positive().max(31536000000),
    allowReconstruction: z.boolean(),
    requiredTimeframes: z.array(code).max(32),
  })
  .strict();
export type Policy = z.infer<typeof policySchema>;
export const defaultPolicy: Policy = {
  version: 1,
  enabled: true,
  policyId: "mose.research",
  approvalPolicyId: "mose.research",
  effectiveAt: "2026-01-01T00:00:00.000Z" as Policy["effectiveAt"],
  capability: "HISTORICAL_DATA_RESEARCH",
  maxSessions: 8,
  maxInstruments: 32,
  maxQueued: 32,
  maxRetained: 256,
  maxInputBytes: 65536,
  maxInputDepth: 20,
  maxBatch: 16,
  maxOutstandingAcknowledgments: 1,
  maxRecoverySteps: 512,
  maxAuditBatch: 16,
  maxHistory: 512,
  maxCheckpointBytes: 1048576,
  maxRetainedBytes: 67108864,
  maxEvidenceAgeMs: 604800000,
  allowReconstruction: false,
  requiredTimeframes: [],
};
export const sourceSchema = z.object({ sessionId: code, checkpoint: code }).strict();
export type Source = z.infer<typeof sourceSchema>;
export const universeRequestSchema = z
  .object({
    id: code,
    sessionId: code,
    instruments: z
      .array(z.object({ instrumentId: code, source: sourceSchema }).strict())
      .min(1)
      .max(128),
    maker: actorSchema,
    checker: actorSchema,
    previousUniverse: digest.nullable(),
  })
  .strict();
export const memberSchema = z
  .object({
    instrumentId: code,
    eligible: z.boolean(),
    sourceReady: z.boolean(),
    included: z.boolean(),
    reasons: z.array(reasonSchema).max(16),
    context: contextSchema.nullable(),
    eligibilityVersion: digest.nullable(),
    eligibilityAssessment: digest.nullable(),
    source: sourceSchema,
    inputFingerprint: code.nullable(),
    expected: z.number().int().min(0).max(100000).nullable(),
  })
  .strict();
export const planSchema = z
  .object({
    key: digest,
    instrumentId: code,
    source: sourceSchema,
    eventId: code,
    sourceCursor: code,
    ownerOrdinal: z.number().int().min(0).max(100000),
    eventAt: schemas.timestamp,
    boundaryAt: schemas.timestamp,
    timeframe: code,
    datasetId: code,
    datasetVersion: code,
    datasetVersionFingerprint: digest,
    datasetContentFingerprint: code,
    qualityReportId: code,
    qualityFingerprint: code,
    manifestId: code,
    manifestFingerprint: code,
    payloadFingerprint: code,
    evidenceClass: z.enum(["VERIFIED_POINT_IN_TIME", "EVENT_TIME_RECONSTRUCTION"]),
  })
  .strict();
export type Plan = z.infer<typeof planSchema>;
export const universeSchema = z
  .object({
    schemaVersion: z.literal(1),
    sessionId: code,
    previousUniverse: digest.nullable(),
    configurationSnapshot: code,
    configurationFingerprint: digest,
    policyFingerprint: digest,
    createdAt: schemas.timestamp,
    effectiveAt: schemas.timestamp,
    policy: policySchema,
    maker: actorSchema,
    checker: actorSchema,
    certificate: certificateSchema,
    members: z.array(memberSchema).max(128),
    plan: z.array(planSchema).max(100000),
    fingerprint: digest,
  })
  .strict();
export type Universe = z.infer<typeof universeSchema>;
export const observationSchema = z
  .object({
    schemaVersion: z.literal(1),
    observationId: digest,
    sessionId: code,
    universeSnapshot: digest,
    instrumentId: code,
    plan: planSchema,
    sequence: z.number().int().positive(),
    receivedAt: schemas.timestamp,
    processingTime: schemas.timestamp.nullable(),
    researchClassification: z.literal("OFFLINE_OBSERVATION"),
    qualityDisposition: z.enum(["NOT_EVALUATED", "PRESERVED", "FAILED", "UNKNOWN"]),
    qualityReferences: z.array(code).max(128),
    outcome: z.enum(["PENDING", "DEFERRED", "ADMITTED", "REJECTED", "QUARANTINED"]),
    reason: reasonSchema,
    reasonExplanation: z.string().max(256),
    auditCorrelationId: digest,
    eligibilityAssessment: digest.nullable(),
    eligibilityReasons: z.array(code).max(128),
    funnelEvent: z
      .object({
        schemaVersion: z.literal(1),
        eventId: digest,
        opportunityCorrelationId: digest,
        observationId: digest,
        instrumentId: code,
        stageOwner: z.literal("MOSE_CORE"),
        previousStage: z.null(),
        newStage: z.literal("OBSERVED"),
        at: schemas.timestamp,
        reason: z.literal("OBSERVED"),
        sourceVersion: code,
        evidenceVersions: z.array(code).min(1).max(8),
        policyVersion: z.literal(1),
        policyFingerprint: digest,
        authorityReference: digest,
        evidenceReferences: z.array(code).min(1).max(8),
        outcome: z.literal("RESEARCH_ONLY"),
        auditTrace: digest,
      })
      .strict()
      .nullable(),
  })
  .strict();
export type Observation = z.infer<typeof observationSchema>;
export const sessionSchema = z
  .object({
    universe: universeSchema,
    status: z.enum(["READY", "RUNNING", "PAUSED", "COMPLETED", "STOPPED"]),
    cursor: z.number().int().min(0),
    observations: z.array(observationSchema).max(10000),
  })
  .strict();
export type Session = z.infer<typeof sessionSchema>;
export const stateSchema = z.object({ sessions: z.array(sessionSchema).max(128) }).strict();
export type State = z.infer<typeof stateSchema>;
export const commandSchema = z.discriminatedUnion("kind", [
  universeRequestSchema.extend({ kind: z.literal("CREATE") }),
  z.object({ kind: z.enum(["START", "PAUSE", "COMPLETE"]), id: code, sessionId: code }).strict(),
  z
    .object({
      kind: z.literal("RECEIVE"),
      id: code,
      sessionId: code,
      eventId: code,
      instrumentId: code,
      universeSnapshot: digest,
    })
    .strict(),
  z.object({ kind: z.literal("PROCESS"), id: code, sessionId: code, limit }).strict(),
  z.object({ kind: z.literal("STOP"), id: code }).strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export const checkpointSchema = z
  .object({
    schemaVersion: z.literal(1),
    runtimeId: code,
    generation: limit,
    previous: digest.nullable(),
    at: schemas.timestamp,
    clock: clockSchema,
    configurationFingerprint: digest,
    policyFingerprint: digest,
    command: commandSchema,
    state: stateSchema,
    fingerprint: digest,
  })
  .strict();
export type Checkpoint = z.infer<typeof checkpointSchema>;
export type Result<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: { code: string; commitment: "NONE" | "UNKNOWN"; auditCorrelationId: string };
    };
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export interface Repository {
  load(): Promise<Result<readonly unknown[]>>;
  commit(checkpoint: Checkpoint): Promise<Result<Checkpoint>>;
}
