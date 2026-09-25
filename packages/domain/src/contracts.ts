import { Decimal } from "decimal.js";
import { z } from "zod";

import {
  actorTypes,
  assetClasses,
  authorityTypes,
  barCompletenessStates,
  candidateStates,
  dataQualityStatuses,
  decisionOutcomes,
  executionIntentStates,
  exposureDimensions,
  instrumentStatuses,
  marketDataDeliveryModes,
  marketDataOrigins,
  marketDataProviderRoles,
  marketDataSourceTypes,
  marketObservationKinds,
  marketStatusSources,
  mappingStatuses,
  marketTradingStatuses,
  masterDecisionStates,
  operationalStatuses,
  opportunityStates,
  orderSides,
  orderStates,
  orderTypes,
  positionStates,
  protectionStates,
  reasonCategories,
  runtimeModes,
  sequenceScopes,
  setupStates,
  severities,
  strategyStatuses,
  timeframes,
  timeframeKinds,
  timeframeUnits,
  tickUpdateKinds,
  timestampPrecisions,
  timeInForceTypes,
  tradeDirections,
  tradeStates,
  tradingStatuses,
  volumeTypes,
  quoteQualityFlags,
} from "./enums.js";
import {
  compareDecimal,
  type DecimalString,
  moneySchema,
  percentageSchema,
  priceSchema,
  quantitySchema,
  ratioSchema,
  schemas,
} from "./primitives.js";
import { domainIssue, fail, ok, parseWithSchema, type DomainResult } from "./result.js";

const metadataSchema = z.record(z.string(), z.unknown());
const referenceSchema = z.string().min(1);
const schemaVersionField = schemas.schemaVersion;
const eventTypeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*\.v[1-9]\d*$/u, "event type must end with .vN");

const boundedMetadataKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_.:-]*$/u, "metadata keys must be lowercase namespaced safe keys");
const boundedMetadataScalarSchema = z.union([
  z.string().max(256),
  schemas.decimal,
  z.boolean(),
  z.null(),
]);
const boundedMetadataValueSchema = z.union([
  boundedMetadataScalarSchema,
  z.array(boundedMetadataScalarSchema).max(16),
]);
export const boundedMetadataSchema = z
  .record(boundedMetadataKeySchema, boundedMetadataValueSchema)
  .superRefine((value, ctx) => {
    const entries = Object.entries(value);
    if (entries.length > 16) {
      ctx.addIssue({
        code: "custom",
        message: "metadata cannot contain more than 16 keys",
      });
    }
  });

const providerSymbolSchema = z.string().min(1).max(128);
const sourceObservationIdSchema = z.string().min(1).max(128);
const sourceSchemaVersionRefSchema = z.string().min(1).max(64);
const sourceTimezoneSchema = z.string().min(1).max(64);

export const contentIdentitySchema = z
  .object({
    algorithm: z.literal("sha256"),
    hash: schemas.contentHash,
  })
  .strict();

export const configurationVersionRefSchema = z
  .object({
    configurationVersionId: schemas.configurationVersionId,
    version: z.string().min(1),
    contentIdentity: contentIdentitySchema.optional(),
  })
  .strict();

export const datasetVersionRefSchema = z
  .object({
    datasetId: schemas.datasetId,
    datasetVersionId: schemas.datasetVersionId,
    version: z.string().min(1),
    contentIdentity: contentIdentitySchema.optional(),
  })
  .strict();

export const strategyVersionRefSchema = z
  .object({
    strategyId: schemas.strategyId,
    strategyVersionId: schemas.strategyVersionId,
    version: z.string().min(1),
  })
  .strict();

export const dataSourceRefSchema = z
  .object({
    sourceId: schemas.sourceId,
    sourceType: z.enum([...marketDataSourceTypes, "PROVIDER", "DATASET"]),
    name: z.string().min(1),
    provider: z.string().min(1).optional(),
    role: z.enum(marketDataProviderRoles).optional(),
  })
  .strict();

export const provenanceSchema = z
  .object({
    source: dataSourceRefSchema,
    observedAt: schemas.timestamp.optional(),
    ingestedAt: schemas.timestamp.optional(),
    transformedBy: z.string().min(1).optional(),
    datasetVersion: datasetVersionRefSchema.optional(),
    qualityStatus: z.enum(dataQualityStatuses),
  })
  .strict();

export const marketDataSequenceSchema = z
  .object({
    sequence: z.string().min(1).max(128),
    scope: z.enum(sequenceScopes),
    scopeId: z.string().min(1).max(128).optional(),
  })
  .strict();

export const marketDataTransformationProvenanceSchema = z
  .object({
    transformationId: z.string().min(1).max(128),
    transformationVersion: z.string().min(1).max(64),
    transformedAt: schemas.timestamp.optional(),
    inputObservationIds: z.array(schemas.observationId).max(64).default([]),
    inputDatasetVersion: datasetVersionRefSchema.optional(),
  })
  .strict();

