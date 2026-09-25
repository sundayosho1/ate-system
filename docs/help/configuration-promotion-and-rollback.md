# Configuration Promotion and Rollback Help

Prompt 12 provides controlled configuration release governance.

## Environment chain

Configuration can move through the explicit chain:

`DEVELOPMENT -> RESEARCH -> BACKTEST -> SIMULATION -> PAPER -> LIVE`

Skipped transitions fail closed by default.

## Promotion

A promotion request identifies the source environment, exact source version, destination
environment, destination baseline, requester, reason and policy. A promotion plan explains the safe
diff, destination validation, capability impact, approval status, restart impact, blockers and
warnings.

Creating a plan does not activate configuration.

## Activation

Execution performs a final recheck and updates the active destination state atomically. If the
destination changed after planning, the plan is stale and must be recreated.

## Known-good state

A release becomes known-good only after successful activation and verification evidence. Active does
not automatically mean known-good before verification.

## Rollback

Rollback restores an exact known-good target. It is a new governed action with its own request,
plan, execution and activation evidence. It does not delete or rewrite the failed/replaced release.

## Restart-required changes

If promoted configuration contains restart-required capability changes, the release state records
`restartPending`, the currently running version and the target post-restart version. Prompt 12 does
not restart Windows services.

## Common blockers

- transition not allowed;
- source integrity failed;
- destination drifted;
- destination validation failed;
- non-promotable configuration;
- capability blocked or unavailable;
- approval not satisfied;
- rollback target is not known-good;
- restart-required activation disallowed by policy.

## Security

Plans, events and diagnostics expose IDs, fingerprints, reason codes and safe messages only. They do
not expose raw sensitive configuration or resolved secret material.

## Boundary

Configuration promotion, including promotion to `LIVE`, does not authorize trading.
