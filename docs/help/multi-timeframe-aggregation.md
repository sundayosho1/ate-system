# Multi-Timeframe Aggregation

## Purpose and scope

`@ate/multitimeframe` provides bounded offline research aggregation. It cannot authorize research
eligibility or trading. It uses Prompt 13 observations, Prompt 6 UTC/virtual clocks and timezone
resolution, Prompt 15 quality report pointers and Prompt 5 derived-state ownership. Historical
materialization, quality assessment and catalogue registration remain separate governed operations.
No commercial connection or universal instrument/session intelligence is supplied.

## Setup and operation

Install the committed workspace using Node >=22, npm >=10 and `npm ci`. Apply settings through
existing configuration version, approval and promotion authorities, then call `optionsFromEffective`
and `materialPolicyFromEffective`. Pass both outputs and the effective configuration fingerprint to
`AggregationEngine`. Configure an explicit trusted single-writer repository root. Register derived
state using `registerAggregationAuthority`; register `aggregationControlEvent` with the existing
EventFactory registry. `AggregationRuntimeService.managedService` integrates initialize, stop,
health and readiness with Prompt 3. Do not initialize a service twice.

Register an immutable source/instrument/channel/basis stream. `ingest` accepts canonical input plus
trusted ingestion evidence. `consumeRealtime` and `consumeHistorical` are bounded page adapters, not
autonomous pumps. The caller owns consumer lifetime and detachment; no timers are installed.
`publishWindow` publishes provisional research content or, when explicitly requested, finalized
content. Finalization requires trusted scoped continuity or end-of-stream evidence passed to
`watermark`. EOS evidence is a contract with the caller, not something inferred from last price.
`fence` records disconnect, drop, stale source or uncertain continuity. Reconciliation is explicit;
startup fences continuity until this is supplied. Call stop and inspect its result before claiming
successful shutdown. An unresolved operation obligation requires fresh recovery, not retry in the
same failed service.

## Registry, boundaries and calendar

Fixed standards: S1/S5/S15/S30 (disabled by default), M1/M5/M15/M30/H1/H4/H6/H12. Calendar
standards: D1/W1/MN1. Custom fixed definitions are bounded to 1 second–7 days, integer seconds,
versioned code and anchor. Every window is half-open `[start,end)`. UTC anchors use mathematical
floor including negative epochs. SESSION_OPEN requires an explicit session schedule. Calendar
periods use local midnight, Monday week start by default and true month boundaries; day duration can
be 23/25 hours. Ambiguous local boundaries default to REJECT; EARLIER/LATER is explicit. Nonexistent
local times reject. The Prompt 6 IANA authority owns DST.

Policies are UTC_CONTINUOUS, TIMEZONE_CALENDAR or EXPLICIT_SESSION_SCHEDULE. The latter supplies
bounded dated UTC open/close/break records, a session date (including overnight ownership), holidays
and weekdays. Fixed and daily windows clip at session/break boundaries; weekly/monthly scheduled
windows span the eligible dated session collection. Empty periods do not fabricate bars. Historical
exchange calendar generation and automatic instrument calendar selection are outside this package.
Version every schedule. Calendar/configuration mismatch rejects restart recovery.

## Construction and evidence

LAST_TRADE, BID, ASK and MIDPOINT are separate stream identities. Midpoint reuses canonical
transformation. Decimal price input is bounded to 60 digits and 18 fractional digits; aggregation
uses decimal precision 128 without floating price arithmetic. Canonical negative/zero prices remain
valid when the upstream contract permits them. TRADE_VOLUME retains explicit units; TICK_VOLUME and
QUOTE_COUNT use canonical TICKS count units; NOT_AVAILABLE stays unknown, never zero. Incompatible
units reject. Canonical finalized source bars require explicit `aggregation.pricebasis` metadata;
complete coverage requires `aggregation.coverage=COMPLETE_COVERAGE`, independent of canonical FINAL
state. Source bar `revisionOf` replaces only the matching observation and interval; overlap or
point/bar mixing rejects.

