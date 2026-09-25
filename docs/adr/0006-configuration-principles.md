# ADR-0006: Typed, Validated, Versionable Configuration

## Status

Accepted

## Context

ATE must be highly configurable, but unsafe or unexplained configuration could cause capital loss,
operational confusion, or invalid research.

## Decision

ATE configuration will be typed, validated, versionable, explainable, auditable, scope-aware,
override-aware, environment-aware, rollback-capable, and secure.

Invalid safety-critical configuration must not silently activate.

## Alternatives Considered

- Ad hoc environment variables for all settings: rejected because they lack structure, validation,
  and usability.
- Database-only mutable configuration: rejected because it can bypass versioning and promotion
  controls if unmanaged.
- Static files only: insufficient for future operational control and audit.

## Consequences

- Future configuration engine must support schemas, validation, help metadata, versioning, audit,
  and safe activation.
- UI must explain settings and consequences.

## Security Impact

Secrets must be modeled separately from non-secret configuration and must not be rendered or logged.

## Operational Impact

Operators should see current/proposed values, warnings, and approval state for sensitive changes.

## Reversibility

Low. Configuration governance is foundational for capital-bearing systems.
