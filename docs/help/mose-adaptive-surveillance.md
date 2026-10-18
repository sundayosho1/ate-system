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
