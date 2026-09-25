# Event Architecture

Prompt 4 establishes ATE's internal event architecture. It is an in-process communication layer for
application, domain, integration, audit and operational facts. It does not implement trading logic,
market-data ingestion, persistence, MT5, external brokers, or a distributed message broker.

## Event vs command

An event is a fact that already happened, such as `runtime.service.started.v1`. A command is a
request for something to happen, such as a future `order.submit.requested.v1`. Prompt 4 implements
event publication and delivery only. Capital-bearing commands will require stronger authorization,
acknowledgement, reconciliation, durable idempotency and audit controls in later prompts.

Events do not grant authority. A strategy or candidate event can never bypass Risk, Portfolio,
Capital Protection, Account Mandate, Execution Safety or explicit execution eligibility.

## Taxonomy

| Category    | Meaning                                                               |
| ----------- | --------------------------------------------------------------------- |
| DOMAIN      | Meaningful business/domain fact.                                      |
| APPLICATION | Application workflow fact within ATE.                                 |
| INTEGRATION | Fact intended to cross an adapter or external-system boundary later.  |
| AUDIT       | Governance/security/administrative fact requiring traceability later. |
| OPERATIONAL | Runtime, health, lifecycle, infrastructure or delivery behavior.      |

## Naming and versioning

Event names use:

```text
<bounded-context>.<subject>.<fact>.v<major>
```

Names are lowercase, stable, descriptive and versioned. Incompatible schema or semantic changes use
a new major event name, such as `candidate.created.v2`. Deprecated versions remain explicit in the
registry until removed through a governed migration.

## Canonical envelope

`@ate/events` reuses Prompt 2's `EventEnvelope`. Prompt 6 makes the event factory consume an
injected clock so `eventTimestamp` comes from the runtime clock authority. Every `ATEEvent` carries
the canonical envelope and adds non-authoritative delivery metadata beside it:

- `eventId` identifies the occurrence globally;
- `eventType` and `schemaVersion` identify the contract;
- `eventTimestamp` records occurrence time;
- `runtimeMode` preserves environment isolation;
- `source` and `actor` identify producer context without credentials;
- `correlationId` connects a workflow;
- `causationId` points to the immediate parent event when one exists;
- `payload` contains the registered fact payload.

The side metadata supports idempotency keys, ordering keys, causation depth, priority, sensitivity
classification and extensible provenance. Metadata does not replace the canonical envelope.

## Correlation, causation and evidence

Correlation connects a broader workflow. Causation identifies the immediate triggering parent.
Evidence/reference relationships are different: a future master decision may reference several
candidates and portfolio snapshots without making all of them immediate parents. Prompt 4 provides
root and child event factory paths, chain reconstruction from available records and practical safety
checks for self-causation and excessive causation depth.

## Registry and validation

The event registry is fail-closed. Publishing an unregistered event or invalid payload is rejected
before routing. Runtime validation checks:

1. canonical envelope structure;
2. registered event type;
3. event type/version compatibility;
4. registered payload schema;
5. basic causation and size limits.

Compile-time typing assists handler payloads where TypeScript can infer them, but runtime validation
remains authoritative for incoming values.

## Bus semantics

The initial bus is an in-process asynchronous event bus. A successful `publish()` means the event
was valid, accepted, routed and delivery outcomes were collected according to current policy. Prompt
4 does not claim exactly-once delivery. Handlers must be designed for at-least-once-capable,
idempotent processing.

Subscriptions have stable IDs, exact event type routing, optional category routing, subscriber
identity, criticality and bounded delivery policy. Multiple subscribers receive immutable event
views. One subscriber failure is reported without corrupting unrelated subscribers.

## Idempotency

Idempotency is subscriber scoped: `subscriptionId + idempotencyKey`. The default idempotency key is
the event ID, and publishers may provide a domain-specific key for future operations. The in-memory
store is bounded and records processing states such as processing, succeeded, retryable failure and
final failure. It is not durable across process restart; Prompt 5 may replace it with an inbox
store.

## Ordering

The bus does not promise global ordering. Subscriptions may request per-key serialization. Events
with the same ordering key are delivered sequentially to that subscription; unrelated keys may
progress independently. Sequence numbers are not invented by the bus.

## Backpressure and resource bounds

The bus has bounded pending events, bounded concurrency, bounded idempotency memory, bounded
dead-letter memory, bounded diagnostic history, handler timeouts and event-size limits. The default
backpressure policy rejects new work visibly on saturation; Prompt 4 never silently drops events.

## Retry, poison events and dead letters

Retries are bounded. Non-retryable failures do not waste retry attempts. Poison events that exhaust
retry policy can be recorded in the in-memory dead-letter facility with event identity,
subscription, attempts, correlation, causation, subscriber identity and failure reason. Dead
lettering is visible in diagnostics and can degrade health. Replay is explicit and preserves event
identity and correlation/causation; it is not automatic.

## Runtime integration and lifecycle bridge

The event bus can run as an `@ate/runtime` managed service. It participates in startup, health,
readiness and graceful shutdown/drain. Lifecycle records from Prompt 3 can be represented as
`runtime.lifecycle.recorded.v1` after bootstrap. The bus does not rely on itself to report startup.

Handler timeouts and delivery durations remain event-bus infrastructure behavior. Event occurrence
timestamps and delivery error timestamps come from the injected clock.

## Control plane vs market data plane

Prompt 4 builds the application/domain event plane: decisions, state transitions, lifecycle facts,
alerts, execution outcomes, reconciliation outcomes, analytics and research facts. High-volume raw
tick/quote/bars transport may require a separate market-data plane. Future integration can bridge
important market facts into events without forcing every tick through this bus.

## Security and sensitivity

Events and diagnostics must not contain passwords, API keys, broker passwords, access tokens,
private keys or database credentials. Actors and provenance identify systems; they do not carry
secrets. Prompt 4 includes a sensitivity metadata hook (`PUBLIC`, `INTERNAL`, `SENSITIVE`) but does
not implement full data-loss prevention.

## Persistence integration

Prompt 5 adds the persistence/state authority foundation:

- transactional outbox for state changes plus required event publication;
- durable inbox/idempotency records for subscriber effects;
- durable dead-letter records;
- audit/state history foundations.

Current state authority does not come from in-memory events. Events describe occurrences;
persistence/state authority decides durable current truth, history and audit evidence.

## Configuration integration

Prompt 7 adds safe configuration event registrations for snapshot publication, resolution failure
and source degradation. Configuration events carry snapshot IDs, fingerprints, source health and
safe metadata only. They must not dump full configuration values or secret material into event
payloads. Events do not become configuration authority.
