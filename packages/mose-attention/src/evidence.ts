import {
  observationSchema,
  checkpointSchema as moseCheckpointSchema,
  universeSchema,
  type MOSECoreRuntime,
  type MOSEPorts,
} from "@ate/mose-core";
import { DeterministicReplaySequencer } from "@ate/market-replay";
import {
  assessmentSchema as eligibilityAssessmentSchema,
  contextSchema,
  type InstrumentEligibility,
} from "@ate/instrument-eligibility";
import { z } from "zod";
import type { AttentionPolicy, Evidence, Subject } from "./contracts.js";
import { fingerprint, unwrap, clone } from "./primitives.js";
export interface EvidencePorts {
  mose: Pick<MOSECoreRuntime, "getUniverse" | "getSessionSummary" | "query" | "health">;
  eligibility: Pick<InstrumentEligibility, "getEligibility">;
  replayEvidence: MOSEPorts["replayEvidence"];
}
export async function ownerEvidence(
  ports: EvidencePorts,
  subject: Subject,
  at: string,
  now: string,
  p: AttentionPolicy,
  call: () => void,
): Promise<Evidence> {
  call();
  const u = universeSchema.parse(
    clone(unwrap(ports.mose.getUniverse(subject.sessionId)), p.maxCheckpointBytes),
  );
  const { fingerprint: universeFingerprint, ...universeBody } = u;
  if (fingerprint(universeBody) !== universeFingerprint) throw Error("UNIVERSE_INTEGRITY");
  if (u.fingerprint !== subject.universe) throw Error("SUBJECT_MISMATCH");
  const member = u.members.find((m) => m.instrumentId === subject.instrumentId);
  if (!member?.included || !member.context) throw Error("INSTRUMENT_INELIGIBLE");
  call();
  const health = z
    .object({
      readiness: z.string(),
      health: z.enum(["HEALTHY", "DEGRADED"]),
      sourceReadinessAxes: z.array(
        z
          .object({
            scope: z.string(),
            dataSourceReady: z.boolean(),
            eligibilityReady: z.boolean(),
            universeAuthority: z.boolean(),
            checkedAt: z.string(),
          })
          .passthrough(),
      ),
    })
    .passthrough()
    .parse(unwrap(await ports.mose.health()));
  const scope =
    JSON.stringify([subject.sessionId, subject.instrumentId]) + ":" + subject.instrumentId;
  const axis = health.sourceReadinessAxes.find((a) => a.scope === scope);
  if (
    health.readiness !== "READY" ||
    !axis?.dataSourceReady ||
    !axis.eligibilityReady ||
    !axis.universeAuthority ||
    axis.checkedAt !== now
  )
    throw Error("SOURCE_UNAVAILABLE");
  call();
  const summary = z
    .object({
      currentPublicationAuthority: z.string(),
      canonicalVerification: z.string(),
      unresolvedSources: z.number(),
    })
    .passthrough()
    .parse(unwrap(ports.mose.getSessionSummary(subject.sessionId)));
  if (
    summary.currentPublicationAuthority === "RESTRICTED" ||
    summary.canonicalVerification !== "VERIFIED" ||
    summary.unresolvedSources > 0
  )
    throw Error("PROVENANCE_INCOMPLETE");
  call();
  const eligible = unwrap(await ports.eligibility.getEligibility(subject.instrumentId)) as Record<
    string,
    unknown
  >;
  const current = eligibilityAssessmentSchema.parse(clone(eligible.current, p.maxCheckpointBytes));
  const recorded = z
    .object({ context: contextSchema, version: z.string() })
    .passthrough()
    .parse(clone(eligible.recorded, p.maxCheckpointBytes));
  if (current.evaluatedAt !== now) throw Error("CURRENT_AUTHORITY_TIME_MISMATCH");
  if (
    recorded.instrumentId !== subject.instrumentId ||
    current.source !== recorded.stage ||
    current.fingerprint !==
      fingerprint(
        Object.fromEntries(Object.entries(current).filter(([key]) => key !== "fingerprint")),
      ) ||
    fingerprint(recorded.context) !== fingerprint(member.context) ||
    recorded.version !== member.eligibilityVersion ||
    current.contextFingerprint !== fingerprint(member.context) ||
    !current.replayReproducible ||
    !current.capabilities.find((c) => c.capability === u.policy.capability)?.allowed ||
    current.evaluatedAt !== now
  )
    throw Error("INSTRUMENT_INELIGIBLE");
  const observations = [];
  for (let offset = 0, pages = 0; ; offset += p.maxQueryResults) {
    if (++pages > p.maxQueryPages) throw Error("ENUMERATION_INCOMPLETE");
    call();
    const response = z
      .object({
        value: z
          .object({ records: z.array(observationSchema), total: z.number().int().nonnegative() })
          .passthrough(),
      })
      .passthrough()
      .parse(
        clone(
          unwrap(
            ports.mose.query({
              sessionId: subject.sessionId,
              kind: "OBSERVATIONS",
              offset,
              limit: p.maxQueryResults,
              asOf: at,
            }),
          ),
          p.maxCheckpointBytes,
        ),
      );
    observations.push(...response.value.records);
    if (offset + response.value.records.length >= response.value.total) break;
    if (response.value.records.length === 0) throw Error("ENUMERATION_INCOMPLETE");
  }
  const o = observations
    .filter(
      (o) =>
        o.instrumentId === subject.instrumentId &&
        o.outcome === "ADMITTED" &&
        o.qualityDisposition === "PRESERVED" &&
        o.processingTime !== null &&
        o.processingTime <= at &&
        o.receivedAt <= at &&
        o.plan.boundaryAt <= at,
    )
    .sort((a, b) => a.sequence - b.sequence)
    .at(-1);
  if (!o || !o.funnelEvent || o.funnelEvent.newStage !== "OBSERVED")
    throw Error("INSUFFICIENT_EVIDENCE");
  if (Date.parse(at) - Date.parse(o.plan.eventAt) > u.policy.maxEvidenceAgeMs)
    throw Error("EVIDENCE_STALE");
  if (o.plan.evidenceClass !== "VERIFIED_POINT_IN_TIME") throw Error("PROVENANCE_INCOMPLETE");
  call();
  const replay = ports.replayEvidence(o.plan.source.sessionId, o.plan.source.checkpoint);
  if (!replay) throw Error("SOURCE_UNAVAILABLE");
  if (replay.inputs.fingerprint !== member.inputFingerprint) throw Error("SOURCE_MISMATCH");
  if (replay.inputs.manifests.length > p.maxEvidenceRefs) throw Error("EVIDENCE_LIMIT");
  if (replay.inputs.manifests.reduce((n, m) => n + m.records.length, 0) > u.policy.maxRetained)
    throw Error("RESOURCE_LIMIT");
  const events = new DeterministicReplaySequencer(replay.specification, replay.inputs).events;
  if (events.length > u.policy.maxRetained) throw Error("RESOURCE_LIMIT");
  const event = events.find((e) => e.eventId === o.plan.eventId);
  if (
    !event ||
    event.payloadFingerprint !== o.plan.payloadFingerprint ||
    event.eligibilityAt > at ||
    o.plan.eventAt > at
  )
    throw Error("TEMPORAL_INCONSISTENCY");
  if (
    !event.record.input.quality ||
    event.record.input.quality.findings.some((f) => ["ERROR", "CRITICAL"].includes(f.severity))
  )
    throw Error("DATA_QUALITY_FAILED");
  const isBar = event.record.input.observation.observationKind === "BAR";
  if (isBar) {
    const snap = replay.checkpoint.snapshots.filter((s) => s.logicalTime <= at).at(-1),
      rev = snap?.aggregation.selected[o.plan.timeframe];
    if (
      !rev ||
      !rev.final ||
      rev.coverage !== "COMPLETE_COVERAGE" ||
      rev.availableAt > at ||
      rev.window.end > at ||
      !snap ||
      snap.aggregation.cutoff > at
    )
      throw Error("TEMPORAL_NOT_READY");
  }
  const historyPage = (offset: number) => {
    call();
    return z
      .object({
        value: z
          .object({ records: z.array(moseCheckpointSchema), total: z.number().int().nonnegative() })
          .passthrough(),
      })
      .passthrough()
      .parse(
        clone(
          unwrap(
            ports.mose.query({
              sessionId: subject.sessionId,
              kind: "HISTORY",
              offset,
              limit: 1,
              asOf: at,
            }),
          ),
          p.maxCheckpointBytes,
        ),
      );
  };
  const first = historyPage(0);
  if (first.value.total < 1) throw Error("PUBLICATION_UNESTABLISHED");
  const publication = historyPage(first.value.total - 1).value.records[0];
  if (
    !publication ||
    publication.at > at ||
    publication.fingerprint !==
      fingerprint(
        Object.fromEntries(Object.entries(publication).filter(([key]) => key !== "fingerprint")),
      )
  )
    throw Error("PUBLICATION_UNESTABLISHED");
  const published = publication.state.sessions
    .find((s) => s.universe.fingerprint === subject.universe)
    ?.observations.find((row) => row.observationId === o.observationId);
  if (!published || fingerprint(published) !== fingerprint(o))
    throw Error("PUBLICATION_UNESTABLISHED");
  return {
    ownerHealth: health.health,
    sourceScopeHealthy: true,
    owner: "MOSE_CORE",
    ownerVersion: "0.25.0-mose-core.1",
    recordFingerprint: fingerprint(o),
    publication: {
      runtimeId: publication.runtimeId,
      generation: publication.generation,
      fingerprint: publication.fingerprint,
    },
    lineage: o.plan,
    replayInputFingerprint: replay.inputs.fingerprint,
    observationId: o.observationId,
    dependency: fingerprint([
      o.plan.payloadFingerprint,
      o.plan.qualityFingerprint,
      o.plan.datasetVersionFingerprint,
    ]),
    availableAt: o.processingTime!,
    eventAt: o.plan.eventAt,
    source: fingerprint(o.plan.source),
    policy: u.policyFingerprint,
    finality: isBar ? "FINAL" : "NOT_APPLICABLE",
  };
}
