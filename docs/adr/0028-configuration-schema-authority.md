# ADR-0028 — Configuration Schema Authority

## Status

Accepted

## Context

Prompt 7 introduced hierarchical configuration resolution but intentionally left comprehensive
schema validation to Prompt 8. Without a schema authority, value types, ranges, units and help
metadata would drift across future services.

## Decision

`@ate/configuration` owns `ConfigurationSchemaRegistry` as the single in-process authority for
configuration schemas. Schemas are registered separately from resolution definitions but use the
same canonical keys. The schema registry rejects duplicate schemas, invalid schema shapes and
defaults that do not satisfy their own schema.

## Consequences

- Schema fingerprints are deterministic and independent from configuration snapshots.
- Business packages must consume schemas through the configuration package rather than declaring
  local authority.
- Prompt 9 may build version lifecycle on top of schema fingerprints, but Prompt 8 does not
  implement lifecycle history.
