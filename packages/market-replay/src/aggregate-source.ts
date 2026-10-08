import { canonicalBar, hash, safeClone } from "@ate/multitimeframe";
import type { AggregationEngine, SnapshotRequest, Stream } from "@ate/multitimeframe";
import { createReplayInputManifest, immutableReplayInputs } from "./input.js";
import type { ReplayLimits } from "./configuration.js";
import type { ReplayInputManifest, ReplayResolvedInputs } from "./types.js";

export type AggregateReplaySourceOptions = Readonly<{
  manifestId: string;
  engine: Pick<AggregationEngine, "snapshot" | "readRevision">;
  request: SnapshotRequest;
  stream: Stream;
  calendarFingerprint: string;
  expectedRevisionIds: readonly string[];
  limits: ReplayLimits;
}>;

/** Owner-selected committed revisions only; replay never projects or validates OHLC itself. */
export function resolveAggregateReplayInputs(
  o: AggregateReplaySourceOptions,
): ReplayResolvedInputs {
  const read = (): ReplayInputManifest => {
    const selected = o.engine.snapshot(o.request);
    if (!selected.ok) throw Error(selected.error.code);
    const snapshot = selected.value;
    if (
      snapshot.calendarFingerprint !== o.calendarFingerprint ||
      snapshot.sourceFingerprint !== o.stream.sourceFingerprint ||
      snapshot.streamId !== hash(o.stream)
    )
      throw Error("AGGREGATE_CONTEXT");
    const revisions = Object.values(snapshot.selected).sort((a, b) =>
      a.revisionId.localeCompare(b.revisionId),
    );
    if (
      !revisions.length ||
      revisions.length > o.limits.maxEventsPerSession ||
      hash(revisions.map((r) => r.revisionId)) !== hash([...o.expectedRevisionIds].sort())
    )
      throw Error("AGGREGATE_SELECTION");
    const records = revisions.map((revision) => {
      const owned = o.engine.readRevision(revision.revisionId);
      if (
        !owned ||
        hash(owned) !== hash(revision) ||
        hash(revision.stream) !== hash(o.stream) ||
        revision.availableAt > o.request.cutoff ||
        revision.publishedAt > o.request.cutoff ||
        revision.committedAt > revision.publishedAt ||
        revision.computedAt > revision.committedAt ||
        revision.window.calendarFingerprint !== o.calendarFingerprint
      )
        throw Error("AGGREGATE_INTEGRITY");
      // canonicalBar performs the existing bounded, self-contained quality handoff.
      const observation = canonicalBar(revision);
      return {
        input: {
          observation,
          identity: revision.revisionId,
          sessionId: snapshot.snapshotId,
          channel: o.stream.channel,
          origin: "HISTORICAL" as const,
          sourceFingerprint: o.stream.sourceFingerprint,
          artifactId: revision.revisionId,
          availability: revision.availability,
          sourcePublishedAt: revision.publishedAt,
          continuity:
            revision.coverage === "COMPLETE_COVERAGE"
              ? ("CONTINUOUS" as const)
              : ("UNKNOWN" as const),
          warnings: revision.ordering === "UNCERTAIN" ? ["SOURCE_CHRONOLOGY_UNCERTAIN"] : [],
        },
        evidence: {
          kind: "AGGREGATE_PUBLICATION" as const,
          availableAt: revision.availableAt,
          fingerprint: hash({
            revisionId: revision.revisionId,
            lineage: revision.lineageFingerprint,
            content: revision.contentFingerprint,
            quality: revision.quality,
            publishedAt: revision.publishedAt,
          }),
        },
      };
    });
    return createReplayInputManifest(
      {
        manifestId: o.manifestId,
        kind: "AGGREGATE",
        canonicalSchemaVersion: "1",
        sourceFingerprint: o.stream.sourceFingerprint,
        records,
        scopes: [o.stream],
        continuity: records.every((r) => r.input.continuity === "CONTINUOUS")
          ? "CONTINUOUS"
          : "UNKNOWN",
        qualityReferences: [],
        calendarFingerprint: o.calendarFingerprint,
        validation: "VALIDATED",
        originReference: snapshot.snapshotId,
        originFingerprint: hash(safeClone(snapshot, o.limits.maxInputBytes)),
      },
      o.limits,
    );
  };
  const manifest = read();
  return immutableReplayInputs([manifest], () =>
    Promise.resolve().then(() => {
      if (read().fingerprint !== manifest.fingerprint) throw Error("AGGREGATE_SOURCE_CHANGED");
    }),
  );
}
