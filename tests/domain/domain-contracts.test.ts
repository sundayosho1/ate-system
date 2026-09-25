import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  addMoney,
  compareDecimal,
  domainSchemas,
  parseAccountId,
  parseDecimal,
  parseDomainContract,
  parseInstrumentId,
  parseMoney,
  parseUtcTimestamp,
  roundDecimal,
  unwrapOrThrow,
  type AccountExecutionIntent,
  type Decision,
  type Instrument,
  type MasterTradeDecision,
} from "@ate/domain";

const root = process.cwd();
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(root, "tests", "fixtures", "domain", name), "utf8")) as unknown;

const id = {
  accountA: "10000000-0000-4000-8000-00000000000a",
  accountB: "10000000-0000-4000-8000-00000000000b",
  accountC: "10000000-0000-4000-8000-00000000000c",
  broker: "10000000-0000-4000-8000-000000000010",
  venue: "10000000-0000-4000-8000-000000000011",
  source: "10000000-0000-4000-8000-000000000012",
  instrumentFx: "10000000-0000-4000-8000-000000000013",
  instrumentMetal: "10000000-0000-4000-8000-000000000014",
  instrumentIndex: "10000000-0000-4000-8000-000000000015",
  instrumentCrypto: "10000000-0000-4000-8000-000000000016",
  brokerInstrument: "10000000-0000-4000-8000-000000000017",
  market: "10000000-0000-4000-8000-000000000018",
  observation: "10000000-0000-4000-8000-000000000019",
  observationBar: "10000000-0000-4000-8000-000000000020",
  snapshot: "10000000-0000-4000-8000-000000000021",
  mandate: "10000000-0000-4000-8000-000000000022",
  strategy: "10000000-0000-4000-8000-000000000023",
  strategyVersion: "10000000-0000-4000-8000-000000000024",
  setup: "10000000-0000-4000-8000-000000000025",
  signal: "10000000-0000-4000-8000-000000000026",
  score: "10000000-0000-4000-8000-000000000027",
  candidate: "10000000-0000-4000-8000-000000000028",
  opportunity: "10000000-0000-4000-8000-000000000029",
  decision: "10000000-0000-4000-8000-000000000030",
  masterDecision: "10000000-0000-4000-8000-000000000031",
  intentA: "10000000-0000-4000-8000-000000000032",
  intentB: "10000000-0000-4000-8000-000000000033",
  order: "10000000-0000-4000-8000-000000000034",
  fill: "10000000-0000-4000-8000-000000000035",
  position: "10000000-0000-4000-8000-000000000036",
  trade: "10000000-0000-4000-8000-000000000037",
  portfolio: "10000000-0000-4000-8000-000000000038",
  riskAssessment: "10000000-0000-4000-8000-000000000039",
  event: "10000000-0000-4000-8000-000000000040",
  correlation: "10000000-0000-4000-8000-000000000041",
  causation: "10000000-0000-4000-8000-000000000042",
  configurationVersion: "10000000-0000-4000-8000-000000000043",
  dataset: "10000000-0000-4000-8000-000000000044",
  datasetVersion: "10000000-0000-4000-8000-000000000045",
  idempotency: "10000000-0000-4000-8000-000000000046",
};

const at = {
  t0: "2026-09-25T00:00:00.000Z",
  t1: "2026-09-25T00:01:00.000Z",
  t2: "2026-09-25T00:02:00.000Z",
  t3: "2026-09-25T00:03:00.000Z",
};

const source = {
  sourceId: id.source,
  sourceType: "SYSTEM",
  name: "Prompt 2 Test Source",
};

const provenance = {
  source,
  observedAt: at.t0,
  ingestedAt: at.t1,
  qualityStatus: "HEALTHY",
};

const configurationVersion = {
  configurationVersionId: id.configurationVersion,
  version: "prompt-2-test",
};

const strategyVersion = {
  strategyId: id.strategy,
  strategyVersionId: id.strategyVersion,
  version: "1.0.0-research",
};

