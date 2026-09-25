# ADR-0066 — Quality Runtime, Configuration and Events

## Status

Accepted

## Decision

The data-quality engine integrates with runtime health/readiness, central managed configuration and
capability control. Events are low-volume summaries only.

Supported runtime modes are development, research, backtest and simulation.

## Consequences

- Quality settings remain under the existing configuration authority.
- Capability truth depends on Prompt 13 market-data contracts and Prompt 14 historical datasets.
- Prompt 15 does not implement production live monitoring, provider ingestion, replay, catalogue
  authority or trading.
