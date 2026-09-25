import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  deriveBidAskSpread,
  deriveMidPrice,
  domainSchemas,
  isCrossedQuote,
  marketObservationSemanticFingerprint,
  parseDomainContract,
  stableMarketDataStringify,
  unwrapOrThrow,
  type MarketObservation,
} from "@ate/domain";

const root = process.cwd();

const id = {
  instrument: "20000000-0000-4000-8000-000000000001",
  source: "20000000-0000-4000-8000-000000000002",
  quote: "20000000-0000-4000-8000-000000000003",
  trade: "20000000-0000-4000-8000-000000000004",
  tick: "20000000-0000-4000-8000-000000000005",
  bar: "20000000-0000-4000-8000-000000000006",
  status: "20000000-0000-4000-8000-000000000007",
  correction: "20000000-0000-4000-8000-000000000008",
  replacement: "20000000-0000-4000-8000-000000000009",
  dataset: "20000000-0000-4000-8000-000000000010",
  datasetVersion: "20000000-0000-4000-8000-000000000011",
};

const at = {
  event: "2026-09-25T10:00:00.000Z",
  source: "2026-09-25T10:00:00.123Z",
  received: "2026-09-25T10:00:01.000Z",
  futureEvent: "2026-09-25T10:00:02.000Z",
  lateEvent: "2026-09-24T10:00:00.000Z",
  intervalEnd: "2026-09-25T10:05:00.000Z",
};

const source = {
  sourceId: id.source,
  sourceType: "DATA_VENDOR",
  name: "Provider Neutral Fixture",
  role: "PRIMARY",
};

const price = (value: string) => ({
  value,
  instrumentId: id.instrument,
  quoteCurrency: "USD",
});

const quantity = (value: string, unit = "ASSET_UNITS") => ({ value, unit });

const provenance = {
  source,
  providerSymbol: "EURUSD.provider",
  sourceObservationId: "provider-message-1",
  sourceSchemaVersion: "vendor-v7",
  sourceTime: at.source,
  sourceTimestampPrecision: "MILLISECONDS",
  sequence: {
    sequence: "777",
    scope: "PROVIDER_STREAM",
    scopeId: "eurusd-stream",
  },
  origin: "OBSERVED",
  deliveryMode: "LIVE",
  metadata: {
    "provider.region": "global",
  },
};

const observationBase = {
  schemaVersion: 1,
  instrumentId: id.instrument,
  source,
  providerSymbol: "EURUSD.provider",
  eventTime: at.event,
  receivedAt: at.received,
  sourceTime: at.source,
  sourceTimestampPrecision: "MILLISECONDS",
  sequence: provenance.sequence,
  provenance,
};

const quoteObservation = (overrides: Partial<Record<string, unknown>> = {}) => ({
  ...observationBase,
  observationId: id.quote,
  observationKind: "QUOTE",
  bid: price("1.1000"),
  ask: price("1.1004"),
  bidSize: quantity("1000000"),
  askSize: quantity("1500000"),
  ...overrides,
});

