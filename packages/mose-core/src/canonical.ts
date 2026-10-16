import type { Context } from "@ate/instrument-eligibility";
import type { ReplayEventEnvelope, ReplaySessionSpecification } from "@ate/market-replay";
import { mustParseUtc } from "@ate/time";
import { planSchema, type Plan, type Source, type Universe, type Reason } from "./contracts.js";
import { fingerprint } from "./primitives.js";

export type SourceBinding = Pick<
  Plan,
  | "datasetId"
  | "datasetVersion"
  | "datasetVersionFingerprint"
  | "datasetContentFingerprint"
  | "qualityReportId"
  | "qualityFingerprint"
>;

/** The same total order for live construction, per-source verification and recovery. */
export const comparePlans = (a: Plan, b: Plan) =>
  a.boundaryAt < b.boundaryAt
    ? -1
    : a.boundaryAt > b.boundaryAt
      ? 1
      : a.instrumentId < b.instrumentId
        ? -1
        : a.instrumentId > b.instrumentId
          ? 1
          : a.ownerOrdinal - b.ownerOrdinal;

/** Pure bounded derivation. All arguments come from checked owners, never retained plan fields. */
export function canonicalPlan(
  request: { instrumentId: string; source: Source },
  context: Context,
  events: readonly ReplayEventEnvelope[],
  mode: ReplaySessionSpecification["replayMode"],
  bindings: ReadonlyMap<string, SourceBinding>,
  maxRetained: number,
): Plan[] {
  if (events.length > maxRetained) throw Error("RESOURCE_BUDGET_EXCEEDED");
  const plans = events.map((event, ownerOrdinal) => {
    const binding = bindings.get(event.manifestId);
    if (!binding || !context.datasets.some((d) => d.instrumentId === event.instrumentId))
      throw Error("PROVENANCE_INCOMPLETE");
    const boundaryAt = mustParseUtc(
      [
        event.eligibilityAt,
        event.record.qualityAvailableAt,
        event.record.evidence?.qualityAvailableAt,
        event.record.input.sourcePublishedAt,
      ]
        .filter((v): v is NonNullable<typeof v> => v !== undefined)
        .sort()
        .at(-1)!,
    );
    const o = event.record.input.observation;
    return planSchema.parse({
      key: fingerprint({
        instrumentId: request.instrumentId,
        source: request.source,
        event: event.eventId,
      }),
      instrumentId: request.instrumentId,
      source: request.source,
      ...binding,
      eventId: event.eventId,
      sourceCursor: event.sourceCursor,
      ownerOrdinal,
      eventAt: event.eventAt,
      boundaryAt,
      timeframe: o.observationKind === "BAR" ? o.timeframe : "TICK",
      manifestId: event.manifestId,
      manifestFingerprint: event.manifestFingerprint,
      payloadFingerprint: event.payloadFingerprint,
      evidenceClass: mode,
    });
  });
  if (new Set(plans.map((p) => p.key)).size !== plans.length)
    throw Error("CANONICAL_PLAN_MISMATCH");
  return plans.sort(comparePlans);
}

const earlyFailureReasons: readonly Reason[] = [
  "INSTRUMENT_INELIGIBLE",
  "SOURCE_UNAVAILABLE",
  "TEMPORAL_INCONSISTENCY",
  "REPLAY_EVIDENCE_INVALID",
  "UNKNOWN_EVIDENCE",
];
const sourceFailureReasons: readonly Reason[] = [
  "SOURCE_UNAVAILABLE",
  "PROVENANCE_INCOMPLETE",
  "TEMPORAL_INCONSISTENCY",
  "REPLAY_EVIDENCE_INVALID",
  "UNKNOWN_EVIDENCE",
];
/** Owner exceptions cannot turn a downstream/affirmative code into an early exclusion proof. */
export function creationFailureReason(
  eligible: boolean,
  reason: Reason,
  confirmedExclusion = false,
): Reason {
  if (!eligible && reason === "INSTRUMENT_INELIGIBLE" && !confirmedExclusion)
    return "REPLAY_EVIDENCE_INVALID";
  return (eligible ? sourceFailureReasons : earlyFailureReasons).includes(reason)
    ? reason
    : "REPLAY_EVIDENCE_INVALID";
}

/**
 * Validate the joint state emitted by universe(), before selecting source duties.
 * This checks historical coherence, not today's eligibility or owner availability.
 * Source requests exist even for genuine exclusions; acquired context/authority do not.
 */
export function validateMemberState(member: Universe["members"][number], count: number): void {
  const authority =
    member.context !== null &&
    member.eligibilityVersion !== null &&
    member.eligibilityAssessment !== null;
  if (!member.eligible) {
    if (
      member.included ||
      member.sourceReady ||
      count !== 0 ||
      member.expected !== null ||
      member.context !== null ||
      member.eligibilityVersion !== null ||
      member.eligibilityAssessment !== null ||
      member.inputFingerprint !== null ||
      member.reasons.length !== 1 ||
      !earlyFailureReasons.includes(member.reasons[0]!)
    )
      throw Error("CANONICAL_PLAN_MISMATCH");
    return;
  }
  if (!authority) throw Error("CANONICAL_PLAN_MISMATCH");
  if (!member.sourceReady) {
    // Failure can precede source resolution or follow it (e.g. failed origin binding).
    // Therefore a successfully acquired input fingerprint may legitimately remain.
    if (
      member.included ||
      count !== 0 ||
      member.expected !== null ||
      member.reasons.length !== 1 ||
      !sourceFailureReasons.includes(member.reasons[0]!)
    )
      throw Error("CANONICAL_PLAN_MISMATCH");
    return;
  }
  if (
    !member.included ||
    member.reasons.length !== 0 ||
    member.inputFingerprint === null ||
    member.expected === null ||
    member.expected !== count
  )
    throw Error("CANONICAL_PLAN_MISMATCH");
}

/** Historical classification only: current availability cannot rewrite a retained universe. */
export function classifyMember(member: Universe["members"][number]) {
  if (!member.eligible)
    return member.reasons.length === 1 && member.reasons[0] === "INSTRUMENT_INELIGIBLE"
      ? ("CONFIRMED_EXCLUSION" as const)
      : ("ELIGIBILITY_UNRESOLVED" as const);
  return member.sourceReady
    ? ("ELIGIBLE_SOURCE_READY" as const)
    : ("ELIGIBLE_SOURCE_UNREADY" as const);
}
export const unresolvedMember = (member: Universe["members"][number]) => {
  const classification = classifyMember(member);
  return (
    classification === "ELIGIBILITY_UNRESOLVED" || classification === "ELIGIBLE_SOURCE_UNREADY"
  );
};
