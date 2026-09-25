# ADR-0043 — Immutable Approval Evidence and Exact-Version Binding

## Status

Accepted

## Context

Approval must not float from one configuration version to another or survive content/policy changes
silently.

## Decision

Approval requests, decisions and revocations are append-only records bound to version ID,
configuration fingerprint, change-set fingerprint, schema fingerprint and policy fingerprint.

## Consequences

- Reapproval appends new evidence rather than rewriting old decisions.
- Rejection and revocation preserve historical facts.
- Eligibility can fail closed on stale fingerprint evidence.
