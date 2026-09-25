# ADR-0012 — Control/Event Plane vs Market Data Plane

## Status

Accepted

## Context

Future MOSE and market-data systems may process high-volume ticks, quotes and bars. Forcing every
market data observation through a general application event bus would risk bottlenecks and unclear
semantics.

## Decision

ATE distinguishes the control/event plane from the market-data plane.

- The control/event plane carries decisions, lifecycle facts, candidate transitions, risk outcomes,
  execution outcomes, reconciliation facts, analytics and research events.
- The market-data plane may use specialized future ingestion and transport mechanisms for raw high
  volume observations.

Prompt 4 builds only the control/event plane. Important market facts can be bridged later through
registered events when appropriate.

## Alternatives Considered

- Route every tick through the event bus: rejected because it risks turning the application event
  bus into a market-data bottleneck.
- Define a market-data transport now: rejected because market-data ingestion is out of Prompt 4
  scope.
- Treat observability logs/metrics as events: rejected because business events, logs, metrics and
  traces answer different operational questions.

## Consequences

- The event bus remains understandable, bounded and safe.
- Future market-data architecture can optimize for volume without weakening event traceability.
- Research and analytics subscribers can consume event facts without gaining authority over live
  behavior.

## Security Impact

Separating planes reduces the chance that raw provider/broker payloads or credentials are copied
into application event diagnostics.

## Operational Impact

Operators can reason about event bus load without assuming it represents raw tick throughput. Future
market-data health can be monitored separately.

## Reversibility

Future prompts can bridge selected market facts into events or introduce specialized market-data
pipelines without changing the Prompt 4 event semantics.
