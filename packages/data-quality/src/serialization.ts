import { createHash } from "node:crypto";

import type { DataQualityFingerprint } from "./types.js";

export const stableStringify = (value: unknown): string => JSON.stringify(stableValue(value));

export const fingerprint = (value: unknown): DataQualityFingerprint =>
  `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}` as DataQualityFingerprint;

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
