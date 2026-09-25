import type { Actor } from "@ate/domain";
import type { Clock } from "@ate/time";

import { freeze } from "./context.js";
import { configurationError } from "./errors.js";
import { fingerprint, stableStringify } from "./serialization.js";
import { scopeIdentity } from "./scopes.js";
import type { ConfigurationSchemaRegistry } from "./schema-registry.js";
import type {
  ConfigurationEntry,
  ConfigurationError,
  ConfigurationFingerprint,
  ConfigurationScope,
  ConfigurationSnapshot,
  ConfigurationValue,
} from "./types.js";
import type {
  ConfigurationChangeOperation,
  ConfigurationChangeSet,
  ConfigurationChangeSetId,
  ConfigurationVersion,
  ConfigurationVersionContent,
  ConfigurationVersionDiff,
  ConfigurationVersionDiffEntry,
  ConfigurationVersionEntry,
  ConfigurationVersionId,
  ConfigurationVersionIntegrityReport,
  ConfigurationVersionValueDigest,
} from "./version-types.js";

export const configurationVersionEntryIdentity = (entry: {
  key: string;
  scope: ConfigurationScope;
}): string => `${entry.key}|${scopeIdentity(entry.scope)}`;

export const configurationVersionContentFromSnapshot = (
  snapshot: ConfigurationSnapshot,
  schemaRegistry?: ConfigurationSchemaRegistry,
): ConfigurationVersionContent =>
  freeze({
    registryFingerprint: snapshot.registryFingerprint,
    sourceFingerprints: snapshot.sourceFingerprints,
    sourceHealth: snapshot.sourceHealth,
    entries: snapshot.entries
      .map((entry) => versionEntryFromConfigurationEntry(entry, schemaRegistry))
      .sort((left, right) => left.identity.localeCompare(right.identity)),
  });

export const configurationVersionContentFingerprint = (
  content: ConfigurationVersionContent,
): ConfigurationFingerprint =>
  fingerprint({
    registryFingerprint: content.registryFingerprint,
    sourceFingerprints: content.sourceFingerprints,
    entries: content.entries.map((entry) => ({
      key: entry.key,
      domain: entry.domain,
      scope: entry.scope,
      value: entry.value,
      operation: entry.operation,
      state: entry.state,
      sourceId: entry.sourceId,
      sourceType: entry.sourceType,
      metadata: entry.metadata,
    })),
  });

export const changeSetFromContent = (input: {
  prior?: ConfigurationVersionContent | undefined;
  next: ConfigurationVersionContent;
  schemaRegistry?: ConfigurationSchemaRegistry | undefined;
  reason?: string | undefined;
}): ConfigurationChangeSet => {
  const priorEntries = new Map(
    (input.prior?.entries ?? []).map((entry) => [entry.identity, entry]),
  );
  const nextEntries = new Map(input.next.entries.map((entry) => [entry.identity, entry]));
  const identities = [...new Set([...priorEntries.keys(), ...nextEntries.keys()])].sort();
  const operations: ConfigurationChangeOperation[] = [];
  for (const identity of identities) {
    const previous = priorEntries.get(identity);
    const next = nextEntries.get(identity);
    if (previous === undefined && next !== undefined) {
      operations.push(
        changeOperation("ADD", next, undefined, next, input.schemaRegistry, input.reason),
      );
      continue;
    }
    if (previous !== undefined && next === undefined) {
      operations.push(
        changeOperation(
          "REMOVE",
          previous,
          previous,
          undefined,
          input.schemaRegistry,
          input.reason,
        ),
      );
      continue;
    }
    if (
      previous !== undefined &&
      next !== undefined &&
      stableStringify(entrySemanticValue(previous)) !== stableStringify(entrySemanticValue(next))
    ) {
      operations.push(
        changeOperation("MODIFY", next, previous, next, input.schemaRegistry, input.reason),
      );
    }
  }
  const changeSetFingerprint = fingerprint({
    operations: operations.map((operation) => ({
      operation: operation.operation,
      identity: operation.identity,
      previous: operation.previous?.fingerprint,
      next: operation.next?.fingerprint,
    })),
  });
  return freeze({
    changeSetId: changeSetId(changeSetFingerprint),
    fingerprint: changeSetFingerprint,
    operationCount: operations.length,
    operations,
  });
};

