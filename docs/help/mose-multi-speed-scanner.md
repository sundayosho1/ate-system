# Offline MOSE Multi-Speed Scanner

Package: `@ate/mose-scanner`; implementation version `0.26.0-multi-speed-scanner.1`. Prompt 26
technical and governance acceptance are **PENDING**. Prompt 27 is **NOT AUTHORIZED**. This package
schedules bounded historical/synthetic research work. It provides no trading, profitability,
strategy-validation, live-data, broker, credential, financial or production authority. All emitted
market observations remain owned by Prompt 25 and its OBSERVED-only funnel.

## Setup and public-owner composition

Use the repository engines (Node >=22, npm >=10) and frozen `npm ci`. The verified research profile
uses `VITEST_MAX_WORKERS=2 npm run verify`. Import only public workspace exports. No server,
terminal, network market feed, credentials or wall-clock timer is required.

1. Recover/initialize the accepted historical, quality, catalogue, replay, eligibility and MOSE
   owners.
2. Establish a genuinely governed Prompt25 universe and start its session through `MOSECoreRuntime`.
3. Register `scannerConfigurationDefinitions(clock)` / `scannerConfigurationSchemas(clock)` through
   the accepted configuration registries. Resolve `surveillance.scanner.policyJson` and the full
   `surveillance.scanner.planJson` in RESEARCH. Use `policySchema.safeParse` for field-level
   diagnostics before installation. Register `scannerStateOwnership()` in the accepted state
   registry; no new eligibility/approval roles exist.
4. Supply `ScannerPorts`: the same qualified P6 clock, effective configuration provider, registered
   state authority, actual MOSE public service, actual aggregation owner, accepted calendar, the
   same trusted replay-evidence resolver used by MOSE, and a scanner checkpoint repository. Native
   owner evidence must be immutable serializable data as produced by accepted owners. Native
   repository Result envelopes are structural: supported array, inherited and null-prototype
   representations are not rejected merely for their representation. Accessor exceptions/malformed
   envelopes fail closed. Native JSON payloads are copied from own data descriptors into an inert
   snapshot before serialization; inherited toJSON/index callbacks never select evidence. Sparse
   array lengths, key bytes and nested data are bounded before allocation/serialization.
5. Initialize `MultiSpeedScannerRuntime`. `createPlan(id, plan)` binds immutable subscriptions and
   an acyclic dependency graph. `transition(id, "START")` starts scanner scheduling; it does not
   start or authorize the MOSE session. START/PAUSE/RESUME repeats preserve logical state; exact
   same command ID with a different lifecycle operation conflicts. A different policy/configuration
   requires a separately governed scanner instance/root/plan; it cannot mutate an active plan.
6. Submit an actual canonical source identity with `onEvent(sessionId,eventId,boundary)`, or use
   `preview(subscriptionId,boundary,eventId?)` and `request(trigger)` for explicit bounded work.
   Preview is a read, never permission or an observation. Only accepted source identities qualify.
7. Call `advance()` at governed logical clock boundaries for cadence/schedules. Call
   `dispatch(id, limit)` for bounded work. No busy loop or arbitrary sleep is the research
   authority.
8. Inspect returned Results, `query`, `queryHistory`, `coverage`, `health` and `diagnostics`. Finish
   retained work before `stop()`. Publication uncertainty needs fresh owner/repository recovery;
   never erase a root or clear an obligation to make shutdown succeed.

## Six modes

| Mode       | Due condition                                                           | Owner evidence and no-action boundary                                                                                 |
| ---------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| TICK_EVENT | Accepted canonical event, not a caller-created market payload           | Event identity, ordinal and immutable universe plan; duplicates retain an explicit receipt without another work item  |
| SECONDS    | Anchor-inclusive `anchor+n*cadenceMs` under logical time                | Only qualified evidence may be evaluated; unchanged dependencies avoid repeat evaluation                              |
| BAR_CLOSE  | Actual finalized P18 revision known by cutoff                           | Nominal close alone is insufficient; provisional, unavailable, incomplete or unrelated-source bars are refused        |
| TIMEFRAME  | Explicitly affected configured frame with qualified final evidence      | Cross-frame lineage and knowledge fences; unrelated frame evidence cannot force recomputation                         |
| SCHEDULE   | Governed recurring bounded anchor/cadence through schedule end          | Exact calendar fingerprint, timezone/session/holiday/break rules; a one-time schedule has end=anchor                  |
| TRIGGER    | Configured trusted checker acting on a declared internal research cause | Actor must match the universe checker and policy allowlist; existing current governance/eligibility remains mandatory |

