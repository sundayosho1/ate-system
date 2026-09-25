import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, normalize, resolve } from "node:path";

import { datasetCatalogueError, fail, ok } from "./errors.js";
import { createDatasetCatalogueSnapshotId, semanticFingerprint } from "./identity.js";
import { stableStringify } from "./serialization.js";
import type {
  DatasetCatalogueDiagnostics,
  DatasetCatalogueEntry,
  DatasetCataloguePage,
  DatasetCatalogueQuery,
  DatasetCatalogueRepository,
  DatasetCatalogueResult,
  DatasetCatalogueSnapshot,
  DatasetFamilyDefinition,
  DatasetFamilyId,
  DatasetIntegrityVerification,
  DatasetLineageEdge,
  DatasetLineageTraversal,
  DatasetLineageTraversalOptions,
  DatasetQualityReference,
  DatasetRepositoryWriteOptions,
  DatasetVersionId,
  DatasetVersionRecord,
} from "./types.js";

type StoreShape = Readonly<{
  families: readonly DatasetFamilyDefinition[];
  versions: readonly DatasetVersionRecord[];
  activePointers: readonly [DatasetFamilyId, DatasetVersionId][];
  familyMutationVersions: readonly [DatasetFamilyId, number][];
}>;

export class InMemoryDatasetCatalogueRepository implements DatasetCatalogueRepository {
  private readonly families = new Map<DatasetFamilyId, DatasetFamilyDefinition>();
  private readonly versions = new Map<DatasetVersionId, DatasetVersionRecord>();
  private readonly activePointers = new Map<DatasetFamilyId, DatasetVersionId>();
  private readonly familyMutationVersions = new Map<DatasetFamilyId, number>();
  private readonly recentRegistrations: DatasetVersionId[] = [];
  private readonly recentFailures: ReturnType<typeof datasetCatalogueError>[] = [];

  public async register(
    entry: DatasetCatalogueEntry,
    options: DatasetRepositoryWriteOptions = {},
  ): Promise<
    DatasetCatalogueResult<
      Readonly<{
        entry: DatasetCatalogueEntry;
        idempotent: boolean;
        createdFamily: boolean;
        activeVersionChanged: boolean;
      }>
    >
  > {
    await Promise.resolve();
    const existingVersion = this.versions.get(entry.version.versionId);
    if (existingVersion !== undefined) {
      if (existingVersion.registrationFingerprint === entry.version.registrationFingerprint) {
        return ok({
          entry: {
            family: this.requireFamily(entry.family.familyId),
            version: clone(existingVersion),
          },
          idempotent: true,
          createdFamily: false,
          activeVersionChanged: false,
        });
      }
      return this.failure(
        "DATASET_VERSION_CONFLICT",
        "dataset version ID already exists with different semantics",
        {
          versionId: entry.version.versionId,
        },
      );
    }

    const existingFamily = this.families.get(entry.family.familyId);
    const createdFamily = existingFamily === undefined;
    const currentFamilyVersion = this.familyMutationVersions.get(entry.family.familyId) ?? 0;
    if (
      options.expectedFamilyVersion !== undefined &&
      options.expectedFamilyVersion !== currentFamilyVersion
    ) {
      return this.failure("DATASET_REGISTRATION_CONFLICT", "stale dataset family writer", {
        familyId: entry.family.familyId,
        expectedFamilyVersion: options.expectedFamilyVersion,
        currentFamilyVersion,
      });
    }
    if (
      existingFamily !== undefined &&
      existingFamily.familyFingerprint !== entry.family.familyFingerprint
    ) {
      return this.failure(
        "DATASET_FAMILY_INCOMPATIBLE",
        "family ID is already bound to different semantics",
        {
          familyId: entry.family.familyId,
        },
      );
    }

    const lineageValidation = this.validateLineage(entry.version);
    if (!lineageValidation.ok) {
      return lineageValidation;
    }

    if (createdFamily) {
      this.families.set(entry.family.familyId, clone(entry.family));
    }
    this.versions.set(entry.version.versionId, clone(entry.version));
    this.familyMutationVersions.set(entry.family.familyId, currentFamilyVersion + 1);
    let activeVersionChanged = false;
    if (options.setActive === true || entry.version.lifecycleState === "ACTIVE") {
      this.activePointers.set(entry.family.familyId, entry.version.versionId);
      activeVersionChanged = true;
    }
    this.recentRegistrations.unshift(entry.version.versionId);
    this.recentRegistrations.splice(10);
    return ok({
      entry: clone(entry),
      idempotent: false,
      createdFamily,
      activeVersionChanged,
    });
  }

