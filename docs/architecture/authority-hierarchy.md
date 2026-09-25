# Authority Hierarchy

ATE uses an explicit authority hierarchy to prevent lower-level components from bypassing
higher-level safety and governance controls.

```text
INSTITUTIONAL / HUMAN MANDATE
GLOBAL CAPITAL PROTECTION
SYSTEM HEALTH & SAFETY
ACCOUNT MANDATE
RISK ENGINE
PORTFOLIO ENGINE
EXECUTION SAFETY
STRATEGY ORCHESTRATOR
INDIVIDUAL STRATEGY
```

## 1. Institutional / Human Mandate

The highest authority. Defines approved operating environments, account use, trading permissions,
research promotion, emergency stops, and governance requirements.

## 2. Global Capital Protection

Can constrain or halt the system to protect capital across accounts, brokers, execution nodes, asset
classes, instruments, and strategies.

## 3. System Health & Safety

Prevents operation when infrastructure, data, queues, time, connectivity, configuration,
persistence, or reconciliation state is unsafe.

Prompt 7 makes configuration a control-plane input to these authorities. Configuration can supply
governed values, but it cannot reorder or bypass this hierarchy.

## 4. Account Mandate

Defines what each account may do, including account-level risk, eligible instruments, eligible
strategies, drawdown limits, permissions, and restrictions.

## 5. Risk Engine

Validates candidate/decision risk against deterministic limits and may veto any candidate.

## 6. Portfolio Engine

Validates concentration, correlation, simultaneous exposure, diversification, and portfolio
constraints.

## 7. Execution Safety

Validates broker specifications, spread/slippage constraints, idempotency, command freshness,
trading-session eligibility, and execution permissions.

## 8. Strategy Orchestrator

Coordinates strategy eligibility and candidate flow. It cannot approve exposure without higher
authority.

## 9. Individual Strategy

Produces standardized candidates and invalidations only. Strategies do not place orders.

## Required behavior

- Lower layers must expose enough context for higher authorities to decide.
- Higher authority rejection is final for the attempted action.
- Audit records must eventually identify the rejecting authority.
- Future APIs and UI must not present a lower-level approval as full approval until all higher
  required checks have passed.