Internal trigger kinds are CONFIGURATION, QUALITY, SOURCE_RECOVERY, UNIVERSE and RESEARCH_RESCAN.
Configuration/universe/quality causes must match the actual selected owner's reference. Research
rescan/source-recovery causes are source-declared under T01, never externally authenticated
webhooks. No trigger can assert that an instrument is eligible, that a strategy passed validation,
or that an investment opportunity exists. Config-triggering identifies the installed immutable
configuration; installation of a new version requires the separate governed workflow, not in-place
mutation.

## Timing, calendars and corrections

New operational work cannot be backdated before its plan checkpoint. Periodic anchors cannot precede
activation, and schedule ends must fit the governed horizon from activation. Historical read-only
queries remain separate; they do not establish historical membership or permission.

Event time, canonical knowledge boundary, logical scheduling time, finality/publication and
processing are distinct. Requests cannot use a future boundary. Snapshots use matching asOf/cutoff
and no provisional/incomplete evidence. Finality, availability, publication, committed time and
window end must be known by the decision boundary. P18 remains the aggregation and calendar
authority; the scanner does not calculate replacement candles. Current owner policy determines
staleness. Reconstruction evidence remains explicitly reconstruction, never promoted into
point-in-time proof.

Bar lineage is checked through bounded public `readRevision` traversal. Raw leaf content
fingerprints must match accepted canonical source observations, artifact identity and quality-report
references. Registry canonical instrument identity and raw stream instrument identity are related
through the accepted replay binding, not assumed textually equal. Higher-frame revisions depend on
their actual revision/lineage identity; later unrelated event requests are not mandatory
full-universe rescans. Corrections are new accepted owner revisions. Historical work retains its
original cutoff/fingerprint; newly available corrected evidence creates a new dependency vector,
never a rewrite of earlier work. A historical owner's retained revision must still be available for
scanner recovery authentication.

Cadences are elapsed UTC durations. A 24-hour cadence is not a civil-time 09:00 recurrence across
DST; use accepted explicit session schedules/one-time subscriptions for that requirement.

CalendarBoundaryResolver supplies DST gaps/folds, holidays, session breaks and explicit sessions.
The scanner supplies no broker calendar or historical membership authority. `CATCH_UP` records each
bounded missed deadline; `SKIP` records MISSED_INTERVAL for older missed schedule boundaries.
Non-session and break boundaries produce explicit skipped receipts. `maxCatchup` stops each advance
and returns `remainingNotProcessed=true`; repeated advance resumes from the retained cursor. Missing
source evidence returns an explicit deferred boundary without advancing it. This is not an
acknowledged persisted work item: callers must retain the returned input and retry/reconcile it.

## Work identity, incremental dependencies and coalescing

The work key binds the scanner plan/policy scope, Prompt25 session/universe, instrument, timeframe,
stream, mode, trigger identity/cause, knowledge boundary, source identity and version vector. An
exact request ID cannot change its payload. Plan IDs distinguish independently governed scanner
sessions. Use unique governed IDs for distinct sessions; identical logical identities are not new
work.

The graph rejects cycles, unknown parents, duplicate nodes and excess nodes/edges. `onEvent` finds
only configured dependent event/frame subscriptions. `affectedDependencies` is a bounded read-only
explanation API. Each work item's exact vector is retained; pending work is dirty/unresolved and
only genuine acknowledged work is a valid cache candidate. Recovery invalidates historical cache
authority conservatively. A fresh evaluation and acknowledged result can establish a new
current-runtime cache entry; historical completion alone cannot.

Equivalent coalescing requires equal session/universe, instrument, timeframe/stream, boundary,
evidence vector and complete policy/plan scope. It may combine modes requesting the same generic
research observation. Every original request remains linked to its shared work. Different versions,
authority scopes, temporal boundaries or evaluation contexts cannot be merged. Explicit
RESEARCH_RESCAN requests are separate fresh-qualification obligations and are neither coalesced with
ordinary wakeups nor answered solely from completed cache. The first request's scheduling class is
retained; coalescing grants no latency promise. DISABLED keeps separate pending requests, while
duplicate canonical events are always recognized separately from new evidence.

