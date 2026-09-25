import type { MarketObservation } from "@ate/domain";

import { buildHistoricalDataset } from "./dataset.js";
import { fail, historicalError, ok } from "./errors.js";
import { detectHistoricalFormat } from "./format.js";
import { createHistoricalImportPlan } from "./mapping.js";
import { normalizeHistoricalRecord, rejectionFromError } from "./normalization.js";
import { createHistoricalSourceArtifact } from "./source-artifact.js";
import type {
  DuplicateEvidence,
  HistoricalError,
  HistoricalDatasetManifest,
  HistoricalImportRequest,
  HistoricalImportServiceInput,
  HistoricalImportSession,
  HistoricalImportSessionId,
  HistoricalPreview,
  HistoricalRejectionRecord,
  HistoricalResult,
  HistoricalImportStatistics,
  HistoricalResourceLimits,
} from "./types.js";
import { defaultHistoricalResourceLimits } from "./types.js";

export class HistoricalImportService {
  private readonly limits: HistoricalResourceLimits;
  private readonly recentImports: HistoricalImportSession[] = [];
  private readonly recentFailures: HistoricalError[] = [];
  private activeImports = 0;

  public constructor(private readonly input: HistoricalImportServiceInput) {
    this.limits = { ...defaultHistoricalResourceLimits, ...(input.limits ?? {}) };
  }

  public async dryRunImport(
    request: HistoricalImportRequest,
  ): Promise<HistoricalResult<HistoricalPreview>> {
    const prepared = await this.prepare(request);
    if (!prepared.ok) {
      return prepared;
    }
    const parser = this.parserFor(prepared.value.artifact.detectedFormat);
    if (!parser.ok) {
      return parser;
    }
    const observations: MarketObservation[] = [];
    const rejections: HistoricalRejectionRecord[] = [];
    const sessionId = sessionIdFromPlan(prepared.value.plan.planId, "dry-run");
    for await (const parsed of parser.value.parse(
      request.content,
      prepared.value.artifact,
      this.limits,
    )) {
      if (!parsed.ok) {
        return fail(parsed.error);
      }
      const normalized = normalizeHistoricalRecord({
        plan: prepared.value.plan,
        record: parsed.value,
        sessionId,
        clock: this.input.clock,
      });
      if (normalized.ok) {
        observations.push(normalized.value.observation);
      } else {
        rejections.push(
          rejectionFromError({
            sessionId,
            plan: prepared.value.plan,
            record: parsed.value,
            error: normalized.error,
            clock: this.input.clock,
          }),
        );
      }
      if (observations.length + rejections.length >= this.limits.maxPreviewRecords) {
        break;
      }
    }
    return ok({
      artifact: prepared.value.artifact,
      schema: prepared.value.schema,
      plan: prepared.value.plan,
      normalizedPreview: observations,
      rejections,
    });
  }

