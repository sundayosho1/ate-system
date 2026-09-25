# ADR-0033 — Configuration Change Sets and Semantic Diff

## Status

Accepted

## Context

Operators need machine-readable answers to what changed between versions without exposing secrets or
depending on textual serialization.

## Decision

Prompt 9 stores structured change sets and provides deterministic semantic diffs. Diffs are
directional and classify added, modified, removed and unchanged entries. Secret-reference values are
redacted while value fingerprints preserve deterministic comparison.

## Consequences

- Future Control Center views can render version comparisons without parsing strings.
- Diff output is bounded and deterministic.
- Version history is not a secret archive.
