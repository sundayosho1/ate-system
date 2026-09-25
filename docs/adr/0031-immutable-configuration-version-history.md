# ADR-0031 — Immutable Configuration Version History

## Status

Accepted

## Context

Prompt 7 created configuration authority and Prompt 8 created schema/validation authority. Prompt 9
needs historical proof of what configuration existed, who created it, why, and under which schema.

## Decision

`@ate/configuration` owns an append-only configuration version-history authority. Version records
are immutable. Corrections, reversals and historical derivations create new records rather than
editing old records.

## Consequences

- Version records are historical facts.
- Current-version pointer is mutable state and separate from immutable records.
- Operational rollback remains Prompt 12 scope.