const reason = {
  code: "DATA.INSUFFICIENT_DATA",
  category: "DATA",
  summary: "Insufficient qualified data.",
  authority: "SYSTEM",
  severity: "WARNING",
  evidenceRefs: [],
};

const price = (value: string) => ({
  value,
  instrumentId: id.instrumentFx,
  quoteCurrency: "USD",
});

const quantity = (value: string, unit = "ASSET_UNITS") => ({ value, unit });

const roundTrip = <T>(schema: Parameters<typeof parseDomainContract<T>>[0], value: unknown): T => {
  const parsed = unwrapOrThrow(parseDomainContract(schema, value));
  return unwrapOrThrow(parseDomainContract(schema, JSON.parse(JSON.stringify(parsed))));
};

describe("domain primitives", () => {
  it("validates branded identifiers without allowing malformed IDs", () => {
    expect(parseInstrumentId(id.instrumentFx).ok).toBe(true);
    expect(parseAccountId(id.accountA).ok).toBe(true);
    expect(parseInstrumentId("FX:EURUSD").ok).toBe(false);
  });

  it("parses plain decimal strings and rejects unsafe numeric representations", () => {
    for (const value of ["0", "0.00000001", "999999999999999999.123456789"]) {
      expect(parseDecimal(value).ok, `${value} should be valid`).toBe(true);
    }

    for (const value of ["NaN", "Infinity", "1e-8", "+1", "", 1]) {
      expect(parseDecimal(value).ok, `${String(value)} should be invalid`).toBe(false);
    }
  });

  it("adds same-currency money and rejects incompatible currencies", () => {
    const usd100 = unwrapOrThrow(parseMoney({ amount: "100.10", currency: "USD" }));
    const usd200 = unwrapOrThrow(parseMoney({ amount: "200.20", currency: "USD" }));
    const eur1 = unwrapOrThrow(parseMoney({ amount: "1", currency: "EUR" }));

    expect(unwrapOrThrow(addMoney(usd100, usd200))).toEqual({
      amount: "300.3",
      currency: "USD",
    });
    expect(addMoney(usd100, eur1).ok).toBe(false);
  });

  it("rounds decimals only with explicit rounding mode", () => {
    const parsed = unwrapOrThrow(parseDecimal("1.235"));
    expect(unwrapOrThrow(roundDecimal(parsed, 2, "HALF_UP"))).toBe("1.24");
    expect(unwrapOrThrow(roundDecimal(parsed, 2, "DOWN"))).toBe("1.23");
  });

  it("uses ratio semantics for percentages where 0.01 means 1 percent and 1 means 100 percent", () => {
    expect(
      parseDomainContract(domainSchemas.accountSnapshot.shape.marginLevel, { ratio: "0.01" }).ok,
    ).toBe(true);
    expect(
      parseDomainContract(domainSchemas.accountSnapshot.shape.marginLevel, { ratio: "1" }).ok,
    ).toBe(true);
    expect(
      parseDomainContract(domainSchemas.accountSnapshot.shape.marginLevel, { ratio: "1.01" }).ok,
    ).toBe(false);
  });

  it("normalizes timezone-explicit timestamps to UTC and rejects local-time strings", () => {
    expect(unwrapOrThrow(parseUtcTimestamp("2026-09-25T01:00:00.000+01:00"))).toBe(
      "2026-09-25T00:00:00.000Z",
    );
    expect(parseUtcTimestamp("2026-09-25T00:00:00").ok).toBe(false);
  });

  it("compares exact decimal strings deterministically", () => {
    const tiny = unwrapOrThrow(parseDecimal("0.000000000000000001"));
    const larger = unwrapOrThrow(parseDecimal("0.000000000000000002"));
    expect(compareDecimal(tiny, larger)).toBeLessThan(0);
  });
});

