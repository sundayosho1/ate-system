# ADR-0062 — Quality Rule Status and Evidence Model

## Status

Accepted

## Decision

Each quality rule execution records one of `PASS`, `FINDINGS`, `NOT_APPLICABLE`,
`INSUFFICIENT_EVIDENCE` or `FAILED`.

Findings use stable category, dimension and severity fields with bounded evidence samples.
Suppressed evidence is counted explicitly.

## Consequences

- Consumers can distinguish clean results from rules that did not apply or could not gather enough
  evidence.
- Report size remains bounded without hiding that additional findings existed.
- Rule failures are visible diagnostics, not implicit passes.
