import { Decimal } from "decimal.js";

import {
  marketObservationSemanticFingerprint,
  type BarObservation,
  type MarketObservation,
  type QuoteObservation,
} from "@ate/domain";

import { fail, ok } from "./errors.js";
import { fingerprint, stableStringify } from "./serialization.js";
import type {
  DataQualityEvidence,
  DataQualityFinding,
  DataQualityFindingCategory,
  DataQualityFindingId,
  DataQualityResult,
  DataQualityRule,
  DataQualityRuleContext,
  DataQualityRuleDefinition,
  DataQualityRuleEvaluation,
  DataQualitySeverity,
} from "./types.js";

export const createDefaultDataQualityRules = (
  definitions: readonly DataQualityRuleDefinition[],
): readonly DataQualityRule[] =>
  definitions.map((definition) => ({
    definition,
    evaluate: (context) => evaluateRule(definition, context),
  }));

const evaluateRule = (
  definition: DataQualityRuleDefinition,
  context: DataQualityRuleContext,
): DataQualityResult<DataQualityRuleEvaluation> => {
  try {
    switch (definition.ruleId) {
      case "dataset-integrity":
        return ok(datasetIntegrity(definition, context));
      case "partition-integrity":
        return ok(partitionIntegrity(definition, context));
      case "coverage-and-import-rejections":
        return ok(coverageAndImportRejections(definition, context));
      case "bar-gap-and-overlap":
        return ok(barGapAndOverlap(definition, context));
      case "duplicate-observation":
        return ok(duplicateObservation(definition, context));
      case "timestamp-and-sequence":
        return ok(timestampAndSequence(definition, context));
      case "freshness-staleness":
        return ok(freshnessStaleness(definition, context));
      case "quote-spread":
        return ok(quoteSpread(definition, context));
      case "ohlc-consistency":
        return ok(ohlcConsistency(definition, context));
      case "price-outlier":
        return ok(priceOutlier(definition, context));
      case "volume-anomaly":
        return ok(volumeAnomaly(definition, context));
      case "timezone-session-provenance":
        return ok(timezoneSessionProvenance(definition, context));
      case "provenance-completeness":
        return ok(provenanceCompleteness(definition, context));
      default:
        return ok({
          status: "NOT_APPLICABLE",
          findings: [],
          suppressedFindingCount: 0,
          message: "rule is not registered in this engine build",
        });
    }
  } catch (error) {
    return fail({
      code: "DATA_QUALITY_RULE_FAILED",
      message: error instanceof Error ? error.message : String(error),
      severity: "ERROR",
      timestamp: context.clock.now(),
      details: { ruleId: definition.ruleId },
    });
  }
};

const datasetIntegrity = (
  definition: DataQualityRuleDefinition,
  context: DataQualityRuleContext,
): DataQualityRuleEvaluation => {
  const findings: DataQualityFinding[] = [];
  if (context.observationLimitReached) {
    findings.push(
      finding(definition, context, {
        message: "analysis reached the profile observation limit before full dataset evaluation",
        severity: "ERROR",
        evidence: evidence("observation-limit", "Profile maxObservations was reached", {
          maxObservations: context.request.profile.maxObservations,
          manifestObservationCount: context.manifest.observationCount,
        }),
      }),
    );
  }
  if (
    !context.observationLimitReached &&
    context.observations.length !== context.manifest.observationCount
  ) {
    findings.push(
      finding(definition, context, {
        message: "manifest observation count does not match queryable observation count",
        severity: "ERROR",
        evidence: evidence("observation-count", "Manifest/query count mismatch", {
          manifestObservationCount: context.manifest.observationCount,
          queryObservationCount: context.observations.length,
        }),
      }),
    );
  }
  const partitionCount = context.manifest.partitions.reduce(
    (total, partition) => total + partition.rowCount,
    0,
  );
  if (partitionCount !== context.manifest.observationCount) {
    findings.push(
      finding(definition, context, {
        message: "partition row counts do not sum to manifest observation count",
        severity: "ERROR",
        evidence: evidence("partition-count", "Partition row count mismatch", {
          partitionRowCount: partitionCount,
          manifestObservationCount: context.manifest.observationCount,
        }),
      }),
    );
  }
  return evaluation(findings, context);
};

