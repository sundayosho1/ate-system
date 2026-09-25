import type { RuntimeMode } from "@ate/domain";
import type { Clock } from "@ate/time";

import { freeze } from "./context.js";
import { fail, ok } from "./errors.js";
import type { ConfigurationSchemaRegistry } from "./schema-registry.js";
import {
  changeSetFromContent,
  configurationVersionContentFingerprint,
  configurationVersionContentFromSnapshot,
  configurationVersionFingerprint,
  configurationVersionId,
  diffConfigurationVersions,
  snapshotFromVersionContent,
  validateVersionActorAndReason,
  verifyConfigurationVersionIntegrity,
  versioningError,
} from "./version-core.js";
import type { ConfigurationResult } from "./types.js";
import type {
  ConfigurationVersion,
  ConfigurationVersionId,
  ConfigurationVersionIntegrityReport,
  ConfigurationVersionListFilter,
  ConfigurationVersionReconstruction,
  ConfigurationVersionRepository,
  ConfigurationVersionStreamId,
  CreateConfigurationVersionInput,
} from "./version-types.js";

export type MutableConfigurationVersionStore = {
  versions: Map<string, ConfigurationVersion>;
  currentByStream: Map<string, ConfigurationVersionId>;
  idempotency: Map<string, ConfigurationVersionId>;
};

export const createEmptyConfigurationVersionStore = (): MutableConfigurationVersionStore => ({
  versions: new Map(),
  currentByStream: new Map(),
  idempotency: new Map(),
});

export const configurationVersionStreamId = (
  runtimeMode: RuntimeMode,
  name = "default",
): ConfigurationVersionStreamId =>
  `configuration.${runtimeMode.toLowerCase()}.${name}` as ConfigurationVersionStreamId;

export class InMemoryConfigurationVersionRepository implements ConfigurationVersionRepository {
  public constructor(
    private readonly input: {
      clock: Clock;
      runtimeMode: RuntimeMode;
      schemaRegistry?: ConfigurationSchemaRegistry;
      store: MutableConfigurationVersionStore;
      streamId?: ConfigurationVersionStreamId;
      maxLineageDepth?: number;
      maxHistoryPageSize?: number;
      maxDiffEntries?: number;
    },
  ) {}

