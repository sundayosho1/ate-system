import { z } from "zod";
import { planSchema as mosePlanSchema } from "@ate/mose-core";
import {
  identifier,
  digest,
  timestamp,
  triggerSchema,
  dispositions,
  checkpointSchema as scannerCheckpointSchema,
} from "@ate/mose-scanner";
export { identifier, digest, timestamp };
export const tiers = Object.freeze(["MINIMAL", "LOW", "STANDARD", "ELEVATED", "HIGH"] as const);
export const weights = Object.freeze([1, 2, 4, 6, 8] as const);
export const defaults = Object.freeze({
  epochMs: 60000,
  maxInstruments: 32,
  maxSubjects: 128,
  maxProposalsPerEpoch: 32,
  maxBoostPerInstrument: 8,
  creditCap: 4,
  maxAssessmentsPerBatch: 16,
  maxOwnerCallsPerCommand: 64,
  maxOutstandingPublication: 1,
  maxSubmissionsPerCommand: 1,
  maxDispatchBatch: 16,
  maxInputBytes: 65536,
  maxInputDepth: 20,
  maxEvidenceRefs: 64,
  maxHistory: 512,
  maxRecoverySteps: 512,
  maxCheckpointBytes: 1048576,
  maxRetainedBytes: 67108864,
  maxQueryResults: 100,
  maxQueryPages: 16,
  maxAttemptRetries: 2,
  maxDependencies: 128,
  maxEdges: 256,
});
const limits = Object.fromEntries(
  Object.entries(defaults).map(([k, v]) => [k, z.number().int().min(1).max(v)]),
) as { [K in keyof typeof defaults]: z.ZodNumber };
export const policySchema = z
  .object({
    version: identifier,
    effectiveAt: timestamp,
    anchor: timestamp,
    ...limits,
    submissionEnabled: z.boolean(),
    dispatchEnabled: z.boolean(),
    actor: identifier.nullable(),
  })
  .strict();
export type AttentionPolicy = z.infer<typeof policySchema>;
export const defaultAttentionPolicy: AttentionPolicy = Object.freeze({
  version: "attention.v1",
  effectiveAt: "2000-01-01T00:00:00.000Z",
  anchor: "2026-01-01T00:00:00.000Z",
  ...defaults,
  submissionEnabled: false,
  dispatchEnabled: false,
  actor: null,
});
export const subjectSchema = z
  .object({
    sessionId: identifier,
    universe: digest,
    instrumentId: identifier,
    subscriptions: z.array(identifier).min(1).max(128),
  })
  .strict();
export type Subject = z.infer<typeof subjectSchema>;
export const evidenceSchema = z
  .object({
    ownerHealth: z.enum(["HEALTHY", "DEGRADED"]),
    sourceScopeHealthy: z.literal(true),
    owner: z.literal("MOSE_CORE"),
    ownerVersion: z.literal("0.25.0-mose-core.1"),
    recordFingerprint: digest,
    publication: z
      .object({
        runtimeId: identifier,
        generation: z.number().int().positive(),
        fingerprint: digest,
      })
      .strict(),
    lineage: mosePlanSchema,
    replayInputFingerprint: identifier,
    observationId: digest,
    dependency: digest,
    availableAt: timestamp,
    eventAt: timestamp,
    source: digest,
    policy: digest,
    finality: z.enum(["FINAL", "NOT_APPLICABLE"]),
  })
  .strict();
export type Evidence = z.infer<typeof evidenceSchema>;
export const assessmentSchema = z
  .object({
    owner: z.literal("MOSE_ATTENTION"),
    ownerVersion: z.literal("0.27.0-adaptive-surveillance.1"),
    reasonCodes: z.array(identifier).min(1).max(16),
    effectiveFrom: timestamp,
    cooldownUntil: timestamp,
    schemaVersion: z.literal(1),
    id: digest,
    subject: subjectSchema,
    subjectKey: digest,
    epoch: z.number().int().nonnegative(),
    asOf: timestamp,
    evaluatedAt: timestamp,
    policy: digest,
    configuration: digest,
    previous: digest.nullable(),
    evidence: evidenceSchema.nullable(),
    tier: z.enum(tiers),
    sufficient: z.boolean(),
    reason: identifier,
    changedStreak: z.number().int().min(0).max(2),
    stableStreak: z.number().int().min(0).max(2),
    lastChangeEpoch: z.number().int().min(-2),
    expiresAt: timestamp,
    recommendedCadence: z.string(),
    proposedBudget: z.number().int().min(0).max(8),
    opportunityState: z.literal("UNSUPPORTED"),
    currentAuthority: z.enum(["VERIFIED", "UNESTABLISHED"]),
  })
  .strict();
export type AttentionAssessment = z.infer<typeof assessmentSchema>;
export const floorSchema = z
  .object({
    id: digest,
    instrumentKey: digest,
    subjectKey: digest,
    epoch: z.number().int().nonnegative(),
    policy: digest,
    settledBy: identifier.nullable(),
    reservation: digest.nullable(),
  })
  .strict();
