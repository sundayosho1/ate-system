import type { DataQualityReport, DataQualityReportId } from "@ate/data-quality";
import type { Actor, RuntimeMode, UtcTimestamp } from "@ate/domain";
import type { HistoricalDatasetManifest } from "@ate/historical-data";

import { datasetCatalogueError, fail, ok } from "./errors.js";
import {
  createDatasetFamilyId,
  createDatasetIntegrityVerificationId,
  createDatasetLineageEdgeId,
  createDatasetTransformationId,
  createDatasetVersionId,
  semanticFingerprint,
} from "./identity.js";
import type {
  DatasetCatalogueEntry,
  DatasetCataloguePage,
  DatasetCatalogueQuery,
  DatasetCatalogueResult,
  DatasetCatalogueService,
  DatasetCatalogueServiceInput,
  DatasetEligibility,
  DatasetEligibilityReasonCode,
  DatasetFamilyDefinition,
  DatasetFamilyId,
  DatasetIntegrityMetadata,
  DatasetIntegrityVerification,
  DatasetIntendedUse,
  DatasetLineageEdge,
  DatasetLineageExplanation,
  DatasetLineageGraph,
  DatasetLineageNodeRef,
  DatasetQualityReference,
  DatasetRegistrationRequest,
  DatasetRegistrationResult,
  DatasetReproducibilityRecord,
  DatasetRootSources,
  DatasetSourceReference,
  DatasetTransformation,
  DatasetVersionComparison,
  DatasetVersionId,
  DatasetVersionRecord,
} from "./types.js";

export class DefaultDatasetCatalogueService implements DatasetCatalogueService {
  private readonly recentRegistrations: DatasetVersionId[] = [];
  private readonly failures: ReturnType<typeof datasetCatalogueError>[] = [];

  public constructor(private readonly input: DatasetCatalogueServiceInput) {}

