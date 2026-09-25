# ADR-0003: PostgreSQL-Oriented Persistence Direction

## Status

Accepted

## Context

Prompt 1 does not implement persistence, but ATE will require transactional state, audit records,
configuration versions, datasets, experiments, accounts, decisions, execution lifecycle records, and
reconciliation state.

## Decision

Use PostgreSQL as the planned primary persistence technology when persistence is implemented.
Migration tooling and ORM/query approach will be selected during the persistence prompt after
repository context is re-inspected.

## Alternatives Considered

- SQLite only: useful for tests/local tooling but not sufficient as the primary long-term
  multi-account operational store.
- Document database primary store: flexible but weaker fit for transactional financial/audit
  records.
- Event store only: premature before event architecture and state ownership are implemented.

## Consequences

- Future schema changes must use controlled migrations.
- Tests must cover persistence and migration behavior when introduced.
- Financial precision must use explicit decimal types and rounding rules.

## Security Impact

Database credentials must be externalized through secure configuration/secrets management and never
committed.

## Operational Impact

Windows VPS deployment must include a supported PostgreSQL deployment strategy or managed/external
database option.

## Reversibility

Moderate before persistence is implemented; lower after production data exists.
