# Deterministic market-data replay — offline research

Prompt 19 implements bounded whole-system replay at `0.19.0-market-replay.1`. Independent acceptance
is **PENDING**. Prompts 17 and 18 retain conditional acceptance; Windows, production throughput and
power-loss durability are unqualified. This is market-data research infrastructure; capture handoff
and replay completion do not qualify a dataset or approve trading.

## Environment and authoritative starting point

CODEX-004R uses `codex/prompt-19-completion`, starting at
`bd37a789e6ccac5ba6b7ab2e87a050581df40be1`, descended from released Prompt 18 governance
`b69530ac75210e62780082034d90e8b1a0a18443`. Inspect HEAD and the working tree before selecting an
assignment's exact source; never reset later work automatically. Node >=22 and npm >=10 are
required. Install the committed lockfile with `npm ci`. Packages export TypeScript sources;
`npm run typecheck` is the build validation and there is no separate application start/build script.

This cloud sandbox requires a writable npm cache:

```bash
cd /workspace/ate-system
export npm_config_cache=/tmp/ate-003C/npm-cache
npm ci
VITEST_MAX_WORKERS=2 npm run verify
npm audit
npm audit --omit=dev
npm ls --all
git diff --check
```

The worker setting bounds host concurrency; it does not skip tests or relax their
assertions/timeouts.

## Owner contracts and input selection

`resolveHistoricalReplayInputs` reads through Prompt 14 pagination, checks canonical schema
`prompt-13-market-observation-v1`, exact cardinality, unique observations, owner content
fingerprint, advancing cursors and before/after manifest stability. Optional Prompt 15 reports and
Prompt 16 versions must bind to that dataset/content and declared expected fingerprints. Full
bounded report and catalogue records participate in the input identity, so mutation cannot hide
behind an unchanged claimed fingerprint. Report generation time delays eligibility. Unknown
historical publication is not elevated to verified knowledge; imported receipt time alone is
insufficient.

`resolveCaptureReplayInputs` reads only completed, verified Prompt 17 captures through
`readRecords`. It retains ingress, subscription/source bindings, receipt/provenance and capture-only
qualification. It does not materialize or automatically register a qualified research dataset.

`resolveAggregateReplayInputs` asks the actual Prompt 18 engine to select committed revisions under
an explicit snapshot cutoff. Require exact expected revision IDs, source/stream/calendar context,
owner read consistency and publication/commit/computation ordering. `canonicalBar` supplies bounded
quality and correction lineage; replay does not calculate OHLC or rescore quality. The engine and
repositories are trusted owner implementations, not untrusted revision resolvers.

`createReplayInputManifest` binds canonical observations to explicit scopes, source/calendar,
quality references, content and origin evidence. `immutableReplayInputs` combines sources in
canonical order and retains their verification callback. Every advancing/control command re-verifies
inputs. VERIFIED_POINT_IN_TIME requires justified availability; EVENT_TIME_RECONSTRUCTION preserves
UNKNOWN availability. Both modes honor known publication, correction and quality times. No mode
conversion or historical registry membership is inferred.

## Governed runtime and playback

Register the existing replay and multi-timeframe configuration definitions/schemas through Prompt
7/8, resolve an effective RESEARCH configuration, and enable both DATA-owned replay and aggregation.
`createGovernedReplaySpecification` verifies replay settings, complete effective fingerprint and the
Prompt 18 owner's options/material policy. Arbitrary aggregation changes under the same governed
configuration are rejected. No new configuration authority is introduced.

`ReplayRuntimeService` receives existing Clock, effective-configuration provider,
StateAuthorityRegistry, EventRegistry, EventFactory and InternalEventBus.
`buildReplayResearchRuntime` delegates to Prompt 3; only DEVELOPMENT/RESEARCH/SIMULATION and
MARKET_DATA_READ are supported. Initialization registers DERIVED state `data.replay.sessions` and
`data.replay.control.v1`; financial authorities are absent. `admit(rawSpec, inputs, repository)`
validates enablement, context, identity and session capacity before initialization. Commands run
through `service.command(sessionId, controller => ...)`; configuration fingerprint drift rejects
advancement. Diagnostics and managed health/readiness retain failure and recovery/publication
obligations. A stopped service cannot admit more sessions.

The checkpoint history is the durable audit authority. Event summaries use the existing in-process
bus, which remains volatile; retries retain the original envelope/identity within the process.
Failed publication blocks further admission/commands and successful shutdown. `retryControlEvents()`
retries bounded pending summaries. Fresh admission revalidates/re-announces the recovered
checkpoint; it does not claim durable bus delivery of every prior summary. Preserve the immutable
checkpoint audit history.