  public async registerDataset(
    request: DatasetRegistrationRequest,
  ): Promise<DatasetCatalogueResult<DatasetRegistrationResult>> {
    if ((request.runtimeMode as RuntimeMode) === "LIVE") {
      return this.failure(
        "DATASET_REGISTRATION_INVALID",
        "dataset catalogue does not support LIVE registration",
      );
    }
    if (request.historicalDatasetId === undefined && request.externalContent === undefined) {
      return this.failure(
        "DATASET_REGISTRATION_INVALID",
        "registration requires a historical dataset or explicit external content reference",
      );
    }

    const manifestResult =
      request.historicalDatasetId === undefined
        ? ok<HistoricalDatasetManifest | undefined>(undefined)
        : await this.input.historicalRepository.getManifest(request.historicalDatasetId);
    if (!manifestResult.ok) {
      return this.failure(
        "DATASET_MANIFEST_MISMATCH",
        "historical dataset manifest was not found",
        {
          datasetId: request.historicalDatasetId,
          cause: manifestResult.error.code,
        },
      );
    }
    const manifest = manifestResult.value;
    const qualityReferences = await this.resolveQualityReferences(
      request.qualityReportIds ?? [],
      manifest,
    );
    if (!qualityReferences.ok) {
      return qualityReferences;
    }

    const family = await this.buildFamily(request, manifest);
    if (!family.ok) {
      return family;
    }
    const sequence = await this.nextSequence(family.value.familyId);
    const content = contentReference(request, manifest);
    const contentSummary = contentSummaryFrom(request, manifest);
    const parentVersionIds = [...(request.parentDatasetVersionIds ?? [])].sort();
    if (parentVersionIds.length > (this.input.maxParentsPerDataset ?? 16)) {
      return this.failure(
        "DATASET_LINEAGE_LIMIT_EXCEEDED",
        "parent dataset count exceeds catalogue bound",
        {
          parentCount: parentVersionIds.length,
        },
      );
    }

    const versionId = createDatasetVersionId({
      familyId: family.value.familyId,
      content,
      parentVersionIds,
      qualityReportIds: request.qualityReportIds ?? [],
      metadata: request.metadata ?? {},
    });
    const provenance = buildProvenance(
      versionId,
      request,
      manifest,
      parentVersionIds,
      this.input.clock.now(),
      request.actor,
    );
    const lineage = buildLineage(
      versionId,
      request,
      manifest,
      parentVersionIds,
      request.actor,
      this.input.clock.now(),
    );
    const registrationFingerprint = semanticFingerprint({
      familyId: family.value.familyId,
      versionId,
      content,
      provenance,
      lineage,
      metadata: request.metadata ?? {},
    });
    const integrity = buildIntegrity(
      manifest,
      content,
      registrationFingerprint,
      provenance.provenanceFingerprint,
      lineage.lineageFingerprint,
      this.input.clock.now(),
    );
    const reproducibility = buildReproducibility(manifest, parentVersionIds, provenance, content);
    const intendedUses = request.intendedUses ?? ["RESEARCH_EXPLORATION"];
    const lifecycleState =
      request.lifecycleState ??
      (request.setActive === true
        ? "ACTIVE"
        : qualityReferences.value.length > 0
          ? "QUALIFIED"
          : "REGISTERED");
    const baseVersion = {
      familyId: family.value.familyId,
      versionId,
      versionSequence: sequence,
      createdAt: manifest?.createdAt ?? this.input.clock.now(),
      registeredAt: this.input.clock.now(),
      ...(request.actor === undefined ? {} : { registeredBy: request.actor }),
      runtimeMode: request.runtimeMode,
      content,
      contentSummary,
      ...(manifest === undefined ? {} : { historicalManifest: manifest }),
      provenance,
      lineage,
      integrity,
      qualityReferences: qualityReferences.value,
      lifecycleState,
      lifecycleHistory: [
        {
          to: lifecycleState,
          reason: request.reason,
          ...(request.actor === undefined ? {} : { actor: request.actor }),
          timestamp: this.input.clock.now(),
          ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId }),
          ...(request.causationId === undefined ? {} : { causationId: request.causationId }),
          evidence: [registrationFingerprint],
        },
      ],
      eligibility: [] as readonly DatasetEligibility[],
      reproducibility,
      metadata: request.metadata ?? {},
      registrationFingerprint,
      versionFingerprint: semanticFingerprint({
        familyId: family.value.familyId,
        versionId,
        content,
        provenance,
        lineage,
        reproducibility,
      }),
      catalogueStateFingerprint: semanticFingerprint({
        versionId,
        lifecycleState,
        qualityReferences: qualityReferences.value,
      }),
    } satisfies DatasetVersionRecord;
    const eligibility = intendedUses.map((intendedUse) =>
      deriveEligibility(baseVersion, intendedUse, this.input.clock.now(), {
        requireQualityForQualification: this.input.requireQualityForQualification ?? false,
        requireVerifiedIntegrity: this.input.requireVerifiedIntegrity ?? true,
      }),
    );
    const version: DatasetVersionRecord = {
      ...baseVersion,
      eligibility,
      catalogueStateFingerprint: semanticFingerprint({
        versionId,
        lifecycleState,
        qualityReferences: qualityReferences.value,
        eligibility,
        integrity,
      }),
    };
    const entry: DatasetCatalogueEntry = { family: family.value, version };
    const registered = await this.input.repository.register(entry, {
      ...(request.expectedFamilyVersion === undefined
        ? {}
        : { expectedFamilyVersion: request.expectedFamilyVersion }),
      ...(request.setActive === undefined ? {} : { setActive: request.setActive }),
    });
    if (!registered.ok) {
      this.recordFailure(registered.error);
      return registered;
    }
    this.recentRegistrations.unshift(registered.value.entry.version.versionId);
    this.recentRegistrations.splice(10);
    return registered;
  }

  public async explainDataset(
    versionId: DatasetVersionId,
  ): Promise<DatasetCatalogueResult<DatasetCatalogueEntry>> {
    const version = await this.input.repository.getVersion(versionId);
    if (!version.ok) {
      return version;
    }
    const family = await this.input.repository.getFamily(version.value.familyId);
    if (!family.ok) {
      return family;
    }
    return ok({ family: family.value, version: version.value });
  }

  public async explainLineage(
    versionId: DatasetVersionId,
  ): Promise<DatasetCatalogueResult<DatasetLineageExplanation>> {
    const version = await this.input.repository.getVersion(versionId);
    if (!version.ok) return version;
    const ancestry = await this.input.repository.getAncestors(versionId, this.lineageOptions());
    if (!ancestry.ok) return ancestry;
    const descendants = await this.input.repository.getDescendants(
      versionId,
      this.lineageOptions(),
    );
    if (!descendants.ok) return descendants;
    const rootSources = collectRootSources(version.value, ancestry.value.nodes);
    return ok({
      datasetVersionId: versionId,
      directParents: version.value.lineage.parents,
      directChildren: version.value.lineage.children,
      rootSources,
      ancestry: ancestry.value,
      descendants: descendants.value,
      integrityStatus: version.value.integrity.status,
      brokenLineageIssues: lineageIssues(version.value),
    });
  }

  public async explainEligibility(
    versionId: DatasetVersionId,
    intendedUse: DatasetIntendedUse,
  ): Promise<DatasetCatalogueResult<DatasetEligibility>> {
    const version = await this.input.repository.getVersion(versionId);
    if (!version.ok) return version;
    const existing = version.value.eligibility.find((entry) => entry.intendedUse === intendedUse);
    return ok(
      existing ??
        deriveEligibility(version.value, intendedUse, this.input.clock.now(), {
          requireQualityForQualification: this.input.requireQualityForQualification ?? false,
          requireVerifiedIntegrity: this.input.requireVerifiedIntegrity ?? true,
        }),
    );
  }

  public async analyzeDatasetImpact(versionId: DatasetVersionId, options = {}) {
    const descendants = await this.input.repository.getDescendants(versionId, {
      ...this.lineageOptions(),
      ...options,
    });
    if (!descendants.ok) return descendants;
    const affectedEntries = await Promise.all(
      descendants.value.nodes.map((node) => this.explainDataset(node.versionId)),
    );
    return ok({
      rootVersionId: versionId,
      directDependants: descendants.value.edges
        .filter(
          (edge) =>
            edge.source.nodeType === "DATASET_VERSION" &&
            edge.source.datasetVersionId === versionId,
        )
        .flatMap((edge) =>
          edge.target.nodeType === "DATASET_VERSION" ? [edge.target.datasetVersionId] : [],
        ),
      transitiveDependants: descendants.value.nodes.map((node) => node.versionId),
      affectedEntries: affectedEntries.flatMap((entry) => (entry.ok ? [entry.value] : [])),
      truncated: descendants.value.truncated,
      depth: descendants.value.depth,
      reason: "impact analysis reports dependants only; it does not invalidate descendants",
    });
  }

  public async compareDatasetVersions(
    leftVersionId: DatasetVersionId,
    rightVersionId: DatasetVersionId,
  ): Promise<DatasetCatalogueResult<DatasetVersionComparison>> {
    const left = await this.input.repository.getVersion(leftVersionId);
    if (!left.ok) return left;
    const right = await this.input.repository.getVersion(rightVersionId);
    if (!right.ok) return right;
    const differences = [
      left.value.content.contentFingerprint === right.value.content.contentFingerprint
        ? undefined
        : "contentFingerprint",
      left.value.content.schemaIdentity === right.value.content.schemaIdentity
        ? undefined
        : "schemaIdentity",
      left.value.lineage.lineageFingerprint === right.value.lineage.lineageFingerprint
        ? undefined
        : "lineage",
      stableQualityKey(left.value) === stableQualityKey(right.value)
        ? undefined
        : "qualityReferences",
      left.value.lifecycleState === right.value.lifecycleState ? undefined : "lifecycleState",
    ].filter((value): value is string => value !== undefined);
    return ok({
      leftVersionId,
      rightVersionId,
      contentChanged:
        left.value.content.contentFingerprint !== right.value.content.contentFingerprint,
      qualityChanged: stableQualityKey(left.value) !== stableQualityKey(right.value),
      lifecycleChanged: left.value.lifecycleState !== right.value.lifecycleState,
      lineageChanged:
        left.value.lineage.lineageFingerprint !== right.value.lineage.lineageFingerprint,
      differences,
    });
  }

  public async linkQualityReport(
    versionId: DatasetVersionId,
    reportId: DataQualityReportId,
  ): Promise<DatasetCatalogueResult<DatasetVersionRecord>> {
    const version = await this.input.repository.getVersion(versionId);
    if (!version.ok) return version;
    const report = await this.resolveQualityReport(reportId);
    if (!report.ok) return report;
    if (report.value.datasetId !== version.value.content.historicalDatasetId) {
      return this.failure(
        "DATASET_QUALITY_REFERENCE_INVALID",
        "quality report targets a different dataset",
        {
          versionId,
          reportId,
        },
      );
    }
    return this.input.repository.attachQualityReference(
      versionId,
      qualityReferenceFromReport(report.value),
    );
  }

  public async verifyDatasetIntegrity(versionId: DatasetVersionId) {
    const version = await this.input.repository.getVersion(versionId);
    if (!version.ok) return version;
    let status = version.value.integrity.status;
    const issues: string[] = [];
    if (version.value.content.historicalDatasetId !== undefined) {
      const manifest = await this.input.historicalRepository.getManifest(
        version.value.content.historicalDatasetId,
      );
      if (!manifest.ok) {
        status = "BROKEN_REFERENCE";
        issues.push("historical manifest missing");
      } else if (manifest.value.contentFingerprint !== version.value.content.contentFingerprint) {
        status = "MISMATCH";
        issues.push("content fingerprint mismatch");
      } else {
        status = "VERIFIED";
      }
    }
    const verification: DatasetIntegrityVerification = {
      verificationId: createDatasetIntegrityVerificationId({
        versionId,
        status,
        checkedAt: this.input.clock.now(),
        issues,
      }),
      status,
      checkedAt: this.input.clock.now(),
      issues,
      ...(version.value.integrity.manifestFingerprint === undefined
        ? {}
        : { manifestFingerprint: version.value.integrity.manifestFingerprint }),
      contentFingerprint: version.value.content.contentFingerprint,
      provenanceFingerprint: version.value.provenance.provenanceFingerprint,
      lineageFingerprint: version.value.lineage.lineageFingerprint,
    };
    return this.input.repository.verifyIntegrity(versionId, verification);
  }

  public async queryDatasets(
    query: DatasetCatalogueQuery,
  ): Promise<DatasetCatalogueResult<DatasetCataloguePage>> {
    return this.input.repository.query({
      ...query,
      limit: Math.min(query.limit, this.input.maxQueryPageSize ?? 1000),
    });
  }

  public async setActiveVersion(
    familyId: DatasetFamilyId,
    versionId: DatasetVersionId,
    expectedCurrentVersionId?: DatasetVersionId,
  ) {
    return this.input.repository.setActiveVersion(familyId, versionId, expectedCurrentVersionId);
  }

  public async createSnapshot() {
    return this.input.repository.createSnapshot();
  }

  public async diagnostics() {
    const diagnostics = await this.input.repository.diagnostics();
    if (!diagnostics.ok) return diagnostics;
    return ok({
      ...diagnostics.value,
      recentRegistrations: this.recentRegistrations,
      recentFailures: this.failures,
    });
  }

  public recentRegistrationIds(): readonly DatasetVersionId[] {
    return [...this.recentRegistrations];
  }

  public recentFailures(): readonly ReturnType<typeof datasetCatalogueError>[] {
    return [...this.failures];
  }

  private async buildFamily(
    request: DatasetRegistrationRequest,
    manifest: HistoricalDatasetManifest | undefined,
  ): Promise<DatasetCatalogueResult<DatasetFamilyDefinition>> {
    const identityDimensions = familyDimensionsFrom(request, manifest);
    const familyId = request.family?.familyId ?? createDatasetFamilyId(identityDimensions);
    const existing = await this.input.repository.getFamily(familyId);
    if (existing.ok) {
      return ok(existing.value);
    }
    const base = {
      familyId,
      displayName: request.family?.displayName ?? `Dataset family ${familyId}`,
      purpose: request.family?.purpose ?? "Governed dataset family",
      identityDimensions,
      createdAt: this.input.clock.now(),
      ...(request.actor === undefined ? {} : { createdBy: request.actor }),
      metadata: request.family?.metadata ?? {},
    };
    return ok({ ...base, familyFingerprint: semanticFingerprint(base) });
  }

  private async nextSequence(familyId: DatasetFamilyId): Promise<number> {
    const page = await this.input.repository.query({ familyId, limit: 5000 });
    if (!page.ok || page.value.entries.length === 0) return 1;
    return Math.max(...page.value.entries.map((entry) => entry.version.versionSequence)) + 1;
  }

  private async resolveQualityReferences(
    reportIds: readonly DataQualityReportId[],
    manifest: HistoricalDatasetManifest | undefined,
  ): Promise<DatasetCatalogueResult<readonly DatasetQualityReference[]>> {
    const references: DatasetQualityReference[] = [];
    for (const reportId of reportIds) {
      const report = await this.resolveQualityReport(reportId);
      if (!report.ok) return report;
      if (manifest !== undefined && report.value.datasetId !== manifest.datasetId) {
        return this.failure(
          "DATASET_QUALITY_REFERENCE_INVALID",
          "quality report dataset does not match manifest",
          {
            reportId,
            reportDatasetId: report.value.datasetId,
            manifestDatasetId: manifest.datasetId,
          },
        );
      }
      if (
        manifest !== undefined &&
        report.value.datasetContentFingerprint !== manifest.contentFingerprint
      ) {
        return this.failure(
          "DATASET_QUALITY_REFERENCE_INVALID",
          "quality report fingerprint does not match manifest",
          {
            reportId,
          },
        );
      }
      references.push(qualityReferenceFromReport(report.value));
    }
    return ok(references);
  }

  private async resolveQualityReport(
    reportId: DataQualityReportId,
  ): Promise<DatasetCatalogueResult<DataQualityReport>> {
    if (this.input.qualityRepository === undefined) {
      return this.failure(
        "DATASET_QUALITY_REPORT_NOT_FOUND",
        "quality repository is not configured",
        { reportId },
      );
    }
    const report = await this.input.qualityRepository.getReport(reportId);
    if (!report.ok) {
      return this.failure("DATASET_QUALITY_REPORT_NOT_FOUND", "quality report was not found", {
        reportId,
        cause: report.error.code,
      });
    }
    return ok(report.value);
  }

  private lineageOptions() {
    return {
      maxDepth: this.input.maxLineageDepth ?? 25,
      maxNodes: this.input.maxLineageNodes ?? 100,
    };
  }

  private failure<T>(
    code: Parameters<typeof datasetCatalogueError>[0]["code"],
    message: string,
    details?: Record<string, unknown>,
  ): DatasetCatalogueResult<T> {
    const error = datasetCatalogueError({
      code,
      message,
      timestamp: this.input.clock.now(),
      ...(details === undefined ? {} : { details }),
    });
    this.recordFailure(error);
    return fail(error);
  }

  private recordFailure(error: ReturnType<typeof datasetCatalogueError>): void {
    this.failures.unshift(error);
    this.failures.splice(10);
  }
}

