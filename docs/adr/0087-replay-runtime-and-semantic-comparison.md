# ADR-0087: Governed replay admission and validated semantic comparison

Status: Implemented for bounded offline research; independent Prompt 19 acceptance pending.

Date: 2026-10-08 (Africa/Lagos)

## Context

Pure factories and self-hashed summaries cannot prove runtime/configuration authority integration or
explain a changed branch's research outputs. Operational process differences must not masquerade as
semantic divergence, while quality/continuity/lineage differences must remain visible.

## Decision

Use actual Prompt 3 managed runtime, Prompt 7/8 effective configuration, Prompt 5 derived state
registry, Prompt 4 event registry/factory/bus and Prompt 6 time. DATA owns replay settings; Prompt
18 owns material aggregation options/calendar/timeframes/edges. Admission validates both and detects
later fingerprint drift. Register data.replay.sessions and data.replay.control.v1 with read-only
market-data capability. Event publication obligations remain bounded and block successful shutdown.

Durable checkpoint histories own audit evidence. In-process event summaries remain volatile under
the existing event foundation; preserve envelopes for retry, re-announce recovered state, and do not
claim durable delivery of every intermediate summary.

Validate full checkpoints through the aggregate owner before comparison. Compare source/mode/
software/time/cursor/policy, revisions, quality/suppression, lineage, continuity, snapshots and
scheduled work. Exclude storage times, lifecycle/generation/operation IDs and nonsemantic loss
observation counters from output identity. Pending read evidence is not qualified comparison input.

EXPECTED_DIFFERENCE requires an immutable compatible fork and an independently reconstructed
child-policy reference agreeing with all derived output. Otherwise return IDENTICAL, explicit
UNEXPLAINED_DIVERGENCE or INCOMPARABLE. List differing semantic sections and changed declared
fields. Metadata-only legacy helpers cannot certify changed-policy equivalence or govern branch
creation.

## Alternatives considered

Trusting completion status or branch names was insufficient. Treating every configuration difference
as expected would hide defects. Treating all checkpoint/host metadata as semantic would reject valid
reproducibility. A new bus/state/configuration authority would weaken established boundaries.

## Consequences

Comparison is bounded and does not rank trading or research performance. Owner engine/repositories
remain trusted T01 ports. Historical registry membership remains CURRENT_GOVERNED_CONTEXT (M02).

## Security impact

No broker/network-provider/financial authority or capability is added. Canonical market data,
calendar, decimal arithmetic and quality scoring stay with their existing owners.

## Operational impact

No web service, production deployment or external event broker is required. Complete source and
fault evidence is reproducible offline; Windows/production durability remain unqualified.

## Reversibility

Preserve source/specification/checkpoint identities; create a separately governed reconstruction for
new policies. Never implicitly resume changed software/configuration or modify accepted history.

## CODEX-004B targeted remediation (acceptance pending)

CODEX-004A confirmed A19-H01 and A19-H02 at `97ace0e431b47cdbb51d838edc84189b0d22ea2d`. The original
audit failure remains historical evidence. All admission operations after acquiring the lock,
including pure controller construction, share a guaranteed cleanup guard. Readiness and health
include in-flight admission availability. Side-effect-free constructor rejection creates neither a
session nor a publication obligation. A STOP_REQUESTED cancellation without checkpoint content or
outstanding commitment removes only its provisional registration. Failures with checkpoint/recovery
or event publication obligations remain discoverable and continue to prevent false successful
shutdown. Synchronous repository callbacks and held verification cannot reenter admission or clear
an operation still in flight.

Comparison qualification applies to parent, child and independent reference: structurally/owner
valid, complete event cohort, no unresolved required channel-read evidence and no disqualifying
FAILED/STOPPING/RECOVERY_REQUIRED checkpoint lifecycle. The reference must also match the exact
child specification, full input identity, logical time and cursor. Pending reference evidence
returns INCOMPARABLE with REFERENCE_UNRESOLVED_READ_EVIDENCE, even when derived outputs match. After
the real read completes or recorded reconciliation closes it, ordinary reference agreement can
support EXPECTED_DIFFERENCE. Corrupt/missing evidence remains INCOMPARABLE. IDENTICAL and
UNEXPLAINED_DIVERGENCE retain their qualified semantic meaning.

