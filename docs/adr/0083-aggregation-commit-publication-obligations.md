# ADR-0083: Commit publication and recovery obligations

Status: Accepted for implementation; independent Prompt 18 acceptance pending.

Date: 2026-10-08

## Context

Prompt 18 extends the conditionally accepted Prompt 17 offline research foundation.

## Decision

Content and publication are separate bounded synchronous steps. Only pre-mutation certification
proves no commitment. Unknown and committed failures retain operation obligations outside diagnostic
buffers. Repeated stop cannot conceal failure. Trusted single-writer roots are mandatory.

## Consequences

Policies and operation evidence must be retained. Resource failures are structured and observable.
No production, broker or trading authority is added. See
[aggregation help](../help/multi-timeframe-aggregation.md).
