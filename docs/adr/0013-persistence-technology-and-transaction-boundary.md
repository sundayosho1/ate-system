# ADR-0013 — Persistence Technology and Transaction Boundary

## Status

Accepted

## Context

ADR-0003 selected PostgreSQL as ATE's planned production persistence direction. Prompt 5 introduces
the transaction and state authority foundation without implementing future trading domains.

## Decision

ATE will keep PostgreSQL as the production database direction and centralize persistence behind
`@ate/persistence` ports. Prompt 5 implements an explicit transaction boundary where state, history,
audit and outbox records commit or roll back together. Nested transactions are prohibited for now.

## Alternatives Considered

- SQLite as production authority: rejected by ADR-0003.
- ORM auto-sync: rejected because destructive or implicit schema changes are unsafe.
- Independent direct database calls: rejected because they bypass ownership and transaction
  boundaries.

## Consequences

- Domain and event packages remain database-driver independent.
- Future PostgreSQL adapters can implement the same ports.
- Tests use a deterministic in-memory adapter to verify semantics without a production database.

## Security Impact

Database credentials remain externalized and diagnostics must redact secrets.

## Operational Impact

Persistence readiness depends on connection, schema compatibility and transaction capability.

## Reversibility

Moderate before production data exists; lower after live operational data exists.
