# ADR-0081: Scoped evidence and independent finality

Status: Accepted for implementation; independent Prompt 18 acceptance pending.

Date: 2026-10-08

## Context

Prompt 18 extends the conditionally accepted Prompt 17 offline research foundation.

## Decision

Watermarks require caller-owned trusted scoped continuity or EOS evidence. Max event time is
insufficient. Coverage, quality and finality are independent. Reconnect and restart require explicit
reconciliation.

## Consequences

Policies and operation evidence must be retained. Resource failures are structured and observable.
No production, broker or trading authority is added. See
[aggregation help](../help/multi-timeframe-aggregation.md).