  public async getFamily(
    familyId: DatasetFamilyId,
  ): Promise<DatasetCatalogueResult<DatasetFamilyDefinition>> {
    await Promise.resolve();
    const family = this.families.get(familyId);
    return family === undefined
      ? this.failure("DATASET_FAMILY_NOT_FOUND", "dataset family was not found", { familyId })
      : ok(clone(family));
  }

  public async getVersion(
    versionId: DatasetVersionId,
  ): Promise<DatasetCatalogueResult<DatasetVersionRecord>> {
    await Promise.resolve();
    const version = this.versions.get(versionId);
    return version === undefined
      ? this.failure("DATASET_VERSION_NOT_FOUND", "dataset version was not found", { versionId })
      : ok(clone(version));
  }

  public async query(
    query: DatasetCatalogueQuery,
  ): Promise<DatasetCatalogueResult<DatasetCataloguePage>> {
    await Promise.resolve();
    if (!Number.isInteger(query.limit) || query.limit <= 0 || query.limit > 5000) {
      return this.failure(
        "DATASET_QUERY_LIMIT_EXCEEDED",
        "catalogue query limit must be between 1 and 5000",
        {
          limit: query.limit,
        },
      );
    }
    const offset = query.cursor === undefined ? 0 : Number(query.cursor);
    const entries = this.entries()
      .filter(({ family }) => query.familyId === undefined || family.familyId === query.familyId)
      .filter(
        ({ version }) => query.versionId === undefined || version.versionId === query.versionId,
      )
      .filter(
        ({ version }) =>
          query.instrumentId === undefined ||
          version.contentSummary.instrumentIds.includes(query.instrumentId),
      )
      .filter(
        ({ version }) =>
          query.observationKind === undefined ||
          version.contentSummary.observationKinds.includes(query.observationKind),
      )
      .filter(
        ({ version }) =>
          query.timeframe === undefined ||
          version.contentSummary.timeframes.includes(query.timeframe),
      )
      .filter(
        ({ version }) =>
          query.sourceId === undefined || version.contentSummary.sourceIds.includes(query.sourceId),
      )
      .filter(
        ({ version }) =>
          query.lifecycleState === undefined || version.lifecycleState === query.lifecycleState,
      )
      .filter(
        ({ version }) =>
          query.integrityStatus === undefined || version.integrity.status === query.integrityStatus,
      )
      .filter(
        ({ version }) =>
          query.qualityQualification === undefined ||
          version.qualityReferences.some(
            (reference) => reference.qualification === query.qualityQualification,
          ),
      )
      .filter(
        ({ version }) =>
          query.intendedUse === undefined ||
          version.eligibility.some((eligibility) => eligibility.intendedUse === query.intendedUse),
      )
      .filter(
        ({ version }) =>
          query.createdAfter === undefined || version.createdAt >= query.createdAfter,
      )
      .filter(
        ({ version }) =>
          query.createdBefore === undefined || version.createdAt < query.createdBefore,
      )
      .sort(compareEntries);
    const page = entries.slice(offset, offset + query.limit);
    return ok({
      entries: page.map((entry) => clone(entry)),
      ...(offset + query.limit >= entries.length
        ? {}
        : { nextCursor: String(offset + query.limit) }),
    });
  }

