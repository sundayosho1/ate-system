# ADR-0084: Bounds and offline qualification

Status: Accepted for implementation; independent Prompt 18 acceptance pending.

Date: 2026-10-08

## Context

Prompt 18 extends the conditionally accepted Prompt 17 offline research foundation.

## Decision

Reject resource overflow instead of truncating lineage or history. Pull notifications may overflow
visibly while durable revision history is available for reconciliation. No research/trading
qualification is fabricated. Windows and production durability remain unqualified.

## Consequences

Policies and operation evidence must be retained. Resource failures are structured and observable.
No production, broker or trading authority is added. See
[aggregation help](../help/multi-timeframe-aggregation.md).
