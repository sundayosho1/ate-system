import { z } from "zod";
import { calendarSchema, utcCalendar, standardTimeframes, TimeframeRegistry } from "./calendar.js";
import {
  multitimeframeSettings,
  type EffectiveConfiguration,
  type ConfigurationKey,
} from "@ate/configuration";
import { freeze, hash } from "./primitives.js";
export type Options = {
  readonly [
    K in keyof typeof multitimeframeSettings
  ]: (typeof multitimeframeSettings)[K][0] extends boolean ? boolean : number;
};
export const defaultOptions = freeze(
  Object.fromEntries(Object.entries(multitimeframeSettings).map(([k, v]) => [k, v[0]])) as Options,
);
export function validateOptions(options: Options): Options {
  for (const [key, s] of Object.entries(multitimeframeSettings)) {
    const v = options[key as keyof Options];
    if (
      typeof s[0] === "boolean"
        ? typeof v !== "boolean"
        : typeof v !== "number" || !Number.isSafeInteger(v) || v < s[1] || v > s[2]
    )
      throw Error("CONFIGURATION_INVALID");
  }
  if (
    options.correctionHorizonMs < options.allowedLatenessMs ||
    options.maxSnapshotTimeframes > options.maxTimeframes
  )
    throw Error("CONFIGURATION_CONSTRAINT");
  return freeze({ ...options });
}
export const optionsFromEffective = (effective: EffectiveConfiguration) => {
  const values: Record<string, unknown> = { ...defaultOptions };
  for (const key of Object.keys(values)) {
    const r = effective.values.get(`data.multitimeframe.${key}` as ConfigurationKey);
    if (r) values[key] = r.value;
  }
  return {
    options: validateOptions(values as Options),
    configurationFingerprint: effective.fingerprint,
  };
};
export const policyFingerprint = (value: unknown) => hash(value);

const materialSchema = z
  .object({
    calendar: calendarSchema.optional(),
    timeframes: z
      .array(
        z
          .object({
            code: z.string().max(16),
            kind: z.enum(["FIXED", "CALENDAR"]),
            durationMs: z.number().int().optional(),
            period: z.enum(["DAY", "WEEK", "MONTH"]).optional(),
            anchor: z.string(),
            anchorRule: z.enum(["UTC", "SESSION_OPEN"]),
            version: z.string().max(64),
            enabled: z.boolean(),
          })
          .strict(),
      )
      .max(32)
      .optional(),
    directTimeframes: z.array(z.string().max(16)).min(1).max(32).optional(),
    edges: z
      .array(z.object({ child: z.string().max(16), parent: z.string().max(16) }).strict())
      .max(32)
      .optional(),
  })
  .strict();
export function materialPolicyFromEffective(effective: EffectiveConfiguration) {
  const raw =
    effective.values.get("data.multitimeframe.policyJson" as ConfigurationKey)?.value ?? "{}";
  if (typeof raw !== "string" || raw.length > 65536) throw Error("POLICY_BOUNDS");
  const p = materialSchema.parse(JSON.parse(raw));
  return {
    calendar: p.calendar ?? utcCalendar,
    registry: new TimeframeRegistry(
      (p.timeframes ?? standardTimeframes()) as ReturnType<typeof standardTimeframes>,
    ),
    directTimeframes: p.directTimeframes ?? ["M1", "M5", "M15", "H1", "H4"],
    edges: p.edges ?? [],
  };
}
