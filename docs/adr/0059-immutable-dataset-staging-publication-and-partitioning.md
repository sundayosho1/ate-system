# ADR-0059 — Immutable Dataset Staging, Publication and Partitioning

## Status

Accepted

## Decision

Historical datasets are staged before publication. Published datasets have immutable manifests,
content fingerprints and deterministic partitions by instrument, observation kind and UTC date.
Research queries only see published datasets.

## Consequences

- Failed imports do not expose partial authoritative datasets.
- Partition metadata can support future catalogue and replay integration.
- Published dataset mutation is not an ordinary operation.
