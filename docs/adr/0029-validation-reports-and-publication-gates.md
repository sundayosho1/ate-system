# ADR-0029 — Validation Reports and Publication Gates

## Status

Accepted

## Context

Invalid configuration must not silently activate. Operators also need safe diagnostics explaining
why a candidate failed without exposing secrets or sensitive values.

## Decision

Prompt 8 validation emits immutable reports with stable phases, severities, issue summaries and
deterministic fingerprints. The runtime configuration service validates candidate snapshots and the
runtime-mode effective configuration before publication when a schema registry is supplied. Blocking
issues return `CONFIGURATION_VALIDATION_FAILED` and preserve the last-known-good active snapshot.

## Consequences

- Runtime readiness is blocked by validation errors.
- Resolution for additional contexts is validated before caching.
- Reports carry safe metadata such as expected type, constraint and path, not secret material.
- Promotion and rollback remain future prompt scope.
