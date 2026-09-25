# Packages

This directory contains or will contain shared packages for domain logic, application contracts,
infrastructure adapters, UI/design-system components, and test utilities.

Currently implemented:

- `@ate/domain` — core domain language contracts, primitives, validation, and serialization support.
- `@ate/runtime` — application runtime lifecycle, dependency composition, health/readiness,
  degradation, recovery, shutdown, and snapshot foundation.

No package currently implements trading behavior, risk calculations, portfolio calculations, MT5
connectivity, broker execution, persistence, APIs, or frontend UI.