export const diffConfigurationVersions = (
  from: ConfigurationVersion,
  to: ConfigurationVersion,
  limit = 100,
): ConfigurationVersionDiff => {
  const boundedLimit = Math.max(1, limit);
  const fromEntries = new Map(from.content.entries.map((entry) => [entry.identity, entry]));
  const toEntries = new Map(to.content.entries.map((entry) => [entry.identity, entry]));
  const identities = [...new Set([...fromEntries.keys(), ...toEntries.keys()])].sort();
  const added: ConfigurationVersionDiffEntry[] = [];
  const changed: ConfigurationVersionDiffEntry[] = [];
  const removed: ConfigurationVersionDiffEntry[] = [];
  let unchangedCount = 0;
  let emitted = 0;
  let truncated = false;

  for (const identity of identities) {
    const previous = fromEntries.get(identity);
    const next = toEntries.get(identity);
    if (previous === undefined && next !== undefined) {
      if (emitted >= boundedLimit) {
        truncated = true;
        continue;
      }
      added.push(diffEntry("ADD", next, undefined, next));
      emitted += 1;
      continue;
    }
    if (previous !== undefined && next === undefined) {
      if (emitted >= boundedLimit) {
        truncated = true;
        continue;
      }
      removed.push(diffEntry("REMOVE", previous, previous, undefined));
      emitted += 1;
      continue;
    }
    if (
      previous !== undefined &&
      next !== undefined &&
      stableStringify(entrySemanticValue(previous)) !== stableStringify(entrySemanticValue(next))
    ) {
      if (emitted >= boundedLimit) {
        truncated = true;
        continue;
      }
      changed.push(diffEntry("MODIFY", next, previous, next));
      emitted += 1;
      continue;
    }
    unchangedCount += 1;
  }
  const diffFingerprint = fingerprint({
    from: from.versionId,
    to: to.versionId,
    added,
    changed,
    removed,
    unchangedCount,
    truncated,
    limit: boundedLimit,
  });
  return freeze({
    fromVersionId: from.versionId,
    toVersionId: to.versionId,
    added,
    changed,
    removed,
    unchangedCount,
    truncated,
    limit: boundedLimit,
    fingerprint: diffFingerprint,
  });
};

export const snapshotFromVersionContent = (
  version: ConfigurationVersion,
  clock: Clock,
): ConfigurationSnapshot =>
  freeze({
    snapshotId: version.configurationSnapshotId,
    fingerprint: version.configurationFingerprint,
    createdAt: clock.now(),
    registryFingerprint: version.content.registryFingerprint,
    sourceFingerprints: version.content.sourceFingerprints,
    sourceHealth: version.content.sourceHealth,
    entries: version.content.entries.map(configurationEntryFromVersionEntry),
    conflicts: [],
  });

export const verifyConfigurationVersionIntegrity = (
  version: ConfigurationVersion,
  clock: Clock,
): ConfigurationVersionIntegrityReport => {
  const recalculatedConfigurationFingerprint = configurationVersionContentFingerprint(
    version.content,
  );
  const recalculatedVersionFingerprint = configurationVersionFingerprint({
    ...version,
    configurationFingerprint: recalculatedConfigurationFingerprint,
  });
  const issues: string[] = [];
  if (recalculatedConfigurationFingerprint !== version.configurationFingerprint) {
    issues.push("configuration fingerprint mismatch");
  }
  if (recalculatedVersionFingerprint !== version.versionFingerprint) {
    issues.push("version fingerprint mismatch");
  }
  if (version.sequence === 1 && version.parentVersionId !== undefined) {
    issues.push("root version must not have a parent");
  }
  if (version.parentVersionId === version.versionId) {
    issues.push("version cannot be its own parent");
  }
  return freeze({
    versionId: version.versionId,
    ok: issues.length === 0,
    checkedAt: clock.now(),
    issues,
    recalculatedConfigurationFingerprint,
    recalculatedVersionFingerprint,
  });
};

