# Time and Clock Help

Use this guide when configuring or diagnosing ATE time behavior.

## What Prompt 6 implements

- UTC clock authority through `@ate/time`.
- System, virtual, simulation and replay clocks.
- IANA timezone conversion and DST ambiguity detection.
- Freshness classification for observed timestamps.
- Clock-quality monitoring using wall-clock and monotonic deltas.
- Deterministic scheduler foundation.
- Runtime health/readiness diagnostics for time authority.

Prompt 6 does not implement market calendars, sessions, market-data ingestion, historical replay
engines, trading strategies, risk, execution, MT5 connectivity or live trading.

## Selecting a clock mode

| Runtime mode                          | Recommended clock mode                        |
| ------------------------------------- | --------------------------------------------- |
| `DEVELOPMENT`, `RESEARCH`, `BACKTEST` | `VIRTUAL`, `SIMULATION`, `REPLAY` or `SYSTEM` |
| `SIMULATION`                          | `SIMULATION`, `REPLAY` or `VIRTUAL`           |
| `PAPER`                               | `SYSTEM`                                      |
| `LIVE`                                | `SYSTEM` only                                 |

If `LIVE` is paired with a virtual, simulation or replay clock, readiness must be `NOT_READY`.

## Common errors

### `NAIVE_TIMESTAMP`

The timestamp did not include `Z` or an explicit offset.

Use:

```text
2026-09-25T12:00:00.000Z
```

Do not use:

```text
2026-09-25T12:00:00
```

### `INVALID_TIMEZONE`

Use an IANA timezone such as `America/New_York` or `Asia/Tokyo`. Do not use abbreviations such as
`EST`, `CST` or `IST`.

### `NONEXISTENT_LOCAL_TIME`

The local time falls into a daylight-saving spring-forward gap. Ask for a different local time or
provide a UTC instant.

### `AMBIGUOUS_LOCAL_TIME`

The local time occurs twice during a daylight-saving fall-back transition. Provide the intended UTC
instant or an explicit offset.

### `CLOCK_MODE_INCOMPATIBLE`

The runtime mode and clock mode are not allowed together. Check the runtime configuration and avoid
test clocks in live operation.

### `CLOCK_MOVED_BACKWARD` or `CLOCK_JUMP_DETECTED`

The wall clock moved unexpectedly compared with monotonic time. Investigate host time sync, VM
suspension, NTP changes and operator clock changes before treating evidence as trustworthy.

## Diagnosing scheduler behavior

The deterministic scheduler runs due work only when `runDueTasks()` is called. If a task did not
run:

1. check the runtime clock's current UTC instant;
2. check the task `dueAt`;
3. call `runDueTasks()` after advancing virtual/simulation/replay time;
4. confirm the scheduler is not stopped;
5. inspect scheduled, executed and cancelled task counts.

## Operator checklist

- Confirm clock mode matches runtime mode.
- Confirm timestamps are UTC or include explicit offsets before parsing.
- Confirm timezone IDs are IANA identifiers.
- Treat degraded/untrusted clock quality as a readiness issue.
- Do not infer trading capability from time readiness.