export const marketDataProvenanceSchema = z
  .object({
    source: dataSourceRefSchema,
    providerSymbol: providerSymbolSchema.optional(),
    sourceObservationId: sourceObservationIdSchema.optional(),
    sourceSchemaVersion: sourceSchemaVersionRefSchema.optional(),
    sourceTime: schemas.timestamp.optional(),
    sourceTimezone: sourceTimezoneSchema.optional(),
    sourceTimestampPrecision: z.enum(timestampPrecisions).default("UNKNOWN"),
    sequence: marketDataSequenceSchema.optional(),
    origin: z.enum(marketDataOrigins),
    deliveryMode: z.enum(marketDataDeliveryModes).optional(),
    transformation: marketDataTransformationProvenanceSchema.optional(),
    datasetVersion: datasetVersionRefSchema.optional(),
    entitlementRef: referenceSchema.optional(),
    metadata: boundedMetadataSchema.default({}),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.origin === "DERIVED" && value.transformation === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "derived market data must include transformation provenance",
        path: ["transformation"],
      });
    }
    if (value.origin === "OBSERVED" && value.source.sourceType === "SIMULATION") {
      ctx.addIssue({
        code: "custom",
        message: "simulation source cannot masquerade as observed market data",
        path: ["origin"],
      });
    }
  });

export const marketSessionRefSchema = z
  .object({
    sessionId: z.string().min(1).max(128),
    sessionDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u, "sessionDate must be YYYY-MM-DD")
      .optional(),
  })
  .strict();

export const canonicalTimeframeSchema = z
  .object({
    kind: z.enum(timeframeKinds),
    code: z.string().min(1).max(16),
    length: z.number().int().positive().max(1000000).optional(),
    unit: z.enum(timeframeUnits).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "FIXED" && (value.length === undefined || value.unit === undefined)) {
      ctx.addIssue({
        code: "custom",
        message: "fixed timeframe requires length and unit",
        path: ["length"],
      });
    }
  });

export const marketDataTimeframeSchema = z.union([z.enum(timeframes), canonicalTimeframeSchema]);

const priceFieldSchema = priceSchema;
const quantityFieldSchema = quantitySchema;

const marketObservationBaseSchema = z
  .object({
    schemaVersion: schemaVersionField,
    observationId: schemas.observationId,
    observationKind: z.enum(marketObservationKinds),
    instrumentId: schemas.instrumentId,
    source: dataSourceRefSchema,
    providerSymbol: providerSymbolSchema.optional(),
    eventTime: schemas.timestamp,
    receivedAt: schemas.timestamp,
    sourceTime: schemas.timestamp.optional(),
    sourceTimestampPrecision: z.enum(timestampPrecisions).default("UNKNOWN"),
    sequence: marketDataSequenceSchema.optional(),
    session: marketSessionRefSchema.optional(),
    marketStatus: z.enum(marketTradingStatuses).optional(),
    provenance: marketDataProvenanceSchema,
    qualityAnnotations: z.array(z.enum(quoteQualityFlags)).max(16).default([]),
    metadata: boundedMetadataSchema.default({}),
  })
  .strict();

const quoteFieldsSchema = z
  .object({
    bid: priceFieldSchema.optional(),
    ask: priceFieldSchema.optional(),
    bidSize: quantityFieldSchema.optional(),
    askSize: quantityFieldSchema.optional(),
  })
  .strict()
  .refine((value) => value.bid !== undefined || value.ask !== undefined, {
    message: "quote must include bid or ask",
    path: ["bid"],
  });

const tradeFieldsSchema = z
  .object({
    price: priceFieldSchema,
    quantity: quantityFieldSchema.optional(),
    sourceTradeId: sourceObservationIdSchema.optional(),
    aggressorSide: z.enum(["BUY", "SELL"]).optional(),
  })
  .strict();

export const quoteObservationSchema = marketObservationBaseSchema
  .extend({
    observationKind: z.literal("QUOTE"),
    bid: priceFieldSchema.optional(),
    ask: priceFieldSchema.optional(),
    bidSize: quantityFieldSchema.optional(),
    askSize: quantityFieldSchema.optional(),
  })
  .strict()
  .refine((value) => value.bid !== undefined || value.ask !== undefined, {
    message: "quote observation must include bid or ask",
    path: ["bid"],
  });

export const tradeObservationSchema = marketObservationBaseSchema
  .extend({
    observationKind: z.literal("TRADE"),
    price: priceFieldSchema,
    quantity: quantityFieldSchema.optional(),
    sourceTradeId: sourceObservationIdSchema.optional(),
    aggressorSide: z.enum(["BUY", "SELL"]).optional(),
  })
  .strict();

