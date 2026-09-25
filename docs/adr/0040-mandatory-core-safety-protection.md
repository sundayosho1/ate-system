# ADR-0040 — Mandatory Core Safety Protection

## Status

Accepted

## Context

ATE's control-plane foundations include safety-critical authorities such as runtime lifecycle, state
authority, time, configuration validation, version history and capability control itself.

## Decision

Mandatory core capabilities are always requested by the build and cannot be controlled by ordinary
feature flags. Attempts to register a feature-flag-controlled mandatory core capability are
rejected.

## Consequences

- Operators cannot accidentally disable constitutional/control-plane safety through a flag.
- Capability control can describe degraded or blocked mandatory foundations, but it cannot make them
  optional.
- Future approval or emergency-control workflows must use explicit authorities rather than ordinary
  feature flags.
