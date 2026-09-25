# 0022 — Deterministic Scheduler and Temporal Ordering

## Status

Accepted.

## Context

Timers and scheduled tasks can make tests flaky and can hide ordering bugs when they depend on host
event-loop timing. ATE needs a deterministic scheduler foundation for simulation, replay and future
time-bound workflows.

## Decision

`@ate/time` includes a deterministic scheduler that is driven by an injected clock. Tasks execute
only when the scheduler is asked to run due work. Ordering is stable by due instant, priority and
insertion sequence. The scheduler is bounded and stops explicitly with runtime shutdown.

## Alternatives Considered

- Use `setTimeout` as the scheduler abstraction. Rejected because it depends on real time and host
  event-loop behavior.
- Add scheduler behavior to the event bus. Rejected because event delivery and temporal authority
  are separate concerns.

## Consequences

Simulation and replay can advance time instantly and then execute due work deterministically.

## Security Impact

Bounded queues avoid unbounded timer growth and denial-of-service-style resource exhaustion.

## Operational Impact

Diagnostics expose scheduled, executed and cancelled task counts.

## Reversibility

Scheduler internals can be replaced if the deterministic ordering contract is preserved.