export const tickObservationSchema = marketObservationBaseSchema
  .extend({
    observationKind: z.literal("TICK"),
    tickKind: z.enum(tickUpdateKinds),
    quote: quoteFieldsSchema.optional(),
    trade: tradeFieldsSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.tickKind === "QUOTE" || value.tickKind === "COMBINED") &&
      value.quote === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: "quote tick must include quote fields",
        path: ["quote"],
      });
    }
    if (
      (value.tickKind === "TRADE" || value.tickKind === "COMBINED") &&
      value.trade === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: "trade tick must include trade fields",
        path: ["trade"],
      });
    }
  });

export const volumeMeasureSchema = z
  .object({
    volumeType: z.enum(volumeTypes),
    quantity: quantityFieldSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.volumeType === "NOT_AVAILABLE" && value.quantity !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "not-available volume cannot carry a quantity",
        path: ["quantity"],
      });
    }
    if (value.volumeType !== "NOT_AVAILABLE" && value.quantity === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "available volume measure requires a quantity",
        path: ["quantity"],
      });
    }
  });

export const barObservationSchema = marketObservationBaseSchema
  .extend({
    observationKind: z.literal("BAR"),
    timeframe: marketDataTimeframeSchema,
    intervalStart: schemas.timestamp,
    intervalEnd: schemas.timestamp,
    open: priceFieldSchema,
    high: priceFieldSchema,
    low: priceFieldSchema,
    close: priceFieldSchema,
    volumes: z.array(volumeMeasureSchema).max(8).default([]),
    completeness: z.enum(barCompletenessStates),
    revisionOf: schemas.observationId.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Date(value.intervalEnd).getTime() <= new Date(value.intervalStart).getTime()) {
      ctx.addIssue({
        code: "custom",
        message: "bar intervalEnd must be after intervalStart",
        path: ["intervalEnd"],
      });
    }

    const prices = [value.open.value, value.high.value, value.low.value, value.close.value];
    const highIsValid = prices.every((price) => compareDecimal(value.high.value, price) >= 0);
    const lowIsValid = prices.every((price) => compareDecimal(value.low.value, price) <= 0);

    if (!highIsValid) {
      ctx.addIssue({
        code: "custom",
        message: "bar high must be greater than or equal to open, low, and close",
        path: ["high"],
      });
    }

    if (!lowIsValid) {
      ctx.addIssue({
        code: "custom",
        message: "bar low must be less than or equal to open, high, and close",
        path: ["low"],
      });
    }

    const volumeTypesSeen = new Set<string>();
    for (const [index, volume] of value.volumes.entries()) {
      if (volumeTypesSeen.has(volume.volumeType)) {
        ctx.addIssue({
          code: "custom",
          message: "bar volume measures must not repeat the same volumeType",
          path: ["volumes", index, "volumeType"],
        });
      }
      volumeTypesSeen.add(volume.volumeType);
    }
  });

export const marketStatusObservationSchema = marketObservationBaseSchema
  .extend({
    observationKind: z.literal("MARKET_STATUS"),
    status: z.enum(marketTradingStatuses),
    statusSource: z.enum(marketStatusSources),
    reason: z.string().min(1).max(256).optional(),
  })
  .strict();

export const marketObservationSchema = z.discriminatedUnion("observationKind", [
  quoteObservationSchema,
  tradeObservationSchema,
  tickObservationSchema,
  barObservationSchema,
  marketStatusObservationSchema,
]);

export const marketDataCorrectionSchema = z
  .object({
    schemaVersion: schemaVersionField,
    correctionId: schemas.observationId,
    originalObservationId: schemas.observationId,
    replacementObservationId: schemas.observationId,
    correctedAt: schemas.timestamp,
    reasonCode: z.string().min(1).max(128).optional(),
    source: dataSourceRefSchema,
    provenance: marketDataProvenanceSchema,
    metadata: boundedMetadataSchema.default({}),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.originalObservationId === value.replacementObservationId) {
      ctx.addIssue({
        code: "custom",
        message: "replacement observation must be distinct from original observation",
        path: ["replacementObservationId"],
      });
    }
  });

export const actorSchema = z
  .object({
    actorType: z.enum(actorTypes),
    actorId: schemas.actorId.optional(),
    displayName: z.string().min(1).optional(),
  })
  .strict();

export const reasonCodeSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]*(\.[A-Z0-9_]+)*$/u),
    category: z.enum(reasonCategories),
    summary: z.string().min(1),
    detail: z.string().min(1).optional(),
    authority: z.enum(authorityTypes),
    severity: z.enum(severities),
    evidenceRefs: z.array(referenceSchema).default([]),
  })
  .strict();

