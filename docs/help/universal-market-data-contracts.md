# Universal Market Data Contracts Help

## Overview

Canonical market data is ATE's normalized, provider-neutral way to describe market facts. External
providers may use different payloads, symbols and timestamps, but downstream ATE components should
consume these domain contracts.

## Observation Types

- `QUOTE`: bid/ask quotation.
- `TRADE`: observed trade or last traded price.
- `TICK`: discrete quote, trade or combined update.
- `BAR`: OHLC/OHLCV interval observation.
- `MARKET_STATUS`: open/closed/halted/unknown style status fact.

## Instrument Identity

Every observation requires a canonical `instrumentId`. Provider symbols such as `EURUSD.a` are kept
as `providerSymbol` evidence and are not canonical identity.

## Quote Semantics

`bid` and `ask` are explicit price fields. Optional `bidSize` and `askSize` describe side sizes when
provided. Absence means missing/unknown, not zero.

## Tick Semantics

A tick is a market-data update. It is not automatically a trade. Check `tickKind` before treating a
tick as quote, trade or combined data.

## OHLCV

Bars include `open`, `high`, `low`, `close`, typed volume measures, finality and interval
boundaries. OHLC values must be structurally coherent.

## Timeframes

Bars require explicit timeframe identity. Fixed timeframes carry length and unit; calendar/session
foundations exist for future prompts.

## Timestamps

- `eventTime`: when the market/source says the observation occurred.
- `sourceTime`: optional provider publication/server time.
- `receivedAt`: when ATE received the observation.

Naive local timestamps are rejected. UTC offset timestamps are normalized to UTC.

## Sessions

Session references are optional and separate from market status. Prompt 13 does not implement market
calendars or session inference.

## Provenance

Provenance records source/provider identity, provider symbol, source IDs, source schema version,
timestamp precision, sequence scope, origin, delivery mode and safe bounded metadata.

## Quality Annotations

Prompt 13 supports structural flags such as missing quote side, crossed quote, source time absent,
sequence absent, correction and incomplete bar. Prompt 15 will own scoring, anomaly detection and
trust decisions.

## Corrections

Corrections create append-only records that reference original and replacement observation IDs.
Historical observations are not mutated in place.

## Derived Data

Derived data, such as future aggregated bars or calculated mids, must carry `origin: "DERIVED"` and
transformation provenance. Simulated data must remain distinguishable from observed provider data.

## Missing Values

Missing, unknown, not applicable and zero are different. Do not fill missing quote sides, trade
quantity or volume with zero unless the source actually observed zero.

## Precision

Prices and quantities use decimal strings. Timestamp precision is explicit when known and `UNKNOWN`
when the provider does not supply it.

## Troubleshooting

- Malformed quote: verify at least one side exists and decimal strings are plain base-10 values.
- Crossed quote: keep the evidence; do not auto-repair bid/ask.
- Malformed bar: check interval order and OHLC coherence.
- Timestamp failure: include `Z` or an explicit offset.
- Provenance failure: ensure source, origin and derived transformation evidence are present.
- Metadata failure: keep metadata shallow, bounded and free of raw payloads or secrets.

## Related Future Features

Historical storage, data quality scoring, dataset catalogue, real-time ingestion, aggregation,
replay, instrument registry, MOSE, strategies, risk and execution remain future prompts.
