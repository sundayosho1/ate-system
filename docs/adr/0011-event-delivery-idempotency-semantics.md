# ADR-0011 — Event Delivery and Idempotency Semantics

## Status

Accepted

## Context

ATE will eventually carry capital-bearing workflows where duplicate effects can be dangerous.
Exactly-once delivery cannot be honestly guaranteed by an in-process bus alone.

## Decision

Prompt 4 defines publication success as validation, acceptance, routing and known delivery outcomes
according to configured policy. The bus supports at-least-once-capable handler design with
subscriber-scoped idempotency: `subscriptionId + idempotencyKey`.

Duplicate event IDs are detected at publication. Concurrent duplicate idempotency keys for the same
subscription are skipped while processing is active or already succeeded. Retries are bounded and
interact with idempotency states so failed attempts are not mistaken for completed work.

## Alternatives Considered

- Claim exactly-once delivery: rejected as misleading without durable coordination and transactional
  state.
- Handler-only duplicate detection: rejected because common infrastructure should prevent obvious
  duplicate effects before side effects are attempted.
- Permanent in-memory processing records: rejected because long-running Windows VPS processes need
  bounded memory.

## Consequences

- ATE does not make a false exactly-once claim.
- Future durable inbox/outbox storage can replace the in-memory implementation.
- Handlers remain responsible for safe side effects when later prompts introduce persistence or
  capital-bearing commands.

## Security Impact

Delivery results and errors expose machine-readable status, IDs and safe messages only. They do not
dump arbitrary payloads or secrets.

## Operational Impact

Operators can distinguish success, duplicate skips, retryable failures, final failures, timeouts,
dead letters and retry exhaustion.

## Reversibility

The idempotency store is an interface-level concept with an in-memory Prompt 4 implementation.
Prompt 5 can replace it with durable inbox records without changing subscriber semantics.