const contentReference = (
  request: DatasetRegistrationRequest,
  manifest: HistoricalDatasetManifest | undefined,
): DatasetVersionRecord["content"] => {
  if (manifest !== undefined) {
    return {
      historicalDatasetId: manifest.datasetId,
      contentFingerprint: manifest.contentFingerprint,
      schemaIdentity: manifest.canonicalSchemaVersion,
      manifestFingerprint: semanticFingerprint(manifest),
      materializationType: "MATERIALIZED",
      safeStorageRef: `historical:${manifest.datasetId}`,
    };
  }
  if (request.externalContent === undefined) {
    throw new Error("external content invariant violated");
  }
  return request.externalContent;
};

const contentSummaryFrom = (
  request: DatasetRegistrationRequest,
  manifest: HistoricalDatasetManifest | undefined,
): DatasetVersionRecord["contentSummary"] => {
  if (manifest !== undefined) {
    return {
      instrumentIds: manifest.instrumentIds,
      observationKinds: manifest.observationKinds,
      timeframes: manifest.timeframes,
      sourceIds: manifest.sourceRefs,
      ...(manifest.firstEventTime === undefined ? {} : { firstEventTime: manifest.firstEventTime }),
      ...(manifest.lastEventTime === undefined ? {} : { lastEventTime: manifest.lastEventTime }),
      observationCount: manifest.observationCount,
      partitionCount: manifest.partitions.length,
    };
  }
  return {
    instrumentIds: [],
    observationKinds: [],
    timeframes: [],
    sourceIds: [],
    observationCount: 0,
    partitionCount: 0,
  };
};

