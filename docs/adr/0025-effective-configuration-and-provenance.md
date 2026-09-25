# 0025 — Effective Configuration and Provenance

## Status

Accepted.

## Context

Future operators and services must answer why a configuration value applies. A plain settings object
cannot show inheritance, overrides, source identity or rejected candidates.

## Decision

Effective configuration is an immutable resolved object containing context, values, provenance,
conflicts, diagnostics and snapshot identity. Each effective value records candidates considered,
the winning scope/source, overridden entries and precedence reasoning.

## Alternatives Considered

- Return only key/value pairs. Rejected because it loses auditability and explainability.
- Store explanation only in logs. Rejected because explanation is an application capability.

## Consequences

Consumers can pin one coherent snapshot and carry its fingerprint through future events/audit.

## Security Impact

Secret references are redacted in provenance and diagnostics.

## Operational Impact

Troubleshooting unexpected values is supported by first-class explanation.

## Reversibility

Additional provenance fields can be added compatibly as later prompts add versioning and approval.
