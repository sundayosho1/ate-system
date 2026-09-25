# Feature Flags and Capability Control Help

Prompt 10 feature flags are managed configuration values that request optional control-plane
capabilities. They do not grant trading permission and do not bypass safety invariants.

## What operators can inspect

Capability diagnostics show:

- capability ID;
- effective state;
- whether the capability is implemented in this build;
- reason codes for disabled, unavailable, blocked or degraded states;
- dependency states;
- related feature flag, if any;
- configuration snapshot/version/schema provenance.

## Safe interpretation

| Observation                         | Meaning                                                                |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `ENABLED` mandatory core capability | Required foundation capability is available for this runtime mode.     |
| `DISABLED` optional capability      | Managed configuration requested the capability off.                    |
| `UNAVAILABLE` future capability     | The build does not implement it, even if a test flag requests it.      |
| `BLOCKED` capability                | Environment, dependency, conflict or restart gate prevents enablement. |
| `DEGRADED` capability               | Required service readiness is degraded or not ready.                   |
| `pendingRestart: true`              | Desired configuration differs from applied restart-required state.     |

## Prompt 10 flags

| Configuration key                                      | Default | Reload behavior  | Scope              |
| ------------------------------------------------------ | ------- | ---------------- | ------------------ |
| `system.feature.configurationHistoryInspectionEnabled` | `true`  | Dynamic refresh  | System/environment |
| `system.feature.capabilityDiagnosticsEnabled`          | `true`  | Restart required | System/environment |

These flags control diagnostics and read-only inspection surfaces only. They do not enable
configuration approval, promotion, rollback, market-data ingestion, MT5 connectivity, execution or
live trading.

## Troubleshooting

1. Check the effective capability reason codes.
2. Check whether the capability is implemented in the build manifest and registry.
3. Check the runtime mode; some capabilities are mode-limited.
4. Check dependencies and required service readiness.
5. If `RESTART_REQUIRED` appears, restart using the future operational process once such deployment
   workflows exist.

Prompt 10 intentionally has no random rollout, user targeting, frontend editor or maker-checker
approval process.
