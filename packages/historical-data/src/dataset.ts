import type { MarketObservation } from "@ate/domain";
import type { Clock } from "@ate/time";

import { fingerprint, sha256Bytes, stableStringify } from "./serialization.js";
import type {
  DuplicateEvidence,
  HistoricalDataset,
  HistoricalDatasetId,
  HistoricalDatasetManifest,
  HistoricalImportPlan,
  HistoricalPartitionId,
  HistoricalPartitionManifest,
  HistoricalRejectionRecord,
} from "./types.js";

export const canonicalObservationOrder = (
  left: MarketObservation,
  right: MarketObservation,
): number =>
  left.eventTime.localeCompare(right.eventTime) ||
  left.instrumentId.localeCompare(right.instrumentId) ||
  left.observationKind.localeCompare(right.observationKind) ||
  sequenceKey(left).localeCompare(sequenceKey(right)) ||
  left.observationId.localeCompare(right.observationId);

export const buildHistoricalDataset = (input: {
  plan: HistoricalImportPlan;
  observations: readonly MarketObservation[];
  rejections: readonly HistoricalRejectionRecord[];
  duplicateEvidence: readonly DuplicateEvidence[];
  clock: Clock;
}): HistoricalDataset => {
  const observations = [...input.observations].sort(canonicalObservationOrder);
  const contentFingerprint = fingerprint(observations.map((observation) => observation));
  const datasetId =
    `hds-${contentFingerprint.replace("sha256:", "").slice(0, 32)}` as HistoricalDatasetId;
  const partitions = buildPartitions(datasetId, observations);
  const times = observations.map((observation) => observation.eventTime).sort();
  const firstEventTime = times[0];
  const lastEventTime = times[times.length - 1];
  const manifest: HistoricalDatasetManifest = {
    datasetId,
    artifactId: input.plan.artifact.artifactId,
    artifactChecksum: input.plan.artifact.checksum,
    importPlanFingerprint: input.plan.planFingerprint,
    canonicalSchemaVersion: input.plan.canonicalSchemaVersion,
    createdAt: input.clock.now(),
    observationCount: observations.length,
    rejectionCount: input.rejections.length,
    observationKinds: unique(observations.map((observation) => observation.observationKind)),
    instrumentIds: unique(observations.map((observation) => observation.instrumentId)),
    ...(firstEventTime === undefined ? {} : { firstEventTime }),
    ...(lastEventTime === undefined ? {} : { lastEventTime }),
    timeframes: unique(
      observations
        .filter((observation) => observation.observationKind === "BAR")
        .map((observation) => stableStringify(observation.timeframe)),
    ),
    sourceRefs: unique(observations.map((observation) => observation.source.sourceId)),
    partitionScheme: "instrument-kind-utc-date",
    contentFingerprint,
    completenessStatus: input.rejections.length === 0 ? "COMPLETE" : "COMPLETED_WITH_REJECTIONS",
    partitions,
    provenanceRefs: [input.plan.artifact.artifactId, input.plan.planId],
  };
  return {
    manifest,
    observations,
    rejections: input.rejections,
    duplicateEvidence: input.duplicateEvidence,
  };
};

const buildPartitions = (
  datasetId: HistoricalDatasetId,
  observations: readonly MarketObservation[],
): readonly HistoricalPartitionManifest[] => {
  const groups = new Map<string, MarketObservation[]>();
  for (const observation of observations) {
    const key = `${observation.instrumentId}/${observation.observationKind}/${observation.eventTime.slice(0, 10)}`;
    groups.set(key, [...(groups.get(key) ?? []), observation]);
  }
  return Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, rows]) => {
      const sorted = [...rows].sort(canonicalObservationOrder);
      const times = sorted.map((observation) => observation.eventTime).sort();
      const first = sorted[0];
      const firstTime = times[0];
      const lastTime = times[times.length - 1];
      const partitionId =
        `hpart-${fingerprint({ datasetId, key }).replace("sha256:", "").slice(0, 32)}` as HistoricalPartitionId;
      return {
        partitionId,
        datasetId,
        key,
        ...(first === undefined ? {} : { instrumentId: first.instrumentId }),
        ...(first === undefined ? {} : { observationKind: first.observationKind }),
        ...(first === undefined ? {} : { dateBucket: first.eventTime.slice(0, 10) }),
        rowCount: sorted.length,
        ...(firstTime === undefined ? {} : { firstEventTime: firstTime }),
        ...(lastTime === undefined ? {} : { lastEventTime: lastTime }),
        checksum: sha256Bytes(new TextEncoder().encode(stableStringify(sorted))),
        storageRef: `${key}/observations.jsonl`,
      };
    });
};

const sequenceKey = (observation: MarketObservation): string => {
  if (observation.sequence === undefined || observation.sequence.scope === "UNKNOWN") {
    return "";
  }
  return `${observation.sequence.scope}:${observation.sequence.scopeId ?? ""}:${observation.sequence.sequence}`;
};

const unique = <T extends string>(values: readonly T[]): readonly T[] =>
  Array.from(new Set(values)).sort();
