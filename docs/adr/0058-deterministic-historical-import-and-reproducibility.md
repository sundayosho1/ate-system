# ADR-0058 — Deterministic Historical Import and Reproducibility

## Status

Accepted

## Decision

Artifact SHA-256 checksum, declarative mapping, rejection/duplicate policy, resource limits and
canonical schema identity contribute to import-plan fingerprints. Generated observation IDs derive
deterministically from artifact, plan, record position, kind, event time and instrument.

## Consequences

- Same bytes and same mapping semantics reproduce equivalent canonical content.
- Different mapping semantics produce different plan identity.
- Artifact checksums are integrity/reproducibility evidence, not authorization.