const partitionIntegrity = (
  definition: DataQualityRuleDefinition,
  context: DataQualityRuleContext,
): DataQualityRuleEvaluation => {
  const findings: DataQualityFinding[] = [];
  for (const partition of context.manifest.partitions) {
    if (partition.rowCount < 0) {
      findings.push(
        finding(definition, context, {
          message: "partition row count is negative",
          evidence: evidence("partition-row-count", "Partition row count cannot be negative", {
            partitionId: partition.partitionId,
            rowCount: partition.rowCount,
          }),
        }),
      );
    }
    if (
      partition.firstEventTime !== undefined &&
      partition.lastEventTime !== undefined &&
      partition.firstEventTime > partition.lastEventTime
    ) {
      findings.push(
        finding(definition, context, {
          message: "partition event-time bounds are inverted",
          evidence: evidence(
            "partition-time-bounds",
            "Partition firstEventTime is after lastEventTime",
            {
              partitionId: partition.partitionId,
              firstEventTime: partition.firstEventTime,
              lastEventTime: partition.lastEventTime,
            },
          ),
        }),
      );
    }
  }
  return evaluation(findings, context);
};

const coverageAndImportRejections = (
  definition: DataQualityRuleDefinition,
  context: DataQualityRuleContext,
): DataQualityRuleEvaluation => {
  const findings: DataQualityFinding[] = [];
  const minimum = definition.thresholds?.minObservationCount ?? 1;
  if (context.manifest.observationCount < minimum) {
    findings.push(
      finding(definition, context, {
        message: "dataset contains fewer observations than the profile minimum",
        evidence: evidence("minimum-observation-count", "Observation count below threshold", {
          observationCount: context.manifest.observationCount,
          minimum,
        }),
      }),
    );
  }
  if (context.manifest.completenessStatus === "COMPLETED_WITH_REJECTIONS") {
    findings.push(
      finding(definition, context, {
        message: "historical import completed with rejected source records",
        evidence: evidence("import-rejections", "Manifest records import rejection evidence", {
          rejectionCount: context.manifest.rejectionCount,
          completenessStatus: context.manifest.completenessStatus,
        }),
      }),
    );
  }
  return evaluation(findings, context);
};

const barGapAndOverlap = (
  definition: DataQualityRuleDefinition,
  context: DataQualityRuleContext,
): DataQualityRuleEvaluation => {
  const bars = context.observations.filter(isBar);
  if (bars.length < 2) {
    return insufficientOrNotApplicable(bars.length, "at least two bars are required");
  }
  const findings: DataQualityFinding[] = [];
  for (const group of groupObservations(
    bars,
    (bar) => `${bar.instrumentId}:${timeframeKey(bar)}`,
  )) {
    const sorted = [...group].sort((left, right) =>
      left.intervalStart.localeCompare(right.intervalStart),
    );
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (previous === undefined || current === undefined) {
        continue;
      }
      const previousEnd = Date.parse(previous.intervalEnd);
      const currentStart = Date.parse(current.intervalStart);
      if (currentStart < previousEnd) {
        findings.push(
          finding(definition, context, {
            observation: current,
            message: "bar interval overlaps the previous bar interval",
            evidence: evidence(
              "bar-overlap",
              "Current interval starts before previous interval ends",
              {
                previousObservationId: previous.observationId,
                currentObservationId: current.observationId,
                previousEnd: previous.intervalEnd,
                currentStart: current.intervalStart,
              },
            ),
          }),
        );
      } else if (currentStart > previousEnd) {
        const expected = fixedTimeframeMs(previous);
        const gapMs = currentStart - previousEnd;
        if (
          expected === undefined ||
          gapMs >= expected * (definition.thresholds?.maxGapIntervals ?? 1)
        ) {
          findings.push(
            finding(definition, context, {
              observation: current,
              message: "bar interval gap detected",
              evidence: evidence("bar-gap", "Current interval starts after previous interval end", {
                previousObservationId: previous.observationId,
                currentObservationId: current.observationId,
                gapMs,
              }),
            }),
          );
        }
      }
    }
  }
  return evaluation(findings, context);
};