UNCHANGED_DEPENDENCIES avoids an evaluation after fresh current authority checks. DUPLICATE_REQUEST
is distinct from coalescing and from a new completed observation. A skip is never completed new
work. Do not infer strategy-specific evaluation requirements: indicators and downstream funnel
stages are outside this generic scheduling contract.

## Queue order, fairness and limits

Dispatch is serialized: at most one public owner evaluation is active. Stable round robin selects
instruments, beginning after the last serviced instrument. Within each instrument: due time,
governed priority, source ordinal, mode identity and work key establish deterministic order.
Equivalent input and governed state yield equivalent logical outcomes; async completion does not
determine order. Under bounded admitted queues, a serviced step visits each ready instrument before
the same instrument's next queued item. This guarantees bounded _attempt service_, not completion:
canonical MOSE predecessors, unavailable owners, missing finality and resource limits can defer
work.

All limits are immutable governed policy: subscriptions/instruments/frames, nodes/edges and fan-out,
requests/coalescing, pending queue, batches, history/input/checkpoint/retained bytes, query pages,
catch-up/schedule horizon and owner calls. Retained completed work is the bounded cache; its entries
and bytes share request/history/checkpoint budgets rather than introducing an unbounded cache.
Exhaustion returns an explicit refusal/defer and preserves already acknowledged work. The caller
retains non-admitted requests; a refusal is not a hidden durable admission. No queue item is
silently removed, no budget is increased automatically, and no retry loop is unbounded.

`maxOwnerCalls` bounds scanner-to-public-owner calls per logical operation, not all internal work
performed by an accepted owner. Recovery inspects at most maxRecoverySteps checkpoints and at most
maxRecoverySteps*maxOwnerCalls public calls. Every retained history/lineage/query traversal has its
separate declared bound. Owner implementations must honestly terminate under T01. There is no
wall-clock interruption or deadline guarantee for a dishonest/nonterminating trusted owner.

## Publication, recovery and shutdown

Scanner history and Prompt25 history are separate owners. Before an evaluation, retain an ATTEMPT
checkpoint. MOSE RECEIVE/PROCESS remain the only observation publication route. Completion requires
a real ADMITTED observation and matching genuine MOSE acknowledgement, then a scanner RESULT ACK.
Canonical predecessor requirements remain authoritative: a bar-only caller may need to ingest
earlier canonical observations through MOSE or event subscriptions first. Deferred work never skips
those predecessors. A referenced already-existing observation is not a newly created observation.

A matching ACK installs exactly the acknowledged immutable state. A valid explicit NONE permits safe
retry; malformed/UNKNOWN/lost/wrong ACK retains uncertainty and fences new publication. Pending
attempts and genuine current-owner outages remain visible. The scanner never writes private MOSE
storage, fabricates exclusions, clears storage debt or treats an old ACK as current authority. STOP
fences new work. In-flight STOP does not report success; retained work can drain before repeated
clean shutdown. After STOP, new admission is refused. Local stopping does not call global MOSE STOP.

FilesystemScanRepository uses canonical exclusive immutable link/readback under trusted-root,
single-writer assumptions. Noncanonical/duplicate-key JSON, symlinks, gaps, extra interrupted
staging files and oversized history fail closed. No automatic migration, orphan deletion or repair
is performed. An interrupted staging artifact can require explicit recovery intervention; it is
never silently treated as a committed or aborted operation. ACK is not fsync or power-loss
certification.

Recover upstream owners first, then a fresh scanner using the same intact root and immutable
configuration. Validate every generation, parent fingerprint, policy/configuration, temporal order,
lifecycle transition, request lineage, work key/vector/ordinal and retained budget. Each completion
must agree with an actual owner observation and the corresponding owner checkpoint. The scanner
rejects impossible/changed histories, missing source evidence and unauthenticated completion; it
does not invent a missing native negative envelope. Source availability can therefore block
recovery; restore the required accepted owner/root rather than rewriting scanner evidence.

## Read-only coverage, health and reasons

