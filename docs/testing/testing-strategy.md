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

## Prompt 4 tests

Prompt 4 adds event architecture tests that verify:

- registry construction, event naming/versioning and duplicate registration rejection;
- canonical envelope and payload validation;
- unknown event rejection and invalid payload rejection;
- root and child event factory creation;
- correlation and causation propagation plus chain reconstruction;
- self-causation and causation-depth rejection;
- runtime-mode preservation;
- exact routing and multiple subscribers;
- event immutability and subscriber failure isolation;
- structured handler and delivery results;
- duplicate publication, subscriber-scoped idempotency and concurrent duplicate protection;
- bounded retry, non-retryable failure, poison-event handling, dead letters and explicit replay;
- per-key ordering without global ordering promises;
- backpressure, handler timeout, cancellation and graceful drain behavior;
- runtime service integration and lifecycle bridge publication;
- bounded in-memory diagnostics/dead letters;
- architecture dependency boundaries and absence of external broker/MT5/frontend dependencies.

## Prompt 5 tests

Prompt 5 adds persistence/state authority tests that verify:

- PostgreSQL-oriented schema boundary and safe connection diagnostics;
- migration ordering, idempotency and checksum incompatibility detection;
- transaction commit, rollback, timeout and nested transaction rejection;
- shared transaction context for state/history/outbox work;
- expected-version writes and lost-update protection;
- state ownership and runtime-mode isolation;
- append-only history and audit API boundaries;
- transactional outbox creation and dispatch through `@ate/events`;
- durable inbox duplicate suppression across recreated runtime/persistence instances;
- stale inbox claim recovery;
- durable dead-letter persistence and explicit replay metadata;
- persistence runtime service health/readiness and connection-loss reporting;
- architecture boundaries for domain/events/persistence dependencies.

## Prompt 6 tests

Prompt 6 adds time/clock authority tests that verify:

- UTC instant normalization, timezone-explicit parsing, naive timestamp rejection and invalid
  timestamp rejection;
- system UTC and monotonic clock adapters;
- virtual, simulation and replay clock advancement without wall-clock waiting;
- deterministic scheduler due-time, priority, sequence, cancellation and capacity behavior;
- IANA timezone validation, abbreviation rejection, fixed offsets and DST nonexistent/ambiguous
  local-time detection;
- freshness classification including future skew protection;
- clock-quality monitoring for wall-clock jumps and backward movement;
- runtime service health/readiness gates for clock mode compatibility;
- injected-clock integration through events and persistence records;
- constrained direct use of current-time APIs outside approved infrastructure seams.

## Prompt 7 tests

Prompt 7 adds hierarchical configuration tests that verify:

- canonical configuration domains, keys, scopes and bootstrap boundary;
- partial multidimensional context;
- inheritance, sparse overrides and provenance;
- explicit scope precedence and equal-precedence conflict detection;
- input-order independent snapshots and effective configuration fingerprints;
- unknown key, duplicate entry, invalid scope, missing required value and secret misuse handling;
- explicit merge and unset semantics;
- environment isolation across runtime modes;
- atomic runtime-service publication, last-known-good preservation on failed refresh and
  context-aware cache diagnostics;
- runtime, time, event and persistence integration foundations;
- architecture constraints against uncontrolled `process.env` reads and domain dependency on
  configuration infrastructure.

## Prompt 8 tests

Prompt 8 adds configuration schema and validation tests that verify:

- deterministic schema registry fingerprints;
- schema self-validation and invalid default rejection;
- enum, range, object-shape and safe-report source-entry validation;
- runtime invalid-candidate rejection before publication;
- last-known-good preservation after validation failure;
- dependency, conditional, mutual-exclusion and cross-field validation phases;
- schema diagnostics through the runtime service;
- continued event, persistence and runtime integration without implementing trading features.

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
