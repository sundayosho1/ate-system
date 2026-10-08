# Deterministic market-data replay — development foundation

Prompt 19 is **IN PROGRESS / REMEDIATION REQUIRED**, not a released whole-system replay capability.
This help describes implemented primitives and their limits. No broker, order, strategy,
backtesting, paper trading or live trading capability is provided.

## Source and environment

Development branch: `codex/prompt-19-market-replay`, based on
`b69530ac75210e62780082034d90e8b1a0a18443`. Use Node >=22, npm >=10 and `npm ci`. `npm run verify`
is the formatting/lint/typecheck/test/secret/audit gate; there is no separate build script. The
application release stays at Prompt 18 until all Prompt 19 criteria are satisfied.

## Implemented workflow

1. Resolve immutable canonical fixtures, bounded historical pages or completed verified capture
   records. Historical reads check owner content fingerprint, page advancement and manifest
   stability; capture reads retain ingress/provenance and capture-only qualification. Quality
   reports and catalogue versions bind to the selected dataset. Trusted repository implementations
   remain mandatory.
2. Create an immutable specification with exact source, software, configuration, calendar and output
   identities. `createGovernedReplaySpecification` also binds DATA-owned `research.replay.*`
   settings to an effective configuration and rejects disabled replay.
3. Construct `ReplayController(specification, inputs, repository)` and await `initialize()`.
4. Use `stepEvent`, `stepTimestamp`, `runToTime` or `runToEnd`. Pause prevents automatic
   progression; explicit stepping while paused is allowed. Resume and stop are persisted lifecycle
   controls.
5. Request `snapshot(streamId, timeframes, includeIncomplete)` only at a completed timestamp
   boundary. Aggregate finality and eligibility remain Prompt 18 authorities. No end-of-input
   watermark is invented.
6. On RECOVERY_REQUIRED retain the repository root and operation identity. Repeated stop returns
   failure. A fresh controller revalidates source/specification and asks the repository to finish
   missing publication markers before restoring the full aggregation checkpoint. Do not delete
   uncertain evidence.

## Reproducible primitive example

The permanent `tests/market-replay/fixtures.ts` creates three quotes at UTC 10:00:00, 10:00:00 and
10:01:00 (Africa/Lagos 11:00:00, 11:00:00 and 11:01:00). The declared window is UTC 09:00–12:00. The
first `stepEvent` returns cursor 1 and `timestampComplete:false`; the second returns cursor 2 and
`timestampComplete:true`. A fresh controller recovered between those steps continues from cursor 1
and does not duplicate the first quote. Timestamp stepping and event stepping produce the same final
semantic fingerprint, tested in `controller.test.ts`.

Run `npx --no-install vitest run tests/market-replay` to reproduce the example and filesystem
faults. This is not the required two-provider/two-instrument end-to-end acceptance scenario, which
remains outstanding. Exact IDs are content-derived, not invented sample identifiers.

## Historical truth

VERIFIED_POINT_IN_TIME requires declared historical availability evidence; receivedAt alone does not
qualify historical research. EVENT_TIME_RECONSTRUCTION explicitly records UNKNOWN aggregate
availability while preserving original canonical receivedAt. Known publication, correction and
quality availability cannot be moved earlier in either mode. Unknown direct-quality availability is
rejected. Registry membership remains CURRENT_GOVERNED_CONTEXT, not historical membership authority.

## Configuration and bounds

All settings belong to DATA under the narrow `research.replay.*` alias. Defaults: enabled=false,
defaultMode=EVENT_TIME_RECONSTRUCTION, requireAvailabilityEvidence=true, failOnSourceGap=false,
orderingPolicy=AVAILABILITY_SOURCE_IDENTITY_V1. Changing a semantic setting requires a new
specification.

Numeric defaults/min/max are defined authoritatively in
`packages/configuration/src/replay-definitions.ts`: sessions, events/session, page/batch work,
pending tasks, snapshots, checkpoints, checkpoint bytes, input bytes, branches, comparison items,
evidence records and repository operations. Invalid ranges/cross-limit relationships fail closed.
Repositories reserve operation content, marker and temporary paths; lineage and authoritative
evidence are not silently evicted. Some controls are only primitive-level: complete runtime
admission, branch orchestration and aggregate input adapters are still outstanding.

## Errors and troubleshooting

SOURCE_CHANGED/integrity errors: preserve the selected inputs and compare their original
fingerprints; never silently substitute another dataset. AVAILABILITY_UNVERIFIED: choose explicit
reconstruction or provide genuine authority evidence. INCOMPLETE_TIMESTAMP_BOUNDARY: finish the
cohort before taking a snapshot. SNAPSHOT_REJECTED: inspect Prompt 18 finality/coverage/quality
eligibility; no finality is invented. RECOVERY_OBLIGATION: preserve files and initialize a fresh
controller with the identical specification. Capacity rejection requires a new governed
limit/session plan, not deletion of lineage.

Diagnostics expose lifecycle, logical time, cursor, remaining events and unresolved storage
operation. Branch-evidence construction and comparison helpers are prototypes, not a qualified
branch workflow. No historical source rescaling, native corrected-trade replacement, legacy lineage
migration or bitemporal registry implementation is provided.

## Qualification restrictions

F05 Windows execution/open handles/filesystem durability remain unverified. F06 synchronous capture
throughput and power-loss durability remain unqualified. T01 trusted implementation/certificates,
single writer and trusted root remain mandatory. Unknown consumer loss must remain conservatively
fenced; full asynchronous consumer integration is not yet qualified. Prompt 19 requires further
implementation and evidence before independent review. Prompt 20 is not started.