const familyDimensionsFrom = (
  request: DatasetRegistrationRequest,
  manifest: HistoricalDatasetManifest | undefined,
): DatasetFamilyDefinition["identityDimensions"] => {
  const summary = contentSummaryFrom(request, manifest);
  return {
    instrumentIds: summary.instrumentIds,
    observationKinds: summary.observationKinds,
    timeframes: summary.timeframes,
    sourceIds: summary.sourceIds,
    schemaFamily:
      manifest?.canonicalSchemaVersion ?? request.externalContent?.schemaIdentity ?? "external",
    originType: manifest === undefined ? "EXTERNAL_REFERENCE" : "HISTORICAL_IMPORT",
  };
};

const buildProvenance = (
  versionId: DatasetVersionId,
  request: DatasetRegistrationRequest,
  manifest: HistoricalDatasetManifest | undefined,
  parentVersionIds: readonly DatasetVersionId[],
  now: UtcTimestamp,
  actor: Actor | undefined,
) => {
  const sources: DatasetSourceReference[] =
    manifest === undefined
      ? [
          {
            sourceName: "External Reference",
            originalSourceType: "EXTERNAL_SOURCE",
            metadata: {},
          },
        ]
      : [
          {
            sourceName: "Prompt 14 Historical Data Laboratory",
            originalSourceType: "PROMPT14_ARTIFACT",
            artifactId: manifest.artifactId,
            artifactChecksum: manifest.artifactChecksum,
            importPlanFingerprint: manifest.importPlanFingerprint,
            schemaIdentity: manifest.canonicalSchemaVersion,
            metadata: {
              datasetId: manifest.datasetId,
              completenessStatus: manifest.completenessStatus,
            },
          },
        ];
  const transformation: DatasetTransformation | undefined =
    manifest === undefined
      ? undefined
      : buildTransformation(
          versionId,
          parentVersionIds,
          manifest.importPlanFingerprint,
          now,
          actor,
        );
  const base = {
    originType: manifest === undefined ? "EXTERNAL_REFERENCE" : "HISTORICAL_IMPORT",
    sources,
    transformations: transformation === undefined ? [] : [transformation],
  } as const;
  return { ...base, provenanceFingerprint: semanticFingerprint(base) };
};