describe("instrument, market, and observation contracts", () => {
  it("represents multiple asset classes without Forex-only assumptions", () => {
    const instruments: Instrument[] = [
      {
        schemaVersion: 1,
        instrumentId: id.instrumentFx,
        canonicalSymbol: "FX:EURUSD",
        displayName: "Euro / US Dollar",
        assetClass: "FOREX",
        baseCurrency: "EUR",
        quoteCurrency: "USD",
        status: "RESEARCH_ELIGIBLE",
      },
      {
        schemaVersion: 1,
        instrumentId: id.instrumentMetal,
        canonicalSymbol: "METAL:XAUUSD",
        displayName: "Gold / US Dollar",
        assetClass: "METAL",
        quoteCurrency: "USD",
        status: "RESEARCH_ELIGIBLE",
      },
      {
        schemaVersion: 1,
        instrumentId: id.instrumentIndex,
        canonicalSymbol: "INDEX:US500",
        displayName: "US 500 Index",
        assetClass: "INDEX",
        status: "RESEARCH_ELIGIBLE",
      },
      {
        schemaVersion: 1,
        instrumentId: id.instrumentCrypto,
        canonicalSymbol: "CRYPTO:BTCUSD",
        displayName: "Bitcoin / US Dollar",
        assetClass: "CRYPTO",
        baseAsset: "BTC",
        quoteCurrency: "USD",
        status: "RESEARCH_ELIGIBLE",
      },
    ].map((instrument) => unwrapOrThrow(parseDomainContract(domainSchemas.instrument, instrument)));

    expect(instruments.map((instrument) => instrument.assetClass)).toEqual([
      "FOREX",
      "METAL",
      "INDEX",
      "CRYPTO",
    ]);
  });

  it("keeps canonical instruments separate from broker instrument references", () => {
    const brokerReference = unwrapOrThrow(
      parseDomainContract(domainSchemas.brokerInstrumentReference, {
        schemaVersion: 1,
        brokerInstrumentRefId: id.brokerInstrument,
        brokerId: id.broker,
        executionVenueId: id.venue,
        brokerSymbol: "EURUSD.a",
        instrumentId: id.instrumentFx,
        mappingStatus: "MAPPED",
      }),
    );

    expect(brokerReference.brokerSymbol).toBe("EURUSD.a");
    expect(brokerReference.instrumentId).toBe(id.instrumentFx);
  });

  it("validates markets, quotes, bars, and timeframe codes", () => {
    expect(
      parseDomainContract(domainSchemas.market, {
        schemaVersion: 1,
        marketId: id.market,
        instrumentId: id.instrumentFx,
        brokerInstrumentRefId: id.brokerInstrument,
        tradingStatus: "OPEN",
        marketDataSource: source,
      }).ok,
    ).toBe(true);

    expect(
      parseDomainContract(domainSchemas.quoteObservation, fixture("market-quote.json")).ok,
    ).toBe(true);

    const bar = {
      schemaVersion: 1,
      observationId: id.observationBar,
      instrumentId: id.instrumentFx,
      timeframe: "M5",
      openTime: at.t0,
      closeTime: at.t1,
      open: price("1.1000"),
      high: price("1.1010"),
      low: price("1.0990"),
      close: price("1.1005"),
      volume: quantity("120", "TICKS"),
      volumeType: "TICK",
      completeness: "FINAL",
      source,
      provenance,
      qualityStatus: "HEALTHY",
    };

    expect(parseDomainContract(domainSchemas.barObservation, bar).ok).toBe(true);
    expect(
      parseDomainContract(domainSchemas.barObservation, { ...bar, timeframe: "5MIN" }).ok,
    ).toBe(false);
    expect(
      parseDomainContract(domainSchemas.barObservation, { ...bar, high: price("1.0980") }).ok,
    ).toBe(false);
  });
});