Comparison accepts immutable checkpoints, not live controllers or storage ports. An old acknowledged
checkpoint cannot disclose a subsequent in-memory uncertain commitment; callers must obtain
participants through qualified owner/repository contracts. This is a T01 limitation, not
certification of arbitrary storage or a live session's admission availability.

## CODEX-004D provisional admission lifecycle (acceptance pending)

CODEX-004C audited `2468d596ecddeab3274951728be37ef5f0a55245` and confirmed HIGH A19-H01-R1: source
verification failed before repository access but left an empty FAILED controller registered,
blocking identity retry and shutdown. That failed audit remains historical.

The existing replay controller now records source verification status and repository provenance:
NOT_INITIATED, RECOVERY_IN_FLIGHT, RECOVERED_EMPTY, RECOVERED_CONTENT and WRITE_INITIATED. The
repository phase is set before invoking a repository operation. The disposal predicate requires
completed, failed source verification with no repository access, checkpoint or obligation.
STOP_REQUESTED cancellation may also use an honest empty recovery result before any write.
Repository access uncertainty, recovered content and attempted writes are never classified as
pre-repository source rejection solely because the checkpoint is null.

Runtime cleanup checks the exact controller identity and absence of pending control publication
while the admission lock is still held. It releases only the proven provisional registration.
Restored same-identity inputs undergo normal governed verification/admission; durable identity
conflicts are unchanged. Repeated shutdown succeeds for disposed failures, while genuine unresolved
commitments still block. No second state or persistence authority is added.

Disposed failure summaries retain session/specification identity, Prompt 6 timestamp, bounded
failure code and source/repository phase. This volatile diagnostic history is capped by the admitted
maxEvidenceRecords resource policy; eviction affects diagnostic samples only and is counted with a
saturated scalar. It never evicts authoritative checkpoint/read/publication obligations. Arbitrary
verifier text is not retained. Independent acceptance is still pending.

## CODEX-004F exception-safe initialization (acceptance pending)

CODEX-004E audited `eb9b54273f580d81610a84dd0f924a6b47dfe095` and failed HIGH A19-H01-R2: reading a
verifier rejection's message could throw before terminal failure classification. The registered
controller remained VALIDATING after the admission lock cleared, blocked identity retry and
shutdown, and falsely reported healthy/ready. The failed audit remains historical.

Initialization now establishes source-verification failure and authoritative FAILED or
RECOVERY_REQUIRED state before optional diagnostic extraction. A bounded normalizer performs at most
one guarded message read, accepts only a string matching the existing bounded uppercase-code format,
and otherwise uses UNCLASSIFIED_INITIALIZATION_FAILURE. It never coerces rejection values or retains
stacks/arbitrary text. Recognized code format is syntactic, not a separate error-code registry.

Runtime additionally contains an unexpected initialization rejection through the existing
controller. Only settled, proven provisional owners are disposed under the admission lock and
exact-identity check. A pure constructor followed by an exceptional exit before verification retains
NOT_STARTED provenance; no repository entry occurred. A verified source followed by a pure
pre-repository failure also retains VERIFIED/NOT_INITIATED provenance and may be disposed only when
settled with no checkpoint or obligation. Active work is not declared settled. Reentrant stop during
failure diagnostics may leave STOPPING, but failed/unstarted verification with NOT_INITIATED, no
checkpoint and no obligation still proves provisional disposal. Honest empty-recovery cancellation
retains its existing explicit certificate. Repository access, recovered content, attempted writes,
unknown/committed obligations and pending events are never cleared by exception text or null checks.

Optional disposed-admission sampling follows owner disposal. Sampling failure cannot replace the
public INITIALIZATION_FAILED result or block retry; failedAdmissionDiagnosticSamples counts failures
with a saturated scalar and no fabricated timestamp. Successfully retained samples and eviction
counts remain bounded by the governed policy; they are volatile diagnostics, not durable
certificates.

