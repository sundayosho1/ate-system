# ADR-0086: Durable replay branches and asynchronous integrity obligations

Status: Implemented for bounded offline research; independent Prompt 19 acceptance pending.

Date: 2026-10-08 (Africa/Lagos)

## Context

A metadata-only branch cannot establish child recovery or preserve source loss when changed policy
requires reconstruction. Actual Prompt 17 channels can lose data during an asynchronous read.
Failure before or after persistence cannot be converted into successful shutdown.

## Decision

Publish an immutable branch reservation containing the verified parent checkpoint/specification,
child specification, source identity and lineage. Reconstruct under a private child namespace;
acknowledge the branch only after an atomic publication marker references an exact published child
operation. Never write parent history. Retry/fresh recovery validates source, record, child and
marker.

Guard actual channel reads with a durable all-stream fence and read identity before awaiting them.
Observe the real queue before and after await; do not substitute a counter descriptor for reading
the channel. It is an integrity side-channel for immutable inputs, not a live source-cursor
authority. Interrupted/persistence-failed reads require explicit recorded source reconciliation.
Failed initial guard retains a runtime admission obligation and does not drain the channel.

Changed-policy reconstruction explicitly includes acknowledged parent read fences and loss facts in
its immutable task plan. They execute after the original same-time tasks, preserving the admission
boundary. Missing plans reject branch creation. A changed configuration never repairs loss by
itself.

## Alternatives considered

Appending branch metadata to parent state was insufficient and could mutate parent history. Copying
parent derived aggregates under another policy was incompatible. Looking only at pre-read counters
missed await-time loss. Automatically deleting uncertain artifacts could erase committed work.

## Consequences

Partial unknown artifacts may require operator-authorized repair; evidence remains discoverable and
no false success is returned. Branches/read evidence have explicit capacity limits and never evict
acknowledged history. Guarding a read conservatively fences even when later no loss is observed;
continuity must be restored through the source owner. No implicit software migration is supported.

## Security impact

Trusted implementations/honest commitment certificates, one writer and trusted root are mandatory
(T01). Paths are content-addressed, parsing bounded, unsafe symlinks/hardlinks rejected. A test hook
is a trusted fault-injection port, not authority for arbitrary storage mutation.

## Operational impact

Windows/open-handle behavior (F05), throughput and power-loss durability (F06) are unqualified.
Publication/recovery use injected clocks; no filesystem fsync claim implies production durability.

## Reversibility

Retain immutable manifests/checkpoints and branch reservations. A new specification may reconstruct
under a separately authorized policy; never rewrite accepted histories or erase uncertain artifacts.
