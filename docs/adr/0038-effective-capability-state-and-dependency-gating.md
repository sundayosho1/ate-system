# ADR-0038 — Effective Capability State and Dependency Gating

## Status

Accepted

## Context

Runtime consumers need a deterministic view of which capabilities are usable, disabled, blocked,
degraded or unavailable.

## Decision

Prompt 10 computes immutable effective capability snapshots from the capability registry, feature
flags, runtime mode, dependency graph and service readiness. Dependency cycles and unknown
dependencies fail closed.

## Consequences

- Capabilities expose stable reason codes rather than ambiguous booleans.
- Disabled, unavailable and degraded states are distinguishable.
- Runtime health/readiness remains operational evidence; it does not become configuration.