`ReplayController` supports:

| Command                          | Meaning                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| `initialize()`                   | Verify sources, recover identical specification or publish initial state.                    |
| `stepEvent()`                    | Process one eligible event; equal-time cohorts may remain incomplete.                        |
| `stepTimestamp()`                | Process a bounded complete equal-time cohort and due tasks.                                  |
| `runToTime(utc)`                 | Advance only forward to an explicit boundary.                                                |
| `runToEnd()`                     | Finish declared end and all event/task/publication/read obligations.                         |
| `pause()` / `resume()`           | Persist lifecycle; pause during dispatch settles at the atomic boundary.                     |
| `snapshot(streamId, timeframes)` | Publish point-in-time selection only after a complete cohort.                                |
| `stop()`                         | Persist STOPPED only when no unresolved work/commitment exists; repeated stop is idempotent. |

Explicit stepping while paused is permitted; automatic running is rejected. A window ending or
exhausting input does not invent completeness, continuity, finality or end-of-stream evidence. Task
ordering is event cohort, fence/loss, watermark, publication, snapshot; inherited acknowledged
channel history runs after original same-time tasks. Prompt 6 clocks and scheduler own time.
Cancellation/dispatch failure stops the private scheduler, leaves the prior durable cursor/tasks
intact and cannot publish partially executed staging output.

## Worked multi-provider example and observed evidence

`tests/market-replay/acceptance-fixture.ts` defines two instruments and two independent providers,
four streams and M1/M5/M15/H1/H4. Prompt 14 imports every canonical observation; Prompt 15 produces
real bounded quality reports and Prompt 16 registers their dataset versions. Fixture publication
certificates explicitly model known offline publication times; they are not evidence about a live
market provider's historical delivery or cross-provider chronology. Missing sequence evidence stays
SYNTHETIC_UNCERTAIN. A crossed quote's report reference survives replay aggregation.

The scenario publishes prior H4/H1/M15 windows, delays M15 finality, introduces a source
gap/reconnect, reads an actual capacity-one Prompt 17 ConsumerChannel (overflow conservatively
fences all four streams), pauses, recovers a fresh controller and reconstructs a configuration
branch. It compares recovered output with two uninterrupted equivalent runs in both replay modes. A
separate actual Prompt 17 service/capture integration test uses two ScriptedAdapters and four
subscriptions with a shared reader; three rejected deliveries remain explicit. No commercial
connector is involved.

| UTC cutoff | Africa/Lagos | Required observed selection                                               |
| ---------- | ------------ | ------------------------------------------------------------------------- |
| 10:14:59   | 11:14:59     | Prior closed H4 `[04:00,08:00)`, H1 `[09:00,10:00)`, M15 `[09:45,10:00)`. |
| 10:15:00   | 11:15:00     | Same M15; elapsed time does not invent publication.                       |
| 10:15:05   | 11:15:05     | M15 `[10:00,10:15)` first final/available at this boundary.               |
| 10:30:00   | 11:30:00     | Gap/reconnect cannot create a complete successor.                         |
| 11:00:00   | 12:00:00     | Prior H1 remains selected.                                                |
| 11:00:05   | 12:00:05     | Newly published incomplete H1 is excluded from complete selection.        |
| 11:00:06   | 12:00:06     | Late correction revises old H1; M15 remains the later closed window.      |

`original-cutoffs.test.ts` separately replays the unchanged authoritative Prompt 18 fixture and
compares exact revision IDs, availability, finality and state with the actual original aggregation
runtime. It also rejects an expired finalized correction after fresh recovery.

Generate exact content-derived event, cursor, revision, snapshot, checkpoint and branch evidence:

```bash
mkdir -p /tmp/ate-replay-evidence
ATE_REPLAY_EVIDENCE_DIR=/tmp/ate-replay-evidence VITEST_MAX_WORKERS=2 npx vitest run tests/market-replay/acceptance.test.ts tests/market-replay/original-cutoffs.test.ts
```

This writes `acceptance-VERIFIED_POINT_IN_TIME.json`, `acceptance-EVENT_TIME_RECONSTRUCTION.json`
and `original-cutoffs.json`. They contain complete actual checkpoint/selection evidence and
comparisons, not invented example IDs. Keep generated research evidence outside the source checkout.
`reproducibility.test.ts` also varies owner page size, batch/event stepping, pause/restart, host
promise delays and storage publication clocks.

