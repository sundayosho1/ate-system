import { z } from "zod";
export const identifier = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u);
export const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
export const timestamp = z.string().datetime({ precision: 3 });
export const modes = [
  "TICK_EVENT",
  "SECONDS",
  "BAR_CLOSE",
  "TIMEFRAME",
  "SCHEDULE",
  "TRIGGER",
] as const;
export const modeSchema = z.enum(modes);
export const positive = z.number().int().min(1).max(1000000);
export const policySchema = z
  .object({
    version: identifier,
    effectiveAt: timestamp,
    enabledModes: z.array(modeSchema).min(1).max(6),
    maxSubscriptions: positive,
    maxInstruments: positive,
    maxTimeframes: positive,
    maxQueue: positive,
    maxRequests: positive,
    maxDependencies: positive,
    maxEdges: positive,
    maxBatch: positive,
    maxFanout: positive,
    maxCoalesced: positive,
    maxHistory: positive,
    maxRecoverySteps: positive,
    maxCatchup: positive,
    maxOwnerCalls: positive,
    maxInputBytes: positive,
    maxInputDepth: z.number().int().min(1).max(32),
    maxCheckpointBytes: z.number().int().min(4096).max(16777216),
    maxRetainedBytes: z.number().int().min(4096).max(1073741824),
    maxScheduleHorizonMs: z.number().int().min(1).max(31536000000),
    maxQueryResults: positive,
    coalescing: z.enum(["EXACT_EVIDENCE", "DISABLED"]),
    fairness: z.literal("STABLE_ROUND_ROBIN"),
    trustedTriggerActors: z.array(identifier).max(128),
  })
  .strict();
export type ScannerPolicy = z.infer<typeof policySchema>;
export const defaultScannerPolicy: ScannerPolicy = {
  version: "scanner.v1",
  effectiveAt: "2000-01-01T00:00:00.000Z",
  enabledModes: [...modes],
  maxSubscriptions: 128,
  maxInstruments: 32,
  maxTimeframes: 16,
  maxQueue: 128,
  maxRequests: 512,
  maxDependencies: 128,
  maxEdges: 256,
  maxBatch: 16,
  maxFanout: 32,
  maxCoalesced: 16,
  maxHistory: 512,
  maxRecoverySteps: 512,
  maxCatchup: 32,
  maxOwnerCalls: 64,
  maxInputBytes: 65536,
  maxInputDepth: 24,
  maxCheckpointBytes: 1048576,
  maxRetainedBytes: 67108864,
  maxScheduleHorizonMs: 604800000,
  maxQueryResults: 100,
  coalescing: "EXACT_EVIDENCE",
  fairness: "STABLE_ROUND_ROBIN",
  trustedTriggerActors: [],
};
export const dependencySchema = z
  .object({
    id: identifier,
    parents: z.array(identifier).max(256),
  })
  .strict();
