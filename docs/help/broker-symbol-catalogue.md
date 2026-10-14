# Offline broker symbol discovery and catalogue laboratory

Prompt 21, `@ate/broker-symbol-catalogue`, version `0.21.0-broker-symbol-catalogue.1`.
Implementation is pending independent technical audit and governance acceptance.

**DISCOVERED ≠ CANONICALLY MATCHED ≠ AVAILABLE NOW ≠ SUITABLE ≠ AUTHORIZED TO TRADE.**

## Meaning and source boundaries

Discovery here means importing a bounded, recorded catalogue. Names may differ through case, source
formatting or declared suffixes. Examples `EURUSD`, `EURUSD.a`, `US30.cash` are synthetic
illustrations, not broker facts. A displayed broker label is not verified broker identity; a
terminal fixture ID is not a session. Recorded listing, visibility and source-declared trade mode
never establish current availability or permission. There is no terminal connection, login,
credential, account, network discovery or order API. Do not supply secrets or account information in
fixtures.

## Preparing a fixture

Use governed JSON or an equivalent native JSON-shaped object, schema version 1. The following is a
complete synthetic minimal fixture; missing broker metadata remains missing. The source hash is a
source declaration, not independently verified truth; the laboratory separately computes its exact
prepared-input fingerprint. Obtain real recorded exports only through separately authorized offline
procedures; this module does not connect to MT5 or translate arbitrary vendor schemas.

```json
{
  "schemaVersion": 1,
  "namespace": {
    "brokerNamespaceId": "synthetic-broker",
    "sourceSystem": "SYNTHETIC",
    "brokerLabel": "Synthetic broker",
    "terminalFixtureId": "fixture-1",
    "catalogueSourceId": "catalogue-1"
  },
  "batchId": "batch-1",
  "source": {
    "reference": "offline-fixture-1",
    "contentFingerprint": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    "quality": "SYNTHETIC",
    "completeness": "PARTIAL",
    "timeQuality": "UNKNOWN"
  },
  "records": [{ "rawSymbol": "EURUSD.a", "digits": 5, "point": "0.00001" }]
}
```

Optional record fields: description/path/native ID, declared category/family,
base/quote/profit/margin currency, underlying/venue/contract/expiry, digits/point/tick
size/quotation unit/minimum increment, contract size/volume step/minimum/maximum/limit, calculation
mode, listed/visible/trade mode/session marker, observed time and scoped identifiers. Decimal
strings preserve source spelling (`1.00` remains `1.00`); no floats or negative volume are accepted.
A declared category is not canonical classification. Use `declaredFamily: "UNKNOWN"` for an
unqualified family while retaining the actual category in `declaredAssetCategory`. Unsupported
formal family enums reject the whole batch.

Records are sorted deterministically by exact raw symbol. Duplicate raw symbols or native IDs,
unknown fields, credentials, invalid Unicode/control text, boundary symbol whitespace, unsafe
objects, sparse arrays, undefined values, cycles, proxies, getters and resource excess reject the
entire batch with commitment `NONE`. JSON duplicate members, including escaped-equivalent keys,
reject before parsing can discard evidence. Do not remove rejected records and imply full coverage.

## Configuration and permissions

Host composition supplies an existing `EffectiveConfiguration`, runtime `Clock`, initialized P20
`InstrumentRegistry`, its unchanged effective configuration, `StateAuthorityRegistry`, existing
`ApprovalAuthorityResolver` and catalogue repository. Register
`brokerCatalogueConfigurationDefinitions(clock)` and `brokerCatalogueConfigurationSchemas(clock)`
with the existing configuration owners; supply complete JSON under `broker.catalogue.policyJson`.
Register `brokerCatalogueStateOwnership()` with the existing persistence authority. No accepted
foundational configuration is silently changed. `policyFromEffective` rejects conflicts, missing
policy and drift. Config scopes are SYSTEM/ENVIRONMENT, fail closed, restart required; changing
policy does not reinterpret an existing root and requires separately reviewed migration/new root.

Use the exact exported `defaultPolicy` below or a separately governed complete policy:

<!-- default-policy:start -->