  public append(input: CreateConfigurationVersionInput): ConfigurationResult<ConfigurationVersion> {
    const actorReasonError = validateVersionActorAndReason(
      input.actor,
      input.reason,
      this.input.clock,
    );
    if (actorReasonError !== undefined) {
      return fail(actorReasonError);
    }
    const streamId = this.streamId();
    const idempotencyKey = input.idempotencyKey;
    if (idempotencyKey !== undefined) {
      const existingId = this.input.store.idempotency.get(idempotencyKey);
      if (existingId !== undefined) {
        return this.get(existingId);
      }
    }
    const current = this.input.store.currentByStream.get(streamId);
    if (current === undefined) {
      if (input.expectedParentVersionId !== undefined) {
        return fail(
          versioningError({
            code: "CONFIGURATION_VERSION_PARENT_MISMATCH",
            message: "root version cannot declare an expected parent",
            clock: this.input.clock,
          }),
        );
      }
    } else if (input.expectedParentVersionId !== current) {
      return fail(
        versioningError({
          code: "CONFIGURATION_VERSION_CONCURRENCY_CONFLICT",
          message: "expected parent does not match current configuration version",
          clock: this.input.clock,
          details: { expectedParentVersionId: input.expectedParentVersionId, current },
        }),
      );
    }
    const parent = current === undefined ? undefined : this.input.store.versions.get(current);
    if (current !== undefined && parent === undefined) {
      return fail(
        versioningError({
          code: "CONFIGURATION_VERSION_PARENT_NOT_FOUND",
          message: `current parent version is missing: ${current}`,
          clock: this.input.clock,
          severity: "CRITICAL",
        }),
      );
    }
    if (
      input.derivedFromVersionId !== undefined &&
      !this.input.store.versions.has(input.derivedFromVersionId)
    ) {
      return fail(
        versioningError({
          code: "CONFIGURATION_VERSION_PARENT_NOT_FOUND",
          message: `derived-from version is missing: ${input.derivedFromVersionId}`,
          clock: this.input.clock,
        }),
      );
    }
    const content = configurationVersionContentFromSnapshot(
      input.snapshot,
      this.input.schemaRegistry,
    );
    const configurationFingerprint = configurationVersionContentFingerprint(content);
    if (
      parent !== undefined &&
      parent.configurationFingerprint === configurationFingerprint &&
      input.allowNoSemanticChange !== true
    ) {
      return fail(
        versioningError({
          code: "CONFIGURATION_VERSION_NO_SEMANTIC_CHANGE",
          message: "configuration version would not change semantic content",
          clock: this.input.clock,
        }),
      );
    }
    const changeSet = changeSetFromContent({
      prior: parent?.content,
      next: content,
      schemaRegistry: this.input.schemaRegistry,
      reason: input.reason,
    });
    const sequence = parent === undefined ? 1 : parent.sequence + 1;
    const versionId = configurationVersionId({
      streamId,
      sequence,
      parentVersionId: parent?.versionId,
      derivedFromVersionId: input.derivedFromVersionId,
      configurationFingerprint,
      schemaFingerprint: input.schemaFingerprint,
      changeSetFingerprint: changeSet.fingerprint,
      actor: input.actor,
      reason: input.reason,
      idempotencyKey,
    });
    if (this.input.store.versions.has(versionId)) {
      return fail(
        versioningError({
          code: "CONFIGURATION_VERSION_ALREADY_EXISTS",
          message: `configuration version already exists: ${versionId}`,
          clock: this.input.clock,
        }),
      );
    }
    const rootVersionId = parent?.rootVersionId ?? versionId;
    const baseVersion: Omit<ConfigurationVersion, "versionFingerprint"> = freeze({
      versionId,
      streamId,
      runtimeMode: this.input.runtimeMode,
      sequence,
      state: "CREATED",
      rootVersionId,
      ...(parent === undefined ? {} : { parentVersionId: parent.versionId }),
      ...(input.derivedFromVersionId === undefined
        ? {}
        : { derivedFromVersionId: input.derivedFromVersionId }),
      configurationSnapshotId: input.snapshot.snapshotId,
      configurationFingerprint,
      schemaFingerprint: input.schemaFingerprint,
      ...(input.validationReport === undefined
        ? {}
        : { validationReportFingerprint: input.validationReport.fingerprint }),
      changeSetId: changeSet.changeSetId,
      changeSetFingerprint: changeSet.fingerprint,
      ...(parent === undefined ? {} : { previousVersionFingerprint: parent.versionFingerprint }),
      actor: input.actor,
      origin: input.origin,
      reason: input.reason.trim(),
      createdAt: this.input.clock.now(),
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
      ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      content,
      changeSet,
    });
    const version: ConfigurationVersion = freeze({
      ...baseVersion,
      versionFingerprint: configurationVersionFingerprint(baseVersion),
    });
    const integrity = verifyConfigurationVersionIntegrity(version, this.input.clock);
    if (!integrity.ok) {
      return fail(
        versioningError({
          code: "CONFIGURATION_VERSION_INTEGRITY_FAILED",
          message: "new configuration version failed integrity verification",
          clock: this.input.clock,
          severity: "CRITICAL",
          details: { issues: integrity.issues },
        }),
      );
    }
    this.input.store.versions.set(version.versionId, version);
    this.input.store.currentByStream.set(streamId, version.versionId);
    if (idempotencyKey !== undefined) {
      this.input.store.idempotency.set(idempotencyKey, version.versionId);
    }
    return ok(version);
  }

  public get(versionId: ConfigurationVersionId): ConfigurationResult<ConfigurationVersion> {
    const version = this.input.store.versions.get(versionId);
    if (version === undefined) {
      return fail(
        versioningError({
          code: "CONFIGURATION_VERSION_NOT_FOUND",
          message: `configuration version not found: ${versionId}`,
          clock: this.input.clock,
        }),
      );
    }
    return ok(freeze(structuredClone(version)));
  }

  public getCurrent(
    streamId: ConfigurationVersionStreamId = this.streamId(),
  ): ConfigurationResult<ConfigurationVersion> {
    const current = this.input.store.currentByStream.get(streamId);
    if (current === undefined) {
      return fail(
        versioningError({
          code: "CONFIGURATION_VERSION_CURRENT_POINTER_INVALID",
          message: `configuration version stream has no current pointer: ${streamId}`,
          clock: this.input.clock,
        }),
      );
    }
    return this.get(current);
  }