  public async transitionLifecycle(
    versionId: DatasetVersionId,
    transition: DatasetVersionRecord["lifecycleHistory"][number],
  ): Promise<DatasetCatalogueResult<DatasetVersionRecord>> {
    await Promise.resolve();
    const version = this.versions.get(versionId);
    if (version === undefined) {
      return this.failure("DATASET_VERSION_NOT_FOUND", "dataset version was not found", {
        versionId,
      });
    }
    if (!isLifecycleTransitionAllowed(version.lifecycleState, transition.to)) {
      return this.failure(
        "DATASET_LIFECYCLE_TRANSITION_INVALID",
        "invalid dataset lifecycle transition",
        {
          versionId,
          from: version.lifecycleState,
          to: transition.to,
        },
      );
    }
    const next = withStateFingerprint({
      ...version,
      lifecycleState: transition.to,
      lifecycleHistory: [...version.lifecycleHistory, transition],
    });
    this.versions.set(versionId, next);
    return ok(clone(next));
  }

  public async attachQualityReference(
    versionId: DatasetVersionId,
    reference: DatasetQualityReference,
  ): Promise<DatasetCatalogueResult<DatasetVersionRecord>> {
    await Promise.resolve();
    const version = this.versions.get(versionId);
    if (version === undefined) {
      return this.failure("DATASET_VERSION_NOT_FOUND", "dataset version was not found", {
        versionId,
      });
    }
    if (version.qualityReferences.some((existing) => existing.reportId === reference.reportId)) {
      return ok(clone(version));
    }
    const next = withStateFingerprint({
      ...version,
      qualityReferences: [...version.qualityReferences, reference].sort(
        (left, right) =>
          left.completedAt.localeCompare(right.completedAt) ||
          left.reportId.localeCompare(right.reportId),
      ),
    });
    this.versions.set(versionId, next);
    return ok(clone(next));
  }

  public async verifyIntegrity(
    versionId: DatasetVersionId,
    verification: DatasetIntegrityVerification,
  ): Promise<DatasetCatalogueResult<DatasetVersionRecord>> {
    await Promise.resolve();
    const version = this.versions.get(versionId);
    if (version === undefined) {
      return this.failure("DATASET_VERSION_NOT_FOUND", "dataset version was not found", {
        versionId,
      });
    }
    const next = withStateFingerprint({
      ...version,
      integrity: {
        ...version.integrity,
        status: verification.status,
        verifiedAt: verification.checkedAt,
        verificationHistory: [...version.integrity.verificationHistory, verification],
      },
    });
    this.versions.set(versionId, next);
    return ok(clone(next));
  }

  public async setActiveVersion(
    familyId: DatasetFamilyId,
    versionId: DatasetVersionId,
    expectedCurrentVersionId?: DatasetVersionId,
  ): Promise<DatasetCatalogueResult<DatasetVersionRecord>> {
    await Promise.resolve();
    const version = this.versions.get(versionId);
    if (version === undefined || version.familyId !== familyId) {
      return this.failure("DATASET_VERSION_NOT_FOUND", "dataset version was not found for family", {
        familyId,
        versionId,
      });
    }
    const current = this.activePointers.get(familyId);
    if (expectedCurrentVersionId !== undefined && current !== expectedCurrentVersionId) {
      return this.failure("DATASET_ACTIVE_VERSION_CONFLICT", "active version pointer changed", {
        familyId,
        expectedCurrentVersionId,
        current,
      });
    }
    this.activePointers.set(familyId, versionId);
    const activeVersion =
      version.lifecycleState === "ACTIVE"
        ? version
        : withStateFingerprint({ ...version, lifecycleState: "ACTIVE" });
    this.versions.set(versionId, activeVersion);
    return ok(clone(activeVersion));
  }

  public async getActiveVersion(
    familyId: DatasetFamilyId,
  ): Promise<DatasetCatalogueResult<DatasetVersionRecord>> {
    await Promise.resolve();
    const versionId = this.activePointers.get(familyId);
    if (versionId === undefined) {
      return this.failure("DATASET_VERSION_NOT_FOUND", "active dataset version was not found", {
        familyId,
      });
    }
    const version = this.versions.get(versionId);
    return version === undefined
      ? this.failure("DATASET_VERSION_NOT_FOUND", "active dataset version target was missing", {
          familyId,
          versionId,
        })
      : ok(clone(version));
  }

