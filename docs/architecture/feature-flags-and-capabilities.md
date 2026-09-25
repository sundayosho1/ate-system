# Feature Flags and Capability Control

Prompt 10 adds a configuration-owned capability-control foundation. It answers one question: given
the build-time capability catalog, managed configuration flags, runtime mode, dependencies and
service readiness, what capabilities are effectively enabled, disabled, unavailable, blocked or
degraded right now?

Prompt 10 itself did not implement maker-checker approval. Prompt 11 now adds approval governance.
Capability control still does not implement promotion, rollback, rollout percentages, market data,
MT5 connectivity, execution engines or live trading.

## Authorities

| Authority                          | Responsibility                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| Capability registry                | Build-truth list of implemented and explicitly unimplemented capabilities.    |
| Feature flag registry              | Mapping from managed configuration keys to optional implemented capabilities. |
| Configuration authority            | Supplies typed effective flag values through normal configuration resolution. |
| Capability evaluator               | Produces immutable effective capability snapshots and explanations.           |
| Capability-control state authority | Owns current effective capability-control state and diagnostics.              |

The build manifest and capability registry remain truth for implementation status. A runtime flag
can request an optional capability, but it cannot make an unimplemented capability available.

## Effective states

| State         | Meaning                                                                  |
| ------------- | ------------------------------------------------------------------------ |
| `ENABLED`     | Implemented, requested or mandatory, runtime-mode allowed and unblocked. |
| `DISABLED`    | Optional capability intentionally off by managed configuration.          |
| `UNAVAILABLE` | Requested capability is not implemented in this build.                   |
| `BLOCKED`     | Dependency, environment, conflict or restart gate prevents enablement.   |
| `DEGRADED`    | Capability exists but a required runtime service is not fully ready.     |

Every effective capability includes stable reason codes, dependency states, service requirements,
runtime-mode scope, restart-pending status and configuration provenance.

## Feature flags

Feature flags are configuration-backed booleans with schemas and help metadata. They are not a
second configuration engine and do not store arbitrary runtime state. Prompt 10 introduces safe
control-plane flags for:

- read-only configuration history inspection;
- capability diagnostics visibility.

Mandatory core capabilities cannot be ordinary feature-flag controlled. Future trading/data
capabilities may be listed as `NOT_IMPLEMENTED`, but Prompt 10 does not provide flags that make them
available.

## Dependency gating

Capability evaluation fails closed:

1. unknown dependency definitions are rejected;
2. dependency cycles are rejected;
3. disabled or blocked dependencies block dependants;
4. unavailable dependencies block dependants with explicit reason codes;
5. conflicting requested capabilities block affected capabilities;
6. runtime-mode-ineligible capabilities are blocked;
7. restart-required flag changes are visible as pending restart.

## Snapshots and events

Effective capability snapshots are immutable and have deterministic fingerprints. They reference the
configuration snapshot fingerprint and may reference configuration version and schema fingerprints
when available.

Prompt 10 registers safe events:

- `configuration.capability.snapshot-published.v1`;
- `configuration.capability.blocked.v1`.

These event payloads expose identifiers, counts and reason codes only; they do not expose raw
configuration values or secrets.

## Boundaries

Capability control is not promotion, rollback or a trading kill switch. Prompt 11 approval
governance remains a separate authority consulted through explicit eligibility/gate contracts.
Prompt 10 only establishes the truthful registry and deterministic runtime enablement calculation.
