# ADR-0010 — Internal Typed Event Bus Architecture

## Status

Accepted

## Context

ATE needs internal communication between future components without arbitrary direct calls that hide
causality. Prompt 4 must not introduce durable persistence, distributed brokers, market-data
ingestion, MT5 integration or trading behavior.

## Decision

ATE will use `@ate/events` as an in-process typed event architecture foundation. The package depends
on `@ate/domain` for canonical envelopes and on `@ate/runtime` only for lifecycle service
integration. It provides a registry, event factories, exact/category routing, immutable subscriber
views, delivery results, diagnostics and a runtime-managed event bus service.

## Alternatives Considered

- External broker first: rejected because Prompt 4 explicitly excludes Kafka, NATS, RabbitMQ, Redis
  Streams and cloud queues.
- Direct module calls: rejected because causality, subscriber isolation and delivery diagnostics
  would be difficult to reconstruct.
- Durable event store first: deferred to Prompt 5 persistence scope.

## Consequences

- Components can publish facts through a stable abstraction without selecting Kafka, NATS, RabbitMQ
  or another broker prematurely.
- The bus can later be bridged to durable outbox/inbox or external broker adapters without changing
  event contracts.
- The in-memory bus is not durable and is not a state authority.
- High-volume market-data transport remains a separate future design concern.

## Security Impact

The event layer rejects unknown contracts, avoids secret-bearing diagnostics and documents that
actors/provenance must not contain credentials.

## Operational Impact

Operators and future control surfaces can inspect registered event types, routes, subscriptions,
health/readiness, diagnostics and dead-letter counts without requiring a broker.

## Reversibility

The event bus is behind a package-level abstraction. Future durable outbox/inbox dispatchers or
broker adapters can be introduced without replacing canonical event contracts.