export const instrumentSchema = z
  .object({
    schemaVersion: schemaVersionField,
    instrumentId: schemas.instrumentId,
    canonicalSymbol: z.string().min(1),
    displayName: z.string().min(1),
    assetClass: z.enum(assetClasses),
    baseAsset: z.string().min(1).optional(),
    baseCurrency: schemas.currencyCode.optional(),
    quoteAsset: z.string().min(1).optional(),
    quoteCurrency: schemas.currencyCode.optional(),
    settlementCurrency: schemas.currencyCode.optional(),
    status: z.enum(instrumentStatuses),
    metadata: metadataSchema.default({}),
  })
  .strict();

export const brokerInstrumentReferenceSchema = z
  .object({
    schemaVersion: schemaVersionField,
    brokerInstrumentRefId: schemas.brokerInstrumentRefId,
    brokerId: schemas.brokerId,
    executionVenueId: schemas.executionVenueId.optional(),
    brokerSymbol: z.string().min(1),
    instrumentId: schemas.instrumentId,
    mappingStatus: z.enum(mappingStatuses),
    specificationVersionRef: referenceSchema.optional(),
    metadata: metadataSchema.default({}),
  })
  .strict();

export const marketSchema = z
  .object({
    schemaVersion: schemaVersionField,
    marketId: schemas.marketId,
    instrumentId: schemas.instrumentId,
    brokerInstrumentRefId: schemas.brokerInstrumentRefId.optional(),
    tradingStatus: z.enum(marketTradingStatuses),
    sessionRef: referenceSchema.optional(),
    marketDataSource: dataSourceRefSchema.optional(),
    metadata: metadataSchema.default({}),
  })
  .strict();

export const timeframeSchema = z.enum(timeframes);

export const marketSnapshotSchema = z
  .object({
    schemaVersion: schemaVersionField,
    marketSnapshotId: schemas.marketSnapshotId,
    instrumentId: schemas.instrumentId,
    observedAt: schemas.timestamp,
    quoteObservationId: schemas.observationId.optional(),
    barObservationIds: z.array(schemas.observationId).default([]),
    dataQualityStatus: z.enum(dataQualityStatuses),
    provenance: provenanceSchema,
  })
  .strict();

export const accountSchema = z
  .object({
    schemaVersion: schemaVersionField,
    accountId: schemas.accountId,
    brokerId: schemas.brokerId,
    executionVenueId: schemas.executionVenueId.optional(),
    label: z.string().min(1),
    currency: schemas.currencyCode,
    accountCategory: z.string().min(1).optional(),
    runtimeEligibility: z.array(z.enum(runtimeModes)).nonempty(),
    operationalStatus: z.enum(operationalStatuses),
    tradingStatus: z.enum(tradingStatuses),
    mandateId: schemas.accountMandateId.optional(),
    protectionState: z.enum(protectionStates),
    metadata: metadataSchema.default({}),
  })
  .strict();

export const accountSnapshotSchema = z
  .object({
    schemaVersion: schemaVersionField,
    accountId: schemas.accountId,
    observedAt: schemas.timestamp,
    source: dataSourceRefSchema,
    balance: moneySchema,
    equity: moneySchema,
    margin: moneySchema.optional(),
    freeMargin: moneySchema.optional(),
    marginLevel: percentageSchema.optional(),
    unrealizedPnL: moneySchema.optional(),
    operationalStatus: z.enum(operationalStatuses),
    tradingStatus: z.enum(tradingStatuses),
    qualityStatus: z.enum(dataQualityStatuses),
  })
  .strict();

export const accountMandateSchema = z
  .object({
    schemaVersion: schemaVersionField,
    mandateId: schemas.accountMandateId,
    permittedAssetClasses: z.array(z.enum(assetClasses)).optional(),
    permittedInstrumentIds: z.array(schemas.instrumentId).optional(),
    permittedStrategyIds: z.array(schemas.strategyId).optional(),
    riskProfileRef: referenceSchema.optional(),
    executionRestrictionsRef: referenceSchema.optional(),
    scheduleRestrictionsRef: referenceSchema.optional(),
    liveEligible: z.boolean(),
  })
  .strict();

export const strategyIdentitySchema = z
  .object({
    schemaVersion: schemaVersionField,
    strategyId: schemas.strategyId,
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
    name: z.string().min(1),
    version: z.string().min(1),
    status: z.enum(strategyStatuses),
    description: z.string().min(1).optional(),
    compatibleRuntimeModes: z.array(z.enum(runtimeModes)).nonempty(),
    configurationVersion: configurationVersionRefSchema.optional(),
    metadata: metadataSchema.default({}),
  })
  .strict();

export const setupSchema = z
  .object({
    schemaVersion: schemaVersionField,
    setupId: schemas.setupId,
    instrumentId: schemas.instrumentId,
    strategyVersion: strategyVersionRefSchema,
    timeframe: timeframeSchema,
    detectedAt: schemas.timestamp,
    expiresAt: schemas.timestamp.optional(),
    marketSnapshotId: schemas.marketSnapshotId.optional(),
    state: z.enum(setupStates),
    evidence: metadataSchema.default({}),
  })
  .strict();