describe("account, strategy, setup, signal, candidate, and decision contracts", () => {
  it("separates account identity, snapshots, and mandates without credential fields", () => {
    const account = {
      schemaVersion: 1,
      accountId: id.accountA,
      brokerId: id.broker,
      label: "Research Account A",
      currency: "USD",
      runtimeEligibility: ["RESEARCH", "SIMULATION", "PAPER"],
      operationalStatus: "HEALTHY",
      tradingStatus: "SUSPENDED",
      mandateId: id.mandate,
      protectionState: "NORMAL",
    };

    expect(parseDomainContract(domainSchemas.account, account).ok).toBe(true);
    expect(parseDomainContract(domainSchemas.account, { ...account, password: "secret" }).ok).toBe(
      false,
    );
    expect(
      parseDomainContract(domainSchemas.accountSnapshot, {
        schemaVersion: 1,
        accountId: id.accountA,
        observedAt: at.t1,
        source,
        balance: { amount: "10000", currency: "USD" },
        equity: { amount: "10025.50", currency: "USD" },
        marginLevel: { ratio: "0.25" },
        operationalStatus: "HEALTHY",
        tradingStatus: "SUSPENDED",
        qualityStatus: "HEALTHY",
      }).ok,
    ).toBe(true);
    expect(
      parseDomainContract(domainSchemas.accountMandate, {
        schemaVersion: 1,
        mandateId: id.mandate,
        permittedAssetClasses: ["FOREX", "METAL"],
        permittedInstrumentIds: [id.instrumentFx],
        permittedStrategyIds: [id.strategy],
        liveEligible: false,
      }).ok,
    ).toBe(true);
  });

  it("distinguishes setup, signal, candidate, score, opportunity, and decision", () => {
    const setup = unwrapOrThrow(
      parseDomainContract(domainSchemas.setup, {
        schemaVersion: 1,
        setupId: id.setup,
        instrumentId: id.instrumentFx,
        strategyVersion,
        timeframe: "M5",
        detectedAt: at.t1,
        state: "DETECTED",
      }),
    );
    const score = unwrapOrThrow(
      parseDomainContract(domainSchemas.signalScore, {
        schemaVersion: 1,
        scoreId: id.score,
        value: "72.5",
        scale: { min: "0", max: "100" },
        modelVersionRef: "score-model:v1",
        calculatedAt: at.t1,
        provenance,
      }),
    );
    const signal = unwrapOrThrow(
      parseDomainContract(domainSchemas.signal, {
        schemaVersion: 1,
        signalId: id.signal,
        strategyVersion,
        instrumentId: id.instrumentFx,
        direction: "LONG",
        generatedAt: at.t1,
        timeframe: "M5",
        scoreId: score.scoreId,
        provenance,
      }),
    );
    const candidate = unwrapOrThrow(
      parseDomainContract(domainSchemas.tradeCandidate, {
        schemaVersion: 1,
        candidateId: id.candidate,
        originatingStrategy: strategyVersion,
        instrumentId: id.instrumentFx,
        direction: "LONG",
        createdAt: at.t1,
        setupId: setup.setupId,
        signalId: signal.signalId,
        proposedEntry: { kind: "MARKET" },
        scoreId: score.scoreId,
        configurationVersion,
        runtimeMode: "SIMULATION",
        state: "CREATED",
        provenance,
        correlationId: id.correlation,
      }),
    );
    const decision = unwrapOrThrow(
      parseDomainContract(domainSchemas.decision, {
        schemaVersion: 1,
        decisionId: id.decision,
        outcome: "DEFER",
        candidateId: candidate.candidateId,
        decidedAt: at.t2,
        authority: "STRATEGY_ORCHESTRATOR",
        reason: {
          code: "MARKET.WAITING_FOR_CONFIRMATION",
          category: "MARKET",
          summary: "Waiting for confirmation.",
          authority: "STRATEGY_ORCHESTRATOR",
          severity: "INFO",
        },
        explanation: "Candidate is represented, but no approval is implied.",
        configurationVersion,
        correlationId: id.correlation,
      }),
    );

    expect(decision.outcome).toBe("DEFER");
    expect(
      parseDomainContract(domainSchemas.opportunity, {
        schemaVersion: 1,
        opportunityId: id.opportunity,
        instrumentId: id.instrumentFx,
        state: "INTERESTING",
        observedAt: at.t1,
        source,
        relatedSetupIds: [id.setup],
      }).ok,
    ).toBe(true);
    expect(
      parseDomainContract(domainSchemas.tradeCandidate, { ...candidate, state: "EXECUTED" }).ok,
    ).toBe(false);
  });

  it("treats NO_ACTION as an explicit decision with a structured reason", () => {
    const decision = unwrapOrThrow(
      parseDomainContract(domainSchemas.decision, fixture("decision-no-action.json")),
    );

    expect(decision.outcome).toBe("NO_ACTION");
    expect(decision.reason.code).toBe("DATA.INSUFFICIENT_DATA");
  });
});

