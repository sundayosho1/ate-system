import type { ConfigurationMergePolicy, ConfigurationValue } from "./types.js";

export type MergeOutcome =
  | Readonly<{ ok: true; value: ConfigurationValue | undefined }>
  | Readonly<{ ok: false; message: string }>;

export const mergeConfigurationValues = (
  policy: ConfigurationMergePolicy,
  inherited: ConfigurationValue | undefined,
  override: ConfigurationValue | undefined,
): MergeOutcome => {
  if (override === undefined) {
    return { ok: true, value: undefined };
  }
  switch (policy) {
    case "REPLACE":
    case "NO_MERGE":
      return { ok: true, value: override };
    case "DEEP_MERGE":
      if (isPlainObject(inherited) && isPlainObject(override)) {
        return { ok: true, value: deepMerge(inherited, override) };
      }
      return { ok: true, value: override };
    case "APPEND":
      if (isConfigurationArray(inherited) && isConfigurationArray(override)) {
        return { ok: true, value: [...inherited, ...override] };
      }
      return { ok: false, message: "APPEND merge policy requires list values" };
    case "SET_UNION":
      if (isConfigurationArray(inherited) && isConfigurationArray(override)) {
        return {
          ok: true,
          value: [...new Set([...inherited, ...override].map((item) => JSON.stringify(item)))].map(
            (item) => JSON.parse(item) as ConfigurationValue,
          ),
        };
      }
      return { ok: false, message: "SET_UNION merge policy requires list values" };
  }
};

const isPlainObject = (
  value: ConfigurationValue | undefined,
): value is Readonly<Record<string, ConfigurationValue>> =>
  value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value);

const isConfigurationArray = (
  value: ConfigurationValue | undefined,
): value is readonly ConfigurationValue[] => Array.isArray(value);

const deepMerge = (
  inherited: Readonly<Record<string, ConfigurationValue>>,
  override: Readonly<Record<string, ConfigurationValue>>,
): Readonly<Record<string, ConfigurationValue>> => {
  const merged: Record<string, ConfigurationValue> = { ...inherited };
  for (const [key, value] of Object.entries(override)) {
    const prior = inherited[key];
    merged[key] = isPlainObject(prior) && isPlainObject(value) ? deepMerge(prior, value) : value;
  }
  return merged;
};
