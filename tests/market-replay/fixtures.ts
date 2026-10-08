import {
  hash,
  CalendarBoundaryResolver,
  utcCalendar,
  standardTimeframes,
  defaultOptions,
} from "@ate/multitimeframe";
import {
  createReplayInputManifest,
  createReplaySpecification,
  defaultReplayLimits,
  immutableReplayInputs,
  type ReplaySourceRecord,
  type ReplayMode,
  type ReplayTaskDescriptor,
} from "@ate/market-replay";
import { observation, stream, config, sourceFingerprint, t } from "../multitimeframe/fixtures.js";
export { t, observation, stream };
export function replayFixture(
  mode: ReplayMode = "EVENT_TIME_RECONSTRUCTION",
  records: readonly ReplaySourceRecord[] = [
    { input: observation(t("10:00:00"), 1) },
    { input: observation(t("10:00:00"), 2, "2") },
    { input: observation(t("10:01:00"), 3, "3") },
  ],
  tasks: readonly ReplayTaskDescriptor[] = [],
) {
  const calendarFingerprint = new CalendarBoundaryResolver(utcCalendar).fingerprint;
  const manifest = createReplayInputManifest(
    {
      manifestId: "fixture-1",
      kind: "FIXTURE",
      canonicalSchemaVersion: "1",
      sourceFingerprint,
      records,
      scopes: [stream],
      continuity: "CONTINUOUS",
      qualityReferences: [],
      calendarFingerprint,
      validation: "VALIDATED",
      originReference: "fixture-records",
      originFingerprint: hash(
        [...records].sort((a, b) =>
          a.input.observation.observationId < b.input.observation.observationId ? -1 : 1,
        ),
      ),
    },
    defaultReplayLimits,
  );
  const spec = createReplaySpecification({
    sessionId: "replay-1",
    specificationVersion: 1,
    replayMode: mode,
    sourceManifestIds: [manifest.manifestId],
    datasetFingerprints: [manifest.contentFingerprint],
    instrumentScope: [stream.instrumentId],
    sourceScope: [stream.sourceId],
    channelScope: [stream.channel],
    startTime: t("09:00:00"),
    endTime: t("12:00:00"),
    clockMode: "REPLAY",
    orderingPolicy: "AVAILABILITY_SOURCE_IDENTITY_V1",
    availabilityPolicy:
      mode === "VERIFIED_POINT_IN_TIME" ? "EVIDENCE_REQUIRED" : "EXPLICIT_RECONSTRUCTION",
    continuityPolicy: "FENCE_GAPS",
    qualityPolicy: "PRESERVE_REFERENCES",
    calendarFingerprint,
    configurationFingerprint: config,
    softwareIdentity: "0.19.0-market-replay.1",
    checkpointPolicy: "EVERY_ATOMIC_BOUNDARY",
    resourceLimits: defaultReplayLimits,
    outputEvidencePolicy: "IMMUTABLE_RESEARCH_EVIDENCE",
    researchOnly: true,
    streams: [stream],
    aggregation: {
      calendar: utcCalendar,
      timeframes: standardTimeframes(),
      directTimeframes: ["M1", "M5", "M15", "H1", "H4"],
      edges: [],
      options: { ...defaultOptions, enabled: true },
    },
    tasks,
  });
  return { manifest, spec, inputs: immutableReplayInputs([manifest]) };
}