```ts
export const defaultPolicy: Policy = freeze({
  version: 1,
  rules: [
    { id: "exact", version: "B1", case: "EXACT", suffixes: [] },
    { id: "case", version: "B1", case: "CASE", suffixes: [] },
  ],
  allowedSourceSystems: ["SYNTHETIC", "RECORDED_MT5_EXPORT", "RECORDED_OTHER"],
  allowedQuality: ["SYNTHETIC", "UNVERIFIED_RECORDED"],
  maxNamespaces: 16,
  maxCataloguesPerNamespace: 16,
  maxRecordsPerCatalogue: 256,
  maxSourceBytes: 1048576,
  maxRecordBytes: 8192,
  maxSnapshots: 128,
  maxSnapshotBytes: 4194304,
  maxRetainedBytes: 67108864,
  maxProposals: 128,
  maxDecisions: 256,
  maxDifferences: 512,
  maxQueryResults: 100,
  maxRegistryHistory: 512,
  staleAfterMs: 86400000,
  approvalPolicyId: "broker.catalogue.research",
});
```

<!-- default-policy:end -->

Definitions are opt-in through existing owners. Import does not require a checker. Mapping review
requires an identified USER maker and different identified USER checker, authorization for
`CONFIGURATION_CHECKER` under `broker.catalogue.research` (or governed replacement), RESEARCH mode
and matching actor/time certificate. Supplied authority resolvers and repository implementations
must comply with T01; no arbitrary callback can grant trading authority.

All limits are explicit: namespace/version/record counts; source and per-record UTF-8 bytes;
retained generation count, snapshot and cumulative bytes; proposal/decision/difference/query/history
counts; finite rule/suffix counts; depth 20; freshness milliseconds. Excess rejects before
repository entry. Evidence is never silently evicted. Filesystem repository limits must be at least
as strict as the policy's physical storage bounds. New roots require explicit ownership,
trusted-root and single writer restrictions. Do not share a root with another writer or another
state owner.

## Import and inspection

Create `new BrokerSymbolCatalogue(laboratoryId, ports)`; call `await initialize()` and check
`result.ok` before use. Invoke `await importJson(jsonText)` or `await importNative(batch)` and check
the result. All operations return structured `ok/value` or `error/code/commitment`. Repository
acknowledgement must return the exact candidate full snapshot. A trusted NONE outcome leaves the old
snapshot queryable; UNKNOWN fences the service. Input fingerprint covers the canonically sorted
prepared batch, and source-declared fingerprint is retained independently.

Use `catalogue(catalogueFingerprint)` to inspect exact raw records, source evidence, keys, quality,
clock and lineage. `snapshot()` returns the current root, `snapshot(fullFingerprint)` exact retained
history; an unknown reference never falls back to latest. `query({kind, offset: 0, limit: 20, ...})`
supports NAMESPACES, CATALOGUES, OBSERVATIONS, MAPPINGS, UNRESOLVED and HISTORY. Catalogue
fingerprint, namespace key, exact raw symbol, normalized key, declared family and version filters
select bounded pages; `nextOffset` is null on the last page. Raw symbols and keys are exact
comparisons. Query-time freshness is derived separately; the immutable catalogue remains unchanged.

Observation states include LISTED_IN_CATALOGUE, SOURCE_STATUS_UNKNOWN, SOURCE_DECLARED_VISIBLE,
SOURCE_DECLARED_HIDDEN, SOURCE_DECLARED_DISABLED and OBSERVATION_CONFLICT. A contradictory
`listed: false` is retained as NOT_LISTED_IN_OBSERVED_CATALOGUE plus conflict, rather than erased.
These states describe recorded declarations, never “open now”.

## Normalization and ambiguity

B1 uses P20 N1 exact/case normalization, bounded explicit suffix removal, then one N1 validation and
stable-key check. It retains the raw symbol, rule ID, B1/N1 versions and removed suffix. Default
rules remove no suffixes. A CASE suffix must already be uppercase/NFC. Duplicate, overlapping,
empty, unstable or resource-exhausting rules reject. `.A` under an explicit CASE rule can make
`EURUSD` and `EURUSD.a` share a comparison key; both observations and collision evidence remain. No
first-winner selection, regex-program rule, recursive stripping or economic identity inference.

## Proposals and review

`await propose({catalogueFingerprint, rawSymbol, selector, maker, reason})` binds an exact
observation and an actual retained P20 snapshot. IDENTIFIER selectors use the record's scoped
identifier at an explicit index. NORMALIZED_KEY selectors use an explicit rule ID and alias kind,
queried with P20 EXACT semantics because the key has already been transformed. Normalization-only
matches remain LOOKUP_ONLY/NEEDS_REVIEW and cannot receive association approval; add explicit
independent scoped identity claim evidence in a new governed observation/proposal rather than
treating the suffix as proof. Real P20 candidates, revisions, resolver evidence/status/reason and
snapshot identity are retained. Classification/currency contradictions remain MAPPING_CONFLICT;
observation-quality conflicts remain INVALID_SOURCE_OBSERVATION. Empty, unsupported or ambiguous
identity claims are unresolved; multiple candidates cannot be approved by selecting the first.

