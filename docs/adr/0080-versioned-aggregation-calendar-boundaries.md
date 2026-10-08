# ADR-0080: Versioned half-open calendar boundaries

Status: Accepted for implementation; independent Prompt 18 acceptance pending.

Date: 2026-10-08

## Context

Prompt 18 extends the conditionally accepted Prompt 17 offline research foundation.

## Decision

Fixed durations use explicit anchors; calendar periods use IANA-local boundaries. Dated schedules
own overnight dates, holidays and breaks. Unknown schedules fail closed; version and fingerprint all
material policies.

## Consequences

Policies and operation evidence must be retained. Resource failures are structured and observable.
No production, broker or trading authority is added. See
[aggregation help](../help/multi-timeframe-aggregation.md).