Direct targets and hierarchical parents are disjoint. Hierarchical fixed parents require aligned,
integral duration multiples and exactly contiguous complete child coverage. Calendar parents require
exact scheduled segment coverage, including explicit closure exclusions. Missing or provisional
children cannot yield an apparently complete final parent. Quality annotations, warning and finding
references (report fingerprint included), suppression counts and availability uncertainty propagate.
No new score is calculated. Equal-time events require trustworthy sequence; stable identity ordering
is deterministic but marked uncertain when economic order is unknown.

## Finality, corrections and queries

Time elapsed is separate from finality, coverage and quality. A maximum event timestamp is never a
watermark. Continuity evidence subtracts allowed lateness; EOS uses its explicit through value.
Scope includes source, instrument, channel, basis and session. Reconnect cannot advance another
stream or reconcile itself. Corrections within horizon create immutable parented revisions and
update only actual graph dependents. Earlier revisions and their point-in-time knowledge stay
intact. Recompute is idempotent for unchanged eligible content and lineage.

`snapshot` distinguishes asOf market time and cutoff knowledge time. Default VERIFIED_POINT_IN_TIME
requires actual committed publication, finality and credible availability by cutoff. Historical
input without source publication evidence is UNKNOWN, even if a caller labels it VERIFIED.
EVENT_TIME_RECONSTRUCTION explicitly permits unknown historic knowledge evidence; this is not a
verified backtest. Inclusion of provisional/incomplete content must be explicit. Snapshot results
include exact revisions, windows, missing reasons, staleness, lineage and fingerprints. Parent-child
revision conflict returns missing evidence. `history` is bounded pagination. Queries never
reconstruct future knowledge from corrected state. Recovery publication uses the recovery clock,
never window end.

## Persistence, failures and resource bounds

Full checkpoints contain active windows, watermarks, immutable history and dependency contributions.
Stable operation IDs bind generation and content. The filesystem repository writes bounded content
through fsync/temp/rename then a separate publication marker. Failure before mutation can certify
CONFIRMED_NOT_COMMITTED; every other commit failure is UNKNOWN_COMMITMENT. Committed publication
failures retain COMMITTED obligation. Reentrant stop returns failure and cannot conceal these
obligations; repeated stop preserves failure. Fresh recovery validates integrity and publishes
pending commitment. Unknown/temp/corrupt artifacts remain evidence and fail recovery closed. Do not
delete them to hide an error. Filesystem API success is not a power-loss guarantee; directory
durability and Windows open handles are unqualified. A root must be trusted and single-writer. This
contract does not support hostile writers.

Limits reject before mutation rather than truncate input, revisions or lineage. Pull notification
queue is bounded; overflow is visible, and committed revisions remain queryable. Treat notification
loss as requiring history reconciliation; it is not proof of missing persisted market input.
Diagnostics are bounded and include eviction counts. Recovery obligations are independent of
evictable diagnostic history. No automatic unbounded retention or eviction exists: rotate roots only
through governed research workflow. Synchronous I/O is bounded in content, not production latency;
no throughput or deployment claim is made.

## Configuration reference

All keys below are prefixed `data.multitimeframe.`; scope SYSTEM/ENVIRONMENT, fail closed, REPLACE
merge, INTERNAL sensitivity, RESTART. Numeric values are safe integers. Material policy is included
in identity; no in-place reinterpretation of retained history is supported.

