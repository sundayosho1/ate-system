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

## Prompt 6 temporal invariants

These invariants specialize the general safety rules for time authority.

## TIME-001 — Single Runtime Clock Authority

Each runtime must have one selected clock authority for current UTC instants.

## TIME-002 — UTC Durable Evidence

Durable event, state, audit, outbox, inbox and dead-letter evidence must use UTC instants.

## TIME-003 — Naive Timestamps Rejected

Timestamp input that lacks `Z` or an explicit offset must not become canonical evidence.

## TIME-004 — Monotonic Durations

Elapsed-duration logic must use monotonic time where clock jumps could affect correctness.

## TIME-005 — No Test Clocks In Live Mode

`LIVE` runtime mode must reject virtual, simulation and replay clocks.

## TIME-006 — Explicit Clock Mode

Clock mode must be explicit and visible in diagnostics.

## TIME-007 — Clock Provenance Required

Clock outputs must include a known source/provenance model at the clock boundary.

## TIME-008 — Backward Clock Movement Degrades Trust

Backward wall-clock movement must be detected and treated as untrusted temporal state.

## TIME-009 — Large Clock Jumps Are Visible

Large wall-clock jumps must be reported through clock-quality diagnostics.

## TIME-010 — IANA Timezones Only

Local timezone conversion must use IANA timezone IDs, not abbreviations.

## TIME-011 — DST Ambiguity Is Explicit

Nonexistent or ambiguous local times must return explicit errors instead of silent guesses.

## TIME-012 — Broker Time Is Not Canonical By Default

Broker/server time must carry provenance and conversion context before it can influence canonical
UTC evidence.

## TIME-013 — Market Time Does Not Imply Sessions

Timezone support does not imply market calendar, holiday or trading-session implementation.

## TIME-014 — Freshness Is Clock Relative

Freshness classification must be relative to the selected clock authority and include future-skew
protection.

## TIME-015 — Deterministic Scheduling

Scheduled work must have stable ordering by due time, priority and sequence when running under the
deterministic scheduler.

## TIME-016 — Bounded Timers

Schedulers and timer queues must be bounded and fail visibly on capacity exhaustion.

## TIME-017 — Replay Time Cannot Regress During Playback

Replay stepping must not move backward except through an explicit reset before rerun.

## TIME-018 — Time Readiness Is Not Trading Authority

Healthy time service readiness does not authorize market data ingestion, strategy execution, broker
order submission or live trading.

## Prompt 7 configuration invariants

These invariants specialize the general safety rules for managed configuration.

## CFG-001 — Single Configuration Authority

Managed configuration has one authoritative control plane.

## CFG-002 — Deterministic Resolution

Identical inputs must produce equivalent effective configuration.

## CFG-003 — Explicit Scope

Overrides must declare explicit scope.

## CFG-004 — Explicit Precedence

Precedence is policy, not insertion order.

## CFG-005 — Conflict Fails Closed

Unresolved equal-precedence conflicts are never silently selected.

## CFG-006 — Provenance Required

Every effective value can explain its source, scope and override chain.

## CFG-007 — Atomic Publication

Consumers never observe partially applied snapshots.

## CFG-008 — Immutable Effective Snapshot

Published snapshots and effective configurations are immutable.

## CFG-009 — Environment Isolation

Research, backtest or simulation configuration cannot silently contaminate live operation.

## CFG-010 — Secrets Excluded

Secret material is not ordinary configuration.

## CFG-011 — Unknown Keys Rejected

Unknown authoritative configuration does not silently become active.

## CFG-012 — Safe Missing-Value Semantics

Missing values never produce undocumented permissive behavior.

## CFG-013 — Configuration Cannot Override Safety Constitution

Configuration operates within permanent safety invariants.

## CFG-014 — Cache Is Non-Authoritative

Cache accelerates resolution but never owns configuration.

## CFG-015 — Snapshot Identity

Effective configuration has deterministic snapshot/fingerprint identity.

## CFG-016 — No Silent Last-Write-Wins

Conflicts are resolved by policy or rejected.

## CFG-017 — No Arbitrary Code Execution

Configuration cannot execute code.

## CFG-018 — Bootstrap Is Minimal

Bootstrap configuration remains separate and intentionally small.

## CFG-019 — Runtime Context Is Explicit

Resolution never relies on hidden mutable operational context.

## CFG-020 — Failed Candidate Is Never Partially Published

Invalid refreshes leave active configuration coherent where policy permits continued operation.

## Prompt 1 test coverage

Prompt 1 includes foundation tests that verify:

- required governance documents exist;
- the capability manifest truthfully marks trading/execution functions as not implemented;
- the prompt ledger records Prompt 1 only;
- security hygiene scanning is available.

Future prompts must add executable invariant tests when corresponding code exists.
