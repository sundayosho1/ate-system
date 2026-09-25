import {
  domainSchemas,
  parseDomainContract,
  type InstrumentId,
  type MarketObservation,
  type Price,
  type Quantity,
  type UtcTimestamp,
} from "@ate/domain";
import type { Clock } from "@ate/time";

import { fail, historicalError, ok } from "./errors.js";
import { normalizeTimestamp } from "./mapping.js";
import { fingerprint } from "./serialization.js";
import type {
  FieldSelector,
  HistoricalImportPlan,
  HistoricalImportSessionId,
  HistoricalError,
  HistoricalRejectionRecord,
  HistoricalResult,
  ParsedHistoricalRecord,
  TimeframeMapping,
} from "./types.js";

export type NormalizedRecordResult = HistoricalResult<
  Readonly<{
    observation: MarketObservation;
    semanticFingerprint: string;
  }>
>;

export const normalizeHistoricalRecord = (input: {
  plan: HistoricalImportPlan;
  record: ParsedHistoricalRecord;
  sessionId: HistoricalImportSessionId;
  clock: Clock;
}): NormalizedRecordResult => {
  const mapping = input.plan.mapping;
  const instrument = resolveInstrument(mapping.instrument, input.record.values);
  if (!instrument.ok) {
    return instrument;
  }
  const eventTime = normalizeTimestamp({
    value: input.record.values[mapping.eventTime.field],
    timezone: mapping.eventTime.timezone,
  });
  if (!eventTime.ok) {
    return eventTime;
  }
  const sourceTime =
    mapping.sourceTime === undefined
      ? undefined
      : normalizeTimestamp({
          value: input.record.values[mapping.sourceTime.field],
          timezone: mapping.sourceTime.timezone,
        });
  if (sourceTime !== undefined && !sourceTime.ok) {
    return sourceTime;
  }
  const providerSymbol = selectOptional(mapping.providerSymbol, input.record.values);
  const observationId = deterministicObservationId({
    artifactChecksum: input.plan.artifact.checksum,
    planFingerprint: input.plan.planFingerprint,
    sourceOrder: input.record.sourceOrder,
    kind: mapping.targetKind,
    eventTime: eventTime.value,
    instrumentId: instrument.value,
  });

  const base = {
    schemaVersion: 1,
    observationId,
    observationKind: mapping.targetKind,
    instrumentId: instrument.value,
    source: mapping.source,
    ...(providerSymbol === undefined ? {} : { providerSymbol }),
    eventTime: eventTime.value,
    receivedAt: input.clock.now(),
    ...(sourceTime === undefined ? {} : { sourceTime: sourceTime.value }),
    sourceTimestampPrecision: mapping.eventTime.precision,
    provenance: {
      source: mapping.source,
      ...(providerSymbol === undefined ? {} : { providerSymbol }),
      sourceObservationId: `${input.plan.artifact.artifactId}:${input.record.sourceOrder}`,
      sourceSchemaVersion: mapping.version,
      sourceTime: sourceTime?.ok ? sourceTime.value : eventTime.value,
      sourceTimestampPrecision: mapping.eventTime.precision,
      origin: "OBSERVED",
      deliveryMode: "HISTORICAL",
      metadata: {
        "historical.artifact": input.plan.artifact.artifactId,
        "historical.row": String(input.record.sourceOrder),
      },
    },
    metadata: {
      "historical.import-plan": input.plan.planId,
    },
  };

  const candidate = buildObservationPayload(base, input.plan, input.record);
  if (!candidate.ok) {
    return candidate;
  }
  const parsed = parseDomainContract(domainSchemas.marketObservation, candidate.value);
  if (!parsed.ok) {
    return fail(
      historicalError({
        code: "HISTORICAL_RECORD_INVALID",
        message: "canonical Prompt 13 market observation validation failed",
        timestamp: input.clock.now(),
        details: {
          observationId,
          issues: parsed.issues.map((issue) => issue.message),
        },
      }),
    );
  }
  return ok({
    observation: parsed.value,
    semanticFingerprint: fingerprint({
      ...parsed.value,
      observationId: undefined,
      receivedAt: undefined,
      provenance: {
        ...parsed.value.provenance,
        sourceObservationId: undefined,
        metadata: undefined,
      },
      metadata: undefined,
    }),
  });
};

