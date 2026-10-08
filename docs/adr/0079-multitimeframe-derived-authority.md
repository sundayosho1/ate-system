# ADR-0079: Derived aggregation authority

Status: Accepted for implementation; independent Prompt 18 acceptance pending.

Date: 2026-10-08

## Context

Prompt 18 extends the conditionally accepted Prompt 17 offline research foundation.

## Decision

Aggregation owns derived revisions only. Reuse canonical observations, Prompt 6 clocks, Prompt 5
state registry, Prompt 15 quality reports and Prompt 16 registration authorities. No scoring,
dataset registration or trading is implied.

## Consequences

Policies and operation evidence must be retained. Resource failures are structured and observable.
No production, broker or trading authority is added. See
[aggregation help](../help/multi-timeframe-aggregation.md).