`query(offset,limit)` returns immutable retained work and request receipts, with explicit historical
scope. `queryHistory(asOf,offset,limit)` returns bounded checkpoint history, never future knowledge.
`coverage()` counts acknowledged scanner requests/work only. It does not claim to enumerate
unrequested future deadlines or the entire MOSE universe. Those denominators remain NOT_ESTABLISHED.
Read Prompt25's own session summary for observation/universe coverage; scanner scheduling never
replaces it. `admittedObservations` means distinct genuine MOSE observations referenced by completed
scanner work, **not newly published observations or current permission**. Source-event repeats,
coalesced wakeups and historical acknowledgements do not inflate this count.

Coverage includes per-mode/instrument/frame counts, pending/deferred/coalesced/skipped work, avoided
evaluations and logical backlog age. Logical age is not production execution latency. Unacknowledged
input rejections are returned as structured errors, not journaled as due work; their all-time count
is NOT_ESTABLISHED. Current eligible-subscription totals require fresh owner checks, not historical
request counts. `health()` rechecks current accepted source axes; `diagnostics()` reports last-check
scope, independent scanner publication uncertainty, pending work, source checks and checkpoint
identity. Historical completion survives a later outage while current readiness/health degrades. No
future availability guarantee follows from a successful owner check.

Important reasons: NOT_DUE, UNCHANGED_DEPENDENCIES, DUPLICATE_REQUEST, COALESCED_EQUIVALENT_WORK,
INSTRUMENT_INELIGIBLE, SOURCE_UNAVAILABLE, TEMPORAL_NOT_READY, RESOURCE_DEFERRED, INVALID_SCHEDULE,
OWNER_CALL_BOUNDS, CANONICAL_PREDECESSOR_PENDING, PROVENANCE_INCOMPLETE, DEPENDENCY_CHANGED,
PUBLICATION_UNKNOWN, HISTORY_TRANSITION and RECOVERY_OWNER_EVIDENCE. Use the selected schema's
validation issues for exact invalid fields. Preserve structured failures, raw logs and actual owner
diagnostics; do not catch a failure and count it as a passed observation.

## Governance and verification boundary

The application-wide capability/version files remain the accepted Prompt25 host baseline. This
separately exported research package is not automatically registered as a host capability and does
not modify the immutable Prompt25 acceptance record. This owner-authorized Prompt26 development is
separate from those historical authorization statements. No Prompt26 acceptance or Prompt27
permission follows from package availability. The external CODEX-011 report records exact source,
verification, draft failures, approved three-file historical-test compatibility changes and
publication. The scanner has its own source-integrity/negative architecture controls; all eighteen
accepted owner packages remain byte-identical.

The controlled test oracle evaluates unchanged evidence at every wake-up and compares required
outputs with incremental work. This demonstrates avoided redundant evaluations for that fixture, not
universal speed, throughput, Windows support, trading alpha or a latency SLA.

## Qualification carry-forward

All inherited paragraphs and additional Prompt25 qualifications below are reproduced verbatim from
the accepted Prompt25 record. Earlier references to future-prompt non-authorization are historical
context, not a revocation of the separately supplied Prompt26 development authorization. No meaning,
prohibited interpretation, operational consequence or future dependency is weakened.

## Mandatory qualifications — exact inherited register

## Mandatory qualification schedule — all 25 retained

The following meaning, prohibited interpretation, operational consequence and future dependency
paragraphs are reproduced from CODEX-009E-evidence/qualification-register.json without changing
their text or combining entries. Historical P22/P23 proposal metadata and references to
authorization at those earlier publication stages remain historical context, not a revocation of
separately supplied P24 development or this governance decision. This appendix changes only P24
governance status; all substantive restrictions persist. The full original JSON, including nested
source entries and historical disposition metadata, remains unchanged in the external E and F
evidence registers.

### A22-Q01

Default research qualification is not external authentication. requireVerifiedIdentifiers=false and
minIndependentClaims=1 can qualify synthetic/unverified observations against the selected canonical
owner registry; no proof a real broker supplied or authenticated them.

Prohibited interpretation: UNIQUE_QUALIFIED_CANDIDATE is not authentic broker identity,
cryptographic source proof or verified live market membership.

Operational consequence: Treat default results as policy-qualified offline research assertions only.
All audit data, including recognized-class verifier tests, are synthetic.

Future dependency: Stronger authentication requires separately authorized evidence standards, actual
trusted authority validation and independent assessment; no live integration authorized.

### A22-Q02

Normalized scoped distinctness is not independent attestation. Different
scheme/scope/authority/value identities may count separately under policy without independent
external witnesses.

