# Configuration Promotion and Rollback

Prompt 12 adds the configuration release authority. It governs how exact immutable configuration
versions become active in governed environments and how exact known-good versions are restored.

It does not deploy application binaries, databases, MT5, market data, strategies, execution,
capital, paper trading or live trading.

## Environment chain

The explicit default graph is:

```text
DEVELOPMENT -> RESEARCH -> BACKTEST -> SIMULATION -> PAPER -> LIVE
```

Same-environment activation is modeled separately from cross-environment promotion. Skipped
transitions are rejected unless a future constitutional policy explicitly adds such an edge.

## Release authority

The release authority owns:

- promotion policies and fingerprints;
- promotion requests, plans, decisions and executions;
- active release state per environment;
- activation records;
- known-good records;
- rollback requests, plans and executions;
- release lineage.

The version-history current pointer remains a version-history concern. It is not the active release
pointer. Latest version is not active unless release authority activates it.

## Promotion planning

A promotion request binds the exact source version, source environment, destination environment and
destination baseline. Planning is deterministic and does not mutate destination state.

Plans revalidate the resulting destination effective configuration under destination context,
evaluate destination capability state, consult approval eligibility, preserve destination-local
configuration such as runtime mode, block non-promotable changes and report restart requirements.

## Activation

Execution consumes an eligible current plan and performs a final pre-activation recheck. Activation
updates active environment state atomically through the release repository using the expected
destination baseline. Stale writers fail closed.

## Known-good and rollback

Successful activation records post-activation verification evidence before a version becomes
known-good. Rollback targets exact known-good versions, revalidates them under current destination
policy/schema/capability conditions and records new rollback evidence. Rollback never rewrites or
deletes the replaced version.

## Restart-required state

Restart-required capability changes are represented as `restartPending` release state with both the
currently running version and target post-restart version. Prompt 12 records the truth; it does not
restart Windows services.

## Boundaries

Promotion to `LIVE` means only configuration release governance for the `LIVE` environment. It does
not imply live trading, broker connectivity, capital authorization or production qualification.