## Asynchronous consumer recovery

`observeConsumerChannel(channel, artifactId, limit)` observes the actual Prompt 17 queue before and
after `await channel.read()`. The channel is an integrity side-channel for immutable recorded
inputs; its drained records cannot acknowledge or duplicate the source-manifest cursor.
Unrecorded/future observations reject admission. Never use this API as a live dynamic replay source.

An all-stream durable fence and CHANNEL_READ_PENDING precede the await. Capacity-one overflow,
discard-on-close, degradation and unknown scope cannot establish supported finality. A failed
initial guard means the channel was never read/admitted; the current runtime retains an
unacknowledged admission obligation and cannot stop successfully. After a durable guard,
interruption or failed loss publication remains discoverable on fresh recovery. Repeated stop cannot
conceal it.

Recovery may replay explicit recorded WATERMARK authority evidence, then call
`reconcileConsumerRead(readIdentity)`. All affected streams must be continuous at/after the read and
match actually executed immutable source reconciliation tasks. No local clock advance alone clears
an obligation. A new process must re-admit any external channel rather than assuming an unwritten
attempt was durable; the external source/capture and trusted repository contract remain mandatory.

## Branch lifecycle and comparison

Choose a complete verified parent checkpoint with no pending read/storage work. Construct a desired
child specification and call `completeReplayBranchSpecification(parentCp, parentSpec, desired)`: it
includes acknowledged parent channel-read fences/losses in the immutable reconstruction plan.
Omitting that plan is rejected; changing configuration cannot silently heal source loss.

`FilesystemReplayBranchRegistry.fork` reserves an immutable record, reconstructs the child from the
same input origin under its own policy/namespace, then atomically publishes a separate marker.
`forkGoverned` additionally validates the child's actual effective configuration. Parent
checkpoints, source history and files are not written. Source/scopes/calendar/mode/software must
remain compatible; changes to derived policy are explicit. Child session IDs cannot be reused for
competing branches. `adoptVerifiedBranch` admits a recovered branch through its corresponding
governed runtime.

Retain branchId after UNKNOWN_COMMITMENT. A fresh registry's `recover(branchId, inputs)` finishes
reservation/child/publication stages and validates the exact marked child operation. Repeated
retries are idempotent. Unknown partial/corrupt artifacts remain present and fail closed; do not
erase them to force recovery. Only marked children appear in `records()`.

`compareReplayCheckpoints` validates both full checkpoints with their Prompt 18 owner state. It
compares configuration/calendar/source/mode/time/cursor, revisions, lineage, quality/suppression,
continuity, snapshots and scheduled work. Storage times, lifecycle/checkpoint generation and
nonsemantic operation/diagnostic counters are separated. Missing/corrupt/unfinished evidence or
incompatible contexts are INCOMPARABLE. Equal qualified outputs are IDENTICAL; equivalent policy
with changed output is UNEXPLAINED_DIVERGENCE. EXPECTED_DIFFERENCE requires the immutable fork and
an independently reconstructed child-policy reference that explains every output difference. No
classification ranks financial performance. Legacy metadata-only comparison cannot certify a policy
difference; legacy `recordBranch` rejects ungoverned parent mutation.

## Configuration guide and capacity

Every `research.replay.*` key is DATA-owned under the narrow replay alias, SYSTEM/ENVIRONMENT scope,
fail-closed, with RESTART reload. Resolve a new fingerprint after any change. Semantically changed
sessions cannot resume old storage; use a validated reconstructed branch. Software identity changes
have no migration policy here and reject resume. Material aggregation options/calendar/timeframes/
edges come from Prompt 18's existing `data.multitimeframe.*` authorities.

| Setting suffix                | Default                         | Effect and risk                                                          |
| ----------------------------- | ------------------------------- | ------------------------------------------------------------------------ |
| `enabled`                     | false                           | Explicit offline replay enablement; grants no trading capability.        |
| `defaultMode`                 | EVENT_TIME_RECONSTRUCTION       | Explicit knowledge classification; verified mode requires real evidence. |
| `requireAvailabilityEvidence` | true                            | Verified mode cannot disable this control.                               |
| `failOnSourceGap`             | false                           | Continue fenced research, or fail at a recorded source gap.              |
| `orderingPolicy`              | AVAILABILITY_SOURCE_IDENTITY_V1 | Stable synthetic ordering; does not assert unknowable market chronology. |

