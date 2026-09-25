# 0019 — Wall Clock vs Monotonic Time

## Status

Accepted.

## Context

ATE needs wall-clock instants for evidence and ordering, but elapsed-duration measurement must not
trust system clock adjustments. NTP corrections, VM pauses and manual time changes can move wall
time forward or backward.

## Decision

Use UTC wall-clock instants for event and state timestamps. Use monotonic clocks for elapsed
duration and clock-quality comparison. The clock quality monitor compares wall-clock delta with
monotonic delta and reports backward movement or suspicious jumps.

## Alternatives Considered

- Use wall-clock deltas for all durations. Rejected because wall clocks can jump.
- Use monotonic values as persisted timestamps. Rejected because monotonic values are process-local
  and not meaningful as audit evidence.

## Consequences

Duration-sensitive code must distinguish instants from elapsed time.

## Security Impact

Backward or large clock jumps can degrade readiness instead of silently corrupting audit timelines.

## Operational Impact

Clock health can be monitored and investigated without implying market connectivity.

## Reversibility

Thresholds and monitor implementation are configurable and can evolve without changing persisted UTC
timestamps.
