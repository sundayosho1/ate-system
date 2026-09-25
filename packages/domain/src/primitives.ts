import DecimalJs from "decimal.js";
import { z } from "zod";

import { domainIssue, fail, ok, parseWithSchema, type DomainResult } from "./result.js";

export type Brand<TValue, TBrand extends string> = TValue & {
  readonly __brand: TBrand;
};

export type SchemaVersion = Brand<number, "SchemaVersion">;
export type DecimalString = Brand<string, "DecimalString">;
export type CurrencyCode = Brand<string, "CurrencyCode">;
export type UtcTimestamp = Brand<string, "UtcTimestamp">;

export type InstrumentId = Brand<string, "InstrumentId">;
export type BrokerId = Brand<string, "BrokerId">;
export type ExecutionVenueId = Brand<string, "ExecutionVenueId">;
export type BrokerInstrumentRefId = Brand<string, "BrokerInstrumentRefId">;
export type MarketId = Brand<string, "MarketId">;
export type ObservationId = Brand<string, "ObservationId">;
export type SourceId = Brand<string, "SourceId">;
export type AccountId = Brand<string, "AccountId">;
export type AccountMandateId = Brand<string, "AccountMandateId">;
export type StrategyId = Brand<string, "StrategyId">;
export type StrategyVersionId = Brand<string, "StrategyVersionId">;
export type SetupId = Brand<string, "SetupId">;
export type SignalId = Brand<string, "SignalId">;
export type CandidateId = Brand<string, "CandidateId">;
export type OpportunityId = Brand<string, "OpportunityId">;
export type ScoreId = Brand<string, "ScoreId">;
export type DecisionId = Brand<string, "DecisionId">;
export type MasterTradeDecisionId = Brand<string, "MasterTradeDecisionId">;
export type ExecutionIntentId = Brand<string, "ExecutionIntentId">;
export type OrderId = Brand<string, "OrderId">;
export type FillId = Brand<string, "FillId">;
export type PositionId = Brand<string, "PositionId">;
export type TradeId = Brand<string, "TradeId">;
export type PortfolioId = Brand<string, "PortfolioId">;
export type RiskAssessmentId = Brand<string, "RiskAssessmentId">;
export type EventId = Brand<string, "EventId">;
export type ActorId = Brand<string, "ActorId">;
export type CorrelationId = Brand<string, "CorrelationId">;
export type CausationId = Brand<string, "CausationId">;
export type DatasetId = Brand<string, "DatasetId">;
export type DatasetVersionId = Brand<string, "DatasetVersionId">;
export type ConfigurationVersionId = Brand<string, "ConfigurationVersionId">;
export type MarketSnapshotId = Brand<string, "MarketSnapshotId">;
export type IdempotencyKey = Brand<string, "IdempotencyKey">;

export type ContentHash = Brand<string, "ContentHash">;

const uuidSchema = z.string().uuid();

const makeIdentifierSchema = <TBrand extends string>(_brand: TBrand) =>
  uuidSchema.transform((value) => value as Brand<string, TBrand>);

export const schemas = {
  schemaVersion: z
    .number()
    .int()
    .positive()
    .transform((value) => value as SchemaVersion),
  contentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/u, "content hash must be a lowercase SHA-256 hex digest")
    .transform((value) => value as ContentHash),
  currencyCode: z
    .string()
    .regex(/^[A-Z][A-Z0-9]{2,9}$/u, "currency code must be 3-10 uppercase alphanumeric chars")
    .transform((value) => value as CurrencyCode),
  decimal: z
    .string()
    .regex(/^-?(0|[1-9]\d*)(\.\d+)?$/u, "decimal must be a plain base-10 string")
    .refine((value) => new DecimalJs(value).isFinite(), "decimal must be finite")
    .transform((value) => value as DecimalString),
  idempotencyKey: z
    .string()
    .uuid()
    .transform((value) => value as IdempotencyKey),
  timestamp: z
    .string()
    .datetime({ offset: true })
    .transform((value, ctx) => {
      const parsed = new Date(value);

      if (Number.isNaN(parsed.getTime())) {
        ctx.addIssue({
          code: "custom",
          message: "timestamp must be a valid timezone-explicit instant",
        });
        return z.NEVER;
      }

      return parsed.toISOString() as UtcTimestamp;
    }),
  instrumentId: makeIdentifierSchema("InstrumentId"),
  brokerId: makeIdentifierSchema("BrokerId"),
  executionVenueId: makeIdentifierSchema("ExecutionVenueId"),
  brokerInstrumentRefId: makeIdentifierSchema("BrokerInstrumentRefId"),
  marketId: makeIdentifierSchema("MarketId"),
  observationId: makeIdentifierSchema("ObservationId"),
  sourceId: makeIdentifierSchema("SourceId"),
  accountId: makeIdentifierSchema("AccountId"),
  accountMandateId: makeIdentifierSchema("AccountMandateId"),
  strategyId: makeIdentifierSchema("StrategyId"),
  strategyVersionId: makeIdentifierSchema("StrategyVersionId"),
  setupId: makeIdentifierSchema("SetupId"),
  signalId: makeIdentifierSchema("SignalId"),
  candidateId: makeIdentifierSchema("CandidateId"),
  opportunityId: makeIdentifierSchema("OpportunityId"),
  scoreId: makeIdentifierSchema("ScoreId"),
  decisionId: makeIdentifierSchema("DecisionId"),
  masterTradeDecisionId: makeIdentifierSchema("MasterTradeDecisionId"),
  executionIntentId: makeIdentifierSchema("ExecutionIntentId"),
  orderId: makeIdentifierSchema("OrderId"),
  fillId: makeIdentifierSchema("FillId"),
  positionId: makeIdentifierSchema("PositionId"),
  tradeId: makeIdentifierSchema("TradeId"),
  portfolioId: makeIdentifierSchema("PortfolioId"),
  riskAssessmentId: makeIdentifierSchema("RiskAssessmentId"),
  eventId: makeIdentifierSchema("EventId"),
  actorId: makeIdentifierSchema("ActorId"),
  correlationId: makeIdentifierSchema("CorrelationId"),
  causationId: makeIdentifierSchema("CausationId"),
  datasetId: makeIdentifierSchema("DatasetId"),
  datasetVersionId: makeIdentifierSchema("DatasetVersionId"),
  configurationVersionId: makeIdentifierSchema("ConfigurationVersionId"),
  marketSnapshotId: makeIdentifierSchema("MarketSnapshotId"),
} as const;

