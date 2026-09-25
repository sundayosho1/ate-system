# ADR-0072 — Reproducibility, Catalogue Snapshots and Impact Analysis

## Status

Accepted

## Decision

The catalogue records reproducibility evidence and can create semantic catalogue snapshots. Impact
analysis traverses descendants from exact dataset versions.

## Consequences

- Research can bind exact dataset versions and catalogue state.
- Snapshot fingerprints canonicalize semantic state and exclude volatile process ordering.
- Impact analysis is diagnostic evidence, not automatic invalidation.
