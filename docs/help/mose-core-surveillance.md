# MOSE core surveillance — offline research laboratory

`@ate/mose-core` version `0.25.0-mose-core.1` supplies `MOSECoreRuntime`, immutable research
universes, observation receipts, reason-coded dispositions, coverage views and bounded
checkpoint/recovery. Prompt25 implementation is pending independent technical audit and separate
governance acceptance.

Only historical data and synthetic data imported through accepted historical owners are supported.
OBSERVED means a generic admitted research observation. It is not a strategy signal, ranking,
profitable opportunity, recommendation, financial permission or executable instruction. No
indicators, setup detection, risk/portfolio decisions, broker/network/MT5 access, credentials,
orders, trading or production deployment are implemented. Prompts26–30 remain reserved; Prompt26 is
not authorized.

## Accepted owners and composition

The runtime consumes public owners; it does not replace them:

| Evidence                               | Authoritative owner / consumed interface                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Current canonical research eligibility | P24 `InstrumentEligibility.getEligibility`, current capability decision and exact context           |
| Canonical identity / association       | P20, through P24 canonical revision and `associateResearchEvidence` references                      |
| Mapping and specifications             | P22/P23 immutable versions and P24 current qualification                                            |
| Historical identity                    | P14 historical repository `getManifest`                                                             |
| Dataset version and lineage            | P16 catalogue repository `getVersion`                                                               |
| Quality                                | P15 report repository `getReport`, P24 qualification and P19 inherited findings                     |
| Events and completed input evidence    | P19 `DeterministicReplaySequencer`, input verification, specification and checkpoint validation     |
| Higher timeframes                      | P18 snapshots/revisions retained by P19; MOSE does not aggregate                                    |
| Time                                   | P6 injected `Clock`, UTC parsing and existing offline modes                                         |
| Configuration                          | Accepted `ConfigurationRegistry`, `ConfigurationResolver`, `EffectiveConfiguration`                 |
| Governance                             | Existing `ApprovalAuthorityResolver`, distinct maker/checker and CONFIGURATION_CHECKER certificates |
| State                                  | P5 `StateAuthorityRegistry`, only the new derived `mose.surveillance` domain / `mose.core` owner    |

Create `MOSEPorts` with actual owner services/repositories, an offline VIRTUAL/SIMULATION/REPLAY
clock and a `Repository`. `replayEvidence(sessionId, checkpoint)` must resolve genuine accepted P19
specification/checkpoint/inputs; do not fabricate successful replay objects. Inputs verify on
binding and evaluation. Only HISTORICAL manifests are supported. Synthetic CSV/JSON imports through
P14–16 remain historical-owner evidence, not independently authenticated science or a live adapter.

Use `moseStateOwnership()` with the existing state registry. Register
`moseConfigurationDefinitions(clock)` and, where needed, `moseConfigurationSchemas(clock)` in the
existing configuration/schema registries. No new human role, state authority framework, market-data
ingestion engine, calendar or scheduler is introduced. Supply the same accepted authority resolver
used for governed offline research. The checker must currently hold the configured authority;
publication history does not bypass later withdrawal.

## Explicit governed configuration

The `surveillance.mose.policyJson` key belongs to SURVEILLANCE at SYSTEM scope. Its value is a
versioned JSON policy. Missing/disabled/invalid configuration fails closed; there is no automatic
runtime activation from an exported default. `enabled:true` is an explicit flag inside this governed
policy. The service requires RESEARCH mode and a trusted offline clock. SYSTEM/live clock modes are
rejected. Configuration snapshot ID, effective fingerprint, policy fingerprint and clock identity
are bound at initialization; drift requires a separately governed restart/version, not silent
mutation.

A starting example, using the exported `defaultPolicy`, is:

```ts
const policy = {
  ...defaultPolicy,
  enabled: true,
  effectiveAt: clock.now(),
  capability: "HISTORICAL_DATA_RESEARCH",
  allowReconstruction: false,
  requiredTimeframes: [],
};
```

