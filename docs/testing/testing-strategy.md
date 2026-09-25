# Testing Strategy

Prompt 1 establishes the testing foundation. Future prompts must add tests appropriate to their risk
and blast radius.

## Test categories

ATE should support:

- unit tests;
- contract tests;
- integration tests;
- persistence tests;
- API tests;
- frontend component tests;
- end-to-end tests;
- security tests;
- risk invariant tests;
- deterministic replay tests;
- failure injection tests;
- performance tests;
- regression tests.

## Prompt 1 tests

Prompt 1 includes foundation tests that verify:

- required foundation documents exist;
- safety invariants contain required invariant identifiers;
- capability manifest truthfully reports no trading/execution capability;
- prompt ledger records Prompt 1 and does not mark future prompts complete;
- README does not claim live trading capability.

## Prompt 2 tests

Prompt 2 adds domain-contract tests that verify:

- branded identifiers;
- decimal, money, price, quantity, percentage, ratio, and time primitives;
- canonical instruments and broker references;
- market quotes and bars;
- accounts, snapshots, and mandates;
- strategies, setups, signals, candidates, scores, and decisions;
- explicit `NO_ACTION`;
- master decisions, execution intents, orders, fills, positions, trades, portfolios, and events;
- serialization round trips;
- invalid input rejection;
- multi-asset and multi-account representation;
- domain-package dependency boundaries.

## Prompt 3 tests

Prompt 3 adds runtime lifecycle tests that verify:

- runtime construction and explicit runtime-mode validation;
- dependency graph validation and deterministic ordering;
- startup admission and fail-closed critical failures;
- reverse shutdown, rollback, timeout and stop-failure aggregation;
- optional service degradation and recovery;
- transitive readiness/capability degradation;
- health/readiness distinction;
- runtime snapshots;
- lifecycle concurrency protections;
- background task cancellation;
- process signal adapter boundaries;
- runtime/domain dependency direction.

## Naming

Test names should describe behavior. Avoid opaque names.

## Evidence

Delivery reports must include actual commands and results. Never claim passing tests unless they
were executed successfully.

## Failure testing

As implementation grows, tests must cover negative paths and fail-safe behavior, including missing
data, stale data, malformed data, duplicate commands, authorization failures, invalid configuration,
provider failures, disconnection, reconciliation mismatch, and halted systems.

## Financial/risk-critical tests

Risk and financial calculations require deterministic tests covering precision, rounding, units,
broker specifications, and boundary conditions.
