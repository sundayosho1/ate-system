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