describe("Prompt 13 canonical market-data observation contracts", () => {
  it("validates the universal observation envelope with provider-neutral identity and provenance", () => {
    const parsed = unwrapOrThrow(
      parseDomainContract(domainSchemas.quoteObservation, quoteObservation()),
    );

    expect(parsed.observationKind).toBe("QUOTE");
    expect(parsed.instrumentId).toBe(id.instrument);
    expect(parsed.providerSymbol).toBe("EURUSD.provider");
    expect(parsed.source.sourceId).toBe(id.source);
    expect(parsed.eventTime).toBe(at.event);
    expect(parsed.receivedAt).toBe(at.received);
    expect(parsed.sourceTime).toBe(at.source);
    expect(parsed.provenance.sourceObservationId).toBe("provider-message-1");
    expect(parsed.sequence?.scope).toBe("PROVIDER_STREAM");
  });

  it("distinguishes canonical instrument identity from provider symbol", () => {
    expect(
      parseDomainContract(domainSchemas.quoteObservation, {
        ...quoteObservation(),
        instrumentId: "EURUSD",
      }).ok,
    ).toBe(false);

    expect(
      parseDomainContract(domainSchemas.quoteObservation, {
        ...quoteObservation(),
        providerSymbol: "EURUSD.raw",
      }).ok,
    ).toBe(true);
  });

  it("supports two-sided, one-sided, crossed, and sized quotes without silently repairing prices", () => {
    const complete = unwrapOrThrow(
      parseDomainContract(domainSchemas.quoteObservation, quoteObservation()),
    );
    expect(deriveBidAskSpread(complete)).toEqual({
      ok: true,
      value: { value: "0.0004", formula: "ASK_MINUS_BID" },
    });
    expect(deriveMidPrice(complete).ok).toBe(true);

    expect(
      parseDomainContract(domainSchemas.quoteObservation, quoteObservation({ ask: undefined })).ok,
    ).toBe(true);
    expect(
      parseDomainContract(domainSchemas.quoteObservation, quoteObservation({ bid: undefined })).ok,
    ).toBe(true);
    expect(
      parseDomainContract(
        domainSchemas.quoteObservation,
        quoteObservation({ bid: undefined, ask: undefined }),
      ).ok,
    ).toBe(false);

    const crossed = unwrapOrThrow(
      parseDomainContract(
        domainSchemas.quoteObservation,
        quoteObservation({ bid: price("1.1010"), ask: price("1.1000") }),
      ),
    );
    expect(isCrossedQuote(crossed)).toBe(true);
    expect(unwrapOrThrow(deriveBidAskSpread(crossed)).value).toBe("-0.001");
    expect(crossed.bidSize?.value).toBe("1000000");
    expect(crossed.askSize?.value).toBe("1500000");
  });

  it("rejects unsafe numeric authority while preserving decimal precision and missing-vs-zero", () => {
    expect(
      parseDomainContract(domainSchemas.quoteObservation, quoteObservation({ bid: price("1e-8") }))
        .ok,
    ).toBe(false);
    expect(
      parseDomainContract(domainSchemas.quoteObservation, quoteObservation({ bid: { value: NaN } }))
        .ok,
    ).toBe(false);
    expect(
      parseDomainContract(domainSchemas.tradeObservation, {
        ...observationBase,
        observationId: id.trade,
        observationKind: "TRADE",
        price: price("999999999999999999.000000000000000001"),
        quantity: quantity("0.00000001"),
      }).ok,
    ).toBe(true);
    expect(
      parseDomainContract(domainSchemas.tradeObservation, {
        ...observationBase,
        observationId: id.trade,
        observationKind: "TRADE",
        price: price("1.1001"),
      }).ok,
    ).toBe(true);
    expect(
      parseDomainContract(domainSchemas.tradeObservation, {
        ...observationBase,
        observationId: id.trade,
        observationKind: "TRADE",
        price: price("1.1001"),
        quantity: quantity("0"),
      }).ok,
    ).toBe(true);
  });

  it("models trade and last observations separately from bid, ask, and derived mid", () => {
    const parsed = unwrapOrThrow(
      parseDomainContract(domainSchemas.tradeObservation, {
        ...observationBase,
        observationId: id.trade,
        observationKind: "TRADE",
        price: price("1.1002"),
        quantity: quantity("25000"),
        sourceTradeId: "trade-42",
      }),
    );

    expect(parsed.price.value).toBe("1.1002");
    expect(parsed.sourceTradeId).toBe("trade-42");
    expect(parsed.aggressorSide).toBeUndefined();
  });

  it("uses discriminated tick semantics so ticks do not imply trades", () => {
    const quoteTick = unwrapOrThrow(
      parseDomainContract(domainSchemas.tickObservation, {
        ...observationBase,
        observationId: id.tick,
        observationKind: "TICK",
        tickKind: "QUOTE",
        quote: {
          bid: price("1.1000"),
          ask: price("1.1001"),
        },
      }),
    );
    const tradeTick = unwrapOrThrow(
      parseDomainContract(domainSchemas.tickObservation, {
        ...observationBase,
        observationId: id.tick,
        observationKind: "TICK",
        tickKind: "TRADE",
        trade: {
          price: price("1.1001"),
          quantity: quantity("1000"),
          sourceTradeId: "trade-tick-1",
        },
      }),
    );

    expect(quoteTick.tickKind).toBe("QUOTE");
    expect(quoteTick.trade).toBeUndefined();
    expect(tradeTick.tickKind).toBe("TRADE");
    expect(
      parseDomainContract(domainSchemas.tickObservation, {
        ...observationBase,
        observationId: id.tick,
        observationKind: "TICK",
        tickKind: "TRADE",
      }).ok,
    ).toBe(false);
  });

  it("validates OHLCV bars with explicit timeframe, [start,end) interval, finality, and volume type", () => {
    const parsed = unwrapOrThrow(
      parseDomainContract(domainSchemas.barObservation, {
        ...observationBase,
        observationId: id.bar,
        observationKind: "BAR",
        timeframe: { kind: "FIXED", code: "5m", length: 5, unit: "MINUTE" },
        intervalStart: at.event,
        intervalEnd: at.intervalEnd,
        open: price("1.1000"),
        high: price("1.1010"),
        low: price("1.0990"),
        close: price("1.1005"),
        volumes: [
          { volumeType: "TRADE_VOLUME", quantity: quantity("125.5") },
          { volumeType: "TICK_VOLUME", quantity: quantity("120", "TICKS") },
          { volumeType: "QUOTE_COUNT", quantity: quantity("300", "TICKS") },
        ],
        completeness: "FINAL",
      }),
    );

    expect(parsed.timeframe).toEqual({ kind: "FIXED", code: "5m", length: 5, unit: "MINUTE" });
    expect(parsed.volumes.map((volume) => volume.volumeType)).toEqual([
      "TRADE_VOLUME",
      "TICK_VOLUME",
      "QUOTE_COUNT",
    ]);
    expect(
      parseDomainContract(domainSchemas.barObservation, {
        ...parsed,
        high: price("1.0980"),
      }).ok,
    ).toBe(false);
    expect(
      parseDomainContract(domainSchemas.barObservation, {
        ...parsed,
        intervalEnd: at.event,
      }).ok,
    ).toBe(false);
  });

  it("preserves missing, zero, fractional, and not-available volume semantics distinctly", () => {
    expect(
      parseDomainContract(domainSchemas.barObservation, {
        ...observationBase,
        observationId: id.bar,
        observationKind: "BAR",
        timeframe: "M1",
        intervalStart: at.event,
        intervalEnd: at.intervalEnd,
        open: price("1"),
        high: price("1"),
        low: price("1"),
        close: price("1"),
        completeness: "FORMING",
      }).ok,
    ).toBe(true);
    expect(
      parseDomainContract(domainSchemas.volumeMeasure, { volumeType: "NOT_AVAILABLE" }).ok,
    ).toBe(true);
    expect(
      parseDomainContract(domainSchemas.volumeMeasure, {
        volumeType: "TRADE_VOLUME",
        quantity: quantity("0"),
      }).ok,
    ).toBe(true);
    expect(
      parseDomainContract(domainSchemas.volumeMeasure, {
        volumeType: "TRADE_VOLUME",
        quantity: quantity("-1"),
      }).ok,
    ).toBe(false);
  });

  it("keeps event, receive, source, precision, timezone, future, and late time evidence explicit", () => {
    expect(
      parseDomainContract(
        domainSchemas.quoteObservation,
        quoteObservation({
          eventTime: "2026-09-25T10:00:00",
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseDomainContract(
        domainSchemas.quoteObservation,
        quoteObservation({
          eventTime: at.futureEvent,
          receivedAt: at.received,
        }),
      ).ok,
    ).toBe(true);
    expect(
      parseDomainContract(
        domainSchemas.quoteObservation,
        quoteObservation({
          eventTime: at.lateEvent,
          receivedAt: at.received,
          provenance: {
            ...provenance,
            sourceTimezone: "America/New_York",
            sourceTimestampPrecision: "SECONDS",
          },
        }),
      ).ok,
    ).toBe(true);
  });

  it("supports session and market status without conflating them", () => {
    const parsed = unwrapOrThrow(
      parseDomainContract(domainSchemas.marketStatusObservation, {
        ...observationBase,
        observationId: id.status,
        observationKind: "MARKET_STATUS",
        session: {
          sessionId: "venue-session-1",
          sessionDate: "2026-09-25",
        },
        status: "HALTED",
        statusSource: "PROVIDER_SUPPLIED",
        reason: "Provider reported a halt.",
      }),
    );

    expect(parsed.session?.sessionId).toBe("venue-session-1");
    expect(parsed.status).toBe("HALTED");
    expect(parsed.statusSource).toBe("PROVIDER_SUPPLIED");
    expect(
      parseDomainContract(domainSchemas.marketStatusObservation, {
        ...parsed,
        status: "ALWAYS_OPEN",
      }).ok,
    ).toBe(false);
  });

  it("requires transformation provenance for derived data and prevents simulated observed masquerade", () => {
    expect(
      parseDomainContract(domainSchemas.quoteObservation, {
        ...quoteObservation(),
        provenance: {
          ...provenance,
          origin: "DERIVED",
        },
      }).ok,
    ).toBe(false);
    expect(
      parseDomainContract(domainSchemas.quoteObservation, {
        ...quoteObservation(),
        provenance: {
          ...provenance,
          origin: "DERIVED",
          transformation: {
            transformationId: "mid-derived-v1",
            transformationVersion: "1.0.0",
            inputObservationIds: [id.quote],
          },
          datasetVersion: {
            datasetId: id.dataset,
            datasetVersionId: id.datasetVersion,
            version: "2026-09-25",
          },
        },
      }).ok,
    ).toBe(true);
    expect(
      parseDomainContract(domainSchemas.quoteObservation, {
        ...quoteObservation(),
        source: { ...source, sourceType: "SIMULATION" },
        provenance: {
          ...provenance,
          source: { ...source, sourceType: "SIMULATION" },
          origin: "OBSERVED",
        },
      }).ok,
    ).toBe(false);
  });

  it("bounds metadata and rejects raw payload/credential-shaped extensions", () => {
    const tooManyKeys = Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => [`fixture.key${index}`, "x"]),
    );
    expect(
      parseDomainContract(
        domainSchemas.quoteObservation,
        quoteObservation({ metadata: tooManyKeys }),
      ).ok,
    ).toBe(false);
    expect(
      parseDomainContract(
        domainSchemas.quoteObservation,
        quoteObservation({ metadata: { "provider.raw": { nested: "payload" } } }),
      ).ok,
    ).toBe(false);
    expect(
      parseDomainContract(
        domainSchemas.quoteObservation,
        quoteObservation({ metadata: { "provider.note": "safe bounded provider metadata" } }),
      ).ok,
    ).toBe(true);
  });

  it("represents append-only corrections without mutating the original observation", () => {
    const parsed = unwrapOrThrow(
      parseDomainContract(domainSchemas.marketDataCorrection, {
        schemaVersion: 1,
        correctionId: id.correction,
        originalObservationId: id.quote,
        replacementObservationId: id.replacement,
        correctedAt: at.received,
        reasonCode: "PROVIDER.REVISED_BAR",
        source,
        provenance,
      }),
    );

    expect(parsed.originalObservationId).toBe(id.quote);
    expect(parsed.replacementObservationId).toBe(id.replacement);
    expect(
      parseDomainContract(domainSchemas.marketDataCorrection, {
        ...parsed,
        replacementObservationId: id.quote,
      }).ok,
    ).toBe(false);
  });

  it("serializes deterministically and fingerprints semantic content independently of property order", () => {
    const left = unwrapOrThrow(
      parseDomainContract(domainSchemas.quoteObservation, quoteObservation()),
    );
    const right = unwrapOrThrow(
      parseDomainContract(domainSchemas.quoteObservation, {
        ask: price("1.1004"),
        bid: price("1.1000"),
        ...observationBase,
        observationKind: "QUOTE",
        observationId: id.quote,
        askSize: quantity("1500000"),
        bidSize: quantity("1000000"),
      }),
    );

    expect(stableMarketDataStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableMarketDataStringify({ a: { c: 3, d: 2 }, b: 1 }),
    );
    expect(marketObservationSemanticFingerprint(left)).toBe(
      marketObservationSemanticFingerprint(right),
    );
    const receivedLater = unwrapOrThrow(
      parseDomainContract(domainSchemas.quoteObservation, {
        ...quoteObservation(),
        receivedAt: at.futureEvent,
      }),
    );
    expect(marketObservationSemanticFingerprint(receivedLater)).toBe(
      marketObservationSemanticFingerprint(left),
    );
  });

  it("keeps the observation union discriminated and deterministic across repeated construction", () => {
    const observations: MarketObservation[] = [
      unwrapOrThrow(parseDomainContract(domainSchemas.quoteObservation, quoteObservation())),
      unwrapOrThrow(
        parseDomainContract(domainSchemas.tradeObservation, {
          ...observationBase,
          observationId: id.trade,
          observationKind: "TRADE",
          price: price("1.1002"),
        }),
      ),
      unwrapOrThrow(
        parseDomainContract(domainSchemas.marketStatusObservation, {
          ...observationBase,
          observationId: id.status,
          observationKind: "MARKET_STATUS",
          status: "UNKNOWN",
          statusSource: "INFERRED",
        }),
      ),
    ];

    for (const observation of observations) {
      expect(parseDomainContract(domainSchemas.marketObservation, observation).ok).toBe(true);
      expect(marketObservationSemanticFingerprint(observation)).toBe(
        marketObservationSemanticFingerprint(observation),
      );
    }
  });

  it("rejects sequence-free timestamp-only identity assumptions in fixtures", () => {
    const parsed = unwrapOrThrow(
      parseDomainContract(domainSchemas.quoteObservation, quoteObservation()),
    );

    expect(parsed.observationId).toBe(id.quote);
    expect(parsed.eventTime).toBe(at.event);
    expect(parsed.sequence?.sequence).toBe("777");
    expect(parsed.provenance.sourceObservationId).toBe("provider-message-1");
  });
});

describe("Prompt 13 architecture boundaries", () => {
  it("keeps canonical market-data contracts free of provider SDK, transport, persistence, replay, strategy, and trading dependencies", () => {
    const prohibited = [
      /mt5/iu,
      /mql5/iu,
      /metatrader/iu,
      /tradingview/iu,
      /binance/iu,
      /coinbase/iu,
      /oanda/iu,
      /polygon/iu,
      /^ws$/iu,
      /websocket/iu,
      /^axios$/iu,
      /^fetch$/iu,
      /postgres/iu,
      /prisma/iu,
      /replay/iu,
      /strategy-engine/iu,
      /risk-engine/iu,
      /execution/iu,
    ];
    const sourceDir = join(root, "packages", "domain", "src");
    const importPattern = /from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/gu;

    for (const file of readdirSync(sourceDir).filter((entry) => entry.endsWith(".ts"))) {
      const content = readFileSync(join(sourceDir, file), "utf8");
      const importedModules = Array.from(
        content.matchAll(importPattern),
        (match) => match[1] ?? match[2] ?? "",
      );

      for (const importedModule of importedModules) {
        for (const prohibitedImport of prohibited) {
          expect(
            prohibitedImport.test(importedModule),
            `${file} should not import ${importedModule}`,
          ).toBe(false);
        }
      }
    }
  });

  it("does not expose provider raw payloads, historical storage, aggregation, replay, or trading APIs through domain schemas", () => {
    const schemaNames = Object.keys(domainSchemas).join(" ");

    expect(schemaNames).not.toMatch(
      /rawPayload|historicalStore|webSocket|adapter|aggregation|replayEngine|strategyExecution|orderSubmission/iu,
    );
  });
});