Prohibited interpretation: Two distinct claim identities are not statistical or organizational
independence and not two authenticated external sources.

Operational consequence: Do not use claim counts as confidence, source-independence or provenance
certificates.

Future dependency: Any stronger provenance guarantee needs separately governed independent
attestations and validation; changing a counter alone is insufficient.

### A22-Q03

Verified technical views do not create or replace Prompt21 approval authority. The existing P21
retained-view helper does not forward the verifier parameter; unsupported verified-history approval
paths remain unsupported.

Prohibited interpretation: A technically verified mapping is not an alternate maker-checker approval
or permission to bypass unsupported P21 approval reconstruction.

Operational consequence: Leave affected records unapproved for association; no replacement approval
engine, role or certificate.

Future dependency: Any accepted-owner interface change must be separately justified, explicitly
authorized, implemented and audited before expanding support.

### A22-Q04

Economic grouping is not contract equivalence. Shared canonical identity does not establish equal
contract specifications, complete tick/grid data, suitability, current availability or execution
eligibility.

Prohibited interpretation: A cross-broker economic group does not certify interchangeable contracts,
executable quantities/prices or live trading suitability.

Operational consequence: Retain individual source records and NOT_ESTABLISHED/false authority
fields; no executable conversion inferred.

Future dependency: Contract/suitability or availability qualification needs a separately authorized
specification, evidence and validation; no production/execution approval here.

### A22-Q05

A STORED researchApproved=true flag can expose historical Prompt21 selector approval even when
stored whole-observation outcome is INSUFFICIENT_EVIDENCE. It is not current whole-observation
approval or permission.

Prohibited interpretation: Never infer current approval, whole-observation consistency or
association permission from the historical boolean alone.

Operational consequence: Consumers must inspect scope and qualification; use current qualification
and the guarded association API. CURRENT may be false while STORED is true; unqualified records
remain excluded from groups.

Future dependency: Any stronger/unambiguous historical-approval API semantics require separately
authorized design/tests. Until then the scope-dependent interpretation is mandatory.

### A22-Q06

Operational qualification is bounded to the documented offline Linux research environment and
trusted implementations/root/single-writer assumptions. Windows, production throughput, physical
power-loss durability and stronger hostile-owner guarantees remain unqualified.

Prohibited interpretation: Readback/ACK is not fsync, power-loss safety, Windows production
certification, concurrent-writer or dishonest-root protection.

Operational consequence: Preserve unresolved obligations, fail-closed recovery and all F05/F06/T01
constraints; unsupported production use prohibited.

Future dependency: Separate platform, throughput, durability and trust-model qualification under
explicit authorization and independent verification.

### F05

Windows filesystem, locking, open-handle and durability execution remains unqualified.

Prohibited interpretation: No Windows production or durability certification.

Operational consequence: Use only documented qualified research environment; do not infer Windows
support.

Future dependency: Windows-specific execution/open-handle/filesystem qualification is outstanding.

### F06

Production capture/mapping throughput and physical power-loss durability are unqualified;
ACK/readback does not certify fsync.

Prohibited interpretation: No production scale, throughput SLA or crash/power-loss guarantee.

Operational consequence: Offline bounded loads only; retain physical durability limits.

Future dependency: Separate performance/load and power-loss/durability qualification.

### T01

Honest terminating trusted owner/repository/verifier implementations and structured certificates,
trusted root and applicable single writer are mandatory.

Prohibited interpretation: No guarantee against lying/nonterminating trusted issuers, replaced roots
or unauthorized concurrent writers.

Operational consequence: Keep trusted roots/ancestors and single-writer discipline; UNKNOWN remains
an obligation, not success.

Future dependency: A stronger adversarial trust/concurrency model requires separately authorized
architecture and validation.

### M02

Current governed registry/configuration/calendar context is not complete historical bitemporal
membership authority.

Prohibited interpretation: No historical membership certificate for arbitrary past governance.

Operational consequence: Interpret history under retained evidence and current accepted governance,
not invented past membership.

Future dependency: Separately authorized historical/bitemporal registry governance and evidence.

### O-C01

A genuine repository acknowledgement certifies its publication, not completion of every surrounding
compound callback operation.

Prohibited interpretation: No automatic success of an entire operation from one internal ACK.