export const scannerReceiptSchema = z
  .object({
    trigger: triggerSchema,
    workKey: z.string().nullable(),
    disposition: z.enum(dispositions),
    reason: z.string(),
  })
  .strict();
export const outcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ACK"), receipt: scannerReceiptSchema }).strict(),
  z
    .object({
      kind: z.literal("NEGATIVE"),
      code: z.string(),
      commitment: z.enum(["NONE", "UNKNOWN"]),
    })
    .strict(),
  z.object({ kind: z.literal("UNCERTAIN"), code: identifier }).strict(),
]);
export type SubmissionOutcome = z.infer<typeof outcomeSchema>;
export const recommendationSchema = z
  .object({
    id: digest,
    assessmentId: digest,
    subjectKey: digest,
    instrumentKey: digest,
    epoch: z.number().int().nonnegative(),
    subscriptionId: identifier,
    floorId: digest.nullable(),
    payload: triggerSchema.nullable(),
    status: z.enum([
      "PROPOSED",
      "INTENT",
      "ADMITTED",
      "UNRESOLVED",
      "REJECTED",
      "RECOMMENDATION_ONLY",
    ]),
    attempts: z.number().int().nonnegative(),
    intentCommandId: identifier.optional(),
    outcome: outcomeSchema.optional(),
    reason: identifier,
    receiptId: identifier.nullable(),
    receiptFingerprint: digest.nullable(),
  })
  .strict();
export type Recommendation = z.infer<typeof recommendationSchema>;
export const ledgerSchema = z
  .object({
    epoch: z.number().int().nonnegative(),
    spent: z.number().int().nonnegative(),
    credits: z.record(digest, z.number().int().min(0).max(4)),
    bonus: z.record(digest, z.number().int().min(0).max(32)),
    bonusAccrued: z.array(digest),
    bonuses: z.record(digest, z.number().int().min(0).max(8)),
    lastInstrument: digest.nullable(),
    lastSubject: z.record(digest, digest),
    memberKeys: z.array(digest),
    consistency: z.enum(["ESTABLISHED", "CONSISTENCY_UNESTABLISHED"]),
    barrierId: identifier.nullable(),
  })
  .strict();
export const dispatchResultSchema = scannerCheckpointSchema.shape.state.shape.work;
export const stateSchema = z
  .object({
    phase: z.enum(["READY", "RUNNING", "PAUSED", "STOPPED"]),
    assessments: z.array(assessmentSchema),
    floors: z.array(floorSchema),
    recommendations: z.array(recommendationSchema),
    ledgers: z.array(ledgerSchema),
    executions: z.array(
      z
        .object({
          id: identifier,
          status: z.enum(["INTENT", "ACKNOWLEDGED", "UNRESOLVED"]),
          limit: z.number().int().positive().optional(),
          result: z.unknown(),
        })
        .strict(),
    ),
  })
  .strict();
export type AttentionState = z.infer<typeof stateSchema>;
export type Ledger = z.infer<typeof ledgerSchema>;
export const emptyState = (): AttentionState => ({
  phase: "READY",
  assessments: [],
  floors: [],
  recommendations: [],
  ledgers: [],
  executions: [],
});
export const commandSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("ASSESS"), id: identifier, subject: subjectSchema, asOf: timestamp })
    .strict(),
  z
    .object({
      kind: z.literal("ALLOCATE"),
      id: identifier,
      asOf: timestamp,
      limit: z.number().int().positive(),
    })
    .strict(),
  z
    .object({ kind: z.enum(["SUBMIT", "RECONCILE"]), id: identifier, recommendationId: digest })
    .strict(),
  z
    .object({
      kind: z.literal("EXECUTE_ADMITTED"),
      id: identifier,
      limit: z.number().int().positive(),
    })
    .strict(),
  z.object({ kind: z.enum(["START", "PAUSE", "RESUME", "STOP"]), id: identifier }).strict(),
]);
export type AttentionCommand = z.infer<typeof commandSchema>;
export const checkpointSchema = z
  .object({
    owner: z.literal("MOSE_ATTENTION"),
    ownerVersion: z.literal("0.27.0-adaptive-surveillance.1"),
    schemaVersion: z.literal(1),
    generation: z.number().int().positive(),
    previous: digest.nullable(),
    at: timestamp,
    policy: digest,
    configuration: digest,
    command: commandSchema,
    state: stateSchema,
    fingerprint: digest,
  })
  .strict();
export type AttentionCheckpoint = z.infer<typeof checkpointSchema>;
export type AttentionResult<T> =
  { ok: true; value: T } | { ok: false; error: { code: string; commitment: "NONE" | "UNKNOWN" } };
export const ok = <T>(value: T): AttentionResult<T> => ({ ok: true, value });
export const fail = (
  code: string,
  commitment: "NONE" | "UNKNOWN" = "NONE",
): AttentionResult<never> => ({ ok: false, error: { code, commitment } });
export interface AttentionRepository {
  load(): Promise<AttentionResult<readonly unknown[]>>;
  commit(record: AttentionCheckpoint): Promise<AttentionResult<AttentionCheckpoint>>;
}
