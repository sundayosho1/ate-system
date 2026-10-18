# Offline adaptive surveillance attention

`@ate/mose-attention` owns computational attention assessments and recommendations. It does not own
scanner schedules, market observations, opportunities, ranking or phase-wide surveillance
reconciliation. No attention tier is a signal, profitability assessment or permission to trade.
Prompt28–30 functionality is absent, marked UNSUPPORTED; no fabricated opportunity states.

## Setup and governed configuration

Use the accepted configuration registry/resolver and `attentionConfigurationDefinitions(clock)` /
`attentionConfigurationSchemas(clock)`, alongside the accepted scanner definitions. Register
`attentionStateOwnership()` with the accepted `StateAuthorityRegistry`; inject actual
P25/P26/P24/P19 evidence ports and a P27 repository. RESEARCH mode and accepted
VIRTUAL/REPLAY/SIMULATION clock provenance required. Configuration fingerprint and policy bind
immutable recovery; hot policy migration is unsupported and rejected. Applicable
maker-checker/role/promotion authority stays with existing configuration and owner contracts, not a
P27 substitute. Never fabricate an actor or issuer.

Key `surveillance.attention.policyJson` contains `defaultAttentionPolicy` plus governed
version/effectiveAt and a session accounting anchor. Scanner policy/plan keys must resolve through
the same supplied effective configuration and match the installed accepted P26 plan before optional
requests. Configure through existing accepted owners, not by editing their source. Example base
policy:

```typescript
const policy = {
  ...defaultAttentionPolicy,
  version: "attention.v1",
  effectiveAt: governedEffectiveAt,
  anchor: governedSessionAnchor,
  submissionEnabled: false,
  dispatchEnabled: false,
  actor: null,
};
```

Defaults: epoch60000ms; tiers MINIMAL/LOW/STANDARD/ELEVATED/HIGH with weights1/2/4/6/8; healthy
initial STANDARD. Two consecutive changed qualified epochs raise one tier, two verified unchanged
epochs lower one; cooldown2 epochs, expiry3. Missing epochs/unknown evidence break confirmation;
exact evidence reuse earns no change. Expired or unverified assessments cannot grant submission.
Ticks use NOT_APPLICABLE finality; bar evidence requires genuine P18 FINAL/complete/as-known
revisions. Source records and observation availability/processing knowledge must precede assessment
cutoff; no future H4/regime/late correction contamination.

## Commands and examples

`initialize()` validates configuration/domain ownership and bounded immutable history. All mutation
uses `dispatch(command)` or `dispatchJson(JSON.stringify(command))` with the same strict
discriminated schema.

```typescript
await runtime.dispatch({ kind: "START", id: "start" });
await runtime.dispatch({
  kind: "ASSESS",
  id: "assess-1",
  subject,
  asOf: clock.now(),
});
await runtime.dispatch({
  kind: "ALLOCATE",
  id: "allocate-1",
  asOf: clock.now(),
  limit: 16,
});
```

A subject binds sessionId, exact universe fingerprint, canonical instrument and installed
subscription IDs. It is not a broker symbol. ASSESS/ALLOCATE never create P26 work. Allocation
journals preserve epoch quota, exact older floor debt, capped credits, rotor and bonus accrual. A
reserved recommendation is not settled floor service. At most one genuine eligible receipt settles
its own bound floor; multi-obligation settlement is prohibited. COALESCED/SKIPPED/cache reuse is not
automatically fresh floor service. Actual evaluation/observation completion remains separate from
admission.

Optional `SUBMIT` requires explicitly enabled governed policy, current qualified evidence, lawful
configured mode/boundary/cause and actor authority. P27 supports direct SECONDS/SCHEDULE grid
requests or TRIGGER RESEARCH_RESCAN; it never changes installed cadence, priorities, anchor or plan.
For TRIGGER the actor must be in the accepted allowlist **and match universe checker**. No
auto-authorized actor, default actor or new approval engine. Event/finality/timeframe direct
submission is unsupported in this version.

