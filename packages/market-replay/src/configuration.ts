import { z } from "zod";
import { replayLimitSettings, type EffectiveConfiguration } from "@ate/configuration";
import { freeze } from "@ate/multitimeframe";
export type ReplayLimits = { [K in keyof typeof replayLimitSettings]: number };
export const defaultReplayLimits: ReplayLimits = freeze(
  Object.fromEntries(
    Object.entries(replayLimitSettings).map(([k, v]) => [k, v[0]]),
  ) as ReplayLimits,
);
export function validateReplayLimits(value: unknown): ReplayLimits {
  const schema = z
    .object(
      Object.fromEntries(
        Object.entries(replayLimitSettings).map(([k, v]) => [
          k,
          z.number().int().min(v[1]).max(v[2]),
        ]),
      ),
    )
    .strict();
  const parsed = schema.parse(value) as ReplayLimits;
  if (
    parsed.maxEventsPerBatch > parsed.maxEventsPerSession ||
    parsed.maxCheckpoints > parsed.maxRepositoryOperations
  )
    throw Error("REPLAY_LIMIT_CONSTRAINT");
  return freeze(parsed);
}
export function replayFromEffective(e: EffectiveConfiguration) {
  const values = { ...defaultReplayLimits };
  for (const key of Object.keys(values) as (keyof ReplayLimits)[]) {
    const v = e.values.get(`research.replay.${key}` as Parameters<typeof e.values.get>[0])?.value;
    if (v !== undefined) values[key] = z.number().parse(v);
  }
  return freeze({
    limits: validateReplayLimits(values),
    enabled: z
      .boolean()
      .parse(
        e.values.get("research.replay.enabled" as Parameters<typeof e.values.get>[0])?.value ??
          false,
      ),
    mode: z
      .enum(["EVENT_TIME_RECONSTRUCTION", "VERIFIED_POINT_IN_TIME"])
      .parse(
        e.values.get("research.replay.defaultMode" as Parameters<typeof e.values.get>[0])?.value ??
          "EVENT_TIME_RECONSTRUCTION",
      ),
    requireAvailabilityEvidence: z
      .boolean()
      .parse(
        e.values.get(
          "research.replay.requireAvailabilityEvidence" as Parameters<typeof e.values.get>[0],
        )?.value ?? true,
      ),
    failOnSourceGap: z
      .boolean()
      .parse(
        e.values.get("research.replay.failOnSourceGap" as Parameters<typeof e.values.get>[0])
          ?.value ?? false,
      ),
    orderingPolicy: z
      .literal("AVAILABILITY_SOURCE_IDENTITY_V1")
      .parse(
        e.values.get("research.replay.orderingPolicy" as Parameters<typeof e.values.get>[0])
          ?.value ?? "AVAILABILITY_SOURCE_IDENTITY_V1",
      ),
    configurationFingerprint: e.fingerprint,
  });
}