export const subscriptionSchema = z
  .object({
    id: identifier,
    sessionId: identifier,
    universe: digest,
    instrumentId: identifier,
    timeframe: identifier,
    streamId: identifier.nullable(),
    mode: modeSchema,
    dependencies: z.array(identifier).min(1).max(128),
    priority: z.number().int().min(0).max(100),
    cadenceMs: z.number().int().min(1).max(604800000).nullable(),
    anchor: timestamp,
    schedule: z
      .object({
        id: identifier,
        calendarFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
        end: timestamp,
        missed: z.enum(["CATCH_UP", "SKIP"]),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type ScanSubscription = z.infer<typeof subscriptionSchema>;
export const planSchema = z
  .object({
    id: identifier,
    dependencies: z.array(dependencySchema).max(128),
    subscriptions: z.array(subscriptionSchema).min(1).max(128),
  })
  .strict();
export type ScanPlan = z.infer<typeof planSchema>;
export const triggerSchema = z
  .object({
    id: identifier,
    subscriptionId: identifier,
    boundary: timestamp,
    kind: z.enum([
      "EVENT",
      "DEADLINE",
      "BAR_FINALITY",
      "TIMEFRAME",
      "CONFIGURATION",
      "QUALITY",
      "SOURCE_RECOVERY",
      "UNIVERSE",
      "RESEARCH_RESCAN",
    ]),
    actor: identifier.nullable(),
    cause: identifier,
    evidence: digest,
  })
  .strict();
export type ScanTrigger = z.infer<typeof triggerSchema>;
export const dispositions = [
  "DUE",
  "COMPLETED",
  "COALESCED",
  "DEFERRED",
  "SKIPPED",
  "EXPIRED",
  "REJECTED",
  "CANCELLED",
  "QUARANTINED",
  "UNKNOWN",
] as const;
export type Disposition = (typeof dispositions)[number];
export type ScanWork = {
  key: string;
  subscription: ScanSubscription;
  boundary: string;
  evidence: string;
  vector: Record<string, string>;
  requests: string[];
  status: Disposition;
  reason: string;
  ordinal: number;
  attempts: number;
  observationId: string | null;
  ownerAck: string | null;
};
export type ScanRequest = {
  trigger: ScanTrigger;
  workKey: string | null;
  disposition: Disposition;
  reason: string;
};
export type ScannerState = {
  phase: "READY" | "RUNNING" | "PAUSED" | "STOPPED";
  plan: ScanPlan | null;
  work: ScanWork[];
  requests: ScanRequest[];
  versions: Record<string, string>;
  lastInstrument: string | null;
  lastWork: Record<string, string>;
  deadlines: Record<string, string>;
  avoided: number;
};
export type ScannerCheckpoint = {
  schemaVersion: 1;
  generation: number;
  previous: string | null;
  at: string;
  policy: string;
  configuration: string;
  state: ScannerState;
  operation: { id: string; kind: string; payload: unknown };
  fingerprint: string;
};
export type ScannerResult<T> =
  { ok: true; value: T } | { ok: false; error: { code: string; commitment: "NONE" | "UNKNOWN" } };
export const success = <T>(value: T): ScannerResult<T> => ({ ok: true, value });
export const failure = (
  code: string,
  commitment: "NONE" | "UNKNOWN" = "NONE",
): ScannerResult<never> => ({ ok: false, error: { code, commitment } });
export interface ScanCheckpointRepository {
  load(): Promise<ScannerResult<readonly unknown[]>>;
  commit(checkpoint: ScannerCheckpoint): Promise<ScannerResult<ScannerCheckpoint>>;
}
const workSchema = z
  .object({
    key: digest,
    subscription: subscriptionSchema,
    boundary: timestamp,
    evidence: digest,
    vector: z.record(identifier, digest),
    requests: z.array(identifier).max(512),
    status: z.enum(dispositions),
    reason: identifier,
    ordinal: z.number().int().min(0).max(100000),
    attempts: z.number().int().min(0).max(1000000),
    observationId: z.string().nullable(),
    ownerAck: digest.nullable(),
  })
  .strict();
export const stateSchema = z
  .object({
    phase: z.enum(["READY", "RUNNING", "PAUSED", "STOPPED"]),
    plan: planSchema.nullable(),
    work: z.array(workSchema).max(10000),
    requests: z
      .array(
        z
          .object({
            trigger: triggerSchema,
            workKey: digest.nullable(),
            disposition: z.enum(dispositions),
            reason: identifier,
          })
          .strict(),
      )
      .max(10000),
    versions: z.record(identifier, digest),
    lastInstrument: identifier.nullable(),
    lastWork: z.record(identifier, digest),
    deadlines: z.record(identifier, timestamp),
    avoided: z.number().int().min(0),
  })
  .strict();
export const checkpointSchema = z
  .object({
    schemaVersion: z.literal(1),
    generation: positive,
    previous: digest.nullable(),
    at: timestamp,
    policy: digest,
    configuration: digest,
    state: stateSchema,
    operation: z.object({ id: identifier, kind: identifier, payload: z.unknown() }).strict(),
    fingerprint: digest,
  })
  .strict();
