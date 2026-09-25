# Event Architecture Help

## Overview

`@ate/events` provides ATE's internal event bus, registry, routing, idempotency, retry, dead-letter
and diagnostics foundation. It transports facts between components without granting trading
authority.

## Workflow

```text
CREATE EVENT
VALIDATE ENVELOPE + PAYLOAD
ROUTE TO SUBSCRIPTIONS
DELIVER WITH IDEMPOTENCY / ORDERING / TIMEOUT / RETRY
COLLECT RESULTS
UPDATE DIAGNOSTICS / DEAD LETTERS
```

## Event vs command

Events describe facts that happened. Commands request actions. Future capital-bearing commands must
include authorization, durable idempotency, acknowledgement, reconciliation and audit. Do not use an
event as a shortcut to execution.

## Event categories

- `DOMAIN`: meaningful domain fact.
- `APPLICATION`: internal application workflow fact.
- `INTEGRATION`: fact intended to cross an adapter boundary later.
- `AUDIT`: governance/security/administrative trace fact.
- `OPERATIONAL`: lifecycle, health, runtime or infrastructure fact.

## Envelope fields

Events reuse the Prompt 2 envelope:

- event ID: globally unique event occurrence;
- event type/version: stable contract identity;
- timestamp: occurrence time;
- source and actor: producer context without secrets;
- correlation ID: broader workflow;
- causation ID: immediate parent event;
- runtime mode: DEVELOPMENT, RESEARCH, BACKTEST, SIMULATION, PAPER or LIVE;
- payload: schema-validated fact data.

## Naming and versioning

Use `<bounded-context>.<subject>.<fact>.v<major>`, for example `runtime.service.started.v1`.
Breaking changes require a new major version.

## Correlation and causation

Root events generate or accept a correlation ID and have no causation ID. Child events preserve the
parent correlation ID and set causation to the parent event ID. Causation is not a full evidence
graph; additional evidence belongs in payload references when future contracts support it.

## Idempotency

The default idempotency key is the event ID. Subscribers may use domain-specific keys later.
Duplicate protection is scoped to each subscription, so processing by subscriber A does not mark
subscriber B complete.

## Ordering

Global ordering is not promised. A subscription can request per-key ordering with metadata such as
`instrument:<id>` or `account:<id>`. Events sharing a key are serialized for that subscription.

## Subscriptions and routing

Subscriptions declare stable IDs, event types, optional categories, subscriber identity,
criticality, delivery policy and handler. Exact event type routing is the default. Category routing
is supported but should be used deliberately.

## Retries and dead letters

Retries are bounded and never infinite. Retryable failures may be retried according to policy.
Non-retryable failures stop immediately. Events that exhaust retries can be placed in the in-memory
dead-letter facility. Replay is an explicit operator/test action and preserves original identity.

## Backpressure

The bus rejects new publications when configured capacity is exhausted. This is intentional: silent
dropping could hide protection, execution or audit facts in future prompts.

## Health and readiness

Health reports whether the bus is functioning. Readiness reports whether it is safe to accept and
deliver work. The bus may be alive but not ready during drain, stop or saturation.

## Configuration help

Prompt 4 options are typed construction options. Prompt 7 will become the configuration authority.

| Option                    | Type    | Default    | Valid range  | Operational impact / safety implication                              |
| ------------------------- | ------- | ---------- | ------------ | -------------------------------------------------------------------- |
| `maxPendingEvents`        | integer | 100        | `> 0`        | Bounds accepted in-process work; saturation rejects new publication. |
| `maxPendingPerSubscriber` | integer | 25         | `> 0`        | Reserved per-subscriber bound for future queue specialization.       |
| `maxConcurrentDeliveries` | integer | 8          | `> 0`        | Prevents handler fan-out from consuming unlimited resources.         |
| `handlerTimeoutMs`        | integer | 1000       | `> 0`        | Prevents indefinite handler blocking.                                |
| `drainTimeoutMs`          | integer | 1000       | `> 0`        | Bounds graceful shutdown drain.                                      |
| `maximumRetries`          | integer | 3          | `> 0`        | Prevents infinite retry loops.                                       |
| `retryDelayMs`            | integer | 0          | `>= 0`       | Delay between retries when policy enables retry.                     |
| `maximumCausationDepth`   | integer | 16         | `>= 0`       | Stops recursive event storms and accidental cycles.                  |
| `idempotencyRetention`    | integer | 1000       | `> 0`        | Bounds duplicate tracking memory; not durable.                       |
| `deadLetterCapacity`      | integer | 100        | `> 0`        | Bounds in-memory dead-letter records.                                |
| `diagnosticRetention`     | integer | 100        | `> 0`        | Bounds recent error/delivery diagnostic memory.                      |
| `backpressurePolicy`      | enum    | REJECT_NEW | `REJECT_NEW` | Fail visibly on saturation; no silent drop.                          |
| `eventSizeLimitBytes`     | integer | 32768      | `> 0`        | Events should carry facts/references, not large binary payloads.     |

Invalid options fail construction instead of being silently repaired.

## Troubleshooting

| Symptom                     | Likely cause                            | Operator/developer action                                       |
| --------------------------- | --------------------------------------- | --------------------------------------------------------------- |
| `EVENT_TYPE_UNREGISTERED`   | Event type missing from registry.       | Register contract and schema before publication.                |
| `EVENT_SCHEMA_INVALID`      | Payload/name/version/size invalid.      | Check event type, version and Zod payload schema.               |
| `EVENT_ENVELOPE_INVALID`    | Prompt 2 envelope contract failed.      | Check IDs, timestamp, actor, source and runtime mode.           |
| `EVENT_DUPLICATE`           | Same event ID was published again.      | Treat as already accepted/processed unless replay is intended.  |
| `HANDLER_FAILED`            | Subscriber returned/threw failure.      | Inspect subscription result and safe error message.             |
| `HANDLER_TIMEOUT`           | Handler exceeded timeout.               | Make handler cancellable or adjust bounded policy deliberately. |
| `QUEUE_SATURATED`           | Bus capacity exhausted.                 | Reduce publisher rate, fix slow handlers, or resize safely.     |
| Dead letter count increases | Poison event or repeated failure.       | Investigate record; replay only after cause is addressed.       |
| `CAUSATION_DEPTH_EXCEEDED`  | Recursive/cyclic publication.           | Break event loop or raise limit only with justification.        |
| Readiness is `NOT_READY`    | Draining, stopped, saturated or failed. | Stop publication and inspect topology/diagnostics.              |

## Related features

- Core domain contracts: `docs/architecture/core-domain-contracts.md`
- Runtime lifecycle: `docs/architecture/application-runtime.md`
- Event architecture: `docs/architecture/event-architecture.md`

## Audit information

Prompt 4 creates event facts and in-memory diagnostics only. Durable audit authority, event
persistence and transactional outbox/inbox patterns are future Prompt 5+ scope.