  public async getAncestors(
    versionId: DatasetVersionId,
    options: DatasetLineageTraversalOptions = {},
  ): Promise<DatasetCatalogueResult<DatasetLineageTraversal>> {
    await Promise.resolve();
    return this.traverse(versionId, "ANCESTORS", options);
  }

  public async getDescendants(
    versionId: DatasetVersionId,
    options: DatasetLineageTraversalOptions = {},
  ): Promise<DatasetCatalogueResult<DatasetLineageTraversal>> {
    await Promise.resolve();
    return this.traverse(versionId, "DESCENDANTS", options);
  }

  public async createSnapshot(): Promise<DatasetCatalogueResult<DatasetCatalogueSnapshot>> {
    await Promise.resolve();
    const semantic = this.semanticState();
    const snapshotFingerprint = semanticFingerprint(semantic);
    return ok({
      snapshotId: createDatasetCatalogueSnapshotId(semantic),
      createdAt: "1970-01-01T00:00:00.000Z" as never,
      familyCount: this.families.size,
      versionCount: this.versions.size,
      activePointerCount: this.activePointers.size,
      lineageEdgeCount: this.allEdges().length,
      snapshotFingerprint,
    });
  }

  public async diagnostics(): Promise<DatasetCatalogueResult<DatasetCatalogueDiagnostics>> {
    await Promise.resolve();
    const versions = [...this.versions.values()];
    const brokenLineageCount = versions.filter(
      (version) => this.lineageIssues(version).length > 0,
    ).length;
    return ok({
      state: "READY",
      familyCount: this.families.size,
      versionCount: this.versions.size,
      activeCount: versions.filter((version) => version.lifecycleState === "ACTIVE").length,
      qualifiedCount: versions.filter((version) => version.lifecycleState === "QUALIFIED").length,
      quarantinedCount: versions.filter((version) => version.lifecycleState === "QUARANTINED")
        .length,
      invalidatedCount: versions.filter((version) => version.lifecycleState === "INVALIDATED")
        .length,
      retiredCount: versions.filter((version) => version.lifecycleState === "RETIRED").length,
      integrityMismatchCount: versions.filter((version) => version.integrity.status === "MISMATCH")
        .length,
      brokenLineageCount,
      orphanCount: versions.filter((version) => isOrphan(version)).length,
      qualityLinkedCount: versions.filter((version) => version.qualityReferences.length > 0).length,
      lineageEdgeCount: this.allEdges().length,
      maximumObservedLineageDepth: this.maximumDepth(),
      recentRegistrations: [...this.recentRegistrations],
      recentFailures: [...this.recentFailures],
      repositoryStatus: brokenLineageCount === 0 ? "READY" : "DEGRADED",
      catalogueFingerprint: semanticFingerprint(this.semanticState()),
    });
  }