describe("execution, position, trade, portfolio, and event contracts", () => {
  it("represents a non-executing contract journey from observation to trade lifecycle", () => {
    const observation = unwrapOrThrow(
      parseDomainContract(domainSchemas.quoteObservation, fixture("market-quote.json")),
    );
    const setup = unwrapOrThrow(
      parseDomainContract(domainSchemas.setup, {
        schemaVersion: 1,
        setupId: id.setup,
        instrumentId: observation.instrumentId,
        strategyVersion,
        timeframe: "M5",
        detectedAt: at.t1,
        state: "DETECTED",
      }),
    );
    const signal = unwrapOrThrow(
      parseDomainContract(domainSchemas.signal, {
        schemaVersion: 1,
        signalId: id.signal,
        strategyVersion,
        instrumentId: observation.instrumentId,
        direction: "LONG",
        generatedAt: at.t1,
        timeframe: "M5",
        provenance,
      }),
    );
    const candidate = unwrapOrThrow(
      parseDomainContract(domainSchemas.tradeCandidate, fixture("trade-candidate.json")),
    );
    const decision = unwrapOrThrow(
      parseDomainContract(domainSchemas.decision, {
        schemaVersion: 1,
        decisionId: id.decision,
        outcome: "APPROVE",
        candidateId: candidate.candidateId,
        decidedAt: at.t2,
        authority: "CAPITAL_PROTECTION",
        reason: {
          code: "PROTECTION.NORMAL",
          category: "PROTECTION",
          summary: "Protection state permits downstream representation.",
          authority: "CAPITAL_PROTECTION",
          severity: "INFO",
        },
        explanation: "Approval is representational only; no execution occurs.",
        configurationVersion,
        correlationId: id.correlation,
        causationId: id.causation,
      }),
    );
    const masterDecision = createMasterDecision(decision, candidate.candidateId);
    const intent = createExecutionIntent(id.intentA, masterDecision, id.accountA);
    const order = unwrapOrThrow(
      parseDomainContract(domainSchemas.order, {
        schemaVersion: 1,
        orderId: id.order,
        executionIntentId: intent.executionIntentId,
        accountId: id.accountA,
        instrumentId: id.instrumentFx,
        side: "BUY",
        orderType: "MARKET",
        requestedQuantity: quantity("1000"),
        timeInForce: "IMMEDIATE_OR_CANCEL",
        state: "CREATED",
        createdAt: at.t2,
        idempotencyKey: id.idempotency,
      }),
    );
    const fill = unwrapOrThrow(
      parseDomainContract(domainSchemas.fill, {
        schemaVersion: 1,
        fillId: id.fill,
        orderId: order.orderId,
        accountId: id.accountA,
        instrumentId: id.instrumentFx,
        quantity: quantity("1000"),
        price: price("1.08768"),
        executedAt: at.t3,
        source,
      }),
    );
    const position = unwrapOrThrow(
      parseDomainContract(domainSchemas.position, {
        schemaVersion: 1,
        positionId: id.position,
        accountId: id.accountA,
        instrumentId: id.instrumentFx,
        direction: "LONG",
        quantity: quantity("1000"),
        averageOpenPrice: price("1.08768"),
        openTime: at.t3,
        state: "OPEN",
        decisionId: decision.decisionId,
        orderIds: [order.orderId],
      }),
    );
    const trade = unwrapOrThrow(
      parseDomainContract(domainSchemas.trade, {
        schemaVersion: 1,
        tradeId: id.trade,
        originatingDecisionId: decision.decisionId,
        orderIds: [order.orderId],
        fillIds: [fill.fillId],
        positionId: position.positionId,
        strategyVersion,
        instrumentId: id.instrumentFx,
        accountId: id.accountA,
        state: "OPEN",
        openedAt: at.t3,
      }),
    );

    expect([
      setup.setupId,
      signal.signalId,
      masterDecision.masterTradeDecisionId,
      trade.tradeId,
    ]).toEqual([id.setup, id.signal, id.masterDecision, id.trade]);
  });

  it("represents one master decision with multiple account intents and a separate no-allocation decision", () => {
    const decision = createDecision("APPROVE");
    const masterDecision = createMasterDecision(decision, id.candidate);
    const intents: AccountExecutionIntent[] = [
      createExecutionIntent(id.intentA, masterDecision, id.accountA),
      createExecutionIntent(id.intentB, masterDecision, id.accountB),
    ];
    const accountCNoAllocation = unwrapOrThrow(
      parseDomainContract(domainSchemas.decision, {
        schemaVersion: 1,
        decisionId: "10000000-0000-4000-8000-000000000047",
        outcome: "NO_ACTION",
        decidedAt: at.t2,
        authority: "ACCOUNT_MANDATE",
        reason: {
          code: "ACCOUNT.NOT_ELIGIBLE",
          category: "ACCOUNT",
          summary: "Account C is not eligible for this master decision.",
          authority: "ACCOUNT_MANDATE",
          severity: "INFO",
        },
        explanation: "No account-specific execution intent is created for Account C.",
        correlationId: id.correlation,
      }),
    );

    expect(intents.map((intent) => intent.accountId)).toEqual([id.accountA, id.accountB]);
    expect(accountCNoAllocation.outcome).toBe("NO_ACTION");
  });

  it("validates portfolio, exposure, risk reference, protection state, and event envelope contracts", () => {
    expect(
      parseDomainContract(domainSchemas.portfolio, {
        schemaVersion: 1,
        portfolioId: id.portfolio,
        code: "RESEARCH_PORTFOLIO",
        name: "Research Portfolio",
        accountIds: [id.accountA, id.accountB],
      }).ok,
    ).toBe(true);
    expect(
      parseDomainContract(domainSchemas.portfolioSnapshot, {
        schemaVersion: 1,
        portfolioId: id.portfolio,
        observedAt: at.t2,
        accountIds: [id.accountA, id.accountB],
        positionIds: [id.position],
        exposures: [
          {
            dimension: "CURRENCY",
            reference: "USD",
            amount: { amount: "1000", currency: "USD" },
          },
        ],
        provenance,
      }).ok,
    ).toBe(true);
    expect(
      parseDomainContract(domainSchemas.riskAssessmentReference, {
        schemaVersion: 1,
        riskAssessmentId: id.riskAssessment,
        assessedAt: at.t2,
        authority: "RISK",
        result: "NOT_ASSESSED",
      }).ok,
    ).toBe(true);
    expect(
      parseDomainContract(domainSchemas.eventEnvelope, fixture("event-envelope.json")).ok,
    ).toBe(true);
    expect(
      parseDomainContract(domainSchemas.eventEnvelope, {
        ...fixture("event-envelope.json"),
        runtimeMode: "PRODUCTION",
      }).ok,
    ).toBe(false);
  });
});

