import type { Context } from "@ate/instrument-eligibility";
import type { ReplayEventEnvelope, ReplaySessionSpecification } from "@ate/market-replay";
import { mustParseUtc } from "@ate/time";
import { planSchema, type Plan, type Source } from "./contracts.js";
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
