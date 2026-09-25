# Packages

This directory contains or will contain shared packages for domain logic, application contracts,
infrastructure adapters, UI/design-system components, and test utilities.

Currently implemented:

- `@ate/domain` — core domain language contracts, primitives, validation, serialization support, and
  universal provider-neutral market-data observation/quote/trade/tick/bar/status contracts.
- `@ate/runtime` — application runtime lifecycle, dependency composition, health/readiness,
  degradation, recovery, shutdown, and snapshot foundation.
- `@ate/events` — internal event registry, event factory, in-process event bus, routing,
  idempotency, ordering, retry, dead-letter, diagnostics, and runtime-service integration.
- `@ate/persistence` — persistence/state authority foundation with transactions, optimistic
  concurrency, immutable history, audit records, transactional outbox, durable inbox, durable dead
  letters, migration discipline, diagnostics, and runtime-service integration.
- `@ate/time` — clock/time authority foundation with UTC instants, monotonic duration,
  virtual/simulation/replay clocks, IANA timezone conversion, freshness, clock-quality monitoring,
  deterministic scheduling, and runtime-service integration.
- `@ate/configuration` — hierarchical configuration control-plane foundation with canonical domains,
  scopes, context, source abstraction, deterministic precedence, provenance, immutable snapshots,
  schema validation, constraints, dependency and cross-field rules, fingerprints, bounded cache,
  immutable version history, lineage, change sets, semantic diffs, historical reconstruction,
  feature-flag and capability-control registry/evaluation, maker-checker approval governance,
  controlled promotion/rollback release governance, runtime-service integration, invalid-candidate
  rejection, and safe diagnostics.

No package currently implements trading behavior, risk calculations, portfolio calculations, MT5
connectivity, broker execution, market calendars, market-data ingestion, market-data storage,
market-data replay, external message brokers, APIs, or frontend UI.