Publish `JSON.stringify(policy)` through an explicitly configured accepted source and resolve an
`EffectiveConfiguration` in RESEARCH mode. The existing control plane supplies snapshot/fingerprint
identity; MOSE does not invent a promoted ConfigurationVersionId. The public configuration snapshot
ID is retained in every universe. Changing any bound effective version requires restart;
incompatible old roots are fenced, not migrated. `approvalPolicyId` must be a canonical existing
approval-policy reference accepted by the configured resolver. `requiredTimeframes` must be unique
standard P18 identifiers. No policy may authorize future funnel stages or live activity.

`allowReconstruction:false` requires owner VERIFIED_POINT_IN_TIME inputs. Setting it true permits
explicit EVENT_TIME_RECONSTRUCTION research with that evidence class permanently labelled in each
plan/observation; it does not upgrade uncertain history into point-in-time verification. Both modes
retain the P19 availability boundary and owner quality publication time.

| Policy limit                  |   Default | Enforcement / unit                                                         |
| ----------------------------- | --------: | -------------------------------------------------------------------------- |
| maxSessions                   |         8 | Retained session/universe versions, initialization and publication         |
| maxInstruments                |        32 | Configured members per universe; schema ceiling128                         |
| maxQueued                     |        32 | Global unique PENDING/DEFERRED receipts across sessions                    |
| maxRetained                   |       256 | Global retained receipts and per-source/per-universe immutable plan bounds |
| maxInputBytes                 |     65536 | Native deterministic UTF-8 encoding and serialized input bytes             |
| maxInputDepth                 |        20 | Root-depth-zero native command and recovery action bounds                  |
| maxBatch                      |        16 | Maximum selected processing obligations per PROCESS                        |
| maxOutstandingAcknowledgments |         1 | Global busy lock / one uncertain checkpoint                                |
| maxRecoverySteps              |       512 | Journal generations; normal writes cannot exceed their own recovery budget |
| maxAuditBatch                 |        16 | Maximum observation decisions per processing publication                   |
| maxHistory                    |       512 | Immutable generations; no automatic deletion/compaction                    |
| maxCheckpointBytes            |   1048576 | Checkpoint/state and read-response byte ceiling                            |
| maxRetainedBytes              |  67108864 | All retained checkpoint bytes, normal/recovery paths                       |
| maxEvidenceAgeMs              | 604800000 | Event age at its explicit owner knowledge boundary                         |

These are bounded research budgets, not measured throughput or a latency SLA. Protocol/schema
ceilings also apply. Filesystem repository budgets must be compatible with the runtime policy. An
over-budget operation returns a structured refusal without partially committing; earlier accepted
obligations remain intact. Returned noncommitting API refusals are distinct from durable observation
receipts.

## Session and immutable universe

`await runtime.initialize()` authenticates the policy and state owner, loads bounded immutable
history, checks every generation/link/fingerprint and reconstructs legal command deltas. Fresh
current owner and universe-authority checks determine readiness independently of historical facts.
Failed/corrupt load retains a recovery obligation; an honestly empty canceled load does not
fabricate durable debt.

Submit a CREATE command with:

```ts
await runtime.dispatch({
  kind: "CREATE",
  id: "create-research-1",
  sessionId: "research-1",
  instruments: [{ instrumentId: canonicalId, source: { sessionId, checkpoint } }],
  maker,
  checker,
  previousUniverse: null,
});
```

Use actual canonical IDs and completed P19 participant references from the current P24 research
context. HISTORICAL_DATA_RESEARCH or MULTI_TIMEFRAME_RESEARCH is the explicitly selected activity.
Recorded stages alone do not qualify an instrument. LIVE_ELIGIBLE/ACTIVE are rejected even if a
caller presents them as an authority. Complete replay provenance is additionally required; an
attestation or a replay-success flag does not fill omitted datasets.

Each member retains mapping/specification/canonical revision, exact dataset and quality bindings,
P24 record version/current assessment, inclusion/exclusion reasons and its source reference. Each
event resolves one exact public dataset version using the full historical manifest, report and
catalogue-version hash, not count, symbol label or an assumed instrument-only lookup. The universe
retains its session, policy, effective configuration snapshot/fingerprint, creation and effective
timestamps, separated actors/certificate, complete immutable plan and previous-version link.

Unresolved eligible sources make expected obligation totals unavailable; coverage cannot be
complete. An ineligible instrument is explicitly excluded without preventing another valid
instrument from being scheduled. Duplicate members are rejected. The source plan is deterministic:
owner knowledge boundary, canonical instrument ID, then the actual P19 owner event ordinal.
Equal-time order inside an instrument preserves the accepted sequencer; MOSE does not invent market
ordering evidence.