export const signalSchema = z
  .object({
    schemaVersion: schemaVersionField,
    signalId: schemas.signalId,
    strategyVersion: strategyVersionRefSchema,
    instrumentId: schemas.instrumentId,
    direction: z.enum(tradeDirections),
    generatedAt: schemas.timestamp,
    timeframe: timeframeSchema,
    evidence: metadataSchema.default({}),
    scoreId: schemas.scoreId.optional(),
    expiresAt: schemas.timestamp.optional(),
    provenance: provenanceSchema,
  })
  .strict();

export const opportunitySchema = z
  .object({
    schemaVersion: schemaVersionField,
    opportunityId: schemas.opportunityId,
    instrumentId: schemas.instrumentId,
    state: z.enum(opportunityStates),
    observedAt: schemas.timestamp,
    source: dataSourceRefSchema,
    relatedSetupIds: z.array(schemas.setupId).default([]),
    metadata: metadataSchema.default({}),
  })
  .strict();

export const signalScoreSchema = z
  .object({
    schemaVersion: schemaVersionField,
    scoreId: schemas.scoreId,
    value: schemas.decimal,
    scale: z
      .object({
        min: schemas.decimal,
        max: schemas.decimal,
      })
      .strict(),
    modelVersionRef: referenceSchema,
    calculatedAt: schemas.timestamp,
    components: z
      .array(
        z
          .object({
            name: z.string().min(1),
            value: schemas.decimal,
            weight: ratioSchema.optional(),
          })
          .strict(),
      )
      .default([]),
    provenance: provenanceSchema,
  })
  .strict();

const priceConceptSchema = z
  .object({
    kind: z.enum(["MARKET", "LIMIT", "STOP", "REFERENCE"]),
    price: priceSchema.optional(),
    reference: referenceSchema.optional(),
  })
  .strict();

export const tradeCandidateSchema = z
  .object({
    schemaVersion: schemaVersionField,
    candidateId: schemas.candidateId,
    originatingStrategy: strategyVersionRefSchema,
    instrumentId: schemas.instrumentId,
    direction: z.enum(tradeDirections),
    createdAt: schemas.timestamp,
    expiresAt: schemas.timestamp.optional(),
    marketSnapshotId: schemas.marketSnapshotId.optional(),
    setupId: schemas.setupId.optional(),
    signalId: schemas.signalId.optional(),
    proposedEntry: priceConceptSchema,
    invalidation: z
      .object({
        reference: referenceSchema,
        reason: reasonCodeSchema.optional(),
      })
      .strict()
      .optional(),
    stop: priceConceptSchema.optional(),
    targets: z.array(priceConceptSchema).default([]),
    scoreId: schemas.scoreId.optional(),
    configurationVersion: configurationVersionRefSchema,
    runtimeMode: z.enum(runtimeModes),
    state: z.enum(candidateStates),
    provenance: provenanceSchema,
    correlationId: schemas.correlationId,
  })
  .strict();

export const decisionSchema = z
  .object({
    schemaVersion: schemaVersionField,
    decisionId: schemas.decisionId,
    outcome: z.enum(decisionOutcomes),
    candidateId: schemas.candidateId.optional(),
    decidedAt: schemas.timestamp,
    authority: z.enum(authorityTypes),
    reason: reasonCodeSchema,
    explanation: z.string().min(1),
    configurationVersion: configurationVersionRefSchema.optional(),
    correlationId: schemas.correlationId,
    causationId: schemas.causationId.optional(),
    evidenceRefs: z.array(referenceSchema).default([]),
  })
  .strict();

export const masterTradeDecisionSchema = z
  .object({
    schemaVersion: schemaVersionField,
    masterTradeDecisionId: schemas.masterTradeDecisionId,
    decisionId: schemas.decisionId,
    candidateId: schemas.candidateId,
    instrumentId: schemas.instrumentId,
    direction: z.enum(tradeDirections),
    decidedAt: schemas.timestamp,
    state: z.enum(masterDecisionStates),
    configurationVersion: configurationVersionRefSchema,
    correlationId: schemas.correlationId,
  })
  .strict();

export const accountExecutionIntentSchema = z
  .object({
    schemaVersion: schemaVersionField,
    executionIntentId: schemas.executionIntentId,
    masterTradeDecisionId: schemas.masterTradeDecisionId,
    accountId: schemas.accountId,
    instrumentId: schemas.instrumentId,
    direction: z.enum(tradeDirections),
    requestedQuantity: quantitySchema,
    orderPreference: z.enum(orderTypes),
    protectionParameters: metadataSchema.default({}),
    validFrom: schemas.timestamp.optional(),
    validUntil: schemas.timestamp.optional(),
    idempotencyKey: schemas.idempotencyKey,
    state: z.enum(executionIntentStates),
    correlationId: schemas.correlationId,
  })
  .strict();

