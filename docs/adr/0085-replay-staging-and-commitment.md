# ADR-0085: Whole-system replay staging and commitment

Status: Implemented under CODEX-004R; independent Prompt 19 acceptance pending.

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

## Historical starting checkpoint and consequences

Single-writer trusted roots and repository implementations remain mandatory. This design does not
qualify Windows, power-loss durability or production throughput. Cross-session branch transactions,
full historical/capture/quality/catalogue fault qualification, runtime/state/event authority
registration and complete end-to-end acceptance evidence remain unfinished. Do not infer Prompt 19
completion from the passing primitive tests.

## CODEX-004R completion

The outstanding work above records the scope at starting checkpoint
`bd37a789e6ccac5ba6b7ab2e87a050581df40be1`. CODEX-004R completes durable branch orchestration,
actual asynchronous channel integration, actual source/quality/catalogue/runtime authorities,
aggregate adapters and the permanent full-system/fault evidence. See ADRs 0086–0087 and
[the completion evidence index](../development/prompt-19-completion-evidence.md). Implementation
completion does not grant independent acceptance or production qualification.