Numeric limits and their declared units:

| Suffix                    | Default  | Min–max       | Unit / enforcement                                                |
| ------------------------- | -------- | ------------- | ----------------------------------------------------------------- |
| `maxSessions`             | 16       | 1–128         | Bound independent replay session namespaces.                      |
| `maxEventsPerSession`     | 10000    | 1–100000      | Bound immutable input snapshot events.                            |
| `maxEventsPerBatch`       | 64       | 1–1000        | Bound processing work per public batch; operational only.         |
| `maxPendingTasks`         | 256      | 1–5000        | Bound stable scheduled task descriptors.                          |
| `maxSnapshots`            | 64       | 1–1000        | Bound immutable snapshots; reject rather than evict.              |
| `maxCheckpoints`          | 4096     | 1–20000       | Bound operation records per session, including lifecycle records. |
| `maxCheckpointBytes`      | 10485760 | 4096–67108864 | Bound complete whole-system checkpoint parsing and writing.       |
| `maxInputBytes`           | 16777216 | 4096–67108864 | Bound canonical input snapshot parsing.                           |
| `maxBranches`             | 16       | 1–128         | Bound recorded immutable children per session.                    |
| `maxComparisonItems`      | 2048     | 1–10000       | Bound comparison evidence, snapshots and revisions.               |
| `maxEvidenceRecords`      | 2048     | 1–10000       | Bound authoritative replay evidence; no eviction.                 |
| `maxRepositoryOperations` | 8192     | 1–20000       | Reserve operation content, marker and temporary paths.            |

Events/batch cannot exceed events/session; checkpoints cannot exceed reserved repository operation
slots. Each operation reserves content/marker/temporary artifacts. Bounds reject new work, never
silently evict acknowledged checkpoints, lineage, snapshots or evidence. Storage/canonical-input
parsing is byte-bounded, descriptor queues bounded, registry namespace paths content-addressed and
symlinks/hardlinks rejected. Capacity increases require a new governed plan; deleting evidence is
not remediation.

## Errors, diagnostics and limitations

Inspect `diagnostics()` for state, cursor/time, remaining events, last structured boundary-failure
code, pending read count and retained operation/commitment; runtime adds admission and control-event
obligations. SOURCE_CHANGED / HISTORICAL_SOURCE_CHANGED: restore the exact selected source or select
an explicitly new specification. AVAILABILITY_UNVERIFIED: supply justified evidence or explicitly
choose reconstruction. INCOMPLETE_TIMESTAMP_BOUNDARY: finish the cohort. SNAPSHOT_REJECTED: inspect
the owner finality/quality/coverage reason. RECOVERY_OBLIGATION / CHANNEL_RECOVERY_OBLIGATION:
preserve the root and follow exact-source recovery/reconciliation. GOVERNED_*_MISMATCH: resolve the
real effective configuration rather than supplying an invented fingerprint. Capacity failure: retain
old state and plan a governed new session. Never retry incompatible software/configuration as if it
were the same session.

F05: Windows execution/open handles/filesystem durability remain unverified. F06: synchronous
capture throughput and power-loss durability remain unqualified. T01: trusted owner/repository
implementations and honest commitment certificates, one writer and trusted root are mandatory;
arbitrary hostile implementations are not certified. M02: registry membership is
CURRENT_GOVERNED_CONTEXT, not a bitemporal historical registry. Bounded quality handoff and
conservative consumer-loss fencing remain mandatory. Legacy lineage/corrected-trade migration and
automatic dataset research qualification are unsupported. No broker, financial execution, production
deployment or Prompt 20 implementation is provided. Independent acceptance of Prompt 19 remains
pending.

## CODEX-004B remediation boundaries

The failed CODEX-004A audit identified admission lock leakage, unfinished reference qualification,
batch-one branch reconstruction and substituted source origin. Targeted corrections are pending
independent re-audit; Prompt 19 is not accepted and Prompt 20 is not authorized.

Admission rejection releases its transient lock; it does not create a session when construction
fails. Admission in flight is NOT_READY/DEGRADED. Real uncertain commitments and control-event
publication obligations remain visible and block shutdown. Retry/recovery must use existing owner
contracts; repeated stop is not evidence deletion.

The registry reconstructs a configuration child using bounded event steps through the exact fork
time. Equal-time snapshots/tasks wait for cohort completion. Oversized explicit timestamp steps
still reject. Partial reconstruction remains private behind the reservation; fresh recovery resumes
acknowledged work and publishes a complete fork. Completed PAUSED/COMPLETED forks can publish their
missing marker at exact capacity without redundant control operations. Limits are never raised.