| Setting                     | Default  | Range          | Effect                                                                         |
| --------------------------- | -------- | -------------- | ------------------------------------------------------------------------------ |
| enabled                     | false    | boolean        | Enable offline aggregation only.                                               |
| allowedLatenessMs           | 5000     | 0–86400000     | Subtract lateness from justified stream event progression.                     |
| correctionHorizonMs         | 86400000 | 1000–604800000 | Reject corrections older than this bounded window.                             |
| maxStreams                  | 16       | 1–128          | Bound source/instrument/channel/basis streams.                                 |
| maxInstruments              | 16       | 1–128          | Bound unique instrument identities.                                            |
| maxTimeframes               | 16       | 1–32           | Bound configured timeframes.                                                   |
| maxWindows                  | 256      | 1–10000        | Bound retained windows including correction inputs.                            |
| maxContributions            | 1024     | 1–10000        | Bound contributions per window; reject rather than truncate lineage.           |
| maxRevisions                | 2048     | 1–10000        | Bound immutable revision history; never evict requested history silently.      |
| maxEvidence                 | 100      | 1–1000         | Bound diagnostic samples; retain obligations separately.                       |
| maxSnapshotTimeframes       | 16       | 1–32           | Bound snapshot selection count.                                                |
| maxQueryResults             | 100      | 1–1000         | Bound history pagination and results.                                          |
| maxQueryScan                | 10000    | 1–10000        | Bound deterministic revision scans; reject beyond budget.                      |
| maxSnapshotAgeMs            | 86400000 | 0–604800000    | Maximum default snapshot age.                                                  |
| maxCheckpointBytes          | 10485760 | 4096–67108864  | Bound checkpoint serialization and recovery reads.                             |
| consumerCapacity            | 64       | 1–1000         | Bound pull-consumer publication IDs; overflow requires history reconciliation. |
| allowProvisionalSnapshots   | false    | boolean        | Permit explicitly requested provisional research revisions.                    |
| requireAvailabilityEvidence | true     | boolean        | Verified point-in-time always requires credible source availability.           |

| Setting                                | Default | Range                          | Effect                                     |
| -------------------------------------- | ------- | ------------------------------ | ------------------------------------------ |
| policyJson                             | `{}`    | Strict JSON <=65536 characters | Versioned calendar, timeframe definitions, |
| direct targets and construction edges. |

Cross-field constraints: correction horizon >= lateness; snapshot timeframe limit <= registry limit.
Registry count <= maxTimeframes; unique parents, aligned reachable acyclic edges; no direct/parent
mixing. Policy JSON fields are calendar, timeframes, directTimeframes, edges; unknown fields reject.
Calendar and registry schemas are exported. Invalid material policy rejects startup before
observations. Stream basis, units and source fingerprint are explicit immutable registration values,
not hidden defaults. `requireAvailabilityEvidence=false` cannot weaken VERIFIED_POINT_IN_TIME
queries: source uncertainty still requires explicit EVENT_TIME_RECONSTRUCTION. All real policies and
fingerprints must be retained.

## Troubleshooting

FINALITY_EVIDENCE: inspect scoped watermark, session, continuity and window end; do not advance
clock as a substitute for evidence. INCOMPLETE_COVERAGE: inspect constituent intervals and quality
evidence. UNVERIFIED_AVAILABILITY: historical evidence lacks source publication; use explicitly
labeled research reconstruction or obtain authoritative publication metadata. REVISION_CONFLICT:
reconcile dependent parents before claiming synchronized snapshot. RECOVERY_REQUIRED: preserve
operation ID and root; use fresh service with identical policies after trusted inspection.
STATE_LIMIT/CONTRIBUTION_LIMIT: reduce research scope or raise governed limits within ranges; do not
drop inputs silently.

## Verification and restrictions

`npm run verify`, full/production `npm audit`, `npm ls --all`, and the permanent tests under
`tests/multitimeframe` cover bounded offline behavior. F05 Windows qualification and F06 production
throughput/power-loss durability remain outstanding. T01 trusted repositories/no-mutation
certificates, single-writer and trusted-root requirements remain mandatory. Prompt 18 independent
review is separate from implementation; Prompt 19 remains unimplemented.

`canonicalBar` projects revisions to Prompt 13 BAR observations. Rich quality and lineage evidence
is retained in the immutable revision, linked by metadata hashes and counts; canonical annotations
retain their existing vocabulary. No unsupported quality label or automatic score is introduced.

