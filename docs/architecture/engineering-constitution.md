# ATE Engineering Constitution

## Purpose

This constitution is the permanent engineering authority for ATE unless later superseded by an
explicit approved Architecture Decision Record (ADR).

ATE is a configurable autonomous trading, market-intelligence, risk-management,
portfolio-management, execution, research, and operational-control platform. It is not merely a
MetaTrader Expert Advisor.

Prompt 1 establishes governance and architecture foundations only. It does not implement live
trading, MT5 execution, strategies, risk calculations, portfolio management, or market surveillance.

## Engineering priority order

Future decisions must respect this order:

1. Capital preservation
2. System safety
3. Data integrity
4. Security
5. Account mandates
6. Risk governance
7. Portfolio integrity
8. Execution integrity
9. Operational reliability
10. Explainability
11. Auditability
12. Reproducibility
13. Strategy quality
14. Performance
15. Scalability
16. Operator usability
17. Controlled learning
18. Profitability research

Profitability must never be represented as guaranteed. ATE should measure evidence, preserve
capital, and reject unjustified exposure.

## Repository-first rule

Before every implementation prompt:

1. Inspect the repository.
2. Identify existing authorities, contracts, modules, migrations, tests, permissions, help, and
   documentation.
3. Reuse valid existing structures.
4. Avoid duplicate authorities.
5. Implement only the bounded prompt scope.
6. Update documentation, help, tests, and manifests.
7. Run verification and report actual results.

## Authority hierarchy

No lower authority may bypass a higher authority:

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

Examples:

- A strategy cannot override risk.
- Portfolio logic cannot override capital protection.
- Execution cannot bypass authorization and pre-trade validation.
- Learning cannot silently modify production trading or risk configuration.
- Third-party intelligence cannot directly issue broker orders.

## Modular architecture rule

ATE should begin as a modular monolith where practical, with clear boundaries that can later support
selected worker/service separation. Do not introduce microservices prematurely.

Core domain logic must not depend directly on MT5, brokers, databases, HTTP, frontend frameworks,
operating-system APIs, news providers, notification providers, or market-data vendors.

## Dependency direction

The intended dependency direction is:

```text
DOMAIN
APPLICATION
INFRASTRUCTURE / ADAPTERS
```

Infrastructure may implement domain/application ports. Domain logic must remain deterministic,
testable, and isolated from external systems where possible.

## Development-mode boundaries

ATE distinguishes:

- DEVELOPMENT
- RESEARCH
- BACKTEST
- SIMULATION
- PAPER
- LIVE

These are not decorative labels. Future prompts must enforce meaningful capability differences
between modes. Live eligibility requires explicit promotion and governance.

## Coding principles

Future implementation should favor:

- explicitness over magic;
- small cohesive components;
- dependency injection where valuable;
- deterministic domain logic;
- immutable value objects where appropriate;
- clear error handling;
- no swallowed exceptions;
- no silent fallback for safety-critical behavior;
- no unexplained constants;
- no dead code;
- no speculative abstractions without prompt need.

## Financial precision

Financial, risk, accounting, price, margin, volume, and currency calculations requiring
deterministic decimal behavior must not casually use binary floating-point arithmetic. Future
calculations must define units, precision, rounding, and broker-specific constraints explicitly.

## Unit and quantity safety

Avoid ambiguous naked numbers. Values such as price, points, pips, ticks, lots, units, percentages,
basis points, account currency, quote currency, margin, and risk must be represented with explicit
units or domain value objects where practical.

## Security rules

Never commit, log, echo, or hard-code secrets. Secret-bearing runtime files must be ignored. Example
files may contain placeholders only.

If secrets are discovered in tracked files:

1. do not reproduce values;
2. identify affected files safely;
3. remove secrets within scope;
4. recommend rotation;
5. add regression protection.

## Definition of Done

Every applicable future prompt must satisfy:

- architecture integration;
- bounded implementation;
- validated configuration;
- help and configuration usability updates;
- security review;
- safety/risk implications review;
- automated tests, including failure paths where applicable;
- full available regression;
- documentation updates;
- auditability/observability considerations;
- migration verification where applicable;
- delivery evidence with actual commands/results.

A feature is not complete merely because it compiles.

## NO_ACTION principle

ATE must always be capable of deciding `NO_ACTION`. A market being open, a strategy seeing a
pattern, or a provider producing data does not require exposure.
