# ADR-0048 — Atomic Activation and Active Configuration Authority

## Status

Accepted

## Context

Consumers must not infer active configuration from latest version records or observe partial
promotion state.

## Decision

The release repository owns active environment state. Activation records and active pointers are
updated atomically using the expected destination baseline. Failed activation preserves previous
active state.

## Alternatives Considered

- Let version-history current pointer define active state. Rejected because latest is not active.
- Use last-write-wins activation. Rejected because concurrent releases must fail closed.

## Consequences

- Latest is not active.
- Active state includes version ID, fingerprints, activation ID, actor, time and restart status.
- Unknown activation outcomes are unsafe and fail readiness.

## Security Impact

Activation records avoid raw configuration payloads and expose safe identities/fingerprints.

## Operational Impact

Release diagnostics can show active version, restart pending state and failed activations.

## Reversibility

Rollback creates new activation evidence instead of mutating activation records.