describe("serialization, failure behavior, and architecture boundaries", () => {
  it("round-trips representative compatibility fixtures", () => {
    const cases = [
      [domainSchemas.instrument, "canonical-instrument.json"],
      [domainSchemas.quoteObservation, "market-quote.json"],
      [domainSchemas.tradeCandidate, "trade-candidate.json"],
      [domainSchemas.decision, "decision-no-action.json"],
      [domainSchemas.eventEnvelope, "event-envelope.json"],
    ] as const;

    for (const [schema, name] of cases) {
      const parsed = roundTrip(schema, fixture(name));
      expect(parsed).toEqual(unwrapOrThrow(parseDomainContract(schema, fixture(name))));
    }
  });

  it("fails closed for malformed contract payloads", () => {
    expect(
      parseDomainContract(domainSchemas.instrument, {
        ...fixture("canonical-instrument.json"),
        schemaVersion: 0,
      }).ok,
    ).toBe(false);
    expect(
      parseDomainContract(domainSchemas.quoteObservation, {
        ...fixture("market-quote.json"),
        bid: undefined,
      }).ok,
    ).toBe(true);
    expect(
      parseDomainContract(domainSchemas.quoteObservation, {
        ...fixture("market-quote.json"),
        bid: undefined,
        ask: undefined,
      }).ok,
    ).toBe(false);
    expect(
      parseDomainContract(domainSchemas.tradeCandidate, {
        ...fixture("trade-candidate.json"),
        provenance: undefined,
      }).ok,
    ).toBe(false);
    expect(
      parseDomainContract(domainSchemas.eventEnvelope, {
        ...fixture("event-envelope.json"),
        eventType: "decision.recorded",
      }).ok,
    ).toBe(false);
    expect(parseDomainContract(domainSchemas.account, { runtimeEligibility: ["LIVE"] }).ok).toBe(
      false,
    );
  });

  it("keeps the domain package broker-neutral and infrastructure-independent", () => {
    const prohibited = [
      "mt5",
      "mql5",
      "metatrader",
      "react",
      "express",
      "fastify",
      "postgres",
      "prisma",
      "typeorm",
      "fs",
      "node:",
    ];
    const sourceDir = join(root, "packages", "domain", "src");

    for (const file of readdirSync(sourceDir).filter((entry) => entry.endsWith(".ts"))) {
      const content = readFileSync(join(sourceDir, file), "utf8").toLowerCase();
      for (const token of prohibited) {
        expect(content, `${file} should not reference ${token}`).not.toContain(token);
      }
    }
  });
});