export const rejectionFromError = (input: {
  sessionId: HistoricalImportSessionId;
  plan: HistoricalImportPlan;
  record: ParsedHistoricalRecord;
  error: HistoricalError;
  clock: Clock;
}): HistoricalRejectionRecord => ({
  rejectionId: `rej-${fingerprint({
    sessionId: input.sessionId,
    location: input.record.location,
    code: input.error.code,
  })
    .replace("sha256:", "")
    .slice(0, 32)}`,
  sessionId: input.sessionId,
  artifactId: input.plan.artifact.artifactId,
  location: input.record.location,
  reasonCode: input.error.code,
  safeSource: safeSource(input.record.values),
  canonicalErrors: [
    input.error.message,
    ...((input.error.details?.issues as readonly string[] | undefined) ?? []),
  ],
  rejectedAt: input.clock.now(),
});

const buildObservationPayload = (
  base: Readonly<Record<string, unknown>>,
  plan: HistoricalImportPlan,
  record: ParsedHistoricalRecord,
): HistoricalResult<Record<string, unknown>> => {
  const fields = plan.mapping.fields;
  switch (plan.mapping.targetKind) {
    case "QUOTE":
      return ok({
        ...base,
        bid: priceFromSelector(fields.bid, record.values, plan),
        ask: priceFromSelector(fields.ask, record.values, plan),
        bidSize: quantityFromSelector(fields.bidSize, record.values, "ASSET_UNITS"),
        askSize: quantityFromSelector(fields.askSize, record.values, "ASSET_UNITS"),
      });
    case "TRADE":
      return ok({
        ...base,
        price: priceFromSelector(fields.tradePrice, record.values, plan),
        quantity: quantityFromSelector(fields.tradeQuantity, record.values, "ASSET_UNITS"),
        sourceTradeId: selectOptional(fields.sourceTradeId, record.values),
      });
    case "BAR": {
      const intervalStart =
        plan.mapping.intervalStart === undefined
          ? undefined
          : normalizeTimestamp({
              value: record.values[plan.mapping.intervalStart.field],
              timezone: plan.mapping.intervalStart.timezone,
            });
      const intervalEnd =
        plan.mapping.intervalEnd === undefined
          ? undefined
          : normalizeTimestamp({
              value: record.values[plan.mapping.intervalEnd.field],
              timezone: plan.mapping.intervalEnd.timezone,
            });
      if (intervalStart === undefined || intervalEnd === undefined) {
        return historicalFailure(
          "HISTORICAL_TIMESTAMP_MAPPING_INVALID",
          "bar interval timestamps are required",
        );
      }
      if (!intervalStart.ok) {
        return intervalStart;
      }
      if (!intervalEnd.ok) {
        return intervalEnd;
      }
      return ok({
        ...base,
        timeframe: resolveTimeframe(plan.mapping.timeframe, record.values),
        intervalStart: intervalStart.value,
        intervalEnd: intervalEnd.value,
        open: priceFromSelector(fields.open, record.values, plan),
        high: priceFromSelector(fields.high, record.values, plan),
        low: priceFromSelector(fields.low, record.values, plan),
        close: priceFromSelector(fields.close, record.values, plan),
        volumes: plan.mapping.volumes.map((volume) => ({
          volumeType: volume.volumeType,
          ...(volume.field === undefined
            ? {}
            : {
                quantity: quantityFromValue(
                  record.values[volume.field],
                  volume.unit,
                  plan.mapping.nullMarkers,
                ),
              }),
        })),
        completeness: "FINAL",
      });
    }
    case "MARKET_STATUS":
      return ok({
        ...base,
        status: selectRequired(fields.status, record.values),
        statusSource: "PROVIDER_SUPPLIED",
      });
    case "TICK":
      return ok({
        ...base,
        tickKind: "QUOTE",
        quote: {
          bid: priceFromSelector(fields.bid, record.values, plan),
          ask: priceFromSelector(fields.ask, record.values, plan),
        },
      });
  }
};

