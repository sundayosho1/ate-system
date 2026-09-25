# Configuration Schema and Validation

Prompt 8 extends the Prompt 7 hierarchical configuration authority with explicit schema contracts,
validation phases, safe validation reports and runtime publication gates.

Prompt 8 itself did not implement configuration version history, approval workflows,
promotion/rollback, feature flags, frontend editing, market data, risk, portfolio, execution, MT5 or
live trading. Prompts 9-10 now add immutable version history and capability-control foundations;
approval, promotion/rollback, frontend editing, market data, risk, portfolio, execution, MT5 and
live trading remain future scope.

## Authority model

`@ate/configuration` now has two related registries:

- `ConfigurationRegistry` declares keys for resolution, precedence and provenance.
- `ConfigurationSchemaRegistry` declares value type, constraints, dependencies, conditional rules,
  cross-field rules, help metadata and deterministic schema fingerprints.

Both registries are authoritative inside the configuration package. Business packages must not
invent local configuration schemas or read unmanaged environment values directly.

## Validation phases

Validation reports use stable phases:

- `SCHEMA`
- `SOURCE_ENTRY`
- `STRUCTURAL`
- `TYPE`
- `CONSTRAINT`
- `SCOPE_APPLICABILITY`
- `DEPENDENCY`
- `CONDITIONAL`
- `CROSS_FIELD`
- `EFFECTIVE_CONFIGURATION`
- `PUBLICATION_GATE`

Reports contain issue counts, blocking counts, phase counts and safe metadata such as expected type
or constraint names. Reports do not include secret material or raw sensitive values.

## Constraints

Schemas can declare allowed enum values, numeric ranges, string lengths and patterns, object
properties, list bounds, item value types, units and secret-reference providers. Foundational Prompt
8 schemas cover:

- `system.runtimeMode`
- `system.logLevel`
- `system.configurationCacheMaxEntries`
- `data.defaultFreshnessPolicy`
- `execution.maxRetryAttempts`
- `surveillance.scanIntervalMs`

These schemas are intentionally foundational. They validate contracts for future services without
implementing those services.

## Dependency and cross-field validation

Schemas can declare dependencies, mutual exclusions, conditional requirements and built-in
cross-field rules. The initial built-in cross-field rules are deterministic and data-only:

- runtime mode value must match the resolution runtime context;
- declared values must match;
- declared values must differ.

Configuration cannot execute arbitrary code.

## Runtime publication gate

When a runtime service is supplied a schema registry, refresh creates a candidate snapshot,
validates source entries and validates the effective configuration for the runtime mode before
publication. A blocking validation issue returns `CONFIGURATION_VALIDATION_FAILED`, preserves the
last-known-good active snapshot and blocks readiness.

Resolution for additional contexts is also validated. Invalid effective configuration fails closed
instead of being cached or silently returned.

## Fingerprints

Schema fingerprints are deterministic semantic identities derived from schema keys, types,
constraints, dependencies, conditionals, cross-field rules, scopes, defaults and sensitivity. They
are separate from snapshot fingerprints and are preserved by Prompt 9 configuration versions as
historical validation evidence.
