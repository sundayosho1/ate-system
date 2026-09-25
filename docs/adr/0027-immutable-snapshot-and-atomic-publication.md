# 0027 — Immutable Snapshot and Atomic Publication

## Status

Accepted.

## Context

Consumers must not observe a half-applied configuration refresh. Reproducibility also requires a
stable identity for the semantic configuration used by an operation.

## Decision

Configuration is loaded into candidate snapshots. A candidate with blocking conflicts is rejected.
Valid snapshots are published atomically, immutable after publication and fingerprinted with stable
canonical serialization. Failed refreshes do not partially replace the active snapshot.

## Alternatives Considered

- Mutate active settings as each source loads. Rejected because readers could see mixed state.
- Use timestamps as snapshot identity. Rejected because timestamps are not semantic fingerprints.

## Consequences

Readers can pin one coherent snapshot and cache results by snapshot plus context.

## Security Impact

Rejected candidate snapshots cannot partially activate unsafe or secret-bearing values.

## Operational Impact

Diagnostics can show active snapshot ID, fingerprint and refresh failures.

## Reversibility

Fingerprinting implementation can evolve if semantic stability is preserved.