const buildTransformation = (
  versionId: DatasetVersionId,
  parentVersionIds: readonly DatasetVersionId[],
  importPlanFingerprint: string,
  now: UtcTimestamp,
  actor: Actor | undefined,
): DatasetTransformation => {
  const base = {
    transformationId: createDatasetTransformationId({ versionId, importPlanFingerprint }),
    transformationType: "IMPORT",
    transformationVersion: "prompt-14",
    inputDatasetVersionIds: parentVersionIds,
    outputDatasetVersionId: versionId,
    configurationFingerprint: importPlanFingerprint,
    parameters: {},
    completedAt: now,
    ...(actor === undefined ? {} : { actor }),
  } satisfies Omit<DatasetTransformation, "transformationFingerprint">;
  return { ...base, transformationFingerprint: semanticFingerprint(base) };
};

const buildLineage = (
  versionId: DatasetVersionId,
  request: DatasetRegistrationRequest,
  manifest: HistoricalDatasetManifest | undefined,
  parentVersionIds: readonly DatasetVersionId[],
  actor: Actor | undefined,
  now: UtcTimestamp,
): DatasetLineageGraph => {
  const target: DatasetLineageNodeRef = {
    nodeType: "DATASET_VERSION",
    datasetVersionId: versionId,
  };
  const edges: DatasetLineageEdge[] = [];
  if (manifest !== undefined) {
    const source: DatasetLineageNodeRef = {
      nodeType: "SOURCE_ARTIFACT",
      artifactId: manifest.artifactId,
      artifactChecksum: manifest.artifactChecksum,
    };
    edges.push(edge(source, target, "IMPORTED_FROM", now, actor, [manifest.importPlanFingerprint]));
  }
  for (const parent of parentVersionIds) {
    edges.push(
      edge(
        { nodeType: "DATASET_VERSION", datasetVersionId: parent },
        target,
        "DERIVED_FROM",
        now,
        actor,
        ["parent dataset version"],
      ),
    );
  }
  return {
    versionId,
    parents: parentVersionIds,
    children: [],
    edges,
    lineageFingerprint: semanticFingerprint({ versionId, parents: parentVersionIds, edges }),
  };
};