export const configurationVersionFingerprint = (
  version: Omit<ConfigurationVersion, "versionFingerprint">,
): ConfigurationFingerprint =>
  fingerprint({
    versionId: version.versionId,
    streamId: version.streamId,
    runtimeMode: version.runtimeMode,
    sequence: version.sequence,
    rootVersionId: version.rootVersionId,
    parentVersionId: version.parentVersionId,
    derivedFromVersionId: version.derivedFromVersionId,
    configurationSnapshotId: version.configurationSnapshotId,
    configurationFingerprint: version.configurationFingerprint,
    schemaFingerprint: version.schemaFingerprint,
    validationReportFingerprint: version.validationReportFingerprint,
    changeSetFingerprint: version.changeSetFingerprint,
    previousVersionFingerprint: version.previousVersionFingerprint,
    actor: version.actor,
    origin: version.origin,
    reason: version.reason,
    createdAt: version.createdAt,
    correlationId: version.correlationId,
    causationId: version.causationId,
    idempotencyKey: version.idempotencyKey,
  });

export const configurationVersionId = (value: unknown): ConfigurationVersionId =>
  `cfgver-${fingerprint(value).replace("sha256:", "").slice(0, 24)}` as ConfigurationVersionId;

export const changeSetId = (value: string): ConfigurationChangeSetId =>
  `cfgchg-${fingerprint(value).replace("sha256:", "").slice(0, 24)}` as ConfigurationChangeSetId;

export const versioningError = (input: {
  code: ConfigurationError["code"];
  message: string;
  clock: Clock;
  severity?: ConfigurationError["severity"];
  details?: Record<string, unknown>;
}): ConfigurationError =>
  configurationError({
    code: input.code,
    message: input.message,
    timestamp: input.clock.now(),
    ...(input.severity === undefined ? {} : { severity: input.severity }),
    ...(input.details === undefined ? {} : { details: input.details }),
  });

export const validateVersionActorAndReason = (
  actor: Actor,
  reason: string,
  clock: Clock,
): ConfigurationError | undefined => {
  if (actor.actorId === undefined && actor.displayName === undefined) {
    return versioningError({
      code: "CONFIGURATION_VERSION_ATTRIBUTION_REQUIRED",
      message: "configuration version requires actor identity or display name",
      clock,
      severity: "CRITICAL",
    });
  }
  if (reason.trim().length === 0 || reason.length > 500 || /[\r\n]/u.test(reason)) {
    return versioningError({
      code: "CONFIGURATION_VERSION_REASON_INVALID",
      message: "configuration version reason must be 1-500 characters without line breaks",
      clock,
    });
  }
  return undefined;
};

const versionEntryFromConfigurationEntry = (
  entry: ConfigurationEntry,
  schemaRegistry?: ConfigurationSchemaRegistry,
): ConfigurationVersionEntry => {
  const value = safeConfigurationValue(entry, schemaRegistry);
  return freeze({
    identity: configurationVersionEntryIdentity(entry),
    key: entry.key,
    domain: entry.domain,
    scope: entry.scope,
    operation: entry.operation,
    state: entry.state,
    sourceId: entry.source.sourceId,
    sourceType: entry.source.sourceType,
    loadedAt: entry.loadedAt,
    ...(value.value === undefined ? {} : { value: value.value }),
    ...(value.fingerprint === undefined ? {} : { valueFingerprint: value.fingerprint }),
    valueRedacted: value.redacted,
    metadataFingerprint: fingerprint(entry.metadata),
    metadata: entry.metadata,
  });
};

