# Safety Invariants

These invariants are mandatory architecture constraints. Future implementation must preserve them
unless an explicit approved ADR supersedes a rule.

## INV-001 — Fail Closed

When safety-critical state is unknown, unavailable, stale, contradictory, or untrusted, ATE should
reject new exposure rather than assume safety.

## INV-002 — No Direct Strategy Execution

Strategies generate candidates. They do not place broker orders or directly create execution
instructions.

## INV-003 — Risk Veto

Risk can reject any candidate or decision regardless of strategy quality.

## INV-004 — Protection Supremacy

Capital Protection can reject, reduce, suspend, protect, or halt activity regardless of strategy or
portfolio preference.

## INV-005 — Account Mandate Supremacy

No trade may violate account-specific permissions, restrictions, or risk mandates.

## INV-006 — Explicit Live Eligibility

Research, backtest, simulation, or paper capability does not imply live eligibility.

## INV-007 — Environment Isolation

Research, backtest, simulation, paper, and live execution must remain explicitly separated.

## INV-008 — No Silent Self-Modification

Learning components may not silently modify production trading, strategy, risk, or protection
configuration.

## INV-009 — Idempotent Capital-Bearing Commands

Capital-bearing execution commands must ultimately use stable identities and duplicate-prevention
semantics.

## INV-010 — Reconciliation Required

ATE must never assume external execution state indefinitely without reconciliation against
observable broker/MT5 state.

## INV-011 — No Embedded Secrets

Secrets must not exist in committed source code, templates, logs, tests, or documentation.

## INV-012 — Auditable Sensitive Actions

Sensitive state changes must eventually be attributable to a human or system actor with time,
reason, previous state, new state, and correlation identity.

## INV-013 — Deterministic Risk Logic

Risk-critical calculations must be reproducible for a given input, code version, configuration
version, and data snapshot.

## INV-014 — No Floating-Point Casualness

Financial calculations requiring deterministic decimal behavior must use explicit precision and
rounding rules.

## INV-015 — Data Health Before Decision

Unhealthy, insufficient, stale, malformed, or contradictory data must be capable of preventing
candidate generation, approval, or execution.

## INV-016 — NO_ACTION Is Valid

No system component may require a trade merely because the market is open or a strategy exists.

## INV-017 — Configuration Validation

Invalid configuration must not silently activate.

## INV-018 — Broker Specifications Are Authoritative

ATE must not hard-code assumptions about tick size, point size, tick value, volume limits, volume
step, margin, trading sessions, contract size, or broker restrictions.

## INV-019 — External Intelligence Is Non-Authoritative

News, sentiment, macro feeds, and external analytics cannot override deterministic safety controls.

## INV-020 — Production Changes Are Versioned

Sensitive production configuration and strategy changes must eventually be versioned and auditable.

## INV-021 — Capability Truthfulness

Documentation, APIs, manifests, and UI must not imply capabilities that have not been implemented
and verified.

## INV-022 — No Duplicate Authorities

ATE must avoid competing sources of truth for accounts, positions, orders, market data
normalization, clocks, risk state, configuration, audit, and protection state.

## Prompt 1 test coverage

Prompt 1 includes foundation tests that verify:

- required governance documents exist;
- the capability manifest truthfully marks trading/execution functions as not implemented;
- the prompt ledger records Prompt 1 only;
- security hygiene scanning is available.

Future prompts must add executable invariant tests when corresponding code exists.
