import type { Clock } from "@ate/time";

import { freeze } from "./context.js";
import { fingerprint } from "./serialization.js";
import type {
  ConfigurationEntry,
  ConfigurationFingerprint,
  ConfigurationLayer,
  ConfigurationSource,
  ConfigurationSourceDescriptor,
  ConfigurationSourceId,
  ConfigurationSourceLoad,
} from "./types.js";

export type StaticConfigurationSourceInput = Readonly<{
  descriptor: Omit<ConfigurationSourceDescriptor, "loadedAt" | "health"> &
    Partial<Pick<ConfigurationSourceDescriptor, "health">>;
  entries: readonly Omit<ConfigurationEntry, "source" | "loadedAt">[];
  clock: Clock;
}>;

export class StaticConfigurationSource implements ConfigurationSource {
  public readonly descriptor: ConfigurationSourceDescriptor;

  public constructor(private readonly input: StaticConfigurationSourceInput) {
    this.descriptor = freeze({
      ...input.descriptor,
      health: input.descriptor.health ?? "AVAILABLE",
    });
  }

  public load(): ConfigurationSourceLoad {
    const loadedAt = this.input.clock.now();
    return freeze({
      source: { ...this.descriptor, loadedAt },
      entries: this.input.entries.map((entry) => ({ ...entry })),
      loadedAt,
    });
  }
}

export const configurationSourceId = (value: string): ConfigurationSourceId => {
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(value)) {
    throw new Error(`invalid configuration source id: ${value}`);
  }
  return value as ConfigurationSourceId;
};

export const layerFromLoad = (load: ConfigurationSourceLoad): ConfigurationLayer => {
  const entries: ConfigurationEntry[] = load.entries.map((entry) =>
    freeze({
      ...entry,
      source: load.source,
      loadedAt: load.loadedAt,
    }),
  );
  return freeze({
    source: load.source,
    entries,
    loadedAt: load.loadedAt,
    fingerprint: layerFingerprint(load.source.sourceId, entries),
  });
};

const layerFingerprint = (
  sourceId: ConfigurationSourceId,
  entries: readonly ConfigurationEntry[],
): ConfigurationFingerprint =>
  fingerprint({
    sourceId,
    entries: [...entries]
      .sort((left, right) =>
        `${left.key}|${left.scope.scopeType}|${left.scope.scopeId ?? ""}`.localeCompare(
          `${right.key}|${right.scope.scopeType}|${right.scope.scopeId ?? ""}`,
        ),
      )
      .map((entry) => ({
        key: entry.key,
        domain: entry.domain,
        scope: entry.scope,
        value: entry.value,
        operation: entry.operation,
        state: entry.state,
        metadata: entry.metadata,
      })),
  });