const duplicateObservation = (
  definition: DataQualityRuleDefinition,
  context: DataQualityRuleContext,
): DataQualityRuleEvaluation => {
  if (context.observations.length < 2) {
    return insufficientOrNotApplicable(
      context.observations.length,
      "at least two observations are required",
    );
  }
  const findings: DataQualityFinding[] = [];
  const byObservationId = new Map<string, MarketObservation>();
  const bySemanticFingerprint = new Map<string, MarketObservation>();
  const byQualityDuplicateKey = new Map<string, MarketObservation>();
  for (const observation of context.observations) {
    const existingId = byObservationId.get(observation.observationId);
    if (existingId !== undefined) {
      findings.push(
        finding(definition, context, {
          observation,
          message: "duplicate observationId detected",
          evidence: evidence(
            "duplicate-observation-id",
            "Two observations share an observationId",
            {
              observationId: observation.observationId,
              duplicateOfObservationId: existingId.observationId,
            },
          ),
        }),
      );
    }
    byObservationId.set(observation.observationId, observation);

    const semantic = marketObservationSemanticFingerprint(observation);
    const existingSemantic = bySemanticFingerprint.get(semantic);
    if (
      existingSemantic !== undefined &&
      existingSemantic.observationId !== observation.observationId
    ) {
      findings.push(
        finding(definition, context, {
          observation,
          message: "semantic duplicate observation detected",
          evidence: evidence(
            "semantic-duplicate",
            "Two observations share a semantic fingerprint",
            {
              observationId: observation.observationId,
              duplicateOfObservationId: existingSemantic.observationId,
              semantic,
            },
          ),
        }),
      );
    }
    bySemanticFingerprint.set(semantic, observation);

    const qualityKey = qualityDuplicateKey(observation);
    const existingQualityKey = byQualityDuplicateKey.get(qualityKey);
    if (
      existingQualityKey !== undefined &&
      existingQualityKey.observationId !== observation.observationId
    ) {
      findings.push(
        finding(definition, context, {
          observation,
          message: "quality duplicate observation detected",
          evidence: evidence(
            "quality-duplicate",
            "Two observations share quality-relevant content",
            {
              observationId: observation.observationId,
              duplicateOfObservationId: existingQualityKey.observationId,
            },
          ),
        }),
      );
    }
    byQualityDuplicateKey.set(qualityKey, observation);
  }
  return evaluation(findings, context);
};

const timestampAndSequence = (
  definition: DataQualityRuleDefinition,
  context: DataQualityRuleContext,
): DataQualityRuleEvaluation => {
  if (context.observations.length === 0) {
    return insufficientOrNotApplicable(0, "no observations are available");
  }
  const findings: DataQualityFinding[] = [];
  const asOfMs = Date.parse(context.request.asOf ?? context.clock.now());
  const seenSequences = new Map<string, MarketObservation>();
  for (const observation of context.observations) {
    if (Date.parse(observation.eventTime) > asOfMs) {
      findings.push(
        finding(definition, context, {
          observation,
          message: "event time is in the future relative to the analysis clock",
          evidence: evidence("future-event-time", "Observation eventTime is after analysis asOf", {
            observationId: observation.observationId,
            eventTime: observation.eventTime,
            asOf: context.request.asOf ?? context.clock.now(),
          }),
        }),
      );
    }
    if (observation.sourceTime !== undefined && Date.parse(observation.sourceTime) > asOfMs) {
      findings.push(
        finding(definition, context, {
          observation,
          message: "source time is in the future relative to the analysis clock",
          evidence: evidence(
            "future-source-time",
            "Observation sourceTime is after analysis asOf",
            {
              observationId: observation.observationId,
              sourceTime: observation.sourceTime,
              asOf: context.request.asOf ?? context.clock.now(),
            },
          ),
        }),
      );
    }
    if (observation.sequence !== undefined && observation.sequence.scope !== "UNKNOWN") {
      const key = `${observation.instrumentId}:${observation.sequence.scope}:${observation.sequence.scopeId ?? ""}:${observation.sequence.sequence}`;
      const duplicate = seenSequences.get(key);
      if (duplicate !== undefined) {
        findings.push(
          finding(definition, context, {
            observation,
            category: "SEQUENCE_ANOMALY",
            message: "duplicate scoped sequence evidence detected",
            evidence: evidence(
              "duplicate-sequence",
              "Two observations share scoped sequence evidence",
              {
                observationId: observation.observationId,
                duplicateOfObservationId: duplicate.observationId,
                sequence: observation.sequence.sequence,
              },
            ),
          }),
        );
      }
      seenSequences.set(key, observation);
    }
  }
  return evaluation(findings, context);
};

