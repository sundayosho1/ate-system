# Environment & Runtime Modes

ATE uses explicit runtime modes. These modes must eventually enforce capability differences; they
are not decorative labels.

## DEVELOPMENT

Purpose: developer implementation, local tests, and non-capital-bearing experimentation.

Allowed in future:

- local development;
- test data;
- mocked adapters;
- non-production databases.

Not allowed:

- capital-bearing execution;
- production secrets in source;
- claims of trading readiness.

## RESEARCH

Purpose: historical analysis, exploration, hypotheses, and controlled research.

Research may generate hypotheses but cannot authorize live trading.

## BACKTEST

Purpose: deterministic historical evaluation against versioned data, configuration, code, and
strategy definitions.

Backtests must be reproducible. A successful backtest is evidence, not approval.

## SIMULATION

Purpose: operation against simulated or replayed conditions to evaluate system behavior without
capital exposure.

Simulation may test orchestration and failure paths but cannot bypass live promotion.

## PAPER

Purpose: non-capital-bearing forward operation against current or near-current market conditions
where supported.

Paper outcomes are evidence, not automatic live authorization.

## LIVE

Purpose: capital-bearing execution.

LIVE requires explicit eligibility, approved configuration, account mandates, risk/protection
controls, auditability, observability, reconciliation, and operational readiness.

Prompt 1 does not implement live trading.

## Promotion principle

```text
DEVELOPMENT
RESEARCH
BACKTEST
SIMULATION
PAPER
LIVE
```

Promotion must eventually require explicit qualification and approval. A strategy must never become
live merely because:

- a database flag changed;
- a file was copied;
- a developer invoked a different command;
- a research experiment performed well once.

## Time authority principle

ATE must not casually rely on local machine time throughout domain logic. Future architecture must
distinguish:

- UTC system time;
- broker time;
- exchange/market time;
- event time;
- ingestion time;
- simulation time.

Deterministic code should use an injectable or authoritative clock abstraction where time matters.