const configurationEntryFromVersionEntry = (entry: ConfigurationVersionEntry): ConfigurationEntry =>
  freeze({
    key: entry.key,
    domain: entry.domain,
    scope: entry.scope,
    ...(entry.value === undefined ? {} : { value: entry.value }),
    operation: entry.operation,
    state: entry.state,
    source: {
      sourceId: entry.sourceId as ConfigurationEntry["source"]["sourceId"],
      sourceType: entry.sourceType as ConfigurationEntry["source"]["sourceType"],
      name: entry.sourceId,
      criticality: "REQUIRED",
      failurePolicy: "FAIL_CLOSED",
      priority: 0,
      loadedAt: entry.loadedAt,
      health: "AVAILABLE",
    },
    loadedAt: entry.loadedAt,
    metadata: entry.metadata,
  });

const safeConfigurationValue = (
  entry: ConfigurationEntry,
  schemaRegistry?: ConfigurationSchemaRegistry,
): { value?: ConfigurationValue; fingerprint?: ConfigurationFingerprint; redacted: boolean } => {
  if (entry.value === undefined) {
    return { redacted: false };
  }
  const valueFingerprint = fingerprint(entry.value);
  const schema = schemaRegistry?.require(entry.key);
  if (schema?.ok === true && schema.value.sensitivity === "SECRET_REFERENCE") {
    return {
      value: redactSecretReference(entry.value),
      fingerprint: valueFingerprint,
      redacted: true,
    };
  }
  return { value: entry.value, fingerprint: valueFingerprint, redacted: false };
};

const redactSecretReference = (value: ConfigurationValue): ConfigurationValue => {
  if (value !== null && typeof value === "object" && !Array.isArray(value) && "kind" in value) {
    return {
      kind: "SECRET_REFERENCE",
      ref: "[REDACTED]",
      ...("provider" in value && value.provider !== undefined ? { provider: value.provider } : {}),
    };
  }
  return "[REDACTED]";
};

const entrySemanticValue = (entry: ConfigurationVersionEntry): unknown => ({
  valueFingerprint: entry.valueFingerprint,
  operation: entry.operation,
  state: entry.state,
  metadataFingerprint: entry.metadataFingerprint,
});

const valueDigest = (
  entry: ConfigurationVersionEntry | undefined,
): ConfigurationVersionValueDigest | undefined => {
  if (entry === undefined || entry.valueFingerprint === undefined) {
    return undefined;
  }
  return {
    fingerprint: entry.valueFingerprint,
    redacted: entry.valueRedacted,
    ...(entry.value === undefined ? {} : { value: entry.value }),
  };
};

const changeOperation = (
  operation: ConfigurationChangeOperation["operation"],
  identitySource: ConfigurationVersionEntry,
  previous: ConfigurationVersionEntry | undefined,
  next: ConfigurationVersionEntry | undefined,
  _schemaRegistry?: ConfigurationSchemaRegistry,
  reason?: string,
): ConfigurationChangeOperation => {
  const previousDigest = valueDigest(previous);
  const nextDigest = valueDigest(next);
  return freeze({
    operation,
    identity: identitySource.identity,
    key: identitySource.key,
    scope: identitySource.scope,
    ...(previousDigest === undefined ? {} : { previous: previousDigest }),
    ...(nextDigest === undefined ? {} : { next: nextDigest }),
    ...(reason === undefined ? {} : { reason }),
  });
};

const diffEntry = (
  operation: ConfigurationVersionDiffEntry["operation"],
  identitySource: ConfigurationVersionEntry,
  previous: ConfigurationVersionEntry | undefined,
  next: ConfigurationVersionEntry | undefined,
): ConfigurationVersionDiffEntry => {
  const previousDigest = valueDigest(previous);
  const nextDigest = valueDigest(next);
  return freeze({
    operation,
    identity: identitySource.identity,
    key: identitySource.key,
    scope: identitySource.scope,
    ...(previousDigest === undefined ? {} : { previous: previousDigest }),
    ...(nextDigest === undefined ? {} : { next: nextDigest }),
  });
};