const freshnessStaleness = (
  definition: DataQualityRuleDefinition,
  context: DataQualityRuleContext,
): DataQualityRuleEvaluation => {
  const lastEventTime = context.manifest.lastEventTime;
  if (lastEventTime === undefined) {
    return {
      status: "INSUFFICIENT_EVIDENCE",
      findings: [],
      suppressedFindingCount: 0,
      message: "manifest has no lastEventTime",
    };
  }
  const asOf = context.request.asOf ?? context.clock.now();
  const ageMs = Date.parse(asOf) - Date.parse(lastEventTime);
  const staleAfterMs = definition.thresholds?.freshnessMaxAgeMs ?? 86_400_000;
  const futureToleranceMs = definition.thresholds?.freshnessFutureToleranceMs ?? 60_000;
  if (ageMs > staleAfterMs) {
    return evaluation(
      [
        finding(definition, context, {
          message: "dataset is stale relative to the profile freshness threshold",
          evidence: evidence("stale-dataset", "Dataset last event is older than threshold", {
            lastEventTime,
            asOf,
            ageMs,
            staleAfterMs,
          }),
        }),
      ],
      context,
    );
  }
  if (ageMs < -futureToleranceMs) {
    return evaluation(
      [
        finding(definition, context, {
          message: "dataset last event time is in the future relative to analysis time",
          evidence: evidence("future-dataset", "Dataset last event exceeds future skew tolerance", {
            lastEventTime,
            asOf,
            ageMs,
            futureToleranceMs,
          }),
        }),
      ],
      context,
    );
  }
  return evaluation([], context);
};

const quoteSpread = (
  definition: DataQualityRuleDefinition,
  context: DataQualityRuleContext,
): DataQualityRuleEvaluation => {
  const quotes = quoteLikeObservations(context.observations);
  if (quotes.length === 0) {
    return { status: "NOT_APPLICABLE", findings: [], suppressedFindingCount: 0 };
  }
  const findings: DataQualityFinding[] = [];
  for (const quote of quotes) {
    if (quote.bid === undefined || quote.ask === undefined) {
      continue;
    }
    const bid = new Decimal(quote.bid.value);
    const ask = new Decimal(quote.ask.value);
    if (bid.greaterThan(ask)) {
      findings.push(
        finding(definition, context, {
          observation: quote.observation,
          message: "crossed quote detected",
          evidence: evidence("crossed-quote", "Bid exceeds ask", {
            observationId: quote.observation.observationId,
            bid: quote.bid.value,
            ask: quote.ask.value,
          }),
        }),
      );
    }
    const mid = bid.plus(ask).div(2);
    if (mid.greaterThan(0)) {
      const spreadBps = ask.minus(bid).div(mid).mul(10_000);
      const maxSpreadBps = definition.thresholds?.maxSpreadBps;
      if (maxSpreadBps !== undefined && spreadBps.greaterThan(maxSpreadBps)) {
        findings.push(
          finding(definition, context, {
            observation: quote.observation,
            message: "quote spread exceeds profile threshold",
            evidence: evidence("wide-spread", "Spread basis points exceeds threshold", {
              observationId: quote.observation.observationId,
              spreadBps: Number(spreadBps.toFixed(4)),
              maxSpreadBps,
            }),
          }),
        );
      }
    }
  }
  return evaluation(findings, context);
};

const ohlcConsistency = (
  definition: DataQualityRuleDefinition,
  context: DataQualityRuleContext,
): DataQualityRuleEvaluation => {
  const bars = context.observations.filter(isBar);
  if (bars.length === 0) {
    return { status: "NOT_APPLICABLE", findings: [], suppressedFindingCount: 0 };
  }
  const findings: DataQualityFinding[] = [];
  for (const bar of bars) {
    const open = new Decimal(bar.open.value);
    const high = new Decimal(bar.high.value);
    const low = new Decimal(bar.low.value);
    const close = new Decimal(bar.close.value);
    if ([open, low, close].some((price) => high.lessThan(price))) {
      findings.push(
        finding(definition, context, {
          observation: bar,
          message: "bar high is below at least one OHLC price",
          evidence: evidence(
            "ohlc-high",
            "High must be greater than or equal to open, low and close",
            {
              observationId: bar.observationId,
            },
          ),
        }),
      );
    }
    if ([open, high, close].some((price) => low.greaterThan(price))) {
      findings.push(
        finding(definition, context, {
          observation: bar,
          message: "bar low is above at least one OHLC price",
          evidence: evidence("ohlc-low", "Low must be less than or equal to open, high and close", {
            observationId: bar.observationId,
          }),
        }),
      );
    }
  }
  return evaluation(findings, context);
};