A universe cannot be changed in place. Pause/complete the preceding session, settle its acknowledged
queue, and CREATE a new session with `previousUniverse` referencing it. The old universe, unreceived
obligations and outcomes remain queryable. A new research session is not a duplicate receipt in an
old session. All current qualifications and separated approval are required again.

## Lifecycle, receipts and evaluation

Runtime lifecycle: CREATED→INITIALIZING→READY, with RUNNING/PAUSED laboratory sessions, STOPPING and
STOPPED. FAILED and RECOVERY_REQUIRED expose initialization/publication failures. Legal session
commands are START, PAUSE, RECEIVE, PROCESS and COMPLETE. Unknown/illegal transitions return a
structured refusal. Query/health operations do not publish market or funnel events.

After START, admit a plan reference, not an arbitrary new market payload:

```ts
await runtime.dispatch({
  kind: "RECEIVE",
  id: "receive-1",
  sessionId: "research-1",
  eventId: universe.plan[0].eventId,
  instrumentId: universe.plan[0].instrumentId,
  universeSnapshot: universe.fingerprint,
});
await runtime.dispatch({ kind: "PROCESS", id: "process-1", sessionId: "research-1", limit: 16 });
```

RECEIVE requires the immutable next event and current universe authority. It creates one
acknowledged logical receipt. Duplicates/new IDs for the same receipt do not inflate counters; a
repeated identical command ID returns the original exact acknowledgement. Changed content under an
old ID is rejected. Paused receipt is explicitly DEFERRED; processing while paused requires resume
or shutdown drain.

PROCESS reevaluates current universe checker authority, current P24 capability/context/version,
exact replay/specification/checkpoint/input/event identity and full public dataset/quality lineage.
Terminal outcomes are ADMITTED, REJECTED or QUARANTINED; DEFERRED retains a queued obligation. A
missing source can be restored and retried without changing the event identity or already accepted
other instruments. A denied instrument does not invalidate another instrument's receipt. No failed
source is silently reassigned. Blocking quality/unknown provenance never emits OBSERVED.

Every durable observation retains source event/manifest/cursor/payload identity, dataset ID/version,
version/content fingerprints, quality report/fingerprint, universe/session/canonical instrument,
timeframe, event time, owner boundary, processing time, sequence, research evidence class, quality
reference/disposition, outcome/reason/explanation, owner eligibility reasons and audit correlation.
Large market payloads are not duplicated: references resolve to the accepted owner records.

A valid ADMITTED observation emits exactly one immutable MOSE_CORE/OBSERVED envelope with
opportunity correlation, observation/source versions, policy/authority references and audit trace.
Its transition time is actual processing knowledge time, not a backdated historical event. No later
stage owner is impersonated. Future funnel vocabulary and terminal vocabulary are schema foundations
only; no placeholder success, ranking, risk, portfolio, allocation or execution stage is
operational.

## Temporal boundaries and higher timeframes

Event time, owner availability/quality publication time, replay logical boundary and research
processing time are distinct. The plan's `boundaryAt` is the accepted P19 knowledge boundary
(including owner quality availability), not permission to use everything in a completed source
checkpoint. The injected processing clock must have reached that boundary. Owner
eligibility/configuration and checkpoint references cannot come from the processing clock's future.

Processing uses a stable offline clock instant across each atomic command. Regression between
commands, clock-identity/mode substitution or an advance during asynchronous owner evaluation is
rejected before publication; advance the accepted offline clock between commands instead. This
avoids backdating newly learned data into an earlier as-of record. No wall clock or independent time
source is created by MOSE.

For required higher timeframes, only owner snapshots at/before the observation boundary are
inspected. Selected revisions must be final, complete, already available and closed by that
boundary; snapshot asOf/cutoff must not exceed it. A future, absent, forming or incomplete higher
timeframe is DEFERRED with TEMPORAL_INCONSISTENCY and no funnel event. P18/P19 retain calendar, bar
finality, correction, quality and point-in-time authority. MOSE never rebuilds aggregates or infers
a future close.

