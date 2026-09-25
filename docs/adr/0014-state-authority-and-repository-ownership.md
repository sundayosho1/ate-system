# ADR-0014 — State Authority and Repository Ownership

## Status

Accepted

## Context

ATE must avoid competing write authorities, cache-as-truth and silent state contamination between
runtime modes.

## Decision

Every durable state domain must declare one owner, one authority type and one controlled write path
through the State Authority Registry. Repositories expose domain-meaningful operations rather than
unrestricted CRUD/raw SQL.

## Alternatives Considered

- Shared generic CRUD across modules: rejected because it weakens ownership.
- Treat events as state authority: rejected because events describe occurrences, not current truth.
- Treat projections/caches as write authority: rejected as unsafe.

## Consequences

- Future services must register ownership before mutating durable state.
- Runtime mode scope is enforced at persistence boundaries.

## Security Impact

Clear ownership supports least privilege and future database role separation.

## Operational Impact

Diagnostics can answer who owns a state domain and whether it is durable/history-backed.

## Reversibility

Ownership entries can evolve through explicit ADRs/migrations before production data is created.