`mapping(proposalId)` returns the immutable proposal, all review decisions, current effective state
and staleness reasons.
`await review(proposalId,{checker,state,reason,selectedCandidate?,supersededBy?})` records separate
immutable decisions. States: PROPOSED, NEEDS_REVIEW, AMBIGUOUS, REJECTED,
APPROVED_FOR_RESEARCH_ASSOCIATION, SUPERSEDED, EXPIRED_OR_STALE. Research approval requires the
actual unique scoped-identifier candidate, independent checker, nonconflicting observation and
current catalogue/registry evidence. REJECTED/SUPERSEDED/EXPIRED_OR_STALE decisions cannot be
revived; create a new proposal. Supersession must name a different proposal for the same
namespace/raw symbol.

`associateCatalogueResearchEvidence(lab,registry,{proposalId,owner,ownerReference,ownerFingerprint})`
creates a new opt-in research reference through P20's public owner API after approval. The caller
still authenticates its data/capture/aggregation/replay artifact with its own owner. This API
neither certifies external content nor changes its ID/fingerprint. Research approval never
authorizes orders.

## Comparing versions and brokers

`compare(beforeCatalogueFingerprint,afterCatalogueFingerprint)` reports deterministic bounded added,
removed/uncertain absence, metadata (including precision/volume/status/category), source-native
rename and new normalization-collision evidence. Rename requires supplied stable native identity,
same namespace and declared COMPLETE later coverage. PARTIAL or cross-namespace absence stays
NOT_OBSERVED_IN_PARTIAL_CATALOGUE; no delisting or rename inference is made from symbol similarity.
Source/provenance and recorded/current mapping evidence are exposed alongside differences. Registry
candidate or metadata similarity never establishes economic equivalence between broker symbols.

## Staleness and diagnostics

UNKNOWN means no qualified observation time; FRESH_EVIDENCE means only age within the governed
threshold; STALE_EVIDENCE and FUTURE_EVIDENCE are explicit. Import/publication/source/query times
are different. Catalogue supersession, changed current registry snapshot, stale or future source
evidence makes a prior proposal EXPIRED_OR_STALE in the current view, without deleting its
historical decision. `availabilityNow` remains NOT_ESTABLISHED. No host-wall-clock fallback: use the
accepted Clock owner.

`diagnostics()` reports lifecycle, readiness/health, busy pending count, generation/full
fingerprint, last bounded error and recovery flag. Busy or drifted services are NOT_READY/DEGRADED.
Invalid input is side-effect-free NONE and allows valid retry. Do not interpret historical
acknowledgement as current readiness, a successful callback as acknowledgement, or a caught error as
safe recovery.

## Recovery and shutdown

Use MemoryCatalogueRepository for bounded ephemeral research or FilesystemCatalogueRepository for
immutable trusted-root publication/readback. Each immutable generation has a predecessor full hash.
`await stop()` is repeatable after a clean stop and rejects BUSY during an outstanding callback.
UNKNOWN returns RECOVERY_REQUIRED even on repeated stop; queries and new writes remain fenced. Stop
the original writer, inspect/preserve the intact root, create a fresh service with identical
governance and initialize. Query recovered records while the reader is RUNNING/READY, then stop. Do
not query after reader shutdown and interpret rejection as failed recovery.

Pending files, generation gaps, malformed/truncated/rehashed history, namespace substitution and
invalid owner evidence fail closed. Uncertain artifacts are never silently deleted. There is no
repair API, automatic incompatible-root migration, durable global outbox, distributed writer or
universal exactly-once guarantee. Reference repositories certify publication/readback, not fsync.

## Qualifications and exclusions

F05: Windows execution, open handles and filesystem durability unqualified. F06: synchronous
throughput and power-loss durability unqualified. T01: trusted terminating owners/repositories,
source verifiers and honest certificates; trusted root and single writer. M02: current governed
registry context, not historical membership authority. O-C01: owner ACK does not certify every
compound callback; O-C02: historical ACK does not imply current lifecycle readiness. Q01-A canonical
decimal representation qualification remains with P20; P21 retains source spellings separately.
Previously failed historical probes and accepted corrections remain preserved unchanged.

No live terminal integration, broker authentication, market orders, financial execution, autonomous
trading or production deployment. Prompt 22 is NOT AUTHORIZED. Independent audit and separate owner
governance acceptance are required after this implementation.