  public async importHistoricalData(
    request: HistoricalImportRequest,
  ): Promise<HistoricalResult<HistoricalImportSession>> {
    const prepared = await this.prepare(request);
    if (!prepared.ok) {
      this.recordFailure(prepared.error);
      return prepared;
    }
    const parser = this.parserFor(prepared.value.artifact.detectedFormat);
    if (!parser.ok) {
      this.recordFailure(parser.error);
      return parser;
    }
    const sessionId = sessionIdFromPlan(
      prepared.value.plan.planId,
      prepared.value.artifact.checksum,
    );
    const startedAt = this.input.clock.now();
    const observations: MarketObservation[] = [];
    const rejections: HistoricalRejectionRecord[] = [];
    const duplicateEvidence: DuplicateEvidence[] = [];
    const seenObservationIds = new Map<string, MarketObservation>();
    const seenSemantic = new Map<string, MarketObservation>();
    this.activeImports += 1;

    try {
      for await (const parsed of parser.value.parse(
        request.content,
        prepared.value.artifact,
        this.limits,
      )) {
        if (!parsed.ok) {
          return this.failSession(
            sessionId,
            prepared.value.plan.planId,
            prepared.value.artifact.artifactId,
            startedAt,
            parsed.error,
          );
        }
        const normalized = normalizeHistoricalRecord({
          plan: prepared.value.plan,
          record: parsed.value,
          sessionId,
          clock: this.input.clock,
        });
        if (!normalized.ok) {
          const rejection = rejectionFromError({
            sessionId,
            plan: prepared.value.plan,
            record: parsed.value,
            error: normalized.error,
            clock: this.input.clock,
          });
          rejections.push(rejection);
          if (
            shouldFailForRejection(
              prepared.value.plan.rejectionPolicy,
              rejections.length,
              observations.length + rejections.length,
            )
          ) {
            await this.input.repository.quarantine(rejections);
            return this.failSession(
              sessionId,
              prepared.value.plan.planId,
              prepared.value.artifact.artifactId,
              startedAt,
              historicalError({
                code: "HISTORICAL_REJECTION_LIMIT_EXCEEDED",
                message: "historical import exceeded configured rejection policy",
                timestamp: this.input.clock.now(),
              }),
            );
          }
          continue;
        }
        const observation = normalized.value.observation;
        const duplicate = duplicateFor(
          observation,
          normalized.value.semanticFingerprint,
          seenObservationIds,
          seenSemantic,
          parsed.value.location,
        );
        if (duplicate !== undefined) {
          duplicateEvidence.push(duplicate);
          if (prepared.value.plan.duplicatePolicy === "REJECT_EXACT") {
            rejections.push(
              rejectionFromError({
                sessionId,
                plan: prepared.value.plan,
                record: parsed.value,
                error: historicalError({
                  code: "HISTORICAL_RECORD_INVALID",
                  message: "duplicate observation rejected by import policy",
                  timestamp: this.input.clock.now(),
                }),
                clock: this.input.clock,
              }),
            );
            continue;
          }
        }
        observations.push(observation);
        seenObservationIds.set(observation.observationId, observation);
        seenSemantic.set(normalized.value.semanticFingerprint, observation);
      }
      await this.input.repository.quarantine(rejections);
      const dataset = buildHistoricalDataset({
        plan: prepared.value.plan,
        observations,
        rejections,
        duplicateEvidence,
        clock: this.input.clock,
      });
      const staged = await this.input.repository.stageDataset(dataset);
      if (!staged.ok) {
        return this.failSession(
          sessionId,
          prepared.value.plan.planId,
          prepared.value.artifact.artifactId,
          startedAt,
          staged.error,
        );
      }
      const published = await this.input.repository.publishDataset(dataset.manifest.datasetId);
      if (!published.ok) {
        return this.failSession(
          sessionId,
          prepared.value.plan.planId,
          prepared.value.artifact.artifactId,
          startedAt,
          published.error,
        );
      }
      const session = this.completedSession({
        sessionId,
        planId: prepared.value.plan.planId,
        artifactId: prepared.value.artifact.artifactId,
        startedAt,
        manifest: published.value,
        observations,
        rejections,
        duplicateEvidence,
      });
      this.recentImports.unshift(session);
      return ok(session);
    } finally {
      this.activeImports -= 1;
    }
  }

  public activeImportCount(): number {
    return this.activeImports;
  }

  public recentImportSessions(): readonly HistoricalImportSession[] {
    return this.recentImports.slice(0, 10);
  }

  public recentImportFailures(): readonly HistoricalError[] {
    return this.recentFailures.slice(0, 10);
  }

  public async explainDataset(datasetId: HistoricalDatasetManifest["datasetId"]) {
    return this.input.repository.getManifest(datasetId);
  }

  private async prepare(request: HistoricalImportRequest) {
    const artifact = createHistoricalSourceArtifact({
      fileName: request.fileName,
      content: request.content,
      ...(request.declaredFormat === undefined ? {} : { declaredFormat: request.declaredFormat }),
      source: request.source,
      clock: this.input.clock,
      ...(request.actor === undefined ? {} : { importedBy: request.actor }),
      limits: this.limits,
      metadata: request.metadata ?? {},
    });
    if (!artifact.ok) {
      return artifact;
    }
    const parser = this.parserFor(artifact.value.detectedFormat);
    if (!parser.ok) {
      return parser;
    }
    const schema = await parser.value.inspect(
      request.content,
      artifact.value,
      this.limits,
      this.input.clock,
    );
    if (!schema.ok) {
      return schema;
    }
    const formatEvidence = detectHistoricalFormat({
      fileName: artifact.value.sanitizedFileName,
      content: request.content,
      ...(request.declaredFormat === undefined ? {} : { declaredFormat: request.declaredFormat }),
      clock: this.input.clock,
    });
    if (!formatEvidence.ok) {
      return formatEvidence;
    }
    const plan = createHistoricalImportPlan({
      artifact: artifact.value,
      formatEvidence: formatEvidence.value,
      schema: schema.value,
      mapping: request.mapping,
      rejectionPolicy: request.rejectionPolicy ?? {
        mode: "ALLOW_PARTIAL",
        maxRejections: this.limits.maxRejections,
      },
      duplicatePolicy: request.duplicatePolicy ?? "PRESERVE",
      resourceLimits: this.limits,
      clock: this.input.clock,
    });
    if (!plan.ok) {
      return plan;
    }
    return ok({ artifact: artifact.value, schema: schema.value, plan: plan.value });
  }

  private parserFor(format: string) {
    const parser = this.input.parsers.find((candidate) => candidate.format === format);
    if (parser === undefined) {
      return fail(
        historicalError({
          code: "HISTORICAL_FORMAT_UNSUPPORTED",
          message: "no parser is registered for detected historical format",
          timestamp: this.input.clock.now(),
          details: { format },
        }),
      );
    }
    return ok(parser);
  }