const selectOptional = (
  selector: FieldSelector | undefined,
  values: Readonly<Record<string, unknown>>,
): string | undefined => {
  if (selector === undefined) {
    return undefined;
  }
  if (selector.kind === "FIXED") {
    return selector.value;
  }
  const value = values[selector.field];
  return valueToString(value);
};

const selectRequired = (
  selector: FieldSelector | undefined,
  values: Readonly<Record<string, unknown>>,
): string | undefined => selectOptional(selector, values);

const priceFromSelector = (
  selector: FieldSelector | undefined,
  values: Readonly<Record<string, unknown>>,
  plan: HistoricalImportPlan,
): Price | undefined => {
  const raw = selectOptional(selector, values);
  if (raw === undefined || plan.mapping.nullMarkers.includes(raw)) {
    return undefined;
  }
  return {
    value: normalizeDecimalString(raw) as Price["value"],
    instrumentId: resolveInstrumentOrThrow(plan.mapping.instrument, values),
  };
};

const quantityFromSelector = (
  selector: FieldSelector | undefined,
  values: Readonly<Record<string, unknown>>,
  unit: Quantity["unit"],
): Quantity | undefined => {
  const raw = selectOptional(selector, values);
  if (raw === undefined) {
    return undefined;
  }
  return quantityFromValue(raw, unit, []);
};

const quantityFromValue = (
  raw: unknown,
  unit: Quantity["unit"],
  nullMarkers: readonly string[],
): Quantity | undefined => {
  const value = String(raw);
  if (nullMarkers.includes(value)) {
    return undefined;
  }
  return {
    value: normalizeDecimalString(value),
    unit,
  } as Quantity;
};

const normalizeDecimalString = (value: string): string => {
  if (!/^-?(0|[1-9]\d*)(\.\d+)?$/u.test(value)) {
    return value;
  }
  return value;
};

const resolveInstrument = (
  mapping: HistoricalImportPlan["mapping"]["instrument"],
  values: Readonly<Record<string, unknown>>,
): HistoricalResult<InstrumentId> => {
  if (mapping.kind === "FIXED") {
    return ok(mapping.instrumentId);
  }
  const raw = values[mapping.field];
  if (raw === undefined || raw === null) {
    return historicalFailure("HISTORICAL_INSTRUMENT_MISSING", "instrument field is missing");
  }
  const rawKey = valueToString(raw);
  if (rawKey === undefined) {
    return historicalFailure("HISTORICAL_INSTRUMENT_MISSING", "instrument field is not scalar");
  }
  const instrument = mapping.dictionary[rawKey];
  if (instrument === undefined) {
    return historicalFailure("HISTORICAL_INSTRUMENT_MISSING", "instrument mapping is missing");
  }
  return ok(instrument);
};

const resolveInstrumentOrThrow = (
  mapping: HistoricalImportPlan["mapping"]["instrument"],
  values: Readonly<Record<string, unknown>>,
): InstrumentId => {
  const result = resolveInstrument(mapping, values);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

const resolveTimeframe = (
  mapping: TimeframeMapping | undefined,
  values: Readonly<Record<string, unknown>>,
): unknown => {
  if (mapping === undefined) {
    return undefined;
  }
  if (mapping.kind === "FIXED") {
    return mapping.timeframe;
  }
  const raw = values[mapping.field];
  const key = valueToString(raw);
  return key === undefined ? undefined : mapping.dictionary[key];
};

const deterministicObservationId = (input: {
  artifactChecksum: string;
  planFingerprint: string;
  sourceOrder: number;
  kind: string;
  eventTime: UtcTimestamp | string;
  instrumentId: InstrumentId;
}): string => {
  const hex = fingerprint(input).replace("sha256:", "");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const safeSource = (values: Readonly<Record<string, unknown>>) =>
  Object.fromEntries(
    Object.entries(values)
      .slice(0, 16)
      .map(([key, value]) => [key, valueToString(value)?.slice(0, 128) ?? "[non-scalar]"]),
  );

const valueToString = (value: unknown): string | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
};

const historicalFailure = (
  code: Parameters<typeof historicalError>[0]["code"],
  message: string,
): HistoricalResult<never> =>
  fail(
    historicalError({
      code,
      message,
      timestamp: new Date(0).toISOString() as never,
    }),
  );