const edge = (
  source: DatasetLineageNodeRef,
  target: DatasetLineageNodeRef,
  relationshipType: DatasetLineageEdge["relationshipType"],
  createdAt: UtcTimestamp,
  actor: Actor | undefined,
  evidence: readonly string[],
): DatasetLineageEdge => {
  const base = {
    source,
    target,
    relationshipType,
    createdAt,
    ...(actor === undefined ? {} : { actor }),
    evidence,
  };
  return {
    ...base,
    edgeId: createDatasetLineageEdgeId(base),
    edgeFingerprint: semanticFingerprint(base),
  };
};

const buildIntegrity = (
  manifest: HistoricalDatasetManifest | undefined,
  content: DatasetVersionRecord["content"],
  registrationFingerprint: DatasetVersionRecord["registrationFingerprint"],
  provenanceFingerprint: DatasetVersionRecord["provenance"]["provenanceFingerprint"],
  lineageFingerprint: DatasetVersionRecord["lineage"]["lineageFingerprint"],
  now: UtcTimestamp,
): DatasetIntegrityMetadata => {
  const status = manifest === undefined ? "UNVERIFIED" : "VERIFIED";
  const verification: DatasetIntegrityVerification = {
    verificationId: createDatasetIntegrityVerificationId({ content, status }),
    status,
    checkedAt: now,
    issues: [],
    ...(content.manifestFingerprint === undefined
      ? {}
      : { manifestFingerprint: content.manifestFingerprint }),
    contentFingerprint: content.contentFingerprint,
    provenanceFingerprint,
    lineageFingerprint,
  };
  return {
    status,
    contentFingerprint: content.contentFingerprint,
    ...(content.manifestFingerprint === undefined
      ? {}
      : { manifestFingerprint: content.manifestFingerprint }),
    partitionChecksums: manifest?.partitions.map((partition) => partition.checksum) ?? [],
    schemaIdentity: content.schemaIdentity,
    registrationFingerprint,
    provenanceFingerprint,
    lineageFingerprint,
    verifiedAt: now,
    verificationHistory: [verification],
  };
};

