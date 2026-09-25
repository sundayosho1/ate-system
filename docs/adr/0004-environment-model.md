# ADR-0004: Explicit Runtime Mode Model

## Status

Accepted

## Context

ATE must separate development, research, backtest, simulation, paper, and live operation. Research
success must not silently authorize capital-bearing execution.

## Decision

ATE will use explicit runtime modes:

- DEVELOPMENT
- RESEARCH
- BACKTEST
- SIMULATION
- PAPER
- LIVE

Future prompts must enforce meaningful capability differences and promotion gates.

## Alternatives Considered

- Single environment flag: rejected because it encourages decorative labels.
- Separate codebases for research/live: rejected because it risks divergence and unreproducible
  promotion.

## Consequences

- Mode-aware configuration, permissions, commands, UI, and audit will be needed.
- Live-capable behavior must be explicitly gated.

## Security Impact

Secrets and permissions must be environment-scoped.

## Operational Impact

Operators must be able to see current runtime mode and capability constraints.

## Reversibility

Low. Mode separation is a foundational safety requirement.