```typescript
await runtime.dispatch({
  kind: "SUBMIT",
  id: "submit-1",
  recommendationId,
});
await runtime.dispatch({
  kind: "RECONCILE",
  id: "reconcile-1",
  recommendationId,
});
```

Preview is only evidence, not publication. Before request a P27 intent journals exact
RequestId/trigger/payload. If P26 accepts but P27 outcome fails, reconcile the original request
rather than resubmit with a new ID. Exact duplicate command returns original acknowledgement;
altered payload same ID conflicts. Proven NONE may release its floor credit under the fixed
algorithm, never reset proposal quota or rotor; UNKNOWN retains reservation/debt. Repeated
allocation IDs, retries, membership/policy changes and restart cannot mint budget or priority.

`EXECUTE_ADMITTED` is a separate explicitly enabled command, never a hidden assessment effect. It
invokes accepted P26 bounded dispatch and records actual complete returned child results; a batch
can service earlier admitted work, not just this caller. Genuine partial upstream effects are
retained. An uncertain dispatch execution remains fail-closed in its own execution journal; there is
no safe automatic assertion of no effect from P26's non-atomic batch. Such unresolved execution
requires separately supported owner evidence/research reconciliation; it cannot be erased by restart
or STOP. No generic cancellation/timeout-as-NONE promise.

## Resources, fairness and consistency

Default caps: instruments32, subjects128, proposals32/epoch, per-instrument boost8, credit
cap4epochs, owner calls64/command, assessments16/batch ceiling (current commands assess one), one
outstanding own publication, one submission/command, dispatch16 limited further by actual P26
policy. Input64KiB/depth20, evidence refs64, history/recovery512, checkpoint1MiB, retained64MiB,
queries100/page and16pages, retries2/epoch, dependencies128/edges256. Current implemented policies
permit only bounds at or below approved caps. The capped credit does not delete exact debt. Full
history rejects new input rather than prunes obligations. P26/P25 own caps remain in force; no
silent increases.

Finite floor demand beyond capacity is unserved debt, not a smaller approved universe. Logical
tokens/avoided repeated work are not measured CPU savings. Old unrepresented epochs are not invented
observations or retroactively proven eligible populations. The allocation ledger covers explicitly
assessed governed epochs; absence of historical membership evidence remains unknown.

A26-Q01 remains OPEN: fair proposal rotation does not guarantee P26 admission, especially with
advancing time, persistent lexical-first failure, shared-root uncertainty or insufficient capacity.
Use finite fixed-cutoff research drivers where supported, inspect child Results/debt, reconcile
failures and explicitly serve legal healthy peers where permitted. Never blindly retry indefinitely
or claim all subscribers globally served.

A26C-L01 remains OPEN: P26 `nextOffset` is based on work and can be null while requests remain. P27
uses `totalRequests` with explicit offsets, independent of work count, and bounds pagination/calls.
Counts alone cannot prove a concurrent snapshot or receipt absence. `readBarrier.withRead` is an
injected trusted offline single-writer composition contract: the caller must actually prevent
relevant writers for the whole callback; an arbitrary label or matching totals is no proof. It is
not a P26 lock or generation-pinned query API. Absent/unestablished consistency yields
CONSISTENCY_UNESTABLISHED and no complete floor allocation claim; exact found immutable receipt can
still prove existence, never missing-record noncommitment. No raw private owner state reads.

## Read/report/lifecycle and recovery

`query(offset, limit)` returns P27 recorded state/history only; `queryHistory(asOf, offset, limit)`
labels historical scope. `diagnostics()`, `health()` and `help()` distinguish lifecycle/readiness,
evidence expiry, own pending publication, upstream submission/dispatch uncertainty, exact floor debt
and settlement. A known zero denominator differs from unknown null; P27 never reports phase coverage
complete. Historical tier/ACK is not current eligibility/readiness/source authenticity.

