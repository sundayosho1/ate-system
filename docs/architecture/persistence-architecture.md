# Persistence Architecture

Prompt 5 establishes ATE's persistence and state authority foundation. It creates the patterns for
transactional state changes, immutable history, audit evidence, transactional outbox, durable inbox,
durable dead letters, migration discipline, diagnostics and runtime integration.

It does not implement market-data storage, account state, risk state, portfolio state, execution
state, MT5, broker reconciliation, APIs, frontend or live trading.

## Production technology direction

ADR-0003 selects PostgreSQL as the planned production persistence technology. Prompt 5 therefore
defines PostgreSQL-oriented schema namespaces and DDL expectations while keeping domain and event
packages free of database-driver dependencies.

The deterministic test adapter models transaction and recovery semantics without requiring a
developer's production database. It is not a production fallback.

Prompt 6 supplies persistence with an injected clock authority. State records, history, audit,
outbox claims, inbox leases and dead-letter replay metadata should derive timestamps from that
clock, not from ambient wall-clock calls.

Prompt 7 declares `configuration.controlplane` as the configuration control-plane state authority
for current managed configuration snapshots. Prompt 9 declares `configuration.versionhistory` as the
append-only immutable configuration history authority, including current-version pointer, lineage,
change sets, diffs and reconstruction metadata. Approval, promotion and operational rollback remain
future prompt scope.

## State authority rule

```text
ONE STATE DOMAIN -> ONE AUTHORITATIVE OWNER -> ONE CONTROLLED WRITE PATH
```

Caches, projections, event payloads, UI state and logs are not authoritative state.

## Transaction architecture

State mutations use an explicit transaction boundary:

```ts
transaction.execute(async (tx) => {
  // write current state
  // append history
  // append audit where relevant
  // append outbox event
});
```

All writes inside the transaction commit together or roll back together. Nested transactions are
prohibited in Prompt 5 to avoid accidental independent commits.

## Current state and history

Current state answers what ATE currently believes to be true. History answers how that state
changed. History is append-only; ordinary application APIs do not expose update/delete operations
for history or audit records.

## Optimistic concurrency

Mutable authoritative state uses expected-version writes. If another transaction has advanced the
version, stale writes fail with `CONCURRENCY_CONFLICT`; no silent last-write-wins behavior is
allowed.

## Transactional outbox

Committed state-change events are written to the outbox in the same transaction as the state/history
change. The event is dispatched only after commit:

```text
BEGIN
  STATE
  HISTORY
  AUDIT
  OUTBOX
COMMIT
DISPATCH OUTBOX -> @ate/events
```

This prevents publish-before-commit and database/event dual-write failure.

## Durable inbox

Subscribers can persist processing records keyed by:

```text
subscriptionId + idempotencyKey
```

This protects side effects across process restart and duplicate delivery. `PROCESSING` records use a
lease so stale claims can be recovered after abnormal termination. Lease instants are calculated
from the injected clock authority.

## Durable dead letters

Dead-letter records persist event identity, subscription, failure, attempts, correlation, causation,
runtime mode and replay metadata. Replay is explicit; it does not bypass idempotency or safety
controls.

## Migrations

Prompt 5 establishes one migration authority:

- ordered migration IDs;
- checksums;
- applied migration records;
- idempotent repeated invocation;
- checksum mismatch detection;
- no destructive auto-sync.

Startup readiness depends on schema compatibility.

## Environment isolation

Persistence instances are runtime-mode scoped. A `RESEARCH` persistence context cannot be used for
`LIVE` writes. `LIVE` is never a default fallback.

## Diagnostics

Persistence diagnostics expose safe operational state:

- state and runtime mode;
- database reachability;
- schema version and migration status;
- transaction counters;
- concurrency conflicts;
- pending/failed outbox;
- inbox duplicate suppressions;
- dead-letter count;
- recent redacted errors.

Credentials, connection strings and secret-like fields must be redacted.

## Backup and restore principle

Prompt 5 documents backup/restore requirements but does not implement production disaster recovery.
A backup is not trustworthy until restore has been tested. Future governance must define RPO and RTO
targets.