Supply the exact full parent inputs for creation and recovery. Keeping observation prices, content
hash or manifest ID while changing source origin or qualification context is rejected, even when
configuration is the only declared policy change. Reference comparison requires a complete,
qualified checkpoint at the child boundary. Held reads return INCOMPARABLE with a specific reason;
only actual completion/reconciliation permits explanatory comparison. Live RAM/storage obligations
are not inferred from an old checkpoint. Trusted owners/repository certificates remain mandatory.

Offline bounded research only. F05 Windows qualification, F06 production throughput/power-loss
durability, T01 trusted repositories/honest certificates and single-writer/trusted-root, and M02
current governed registry context remain limitations. No broker, execution, production trading or
full historical registry membership claim is implied.

## Provisional source-verification rejection — CODEX-004D

If source verification rejects before repository access, the empty provisional admission is
released. Restore the immutable source and retry the same governed identity normally; validation is
not bypassed. Readiness/health reflect actual admission availability and remaining obligations. A
disposed rejection cannot block repeated clean shutdown. In-flight admissions still exclude
concurrent/reentrant identity registration, including during asynchronous verification/shutdown.

Diagnostics expose sourceVerification and repositoryPhase for registered controllers, plus bounded
disposedAdmissions and evictedAdmissionDiagnostics summaries for safely released admissions. These
summaries are volatile diagnostic samples, not durable sessions or recovery certificates. Their
retention is bounded by maxEvidenceRecords; authoritative obligations remain separate and cannot be
erased through diagnostic eviction. Unclassified verifier messages are reduced to a bounded code. A
null checkpoint does not prove safety: repository access uncertainty, recovered content, write
attempts and pending publications remain governed by existing recovery/stop contracts.

The failed CODEX-004C admission audit and prior failures remain historical evidence. CODEX-004D is
targeted remediation only, pending independent re-audit/acceptance. Version, F05/F06/T01/M02,
single-writer/trusted-root, offline-only scope and no Prompt 20/trading restrictions are unchanged.

## Exception-safe admission — CODEX-004F

Verifier rejection values may be ordinary errors, primitives, proxies or malformed message values.
Admission completes its authoritative failure transition before extracting optional diagnostics. The
public rejection remains INITIALIZATION_FAILED; bounded diagnostics retain a format-valid code from
a single guarded message read or UNCLASSIFIED_INITIALIZATION_FAILURE. Arbitrary text, stacks and
implicit coercion are not used. A diagnostic failure is not evidence of an uncertain repository
write.

After a proven pre-repository failure, restore the original immutable source and retry the same
identity through normal governed admission. Pure construction followed by an unexpected
initialization exit may similarly release its settled provisional owner. No source validation is
bypassed. Reentrant shutdown remains truthful; active owner work cannot be disposed until settled.
Real recovery/write uncertainty, recovered content and pending control publication retain their
existing fresh-recovery and reconciliation requirements, even with a null checkpoint.

READY/HEALTHY requires a verified initialized checkpoint, an allowed controller state and no active
controller work or recovery/read/control-publication obligation. A registered CREATED/VALIDATING
controller is unavailable even if the runtime admission lock is clear. A disposed source rejection
leaves an otherwise available empty runtime healthy; STOPPING/STOPPED runtime remains unavailable.

Disposed admission summaries are optional volatile evidence. failedAdmissionDiagnosticSamples counts
sampling failures; evictedAdmissionDiagnostics counts actual sample eviction. Neither counter proves
recovery or modifies durable obligations. A failed clock sample is omitted rather than given an
invented timestamp. Successfully retained summaries remain immutable and bounded.

CODEX-004E's failed audit remains historical; CODEX-004F is remediation pending independent
re-audit, not Prompt 19 acceptance. F05/F06/T01/M02, trusted-root/single-writer, bounded quality,
explicit source-loss reconciliation, offline scope and no live/broker/trading/production/Prompt-20
restrictions remain.

## Post-admission source failure — CODEX-004H

An admitted session owns durable evidence. If later source revalidation fails during replay, the
controller enters FAILED (or retains a genuine RECOVERY_REQUIRED obligation) before examining the
optional rejection message. stepEvent, stepTimestamp, runToTime and reconstructToTime return
REPLAY_BOUNDARY_FAILED. Hostile getters, proxies and primitive messages cannot escape as diagnostic
errors or leave the owner healthy. A single guarded read yields a bounded code or
UNCLASSIFIED_BOUNDARY_FAILURE. Initialization retains its original diagnostic fallback and public
INITIALIZATION_FAILED result.

