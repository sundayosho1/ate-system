# ADR-0017 — Schema Migration Authority

## Status

Accepted

## Context

ATE needs controlled schema evolution and explicit compatibility checks. Production startup must not
silently perform destructive schema synchronization.

## Decision

`@ate/persistence` owns migration authority for persistence schema changes. Migrations are ordered,
checksummed and recorded immutably. Repeated invocation is idempotent. Checksum mismatch marks
schema incompatible and blocks readiness.

## Alternatives Considered

- ORM auto-sync: rejected because it can hide destructive or incompatible changes.
- Manual untracked SQL: rejected because schema authority would be ambiguous.
- Multiple migration tools: rejected to avoid competing schema authorities.

## Consequences

- Schema version is visible in diagnostics.
- Pending or incompatible migrations affect readiness.

## Security Impact

Runtime credentials should eventually be least-privilege; migration execution may use distinct
privileges.

## Operational Impact

Operators can distinguish current, pending, failed and incompatible migration states.

## Reversibility

Migration tooling can be replaced before production data exists, but applied production migrations
become durable operational history.
