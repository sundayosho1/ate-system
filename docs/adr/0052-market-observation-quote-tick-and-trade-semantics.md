# ADR-0052 — Market Observation, Quote, Tick and Trade Semantics

## Status

Accepted

## Context

Provider payloads often collapse quote, trade, tick and last-price concepts. ATE needs explicit
semantics so future intelligence does not mistake bid, ask, mid, last and trade prices.

## Decision

Canonical market data uses a discriminated observation model with `QUOTE`, `TRADE`, `TICK`, `BAR`
and `MARKET_STATUS`. Quotes support one-sided and crossed states without silent repair. Trades carry
actual observed trade/last semantics and never infer aggressor side. Ticks discriminate quote, trade
and combined updates.

## Consequences

- Tick does not imply trade.
- Bid/ask/mid/last semantics remain separate.
- Provider sequence and source IDs are preserved as evidence rather than observation identity.

## Security and Safety

The contracts do not authorize trading and do not create provider connections.
