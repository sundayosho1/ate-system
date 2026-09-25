# ADR-0064 — Immutable Quality Report Identity

## Status

Accepted

## Decision

Published data-quality reports are immutable. A report fingerprint binds dataset content identity,
profile identity/version/fingerprint, rule outcomes, findings, score and summary.

Volatile runtime metadata such as generation timestamp and rule durations is excluded from the
semantic fingerprint.

## Consequences

- Equivalent dataset/profile/rule outcomes produce equivalent report fingerprints.
- Operational timing differences do not create false semantic changes.
- Corrected or newly assessed evidence creates a new report rather than mutating old evidence.
