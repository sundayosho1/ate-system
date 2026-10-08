import { marketObservationSchema } from "@ate/domain";
import type { MarketObservation } from "@ate/domain";
import {
  canonicalObservationOrder,
  fingerprint as historicalFingerprint,
} from "@ate/historical-data";
import type {
  HistoricalDatasetRepository,
  HistoricalDatasetId,
  HistoricalDatasetManifest,
} from "@ate/historical-data";
import type { DataQualityReportRepository, DataQualityReportId } from "@ate/data-quality";
import type { DatasetCatalogueRepository, DatasetVersionId } from "@ate/dataset-catalogue";
import type { FilesystemCaptureRepository } from "@ate/realtime-data";
import { hash, safeClone, realtimeInput, qualityEvidence } from "@ate/multitimeframe";
import type { Stream } from "@ate/multitimeframe";
import { createReplayInputManifest, immutableReplayInputs } from "./input.js";
import type { ReplayLimits } from "./configuration.js";
import type { AvailabilityEvidence, ReplayInputManifest, ReplayResolvedInputs } from "./types.js";
const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: { code: string } }): T => {
  if (!r.ok) throw Error(r.error.code);
  return r.value;
};
export type HistoricalReplaySourceOptions = Readonly<{
  manifestId: string;
  repository: HistoricalDatasetRepository;
  datasetId: HistoricalDatasetId;
  stream: Stream;
  calendarFingerprint: string;
  limits: ReplayLimits;
  availability?: (observation: MarketObservation) => AvailabilityEvidence | undefined;
  quality?: Readonly<{
    repository: DataQualityReportRepository;
    reportId: DataQualityReportId;
    expectedFingerprint: string;
  }>;
  catalogue?: Readonly<{
    repository: DatasetCatalogueRepository;
    versionId: DatasetVersionId;
    expectedVersionFingerprint: string;
  }>;
}>;
// Resolve through the owner API, checking both pagination and the owner's full-content
// fingerprint. Each command rechecks immutable inputs, including mutable in-memory repositories.
export async function resolveHistoricalReplayInputs(
  o: HistoricalReplaySourceOptions,
): Promise<ReplayResolvedInputs> {
  const read = async (): Promise<ReplayInputManifest> => {
    const manifest = safeClone(
      unwrap(await o.repository.getManifest(o.datasetId)),
      o.limits.maxInputBytes,
    ) as HistoricalDatasetManifest;
    // Manifest fields are validated by their owner/content checks below; do not infer qualification.
    if (
      manifest.datasetId !== o.datasetId ||
      manifest.canonicalSchemaVersion !== "1" ||
      !Number.isSafeInteger(manifest.observationCount) ||
      manifest.observationCount < 1 ||
      manifest.observationCount > o.limits.maxEventsPerSession
    )
      throw Error("HISTORICAL_MANIFEST");
    const observations: MarketObservation[] = [];
    let inputBytes = 0;
    let cursor: string | undefined;
    do {
      const page = unwrap(
        await o.repository.query({
          datasetId: o.datasetId,
          limit: o.limits.maxEventsPerBatch,
          ...(cursor ? { cursor } : {}),
        }),
      );
      if (
        page.observations.length > o.limits.maxEventsPerBatch ||
        observations.length + page.observations.length > manifest.observationCount
      )
        throw Error("HISTORICAL_PAGE_LIMIT");
      for (const observation of page.observations) {
        const parsed = marketObservationSchema.parse(
          safeClone(observation, o.limits.maxInputBytes),
        );
        inputBytes += Buffer.byteLength(JSON.stringify(parsed));
        if (inputBytes > o.limits.maxInputBytes) throw Error("HISTORICAL_INPUT_BYTES");
        observations.push(parsed);
      }
      if (
        page.nextCursor !== undefined &&
        (!page.observations.length || page.nextCursor !== String(observations.length))
      )
        throw Error("HISTORICAL_CURSOR");
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    if (
      observations.length !== manifest.observationCount ||
      new Set(observations.map((x) => x.observationId)).size !== observations.length ||
      historicalFingerprint([...observations].sort(canonicalObservationOrder)) !==
        manifest.contentFingerprint ||
      hash(unwrap(await o.repository.getManifest(o.datasetId))) !== hash(manifest)
    )
      throw Error("HISTORICAL_CONTENT_INTEGRITY");
    const report = o.quality
      ? unwrap(await o.quality.repository.getReport(o.quality.reportId))
      : undefined;
    if (
      report &&
      (report.datasetId !== o.datasetId ||
        report.datasetContentFingerprint !== manifest.contentFingerprint ||
        report.reportFingerprint !== o.quality!.expectedFingerprint)
    )
      throw Error("QUALITY_BINDING");
    if (o.catalogue) {
      const version = unwrap(await o.catalogue.repository.getVersion(o.catalogue.versionId));
      if (
        version.versionFingerprint !== o.catalogue.expectedVersionFingerprint ||
        version.historicalManifest?.datasetId !== o.datasetId ||
        version.historicalManifest.contentFingerprint !== manifest.contentFingerprint ||
        ["INVALIDATED", "QUARANTINED", "RETIRED"].includes(version.lifecycleState)
      )
        throw Error("CATALOGUE_BINDING");
    }
    const records = observations.map((observation) => {
      const evidence = o.availability?.(observation);
      return {
        ...(report ? { qualityAvailableAt: report.generatedAt } : {}),
        input: {
          observation,
          identity: observation.observationId,
          sessionId: o.datasetId,
          channel: o.stream.channel,
          origin: "HISTORICAL" as const,
          sourceFingerprint: o.stream.sourceFingerprint,
          artifactId: o.datasetId,
          availability: evidence ? ("VERIFIED" as const) : ("UNKNOWN" as const),
          continuity: "UNKNOWN" as const,
          warnings: [],
          ...(report ? { quality: qualityEvidence(report) } : {}),
        },
        ...(evidence
          ? {
              evidence: {
                ...evidence,
                ...(report ? { qualityAvailableAt: report.generatedAt } : {}),
              },
            }
          : {}),
      };
    });
    return createReplayInputManifest(
      {
        manifestId: o.manifestId,
        kind: "HISTORICAL",
        canonicalSchemaVersion: "1",
        sourceFingerprint: o.stream.sourceFingerprint,
        records,
        scopes: [o.stream],
        continuity: "UNKNOWN",
        qualityReferences: report ? [report.reportFingerprint] : [],
        calendarFingerprint: o.calendarFingerprint,
        validation: "VALIDATED",
        originReference: o.datasetId,
        originFingerprint: hash(manifest),
      },
      o.limits,
    );
  };
  const manifest = await read();
  return immutableReplayInputs([manifest], async () => {
    if ((await read()).fingerprint !== manifest.fingerprint)
      throw Error("HISTORICAL_SOURCE_CHANGED");
  });
}
export async function resolveCaptureReplayInputs(
  o: Readonly<{
    manifestId: string;
    repository: Pick<FilesystemCaptureRepository, "verify" | "readRecords">;
    captureId: string;
    scopes: readonly Stream[];
    sourceFingerprint: string;
    calendarFingerprint: string;
    limits: ReplayLimits;
  }>,
): Promise<ReplayResolvedInputs> {
  const read = (): ReplayInputManifest => {
    const handoff = unwrap(o.repository.verify(o.captureId));
    const manifest = handoff.manifest;
    if (
      manifest.count < 1 ||
      manifest.count > o.limits.maxEventsPerSession ||
      manifest.bytes > o.limits.maxInputBytes
    )
      throw Error("CAPTURE_INPUT_LIMIT");
    const records = [];
    let cursor: number | undefined;
    do {
      const page = unwrap(
        o.repository.readRecords(o.captureId, o.limits.maxEventsPerBatch, cursor ?? 0),
      );
      if (
        page.records.length > o.limits.maxEventsPerBatch ||
        records.length + page.records.length > manifest.count
      )
        throw Error("CAPTURE_PAGE_LIMIT");
      for (const accepted of page.records) {
        const input = realtimeInput(accepted, o.sourceFingerprint, o.captureId);
        records.push({
          input,
          evidence: {
            kind: "RECORDED_RECEIPT" as const,
            availableAt: accepted.processedAt,
            fingerprint: hash(accepted.ingress),
          },
        });
      }
      if (
        page.nextCursor !== undefined &&
        (!page.records.length || page.nextCursor !== records.length)
      )
        throw Error("CAPTURE_CURSOR");
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    if (
      records.length !== manifest.count ||
      hash(unwrap(o.repository.verify(o.captureId)).manifest) !== hash(manifest)
    )
      throw Error("CAPTURE_CHANGED");
    return createReplayInputManifest(
      {
        manifestId: o.manifestId,
        kind: "CAPTURE",
        canonicalSchemaVersion: "1",
        sourceFingerprint: o.sourceFingerprint,
        records,
        scopes: o.scopes,
        continuity: "UNKNOWN",
        qualityReferences: [],
        calendarFingerprint: o.calendarFingerprint,
        validation: "VALIDATED",
        originReference: o.captureId,
        originFingerprint: hash(manifest),
      },
      o.limits,
    );
  };
  const manifest = await Promise.resolve(read());
  return immutableReplayInputs([manifest], () => {
    if (read().fingerprint !== manifest.fingerprint)
      return Promise.reject(Error("CAPTURE_CHANGED"));
    return Promise.resolve();
  });
}