  public list(filter: ConfigurationVersionListFilter = {}): readonly ConfigurationVersion[] {
    const maxLimit = this.input.maxHistoryPageSize ?? 100;
    const limit = Math.min(Math.max(0, filter.limit ?? maxLimit), maxLimit);
    const offset = Math.max(0, filter.offset ?? 0);
    return freeze(
      [...this.input.store.versions.values()]
        .filter((version) => filter.streamId === undefined || version.streamId === filter.streamId)
        .filter(
          (version) =>
            filter.runtimeMode === undefined || version.runtimeMode === filter.runtimeMode,
        )
        .filter(
          (version) =>
            filter.actorId === undefined ||
            version.actor.actorId === filter.actorId ||
            version.actor.displayName === filter.actorId,
        )
        .filter(
          (version) =>
            filter.configurationFingerprint === undefined ||
            version.configurationFingerprint === filter.configurationFingerprint,
        )
        .filter(
          (version) =>
            filter.changedKey === undefined ||
            version.changeSet.operations.some((operation) => operation.key === filter.changedKey),
        )
        .sort(compareVersions)
        .slice(offset, offset + limit)
        .map((version) => structuredClone(version)),
    );
  }

  public childrenOf(versionId: ConfigurationVersionId): readonly ConfigurationVersion[] {
    return freeze(
      [...this.input.store.versions.values()]
        .filter((version) => version.parentVersionId === versionId)
        .sort(compareVersions)
        .map((version) => structuredClone(version)),
    );
  }

  public lineage(
    versionId: ConfigurationVersionId,
    limit = this.input.maxLineageDepth ?? 100,
  ): ConfigurationResult<readonly ConfigurationVersion[]> {
    const lineage: ConfigurationVersion[] = [];
    const seen = new Set<ConfigurationVersionId>();
    let cursor = versionId;
    const boundedLimit = Math.max(1, limit);
    while (lineage.length < boundedLimit) {
      if (seen.has(cursor)) {
        return fail(
          versioningError({
            code: "CONFIGURATION_VERSION_CYCLE_DETECTED",
            message: "configuration version lineage contains a cycle",
            clock: this.input.clock,
            severity: "CRITICAL",
          }),
        );
      }
      seen.add(cursor);
      const version = this.input.store.versions.get(cursor);
      if (version === undefined) {
        return fail(
          versioningError({
            code: "CONFIGURATION_VERSION_PARENT_NOT_FOUND",
            message: `lineage version is missing: ${cursor}`,
            clock: this.input.clock,
            severity: "CRITICAL",
          }),
        );
      }
      lineage.push(version);
      if (version.parentVersionId === undefined) {
        return ok(freeze([...lineage].reverse().map((entry) => structuredClone(entry))));
      }
      cursor = version.parentVersionId;
    }
    return fail(
      versioningError({
        code: "CONFIGURATION_VERSION_LINEAGE_INVALID",
        message: "configuration version lineage traversal limit exceeded",
        clock: this.input.clock,
      }),
    );
  }

  public diff(
    fromVersionId: ConfigurationVersionId,
    toVersionId: ConfigurationVersionId,
    limit = this.input.maxDiffEntries ?? 100,
  ) {
    const from = this.get(fromVersionId);
    if (!from.ok) {
      return from;
    }
    const to = this.get(toVersionId);
    if (!to.ok) {
      return to;
    }
    return ok(diffConfigurationVersions(from.value, to.value, limit));
  }

  public reconstruct(
    versionId: ConfigurationVersionId,
  ): ConfigurationResult<ConfigurationVersionReconstruction> {
    const version = this.get(versionId);
    if (!version.ok) {
      return version;
    }
    const integrity = verifyConfigurationVersionIntegrity(version.value, this.input.clock);
    if (!integrity.ok) {
      return fail(
        versioningError({
          code: "CONFIGURATION_VERSION_RECONSTRUCTION_FAILED",
          message: "configuration version cannot be reconstructed because integrity failed",
          clock: this.input.clock,
          severity: "CRITICAL",
          details: { issues: integrity.issues },
        }),
      );
    }
    return ok(
      freeze({
        version: version.value,
        snapshot: snapshotFromVersionContent(version.value, this.input.clock),
        integrity,
        reconstructedAt: this.input.clock.now(),
      }),
    );
  }

  public verifyIntegrity(
    versionId: ConfigurationVersionId,
  ): ConfigurationResult<ConfigurationVersionIntegrityReport> {
    const version = this.get(versionId);
    if (!version.ok) {
      return version;
    }
    return ok(verifyConfigurationVersionIntegrity(version.value, this.input.clock));
  }

  private streamId(): ConfigurationVersionStreamId {
    return this.input.streamId ?? configurationVersionStreamId(this.input.runtimeMode);
  }
}

const compareVersions = (left: ConfigurationVersion, right: ConfigurationVersion): number => {
  const streamDelta = left.streamId.localeCompare(right.streamId);
  if (streamDelta !== 0) {
    return streamDelta;
  }
  const sequenceDelta = left.sequence - right.sequence;
  if (sequenceDelta !== 0) {
    return sequenceDelta;
  }
  return left.versionId.localeCompare(right.versionId);
};