const priceOutlier = (
  definition: DataQualityRuleDefinition,
  context: DataQualityRuleContext,
): DataQualityRuleEvaluation => {
  const priced = context.observations
    .map((observation) => ({ observation, price: representativePrice(observation) }))
    .filter(
      (entry): entry is Readonly<{ observation: MarketObservation; price: Decimal }> =>
        entry.price !== undefined,
    );
  if (priced.length < 2) {
    return insufficientOrNotApplicable(
      priced.length,
      "at least two priced observations are required",
    );
  }
  const findings: DataQualityFinding[] = [];
  const threshold = definition.thresholds?.maxPriceJumpRatio ?? 0.1;
  for (const group of groupObservations(
    priced,
    (entry) => `${entry.observation.instrumentId}:${entry.observation.observationKind}`,
  )) {
    const sorted = [...group].sort((left, right) =>
      left.observation.eventTime.localeCompare(right.observation.eventTime),
    );
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (previous === undefined || current === undefined || previous.price.isZero()) {
        continue;
      }
      const ratio = current.price.minus(previous.price).abs().div(previous.price.abs());
      if (ratio.greaterThan(threshold)) {
        findings.push(
          finding(definition, context, {
            observation: current.observation,
            message: "price jump exceeds profile threshold",
            evidence: evidence(
              "price-jump",
              "Adjacent representative prices moved beyond threshold",
              {
                previousObservationId: previous.observation.observationId,
                currentObservationId: current.observation.observationId,
                ratio: Number(ratio.toFixed(6)),
                threshold,
              },
            ),
          }),
        );
      }
    }
  }
  return evaluation(findings, context);
};

const volumeAnomaly = (
  definition: DataQualityRuleDefinition,
  context: DataQualityRuleContext,
): DataQualityRuleEvaluation => {
  const volumeBearing = context.observations.filter(
    (observation) =>
      observation.observationKind === "TRADE" ||
      observation.observationKind === "BAR" ||
      observation.observationKind === "TICK",
  );
  if (volumeBearing.length === 0) {
    return { status: "NOT_APPLICABLE", findings: [], suppressedFindingCount: 0 };
  }
  const findings: DataQualityFinding[] = [];
  for (const observation of volumeBearing) {
    const volumes = volumeValues(observation);
    if (volumes.length === 0) {
      findings.push(
        finding(definition, context, {
          observation,
          message: "volume-bearing observation has no volume or quantity evidence",
          evidence: evidence("missing-volume", "No volume or quantity evidence is present", {
            observationId: observation.observationId,
          }),
        }),
      );
    } else if (volumes.some((volume) => volume.isZero())) {
      findings.push(
        finding(definition, context, {
          observation,
          message: "zero volume evidence detected",
          evidence: evidence("zero-volume", "At least one volume or quantity value is zero", {
            observationId: observation.observationId,
          }),
        }),
      );
    }
  }
  return evaluation(findings, context);
};

const timezoneSessionProvenance = (
  definition: DataQualityRuleDefinition,
  context: DataQualityRuleContext,
): DataQualityRuleEvaluation => {
  if (context.observations.length === 0) {
    return insufficientOrNotApplicable(0, "no observations are available");
  }
  const findings: DataQualityFinding[] = [];
  for (const observation of context.observations) {
    if (observation.provenance.sourceTimezone === undefined) {
      findings.push(
        finding(definition, context, {
          observation,
          message: "source timezone evidence is absent",
          evidence: evidence(
            "missing-source-timezone",
            "Observation provenance has no sourceTimezone",
            {
              observationId: observation.observationId,
            },
          ),
        }),
      );
    }
    if (observation.session === undefined) {
      findings.push(
        finding(definition, context, {
          observation,
          message: "market session evidence is absent",
          evidence: evidence("missing-session", "Observation has no session reference", {
            observationId: observation.observationId,
          }),
        }),
      );
    }
  }
  return evaluation(findings, context);
};

