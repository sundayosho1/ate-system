# 0026 — Configuration Sources and Bootstrap Boundary

## Status

Accepted.

## Context

Some values are needed before managed configuration can start, but allowing bootstrap mechanisms to
become the long-term control plane would bypass governance and provenance.

## Decision

Keep bootstrap configuration minimal: runtime mode, source references, optional log level and secret
provider reference. Managed sources are loaded through `ConfigurationSource` abstractions with
source type, health, criticality and failure policy. Source priority is metadata and does not
override scope precedence.

## Alternatives Considered

- Read environment variables throughout application packages. Rejected because it creates hidden
  configuration authority.
- Make source type determine effective value precedence. Rejected because source and scope
  precedence are separate concerns.

## Consequences

The engine can support built-in, file, environment, persisted and runtime sources without coupling
consumers to storage.

## Security Impact

Secret values remain outside ordinary entries; diagnostics expose safe source metadata only.

## Operational Impact

Source availability and stale/unavailable state affect health and readiness visibly.

## Reversibility

New source adapters can be added without changing configuration consumers.
