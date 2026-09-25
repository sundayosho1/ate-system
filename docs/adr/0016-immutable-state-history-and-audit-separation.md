# ADR-0016 — Immutable State History and Audit Separation

## Status

Accepted

## Context

ATE needs to know both what the current state is and how meaningful actions changed state.

## Decision

Current state, state history and audit records remain separate concepts. History records describe
state transitions. Audit records describe meaningful actions and outcomes. Ordinary application APIs
do not expose update/delete operations for history or audit.

## Alternatives Considered

- Use logs as audit records: rejected because logs are operational diagnostics, not durable audit
  authority.
- Use event history as state history: rejected because events and authoritative state transitions
  are related but not identical.
- Mutable audit rows: rejected because ordinary edits weaken evidence.

## Consequences

- Corrections must be represented as new records rather than rewriting evidence.
- Future retention/archival policy can be governed separately.

## Security Impact

Audit records preserve actor/correlation/causation while avoiding credentials.

## Operational Impact

Troubleshooting can distinguish current state, transition history and audit evidence.

## Reversibility

Append-only discipline is hard to relax after production; this is intentionally conservative.
