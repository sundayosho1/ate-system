import type { Clock, LocalDateTime } from "@ate/time";
import { resolveLocalDateTime, timeZoneId } from "@ate/time";

import { fail, historicalError, ok } from "./errors.js";
import { fingerprint } from "./serialization.js";
import type {
  HistoricalImportPlan,
  HistoricalDataMappingSpecification,
  HistoricalResourceLimits,
  HistoricalResult,
  HistoricalSourceArtifact,
  RejectionPolicy,
  SourceSchemaSummary,
  FormatDetectionEvidence,
  DuplicatePolicy,
  HistoricalImportPlanId,
} from "./types.js";

export const createHistoricalImportPlan = (input: {
  artifact: HistoricalSourceArtifact;
  formatEvidence: FormatDetectionEvidence;
  schema: SourceSchemaSummary;
  mapping: HistoricalDataMappingSpecification;
  rejectionPolicy: RejectionPolicy;
  duplicatePolicy: DuplicatePolicy;
  resourceLimits: HistoricalResourceLimits;
  clock: Clock;
}): HistoricalResult<HistoricalImportPlan> => {
  const mappingValidation = validateMapping(input.mapping);
  if (!mappingValidation.ok) {
    return mappingValidation;
  }
  const planFingerprint = fingerprint({
    artifactChecksum: input.artifact.checksum,
    detectedFormat: input.artifact.detectedFormat,
    mapping: input.mapping,
    rejectionPolicy: input.rejectionPolicy,
    duplicatePolicy: input.duplicatePolicy,
    resourceLimits: input.resourceLimits,
    canonicalSchemaVersion: "prompt-13-market-observation-v1",
  });
  const planId =
    `hip-${planFingerprint.replace("sha256:", "").slice(0, 32)}` as HistoricalImportPlanId;
  return ok({
    planId,
    artifact: input.artifact,
    formatEvidence: input.formatEvidence,
    schema: input.schema,
    mapping: input.mapping,
    rejectionPolicy: input.rejectionPolicy,
    duplicatePolicy: input.duplicatePolicy,
    resourceLimits: input.resourceLimits,
    planFingerprint,
    canonicalSchemaVersion: "prompt-13-market-observation-v1",
    createdAt: input.clock.now(),
  });
};

export const validateMapping = (
  mapping: HistoricalDataMappingSpecification,
): HistoricalResult<void> => {
  if (mapping.mappingId.trim().length === 0 || mapping.version.trim().length === 0) {
    return mappingFailure("mapping id and version are required");
  }
  if (mapping.targetKind === "BAR" && mapping.timeframe === undefined) {
    return mappingFailure("bar imports require explicit timeframe mapping");
  }
  if (
    mapping.targetKind === "BAR" &&
    (mapping.intervalStart === undefined || mapping.intervalEnd === undefined)
  ) {
    return mappingFailure("bar imports require explicit interval start and end timestamp mappings");
  }
  if (
    mapping.targetKind === "BAR" &&
    mapping.volumes.some(
      (volume) => volume.volumeType === "NOT_AVAILABLE" && volume.field !== undefined,
    )
  ) {
    return mappingFailure("NOT_AVAILABLE volume must not map a source field");
  }
  if (
    mapping.volumes.some(
      (volume) => volume.volumeType !== "NOT_AVAILABLE" && volume.field === undefined,
    )
  ) {
    return mappingFailure("mapped volume semantics require a source field unless NOT_AVAILABLE");
  }
  return ok(undefined);
};

export const normalizeTimestamp = (input: {
  value: unknown;
  timezone: string;
}): HistoricalResult<string> => {
  if (typeof input.value !== "string" || input.value.trim().length === 0) {
    return mappingFailure(
      "timestamp field is missing or not a string",
      "HISTORICAL_TIMESTAMP_MAPPING_INVALID",
    );
  }
  const raw = input.value.trim();
  if (/([zZ]|[+-]\d{2}:\d{2})$/u.test(raw)) {
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      return mappingFailure("timestamp field is invalid", "HISTORICAL_TIMESTAMP_MAPPING_INVALID");
    }
    return ok(parsed.toISOString());
  }
  if (input.timezone === "UTC") {
    const parsed = new Date(`${raw.replace(" ", "T")}Z`);
    if (Number.isNaN(parsed.getTime())) {
      return mappingFailure(
        "UTC naive timestamp field is invalid",
        "HISTORICAL_TIMESTAMP_MAPPING_INVALID",
      );
    }
    return ok(parsed.toISOString());
  }
  const timezone = timeZoneId(input.timezone);
  if (!timezone.ok) {
    return mappingFailure("source timezone is invalid", "HISTORICAL_TIMEZONE_REQUIRED");
  }
  const local = parseLocalDateTime(raw);
  if (!local.ok) {
    return local;
  }
  const resolved = resolveLocalDateTime(local.value, timezone.value);
  if (!resolved.ok) {
    return mappingFailure(resolved.error.message, "HISTORICAL_TIMESTAMP_MAPPING_INVALID");
  }
  const instant = resolved.value[0];
  if (instant === undefined) {
    return mappingFailure(
      "timezone resolution produced no UTC instant",
      "HISTORICAL_TIMESTAMP_MAPPING_INVALID",
    );
  }
  return ok(instant);
};

const parseLocalDateTime = (value: string): HistoricalResult<LocalDateTime> => {
  const match =
    /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})(?:[T\s](?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2})(?:\.(?<millisecond>\d{1,3}))?)?)?$/u.exec(
      value,
    );
  if (match?.groups === undefined) {
    return mappingFailure(
      "local timestamp has unsupported format",
      "HISTORICAL_TIMESTAMP_MAPPING_INVALID",
    );
  }
  return ok({
    year: Number(match.groups.year),
    month: Number(match.groups.month),
    day: Number(match.groups.day),
    hour: Number(match.groups.hour ?? "0"),
    minute: Number(match.groups.minute ?? "0"),
    second: Number(match.groups.second ?? "0"),
    millisecond: Number((match.groups.millisecond ?? "0").padEnd(3, "0")),
  });
};

const mappingFailure = (
  message: string,
  code:
    | "HISTORICAL_MAPPING_INVALID"
    | "HISTORICAL_TIMESTAMP_MAPPING_INVALID"
    | "HISTORICAL_TIMEZONE_REQUIRED" = "HISTORICAL_MAPPING_INVALID",
): HistoricalResult<never> =>
  fail(
    historicalError({
      code,
      message,
      timestamp: new Date(0).toISOString() as never,
    }),
  );
