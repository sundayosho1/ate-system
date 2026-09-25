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