const buildReproducibility = (
  manifest: HistoricalDatasetManifest | undefined,
  parentVersionIds: readonly DatasetVersionId[],
  provenance: DatasetVersionRecord["provenance"],
  content: DatasetVersionRecord["content"],
): DatasetReproducibilityRecord => {
  const sourceArtifactChecksums = provenance.sources.flatMap((source) =>
    source.artifactChecksum === undefined ? [] : [String(source.artifactChecksum)],
  );
  const missingEvidence = [
    manifest === undefined ? "historical manifest" : undefined,
    sourceArtifactChecksums.length === 0 ? "source artifact checksum" : undefined,
  ].filter((value): value is string => value !== undefined);
  return {
    status: missingEvidence.length === 0 ? "REPRODUCIBLE" : "PARTIALLY_REPRODUCIBLE",
    sourceArtifactChecksums,
    parentDatasetVersionIds: parentVersionIds,
    parentFingerprints: [],
    schemaIdentity: content.schemaIdentity,
    transformationFingerprints: provenance.transformations.map(
      (transformation) => transformation.transformationFingerprint,
    ),
    ...(manifest?.importPlanFingerprint === undefined
      ? {}
      : {
          importPlanFingerprint: manifest.importPlanFingerprint,
          mappingFingerprint: manifest.importPlanFingerprint,
          configurationFingerprint: manifest.importPlanFingerprint,
        }),
    applicationVersion: "0.16.0-dataset-catalogue.1",
    expectedContentFingerprint: String(content.contentFingerprint),
    missingEvidence,
    explanation:
      missingEvidence.length === 0
        ? "Prompt 14 manifest, source checksum and import plan fingerprint are sufficient to investigate reproduction."
        : "Reproducibility is partial because some source evidence is absent.",
  };
};

const qualityReferenceFromReport = (report: DataQualityReport): DatasetQualityReference => ({
  reportId: report.reportId,
  profileId: report.profileId,
  profileVersion: report.profileVersion,
  analysisFingerprint: report.reportFingerprint,
  reportFingerprint: report.reportFingerprint,
  score: report.score.value,
  qualityClass: report.dataQuality,
  qualification: report.score.qualification,
  blockingFindingCount:
    report.summary.severityCounts.ERROR + report.summary.severityCounts.CRITICAL,
  completedAt: report.generatedAt,
  intendedUses: report.score.intendedUses.filter(isDatasetIntendedUse),
});

