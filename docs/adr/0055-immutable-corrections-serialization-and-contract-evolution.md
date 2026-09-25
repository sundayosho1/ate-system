# ADR-0055 — Immutable Corrections, Serialization and Contract Evolution

## Status

Accepted

## Context

Market-data providers can revise ticks and bars. Historical reconstruction and duplicate detection
need deterministic serialization without treating a semantic fingerprint as identity.

## Decision

Market observations are immutable value records. Corrections are append-only records linking
original and replacement observations. Canonical market-data serialization uses stable object-key
ordering and omits `undefined` values. Semantic fingerprints are deterministic deduplication aids
that exclude volatile receive/processing evidence; observation IDs remain separate.

## Consequences

- Historical observations are not updated in place.
- Duplicate detection can compare semantic content while preserving provider/source IDs.
- Future schema versions can evolve additively without changing existing observation meaning.

## Security Impact

Fingerprints do not include raw payloads or secrets and are not cryptographic authorization tokens.
