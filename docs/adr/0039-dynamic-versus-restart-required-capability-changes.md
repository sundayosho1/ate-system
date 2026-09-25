# ADR-0039 — Dynamic Versus Restart-Required Capability Changes

## Status

Accepted

## Context

Some capability-control changes can be applied dynamically, while others must not take effect until
process startup boundaries are re-established.

## Decision

Capability and feature-flag definitions declare reload behavior: `DYNAMIC`, `RESTART_REQUIRED` or
`STARTUP_ONLY`. Evaluation exposes `pendingRestart` and `RESTART_REQUIRED` when desired and applied
flag states differ for restart-required capabilities.

## Consequences

- Operators can see desired state without observing mixed applied behavior.
- Prompt 10 does not implement deployment orchestration or rollback.
- Startup-only mandatory core capabilities remain outside ordinary flag toggles.
