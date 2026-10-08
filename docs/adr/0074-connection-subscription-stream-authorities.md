# ADR-0074 — Connection, Subscription and Stream Authorities

## Status

Proposed for independent Prompt 17 review

## Decision

Keep transport lifecycle, immutable session evidence, desired/applied subscriptions and stream
integrity distinct. Generation and abort fencing prevent stale callbacks and acknowledgements from
reviving current state.

## Consequences

Reconnect creates a new session and resubscribes deterministically. Unconfirmed applied state
remains uncertain; no implicit source switch exists.