Historical consumption returns `count` and `nextCursor`; callers must retain and pass continuation.
Real-time consumption takes an existing Prompt 17 consumer and explicit capture/ingress artifact
identity. Reconciliation resets the per-session sequence baseline. Unknown continuity corrections
append INVALIDATED provisional revisions and exclude superseded final bars at new cutoffs until
explicit finality reconciliation. Earlier knowledge-cutoff queries retain their prior result.
Calendar fingerprints include Node timezone data version; recover with matching governed runtime and
calendar authority.

## CODEX-003B corrected research contracts

These corrections retain version `0.18.0-multitimeframe.1`. They await independent re-audit;
implementation and passing tests do not grant acceptance or permit Prompt 19.

### Ordering and market chronology

Within a stream, sort by event timestamp, then a fixed sequence-presence rank (sequenced first),
then numeric sequence, canonical observation identity and content identity using ordinal string
comparison. Equal valid sequences use identity as the deterministic tie-break. Missing, mixed or
numerically equal sequences at an equal timestamp retain `ORDERING_UNCERTAIN`. These rules construct
reproducible OHLC and lineage; they do not certify historical provider chronology. Conflicting
canonical duplicates still reject and fence their source; source scopes never mix.

### Canonical quality handoff

`canonicalBar` carries an immutable self-contained quality manifest in
`aggregation.qualitymanifest`, with its `aggregation.qualitymanifestfingerprint`. The payload binds
the source revision, source fingerprint, lineage, coverage, availability, report/finding references
and suppressed counts. Canonical schema limits govern the representation: at most 16 chunks of 256
characters, 4,096 encoded bytes, 128 quality strings and 128 suppression references. No evidence is
truncated. An oversized projection raises `QUALITY_HANDOFF_BOUNDS`; retain the original full
revision and resolve the workload within these supported bounds. This implementation does not
provide an external evidence-manifest resolver.

Ingestion verifies manifest integrity and binding, retains the complete inherited manifest in the
checkpoint and propagates adverse findings and unknowns. Missing/corrupt required payloads return
`INHERITED_QUALITY_INTEGRITY`, admit no contribution and fence the affected source. Suppressed
findings are counted once per immutable report identity (report ID plus fingerprint), including
references repeated through different child bars. Conflicting counts for the same reference reject
with `SUPPRESSION_CONFLICT`; arithmetic overflow rejects rather than coercing. Zero-finding
assessments still retain their report references. Legacy revisions without typed suppression
membership use an explicitly identified legacy aggregate/contribution reference; this preserves
their recorded count without inventing missing assessment membership.

Source checkpoints remain readable without a new application or checkpoint version. A legacy
aggregate-to-aggregate checkpoint that already lost its inherited manifest cannot certify that
missing evidence: startup fails closed. Reproject from the original verified immutable source
revision into an explicitly governed fresh downstream run; do not erase or silently rewrite the old
history. A legacy canonical BAR carrying only hashes cannot be ingested as complete evidence. Prompt
15 remains the assessment authority; aggregation does not assign quality scores.

### Filesystem operation capacity

`FilesystemAggregationRepository.maxOperations` counts distinct operation IDs, not files.
Registration consumes one slot. Each slot reserves `.json`, `.visible` and their two temporary
paths; publishing an admitted operation requires no second slot. Admission, publication and recovery
apply the same inventory contract. Unknown artifacts, orphan markers/content temps, unsafe paths and
oversized artifacts fail closed, without deleting evidence. Temporary artifacts associated with a
committed operation remain accounted to that operation.

