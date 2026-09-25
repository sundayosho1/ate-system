# State Authority

Prompt 5 establishes the state authority model for ATE.

## Source-of-truth hierarchy

| Category                     | Meaning                                                                  |
| ---------------------------- | ------------------------------------------------------------------------ |
| Authoritative State          | Canonical persisted state owned by one responsible domain/service.       |
| External Authoritative State | State ultimately owned by an external system, observed by ATE.           |
| Derived State                | Calculated from authoritative information.                               |
| Projection                   | Read-optimized representation derived from authoritative records/events. |
| Cache                        | Temporary performance optimization.                                      |
| Snapshot                     | Point-in-time representation.                                            |
| Event                        | Fact that occurred; not automatically current state.                     |
| Audit History                | Immutable evidence of meaningful actions or state changes.               |

## Permanent rules

1. No state mutation without an owner.
2. No authoritative state without a declared source.
3. No stale write silently overwrites newer state.
4. No committed state transition loses required history.
5. No required event is published before state commit.
6. No duplicate event creates duplicate durable effect.
7. No cache becomes authoritative.
8. No projection becomes write authority.
9. No ordinary application mutation rewrites audit/history.
10. No runtime restart erases required durable processing state.
11. No `LIVE` state silently falls back to ephemeral persistence.
12. No environment crosses state authority boundaries.

## Implemented state authority matrix

| State                         | Authority            | Durable | Mutable                                      | History     | Reconciliation           |
| ----------------------------- | -------------------- | ------: | -------------------------------------------- | ----------- | ------------------------ |
| Reference state               | `@ate/persistence`   |     Yes | Expected-version                             | Append-only | No                       |
| State history                 | `@ate/persistence`   |     Yes | No ordinary mutation                         | Native      | No                       |
| Audit records                 | `@ate/persistence`   |     Yes | No ordinary mutation                         | Native      | No                       |
| Transactional outbox          | `@ate/persistence`   |     Yes | Lifecycle only                               | State field | Event bus                |
| Inbox processing              | `@ate/persistence`   |     Yes | Lifecycle only                               | State field | Subscriber               |
| Durable dead letters          | `@ate/persistence`   |     Yes | Replay metadata only                         | Native      | Operator                 |
| Runtime lifecycle             | `@ate/runtime`       | Limited | Yes                                          | Operational | No                       |
| Event delivery memory         | `@ate/events`        |      No | Yes                                          | Diagnostics | Persistence outbox/inbox |
| Configuration current state   | `@ate/configuration` |     Yes | Atomic publication                           | Required    | No                       |
| Configuration version history | `@ate/configuration` |     Yes | Append-only records; mutable current pointer | Native      | No                       |
| Capability-control state      | `@ate/configuration` |     Yes | Atomic snapshot publication                  | Required    | No                       |

Reference state is a non-trading test/reference domain used to verify persistence semantics. It is
not a trading account, instrument registry, risk state, portfolio state or execution state.

## Future external authority principles

- Market prices originate from providers/brokers/exchanges and require source/observation metadata.
- Broker orders and positions ultimately require MT5/broker reconciliation.
- Internal risk state will be owned by the future Risk Engine.
- Portfolio state will be owned by the future Portfolio Engine.
- Current managed configuration is owned by the configuration control plane.
- Configuration schema validation is owned by the configuration schema authority.
- Immutable configuration history is owned by the configuration version-history authority.
- Feature flags and effective capability state are owned by the configuration capability-control
  authority.
- Future approved/promoted configuration workflows will reference these authorities without
  replacing them.

These domains are not implemented in Prompt 5.

## Events, history and audit

Events describe occurrences. State history records authoritative state transitions. Audit records
explain who or what caused meaningful actions. They may reference one another through event ID,
correlation ID and causation ID, but they are not interchangeable sources of truth.

## Cache/projection rule

Cache loss must not imply authoritative-state loss. Projections and read models may be rebuilt from
authoritative records and events. If cache/projection data disagrees with authoritative state,
authority wins unless a future reconciliation rule says otherwise.
