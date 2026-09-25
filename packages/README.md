# Packages

This directory contains or will contain shared packages for domain logic, application contracts,
infrastructure adapters, UI/design-system components, and test utilities.

Currently implemented:

- `@ate/domain` — core domain language contracts, primitives, validation, and serialization support.
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

No package currently implements trading behavior, risk calculations, portfolio calculations, MT5
connectivity, broker execution, market calendars, market-data storage, external message brokers,
APIs, or frontend UI.
