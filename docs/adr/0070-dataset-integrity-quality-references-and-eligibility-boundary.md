# ADR-0070 — Dataset Integrity, Quality References and Eligibility Boundary

## Status

Accepted

## Decision

The catalogue records integrity metadata and Prompt 15 quality references, then derives intended-use
eligibility from evidence and policy.

It does not recalculate Prompt 15 quality scores and does not create live-trading eligibility.

## Consequences

- Integrity mismatch never silently updates registered fingerprints.
- Old quality references remain history.
- Eligibility is explainable and use-case-specific.