  protected exportStore(): StoreShape {
    return {
      families: [...this.families.values()].sort((left, right) =>
        left.familyId.localeCompare(right.familyId),
      ),
      versions: [...this.versions.values()].sort((left, right) =>
        left.versionId.localeCompare(right.versionId),
      ),
      activePointers: [...this.activePointers.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
      familyMutationVersions: [...this.familyMutationVersions.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    };
  }

  protected importStore(store: StoreShape): void {
    this.families.clear();
    this.versions.clear();
    this.activePointers.clear();
    this.familyMutationVersions.clear();
    for (const family of store.families) this.families.set(family.familyId, clone(family));
    for (const version of store.versions) this.versions.set(version.versionId, clone(version));
    for (const [familyId, versionId] of store.activePointers)
      this.activePointers.set(familyId, versionId);
    for (const [familyId, version] of store.familyMutationVersions) {
      this.familyMutationVersions.set(familyId, version);
    }
  }

  private validateLineage(version: DatasetVersionRecord): DatasetCatalogueResult<void> {
    for (const edge of version.lineage.edges) {
      if (
        edge.source.nodeType === "DATASET_VERSION" &&
        edge.target.nodeType === "DATASET_VERSION" &&
        edge.source.datasetVersionId === edge.target.datasetVersionId
      ) {
        return this.failure("DATASET_LINEAGE_SELF_REFERENCE", "dataset cannot derive from itself", {
          versionId: version.versionId,
        });
      }
      if (edge.source.nodeType === "DATASET_VERSION") {
        const parent = this.versions.get(edge.source.datasetVersionId);
        if (parent === undefined) {
          return this.failure(
            "DATASET_LINEAGE_PARENT_NOT_FOUND",
            "lineage parent dataset was not found",
            {
              parentVersionId: edge.source.datasetVersionId,
            },
          );
        }
        if (this.reaches(version.versionId, edge.source.datasetVersionId)) {
          return this.failure("DATASET_LINEAGE_CYCLE", "lineage edge would create a cycle", {
            parentVersionId: edge.source.datasetVersionId,
            versionId: version.versionId,
          });
        }
      }
    }
    return ok(undefined);
  }

  private traverse(
    versionId: DatasetVersionId,
    direction: "ANCESTORS" | "DESCENDANTS",
    options: DatasetLineageTraversalOptions,
  ): DatasetCatalogueResult<DatasetLineageTraversal> {
    if (!this.versions.has(versionId)) {
      return this.failure("DATASET_VERSION_NOT_FOUND", "dataset version was not found", {
        versionId,
      });
    }
    const maxDepth = options.maxDepth ?? 25;
    const maxNodes = options.maxNodes ?? 100;
    const nodes = new Map<DatasetVersionId, DatasetVersionRecord>();
    const edges: DatasetLineageEdge[] = [];
    const queue: readonly [DatasetVersionId, number][] = [[versionId, 0]];
    const seen = new Set<DatasetVersionId>([versionId]);
    let truncated = false;
    let depth = 0;
    let cursorQueue = [...queue];
    while (cursorQueue.length > 0) {
      const [cursor, cursorDepth] = cursorQueue.shift() ?? [versionId, 0];
      depth = Math.max(depth, cursorDepth);
      if (cursorDepth >= maxDepth) {
        truncated = true;
        continue;
      }
      const related = direction === "ANCESTORS" ? this.parentsOf(cursor) : this.childrenOf(cursor);
      for (const edge of related) {
        const relatedId =
          direction === "ANCESTORS"
            ? edge.source.nodeType === "DATASET_VERSION"
              ? edge.source.datasetVersionId
              : undefined
            : edge.target.nodeType === "DATASET_VERSION"
              ? edge.target.datasetVersionId
              : undefined;
        edges.push(edge);
        if (relatedId === undefined || seen.has(relatedId)) {
          continue;
        }
        const relatedVersion = this.versions.get(relatedId);
        if (relatedVersion !== undefined) {
          nodes.set(relatedId, relatedVersion);
          seen.add(relatedId);
          cursorQueue.push([relatedId, cursorDepth + 1]);
          if (nodes.size >= maxNodes) {
            truncated = true;
            cursorQueue = [];
            break;
          }
        }
      }
    }
    const nodeList = [...nodes.values()].sort(compareVersions);
    const edgeList = [...uniqueEdges(edges)].sort(compareEdges);
    return ok({
      rootVersionId: versionId,
      nodes: nodeList.map((node) => clone(node)),
      edges: edgeList.map((edge) => clone(edge)),
      truncated,
      depth,
      fingerprint: semanticFingerprint({ versionId, direction, nodes: nodeList, edges: edgeList }),
    });
  }

  private parentsOf(versionId: DatasetVersionId): readonly DatasetLineageEdge[] {
    const version = this.versions.get(versionId);
    return version === undefined
      ? []
      : version.lineage.edges.filter((edge) => edge.target.nodeType === "DATASET_VERSION");
  }

  private childrenOf(versionId: DatasetVersionId): readonly DatasetLineageEdge[] {
    return this.allEdges().filter(
      (edge) =>
        edge.source.nodeType === "DATASET_VERSION" && edge.source.datasetVersionId === versionId,
    );
  }

  private reaches(from: DatasetVersionId, target: DatasetVersionId): boolean {
    const seen = new Set<DatasetVersionId>();
    const stack = [from];
    while (stack.length > 0) {
      const cursor = stack.pop();
      if (cursor === undefined || seen.has(cursor)) continue;
      if (cursor === target) return true;
      seen.add(cursor);
      for (const edge of this.childrenOf(cursor)) {
        if (edge.target.nodeType === "DATASET_VERSION") stack.push(edge.target.datasetVersionId);
      }
    }
    return false;
  }

  private lineageIssues(version: DatasetVersionRecord): readonly string[] {
    const issues: string[] = [];
    for (const edge of version.lineage.edges) {
      if (
        edge.source.nodeType === "DATASET_VERSION" &&
        !this.versions.has(edge.source.datasetVersionId)
      ) {
        issues.push(`missing parent ${edge.source.datasetVersionId}`);
      }
      if (
        edge.source.nodeType === "DATASET_VERSION" &&
        edge.source.datasetVersionId === version.versionId
      ) {
        issues.push("self-lineage");
      }
    }
    return issues;
  }

  private allEdges(): readonly DatasetLineageEdge[] {
    return [...this.versions.values()].flatMap((version) => [...version.lineage.edges]);
  }

  private entries(): readonly DatasetCatalogueEntry[] {
    return [...this.versions.values()].flatMap((version) => {
      const family = this.families.get(version.familyId);
      return family === undefined ? [] : [{ family, version }];
    });
  }

  private semanticState(): unknown {
    return {
      families: [...this.families.values()].sort((left, right) =>
        left.familyId.localeCompare(right.familyId),
      ),
      versions: [...this.versions.values()].sort((left, right) =>
        left.versionId.localeCompare(right.versionId),
      ),
      activePointers: [...this.activePointers.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    };
  }

  private maximumDepth(): number {
    let maximum = 0;
    for (const versionId of this.versions.keys()) {
      const traversal = this.traverse(versionId, "ANCESTORS", { maxDepth: 100, maxNodes: 1000 });
      if (traversal.ok) maximum = Math.max(maximum, traversal.value.depth);
    }
    return maximum;
  }

  private requireFamily(familyId: DatasetFamilyId): DatasetFamilyDefinition {
    const family = this.families.get(familyId);
    if (family === undefined) {
      throw new Error(`missing family after repository invariant: ${familyId}`);
    }
    return clone(family);
  }

  private failure<T>(
    code: Parameters<typeof datasetCatalogueError>[0]["code"],
    message: string,
    details?: Record<string, unknown>,
  ): DatasetCatalogueResult<T> {
    const error = datasetCatalogueError({
      code,
      message,
      timestamp: "1970-01-01T00:00:00.000Z" as never,
      ...(details === undefined ? {} : { details }),
    });
    this.recentFailures.unshift(error);
    this.recentFailures.splice(10);
    return fail(error);
  }
}

export class LocalFilesystemDatasetCatalogueRepository extends InMemoryDatasetCatalogueRepository {
  public constructor(private readonly root: string) {
    super();
  }

  public async load(): Promise<DatasetCatalogueResult<void>> {
    const path = safeJoin(resolve(this.root), "catalogue.json");
    if (!path.ok) return path;
    try {
      const parsed = JSON.parse(await readFile(path.value, "utf8")) as StoreShape;
      this.importStore(parsed);
      return ok(undefined);
    } catch {
      return ok(undefined);
    }
  }

  public override async register(
    entry: DatasetCatalogueEntry,
    options: DatasetRepositoryWriteOptions = {},
  ) {
    const result = await super.register(entry, options);
    if (result.ok) await this.persist();
    return result;
  }

  public override async transitionLifecycle(
    versionId: DatasetVersionId,
    transition: DatasetVersionRecord["lifecycleHistory"][number],
  ) {
    const result = await super.transitionLifecycle(versionId, transition);
    if (result.ok) await this.persist();
    return result;
  }

  public override async attachQualityReference(
    versionId: DatasetVersionId,
    reference: DatasetQualityReference,
  ) {
    const result = await super.attachQualityReference(versionId, reference);
    if (result.ok) await this.persist();
    return result;
  }

  public override async verifyIntegrity(
    versionId: DatasetVersionId,
    verification: DatasetIntegrityVerification,
  ) {
    const result = await super.verifyIntegrity(versionId, verification);
    if (result.ok) await this.persist();
    return result;
  }

  public override async setActiveVersion(
    familyId: DatasetFamilyId,
    versionId: DatasetVersionId,
    expectedCurrentVersionId?: DatasetVersionId,
  ) {
    const result = await super.setActiveVersion(familyId, versionId, expectedCurrentVersionId);
    if (result.ok) await this.persist();
    return result;
  }

  private async persist(): Promise<void> {
    const root = resolve(this.root);
    const staging = safeJoin(root, "catalogue.json.tmp");
    const target = safeJoin(root, "catalogue.json");
    if (!staging.ok || !target.ok) {
      throw new Error("dataset catalogue storage path escaped root");
    }
    await mkdir(root, { recursive: true });
    await writeFile(staging.value, stableStringify(this.exportStore()));
    await rm(target.value, { force: true });
    await rename(staging.value, target.value);
  }
}

const withStateFingerprint = (version: DatasetVersionRecord): DatasetVersionRecord => ({
  ...version,
  catalogueStateFingerprint: semanticFingerprint({
    versionId: version.versionId,
    lifecycleState: version.lifecycleState,
    lifecycleHistory: version.lifecycleHistory,
    qualityReferences: version.qualityReferences,
    integrity: version.integrity,
    eligibility: version.eligibility,
  }),
});

const compareEntries = (left: DatasetCatalogueEntry, right: DatasetCatalogueEntry): number =>
  left.family.familyId.localeCompare(right.family.familyId) ||
  left.version.versionSequence - right.version.versionSequence ||
  left.version.versionId.localeCompare(right.version.versionId);

const compareVersions = (left: DatasetVersionRecord, right: DatasetVersionRecord): number =>
  left.familyId.localeCompare(right.familyId) ||
  left.versionSequence - right.versionSequence ||
  left.versionId.localeCompare(right.versionId);

const compareEdges = (left: DatasetLineageEdge, right: DatasetLineageEdge): number =>
  left.edgeId.localeCompare(right.edgeId);

const uniqueEdges = (edges: readonly DatasetLineageEdge[]): readonly DatasetLineageEdge[] => [
  ...new Map(edges.map((edge) => [edge.edgeId, edge])).values(),
];

const isLifecycleTransitionAllowed = (
  from: DatasetVersionRecord["lifecycleState"],
  to: DatasetVersionRecord["lifecycleState"],
): boolean => {
  if (from === to) return true;
  if (from === "INVALIDATED" && to !== "RETIRED") return false;
  if (from === "RETIRED") return false;
  return true;
};

const isOrphan = (version: DatasetVersionRecord): boolean =>
  version.provenance.originType === "DERIVED" && version.lineage.parents.length === 0;

const safeJoin = (root: string, ...segments: readonly string[]): DatasetCatalogueResult<string> => {
  const candidate = normalize(join(root, ...segments));
  if (!candidate.startsWith(root)) {
    return fail(
      datasetCatalogueError({
        code: "DATASET_CATALOGUE_PERSISTENCE_FAILED",
        message: "dataset catalogue storage path escapes configured root",
        timestamp: "1970-01-01T00:00:00.000Z" as never,
      }),
    );
  }
  return ok(candidate);
};

const clone = <T>(value: T): T => structuredClone(value);
