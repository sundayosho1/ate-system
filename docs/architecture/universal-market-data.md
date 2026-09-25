# Universal Market Data Contracts

Prompt 13 establishes the provider-neutral market-data language in `@ate/domain`. It defines
contracts and deterministic validation only. It does not connect to providers, ingest feeds, store
history, score data quality, aggregate bars, replay data, implement an instrument registry, or
authorize trading.

## Package authority

Universal market-data contracts remain in `@ate/domain` because Prompt 2 already made that package
the infrastructure-independent domain-language authority for instruments, prices, timestamps,
quotes, bars and provenance. A new package would create a second contract authority before there is
a runtime data-plane implementation.

## Contract hierarchy

Canonical market observations share a common envelope and use discriminated payloads:

- `QUOTE` for bid/ask observations, including one-sided quotes;
- `TRADE` for provider-observed last/trade prices;
- `TICK` for discrete quote, trade or combined market updates;
- `BAR` for OHLC/OHLCV interval observations;
- `MARKET_STATUS` for provider/calendar/inferred status facts.

Every observation includes stable observation identity, canonical instrument ID, source/provider
reference, optional provider symbol, event time, receive time, optional source time, sequence
evidence, provenance, bounded metadata and structural quality annotations.

## Data-plane boundary

The contracts are the normalized target for future Prompt 17 ingestion. They are not a feed, queue,
event bus or database schema. ADR-0012 remains authoritative: high-volume ticks/quotes/bars must not
automatically be forced through the control/event plane.

## Provider neutrality

Provider-specific payload names and SDK objects are excluded. Provider evidence is represented as:

- `source.sourceId` and source type;
- optional provider role;
- `providerSymbol`;
- source observation/message ID;
- source schema/version reference;
- provider-local sequence and sequence scope;
- bounded metadata.

The canonical instrument ID is separate from the provider symbol.

## Temporal model

Market-data timestamps are explicit:

- `eventTime`: the market/source instant the observation occurred or became effective;
- `receivedAt`: the UTC instant ATE received the observation;
- `sourceTime`: optional provider publication/server time;
- `sourceTimestampPrecision`: seconds, milliseconds, microseconds, nanoseconds or unknown.

All timestamps use domain UTC normalization and reject naive local strings. Contracts preserve
future or late event evidence instead of rewriting it.

## Numeric model

Prices and quantities use `@ate/domain` decimal primitives. Decimal strings preserve precision and
reject `NaN`, infinity, exponent notation and JavaScript number authority for financial values.

## Quote model

Quotes expose bid and ask semantics directly. One-sided quotes are valid when only bid or only ask
is available. Crossed quotes are representable and diagnosable; they are not silently repaired.
Spread and mid helpers derive from canonical bid/ask:

- spread formula: `ask - bid`;
- mid formula: `(bid + ask) / 2`.

Derived spread/mid values are not provider-observed trades.

## Tick model

Ticks are discrete updates, not automatically trades. `tickKind` discriminates quote, trade and
combined ticks so downstream consumers do not guess.

## Bar model

Bars carry timeframe identity, `[intervalStart, intervalEnd)` boundaries, OHLC prices, explicit
volume measures, finality (`FORMING` or `FINAL`), source/provenance and optional revision linkage.
Structural OHLC coherence is enforced.

## Volume model

Volume is typed:

- `TRADE_VOLUME`;
- `TICK_VOLUME`;
- `QUOTE_COUNT`;
- `NOT_AVAILABLE`.

Missing volume, zero volume and unavailable volume remain distinct. Multiple volume measures may
coexist without overloading one field.

## Timeframes

Existing timeframe codes remain available for compatibility. Prompt 13 adds canonical timeframe
objects with kind (`FIXED`, `CALENDAR`, `SESSION`), code, and fixed length/unit when applicable. Bar
timeframe is never inferred from interval timestamps.

## Session and market status

Session identity/date and market status are separate concepts. Prompt 13 supports optional session
references and generic statuses such as open, closed, pre-open, post-close, halted, auction and
unknown without implementing market calendars.

## Provenance model

Market-data provenance records source, provider symbol, source observation ID, schema version,
source time, precision, sequence, origin, delivery mode, transformation evidence, dataset reference,
entitlement reference and bounded metadata. Derived observations require transformation provenance.
Simulation-origin data cannot masquerade as observed provider data.

## Correction model

Corrections are append-only records linking original and replacement observation IDs with correction
identity, source, time, reason and provenance. Existing observations are not mutated.

## Raw/canonical boundary

Raw provider payload retention belongs to future ingestion/audit storage. Canonical observations may
carry safe bounded references and metadata, but not arbitrary vendor payloads, credentials or
unbounded nested objects.

## Determinism

`stableMarketDataStringify` sorts object keys and omits `undefined` values. The semantic fingerprint
helper hashes stable semantic content with a deterministic in-package FNV-1a 64-bit digest. It is a
deduplication aid, not an observation ID and not a cryptographic security control.

## Future relationships

- Prompt 14 can use the contracts for historical storage design.
- Prompt 15 can consume structural annotations/evidence for quality scoring.
- Prompt 16 can strengthen dataset lineage around the dataset/transformation references.
- Prompt 17 can normalize provider payloads into these contracts.
- Prompt 18 can produce derived bars with transformation provenance.
- Prompt 19 can replay observations while preserving original provenance.
- Prompt 20 can strengthen instrument identity/specification without changing provider-symbol
  separation.
