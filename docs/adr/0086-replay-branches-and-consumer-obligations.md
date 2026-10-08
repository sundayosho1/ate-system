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

## CODEX-004B targeted remediation (acceptance pending)

CODEX-004A confirmed A19-M01 and A19-M02 at `97ace0e431b47cdbb51d838edc84189b0d22ea2d`. Preserve
that failed audit as historical evidence. The registry now reconstructs using the controller's
bounded event-processing boundaries, clipped to the exact fork time. It uses the same owner pipeline
and deterministic task phases; equal-time tasks and snapshots execute only after the entire cohort.
Public timestamp stepping still rejects an oversized cohort. Each event boundary retains the
immutable batch/resource limits and durable checkpoint contract. A partial private child is
recoverable but is not a published branch. Publication requires the exact parent cursor, fork time,
complete cohort and full input identity. An already PAUSED or COMPLETED complete fork does not
consume redundant resume/pause operations when recovering its missing branch marker, including at
exact repository capacity.

The reservation's input identity comes from the parent checkpoint, which commits the full immutable
manifest identity, source scope/origin and qualification context, not merely record content.
Creation checks supplied inputs against this identity before reservation, the controller revalidates
each reconstruction boundary, and publication revalidates the inputs and record. Record
reading/recovery validates this parent binding again. The parent checkpoint hash already commits
this identity in branch evidence; no incompatible format or schema migration is required. Identical
observations with different origins or qualification references are not configuration branches.
Trusted repository/honest-certificate and single-writer/trusted-root restrictions remain.
