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

## CODEX-003B consumer-loss correction

The Prompt 17 consumer contract reports channel-wide rejection/degradation without rejected-event
scope. The helper therefore durably fences every potentially affected registered engine scope,
including sequence-less input. Scoped observation warnings retain source isolation. Loss records are
bounded and keyed by consumer/context; actual channel-instance reuse cannot hide new loss. Observed
loss time uses the injected clock. Closed-channel backlog and closure remain conservative
uncertainty. Drain/replay never reconciles; existing explicit justified watermark authority is
required. Failure to persist a loss fence makes runtime readiness fail closed rather than retaining
unsupported continuity.