Operational consequence: Track true durable commitment separately from parent operation/lifecycle
outcome.

Future dependency: Any broader atomic compound contract needs separate specification and tests.

### O-C02

Historical acknowledgement does not automatically imply current READY/HEALTHY or completed clean
shutdown.

Prohibited interpretation: No current health/shutdown success inferred solely from a past ACK.

Operational consequence: Require current diagnostics, fulfilled obligations and truthful lifecycle
results.

Future dependency: Future lifecycle expansion requires independent fault/recovery validation.

### Q01-A

Canonical parsed fixed-point/decimal identity is authenticated semantically, not as every original
raw decimal lexeme; physical byte limits remain distinct.

Prohibited interpretation: No byte-identical retention claim for every alternate decimal spelling.

Operational consequence: Keep semantic canonical equality separate from original raw text and
physical size enforcement.

Future dependency: Any stricter raw-lexeme contract must be explicitly designed and audited.

### Q-HIST

Current checker governance determines fresh recoverability. Honest historical approvals are not
retroactive fraud; future incompatible policies need not recover.

Prohibited interpretation: No full historical roles/bitemporal authority or guaranteed recovery
under every future configuration.

Operational consequence: Preserve historical evidence without silent migration or retrospective
reclassification.

Future dependency: Separately authorized historical authority model or explicit policy compatibility
evidence.

### Q-TICK

No complete tick-grid/tick-value/broker-contract/execution-suitability certification; preserved
original B003 remains failed.

Prohibited interpretation: No executable contract equality or suitability claim from research
metadata.

Operational consequence: Retain B003 as historical failure and the explicit qualified research
scope.

Future dependency: Independent tick/grid/contract validation under a separately authorized scope.

### Q-SELECTOR

Accepted P21 selector-specific canonical association does not establish agreement of every source
identifier; preserved original B005 remains failed.

Prohibited interpretation: Do not rewrite B005 as passing or treat P21 approval as P22 whole-record
consistency.

Operational consequence: P22 must separately enforce whole-observation qualification and current
association fences.

Future dependency: Any P21 semantic expansion requires separate authorization/audit and historical
evidence preservation.

### Q-T01

Trusted structured certificates and unsigned root fingerprints do not cryptographically authenticate
a dishonest issuer or fully replaced coherent root.

Prohibited interpretation: No independent cryptographic source authenticity from ordinary hashes or
trusted certificates alone.

Operational consequence: Use hashes as integrity identities within the stated trust model, not
signatures.

Future dependency: Separately authorized signed provenance/trust infrastructure and validation.

### INHERITED-OTHER

All additional accepted historical restrictions remain: bounded quality evidence; explicit
consumer-loss reconciliation; conservative source fences; unsupported legacy/native corrections;
volatile publication summaries/no universal exactly-once outbox; same-runtime Unicode qualification;
no automatic incompatible-root migration; and prior accepted audit qualifications.

Prohibited interpretation: No unbounded quality, silent loss repair, universal correction support,
exactly-once guarantee, cross-runtime Unicode certificate or automatic migration.

Operational consequence: Retain each original owner boundary and operational restriction; no general
source-reassignment or stronger durability claim.

Future dependency: Each future scope expansion requires a separately authorized specification and
independent validation.

### E-T01

Verification timing stability remains unqualified. CODEX-008E three-worker full runs each timed out
on a different unchanged owner test (1,732 passes/one timeout each). Both suites pass alone (five
cases). One complete two-worker run passes 1,733 tests/99 files.

Prohibited interpretation: Do not claim stable three-worker execution, repeated two-worker
reliability, a proved host root cause, production performance or unconditional CI reproducibility.

Operational consequence: For the proposed governance publication and bounded research verification
profile use VITEST_MAX_WORKERS=2 npm run verify with the complete suite and unchanged
timeouts/assertions. Evidence runtime: Linux, Node24.19.0/npm11.9.0, four-CPU quota. Isolated
diagnostics may use one worker but cannot substitute for the full gate. Preserve all failures. If a
required gate fails, diagnose and obtain a passing complete run before publishing; never weaken or
skip tests to pass.

Future dependency: Repeatability/runtime qualification requires future separately scoped evidence.
The successful two-worker run is an observed configuration, not certification of every supported
runtime or long-term stability.

### REVIEWER-PARTICIPATION