const provenanceCompleteness = (
  definition: DataQualityRuleDefinition,
  context: DataQualityRuleContext,
): DataQualityRuleEvaluation => {
  if (context.observations.length === 0) {
    return insufficientOrNotApplicable(0, "no observations are available");
  }
  const findings: DataQualityFinding[] = [];
  for (const observation of context.observations) {
    const missing: string[] = [];
    if (observation.providerSymbol === undefined) {
      missing.push("providerSymbol");
    }
    if (observation.sourceTimestampPrecision === "UNKNOWN") {
      missing.push("sourceTimestampPrecision");
    }
    if (observation.provenance.sourceObservationId === undefined) {
      missing.push("sourceObservationId");
    }
    if (observation.provenance.datasetVersion === undefined) {
      missing.push("datasetVersion");
    }
    if (missing.length > 0) {
      findings.push(
        finding(definition, context, {
          observation,
          message: "observation provenance is incomplete for quality assessment",
          evidence: evidence("missing-provenance", "Bounded provenance fields are absent", {
            observationId: observation.observationId,
            missing: missing.join(","),
          }),
        }),
      );
    }
  }
  return evaluation(findings, context);
};

const evaluation = (
  findings: readonly DataQualityFinding[],
  context: DataQualityRuleContext,
): DataQualityRuleEvaluation => {
  const limit = context.request.profile.evidenceLimitPerRule;
  return {
    status: findings.length === 0 ? "PASS" : "FINDINGS",
    findings: findings.slice(0, limit),
    suppressedFindingCount: Math.max(0, findings.length - limit),
  };
};

const insufficientOrNotApplicable = (
  count: number,
  message: string,
): DataQualityRuleEvaluation => ({
  status: count === 0 ? "NOT_APPLICABLE" : "INSUFFICIENT_EVIDENCE",
  findings: [],
  suppressedFindingCount: 0,
  message,
});

const finding = (
  definition: DataQualityRuleDefinition,
  context: DataQualityRuleContext,
  input: Readonly<{
    message: string;
    evidence: DataQualityEvidence;
    observation?: MarketObservation;
    category?: DataQualityFindingCategory;
    severity?: DataQualitySeverity;
  }>,
): DataQualityFinding => ({
  findingId: fingerprint({
    ruleId: definition.ruleId,
    datasetId: context.manifest.datasetId,
    message: input.message,
    observationId: input.observation?.observationId,
    evidence: input.evidence,
  }).replace("sha256:", "dqf-") as DataQualityFindingId,
  ruleId: definition.ruleId,
  category: input.category ?? definition.category,
  dimension: definition.dimension,
  severity: input.severity ?? definition.severity,
  message: input.message,
  ...(input.observation === undefined ? {} : { instrumentId: input.observation.instrumentId }),
  ...(input.observation === undefined
    ? {}
    : { observationKind: input.observation.observationKind }),
  ...(input.observation === undefined ? {} : { eventTime: input.observation.eventTime }),
  evidence: [input.evidence],
});

const evidence = (
  evidenceId: string,
  summary: string,
  sample: Record<string, string | number | boolean | null>,
): DataQualityEvidence => ({
  evidenceId,
  summary,
  observationIds:
    typeof sample.observationId === "string"
      ? [sample.observationId]
      : [
          typeof sample.previousObservationId === "string"
            ? sample.previousObservationId
            : undefined,
          typeof sample.currentObservationId === "string" ? sample.currentObservationId : undefined,
        ].filter((value): value is string => value !== undefined),
  partitionIds: typeof sample.partitionId === "string" ? [sample.partitionId] : [],
  sample: [sample],
});

const isBar = (observation: MarketObservation): observation is BarObservation =>
  observation.observationKind === "BAR";

const timeframeKey = (bar: BarObservation): string =>
  typeof bar.timeframe === "string" ? bar.timeframe : bar.timeframe.code;