Freshness is measured as event age at the owner knowledge boundary, not wall time since an old
historical file was researched. Processing/publication time determines recorded as-of visibility.
EVENT_TIME_RECONSTRUCTION remains explicitly qualified; no perfect historical market knowledge,
historical registry membership or stronger issuer authenticity is inferred.

## Coverage and reconciliation

`getSessionSummary(sessionId)` returns latest **recorded** facts. Its eligibility scope is universe
publication, not a new current P24 authorization. Use current checks before acting and `health()`
for a fresh readiness assessment. `getUniverse` returns an immutable snapshot; neither query grants
new authority.

- Configured: unique requested canonical instruments.
- Eligible: instruments whose current P24 activity gate qualified when the universe was published.
- Excluded: instruments not included in the plan, with reasons retained.
- Scheduled: unique included instruments with planned owner events.
- Observed: unique instruments with an ADMITTED logical observation.
- Received: unique, genuinely acknowledged plan receipts.
- Admitted/rejected/quarantined: current terminal dispositions of those receipts.
- Pending: PENDING plus DEFERRED receipts; **deferred is a subset**, not an extra disjoint total.
- Unreceived: known planned obligations not yet received.
- Unresolved sources: eligible members with missing required source evidence/unknown plan totals.

Reconciliation: received = admitted + rejected + quarantined + pending. Returned malformed,
duplicate, out-of-order, unauthorized or over-budget API refusals include a reason and correlation,
but do not fabricate an acknowledged receipt. `refusedAPIAttempts` is a separate volatile
operational counter; it is not a durable exactly-once observation history. UNKNOWN commitment is
separately represented by an unresolved checkpoint obligation, never declared a clean refusal or
success.

Metrics expose numerator, denominator, status and nullable value:

| Metric                          | Numerator                           | Denominator                                                 |
| ------------------------------- | ----------------------------------- | ----------------------------------------------------------- |
| Eligibility coverage            | Eligible instruments at publication | Configured instruments                                      |
| Completion coverage             | Terminal observation obligations    | Complete immutable plan, or null if required totals unknown |
| Evidence qualification coverage | ADMITTED observations               | Evaluated terminal observations                             |

Zero denominator is NOT_APPLICABLE; unknown denominator is UNAVAILABLE; neither invents a
percentage. `coverageComplete` requires no unresolved eligible sources and all planned obligations
terminal. Completion does not mean every observation qualified or every configured instrument was
eligible. COMPLETE cannot conceal an unreceived, pending or deferred required observation.

## Read-only research reports and health

Typed primary interfaces: `getUniverse`, `getSessionSummary`, `health`, `diagnostics`. The typed
`ResearchReadEnvelope` query API supports SUMMARY, UNIVERSE, INCLUSION, OBSERVATIONS, PENDING,
REASONS, SOURCE_QUALITY and HISTORY:

```ts
runtime.query({
  kind: "OBSERVATIONS",
  sessionId: "research-1",
  offset: 0,
  limit: 20,
  asOf: null,
});
```

Pages are bounded with totals/nextOffset; use smaller pages if the response byte budget is exceeded.
Set asOf to a UTC processing/publication boundary for recorded knowledge. Future queries are denied.
Only acknowledged history at/before that boundary is visible. A historical ADMITTED observation
remains a recorded fact after current eligibility/approval withdrawal; it does not grant current
surveillance or trading permission. The source-quality report retains owner references and rejection
reasons without inventing a new quality score.

`diagnostics()` is a bounded cached operational snapshot. `await health()` performs fresh owner
checks, separately reporting source availability, current eligibility and current universe authority
in `sourceReadinessAxes`, with check time. A previously successful run is not proof of current
health. One source/authority failure yields explicit local denial/defer and DEGRADED health while
valid other instruments remain operable. Uncertain shared journal publication or corrupt load is
global RECOVERY_REQUIRED and fences all new writes. Data isolation does not authorize concurrent
writers to an uncertain shared root.

## Checkpoints, interruption and shutdown

Choose `MemoryMOSERepository` for disposable research or `FilesystemMOSERepository` for immutable
Linux laboratory files. Use a trusted root, one writer and compatible declared byte/history budgets.
Filesystem publication uses an exclusive pending file, hard-link publication and readback. It does
not certify fsync, crash/power-loss durability, Windows open-handle behavior or production
throughput.