The technical reviewer/assistant participated in implementation, remediation and prior A–E audits;
the same assistant prepares this governance review. New adversarial harnesses do not establish
organizational independence.

Prohibited interpretation: No independent third-party certification, independent organizational
sign-off or external broker attestation may be claimed.

Operational consequence: Owner must explicitly acknowledge this participation and decide whether the
technical evidence is sufficient for the bounded scope; any required outside review is a reason to
DEFER, not something already supplied.

Future dependency: Separately commissioned organizationally independent assessment if required by
the owner.

### A23-Q01

The current strict schema has no dedicated minimum-notional currency binding. A supplied
volume.minimumNotional remains insufficient for exact comparison, even if another contract/canonical
currency is present.

Prohibited interpretation: Do not borrow currency, infer a default or treat an equal notional number
as fully interpretable monetary equivalence.

Operational consequence: Keep this fail-closed behavior. No schema extension or notional conversion
is authorized by governance acceptance.

Future dependency: Any stronger interpretation needs separately authorized schema/contracts and
independent verification.

### A23-Q02

Dependency explanation records consume existing maxComparisons. A comparison may now conservatively
reject when its full evidence exceeds the declared budget; exact/one-over behavior is intentional.

Prohibited interpretation: Do not truncate reasons, silently increase budgets, bypass controls or
characterize rejection as permission to compare with missing evidence.

Operational consequence: Retain fail-closed capacity, unchanged current resource budgets and full
evidence. No production memory/throughput qualification follows from bounded tests.

Future dependency: Any budget or performance change requires separate governed
implementation/validation.

### A23-Q03

Corrected computed comparison semantics and result fingerprints apply to eligible historical
records, while stored generation bodies, qualification/policy/source fingerprints and exact
derivation remain immutable. Compatibility is explicit; false-derived or incompatible histories fail
closed rather than migrate.

Prohibited interpretation: Do not rewrite history to make it pass, treat a changed computed
comparison fingerprint as a changed stored body, or infer universal historical recoverability.

Operational consequence: Preserve genuine stored evidence, explicit compatible-policy control,
current resource checks and old failed roots; version/reconcile only through authorized owner
contracts.

Future dependency: Future migrations or stronger historical guarantees need separate authorization
and validation.

### HISTORICAL-EVIDENCE

Original failed audits, developer-gate failures and harness assertions remain failed historical
evidence. Current E replays preserve original IJ5 and four rawEvidence assertion failures
separately; corrected controls and current-source invariant results are not retrospective passes.
Earlier P20/P21/P22 failures and authorized phase/manifest exceptions remain preserved.

Prohibited interpretation: Do not state every historical assertion passed or conceal original
source, assertions, raw failures, corrections, timing failures or deliberate parent negative-control
failures.

Operational consequence: Retain original indexes/bytes and separate raw executions, unique
meaningful cases, repetitions, harness errors and application failures. Current E new campaign:355
passes,342 distinct scenarios,13 repetitions; original A/C replays retain five historical harness
failures.

Future dependency: Future reviews must retain the same accounting and evidence identities; no
rewriting authorization is granted.

### RESEARCH-SCOPE

P23 acceptance would cover only deterministic offline specification research, declared metadata
validation, versioned history, dependency-aware research comparison, immutable evidence/governed
recovery and bounded read-only research queries.

Prohibited interpretation: No externally authenticated live broker specifications, economic
interchangeability, actual availability, margin sufficiency, execution suitability, financial
authority, trading, live MT5/broker connectivity or production certification.

Operational consequence: Keep all authority boundaries and false/NOT_ESTABLISHED fields. Exact
matching is under recorded supported units/policy, not full profile completeness or universal
equivalence. Prompt24 remains unauthorized and implementation/capability files remain unchanged.

Future dependency: Any scope expansion, deployment, connectivity, execution or future-prompt work
requires separate explicit authorization and qualification.

## Prompt 25 additional mandatory qualifications

- **C-Q01:** Historical PAUSED shutdown intent cannot be independently authenticated from retained
  evidence.
- **C-Q02:** Finite history capacity may retain unresolved obligations. No capacity bypass or silent
  debt clearance is permitted.
- **M-Q01 / retained L-Q01:** Negative Result provenance is volatile. Following recovery, even a
  genuinely published negative exclusion is restricted from new authority-dependent operations. A
  separately governed universe is required for fresh authorization. No retrospective authentication,
  missing-envelope invention, checkpoint rewriting or migration is approved.