PAUSE/RESUME/STOP are journaled P27 commands. `stop()` is local service shutdown and does not stop
P25/P26 or erase their debt. Reentrant busy/uncertain shutdown returns failure/recovery required;
repeated stop cannot conceal it. `reconcilePublication()` only reconciles an exact physically
read-back own UNKNOWN body/generation/fingerprint; it cannot clear uncertainty from absence alone.
Recovery checks full chain, schema, policy/config, command deltas, credits/receipts and preserved
history. Unknown schema, corruption or incompatible configuration fails closed; no automatic
migration.

Memory and filesystem repositories store P27 domain only. Trusted root/honest terminating
owners/repos/single writer are mandatory. Immutable exclusive publication/readback is not fsync or
power-loss certification. Windows/open-handle behavior, production throughput/durability, timing
reproducibility and organizationally independent certification remain unqualified. All accepted
Prompt25/26 qualification schedules remain binding, including negative provenance/current authority,
current registry context and ACK/compound-operation distinctions. Submission/dispatch disabled by
default. No live data/broker/trading/financial execution/production permission.

### Current authority and publication lineage

A current eligibility assessment must be evaluated at the captured P27 clock time. A stale
previously successful native result cannot grant current authority. Policy/configuration evidence
resolved after a requested assessment cutoff is rejected. Trusted composition must keep the clock
and approval-authority resolver coherent; replay reproducibility does not replace current authority.

Observation evidence binds the exact acknowledged P25 history checkpoint (runtime, generation and
full fingerprint), record fingerprint, complete source-plan lineage and replay input fingerprint.
Selected-source readiness is checked on its exact session/universe/instrument tuple. An unrelated
unavailable peer does not erase a healthy source's evidence, and remains unresolved for aggregate
coverage. Recorded global owner health and selected-source health are distinct. Assessment records
include producer/version, reason codes, effective time and cooldown boundary. A trusted read barrier
remains necessary to claim cross-owner consistency; these fields do not provide a global lock.

### Outcome-integrity remediation (CODEX-013B; acceptance pending)

`maxAttemptRetries=2` means **two total scanner submission attempts**, including the initial call.
The persisted sum is keyed by the original floor obligation, whose identity already binds its
instrument/session/universe and epoch. New recommendation or ALLOCATE IDs, NONE refunds,
pause/resume and repeated recovery cannot reset it. `OBLIGATION_RETRY_EXHAUSTED` rejects before
another scanner call. A discretionary proposal without a floor retains its own bounded
recommendation allowance; this does not create a second entitlement against an existing floor.
Proposal quota and refundable floor credit remain separate accounts. Exact unserved debt remains
after exhaustion; no later receipt implicitly coalesces it. Hot policy/configuration migration
remains unsupported and rejected.

Every submitted intent records its original command identity. Its outcome stores either the full
selected native scanner receipt, the exact structured negative commitment, or explicit uncertainty.
A native success must supply the complete trigger, valid disposition, reason string and workKey
(string or null). Required fields are captured once; arrays, inherited and null-prototype structural
representations are permitted. Unrelated metadata does not become authority. Invalid payloads or
getters retain the original intent as UNCERTAIN/UNRESOLVED; no new RequestId retry or false floor
settlement is permitted. Fingerprints refer to the canonical selected contract fields.

Recovery derives the exact lawful status, attempt, reservation, credit and settlement changes from
the predecessor and recorded outcome. It does not copy balances from a resulting snapshot. NONE
refunds precisely one reserved floor credit, UNKNOWN retains it, and only qualifying exact receipts
settle the original obligation. COALESCED/SKIPPED and other nonservice dispositions remain recorded
RECOMMENDATION_ONLY receipts with their actual disposition; they do not imply fresh service.

