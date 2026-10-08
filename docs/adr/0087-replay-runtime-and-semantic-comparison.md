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
