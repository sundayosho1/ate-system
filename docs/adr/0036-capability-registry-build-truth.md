# ADR-0036 — Capability Registry as Build Truth

## Status

Accepted

## Context

Feature flags can request optional behavior, but ATE must not imply that future market-data,
execution, MT5 or live-trading capabilities exist before implementation and verification.

## Decision

Prompt 10 introduces a capability registry owned by `@ate/configuration`. Each capability declares
its implementation status, class, runtime-mode scope, dependencies, conflicts, required services and
version provenance. Runtime flags cannot change implementation status.

## Consequences

- Unimplemented capabilities can be named truthfully without becoming available.
- Mandatory core capabilities cannot be controlled by ordinary feature flags.
- Capability diagnostics can explain why a capability is unavailable without exposing secrets.