Each acknowledged checkpoint binds runtime ID, generation, predecessor, configuration/policy, clock
provenance, command and state fingerprint. Inspect it via the acknowledgement, bounded HISTORY query
or immutable `generation-NNNNNNNN.json` files. There is no source-repair or garbage-collection
permission hidden in checkpoint reading.

Recovery validates filename continuity, bytes, strict JSON, generations, identities, policy/version,
clock boundary, legal command deltas, receipt/funnel invariants and all current resource budgets. It
rechecks current eligibility/source/approval separately from historical records. Corrupt,
incompatible or interrupted roots retain RECOVERY_REQUIRED/NOT_READY/DEGRADED and an obligation;
repeated shutdown cannot hide it. No immutable generation is rewritten, silently migrated or
repaired.

A genuine repository ACK advances state exactly once. Honest NONE preserves the old state and
permits the same operation identity to retry. UNKNOWN, malformed ACK, wrong ACK or throw around an
actual write retains the original generation/fingerprint obligation; a fresh authorized reader must
recover actual storage. The acknowledgement does not certify every enclosing callback or current
readiness. Publication is globally serialized; bounded PROCESS handles only declared batch work.

`await runtime.stop()` fences new admissions. If acknowledged queue work remains, it returns
PROCESSING_DEFERRED; restore evidence/resume or drain PROCESS while STOPPING, then stop again. A
genuine uncertain publication always prevents clean shutdown. Once no acknowledged work/IO is
unresolved, local shutdown succeeds idempotently without requiring an extra journal slot. It does
not declare the research session complete, discard unreceived plan obligations or manufacture a
durable STOP. An explicit `dispatch({kind:"STOP",id})` is the separate journalled session-closing
operation and requires publication capacity. Fresh initialization resumes only from actual
acknowledged history, with current owner checks; a stopped instance never silently resumes. Future
work requires a new explicit invocation, not a live background subscription.

## Reason codes and troubleshooting

The exported `reasons` catalogue gives a stable code and human explanation for every durable
disposition; returned refusals also have correlation IDs. Core categories: INSTRUMENT_INELIGIBLE,
UNIVERSE_NOT_AUTHORIZED, SOURCE_UNAVAILABLE, DATA_STALE, DATA_QUALITY_FAILED, PROVENANCE_INCOMPLETE,
TEMPORAL_INCONSISTENCY, DUPLICATE_OBSERVATION, OUT_OF_ORDER_OBSERVATION, CONFIGURATION_INVALID,
POLICY_NOT_EFFECTIVE, RUNTIME_NOT_READY, RESOURCE_BUDGET_EXCEEDED, REPLAY_EVIDENCE_INVALID,
PROCESSING_DEFERRED and UNKNOWN_EVIDENCE. Protocol/integrity failures add explicit codes such as
OPERATION_IN_FLIGHT, IDEMPOTENCY_CONFLICT, CHECKPOINT_INTEGRITY and RECOVERY_REQUIRED.

Inspect REASONS, SOURCE_QUALITY, PENDING and owner eligibility reasons before retrying. Restore the
same immutable source; do not substitute another dataset or remove evidence. For configuration or
clock drift, authenticate the accepted version and use an explicitly governed restart. For unknown
commitment, stop new writes and inspect actual files through a fresh compatible reader. Do not clear
obligations or delete pending/corrupt files merely to obtain green readiness.

## Qualification and verification boundary

All25 qualifications in
[Prompt24 conditional acceptance](../development/prompt-24-conditional-acceptance.md) remain
mandatory, including A22-Q01–Q06; F05/F06/T01/M02; O-C01/O-C02;
Q01-A/Q-HIST/Q-TICK/Q-SELECTOR/Q-T01; INHERITED-OTHER; E-T01; REVIEWER-PARTICIPATION; A23-Q01–Q03;
HISTORICAL-EVIDENCE; RESEARCH-SCOPE. Preserve all prior failed evidence, source-authentication
limits, bounded quality, consumer-loss reconciliation, unsupported corrections, historical/current
distinctions, trusted certificates/root/single writer and independence disclosures. No
organizationally independent certification is claimed.