Snapshot source failure returns SNAPSHOT_REJECTED with terminal failure; an ordinary invalid
snapshot request after successful source verification remains nonfatal. Read-reconciliation source
failure returns SOURCE_VERIFICATION_FAILED and retains unresolved read evidence. These paths use the
existing controller authority. A reentrant diagnostic shutdown cannot replace terminal failure with
a healthy state; operation locks release through their existing finally paths.

Readiness becomes NOT_READY and health DEGRADED. Previous acknowledged checkpoints, cursor/time,
scheduler descriptors, immutable source lineage and durable content/markers remain preserved when
validation rejects before any new repository operation. The registered identity is retained; it is
not an empty provisional admission. Existing unknown/committed storage and runtime control
publication obligations cannot be cleared by an error code, empty directory or null new
acknowledgement.

Restore the original immutable source and perform fresh trusted recovery through the existing owner
contract. Restoring bytes does not reset a failed controller to READY. New commands remain rejected,
and repeated shutdown cannot conceal failure. Fresh recovery validates existing acknowledged
content; pending reads and undelivered control events still require their actual
reconciliation/retry.

CODEX-004G's failed audit and all earlier histories remain intact. CODEX-004H is remediation pending
independent re-audit, not acceptance. F05/F06/T01/M02, bounded quality/correction/source-loss rules,
trusted-root/single-writer, offline scope and no broker/trading/production/Prompt 20 approval
remain.

The run-to-time and bounded-reconstruction wrappers also reject terminal failure/uncertainty before
returning an already-reached target. This prevents an unchanged checkpoint from being reported as a
successful operation by a failed owner. Stable completed/stopped idempotent reuse remains governed
by the existing contract; the new guard does not write or clear any obligation.

## Control-publication recovery — CODEX-004J

Inspect runtime diagnostics.controlPublications for original session/checkpoint/generation,
configurationFingerprint, phase and uncertainty. No acknowledgement means no entry. PENDING denotes
retained acknowledged work; PREPARING and PUBLISHING are active attempts; FAILED retains known
unsuccessful preparation/publication; UNCERTAIN retains possible dispatch effects. A successful
DELIVERED/ACCEPTED/DUPLICATE acknowledgement removes the entry. These are existing runtime
publication obligations, not a new durable storage authority.

The descriptor is retained immediately after acknowledgement before configuration/envelope work.
Original governed specification limits qualify capacity before new checkpoint work; the minimum
registered-owner maxEvidenceRecords bounds the queue. At capacity, shutdown defers other owners
without advancing their checkpoints. Later summaries cannot overtake the unresolved first entry.
Admission and new commands reject while publication is pending. A callback that rejects after real
owner advancement still leaves its actual last checkpoint pending; do not infer rollback from a
rejected Promise or unsuccessful command result.

Restore the original valid governed configuration/owner service and call retryControlEvents(). Retry
is serialized, FIFO, and stops on the first failure; inspect remaining identities after partial
success. Another reader/preparation failure retains the same descriptor. Current configuration must
validate against the original specification; a later valid but different revision is not a
substitute. Cached envelopes keep their original identity/timestamp/provenance. Ambiguous dispatch
may have reached subscribers; supported duplicate acknowledgement can settle retry, but universal
exactly-once subscriber delivery is not promised. Retry does not write or recover checkpoint
storage.

Readiness is NOT_READY and health DEGRADED for pending/active publication. Outside these guards,
configuration/clock observation errors remain observable. Repeated shutdown fails while a prior
summary is pending; retry must genuinely discharge it before normal stop can complete. Retry does
not reset a STOPPING runtime to READY. Busy shutdown requests controller cancellation without a
second checkpoint write; a settled acknowledged owner follows normal stop/recovery. Genuine
UNKNOWN_COMMITMENT and pending source/read work require their existing trusted recovery contracts.

In-process summaries remain volatile; fresh trusted startup re-announces recovered state rather than
claiming durable delivery of every intermediate summary. F05 Windows and F06 throughput/power loss
remain unqualified. T01 trusted honest ports/root/single-writer and M02 current-registry context
remain mandatory. Fifth remediation is pending independent re-audit/acceptance. No production,
trading, broker, live feed, financial or Prompt20 authorization is granted.
