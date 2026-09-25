# Packages

This directory contains or will contain shared packages for domain logic, application contracts,
infrastructure adapters, UI/design-system components, and test utilities.

Currently implemented:

- `@ate/domain` — core domain language contracts, primitives, validation, and serialization support.
- `@ate/runtime` — application runtime lifecycle, dependency composition, health/readiness,
  degradation, recovery, shutdown, and snapshot foundation.
- `@ate/events` — internal event registry, event factory, in-process event bus, routing,
  idempotency, ordering, retry, dead-letter, diagnostics, and runtime-service integration.

No package currently implements trading behavior, risk calculations, portfolio calculations, MT5
connectivity, broker execution, durable persistence, external message brokers, APIs, or frontend UI.