Run `npm ci --cache /tmp/ate-npm-cache`, `VITEST_MAX_WORKERS=2 npm run verify`, full and
production-only JSON audits, `npm ls --all --json` and `git diff --check`. Preserve
failures/retries. All1963 inherited cases and new MOSE tests must remain represented. Genuine owner
integration journeys are in `tests/mose-core/journeys.test.ts`; temporal owner controls and negative
architecture controls remain separate. Independent technical and governance acceptance are pending.
Prompt26 is not authorized.

The exported `ReservedFunnelEventEnvelopeV1` and `FunnelStage` are type-only future integration
vocabulary. They grant no runtime authority and have no emitter. The operational strict schema
permits only MOSE_CORE / OBSERVED, with explicit policy version 1; later stages require separate
authorized owners.

## CODEX-010B recovery, capacity and fresh-health corrections

Live commands and recovery use the same pure structural transition validator. It checks the recorded
prior session state, command, source obligation/cursor, capacity and predecessor
identity/status/debt before applying the exact command delta. An acknowledged journalled STOP is
terminal for new commands, including after fresh recovery. Reading valid stopped history and
returning an existing idempotent acknowledgement do not create a new command. A local operational
shutdown is distinct from journalled STOP. Valid PAUSED processing during a local shutdown drain
remains structurally recoverable: volatile local stop intent is not fabricated as historical
external authority, and ordinary live processing while paused still requires that local shutdown
request. Current permission and source availability are checked separately from historical
structural correctness; revocation does not erase valid recorded observations.

Retained-history bytes mean the **sum of UTF-8 JSON checkpoint record bytes**, including each
record's actual numeric widths and fingerprints. Collection brackets and commas are transport
framing, not stored checkpoint records. Admission projects that same sum; memory and physical
publication acknowledge the same records; recovery clones and counts each record against the same
sum. Recovery validates the native collection length/shape before accessing rows, limits record
count by both maxHistory and maxRecoverySteps, and bounds every row by maxCheckpointBytes and the
remaining retained-byte budget. It does not serialize an unbounded collection to measure it.
Physical repositories additionally bound actual file sizes/total file bytes and reject unexpected
files or symlinks. Normal canonical writes therefore recover at exact capacity without raising the
limit. A stricter applicable policy may deny recovery; this does not authorize policy migration or
rewriting old evidence. NONE, genuine ACK and UNKNOWN obligations remain distinct.

`health()` and recovery now reuse the same full source-binding predicate as processing: exact replay
participant/input identity, every required historical origin, dataset version/content, quality
report, manifest and planned event fingerprints/cursors. The per-source readiness axes add
`dataSourceReasons`, an additive list of stable reason codes (empty when that axis is ready).
Unavailable, throwing, malformed or mismatched binding owners produce a false dataSourceReady axis
and DEGRADED health, without changing durable history. An unaffected canonical source can remain
ready independently. Restoring an owner requires a new fresh check; cached diagnostics do not
establish current availability. These reads remain finite and sequential under existing budgets and
the trusted-terminating-owner assumption; no polling, background service or timeout preemption was
introduced. Temporal qualification remains a separate observation decision, not a claim that source
readiness alone establishes a valid final higher-timeframe observation.

Developer remediation verification is not independent technical or governance acceptance. All 25
inherited qualifications remain in force. Prompt 25 acceptance remains PENDING and Prompt 26 remains
NOT AUTHORIZED.

## CODEX-010D canonical source-plan authentication

A retained hash chain authenticates its own bytes; it does not establish that its plan contains all
genuine replay obligations. Live CREATE and verification now share the pure, bounded `canonicalPlan`
derivation and `comparePlans` order in `@ate/mose-core`'s internal canonical module. No upstream
owner or persisted checkpoint schema changes. No new configuration key, issuer, background worker,
network service, policy migration or resource allowance is introduced.

Canonical authority is field-specific:

