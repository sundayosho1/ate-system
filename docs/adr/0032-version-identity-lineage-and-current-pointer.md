# ADR-0032 — Version Identity, Lineage and Current Pointer

## Status

Accepted

## Context

Configuration content identity is not the same as historical record identity. Two distinct
operations can intentionally produce equivalent configuration content.

## Decision

Configuration versions use stable version IDs, runtime-mode scoped stream IDs, explicit sequence,
parent version ID and optional derived-from version ID. The current pointer identifies the latest
version in a stream but does not replace immutable version records.

## Consequences

- Parentage is explicit and immutable.
- Historical derivation can reference older content without corrupting chronological lineage.
- Stale expected-parent writes are rejected instead of last-write-winning.
