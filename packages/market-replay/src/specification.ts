import { z } from "zod";
import { schemas } from "@ate/domain";
import {
  CalendarBoundaryResolver,
  TimeframeRegistry,
  validateOptions,
  defaultOptions,
  hash,
  freeze,
  safeClone,
} from "@ate/multitimeframe";
import type { EffectiveConfiguration } from "@ate/configuration";
import { replayFromEffective, validateReplayLimits } from "./configuration.js";
import type {
  ReplaySessionSpecification,
  ReplayTaskDescriptor,
  ReplayAggregationPolicy,
} from "./types.js";
export const replayId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);
export const replayFingerprint = z.string().regex(/^(sha256:)?[a-f0-9]{64}$/u);
export const replayStreamSchema = z
  .object({
    sourceId: schemas.sourceId,
    instrumentId: schemas.instrumentId,
    channel: replayId,
    basis: z.enum(["BID", "ASK", "MIDPOINT", "LAST_TRADE"]),
    priceCurrency: replayId,
    sourceFingerprint: replayFingerprint,
    volumeType: z.enum(["QUOTE_COUNT", "TICK_VOLUME", "TRADE_VOLUME", "NOT_AVAILABLE"]),
    volumeUnit: replayId,
  })
  .strict();
const timestamp = schemas.timestamp;
export const taskActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("FENCE"), streamId: replayFingerprint, reason: replayId }).strict(),
  z
    .object({
      kind: z.literal("LOSS"),
      consumerId: replayId,
      rejected: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      discarded: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      degraded: z.boolean(),
      closed: z.boolean(),
      contextFingerprint: replayFingerprint,
    })
    .strict(),
  z
    .object({
      kind: z.literal("WATERMARK"),
      streamId: replayFingerprint,
      authorityReference: replayId,
      evidence: z
        .object({
          sessionId: replayId,
          through: timestamp,
          observedAt: timestamp,
          coverage: z.enum(["COMPLETE_COVERAGE", "INCOMPLETE", "UNKNOWN"]),
          kind: z.enum(["CONTINUITY", "END_OF_STREAM"]),
          evidenceId: replayId,
          reconciled: z.boolean(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("PUBLISH"),
      streamId: replayFingerprint,
      timeframe: replayId,
      eventAt: timestamp,
      final: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("SNAPSHOT"),
      streamId: replayFingerprint,
      timeframes: z.array(replayId).min(1).max(32),
      includeIncomplete: z.boolean(),
    })
    .strict(),
]);
export const taskSchema = z
  .object({ taskId: replayId, dueAt: timestamp, action: taskActionSchema })
  .strict();
export const taskPhase = (t: ReplayTaskDescriptor) =>
  ({ FENCE: 0, LOSS: 0, WATERMARK: 1, PUBLISH: 2, SNAPSHOT: 3 })[t.action.kind];
const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const taskOrder = (a: ReplayTaskDescriptor, b: ReplayTaskDescriptor) =>
  ordinal(a.dueAt, b.dueAt) || taskPhase(a) - taskPhase(b) || ordinal(a.taskId, b.taskId);
const shape = z
  .object({
    sessionId: replayId,
    specificationVersion: z.literal(1),
    replayMode: z.enum(["VERIFIED_POINT_IN_TIME", "EVENT_TIME_RECONSTRUCTION"]),
    sourceManifestIds: z.array(replayId).min(1).max(128),
    datasetFingerprints: z.array(replayFingerprint).min(1).max(128),
    instrumentScope: z.array(schemas.instrumentId).min(1).max(128),
    sourceScope: z.array(schemas.sourceId).min(1).max(128),
    channelScope: z.array(replayId).min(1).max(128),
    startTime: timestamp,
    endTime: timestamp,
    clockMode: z.literal("REPLAY"),
    orderingPolicy: z.literal("AVAILABILITY_SOURCE_IDENTITY_V1"),
    availabilityPolicy: z.enum(["EVIDENCE_REQUIRED", "EXPLICIT_RECONSTRUCTION"]),
    continuityPolicy: z.enum(["FENCE_GAPS", "FAIL_ON_GAP"]),
    qualityPolicy: z.literal("PRESERVE_REFERENCES"),
    calendarFingerprint: replayFingerprint,
    configurationFingerprint: replayFingerprint,
    softwareIdentity: replayId,
    checkpointPolicy: z.literal("EVERY_ATOMIC_BOUNDARY"),
    resourceLimits: z.unknown(),
    outputEvidencePolicy: z.literal("IMMUTABLE_RESEARCH_EVIDENCE"),
    researchOnly: z.literal(true),
    streams: z.array(replayStreamSchema).min(1).max(128),
    aggregation: z.unknown(),
    tasks: z.array(taskSchema).max(5000),
  })
  .strict();
export function createReplaySpecification(raw: unknown): ReplaySessionSpecification {
  const s = shape.parse(safeClone(raw, 1048576));
  const limits = validateReplayLimits(s.resourceLimits);
  if (
    s.startTime >= s.endTime ||
    (s.replayMode === "VERIFIED_POINT_IN_TIME") !== (s.availabilityPolicy === "EVIDENCE_REQUIRED")
  )
    throw Error("REPLAY_SPECIFICATION");
  const aggregation = s.aggregation as ReplayAggregationPolicy;
  const registry = new TimeframeRegistry(aggregation.timeframes);
  const calendar = new CalendarBoundaryResolver(aggregation.calendar);
  validateOptions(aggregation.options ?? defaultOptions);
  if (calendar.fingerprint !== s.calendarFingerprint) throw Error("CALENDAR_MISMATCH");
  if (
    s.tasks.length > limits.maxPendingTasks ||
    s.streams.length > 128 ||
    new Set(s.streams.map(hash)).size !== s.streams.length
  )
    throw Error("REPLAY_SCOPE");
  const ids = new Set(s.streams.map(hash));
  for (const stream of s.streams)
    if (
      !s.instrumentScope.includes(stream.instrumentId) ||
      !s.sourceScope.includes(stream.sourceId) ||
      !s.channelScope.includes(stream.channel)
    )
      throw Error("REPLAY_SCOPE");
  for (const task of s.tasks) {
    if (task.dueAt < s.startTime || task.dueAt > s.endTime) throw Error("TASK_RANGE");
    if ("streamId" in task.action && !ids.has(task.action.streamId)) throw Error("TASK_SCOPE");
    if (
      task.action.kind === "WATERMARK" &&
      (task.action.evidence.observedAt > task.dueAt ||
        task.action.evidence.through > task.action.evidence.observedAt)
    )
      throw Error("WATERMARK_AVAILABILITY");
    if (task.action.kind === "PUBLISH") registry.get(task.action.timeframe);
  }
  if (new Set(s.tasks.map((t) => t.taskId)).size !== s.tasks.length)
    throw Error("TASK_IDENTITY_CONFLICT");
  const sorted = <T extends string>(a: T[]) => {
    if (new Set(a).size !== a.length) throw Error("SPECIFICATION_DUPLICATE");
    return [...a].sort(ordinal);
  };
  const body = {
    ...s,
    sourceManifestIds: sorted(s.sourceManifestIds),
    datasetFingerprints: sorted(s.datasetFingerprints),
    instrumentScope: sorted(s.instrumentScope),
    sourceScope: sorted(s.sourceScope),
    channelScope: sorted(s.channelScope),
    resourceLimits: limits,
    aggregation,
    streams: [...s.streams].sort((a, b) => ordinal(hash(a), hash(b))),
    tasks: [...s.tasks].sort(taskOrder),
  };
  return freeze({ ...body, fingerprint: hash(body) });
}
export function verifyReplaySpecification(s: ReplaySessionSpecification): void {
  const { fingerprint, ...body } = s;
  if (createReplaySpecification(body).fingerprint !== fingerprint)
    throw Error("SPECIFICATION_INTEGRITY");
}

export function createGovernedReplaySpecification(
  raw: unknown,
  effective: EffectiveConfiguration,
): ReplaySessionSpecification {
  const governed = replayFromEffective(effective);
  if (!governed.enabled) throw Error("REPLAY_DISABLED");
  const candidate = createReplaySpecification(raw);
  if (
    candidate.configurationFingerprint !== governed.configurationFingerprint ||
    hash(candidate.resourceLimits) !== hash(governed.limits) ||
    candidate.orderingPolicy !== governed.orderingPolicy ||
    candidate.replayMode !== governed.mode ||
    candidate.continuityPolicy !== (governed.failOnSourceGap ? "FAIL_ON_GAP" : "FENCE_GAPS")
  )
    throw Error("GOVERNED_CONFIGURATION_MISMATCH");
  if (candidate.replayMode === "VERIFIED_POINT_IN_TIME" && !governed.requireAvailabilityEvidence)
    throw Error("VERIFIED_POLICY_WEAKENING");
  return candidate;
}