const isDatasetIntendedUse = (value: string): value is DatasetIntendedUse =>
  value !== "LIVE" &&
  [
    "RESEARCH_EXPLORATION",
    "BACKTEST_CANDIDATE",
    "SIMULATION_CANDIDATE",
    "PAPER_REVIEW",
    "GENERAL_RESEARCH",
    "BACKTEST_RESEARCH",
    "SIMULATION_RESEARCH",
    "FEATURE_RESEARCH",
    "VISUALIZATION",
  ].includes(value);

const deriveEligibility = (
  version: DatasetVersionRecord,
  intendedUse: DatasetIntendedUse,
  now: string,
  policy: { requireQualityForQualification: boolean; requireVerifiedIntegrity: boolean },
): DatasetEligibility => {
  const reasons: DatasetEligibilityReasonCode[] = [];
  if (version.lifecycleState === "QUARANTINED") reasons.push("LIFECYCLE_QUARANTINED");
  if (version.lifecycleState === "INVALIDATED") reasons.push("LIFECYCLE_INVALIDATED");
  if (version.lifecycleState === "ACTIVE") reasons.push("LIFECYCLE_ACTIVE");
  if (version.lifecycleState === "REGISTERED") reasons.push("LIFECYCLE_REGISTERED_ONLY");
  if (version.integrity.status === "VERIFIED") reasons.push("INTEGRITY_VERIFIED");
  if (version.integrity.status === "MISMATCH") reasons.push("INTEGRITY_MISMATCH");
  const quality = currentQualityReference(version, intendedUse);
  if (quality === undefined) {
    reasons.push("QUALITY_REPORT_MISSING");
  } else if (quality.qualification === "QUALIFIED") {
    reasons.push("QUALITY_QUALIFIED");
  } else if (quality.qualification === "QUALIFIED_WITH_WARNINGS") {
    reasons.push("QUALITY_WARNINGS");
  } else {
    reasons.push("QUALITY_NOT_QUALIFIED");
  }
  const blocked =
    reasons.includes("LIFECYCLE_QUARANTINED") ||
    reasons.includes("LIFECYCLE_INVALIDATED") ||
    (policy.requireVerifiedIntegrity && version.integrity.status !== "VERIFIED") ||
    quality?.qualification === "NOT_QUALIFIED";
  const insufficient =
    (policy.requireQualityForQualification && quality === undefined) ||
    quality?.qualification === "INSUFFICIENT_EVIDENCE";
  const status = insufficient
    ? "INSUFFICIENT_EVIDENCE"
    : blocked
      ? "NOT_ELIGIBLE"
      : quality?.qualification === "QUALIFIED_WITH_WARNINGS"
        ? "ELIGIBLE_WITH_WARNINGS"
        : "ELIGIBLE";
  return {
    intendedUse,
    status,
    reasonCodes: reasons,
    explanation: `Eligibility for ${intendedUse}: ${status}; reasons=${reasons.join(",")}`,
    evaluatedAt: now as never,
    ...(quality === undefined ? {} : { qualityReportId: quality.reportId }),
  };
};

const currentQualityReference = (
  version: DatasetVersionRecord,
  intendedUse: DatasetIntendedUse,
): DatasetQualityReference | undefined =>
  [...version.qualityReferences]
    .filter((reference) => reference.intendedUses.includes(intendedUse))
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
    .at(0);

const collectRootSources = (
  version: DatasetVersionRecord,
  ancestors: readonly DatasetVersionRecord[],
): DatasetRootSources => {
  const all = [version, ...ancestors];
  const sources = all.flatMap((entry) => [...entry.provenance.sources]);
  return {
    datasetVersionId: version.versionId,
    sources,
    artifactIds: unique(
      sources.flatMap((source) => (source.artifactId === undefined ? [] : [source.artifactId])),
    ),
    providerNames: unique(
      sources.flatMap((source) => (source.provider === undefined ? [] : [source.provider])),
    ),
    truncated: false,
  };
};

const lineageIssues = (version: DatasetVersionRecord): readonly string[] =>
  version.provenance.originType === "DERIVED" && version.lineage.parents.length === 0
    ? ["derived dataset has no governed parent"]
    : [];

const stableQualityKey = (version: DatasetVersionRecord): string =>
  JSON.stringify(version.qualityReferences.map((reference) => reference.reportFingerprint).sort());

const unique = <T extends string>(values: readonly T[]): readonly T[] =>
  Array.from(new Set(values)).sort();