Fresh recovery rechecks checker authority in the current identical governed context. It does not
certify historical role membership (M02); unavailable or revoked current checker authority fences
recovery instead of fabricating certification. `unresolvedPublication` exposes the original
attempted generation and full fingerprint after write uncertainty; the recovery-required pending
count stays one until a fresh service authenticates the intact root. No later operation overwrites
that obligation.

## CODEX-006B query and checker-time clarification

This corrective successor preserves the version and all earlier records. Prompt 21 acceptance
remains pending independent re-audit; no Prompt 22 or production permission follows.

All six query kinds accept the same optional filters: `catalogueFingerprint`, `namespaceKey`,
`version`, `rawSymbol`, `normalizedKey`, and `family`. `kind`, `offset` and `limit` are required.
Filters combine with AND before pagination. Unknown valid namespace/key/raw-symbol combinations
return an empty page; an unknown exact catalogue fingerprint returns `CATALOGUE_NOT_FOUND`.
Malformed requests, unsupported fields and unknown family values return structured NONE rejection.
`family` is the observation's **source-declared family** (`UNKNOWN` included), as in the original
inspection contract. It does not replace or certify the selected canonical economic classification.

| Kind         | Catalogue identity / namespace / version                                    | Raw symbol / normalized key / declared family                               |
| ------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| NAMESPACES   | Existential matching retained catalogue; unique namespace in retained order | One observation in that same catalogue must satisfy all observation filters |
| CATALOGUES   | Exact catalogue fields                                                      | One observation must satisfy all observation filters                        |
| OBSERVATIONS | Containing catalogue fields                                                 | The returned observation must satisfy all filters                           |
| MAPPINGS     | Proposal's exact containing catalogue                                       | Proposal's immutable observation must satisfy all filters                   |
| UNRESOLVED   | Same as MAPPINGS, excluding current research-approved state                 | Same immutable observation filter                                           |
| HISTORY      | Each historical generation's own catalogues                                 | One observation within one matching catalogue in that generation            |

Unfiltered HISTORY includes every retained generation. Other unfiltered kinds retain their previous
ordering. Catalogue, observation, proposal and history order follows immutable append order;
namespace deduplication preserves first occurrence. `total` describes the filtered result,
`nextOffset` is null after the last page, and an offset at or beyond the end returns an empty page.
`version` is catalogue version, never registry generation. Query does not select or substitute a
historical root: use `snapshot(fullFingerprint)` for exact root selection, with no latest fallback.
Mappings carry immutable proposal/decision evidence and current derived state; HISTORY carries
historical roots without rewriting them. Filters establish research selection, not authorization.

The accepted configuration owner's `ApprovalAuthorityEvidence` contains actor, required authority,
authorized result, `checkedAt` and evidence. It has no issuance/expiry interval, caller-supplied
time, clock provenance or signature field. Configuration approval _decisions_ elsewhere have
optional expiry; that separate type is not this resolver certificate. No new TTL or tolerance is
invented. Trusted owner implementations and honest certificates remain required (T01).

A review captures and validates its clock provenance and UTC instant before resolving the owner,
then captures another UTC instant afterwards. `checkedAt` must be within that inclusive interval;
the actor must match, authority must be CONFIGURATION_CHECKER, authorization true, and clock
provenance unchanged. Older/replayed or future certificates outside the actual operation reject.
Unsupported validity fields reject under the existing strict schema. A malformed/unavailable clock,
backwards/conflicting context, self review or revoked owner result cannot establish a new decision.
The service rechecks current source/registry transition eligibility after the callback.

`decidedAt` remains the owner's actual authority-evaluation time (`checkedAt`), not a fabricated
later read. Publication uses a separate accepted-clock observation and must not precede that
decision; repository ACK certifies exact snapshot identity, not an independently timestamped
durability event. The owner exposes no separate certificate issuance time or ACK time. Existing
stored equality `checkedAt === decidedAt` and all historical hashes remain intact. Fresh recovery
validates original decision ordering and current owner authorization separately. Under Q-HIST, a
historically valid approval can be unavailable to a fresh service after checker revocation; this is
a current-context fence, not retrospective proof of fraud. No historical role-membership authority
is added.

Q-TICK (incomplete tick/grid semantics), Q-SELECTOR (selector-specific rather than whole-record
agreement), Q-T01 (unsigned trusted-root authenticity), F05/F06, T01, M02, O-C01/O-C02 and Q01-A
remain qualified. Nothing here certifies live terminal state, contract execution suitability,
power-loss or Windows durability, production throughput, or trading authority.