| Retained fact                            | Accepted authority and comparison                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Canonical member/source                  | CREATE request membership, retained P24 context, exact left/right P19 session and checkpoint                             |
| Input fingerprint, replay mode and scope | Verified P19 specification/checkpoint/input set and deterministic sequencer                                              |
| Count and membership                     | Every sequenced event exactly once; member.expected, per-member plan count and event identities agree                    |
| Ordering and ordinal                     | Original sequencer ordinal; global order by availability boundary, canonical instrument and owner ordinal                |
| Event time, payload, cursor and manifest | Genuine P19 event envelope and validated source records                                                                  |
| Availability boundary                    | Maximum of event eligibility, quality availability and source publication timestamps, using the existing live derivation |
| Timeframe and evidence class             | Original observation kind/timeframe and actual P19 replay mode; no retained upgrade or downgrade                         |
| Dataset version/content and quality      | Exact P24 dataset bindings resolved through P16/P15 owner interfaces                                                     |
| Historical identity and origin           | P14 manifest plus complete manifest/report/catalogue-version origin fingerprint                                          |
| Current permission                       | Existing P24 capabilities/version and configuration checker authority; never reconstructed from a historical plan        |

Comparison is bidirectional and covers the complete strict plan record, not selected fingerprints. A
subset, superset, duplicate, reorder, equal-count substitution or metadata change fails closed.
Distinct valid partitions retain their distinct manifest/event identities even when they share an
origin. Existing accepted P19 inputs require at least one manifest and at least one record per
manifest; this remediation does not invent an empty source or relax that contract.

Recovery first checks all checkpoint bytes, structural deltas, canonical ordering and static
member/count/context consistency. Every session's immutable universe remains in the final state;
exact delta replay prevents an earlier universe from disappearing or changing. Each included
universe/source is then reconstructed from genuine owners before any READY certification.
`CANONICAL_PLAN_MISMATCH` returns structured failure, preserves the physical bytes and recorded
recovery obligation, and prevents new successful acknowledgements. There is no silent repair.

Temporary evidence unavailability is not proof of historical fraud. A fresh reader can retain and
expose recorded history while verification is unresolved: initialize succeeds with lifecycle PAUSED,
readiness NOT_READY, health DEGRADED and explicit `canonicalVerificationObligations` (scope/reason).
These are derived semantic obligations, distinct from `pendingAcknowledgments` and storage
commitment uncertainty. They are rebuilt from the intact journal on every fresh initialization. No
new checkpoint, including no-op PROCESS, PAUSE or journalled STOP, can publish across this recovery
verification barrier. Previously acknowledged idempotent commands can still return their historical
acknowledgement; this grants no new readiness or publication authority.

Restore the trusted owner and call `health()` for bounded same-instance revalidation, retry a new
command (which attempts pending verification before publication), or initialize a fresh reader. No
polling is added. A successful full comparison clears the semantic obligation without writing a
checkpoint. If restored evidence proves substitution, the reader enters RECOVERY_REQUIRED and
retains the offending durable checkpoint identity; it does not rewrite or migrate it. Local stop
cannot conceal unresolved verification. Once stop has been requested, use the existing lifecycle
contract and a fresh instance rather than assuming the stopped instance can resume.

Verified immutable historical facts and current evidence availability remain different. A live
session whose plan was genuinely authenticated may retain a rejected/deferred receipt when an owner
later withdraws; PROCESS still checks current owner evidence before any ADMITTED/OBSERVED result.
Current authority withdrawal does not erase honest observations. Fresh unverified recovery cannot
use that historical-authentication rule to manufacture permission. Existing live source isolation,
FIFO/cursor rules, quality propagation, ACK/NONE/UNKNOWN handling and paused shutdown drains remain.

Coverage summaries expose `canonicalVerification` and `expectedObligations`. Affirmative completion
requires authenticated canonical obligations and terminal disposition of all expected events; it
cannot follow merely from a shortened stored plan. Unverified coverage is false, its expected count
and completion denominator unavailable, while recorded receipt/outcome counts remain readable. The
summary's existing historical scope still does not establish current authority or certify that every
research observation is admitted. Queries are synchronous recorded-fact reads, not fresh owner
availability certificates; use `health()` for fresh current axes. Historical as-of queries preserve
their recorded time boundary and use authentication of the same immutable universe.

All 25 inherited qualifications remain unchanged. The additional C-Q01 still limits proof of the
original volatile intent behind a historical PAUSED drain; C-Q02 still limits progress when finite
history capacity leaves no space to drain pending work. No Windows, fsync/power-loss, production
throughput, dishonest-owner, hostile-root, concurrent-writer or external-authentication guarantee is
added. Trusted terminating owners, immutable roots/evidence and single-writer restrictions remain.
Prompt 25 technical/governance acceptance remains PENDING. Prompt 26 remains NOT AUTHORIZED.
