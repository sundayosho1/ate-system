# ADR-0060 — Historical Query, Quarantine and Resource-Bound Architecture

## Status

Accepted

## Decision

Historical queries are bounded and ordered deterministically. Rejected records are quarantined as
evidence and excluded from research queries. Parser/file/query limits are mandatory safety controls.

## Consequences

- No `getAllTicks()` style unbounded reads.
- Quarantine cannot masquerade as canonical dataset membership.
- Prompt 14 import statistics remain descriptive and are not quality scores.
