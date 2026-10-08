import { z } from "zod";
import {
  dataQualityFindingCategories,
  dataQualitySeverities,
  type DataQualityFindingId,
} from "@ate/data-quality";
import { marketObservationSchema, schemas } from "@ate/domain";
import { hash, freeze, safeClone } from "@ate/multitimeframe";
import { replayFingerprint, replayId, replayStreamSchema } from "./specification.js";
import type {
  ReplayInputManifest,
  ReplaySourceRecord,
  ReplayResolvedInputs,
  ReplayEventEnvelope,
  ReplaySessionSpecification,
} from "./types.js";
import type { ReplayLimits } from "./configuration.js";
const quality = z
  .object({
    reportId: replayId,
    reportFingerprint: replayFingerprint,
    findings: z
      .array(
        z
          .object({
            findingId: replayId.transform((v) => v as DataQualityFindingId),
            category: z.enum(dataQualityFindingCategories),
            severity: z.enum(dataQualitySeverities),
          })
          .strict(),
      )
      .max(64),
    suppressed: z.number().int().min(0).max(1000000),
  })
  .strict();
export const sourceRecordSchema = z
  .object({
    qualityAvailableAt: schemas.timestamp.optional(),
    input: z
      .object({
        observation: marketObservationSchema,
        identity: replayId,
        sessionId: replayId,
        channel: replayId,
        origin: z.enum(["REALTIME", "HISTORICAL", "FIXTURE"]),
        sourceFingerprint: replayFingerprint,
        artifactId: replayId,
        availability: z.enum(["VERIFIED", "UNKNOWN"]),
        sourcePublishedAt: schemas.timestamp.optional(),
        quality: quality.optional(),
        continuity: z.enum(["CONTINUOUS", "GAP", "UNKNOWN"]),
        orderingSequence: z
          .string()
          .regex(/^\d{1,40}$/u)
          .optional(),
        warnings: z.array(z.string().max(128)).max(64),
      })
      .strict(),
    evidence: z
      .object({
        kind: z.enum([
          "SOURCE_PUBLICATION",
          "RECORDED_RECEIPT",
          "AGGREGATE_PUBLICATION",
          "CANONICAL_FIXTURE",
        ]),
        availableAt: schemas.timestamp,
        fingerprint: replayFingerprint,
        qualityAvailableAt: schemas.timestamp.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const bodySchema = z
  .object({
    manifestId: replayId,
    kind: z.enum(["HISTORICAL", "CAPTURE", "FIXTURE", "AGGREGATE"]),
    canonicalSchemaVersion: z.literal("1"),
    sourceFingerprint: replayFingerprint,
    records: z.array(sourceRecordSchema).min(1).max(100000),
    scopes: z.array(replayStreamSchema).min(1).max(128),
    continuity: z.enum(["CONTINUOUS", "GAP", "UNKNOWN"]),
    qualityReferences: z.array(replayFingerprint).max(128),
    calendarFingerprint: replayFingerprint,
    validation: z.literal("VALIDATED"),
    originReference: replayId,
    originFingerprint: replayFingerprint,
  })
  .strict();
const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export function createReplayInputManifest(raw: unknown, limits: ReplayLimits): ReplayInputManifest {
  const body = bodySchema.parse(safeClone(raw, limits.maxInputBytes));
  if (body.records.length > limits.maxEventsPerSession) throw Error("INPUT_EVENT_LIMIT");
  const scopes = [...body.scopes].sort((a, b) => ordinal(hash(a), hash(b)));
  if (new Set(scopes.map(hash)).size !== scopes.length) throw Error("SOURCE_BINDING_CONFLICT");
  for (const r of body.records) {
    const o = r.input.observation;
    if (
      r.input.sourceFingerprint !== body.sourceFingerprint ||
      o.provenance.source.sourceId !== o.source.sourceId ||
      !scopes.some(
        (s) =>
          s.sourceId === o.source.sourceId &&
          s.instrumentId === o.instrumentId &&
          s.channel === r.input.channel &&
          s.sourceFingerprint === r.input.sourceFingerprint,
      )
    )
      throw Error("SOURCE_BINDING_CONFLICT");
    if (r.input.quality && !r.qualityAvailableAt && !r.evidence?.qualityAvailableAt)
      throw Error("QUALITY_AVAILABILITY_UNKNOWN");
    if (r.input.quality && !body.qualityReferences.includes(r.input.quality.reportFingerprint))
      throw Error("QUALITY_REFERENCE_MISSING");
  }
  const records = [...body.records].sort(
    (a, b) =>
      ordinal(a.input.observation.eventTime, b.input.observation.eventTime) ||
      ordinal(a.input.observation.observationId, b.input.observation.observationId) ||
      ordinal(hash(a), hash(b)),
  );
  const normalized = {
    ...body,
    scopes,
    records,
    qualityReferences: [...new Set(body.qualityReferences)].sort(ordinal),
  };
  return freeze({
    ...normalized,
    contentFingerprint: hash(records),
    fingerprint: hash(normalized),
  }) as unknown as ReplayInputManifest;
}
export function verifyReplayInputManifest(m: ReplayInputManifest, limits: ReplayLimits): void {
  const { fingerprint, contentFingerprint, ...body } = m;
  const expected = createReplayInputManifest(body, limits);
  if (expected.fingerprint !== fingerprint || expected.contentFingerprint !== contentFingerprint)
    throw Error("INPUT_MANIFEST_INTEGRITY");
}
export function immutableReplayInputs(
  manifests: readonly ReplayInputManifest[],
  verify: () => Promise<void> = () => Promise.resolve(),
): ReplayResolvedInputs {
  const sorted = [...manifests].sort((a, b) => ordinal(a.manifestId, b.manifestId));
  if (new Set(sorted.map((x) => x.manifestId)).size !== sorted.length)
    throw Error("MANIFEST_IDENTITY_CONFLICT");
  return Object.freeze({
    manifests: freeze(structuredClone(sorted)),
    fingerprint: hash(sorted.map((m) => ({ id: m.manifestId, fingerprint: m.fingerprint }))),
    verify,
  });
}
export class DeterministicReplaySequencer {
  public readonly events: readonly ReplayEventEnvelope[];
  public constructor(spec: ReplaySessionSpecification, inputs: ReplayResolvedInputs) {
    if (
      hash(inputs.manifests.map((m) => ({ id: m.manifestId, fingerprint: m.fingerprint }))) !==
      inputs.fingerprint
    )
      throw Error("INPUT_SET_INTEGRITY");
    if (
      hash(inputs.manifests.map((m) => m.manifestId).sort()) !== hash(spec.sourceManifestIds) ||
      hash(inputs.manifests.map((m) => m.contentFingerprint).sort()) !==
        hash(spec.datasetFingerprints)
    )
      throw Error("INPUT_SPECIFICATION_MISMATCH");
    const all: ReplayEventEnvelope[] = [];
    for (const m of inputs.manifests) {
      verifyReplayInputManifest(m, spec.resourceLimits);
      if (m.calendarFingerprint !== spec.calendarFingerprint) throw Error("CALENDAR_MISMATCH");
      for (const r of m.records) {
        const o = r.input.observation;
        if (
          !spec.sourceScope.includes(o.source.sourceId) ||
          !spec.instrumentScope.includes(o.instrumentId) ||
          !spec.channelScope.includes(r.input.channel) ||
          !spec.streams.some(
            (s) =>
              m.scopes.some((ms) => hash(ms) === hash(s)) &&
              s.sourceId === o.source.sourceId &&
              s.instrumentId === o.instrumentId &&
              s.channel === r.input.channel,
          )
        )
          throw Error("REPLAY_SCOPE");
        if (
          spec.replayMode === "VERIFIED_POINT_IN_TIME" &&
          (!r.evidence ||
            r.input.availability !== "VERIFIED" ||
            (r.input.quality && !r.evidence.qualityAvailableAt && !r.qualityAvailableAt))
        )
          throw Error("AVAILABILITY_UNVERIFIED");
        if (
          spec.continuityPolicy === "FAIL_ON_GAP" &&
          (r.input.continuity !== "CONTINUOUS" || m.continuity !== "CONTINUOUS")
        )
          throw Error("SOURCE_GAP");
        const at = [
          o.eventTime,
          ...(o.observationKind === "BAR" ? [o.intervalEnd] : []),
          ...(r.qualityAvailableAt ? [r.qualityAvailableAt] : []),
          ...(r.evidence?.qualityAvailableAt ? [r.evidence.qualityAvailableAt] : []),
          ...(r.evidence ? [r.evidence.availableAt] : []),
          ...(r.input.sourcePublishedAt ? [r.input.sourcePublishedAt] : []),
          ...(spec.replayMode === "VERIFIED_POINT_IN_TIME"
            ? [
                o.receivedAt,
                r.evidence!.availableAt,
                ...(r.input.sourcePublishedAt ? [r.input.sourcePublishedAt] : []),
              ]
            : []),
        ]
          .sort()
          .at(-1)!;
        if (at < spec.startTime || at > spec.endTime) throw Error("INPUT_TIME_RANGE");
        const payloadFingerprint = hash(r);
        const eventId = hash({
          manifestId: m.manifestId,
          observationId: o.observationId,
          payloadFingerprint,
        });
        all.push(
          freeze({
            eventId,
            manifestId: m.manifestId,
            manifestFingerprint: m.fingerprint,
            payloadFingerprint,
            sourceId: o.source.sourceId,
            instrumentId: o.instrumentId,
            channel: r.input.channel,
            observationId: o.observationId,
            eventAt: o.eventTime,
            ...(r.evidence ? { availableAt: r.evidence.availableAt } : {}),
            eligibilityAt: at,
            sourceCursor: hash({ manifestId: m.manifestId, observationId: o.observationId }),
            ordering: r.input.orderingSequence ? "EVIDENCED" : "SYNTHETIC_UNCERTAIN",
            record: r,
          }),
        );
      }
    }
    if (all.length > spec.resourceLimits.maxEventsPerSession) throw Error("INPUT_EVENT_LIMIT");
    const seen = new Map<string, string>();
    const unique = new Map<string, ReplayEventEnvelope>();
    for (const e of all) {
      const key = hash({
        source: e.sourceId,
        instrument: e.instrumentId,
        channel: e.channel,
        id: e.observationId,
      });
      const old = seen.get(key);
      if (old && old !== e.payloadFingerprint) throw Error("CONFLICTING_DUPLICATE");
      seen.set(key, e.payloadFingerprint);
      unique.set(e.eventId, e);
    }
    const ordered = [...unique.values()].sort(
      (a, b) =>
        ordinal(a.eligibilityAt, b.eligibilityAt) ||
        ordinal(a.eventAt, b.eventAt) ||
        ordinal(a.sourceId, b.sourceId) ||
        ordinal(a.instrumentId, b.instrumentId) ||
        ordinal(a.channel, b.channel) ||
        Number(Boolean(b.record.input.orderingSequence)) -
          Number(Boolean(a.record.input.orderingSequence)) ||
        compareSequence(a, b) ||
        ordinal(a.observationId, b.observationId) ||
        ordinal(a.eventId, b.eventId),
    );
    const cohorts = new Map<string, ReplayEventEnvelope[]>();
    for (const e of ordered) {
      const k = e.eligibilityAt + e.eventAt;
      const cohort = cohorts.get(k) ?? [];
      cohort.push(e);
      cohorts.set(k, cohort);
    }
    const uncertain = new Set<string>();
    for (const cohort of cohorts.values()) {
      const sources = new Set(cohort.map((e) => e.sourceId));
      const sequences = new Set<string>();
      let ambiguous = sources.size > 1;
      for (const e of cohort) {
        const sequence = e.record.input.orderingSequence;
        if (!sequence || sequences.has(BigInt(sequence).toString())) ambiguous = true;
        if (sequence) sequences.add(BigInt(sequence).toString());
      }
      if (ambiguous) for (const e of cohort) uncertain.add(e.eventId);
    }
    this.events = freeze(
      ordered.map((e) => ({
        ...e,
        ordering: uncertain.has(e.eventId) ? "SYNTHETIC_UNCERTAIN" : e.ordering,
      })),
    );
  }
}
function compareSequence(a: ReplayEventEnvelope, b: ReplayEventEnvelope) {
  const x = a.record.input.orderingSequence,
    y = b.record.input.orderingSequence;
  if (!x || !y) return 0;
  return BigInt(x) < BigInt(y) ? -1 : BigInt(x) > BigInt(y) ? 1 : 0;
}
export type ReplayInputResolver = Readonly<{ resolve: () => Promise<ReplayResolvedInputs> }>;
export type ReplayEligibilityValidator = DeterministicReplaySequencer;
export type ReplayCanonicalRecord = ReplaySourceRecord;
