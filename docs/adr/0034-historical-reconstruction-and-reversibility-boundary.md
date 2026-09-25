# ADR-0034 — Historical Reconstruction and Reversibility Boundary

## Status

Accepted

## Context

The roadmap says configuration must be reversible. In Prompt 9 this means historically
reconstructable, not operational rollback.

## Decision

Historical reconstruction is read-only. A historical version can be used as the content basis for a
new version via `derivedFromVersionId`, but that new version is still a new immutable fact and does
not by itself activate or promote configuration.

## Consequences

- Prompt 9 supports future rollback workflows without implementing them.
- History is never rewritten to make old versions appear current.
- Prompt 12 remains responsible for governed rollback activation.
