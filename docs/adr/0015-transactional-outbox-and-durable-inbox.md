# ADR-0015 — Transactional Outbox and Durable Inbox

## Status

Accepted

## Context

Prompt 4 intentionally avoided durable event delivery state. Prompt 5 must close the database/event
dual-write gap and protect subscribers from duplicate effects across restart.

## Decision

Committed state-change events are written to a transactional outbox in the same transaction as
state/history/audit changes. A dispatcher publishes outbox events after commit. Subscribers use a
durable inbox keyed by `subscriptionId + idempotencyKey`.

## Alternatives Considered

- Publish directly inside the transaction: rejected because subscribers could observe rolled-back
  state.
- Publish after commit without outbox: rejected because crash before publish loses required events.
- Rely on in-memory idempotency only: rejected because restart loses duplicate protection.

## Consequences

- Exactly-once delivery is still not claimed.
- Duplicate delivery remains possible, but duplicate side effects are suppressible.
- Pending outbox records survive restart.

## Security Impact

Outbox/inbox records preserve correlation and causation without storing secrets.

## Operational Impact

Operators can inspect pending/failed outbox, inbox duplicates and dead letters.

## Reversibility

Future external brokers can consume from the same outbox pattern.