Readiness requires an acknowledged checkpoint, VERIFIED initialization, no controller work/read or
recovery obligation, and READY/RUNNING/PAUSED/STOPPED/COMPLETED controller state. A runtime that is
STOPPING/STOPPED is unavailable. CREATED/VALIDATING cannot be certified merely because the runtime
lock cleared. No second lifecycle, clock or persistence authority is introduced.

This is targeted remediation pending independent re-audit, not acceptance. F05/F06/T01/M02,
single-writer/trusted-root, offline scope and no Prompt 20/trading restrictions remain mandatory.

## Post-admission boundary exception safety — CODEX-004H

CODEX-004G audited `24d83df399a4cde76d668ddbd102d53dd46cd89a` and failed HIGH A19-H01-R3. After
normal admission, a real source revalidation failure could escape unsafe diagnostic extraction
before the replay boundary established FAILED. The acknowledged owner remained READY and was falsely
reported healthy. All twelve hostile-value probes and the three ordinary-error controls remain
preserved as historical evidence.

Post-admission finalization uses the existing controller authority, separately from provisional
initialization. It establishes FAILED, or retains RECOVERY_REQUIRED when controller state or a real
obligation requires it, before optional diagnostics. The shared private normalizer reads a message
at most once under a guard, accepts bounded string codes and performs no prototype inspection or
coercion. Initialization retains UNCLASSIFIED_INITIALIZATION_FAILURE; post-admission diagnostics use
UNCLASSIFIED_BOUNDARY_FAILURE. Neither fallback certifies storage outcomes. A reentrant getter's
stop request cannot replace the selected terminal failure; real obligations remain authoritative
after sampling. The existing finally paths release controller and runtime locks.

Event/timestamp stepping, run-to-time and bounded reconstruction return REPLAY_BOUNDARY_FAILED.
Snapshot source-verification failure retains SNAPSHOT_REJECTED but now finalizes the owner; ordinary
invalid snapshot requests after successful verification remain nonfatal. Read reconciliation source
failure returns structured SOURCE_VERIFICATION_FAILED instead of escaping its primary rejection,
while preserving pending-read evidence. Control and consumer-read source failures already have
structured terminal handling. Comparison validates immutable checkpoint evidence and does not own
controller lifecycle; no unsupported adjacent comparison defect is inferred or refactored.

An acknowledged session is never disposed as a provisional admission. Its previous checkpoint,
cursor, scheduler state, immutable input origin, content and publication markers remain intact when
source validation rejects before a new write. Real unknown/committed storage outcomes and runtime
control publication remain protected through their existing recovery contracts. Readiness/health use
the existing terminal state to fail closed, with no second lifecycle or configuration authority.

Restoring source bytes alone does not reset FAILED to READY. The failed owner blocks new replay
operations and retains its governed identity; repeated runtime stop reports unresolved failure.
Fresh trusted recovery must revalidate the original inputs and recover the acknowledged repository
state, then use normal governed operations. Pending reads still require actual recorded source
reconciliation. An earlier checkpoint remains valid evidence; it is not a certificate that a later
source check succeeded.

Remediation is pending independent re-audit and acceptance. Version, dependencies, upstream owners,
F05/F06/T01/M02, trusted-root/single-writer, offline research scope and Prompt 20 restrictions
remain.

The run-to-time and bounded-reconstruction wrappers also reject terminal failure/uncertainty before
returning an already-reached target. This prevents an unchanged checkpoint from being reported as a
successful operation by a failed owner. Stable completed/stopped idempotent reuse remains governed
by the existing contract; the new guard does not write or clear any obligation.

## Control-publication obligations — CODEX-004J

CODEX-004I authenticated `8d70bef74418551216b4c0f16a88055a5348a17d`, closed the R3 controller
correction technically, and failed HIGH A19-H01-R4. Configuration lookup preceded pending-summary
retention after a real acknowledgement; admission/event preparation could reject with false healthy
availability, and repeated stop could conceal the missed summary. Checkpoint bytes were valid.

