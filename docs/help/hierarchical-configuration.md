# Hierarchical Configuration Help

Use this guide to understand and troubleshoot ATE managed configuration.

## What configuration is

Configuration is the governed control-plane input used by services to decide how they should behave
in a specific operational context. It is not a pile of environment variables or module-local
constants.

Prompt 7 implements the foundation only. It does not implement full schema validation, version
history, approval workflow, promotion/rollback, frontend editing or trading behavior.

## Domains

Domains describe what is configured, such as `SYSTEM`, `DATA`, `RISK`, `EXECUTION` or
`SURVEILLANCE`.

## Scopes

Scopes describe where an entry applies, such as:

- `SYSTEM`
- `ENVIRONMENT:PAPER`
- `BROKER:broker-a`
- `ACCOUNT:account-a`
- `ASSET_CLASS:FOREX`
- `INSTRUMENT:FX:EURUSD`
- `TIMEFRAME:H1`
- `REGIME:TREND`
- `STRATEGY:trend-pullback`
- `PORTFOLIO:portfolio-a`

Domains and scopes are different. A risk setting can exist at system scope, account scope or another
allowed scope.

## Context

Resolution uses an explicit `ConfigurationContext`. Partial context is allowed. A data service may
resolve using only environment and instrument; it does not need fake account or strategy values.

## Inheritance and overrides

A broader value can be inherited when no narrower applicable value exists. A narrower value can
override a broader one when the definition's precedence policy allows it.

Example:

```text
SYSTEM: data.defaultFreshnessPolicy = base
ENVIRONMENT:PAPER: data.defaultFreshnessPolicy = paper
```

For `runtimeMode = PAPER`, `paper` wins and the provenance records that it overrode `base`.

## Precedence

Precedence is explicit policy. A conflict between `ACCOUNT` and `INSTRUMENT` is not resolved by load
order. If the policy does not distinguish equal-precedence values and they disagree, resolution
fails visibly.

## Effective configuration

An effective configuration contains:

- context;
- snapshot ID;
- fingerprint;
- resolved values;
- provenance;
- conflicts;
- diagnostics.

Consumers must treat it as immutable.

## Provenance and explanation

For each value, ATE can explain:

- final value;
- winning scope;
- winning source;
- considered candidates;
- overridden entries;
- precedence policy;
- reasoning.

Secret references are redacted.

## Sources

Source types include built-in, file, environment/bootstrap, persisted, runtime and test. A source's
type does not automatically decide precedence.

## Bootstrap vs managed configuration

Bootstrap configuration is intentionally small: runtime mode, source references, optional log level
and secret provider reference. If a setting can be managed by the configuration engine, it should
not remain a permanent `.env` setting.

## Missing values

Missing values are not guessed. A definition may provide an explicit default, allow absence or mark
the value required/fail-closed.

## Conflicts

Common conflicts:

- unknown key;
- duplicate entry for key + scope + source;
- invalid scope;
- missing required value;
- equal-precedence disagreement;
- source unavailable/stale;
- secret value where only references are allowed.

## Environment isolation

`ENVIRONMENT:RESEARCH` does not silently affect `LIVE`. Environment scopes match Prompt 3 runtime
modes exactly.

## Troubleshooting

### Unknown key

Check spelling, domain prefix and registered definitions. Unknown authoritative keys are rejected to
prevent typo-driven behavior.

### Override not taking effect

Check that the context contains the matching scope dimension, the definition allows that scope and
the precedence policy ranks it as expected.

### Equal-precedence conflict

Update the precedence policy or remove one candidate. ATE will not choose based on source order.

### Source unavailable

Inspect source health and criticality. Required unavailable sources block publication.

### Stale source

Treat stale required sources as readiness problems until refreshed or explicitly governed.

### Cache mismatch

Cache keys include snapshot ID and full context. Invalidate cache when snapshots change.

### Secret redaction

Secrets must be references. If a diagnostic shows `[REDACTED]`, inspect the secret provider outside
ordinary configuration.

### Service not ready

Read diagnostics for missing required values, blocking conflicts, absent snapshot or source failure.

## Current foundational definitions

| Key                                   | Domain         | Type          | Default | Allowed scopes                             |
| ------------------------------------- | -------------- | ------------- | ------- | ------------------------------------------ |
| `system.runtimeMode`                  | `SYSTEM`       | `ENUM`        | None    | `SYSTEM`, `ENVIRONMENT`                    |
| `system.logLevel`                     | `SYSTEM`       | `ENUM`        | `info`  | `SYSTEM`, `ENVIRONMENT`                    |
| `system.configurationCacheMaxEntries` | `SYSTEM`       | `INTEGER`     | `100`   | `SYSTEM`, `ENVIRONMENT`                    |
| `data.defaultFreshnessPolicy`         | `DATA`         | `OBJECT`      | None    | System/environment/data-context scopes     |
| `execution.maxRetryAttempts`          | `EXECUTION`    | `INTEGER`     | None    | System/environment/future execution scopes |
| `surveillance.scanIntervalMs`         | `SURVEILLANCE` | `DURATION_MS` | None    | System/environment/surveillance scopes     |

These definitions are foundations only; Prompt 8 will add comprehensive validation.
