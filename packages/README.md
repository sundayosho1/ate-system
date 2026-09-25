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
- `@ate/historical-data` — Historical Data Laboratory foundation with controlled offline artifact
  intake, safe format adapters, declarative mapping, Prompt 13 canonical normalization, rejection
  quarantine, immutable dataset manifests, local storage adapters, bounded queries and runtime
  diagnostics.
- `@ate/data-quality` — Data Quality Engine foundation with deterministic historical dataset quality
  profiles, rule statuses, bounded findings/evidence, immutable reports, non-trading qualification
  diagnostics, local report storage adapters and runtime diagnostics.

No package currently implements trading behavior, risk calculations, portfolio calculations, MT5
connectivity, broker execution, market calendars, live market-data ingestion, market-data replay,
external message brokers, APIs, or frontend UI. Data-quality reports are diagnostics only and do not
authorize trading.
