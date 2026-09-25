import { createHash } from "node:crypto";

import type { HistoricalContentChecksum, HistoricalFingerprint } from "./types.js";

export const sha256Bytes = (content: Uint8Array): HistoricalContentChecksum =>
  `sha256:${createHash("sha256").update(content).digest("hex")}` as HistoricalContentChecksum;

export const stableStringify = (value: unknown): string => JSON.stringify(stableValue(value));

export const fingerprint = (value: unknown): HistoricalFingerprint =>
  `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}` as HistoricalFingerprint;

export const fingerprintBytes = (content: Uint8Array): HistoricalFingerprint =>
  sha256Bytes(content).replace("sha256:", "sha256:") as HistoricalFingerprint;

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
};
