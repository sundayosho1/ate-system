# Hierarchical Configuration Authority

Prompt 7 establishes `@ate/configuration`, the ATE control-plane foundation for resolving managed
configuration. It answers:

- what value applies to this context;
- which scope supplied it;
- which source supplied it;
- what it overrode;
- why it won;
- whether resolution is deterministic and safe to consume.

Prompt 8 extends this authority with schema validation, constraints, dependency rules, cross-field
rules and invalid-candidate rejection. Prompt 9 adds immutable configuration version history,
lineage, change sets, diffs and reconstruction. Prompt 10 adds feature-flag and capability-control
foundations. The configuration package still does not implement maker-checker approval,
promotion/rollback, frontend configuration editing, trading strategies, risk, portfolio, MT5,
execution or live trading.

## Core rule

```text
DOMAINS describe what is configured.
SCOPES describe where an entry applies.
CONTEXT selects applicable scopes.
PRECEDENCE decides which applicable value wins.
PROVENANCE explains the result.
```

## Domains

Prompt 7 supports these canonical configuration domains:

- `SYSTEM`
- `ENVIRONMENT`
- `BROKER`
- `ACCOUNT`
- `ASSET_CLASS`
- `INSTRUMENT`
- `TIMEFRAME`
- `REGIME`
- `STRATEGY`
- `RISK`
- `PORTFOLIO`
- `EXECUTION`
- `SURVEILLANCE`
- `DATA`
- `NEWS`
- `LEARNING`
- `REPORTING`

Domains do not imply precedence.

## Scopes

Scopes include `SYSTEM`, `ENVIRONMENT`, `BROKER`, `ACCOUNT`, `ASSET_CLASS`, `INSTRUMENT`,
`TIMEFRAME`, `REGIME`, `STRATEGY`, `PORTFOLIO` and domain-specific extension scopes. Scope identity
is explicit. `ENVIRONMENT` scope uses Prompt 3 runtime modes.

## Keys

Configuration keys use lower-first, domain-prefixed canonical identities such as:

- `system.runtimeMode`
- `system.logLevel`
- `data.defaultFreshnessPolicy`
- `execution.maxRetryAttempts`
- `surveillance.scanIntervalMs`

Unknown authoritative keys are rejected.

## Sources

Sources describe where entries came from: built-in defaults, files, environment/bootstrap adapters,
persisted stores, runtime adapters or tests. Source priority is metadata. It does not silently
override scope precedence.

## Effective configuration

Resolution produces an immutable `EffectiveConfiguration` for a supplied `ConfigurationContext`.
Every effective value contains provenance, considered candidates, overridden entries and precedence
reasoning. Consumers must not mutate the result.

## Snapshots and fingerprints

Source loads create candidate snapshots. Valid snapshots are published atomically. Each snapshot has
a deterministic semantic fingerprint based on registry definitions and entries, not source ordering.

## Cache

The cache is bounded and context-aware. It is keyed by snapshot plus full context. It is never
configuration authority.

## Runtime service

The configuration runtime service depends on time authority. It loads sources, publishes a coherent
snapshot, resolves configuration, exposes health/readiness and reports safe diagnostics. When a
schema registry is supplied, candidate snapshots and runtime effective configuration must pass
schema validation before publication.

## Schema validation

Prompt 8 schemas define value types, enum values, ranges, object/list shape, units, dependency
rules, conditional rules, cross-field rules and help metadata. Blocking validation issues produce
safe validation reports and prevent activation.

## Persistence and events

Prompt 7 declares configuration control-plane state authority for current managed snapshots. Prompt
9 declares configuration version-history state authority for immutable historical records and the
current-version pointer. Event integration exposes safe operational/audit event registrations
without dumping full configuration or secrets into events.

## Security

Secrets are not ordinary configuration. Managed configuration can hold secret references, and
explanations redact reference identifiers. Configuration cannot override the Engineering
Constitution or safety invariants.
