# Persistence Help

## Overview

`@ate/persistence` provides ATE's persistence and state authority foundation: transactions,
state-versioning, immutable history, audit records, transactional outbox, durable inbox, durable
dead letters, migrations, diagnostics and runtime integration.

## What persistence does

```text
VALIDATE OWNER
BEGIN TRANSACTION
WRITE STATE
APPEND HISTORY / AUDIT
WRITE OUTBOX
COMMIT
DISPATCH OUTBOX
CLAIM INBOX
HANDLE EVENT
MARK INBOX SUCCESS / FAILURE
```

## State authority

Every durable state domain must have one owner and one controlled write path. Other components may
read, cache, project or subscribe, but must not become competing write authorities.

## Transactions

Transactions commit all participating writes together or roll them back together. Prompt 5 prohibits
nested transactions rather than silently opening independent transactions.

## Repositories and unit of work

The persistence engine exposes domain-meaningful operations such as expected-version state saves,
history append, audit append, outbox append, inbox claim and dead-letter persistence. It does not
expose arbitrary application-level raw SQL.

## Optimistic concurrency

Mutable state writes include an expected version. A stale expected version returns
`CONCURRENCY_CONFLICT` and must be reloaded/re-evaluated by the caller.

## Immutable history and audit

State history and audit records are append-only. Ordinary application operations cannot update or
delete them. Corrections should be represented by new corrective records.

## Transactional outbox

Events required by a committed state transition are stored in the same transaction. The outbox
dispatcher publishes them to `@ate/events` after commit and records publication outcome.

## Durable inbox

Subscribers can record `subscriptionId + idempotencyKey` processing state durably so duplicate
delivery after restart does not duplicate side effects.

## Dead letters

Durable dead letters persist failed event processing evidence and survive restart. Replay is
explicit and preserves event identity, runtime mode, correlation and causation.

## Schema migrations

Migrations are ordered and checksummed. Re-running already-applied migrations is safe. Checksum
mismatch is schema incompatibility. Destructive automatic schema synchronization is prohibited.

## Health and readiness

Persistence health checks reachability and operational state. Readiness requires compatible schema
and transaction capability. A process can be alive while persistence is not ready.

## Configuration options

Prompt 5 options are typed construction options until Prompt 7 centralizes configuration.

| Option                   | Type    | Default       | Valid range / values             | Safety impact                                |
| ------------------------ | ------- | ------------- | -------------------------------- | -------------------------------------------- |
| `connectionTimeoutMs`    | integer | 1000          | `> 0`                            | Bounds database connection attempts.         |
| `transactionTimeoutMs`   | integer | 1000          | `> 0`                            | Rolls back hung transactions.                |
| `queryTimeoutMs`         | integer | 1000          | `> 0`                            | Bounds repository/query calls.               |
| `poolMin`                | integer | 0             | `>= 0`, `<= poolMax`             | Avoids invalid pool configuration.           |
| `poolMax`                | integer | 5             | `> 0`                            | Prevents unlimited connections.              |
| `poolIdleTimeoutMs`      | integer | 30000         | `> 0`                            | Bounds idle connection retention.            |
| `outboxBatchSize`        | integer | 25            | `> 0`                            | Prevents loading all pending outbox at once. |
| `outboxRetryAttempts`    | integer | 3             | `> 0`                            | Prevents infinite dispatch retries.          |
| `inboxProcessingLeaseMs` | integer | 30000         | `> 0`                            | Enables stale processing claim recovery.     |
| `deadLetterQueryLimit`   | integer | 100           | `> 0`                            | Bounds dead-letter inspection memory.        |
| `healthTimeoutMs`        | integer | 500           | `> 0`                            | Bounds health checks.                        |
| `shutdownDrainTimeoutMs` | integer | 1000          | `> 0`                            | Bounds shutdown/drain.                       |
| `migrationPolicy`        | enum    | APPLY_PENDING | `APPLY_PENDING`, `VALIDATE_ONLY` | Controls whether pending migrations apply.   |

Invalid options fail construction.

## Troubleshooting

| Symptom                       | Meaning / action                                                  |
| ----------------------------- | ----------------------------------------------------------------- |
| `DATABASE_CONNECTION_FAILED`  | Database/store unavailable; persistence is not ready.             |
| `SCHEMA_INCOMPATIBLE`         | Migration checksum/schema mismatch; stop and investigate.         |
| `MIGRATION_REQUIRED`          | Pending migration in validate-only mode.                          |
| `TRANSACTION_ROLLED_BACK`     | Operation failed atomically; no partial writes should remain.     |
| `TRANSACTION_TIMEOUT`         | Transaction exceeded timeout and was rolled back.                 |
| `NESTED_TRANSACTION_REJECTED` | Reuse transaction context; do not open independent nested writes. |
| `CONCURRENCY_CONFLICT`        | Stale expected version; reload and re-evaluate.                   |
| `DUPLICATE_RECORD`            | Unique identity already exists.                                   |
| Stuck outbox                  | Inspect pending/failed outbox counters and retry policy.          |
| Stale inbox claim             | Claim lease expired; processing can be recovered.                 |
| Dead letter                   | Investigate failure; replay explicitly only after remediation.    |
| Persistence degraded          | Disable state-mutating operations requiring durable guarantees.   |

## Backup and restore

Production PostgreSQL deployments must define backup frequency, encrypted backup storage, retention,
off-host copies, restore testing, RPO and RTO. Prompt 5 does not implement production backup
automation.

Permanent rule: a backup is not trusted until restore has been tested.
