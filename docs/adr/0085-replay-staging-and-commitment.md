# ADR-0085: Whole-system replay staging and commitment

Status: Implementation in progress; Prompt 19 acceptance pending.

Date: 2026-10-08

## Context

Replaying into a separately published aggregation repository before advancing the durable input
cursor could duplicate effects after interruption. Existing aggregation startup also fences
continuity, which cannot silently change an exactly restored replay session.

## Decision

Use Prompt 6 `VirtualClock` in REPLAY mode and `DeterministicScheduler`. Stage a fresh Prompt 18
engine from its complete validated owner checkpoint at the exact saved logical time. Ordinary
aggregation recovery retains its existing continuity fence. Publish aggregation history, input
cursor, pending task descriptors and snapshots in one replay checkpoint transaction.

Owner `ingestReplay` preserves canonical receipt/publication facts. Explicit event-time
reconstruction records UNKNOWN availability; known publication and quality evidence still delay
eligibility. Verified mode requires explicit source evidence. No OHLC, decimal, calendar, quality
scoring or canonical market-data authority is implemented in the replay package.

Before calling storage, retain an unknown commitment obligation. Only a trusted no-write certificate
may clear it without publication. Synchronous exceptions and reentrant stop during
commit/publication leave RECOVERY_REQUIRED. Repeated stop cannot certify success while it remains.
Content and marker times belong to the injected storage clock; replay-derived aggregate timestamps
belong to the virtual clock and do not certify historical ATE publication.

## Consequences and outstanding work

Single-writer trusted roots and repository implementations remain mandatory. This design does not
qualify Windows, power-loss durability or production throughput. Cross-session branch transactions,
full historical/capture/quality/catalogue fault qualification, runtime/state/event authority
registration and complete end-to-end acceptance evidence remain unfinished. Do not infer Prompt 19
completion from the passing primitive tests.
