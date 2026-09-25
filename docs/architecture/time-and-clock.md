# Time, Clock Authority & Temporal Integrity

Prompt 6 establishes `@ate/time` as ATE's temporal authority foundation. It provides canonical UTC
instants, monotonic duration measurement, virtual/simulation/replay clocks, IANA timezone
conversion, freshness classification, clock-quality monitoring, deterministic scheduling and runtime
health/readiness integration.

It does not implement market calendars, trading sessions, market-data replay engines, broker
connectivity, execution, risk, portfolio logic or live trading.

## Authority rule

```text
ONE RUNTIME -> ONE CLOCK AUTHORITY -> UTC INSTANTS FOR EVIDENCE
```

Application code should not discover current time through ambient system APIs. It should receive a
clock through composition. Events, persistence records, audit records and diagnostics use UTC
timestamps from that injected authority.

## Clock modes

| Mode         | Purpose                                                    |
| ------------ | ---------------------------------------------------------- |
| `SYSTEM`     | Host UTC clock for ordinary runtime operation.             |
| `VIRTUAL`    | Explicitly advanced test clock.                            |
| `SIMULATION` | Non-capital-bearing simulated time.                        |
| `REPLAY`     | Deterministic stepping through a known timestamp sequence. |

`LIVE` runtime mode rejects virtual, simulation and replay clocks. Simulation and backtest-style
workflows can use non-system clocks without waiting for wall time.

## UTC instants

Canonical instants are timezone-explicit and normalized to UTC. Naive timestamps are rejected.
External local times must be converted before they become durable evidence.

## Wall time and monotonic time

Wall-clock UTC is used for evidence. Monotonic time is used for elapsed duration and clock-quality
comparison. The quality monitor reports backward movement and large wall-clock/monotonic
discrepancies as degraded or untrusted temporal state.

## Timezones

IANA timezone IDs are required for local conversion. Abbreviations such as `EST`, `CST` or `IST` are
not accepted because they are ambiguous. DST gaps and overlaps return explicit errors instead of
silently guessing.

Broker and market time are modeled as profiles with source, timezone/offset, observed server time,
skew and confidence. Prompt 6 intentionally stops before market calendars and session logic.

## Deterministic scheduler

The scheduler is clock-driven. It does not use wall-clock timers. Due tasks execute when the caller
asks the scheduler to run due work. Ordering is deterministic:

1. earliest `dueAt`;
2. highest priority;
3. insertion sequence.

The scheduler is bounded and exposes scheduled, executed and cancelled counts.

## Runtime integration

`createClockRuntimeService` creates a runtime-managed service with health, readiness and
diagnostics. Diagnostics include current UTC, clock mode, runtime mode, source, quality, monotonic
availability, timezone capability, scheduled task count, recent errors and last detected clock jump.

## Integration boundaries

- `@ate/events` receives timestamps through its injected runtime clock.
- `@ate/persistence` receives state, history, audit, outbox, inbox and dead-letter timestamps
  through its injected runtime clock.
- `@ate/domain` remains independent of `@ate/time`; it validates timestamp contracts but does not
  own current time.

## Safety posture

Untrusted or incompatible time should fail readiness. Time authority is foundational evidence only;
it does not authorize trading, market data, strategy decisions, risk approval or execution.