At capacity, new work rejects before mutation with `CONFIRMED_NOT_COMMITTED`. This certifies only
that attempt, not absence of prior artifacts. Existing acknowledgments remain recoverable with
unchanged limits. Lowering capacity below existing operation count fails recovery; a verified larger
limit is compatible. Leave room for ingestion, watermarks, publication, corrections and shutdown
checkpoints. Capacity rejection can prevent a shutdown checkpoint; shutdown must report failure. If
a rejected input/loss fence cannot persist, health fails closed until fresh recovery. No automatic
artifact deletion or history compaction is provided. Single-writer/trusted-root, Windows and
power-loss durability restrictions still apply.

### Correction horizon and finalized history

The horizon remains anchored to `window.end` and immutable evidence that the window was ever
finalized. Invalidation and restart do not reset it. Direct late ingestion, canonical replacement,
recomputation, dependent-parent changes and re-finalization enforce the same eligibility.
Reconciliation repairs source continuity only; it does not extend correction eligibility. An expired
finalized window cannot be republished/recomputed through the public revision path; read its
existing immutable history instead. Initial construction of an old historical window without
finalized history remains possible, with truthful availability/coverage classification.

### Realtime consumer loss and reconciliation

`consumeRealtime` observes rejection counts, degradation and counter-derived discarded backlog
before and after each awaited read. Prompt 17 exposes no rejected observation's source/subscription
or actual loss timestamp, so such channel-level loss/closure has `UNKNOWN_CHANNEL_SCOPE`. Every
registered source/instrument/subscription scope in this engine is potentially affected and is
conservatively fenced. Retained sequence-less observations cannot restore complete finality. Scoped
observation warnings still affect their own stream; healthy source progression does not clear other
fences. Loss diagnostics record the clock's observation time, not an invented loss time.

Bounded `consumerLosses` checkpoint evidence is keyed by consumer ID and consumption context (source
fingerprint and artifact identity). Actual new channel instances, including reused names and
counters, trigger a fresh conservative observation. Evidence histories remain in immutable operation
records; new observations never clear existing source fences. Repeated drains do not clear
continuity. After justified reconciliation through existing watermark authority, replaying
already-observed counters does not fence again; new loss or a newly observed channel does. Fresh
startup always fences recovered sources. New potentially affected registered scopes are included on
the next channel observation. Closed channels require explicit justified post-closure reconciliation
before finality, even when an exact discarded count is zero.

Loss-record count is bounded by `maxEvidence`; checkpoint size by `maxCheckpointBytes`. Exhaustion
or failed persistence makes the engine not ready rather than dropping evidence and continuing with
complete coverage. Loss scope is intentionally conservative; a future richer source-scoped contract
would require a separately reviewed change to Prompt 17.

### AS_KNOWN and historical registry context

Default `AS_KNOWN` selects the latest eligible verified revision, not necessarily the newest known
revision. If a known same-window successor is ineligible, retain compatible selection and expose
`warnings[timeframe] = KNOWN_INELIGIBLE_SUCCESSOR`. An explicit event-time reconstruction may select
unverified data, labeled accordingly. `INITIAL_ONLY` intentionally selects eligible original history
and does not add this AS_KNOWN warning. Hierarchical lineage conflicts still produce
`REVISION_CONFLICT`; a warning cannot authorize inconsistent parent/child generations.

The verified point-in-time guarantee applies to revision knowledge within the current governed
stream registry, calendar and configuration context. The registry is not bitemporal: registering a
stream later can change a past-cutoff unknown-scope error into an empty scoped response. This never
makes future revisions eligible and is not historical registration-availability certification.
Consumers needing bitemporal registry membership need a separately authorized authority.

### Native correction and volume boundaries

Native Prompt 13 `MarketDataCorrection` records are separate from `MarketObservation` and are not
accepted by this ingestion API. Do not claim trade cancellation/replacement support. Canonical
`BAR.revisionOf` replacement and ordinary late observation corrections are supported within their
horizon and integrity contracts. No new native correction subsystem was introduced. Required
canonical volume class/quantity/unit is checked before contribution admission. A missing matching
measure returns `VOLUME_MISSING`; no fabricated zero-volume aggregate is published.