export const parseSchemaVersion = (value: unknown): DomainResult<SchemaVersion> =>
  parseWithSchema(schemas.schemaVersion, value);

export const parseDecimal = (value: unknown): DomainResult<DecimalString> =>
  parseWithSchema(schemas.decimal, value);

export const parseCurrencyCode = (value: unknown): DomainResult<CurrencyCode> =>
  parseWithSchema(schemas.currencyCode, value);

export const parseUtcTimestamp = (value: unknown): DomainResult<UtcTimestamp> =>
  parseWithSchema(schemas.timestamp, value);

export const parseInstrumentId = (value: unknown): DomainResult<InstrumentId> =>
  parseWithSchema(schemas.instrumentId, value);

export const parseAccountId = (value: unknown): DomainResult<AccountId> =>
  parseWithSchema(schemas.accountId, value);

export const parseCandidateId = (value: unknown): DomainResult<CandidateId> =>
  parseWithSchema(schemas.candidateId, value);

export type Money = Readonly<{
  amount: DecimalString;
  currency: CurrencyCode;
}>;

export const moneySchema = z
  .object({
    amount: schemas.decimal,
    currency: schemas.currencyCode,
  })
  .strict();

export const parseMoney = (value: unknown): DomainResult<Money> =>
  parseWithSchema(moneySchema, value);

const toDecimal = (value: DecimalString): DecimalJs => new DecimalJs(value);

const canonicalDecimal = (value: DecimalJs): DecimalString => value.toFixed() as DecimalString;

export const addMoney = (left: Money, right: Money): DomainResult<Money> => {
  if (left.currency !== right.currency) {
    return fail(
      domainIssue(
        "CURRENCY_MISMATCH",
        `cannot combine money values with currencies ${left.currency} and ${right.currency}`,
      ),
    );
  }

  return ok({
    amount: canonicalDecimal(toDecimal(left.amount).plus(toDecimal(right.amount))),
    currency: left.currency,
  });
};

export const roundingModes = ["HALF_UP", "DOWN", "UP"] as const;
export type RoundingMode = (typeof roundingModes)[number];

const decimalJsRoundingMode = (mode: RoundingMode): DecimalJs.Rounding => {
  switch (mode) {
    case "HALF_UP":
      return DecimalJs.ROUND_HALF_UP;
    case "DOWN":
      return DecimalJs.ROUND_DOWN;
    case "UP":
      return DecimalJs.ROUND_UP;
  }
};

export const roundDecimal = (
  value: DecimalString,
  decimalPlaces: number,
  mode: RoundingMode,
): DomainResult<DecimalString> => {
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 18) {
    return fail(domainIssue("INVALID_DECIMAL_PLACES", "decimal places must be an integer 0-18"));
  }

  return ok(
    toDecimal(value)
      .toDecimalPlaces(decimalPlaces, decimalJsRoundingMode(mode))
      .toFixed() as DecimalString,
  );
};

export type Price = Readonly<{
  value: DecimalString;
  instrumentId?: InstrumentId;
  quoteCurrency?: CurrencyCode;
}>;

export const priceSchema = z
  .object({
    value: schemas.decimal,
    instrumentId: schemas.instrumentId.optional(),
    quoteCurrency: schemas.currencyCode.optional(),
  })
  .strict();

export const quantityUnits = [
  "ASSET_UNITS",
  "BROKER_VOLUME",
  "LOTS",
  "CONTRACTS",
  "TICKS",
  "POINTS",
  "PIPS",
] as const;

export type QuantityUnit = (typeof quantityUnits)[number];

export type Quantity = Readonly<{
  value: DecimalString;
  unit: QuantityUnit;
}>;

export const quantitySchema = z
  .object({
    value: schemas.decimal.refine(
      (value) => new DecimalJs(value).gte(0),
      "quantity cannot be negative",
    ),
    unit: z.enum(quantityUnits),
  })
  .strict();

export type Percentage = Readonly<{
  ratio: DecimalString;
}>;

export const percentageSchema = z
  .object({
    ratio: schemas.decimal
      .refine((value) => new DecimalJs(value).gte(0), "percentage ratio cannot be negative")
      .refine((value) => new DecimalJs(value).lte(1), "percentage ratio cannot exceed 1"),
  })
  .strict();

export type Ratio = Readonly<{
  value: DecimalString;
}>;

export const ratioSchema = z
  .object({
    value: schemas.decimal.refine(
      (value) => new DecimalJs(value).gte(0),
      "ratio cannot be negative",
    ),
  })
  .strict();

export type Rate = Readonly<{
  value: DecimalString;
  period?: string;
}>;

export const rateSchema = z
  .object({
    value: schemas.decimal,
    period: z.string().min(1).optional(),
  })
  .strict();

export const compareDecimal = (left: DecimalString, right: DecimalString): number =>
  toDecimal(left).cmp(toDecimal(right));