ACK histories additionally require bounded public scanner receipt readback. A self-consistent local
hash chain cannot authenticate an invented external publication. Exact found immutable receipts
prove existence; missing pages, absent records or unavailable owner evidence never prove NONE.
`RECEIPT_EVIDENCE_UNESTABLISHED`, `RECEIPT_IDENTITY_CONFLICT`, `OUTCOME_DELTA_INTEGRITY` and
`OUTCOME_EVIDENCE_MISSING` fence recovery without deleting or rewriting journals. Owner availability
and the existing query/page/call budgets therefore constrain recovery. Legacy outcome histories
without the required complete evidence are readable as repository artifacts but are not silently
migrated into operational authority. No arbitrary historical ACK is re-certified.

If STOP races a callback, STOPPING may prevent the local outcome publication even when the callback
returned NONE. The durable original intent then remains unresolved. Do not infer noncommitment from
absence, reset the RequestId or treat local knowledge as durable evidence. Use supported exact
readback/reconciliation; if no accepted owner proof exists, keep the service fenced. A failed
initialization also prevents successful shutdown from concealing the invalid recovery state. All
F05/F06/T01, current-versus-historical authority, A26-Q01 and A26C-L01 restrictions still apply.

A qualifying live scanner ACK is also checked against exact immutable public request readback; a
structurally valid invented callback value cannot settle debt without that publication evidence.
Optional dispatch outcomes retain their original command/batch limit and validate the accepted
public work-result shape. A negative or malformed batch response remains UNRESOLVED, even when one
inner operation reports NONE. There is still no supported automatic reconciliation of uncertain
whole batches and no batch-wide cancellation/noncommitment certificate. No new dispatch authority is
added.

### Bounded receipt pages (CODEX-013D; acceptance pending)

SUBMIT, RECONCILE and initialization use the same complete-page validation. Each public Result and
its selected `requests` / `totalRequests` fields are captured before receipt authority is used. A
page must contain an array, at most the requested number of receipts, and exactly the slice length
implied by the explicit offset, requested size and total. Totals must be safe nonnegative integers
within the accepted scanner request cap and remain consistent across pages. All records on a page
must be valid, with no duplicate/conflicting RequestId within or across pages, even when the desired
receipt appears first. Oversized pages are rejected, never truncated. Native structural receipt
fields are snapshotted once; raw array iterators and unrelated metadata do not supply authority.
Selected canonical page bytes/depth remain bounded by the configured checkpoint/input limits.

`RECEIPT_PAGE_BOUNDS` identifies an oversized page; `INVALID_RECEIPT_PAGE` identifies an invalid
page/array representation. `CONSISTENCY_UNESTABLISHED`, `ENUMERATION_INCOMPLETE`, `INPUT_BOUNDS` and
`INPUT_DEPTH` fence inconsistent totals, incomplete/duplicate pages and excessive selected evidence.
The public P26 work-only `nextOffset` is still not a receipt cursor: use explicit offsets and
`totalRequests`. P26 does not return a receipt-offset field; the requested offset is generated and
validated by P27. Unrelated metadata cannot redefine that offset or authorize completeness.

After malformed readback, SUBMIT retains its original durable intent as an acknowledged local
UNRESOLVED outcome. RECONCILE does not publish a settlement, and failed recovery remains fenced. An
empty or missing page never proves noncommitment. Reconcile the original RequestId after restoring
honest owner access; do not allocate a replacement ID to bypass uncertainty. Genuine receipt
existence alone does not establish that the evidence was obtained within the governed verification
budget. A receipt beyond the final permitted page remains unresolved. Within unchanged limits and
immutable source state, a genuinely accepted receipt must remain verifiable on honest recovery.

For investigation, retain the exact P27 predecessor/outcome and original RequestId, inspect the
requested offset/size, actual page length/total, duplicate identities and selected evidence limits,
then verify public P26 evidence through supported interfaces. Restore the owner and use a fresh
service after failed recovery/STOPPING. Do not rewrite checkpoints, suppress errors or increase
budgets to declare success. These checks add no owner timeout/cancellation guarantee: synchronous
owner faults or unsupported Promise-shaped query responses remain uncertain, and honest terminating
owners remain required by T01. Uncertain optional batches still have no automatic noncommitment
certificate. All previous qualifications, resource defaults and offline-only restrictions remain.