export const orderSchema = z
  .object({
    schemaVersion: schemaVersionField,
    orderId: schemas.orderId,
    executionIntentId: schemas.executionIntentId,
    accountId: schemas.accountId,
    instrumentId: schemas.instrumentId,
    side: z.enum(orderSides),
    orderType: z.enum(orderTypes),
    requestedQuantity: quantitySchema,
    requestedPrice: priceSchema.optional(),
    stopPrice: priceSchema.optional(),
    limitPrice: priceSchema.optional(),
    timeInForce: z.enum(timeInForceTypes),
    state: z.enum(orderStates),
    createdAt: schemas.timestamp,
    updatedAt: schemas.timestamp.optional(),
    externalReference: referenceSchema.optional(),
    idempotencyKey: schemas.idempotencyKey,
  })
  .strict();

export const fillSchema = z
  .object({
    schemaVersion: schemaVersionField,
    fillId: schemas.fillId,
    orderId: schemas.orderId,
    accountId: schemas.accountId,
    instrumentId: schemas.instrumentId,
    quantity: quantitySchema,
    price: priceSchema,
    executedAt: schemas.timestamp,
    fees: moneySchema.optional(),
    commission: moneySchema.optional(),
    externalReference: referenceSchema.optional(),
    source: dataSourceRefSchema,
    metadata: metadataSchema.default({}),
  })
  .strict();

export const positionSchema = z
  .object({
    schemaVersion: schemaVersionField,
    positionId: schemas.positionId,
    accountId: schemas.accountId,
    instrumentId: schemas.instrumentId,
    direction: z.enum(tradeDirections),
    quantity: quantitySchema,
    averageOpenPrice: priceSchema,
    openTime: schemas.timestamp,
    state: z.enum(positionStates),
    decisionId: schemas.decisionId.optional(),
    orderIds: z.array(schemas.orderId).default([]),
    protectiveLevelRefs: z.array(referenceSchema).default([]),
    externalReference: referenceSchema.optional(),
  })
  .strict();

export const tradeSchema = z
  .object({
    schemaVersion: schemaVersionField,
    tradeId: schemas.tradeId,
    originatingDecisionId: schemas.decisionId,
    orderIds: z.array(schemas.orderId).default([]),
    fillIds: z.array(schemas.fillId).default([]),
    positionId: schemas.positionId.optional(),
    strategyVersion: strategyVersionRefSchema,
    instrumentId: schemas.instrumentId,
    accountId: schemas.accountId,
    state: z.enum(tradeStates),
    openedAt: schemas.timestamp.optional(),
    closedAt: schemas.timestamp.optional(),
    realizedPnl: moneySchema.optional(),
    costs: moneySchema.optional(),
    exitReason: reasonCodeSchema.optional(),
    analyticsRefs: z.array(referenceSchema).default([]),
  })
  .strict();

export const exposureSchema = z
  .object({
    dimension: z.enum(exposureDimensions),
    reference: referenceSchema,
    amount: moneySchema.optional(),
    quantity: quantitySchema.optional(),
  })
  .strict();

export const portfolioSchema = z
  .object({
    schemaVersion: schemaVersionField,
    portfolioId: schemas.portfolioId,
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
    name: z.string().min(1),
    accountIds: z.array(schemas.accountId).default([]),
    metadata: metadataSchema.default({}),
  })
  .strict();

export const portfolioSnapshotSchema = z
  .object({
    schemaVersion: schemaVersionField,
    portfolioId: schemas.portfolioId,
    observedAt: schemas.timestamp,
    accountIds: z.array(schemas.accountId).default([]),
    positionIds: z.array(schemas.positionId).default([]),
    exposures: z.array(exposureSchema).default([]),
    provenance: provenanceSchema,
  })
  .strict();

export const riskAssessmentReferenceSchema = z
  .object({
    schemaVersion: schemaVersionField,
    riskAssessmentId: schemas.riskAssessmentId,
    assessedAt: schemas.timestamp,
    authority: z.literal("RISK"),
    result: z.enum(["APPROVED", "REJECTED", "NOT_ASSESSED"]),
    reason: reasonCodeSchema.optional(),
  })
  .strict();

export const marketIntelligenceSnapshotRefSchema = z
  .object({
    schemaVersion: schemaVersionField,
    instrumentId: schemas.instrumentId,
    timeframe: timeframeSchema,
    regimeRef: referenceSchema.optional(),
    structureRef: referenceSchema.optional(),
    volatilityRef: referenceSchema.optional(),
    momentumRef: referenceSchema.optional(),
    dataHealthRef: referenceSchema.optional(),
    observedAt: schemas.timestamp,
    featureVersionRefs: z.array(referenceSchema).default([]),
  })
  .strict();

