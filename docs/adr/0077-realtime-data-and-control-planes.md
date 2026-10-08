# ADR-0077 — Real-Time Data and Control Planes

## Status

Proposed for independent Prompt 17 review

## Decision

Deliver typed canonical observations on a bounded asynchronous consumer abstraction; use the
existing EventRegistry/EventFactory/InternalEventBus only for bounded lifecycle and integrity
summaries.

## Consequences

No per-tick immutable governance audit, external message broker or unbounded label cardinality is
introduced. Control publication failures are reported.
