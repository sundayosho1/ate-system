# ADR-0071 — Dataset Lifecycle, Supersession and Active-Version Authority

## Status

Accepted

## Decision

Dataset lifecycle state and active-version selection are catalogue governance metadata. They are
separate from dataset content and derivation lineage.

Supersession preserves old versions and is not assumed to mean derivation.

## Consequences

- Lifecycle transitions are append-only evidence.
- Active pointer updates use concurrency checks.
- ACTIVE data does not authorize strategies, execution, paper trading or live trading.