export const eventEnvelopeSchema = z
  .object({
    schemaVersion: schemaVersionField,
    eventId: schemas.eventId,
    eventType: eventTypeSchema,
    eventTimestamp: schemas.timestamp,
    source: dataSourceRefSchema,
    actor: actorSchema,
    correlationId: schemas.correlationId,
    causationId: schemas.causationId.optional(),
    runtimeMode: z.enum(runtimeModes),
    payload: z.unknown(),
  })
  .strict();

export type QuoteObservation = Readonly<z.infer<typeof quoteObservationSchema>>;
export type TradeObservation = Readonly<z.infer<typeof tradeObservationSchema>>;
export type TickObservation = Readonly<z.infer<typeof tickObservationSchema>>;
export type BarObservation = Readonly<z.infer<typeof barObservationSchema>>;
export type MarketStatusObservation = Readonly<z.infer<typeof marketStatusObservationSchema>>;
export type MarketObservation = Readonly<z.infer<typeof marketObservationSchema>>;
export type MarketDataCorrection = Readonly<z.infer<typeof marketDataCorrectionSchema>>;
export type VolumeMeasure = Readonly<z.infer<typeof volumeMeasureSchema>>;
export type MarketDataSequence = Readonly<z.infer<typeof marketDataSequenceSchema>>;
export type MarketDataProvenance = Readonly<z.infer<typeof marketDataProvenanceSchema>>;
export type CanonicalTimeframe = Readonly<z.infer<typeof canonicalTimeframeSchema>>;

export type BidAskSpread = Readonly<{
  value: DecimalString;
  formula: "ASK_MINUS_BID";
}>;

export const deriveBidAskSpread = (
  quote: Pick<QuoteObservation, "bid" | "ask">,
): DomainResult<BidAskSpread> => {
  if (quote.bid === undefined || quote.ask === undefined) {
    return fail(domainIssue("QUOTE_SIDE_MISSING", "spread requires both bid and ask"));
  }

  return ok({
    value: new Decimal(quote.ask.value)
      .minus(new Decimal(quote.bid.value))
      .toFixed() as DecimalString,
    formula: "ASK_MINUS_BID",
  });
};

export const deriveMidPrice = (
  quote: Pick<QuoteObservation, "bid" | "ask" | "instrumentId">,
): DomainResult<
  Readonly<{ value: DecimalString; instrumentId: QuoteObservation["instrumentId"] }>
> => {
  if (quote.bid === undefined || quote.ask === undefined) {
    return fail(domainIssue("QUOTE_SIDE_MISSING", "mid price requires both bid and ask"));
  }

  return ok({
    value: new Decimal(quote.bid.value)
      .plus(new Decimal(quote.ask.value))
      .div(2)
      .toFixed() as DecimalString,
    instrumentId: quote.instrumentId,
  });
};

export const isCrossedQuote = (quote: Pick<QuoteObservation, "bid" | "ask">): boolean =>
  quote.bid !== undefined &&
  quote.ask !== undefined &&
  compareDecimal(quote.bid.value, quote.ask.value) > 0;

export const stableMarketDataStringify = (value: unknown): string =>
  JSON.stringify(stableMarketDataValue(value));

export const marketObservationSemanticFingerprint = (value: MarketObservation): string =>
  `fnv1a64:${fnv1a64(
    stableMarketDataStringify({
      observationKind: value.observationKind,
      instrumentId: value.instrumentId,
      source: value.source,
      providerSymbol: value.providerSymbol,
      eventTime: value.eventTime,
      sourceTime: value.sourceTime,
      sequence: value.sequence,
      provenance: {
        sourceObservationId: value.provenance.sourceObservationId,
        sourceSchemaVersion: value.provenance.sourceSchemaVersion,
        origin: value.provenance.origin,
        transformation: value.provenance.transformation,
        datasetVersion: value.provenance.datasetVersion,
      },
      payload: marketObservationPayload(value),
    }),
  )}`;

const marketObservationPayload = (value: MarketObservation): unknown => {
  switch (value.observationKind) {
    case "QUOTE":
      return {
        bid: value.bid,
        ask: value.ask,
        bidSize: value.bidSize,
        askSize: value.askSize,
      };
    case "TRADE":
      return {
        price: value.price,
        quantity: value.quantity,
        sourceTradeId: value.sourceTradeId,
        aggressorSide: value.aggressorSide,
      };
    case "TICK":
      return {
        tickKind: value.tickKind,
        quote: value.quote,
        trade: value.trade,
      };
    case "BAR":
      return {
        timeframe: value.timeframe,
        intervalStart: value.intervalStart,
        intervalEnd: value.intervalEnd,
        open: value.open,
        high: value.high,
        low: value.low,
        close: value.close,
        volumes: value.volumes,
        completeness: value.completeness,
        revisionOf: value.revisionOf,
      };
    case "MARKET_STATUS":
      return {
        status: value.status,
        statusSource: value.statusSource,
        reason: value.reason,
      };
  }
};

const stableMarketDataValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => stableMarketDataValue(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableMarketDataValue(nested)]),
    );
  }
  return value;
};

const fnv1a64 = (input: string): string => {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * prime) & mask;
  }

  return hash.toString(16).padStart(16, "0");
};

export const domainSchemas = {
  account: accountSchema,
  accountExecutionIntent: accountExecutionIntentSchema,
  accountMandate: accountMandateSchema,
  accountSnapshot: accountSnapshotSchema,
  actor: actorSchema,
  barObservation: barObservationSchema,
  boundedMetadata: boundedMetadataSchema,
  brokerInstrumentReference: brokerInstrumentReferenceSchema,
  canonicalTimeframe: canonicalTimeframeSchema,
  configurationVersionRef: configurationVersionRefSchema,
  contentIdentity: contentIdentitySchema,
  datasetVersionRef: datasetVersionRefSchema,
  decision: decisionSchema,
  eventEnvelope: eventEnvelopeSchema,
  exposure: exposureSchema,
  fill: fillSchema,
  instrument: instrumentSchema,
  market: marketSchema,
  marketDataCorrection: marketDataCorrectionSchema,
  marketDataProvenance: marketDataProvenanceSchema,
  marketDataSequence: marketDataSequenceSchema,
  marketIntelligenceSnapshotRef: marketIntelligenceSnapshotRefSchema,
  marketObservation: marketObservationSchema,
  marketSnapshot: marketSnapshotSchema,
  marketStatusObservation: marketStatusObservationSchema,
  masterTradeDecision: masterTradeDecisionSchema,
  opportunity: opportunitySchema,
  order: orderSchema,
  portfolio: portfolioSchema,
  portfolioSnapshot: portfolioSnapshotSchema,
  position: positionSchema,
  provenance: provenanceSchema,
  quoteObservation: quoteObservationSchema,
  reasonCode: reasonCodeSchema,
  riskAssessmentReference: riskAssessmentReferenceSchema,
  signal: signalSchema,
  signalScore: signalScoreSchema,
  setup: setupSchema,
  strategyIdentity: strategyIdentitySchema,
  strategyVersionRef: strategyVersionRefSchema,
  tickObservation: tickObservationSchema,
  trade: tradeSchema,
  tradeCandidate: tradeCandidateSchema,
  tradeObservation: tradeObservationSchema,
  volumeMeasure: volumeMeasureSchema,
} as const;

export type Account = z.infer<typeof accountSchema>;
export type AccountExecutionIntent = z.infer<typeof accountExecutionIntentSchema>;
export type AccountMandate = z.infer<typeof accountMandateSchema>;
export type AccountSnapshot = z.infer<typeof accountSnapshotSchema>;
export type Actor = z.infer<typeof actorSchema>;
export type BrokerInstrumentReference = z.infer<typeof brokerInstrumentReferenceSchema>;
export type ConfigurationVersionRef = z.infer<typeof configurationVersionRefSchema>;
export type ContentIdentity = z.infer<typeof contentIdentitySchema>;
export type DatasetVersionRef = z.infer<typeof datasetVersionRefSchema>;
export type Decision = z.infer<typeof decisionSchema>;
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
export type Exposure = z.infer<typeof exposureSchema>;
export type Fill = z.infer<typeof fillSchema>;
export type Instrument = z.infer<typeof instrumentSchema>;
export type Market = z.infer<typeof marketSchema>;
export type MarketIntelligenceSnapshotRef = z.infer<typeof marketIntelligenceSnapshotRefSchema>;
export type MarketSnapshot = z.infer<typeof marketSnapshotSchema>;
export type MasterTradeDecision = z.infer<typeof masterTradeDecisionSchema>;
export type Opportunity = z.infer<typeof opportunitySchema>;
export type Order = z.infer<typeof orderSchema>;
export type Portfolio = z.infer<typeof portfolioSchema>;
export type PortfolioSnapshot = z.infer<typeof portfolioSnapshotSchema>;
export type Position = z.infer<typeof positionSchema>;
export type Provenance = z.infer<typeof provenanceSchema>;
export type ReasonCode = z.infer<typeof reasonCodeSchema>;
export type RiskAssessmentReference = z.infer<typeof riskAssessmentReferenceSchema>;
export type Signal = z.infer<typeof signalSchema>;
export type SignalScore = z.infer<typeof signalScoreSchema>;
export type Setup = z.infer<typeof setupSchema>;
export type StrategyIdentity = z.infer<typeof strategyIdentitySchema>;
export type StrategyVersionRef = z.infer<typeof strategyVersionRefSchema>;
export type Trade = z.infer<typeof tradeSchema>;
export type TradeCandidate = z.infer<typeof tradeCandidateSchema>;

export const parseDomainContract = <T>(schema: z.ZodType<T>, value: unknown): DomainResult<T> =>
  parseWithSchema(schema, value);
