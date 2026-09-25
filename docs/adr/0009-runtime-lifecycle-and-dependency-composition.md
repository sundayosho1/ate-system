# ADR-0009: Runtime Lifecycle and Dependency Composition Kernel

## Status

Accepted

## Context

ATE will eventually host many services, including market data, MOSE, risk, portfolio, execution, MT5
gateway, reconciliation, reporting, and research workers. Prompt 3 must establish safe construction,
startup, degradation, recovery, and shutdown without implementing those engines.

## Decision

Create `@ate/runtime` as the application/runtime package. It owns:

- explicit composition through `buildRuntime`;
- service descriptors and lifecycle contracts;
- dependency graph validation and deterministic topological ordering;
- runtime and service state machines;
- runtime-mode gating;
- capability availability/degradation;
- health and readiness aggregation;
- startup admission;
- graceful degradation and recovery hooks;
- reverse-order shutdown, lifecycle timeouts, and error aggregation;
- runtime snapshots and lifecycle records;
- process-signal adapter boundary.

The runtime may depend on `@ate/domain`. `@ate/domain` must not depend on `@ate/runtime`.

## Alternatives Considered

- Ad hoc startup from each module: rejected because startup/shutdown order and failure propagation
  would be unpredictable.
- External dependency-injection container: rejected as unnecessary at this stage; explicit
  composition is simpler and easier to audit.
- Event bus for lifecycle events: rejected for Prompt 3 because Prompt 4 owns the event
  architecture.

## Consequences

- Future services must provide descriptors and lifecycle functions to be managed by the runtime.
- Service construction belongs at the composition root.
- Health and readiness remain separate.
- Runtime mode alone never grants live execution capability.

## Security Impact

Runtime snapshots and lifecycle errors must not include secrets. Service descriptors must not
contain credentials.

## Operational Impact

Operators and future Control Center views can rely on structured snapshots, lifecycle records,
degradation reports, and startup/shutdown results.

## Reversibility

Moderate. The runtime package is foundational, but interfaces are explicit and small enough to
evolve before production runtime services exist.
