# ADR-0076 — Bounded Real-Time Integrity and Backpressure

## Status

Proposed for independent Prompt 17 review

## Decision

Use bounded raw, consumer, identity and evidence histories with explicit REJECT_NEWEST behavior.
Deduplicate only provider identity evidence; equal timestamps and prices alone are insufficient.

## Consequences

Loss, gaps, stale transitions and history evictions are observable. One slow consumer or failed
provider cannot block unrelated channels. Gap detection does not repair data.
