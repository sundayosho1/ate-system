import type { Clock } from "@ate/time";

import { freeze } from "./context.js";
import { configurationError, fail, ok, toSafeConfigurationMessage } from "./errors.js";
import { assertScopeAllowed } from "./registry.js";
import type { ConfigurationRegistry } from "./registry.js";
import { fingerprint } from "./serialization.js";
import { layerFromLoad } from "./source.js";
import { scopeIdentity } from "./scopes.js";
import type {
  ConfigurationConflict,
  ConfigurationEntry,
  ConfigurationFingerprint,
  ConfigurationResult,
  ConfigurationSnapshot,
  ConfigurationSnapshotId,
  ConfigurationSource,
} from "./types.js";

export type BuildConfigurationSnapshotInput = Readonly<{
  registry: ConfigurationRegistry;
  sources: readonly ConfigurationSource[];
  clock: Clock;
  snapshotLabel?: string;
  maxEntries?: number;
}>;

export const buildConfigurationSnapshot = async (
  input: BuildConfigurationSnapshotInput,
): Promise<ConfigurationResult<ConfigurationSnapshot>> => {
  const maxEntries = input.maxEntries ?? 5_000;
  try {
    const layers = await Promise.all(
      input.sources.map(async (source) => layerFromLoad(await source.load())),
    );
    const entries = layers.flatMap((layer) => layer.entries);
    if (entries.length > maxEntries) {
      return fail(
        configurationError({
          code: "CONFIGURATION_LIMIT_EXCEEDED",
          message: `configuration snapshot exceeds entry limit ${maxEntries}`,
          timestamp: input.clock.now(),
          details: { entryCount: entries.length },
        }),
      );
    }
    const conflicts = [
      ...layers
        .filter(
          (layer) =>
            layer.source.criticality === "REQUIRED" &&
            (layer.source.health === "UNAVAILABLE" || layer.source.health === "STALE"),
        )
        .map((layer): ConfigurationConflict => ({
          type: "SOURCE_FAILURE",
          message: `required configuration source ${layer.source.sourceId} is ${layer.source.health}`,
          entries: [],
        })),
      ...validateEntries(input.registry, entries),
    ];
    const registryFingerprint = input.registry.fingerprint();
    const sourceFingerprints = Object.fromEntries(
      layers.map((layer) => [layer.source.sourceId, layer.fingerprint]),
    );
    const sourceHealth = Object.fromEntries(
      layers.map((layer) => [layer.source.sourceId, layer.source.health]),
    );
    const semanticFingerprint = snapshotSemanticFingerprint(
      registryFingerprint,
      sourceFingerprints,
      entries,
    );
    const snapshot: ConfigurationSnapshot = freeze({
      snapshotId: snapshotId(input.snapshotLabel ?? semanticFingerprint),
      fingerprint: semanticFingerprint,
      createdAt: input.clock.now(),
      registryFingerprint,
      sourceFingerprints,
      sourceHealth,
      entries: sortEntries(entries),
      conflicts,
    });
    return ok(snapshot);
  } catch (error) {
    return fail(
      configurationError({
        code: "CONFIGURATION_LOAD_FAILED",
        message: toSafeConfigurationMessage(error),
        timestamp: input.clock.now(),
        severity: "CRITICAL",
      }),
    );
  }
};

export const snapshotId = (value: string): ConfigurationSnapshotId =>
  `cfgsnap-${fingerprint(value).replace("sha256:", "").slice(0, 24)}` as ConfigurationSnapshotId;

const validateEntries = (
  registry: ConfigurationRegistry,
  entries: readonly ConfigurationEntry[],
): readonly ConfigurationConflict[] => {
  const conflicts: ConfigurationConflict[] = [];
  const duplicateKeys = new Map<string, ConfigurationEntry[]>();

  for (const entry of entries) {
    const definition = registry.require(entry.key);
    if (!definition.ok) {
      conflicts.push({
        type: "UNKNOWN_KEY",
        key: entry.key,
        message: definition.error.message,
        entries: [entry],
      });
      continue;
    }
    if (!assertScopeAllowed(definition.value, entry.scope.scopeType)) {
      conflicts.push({
        type: "INVALID_SCOPE",
        key: entry.key,
        message: `scope ${entry.scope.scopeType} is not allowed for ${entry.key}`,
        entries: [entry],
      });
    }
    const identity = `${entry.key}|${scopeIdentity(entry.scope)}|${entry.source.sourceId}`;
    duplicateKeys.set(identity, [...(duplicateKeys.get(identity) ?? []), entry]);
  }

  for (const duplicates of duplicateKeys.values()) {
    if (duplicates.length > 1) {
      conflicts.push({
        type: "DUPLICATE_ENTRY",
        key: duplicates[0]!.key,
        message: `duplicate configuration entry for ${duplicates[0]!.key}`,
        entries: duplicates,
      });
    }
  }

  return conflicts;
};

const snapshotSemanticFingerprint = (
  registryFingerprint: ConfigurationFingerprint,
  sourceFingerprints: Readonly<Record<string, ConfigurationFingerprint>>,
  entries: readonly ConfigurationEntry[],
): ConfigurationFingerprint =>
  fingerprint({
    registryFingerprint,
    sourceFingerprints,
    entries: sortEntries(entries).map((entry) => ({
      key: entry.key,
      domain: entry.domain,
      scope: entry.scope,
      value: entry.value,
      operation: entry.operation,
      state: entry.state,
      sourceId: entry.source.sourceId,
      sourceType: entry.source.sourceType,
      metadata: entry.metadata,
    })),
  });

const sortEntries = (entries: readonly ConfigurationEntry[]): readonly ConfigurationEntry[] =>
  [...entries].sort((left, right) =>
    `${left.key}|${scopeIdentity(left.scope)}|${left.source.sourceId}`.localeCompare(
      `${right.key}|${scopeIdentity(right.scope)}|${right.source.sourceId}`,
    ),
  );
