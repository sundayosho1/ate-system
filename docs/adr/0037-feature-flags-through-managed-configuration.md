# ADR-0037 — Feature Flags Through Managed Configuration

## Status

Accepted

## Context

Prompt 7 established one managed configuration authority and Prompt 8 added schemas and validation.
Prompt 10 needs feature flags without creating a competing configuration mechanism.

## Decision

Feature flags are declared as registry records that reference canonical configuration keys.
Effective flag values are read from validated effective configuration and fall back only to declared
schema defaults.

## Consequences

- Flag changes inherit configuration provenance, validation and version-history association.
- Flags cannot bypass schemas, runtime-mode isolation or publication gates.
- Feature flags remain boolean capability requests, not arbitrary application state.
