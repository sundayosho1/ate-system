# 0020 — Virtual, Simulation and Replay Clock Architecture

## Status

Accepted.

## Context

Backtests, simulations and deterministic tests must be able to move time without waiting for real
time. Replay needs repeatable stepping through known instants. Live operation must not accidentally
run on a test clock.

## Decision

`@ate/time` provides virtual, simulation and replay clocks in addition to the system UTC clock.
Virtual clocks advance only by explicit commands. Replay clocks step through a known timestamp
sequence and can reset for repeatable runs. Runtime clock service compatibility rejects unsafe clock
mode/runtime mode combinations, including non-system clocks in `LIVE`.

## Alternatives Considered

- Fake global timers in each test. Rejected because it is process-wide and easy to leak.
- Add replay behavior to persistence or events. Rejected because clock authority should remain
  independent from consumers.

## Consequences

Temporal tests are deterministic and do not depend on sleeps. Replay order remains an explicit
input.

## Security Impact

Mode gates prevent test clocks from being accepted as live time authority.

## Operational Impact

Operators and diagnostics can see whether a runtime uses system, virtual, simulation or replay time.

## Reversibility

The concrete clock classes can be replaced behind the same `Clock` contract.