The existing replay runtime retains a descriptor keyed by validated checkpointId immediately after
acknowledgement under its operation lock, before configuration/hashing/envelope/dispatch callbacks.
It holds the original immutable checkpoint and governed specification. The lock reserves a bounded
slot while owner work settles; if a command callback rejects or reports unsuccessful after actual
owner advancement, that last acknowledged checkpoint is retained before unlock. No acknowledgement
creates no entry. Storage UNKNOWN/COMMITTED outcomes remain controller/repository authority.

Capacity is qualified before requesting a new acknowledgement, using the minimum authenticated
maxEvidenceRecords of registered owners and the candidate specification. Normal admission/commands
exclude pending work. Shutdown may queue several bounded summaries, but defers untouched owners at
capacity. FIFO prevents later summaries overtaking an unresolved predecessor; none is evicted.

PENDING becomes PREPARING then PUBLISHING. Preparation or known publication rejection leaves FAILED.
A dispatch exception or unreadable outcome leaves UNCERTAIN, retaining any original cached envelope;
subsequent preparation failure cannot erase uncertainty. DELIVERED, ACCEPTED or DUPLICATE from the
existing bus discharges the descriptor. Event identity retains its original session/generation/
fingerprint formula; retry never replaces the checkpoint or cached envelope with later state.

Configuration capacity/identity is frozen from the authenticated specification, but publication and
retry still validate the current effective owner configuration against that specification. Transient
reader errors remain observable; invalid/drifted configuration retains the original obligation.
Readiness/health fail closed for pending/active work before another reader invocation. Retry holds
the runtime lock, follows insertion order and stops on first failure; diagnostics expose the
discharged prefix and remaining identities. Successful retries do not reset STOPPING to READY.

Shutdown refuses unresolved prior summaries; repeated stop cannot supersede them. Busy shutdown
requests cancellation through the existing controller authority without a second checkpoint write.
The narrowly added requestStop uses existing state/flags and is reused by busy controller stop. Only
actual discharge permits successful stop; legitimate fully discharged stop stays idempotent.

Control summaries remain volatile in-process evidence, not durable delivery of every intermediate
checkpoint or exactly-once subscriber delivery. Checkpoint history, configuration, clock, bus and
state authorities remain unchanged. This is fifth remediation pending independent re-audit and
acceptance; F05/F06/T01/M02, offline restrictions and no Prompt20 authorization remain.

## Full acknowledged-generation discovery — CODEX-004L

CODEX-004K failed the fifth remediation for HIGH A19-H01-R4-R1: a callback could fail after a real
pause/resume/stop acknowledgement while runtime discovery compared checkpointId alone. The
checkpoint contract intentionally excludes generation/state from this semantic ID; its full
fingerprint and existing storage operation identity distinguish acknowledged control generations.

The runtime now compares the same immutable owner's prior/current generation and full fingerprint.
Either change identifies a new actual acknowledgement without hashing, configuration, clock or
diagnostic callbacks before retention. Callback throw/unsuccessful outcomes are preserved; error
text cannot erase a real ACK or certify a new one. The controller alone installs currentCheckpoint
after actual acknowledgement. Genuine no-ACK, repeated same-ACK and honest unresolved storage
commitment do not create a new publication descriptor. Controller/checkpoint contracts are
unchanged.

The existing semantic pending-map key remains safe under runtime ownership: busy serialization
excludes reentrant work, pending publication rejects later admission/command before owner entry,
retry never advances the owner, and shutdown refuses prior pending summaries. Several shutdown
owners have distinct session-bearing semantic IDs. Reobserving one ACK after preparation failure
reuses its existing descriptor; supported consecutive same-ID control generations require discharge
between runtime operations and retain distinct existing event identities. No intermediate-summary
durable history or direct-owner bypass guarantee is added.

Permanent regressions use real governed ports/filesystem recovery and actual event payloads for
pause/resume/stop callback failures, same-ID cycles, capacity one, configuration/dispatch faults,
non-Error/getter/malformed outcomes, cancellation and honest UNKNOWN recovery. Prior R3/R4, FIFO,
cached envelope and uncertainty behavior remain. This is sixth implementation remediation pending
independent re-audit and separate acceptance; F05/F06/T01/M02 and no Prompt20 restrictions remain.