- **M-Q02:** Historical computed VERIFIED and coverage values describe publication facts, not
  current authorization. Consumers must use the explicit current-authority and current-coverage
  fields and current source-health axes.
- **Included-zero-event limitation:** Accepted P19 constructors do not establish a supported
  included zero-event replay.
- **Missing historical native envelope:** Exact old genuine-negative and malformed-negative
  histories can have identical bytes and fingerprints; no retained hash establishes their missing
  original native provenance.
- **F05 (explicit retention):** Windows filesystem/open-handle behavior remains unqualified.
- **F06 (explicit retention):** Production throughput and actual power-loss durability remain
  unqualified; ACK/readback is not fsync certification.
- **T01 (explicit retention):** Trusted, honest, terminating owners/repositories/certificates,
  trusted root and applicable single-writer assumptions remain necessary.
- **E-T01 (explicit retention):** Previously recorded timing uncertainty remains inherited; preserve
  unchanged two-worker verification, assertions, limits and failures.
- **Reviewer participation:** The same assistant participated in implementation, remediation, prior
  audits and this governance preparation. Organizational independence and external certification are
  not claimed.

All 25 inherited entries above remain separate and verbatim. Historical references to future-prompt
authorization are historical context; only separately explicit owner authorization permits
progression. This proposal does not authorize Prompt 26.

## Cadence receipts, contiguous progress and continuation

For SECONDS and SCHEDULE, a direct DEADLINE request acknowledges only its own boundary. It does not
certify earlier slots. The runtime derives a contiguous represented prefix from authenticated
request receipts, starting at the governed anchor. A valid explicit schedule skip also represents
its slot. The legacy schema-v1 `deadlines` field retains its historical last-request meaning and
grants no prefix authority. No journal migration or rewriting is performed.

`coverage().cadence` separates `latestRequestedBoundary`, `contiguousThrough`, `requiredDue`,
`representedDue`, `nextBoundary` (epoch milliseconds), and `unrepresentedDue` per cadence
subscription. `unrepresentedCadenceDue` totals missing due receipts separately from acknowledged
pending owner work. Counts use bounded retained receipts and arithmetic over the schedule, rather
than iterating all elapsed slots. Future slots and slots beyond a schedule's end are excluded. A
cadence becomes active after START. A historical STOPPED view uses its recorded STOP time; later
logical time does not create new obligations in a stopped run.

`advance()` captures one logical-time cutoff and admits the earliest missing slots. Already
represented later direct requests are retained and not admitted again. Existing catch-up, queue,
history, owner-call and checkpoint limits still apply. Represented slots can share the same genuine
MOSE observation; the scanner does not manufacture market events to fill timing gaps.

`remainingNotProcessed=true` means due cadence receipts remain unrepresented at that batch's cutoff.
This includes a failed attempted slot that needs retry and any unattempted due slots. A false value
certifies only that no due receipts are missing, not that pending work has completed or every child
operation succeeded. Always inspect child Results/dispositions. Preview/source failure, NONE,
UNKNOWN and capacity deferral retain their own outcomes. UNKNOWN requires reconciliation; it is
never normalized to NONE. PAUSED, STOP-fenced, uninitialized and reentrant advance calls return a
failing outer Result, not an empty successful batch.

Missing due receipts produce NOT_READY/DEGRADED diagnostics without converting normal pending
schedule work into corruption. STOP rejects missing cadence debt before installing its ordinary
retained-work fence, so a caller can advance the missing slots, drain actual owner work, and retry
STOP. Once the existing STOP fence has been installed by a concurrent/in-flight operation, fresh
recovery may be required to admit further receipts. Repeated STOP cannot erase unresolved debt. A
historical STOPPED journal with gaps is preserved as historical evidence but cannot obtain a new
successful shutdown certification. It is not resumed or silently repaired; use a separately governed
research run if needed.

Queue round robin applies to admitted work. Admission across subscriptions remains lexicographic and
does not promise global fairness under continuously advancing time. For finite catch-up, hold
logical time fixed, handle child failures and repeatedly drain until continuation is false. This
operational restriction does not excuse missing receipts or false continuation. All inherited
offline-only, trusted-owner, single-writer, Windows and durability qualifications still apply.
