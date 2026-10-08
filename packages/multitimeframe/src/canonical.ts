import { barObservationSchema, schemas } from "@ate/domain";
import { freeze, hash } from "./primitives.js";
import { qualityHandoff } from "./quality-handoff.js";
import type { Revision } from "./types.js";
export const canonicalRevisionId = (hash: string) =>
  schemas.observationId.parse(
    `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`,
  );
/** Canonical observation projection; full lineage remains in immutable revision/checkpoint. */
export function canonicalBar(revision: Revision) {
  const source = revision.constituents[0]?.source;
  if (!source) throw Error("SOURCE_LINEAGE_MISSING");
  const price = (value: string) => ({
    value,
    instrumentId: revision.stream.instrumentId,
    quoteCurrency: revision.stream.priceCurrency,
  });
  return freeze(
    barObservationSchema.parse({
      schemaVersion: 1,
      observationKind: "BAR",
      observationId: canonicalRevisionId(revision.revisionId),
      instrumentId: revision.stream.instrumentId,
      source,
      eventTime: revision.window.start,
      receivedAt: revision.availableAt,
      timeframe: {
        kind: revision.timeframeDefinition.kind,
        code: revision.timeframe,
        ...(revision.timeframeDefinition.kind === "FIXED"
          ? { length: revision.timeframeDefinition.durationMs! / 1000, unit: "SECOND" }
          : {}),
      },
      intervalStart: revision.window.start,
      intervalEnd: revision.window.end,
      open: price(revision.open),
      high: price(revision.high),
      low: price(revision.low),
      close: price(revision.close),
      volumes:
        revision.volume === undefined
          ? [{ volumeType: "NOT_AVAILABLE" }]
          : [
              {
                volumeType: revision.stream.volumeType,
                quantity: { value: revision.volume, unit: revision.stream.volumeUnit },
              },
            ],
      completeness: revision.final ? "FINAL" : "FORMING",
      ...(revision.parentRevisionId
        ? { revisionOf: canonicalRevisionId(revision.parentRevisionId) }
        : {}),
      provenance: {
        source,
        origin: "DERIVED",
        transformation: {
          transformationId: "@ate/multitimeframe/aggregation-v1",
          transformationVersion: "1",
          transformedAt: revision.computedAt,
        },
        metadata: { "aggregation.lineagefingerprint": revision.lineageFingerprint },
      },
      qualityAnnotations: [
        ...(revision.parentRevisionId ? ["CORRECTION"] : []),
        ...(revision.coverage !== "COMPLETE_COVERAGE" ? ["INCOMPLETE_BAR"] : []),
      ],
      metadata: {
        "aggregation.pricebasis": revision.stream.basis,
        "aggregation.coverage": revision.coverage,
        "aggregation.revision": revision.revisionId,
        "aggregation.lineagefingerprint": revision.lineageFingerprint,
        "aggregation.configuration": revision.configurationFingerprint,
        "aggregation.qualityfingerprint": hash(revision.quality),
        "aggregation.evidencecount": String(revision.quality.length),
        ...qualityHandoff(revision),
      },
    }),
  );
}