const createDecision = (outcome: "APPROVE" | "NO_ACTION"): Decision =>
  unwrapOrThrow(
    parseDomainContract(domainSchemas.decision, {
      schemaVersion: 1,
      decisionId: id.decision,
      outcome,
      candidateId: outcome === "APPROVE" ? id.candidate : undefined,
      decidedAt: at.t2,
      authority: outcome === "APPROVE" ? "RISK" : "SYSTEM",
      reason:
        outcome === "APPROVE"
          ? {
              code: "RISK.CONTRACT_ONLY_NOT_ASSESSED",
              category: "RISK",
              summary: "Representational approval for contract journey only.",
              authority: "RISK",
              severity: "INFO",
            }
          : reason,
      explanation: "Contract representation only.",
      configurationVersion,
      correlationId: id.correlation,
    }),
  );

const createMasterDecision = (decision: Decision, candidateId: string): MasterTradeDecision =>
  unwrapOrThrow(
    parseDomainContract(domainSchemas.masterTradeDecision, {
      schemaVersion: 1,
      masterTradeDecisionId: id.masterDecision,
      decisionId: decision.decisionId,
      candidateId,
      instrumentId: id.instrumentFx,
      direction: "LONG",
      decidedAt: at.t2,
      state: decision.outcome === "APPROVE" ? "APPROVED" : "REJECTED",
      configurationVersion,
      correlationId: id.correlation,
    }),
  );

const createExecutionIntent = (
  executionIntentId: string,
  masterDecision: MasterTradeDecision,
  accountId: string,
): AccountExecutionIntent =>
  unwrapOrThrow(
    parseDomainContract(domainSchemas.accountExecutionIntent, {
      schemaVersion: 1,
      executionIntentId,
      masterTradeDecisionId: masterDecision.masterTradeDecisionId,
      accountId,
      instrumentId: masterDecision.instrumentId,
      direction: masterDecision.direction,
      requestedQuantity: quantity("1000"),
      orderPreference: "MARKET",
      validFrom: at.t2,
      idempotencyKey: id.idempotency,
      state: "CREATED",
      correlationId: id.correlation,
    }),
  );
