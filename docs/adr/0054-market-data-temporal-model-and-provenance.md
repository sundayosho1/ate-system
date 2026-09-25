# ADR-0054 — Market Data Temporal Model and Provenance

## Status

Accepted

## Context

Market-data observations need reproducible interpretation across providers, ingestion delays,
broker/server time, replay and derived datasets. Prompt 6 already established UTC timestamp
validation and clock authority boundaries.

## Decision

Prompt 13 distinguishes `eventTime`, `receivedAt` and optional `sourceTime`. Timestamp precision and
source timezone metadata are preserved where supplied. Provenance records source, provider symbol,
source observation ID, source schema version, sequence scope, origin, delivery mode, transformation
evidence, dataset reference and bounded metadata.

## Consequences

- Late, out-of-order and future event times remain representable evidence.
- Clock skew and latency are not silently rewritten.
- Prompt 15 can assess quality using preserved evidence.
- Prompt 19 can replay delivery without erasing original provenance.