  private completedSession(input: {
    sessionId: HistoricalImportSessionId;
    planId: HistoricalImportSession["planId"];
    artifactId: HistoricalImportSession["artifactId"];
    startedAt: HistoricalImportSession["startedAt"];
    manifest: HistoricalDatasetManifest;
    observations: readonly MarketObservation[];
    rejections: readonly HistoricalRejectionRecord[];
    duplicateEvidence: readonly DuplicateEvidence[];
  }): HistoricalImportSession {
    return {
      sessionId: input.sessionId,
      planId: input.planId,
      artifactId: input.artifactId,
      startedAt: input.startedAt,
      completedAt: this.input.clock.now(),
      state: input.rejections.length === 0 ? "COMPLETED" : "COMPLETED_WITH_REJECTIONS",
      outputDatasetId: input.manifest.datasetId,
      statistics: statisticsFor(
        input.startedAt,
        this.input.clock.now(),
        input.observations,
        input.rejections,
        input.duplicateEvidence,
      ),
    };
  }

  private failSession(
    sessionId: HistoricalImportSessionId,
    planId: HistoricalImportSession["planId"],
    artifactId: HistoricalImportSession["artifactId"],
    startedAt: HistoricalImportSession["startedAt"],
    error: HistoricalError,
  ): HistoricalResult<HistoricalImportSession> {
    this.recordFailure(error);
    const session: HistoricalImportSession = {
      sessionId,
      planId,
      artifactId,
      startedAt,
      completedAt: this.input.clock.now(),
      state: "FAILED",
      failureReason: error,
      statistics: emptyStatistics(),
    };
    this.recentImports.unshift(session);
    return ok(session);
  }

  private recordFailure(error: HistoricalError): void {
    this.recentFailures.unshift(error);
  }
}

const sessionIdFromPlan = (planId: string, discriminator: string): HistoricalImportSessionId =>
  `his-${planId.replace(/^hip-/u, "").slice(0, 16)}-${Math.abs(hashString(discriminator)).toString(16).padStart(8, "0")}` as HistoricalImportSessionId;

const shouldFailForRejection = (
  policy: { mode: string; maxRejections: number; maxRejectionRatio?: number },
  rejected: number,
  total: number,
): boolean =>
  policy.mode === "FAIL_FAST" ||
  rejected > policy.maxRejections ||
  (policy.maxRejectionRatio !== undefined &&
    total > 0 &&
    rejected / total > policy.maxRejectionRatio);

const duplicateFor = (
  observation: MarketObservation,
  semanticFingerprint: string,
  seenIds: Map<string, MarketObservation>,
  seenSemantic: Map<string, MarketObservation>,
  location: HistoricalRejectionRecord["location"],
): DuplicateEvidence | undefined => {
  const sameId = seenIds.get(observation.observationId);
  const sameSemantic = seenSemantic.get(semanticFingerprint);
  const duplicateOf = sameId ?? sameSemantic;
  if (duplicateOf === undefined) {
    return undefined;
  }
  return {
    observationId: observation.observationId,
    duplicateOfObservationId: duplicateOf.observationId,
    sourceLocation: location,
    evidence: [sameId === undefined ? "SEMANTIC_FINGERPRINT" : "OBSERVATION_ID"],
  };
};

const statisticsFor = (
  startedAt: string,
  completedAt: string,
  observations: readonly MarketObservation[],
  rejections: readonly HistoricalRejectionRecord[],
  duplicateEvidence: readonly DuplicateEvidence[],
): HistoricalImportStatistics => {
  const times = observations.map((observation) => observation.eventTime).sort();
  const firstEventTime = times[0];
  const lastEventTime = times[times.length - 1];
  return {
    sourceRecords: observations.length + rejections.length,
    parsedRecords: observations.length + rejections.length,
    acceptedRecords: observations.length,
    rejectedRecords: rejections.length,
    quarantinedRecords: rejections.length,
    duplicateCandidates: duplicateEvidence.length,
    ...(firstEventTime === undefined ? {} : { firstEventTime }),
    ...(lastEventTime === undefined ? {} : { lastEventTime }),
    instruments: Array.from(
      new Set(observations.map((observation) => observation.instrumentId)),
    ).sort(),
    observationKinds: Array.from(
      new Set(observations.map((observation) => observation.observationKind)),
    ).sort(),
    timeframes: Array.from(
      new Set(
        observations
          .filter((observation) => observation.observationKind === "BAR")
          .map((observation) => JSON.stringify(observation.timeframe)),
      ),
    ).sort(),
    volumesByType: {},
    durationMs: Date.parse(completedAt) - Date.parse(startedAt),
  };
};

const emptyStatistics = (): HistoricalImportStatistics => ({
  sourceRecords: 0,
  parsedRecords: 0,
  acceptedRecords: 0,
  rejectedRecords: 0,
  quarantinedRecords: 0,
  duplicateCandidates: 0,
  instruments: [],
  observationKinds: [],
  timeframes: [],
  volumesByType: {},
  durationMs: 0,
});

const hashString = (value: string): number =>
  Array.from(value).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 0);
