# ADR-0035 — Configuration Version Persistence and Atomicity

## Status

Accepted

## Context

Configuration version history must survive restart and must not diverge from current-version state.
Prompt 5 already established transactional state authority and optimistic concurrency foundations.

## Decision

Prompt 9 defines a configuration version repository contract with append-only version records,
current pointer updates, expected-parent concurrency and idempotency. The in-memory implementation
uses a durable store object for deterministic tests and mirrors the transaction/current-pointer
atomicity required from future database-backed persistence.

## Consequences

- Repository APIs do not expose ordinary update/delete methods for versions.
- Current pointer and version append are performed together by the repository.
- Future database persistence must preserve the same atomic boundary.
