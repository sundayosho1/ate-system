# ADR-0053 — OHLCV, Volume and Timeframe Semantics

## Status

Accepted

## Context

Bars are consumed by research, quality, aggregation and replay workflows. Volume semantics vary by
asset class and provider, and timeframe identity must not be inferred from timestamps alone.

## Decision

Canonical bars carry explicit timeframe identity, `[intervalStart, intervalEnd)` boundaries, OHLC
prices, finality and typed volume measures. Supported volume semantics are `TRADE_VOLUME`,
`TICK_VOLUME`, `QUOTE_COUNT` and `NOT_AVAILABLE`. Prompt 13 provides fixed/calendar/session
timeframe foundations without implementing aggregation rules or market calendars.

## Consequences

- Missing volume, zero volume and unavailable volume remain distinct.
- A bar may carry multiple distinguishable volume measures.
- Future Prompt 18 aggregation can produce derived bars with transformation provenance.
