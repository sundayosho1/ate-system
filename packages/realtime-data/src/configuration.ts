import {
  realtimeSettings,
  type ConfigurationKey,
  type EffectiveConfiguration,
} from "@ate/configuration";
import { z } from "zod";
import { immutable } from "./primitives.js";

type SettingType<T> = T extends boolean ? boolean : T extends string ? string : number;
export type RealtimeOptions = {
  readonly [K in keyof typeof realtimeSettings]: SettingType<(typeof realtimeSettings)[K][0]>;
};
export const defaultRealtimeOptions = immutable(
  Object.fromEntries(
    Object.entries(realtimeSettings).map(([k, v]) => [k, v[0]]),
  ) as RealtimeOptions,
);
export const validateRealtimeOptions = (options: RealtimeOptions): RealtimeOptions => {
  for (const [key, setting] of Object.entries(realtimeSettings)) {
    const value = options[key as keyof RealtimeOptions];
    const schema =
      typeof setting[0] === "boolean"
        ? z.boolean()
        : typeof setting[0] === "string"
          ? z.string().min(setting[1]).max(setting[2])
          : z.number().int().min(setting[1]).max(setting[2]);
    if (!schema.safeParse(value).success) throw new Error(`invalid realtime option ${key}`);
  }
  if (options.reconnectMaxDelayMs < options.reconnectInitialDelayMs)
    throw new Error("invalid retry bounds");
  return immutable({ ...options });
};
export const realtimeOptionsFromEffective = (
  effective: EffectiveConfiguration,
): Readonly<{ options: RealtimeOptions; configurationFingerprint: string }> => {
  const values: Record<string, unknown> = { ...defaultRealtimeOptions };
  for (const key of Object.keys(realtimeSettings)) {
    const resolved = effective.values.get(`data.realtime.${key}` as ConfigurationKey);
    if (resolved?.value !== undefined) values[key] = resolved.value;
  }
  return {
    options: validateRealtimeOptions(values as RealtimeOptions),
    configurationFingerprint: effective.fingerprint,
  };
};
