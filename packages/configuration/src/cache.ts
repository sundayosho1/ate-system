import { contextFingerprintInput } from "./context.js";
import { fingerprint } from "./serialization.js";
import type {
  ConfigurationCacheKey,
  ConfigurationCacheSnapshot,
  ConfigurationContext,
  ConfigurationSnapshotId,
  EffectiveConfiguration,
} from "./types.js";

export class ConfigurationResolutionCache {
  private readonly cache = new Map<ConfigurationCacheKey, EffectiveConfiguration>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private invalidations = 0;

  public constructor(private readonly maxEntries: number) {
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
      throw new Error("configuration cache maxEntries must be positive");
    }
  }

  public get(
    snapshotId: ConfigurationSnapshotId,
    context: ConfigurationContext,
  ): EffectiveConfiguration | undefined {
    const key = cacheKey(snapshotId, context);
    const value = this.cache.get(key);
    if (value === undefined) {
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  public set(value: EffectiveConfiguration): void {
    const key = cacheKey(value.snapshotId, value.context);
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, value);
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.cache.delete(oldest);
      this.evictions += 1;
    }
  }

  public invalidate(): void {
    if (this.cache.size > 0) {
      this.invalidations += 1;
    }
    this.cache.clear();
  }

  public snapshot(): ConfigurationCacheSnapshot {
    return {
      size: this.cache.size,
      maxEntries: this.maxEntries,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      invalidations: this.invalidations,
    };
  }
}

export const cacheKey = (
  snapshotId: ConfigurationSnapshotId,
  context: ConfigurationContext,
): ConfigurationCacheKey =>
  fingerprint({
    snapshotId,
    context: contextFingerprintInput(context),
  }) as string as ConfigurationCacheKey;