const fixedTimeframeMs = (bar: BarObservation): number | undefined => {
  if (typeof bar.timeframe === "string" || bar.timeframe.kind !== "FIXED") {
    return undefined;
  }
  const multiplier = {
    SECOND: 1_000,
    MINUTE: 60_000,
    HOUR: 3_600_000,
    DAY: 86_400_000,
    WEEK: 604_800_000,
    MONTH: 2_592_000_000,
  } as const;
  return bar.timeframe.length === undefined || bar.timeframe.unit === undefined
    ? undefined
    : bar.timeframe.length * multiplier[bar.timeframe.unit];
};

const groupObservations = <T>(
  values: readonly T[],
  keyOf: (value: T) => string,
): readonly (readonly T[])[] => {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyOf(value);
    groups.set(key, [...(groups.get(key) ?? []), value]);
  }
  return [...groups.values()];
};

const quoteLikeObservations = (
  observations: readonly MarketObservation[],
): readonly (Readonly<{
  observation: MarketObservation;
}> &
  Pick<QuoteObservation, "bid" | "ask">)[] =>
  observations.flatMap(
    (
      observation,
    ): readonly (Readonly<{ observation: MarketObservation }> &
      Pick<QuoteObservation, "bid" | "ask">)[] => {
      if (observation.observationKind === "QUOTE") {
        return [{ observation, bid: observation.bid, ask: observation.ask }];
      }
      if (
        observation.observationKind === "TICK" &&
        (observation.tickKind === "QUOTE" || observation.tickKind === "COMBINED") &&
        observation.quote !== undefined
      ) {
        return [{ observation, bid: observation.quote.bid, ask: observation.quote.ask }];
      }
      return [];
    },
  );

const representativePrice = (observation: MarketObservation): Decimal | undefined => {
  switch (observation.observationKind) {
    case "QUOTE":
      if (observation.bid !== undefined && observation.ask !== undefined) {
        return new Decimal(observation.bid.value).plus(observation.ask.value).div(2);
      }
      return observation.bid === undefined ? undefined : new Decimal(observation.bid.value);
    case "TRADE":
      return new Decimal(observation.price.value);
    case "TICK":
      if (observation.trade !== undefined) {
        return new Decimal(observation.trade.price.value);
      }
      if (observation.quote?.bid !== undefined && observation.quote.ask !== undefined) {
        return new Decimal(observation.quote.bid.value).plus(observation.quote.ask.value).div(2);
      }
      return undefined;
    case "BAR":
      return new Decimal(observation.close.value);
    case "MARKET_STATUS":
      return undefined;
  }
};

const qualityDuplicateKey = (observation: MarketObservation): string =>
  stableStringify({
    observationKind: observation.observationKind,
    instrumentId: observation.instrumentId,
    providerSymbol: observation.providerSymbol,
    eventTime: observation.eventTime,
    payload: qualityDuplicatePayload(observation),
  });

const qualityDuplicatePayload = (observation: MarketObservation): unknown => {
  switch (observation.observationKind) {
    case "QUOTE":
      return {
        bid: observation.bid,
        ask: observation.ask,
        bidSize: observation.bidSize,
        askSize: observation.askSize,
      };
    case "TRADE":
      return {
        price: observation.price,
        quantity: observation.quantity,
        sourceTradeId: observation.sourceTradeId,
        aggressorSide: observation.aggressorSide,
      };
    case "TICK":
      return {
        tickKind: observation.tickKind,
        quote: observation.quote,
        trade: observation.trade,
      };
    case "BAR":
      return {
        timeframe: observation.timeframe,
        intervalStart: observation.intervalStart,
        intervalEnd: observation.intervalEnd,
        open: observation.open,
        high: observation.high,
        low: observation.low,
        close: observation.close,
        volumes: observation.volumes,
        completeness: observation.completeness,
      };
    case "MARKET_STATUS":
      return {
        status: observation.status,
        statusSource: observation.statusSource,
        reason: observation.reason,
      };
  }
};

const volumeValues = (observation: MarketObservation): readonly Decimal[] => {
  switch (observation.observationKind) {
    case "TRADE":
      return observation.quantity === undefined ? [] : [new Decimal(observation.quantity.value)];
    case "TICK":
      return observation.trade?.quantity === undefined
        ? []
        : [new Decimal(observation.trade.quantity.value)];
    case "BAR":
      return observation.volumes.flatMap((volume) =>
        volume.quantity === undefined ? [] : [new Decimal(volume.quantity.value)],
      );
    case "QUOTE":
    case "MARKET_STATUS":
      return [];
  }
};
