# 0023 — Hierarchical Configuration Authority

## Status

Accepted.

## Context

ATE needs one control-plane authority for managed configuration. Without a single resolver, future
modules could accumulate scattered defaults, environment-variable overrides and module-local
settings that are hard to inspect or reproduce.

## Decision

Introduce `@ate/configuration` as the authoritative hierarchical configuration foundation.
Configuration domains describe what is configured. Scopes describe where entries apply. Context
selects applicable scopes. The resolver produces immutable effective configuration with provenance.

## Alternatives Considered

- Let each package own its settings. Rejected because it creates competing authorities.
- Use environment variables as universal overrides. Rejected because bootstrap and managed
  configuration must remain separate.

## Consequences

Future services consume configuration through one authority instead of local fallbacks.

## Security Impact

Secrets are excluded from ordinary configuration and represented only as references.

## Operational Impact

Operators can inspect effective values and why each value won.

## Reversibility

The package boundary is narrow; internal source/resolver implementations can change behind the
contracts.
