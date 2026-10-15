# Instrument specification intelligence — offline research

Prompt23 / CODEX-008 provides `@ate/instrument-specifications`, version
`0.23.0-instrument-specifications.1`. Implementation is subject to independent technical audit and
separate governance acceptance. Prompt24 is not authorized. Nothing here connects to MT5, logs in to
brokers, certifies tradability, validates an order, sizes a position or permits trading.

## Prepare the laboratory

Use Node >=22 and npm >=10, run `npm ci`, then `VITEST_MAX_WORKERS=2 npm run verify`. No external
service, terminal, credentials or network feed is needed. Synthetic public-owner setups and
executable import/publication examples are in `tests/instrument-specifications/fixtures.ts` and
`journeys.test.ts`. Run one journey with:

```sh
npx vitest run tests/instrument-specifications/journeys.test.ts --maxWorkers=2 -t 'J1 '
```

Run J1 through J10 independently with their respective names. Test helpers are not production APIs.
Integrators construct `InstrumentSpecifications(serviceId, ports)` with the accepted clock,
EffectiveConfiguration supplier, P5 StateAuthorityRegistry, P20 InstrumentRegistry, running P22
CanonicalSymbolMapping, and a specification repository. Register `specificationStateOwnership()`,
`specificationConfigurationDefinitions(clock)` and `specificationConfigurationSchemas(clock)` in
their existing owner registries. Configure `broker.specifications.policyJson` through the existing
BROKER configuration domain; resolve an EffectiveConfiguration in RESEARCH mode. No direct
ungoverned runtime policy shortcut exists.

Call `initialize()`, `prepare(request)` for a read-only derivation, `publish(request)` or
`publishJson(text)` for bounded immutable publication, `snapshot(fingerprint?)`, `query(request)`,
`compare(beforeFingerprint, afterFingerprint)`, `sessionLocalBoundary(fingerprint, localFields)`,
`diagnostics()` and `stop()`. Every returned operation result is structured with `ok` and either
`value` or `error {code, commitment}`. Check `ok`; do not swallow a rejected operation as success.

## Bind evidence before interpreting it

A request supplies schemaVersion1, unique requestId, governed specificationId, exact mappingSet
fingerprint, exact mappingFingerprint, sourceDeclaredAt, sourceQuality, importBatchId, rawEvidence
and metadata categories price/volume/contract/sessions/lifecycle/margin/constraints. All seven
category objects are explicit; individual absent fields may be omitted. Unknown properties,
malformed timestamps, invalid decimal lexemes and hostile objects reject before storage. P22 must
retain the referenced mapping and its actual UNIQUE_QUALIFIED_CANDIDATE target; P20 must retain the
actual canonical revision. Current admission also requires current P22 qualification. No lookup by
similar name, automatic mapping approval or fabricated canonical instrument is used.

Every supplied field is an object such as:

```json
{
  "state": "DECLARED",
  "value": "0.00005",
  "evidence": "Synthetic offline precision declaration"
}
```

Other states are ABSENT, UNKNOWN, UNSUPPORTED and CONTRADICTORY. Only DECLARED has `value`;
CONTRADICTORY has at least two `alternatives`; every state carries evidence. Absence and uncertainty
are not zero, an empty session, a default contract or permission. Unknown schema properties reject;
source-specific unsupported constraints can be retained in `constraints.declarations` as named
source declarations. Raw request metadata and its canonical input fingerprint remain beside exact
normalized metadata. Fingerprints use accepted canonical JSON; they are not broker signatures or a
promise to preserve every physical JSON decimal lexeme. Preserve original source files separately
when original physical bytes matter (Q01-A/Q-T01).

## Price and quantity rules

Decimal strings have up to54 integer and18 fractional digits, no exponent, NaN, Infinity, plus sign
or leading zeros. BigInt fixed point supplies exact equality and grid checks; `0.0500` and `0.05`
have the same normalized value, while their retained declared requests remain distinct evidence. A
precision of5 implies point `0.00001`; a tick of `0.00005` may be valid and need not equal point.
Ticks must be positive and representable at precision. Uniform sample alignment requires an explicit
gridOrigin; no implicit origin is invented. minimumIncrement and tick must agree under this
supported uniform interpretation. samplePrice is offline test metadata, never an order.

Tick value, separate profit/loss tick values and currency remain declarations. Missing currency is
INCOMPLETE. No monetary tick value is computed from tick size, exchange rate or an assumed contract.
Unsupported quotation conventions remain UNSUPPORTED. Decimal interpretation does not retroactively
pass P21 B003 or establish Q-TICK execution suitability.

Volume records include minimum/maximum/increment/origin/unit/convention/limit/minimumNotional/scope,
explicit inclusive/exclusive boundaries and optional sampleQuantity. Bounds cannot reverse or form
an empty interval. Positive increments, exact alignment, sample boundaries and units are checked.
Known decimal/units/lots labels describe metadata only; unsupported fractional conventions remain
unsupported. No account balance, live sizing, minimum order or submission service is provided.

Price, volume and margin tiers retain lower/upper/increment, inclusive flags and unit. Tiers must be
ordered, contiguous, nonempty, positive-step and single-owner at shared boundaries. Units must agree
with the explicit category currency/unit. A supplied price/quantity sample must select exactly one
tier and align from its lower bound. Financial schedules outside this exact supported model must
remain UNSUPPORTED; they are not silently converted.

## Contract, currency, lifecycle and margin evidence

Keep contract size/unit/underlyingUnit, quote/profit/margin currency, type/settlement/delivery,
multiplier/venue/family, expiry/maturity/rollover separate from economic identity. Validate
declarations against the selected canonical identity and exact original broker observation where
they supply the same field. Two qualified symbols for one canonical identity can have materially
different sizes, settlement, currencies or grids. Neither a mapping nor a metadata match is full
contract equivalence or trading suitability (A22-Q04).

Lifecycle retains effectiveFrom/effectiveTo, expiry, lastTrading, maturity, replacement, retirement,
corporateActions and status. Check chronology and duplicated contract expiry/maturity. Effective end
is exclusive. ACTIVE and source-declared suspension are historical claims, not live availability.
Corporate-action/replacement references are preserved evidence, not automatic identity migrations.

Margin fields include mode/currency/initial/maintenance/hedged/tiers/accountClass/jurisdiction,
effectiveFrom/effectiveTo/leverageCategory/qualification. Fixed-amount metadata is nonnegative;
maintenance cannot exceed initial in this declared interpretation. Applicability needs mode,
currency, account, jurisdiction and dates. Other calculation modes remain UNSUPPORTED. Past/future
applicability is STALE_CONTEXT, never current sufficiency. No balance, affordability, leverage
selection, liquidation, conversion rate or risk calculation exists.

Broker constraints retain declared increments, price interval, account and date scope and arbitrary
bounded named declarations. Recognized duplicated increments must agree and price bounds must form a
positive interval. Unsupported named declarations remain UNSUPPORTED; no executable permission.

## Sessions and calendars

Supply the accepted P18 calendar structure (UTC_CONTINUOUS, TIMEZONE_CALENDAR or
EXPLICIT_SESSION_SCHEDULE) including id/version, IANA timezone, fold policy, weekday/holiday lists,
explicit UTC session intervals and breaks. Every calendar policy component (including fold,
weekStart, weekdays, holidays, sessions and per-session breaks) must be explicitly declared;
aggregation-owner defaults never fill missing broker metadata. An empty explicit schedule is
incomplete session history. The accepted calendar validates overlap, empty intervals, timezone and
breaks. Cross-midnight sessions use explicit date/open/close. Changes to calendar version/content
remain in each immutable specification and change report. Free-form weeklyTemplate and trading-day
declarations can be recorded; no competing weekly calendar expansion is invented. Provide an
explicit accepted schedule to interpret them. Maintenance intervals are declared evidence and must
have positive duration. Calendar holiday/session semantics stay owned by P18.

`sessionLocalBoundary` delegates ambiguous and nonexistent local times to the accepted
clock/calendar owner. Fold REJECT rejects ambiguous times; EARLIER/LATER resolve only when
explicitly declared. A boundary conversion by itself does not assert a session is open. There is no
current-market-open or order-eligibility endpoint. Environment timezone database identity is bound
by the accepted calendar fingerprint; changes can make recovery incompatible. No automatic
timezone-root migration.

## Validation, completeness and reconciliation

Every validation has ruleId/ruleVersion/inputFingerprint/classification/evidence/explanation,
policyFingerprint and contextFingerprint. Classifications are INTERNALLY_CONSISTENT, INCOMPLETE,
CONTRADICTORY, UNSUPPORTED and STALE_CONTEXT. Source qualifications always include SOURCE_DECLARED,
UNVERIFIED_EXTERNAL_SOURCE and OFFLINE_RESEARCH_ONLY. Successful internal validation is not external
accuracy or authentication. A22-Q01 and A22-Q02 remain: accepted claims/counts are not independent
broker attestation or confidence scores.

`completenessProfiles` exports the version1 exact required fields and rules for IDENTITY_METADATA,
PRICE_GRID_RESEARCH, VOLUME_METADATA_RESEARCH, CONTRACT_COMPARISON, SESSION_HISTORY,
LIFECYCLE_HISTORY and DECLARED_MARGIN_RESEARCH. A profile needs every required declared field and
required successful rule; supplied contradictory/unsupported/stale category evidence also blocks
completeness. Missing optional sample data does not silently become a profile requirement. No
VALID_FOR_TRADING flag exists. Inspect individual rules rather than treating a whole specification
as universally valid.

STORED returns immutable conclusions at recorded evaluation time. CURRENT/RECONCILIATION rechecks
selected current governance, mapping qualification, declared source age and applicability through
the injected clock, returning explicit stale reasons. It never rewrites stored conclusions or
pretends to know historical registry membership (M02/Q-HIST). Incompatible policies/roots reject,
not silently migrate. On restart, explicitly governed compatibleHistoryPolicies may allow exact old
policy fingerprints for reconstruction; stored derivation stays under its original policy and
configuration, current resource bounds still apply, and reconciliation/publication uses the new
policy with a new requestId/version. No runtime policy replacement or implicit compatibility.
Changing metadata, canonical mapping/source evidence or policy requires a new explicit version. An
idempotent exact requestId reuses its original acknowledgement only while context remains current;
different content under that requestId rejects.

## Queries and comparisons

Kinds: SPECIFICATIONS, HISTORY, VALIDATIONS, PROFILES, FIELDS, SESSIONS, LIFECYCLE, MARGIN, CHANGES,
CONFLICTS and RECONCILIATION. All require offset>=0 and bounded limit. Optional conjunctive filters
include exact snapshotFingerprint/specificationId/version/instrumentId/ownerId/namespaceKey,
catalogueFingerprint/observationFingerprint/mappingSet/sourceQuality/effectiveAt/classification.
Version requires specificationId. effectiveAt uses margin dates for MARGIN or the margin profile,
session dates for SESSIONS or the session profile, and specification lifecycle dates otherwise;
missing effectiveFrom gives no match and effectiveTo is exclusive. field is accepted only for
FIELDS; profile only for PROFILES. Classification is accepted only for projections with
classification semantics; inappropriate filters reject rather than disappear. No accepted filter is
ignored; filter before stable pagination. An unknown exact root returns
HISTORICAL_EVIDENCE_UNAVAILABLE, never latest fallback. HISTORICAL specifications retain all
versions; generation order is deterministic.

FIELDS returns declared/normalized/raw field provenance and upstream context. Explicit state records
preserve absence; omitted fields can be inspected via completeness requirements and the strict
metadata schema. Compare exact retained snapshots. Decimal-normalized equality is exact under the
recorded policy/units; no external unit conversion or exchange rate is supported. Report MATERIAL_
DIFFERENCE, INSUFFICIENT_EVIDENCE, INCOMPATIBLE_CONTRACT_SEMANTICS or exact match as applicable.
Field differences retain old/new declarations and context, policy and source changes. Missing or
unsupported evidence must not become a certified equivalence. No broker ranking or profitability
claim exists. Cross-source contract size differences remain material even with the same canonical
ID.

## Bounds, persistence and recovery diagnostics

Default policy version1:

| Control                                            |   Default |
| -------------------------------------------------- | --------: |
| maxSpecifications / maxRevisions / maxHistoryDepth |  128 each |
| maxFields                                          |       128 |
| maxPriceTiers / maxQuantityTiers                   |   32 each |
| maxSessionIntervals                                |       366 |
| maxLifecycleEvents                                 |        32 |
| maxComparisons                                     |       128 |
| maxDiagnostics                                     |       256 |
| maxSnapshotBytes                                   |   4194304 |
| maxRetainedBytes                                   |  67108864 |
| maxInputBytes / maxInputDepth                      | 65536 /20 |
| maxQueryResults                                    |       100 |
| maxSourceAgeMs                                     |  86400000 |

maxSpecifications bounds total immutable generations, maxRevisions bounds versions of an individual
specification, maxHistoryDepth bounds retained chain length; all are checked at admission/recovery.
Field limits count explicitly supplied fields, tier/interval/lifecycle/diagnostic/byte limits apply
before storage. No silent truncation. JSON physical UTF8 bytes and normalized metadata values are
separate limits. Comparison overflow rejects. No compaction silently drops immutable prefixes.

MemorySpecificationRepository supports disposable research. FilesystemSpecificationRepository(root,
maxBytes=16777216,maxSnapshots=512,maxRetainedBytes=67108864) requires a trusted root/ancestors and
single writer. File generations are exclusive immutable JSON files. Pending files, gaps, symlinks,
corruption and incompatible history fail closed. Exact full-body ACK includes generation and
fingerprint. UNKNOWN, thrown or malformed ACK retains the original obligation; diagnostics show
pending=1, unresolvedPublication, recoveryRequired and NOT_READY/DEGRADED. Repeated stop cannot hide
it. Honest NONE allows valid retry. BUSY/reentrant work cannot publish or claim shutdown success.

To recover, preserve the root and all evidence; restore the same governed P20/P21/P22 owners and
configuration, initialize a fresh service and query it while READY before stopping. Rebuild
validates the entire bounded chain, derived results, canonical/source references and lineage. Do not
delete unknown artifacts or clear obligations to force readiness. ACK does not certify a compound
parent operation (O-C01), current readiness (O-C02), fsync or power-loss safety.

## Continuing limitations and audit handover

F05 Windows/open-handle/filesystem qualification and F06 production throughput/power-loss durability
remain outstanding. T01 honest terminating trusted owner/repository/verifier/certificate behavior,
trusted roots and single writer are mandatory. M02/O-C01/O-C02/Q01-A/Q-HIST/Q-TICK/Q-SELECTOR/Q-T01,
A22-Q01–Q06, bounded quality, consumer-loss reconciliation, unsupported legacy/native corrections,
volatile publication summaries and all original governance restrictions remain unchanged. No
independent broker authentication or organizationally independent certification is claimed.
Historical failed audits, B003/B005 and prior phase-correction evidence stay failed and preserved.
Prompt23 is an implementation deliverable, not independent technical or governance acceptance.
Prompt24, production, live connectivity, broker authentication, orders and trading are unauthorized.

## Six-finding remediation semantics (CODEX-008B)

Completeness derives rule ownership from typed specification fields, separately from human-readable
validation evidence. A maintenance interval must have positive duration. Reversed or zero-length
maintenance makes SESSION_HISTORY contradictory, without invalidating unrelated profiles. P18
remains the calendar and session-break authority.

Lifecycle effective start must not follow any present last-trading, expiry, maturity or retirement
date. Present last-trading must not follow expiry or maturity; present expiry must not follow
maturity. These lifecycle date comparisons permit equality. An effectiveTo boundary remains
exclusive and must be strictly later than effectiveFrom. Omitted dates remain omitted; no missing
intermediate date removes a relationship between other present dates.

Price precision applies to tick, declared grid origin, sample price and declared price-tier bounds
and increments. Representability and tick alignment are separate exact fixed-point checks, with no
rounding. Unsupported quotations remain unsupported. Additional contradiction diagnostics are
emitted only when a newly enforced relationship fails; valid S1 diagnostic bodies remain stable.
This retains recoverability of unaffected historical generations. A stored conclusion changed by a
corrected validation fails recovery as SPECIFICATION_EVIDENCE_CHANGED; no automatic migration,
rewriting or grandfathering of false qualification is authorized. Preserve such roots for review.

maxPriceTiers and maxQuantityTiers are per retained table, including each contradictory alternative
(price uses maxPriceTiers; volume and margin use maxQuantityTiers). Several individually bounded
alternatives may have a combined length above the per-table limit; no new aggregate tier limit is
introduced. Existing schema alternative-count limits and input/snapshot/retained-byte budgets still
apply. Rejection happens before repository commit, and recovery enforces current limits without
truncating retained tables.

Native JSON-shaped input bytes are the UTF-8 length of JSON.stringify after safe descriptor, proxy,
cycle, Unicode and owner-clone validation. That encoding includes member names, punctuation,
quotation/backslash escapes and multibyte characters. Serialized JSON is measured as its actual
UTF-8 wire text, including whitespace and escape spelling, before parsing; therefore nonminimal wire
representations can require more bytes than equivalent native input. When the serialized text equals
the native deterministic encoding, both interfaces enforce the same physical-byte boundary. No
getters or proxies are invoked to measure bytes. Current recovery input limits apply to the stored
native request encoding, never to a silently truncated representation. Accepted P18 clone complexity
limits remain additional protections.

Compatible historical policies govern historical interpretation only. Current diagnostic-count,
input-byte, tier, generation, snapshot and retained-resource budgets still apply before READY.
Over-budget diagnostics produce DIAGNOSTIC_CAPACITY and NOT_READY/DEGRADED, preserving original
history bytes. No historical policy allowlist entry grants a resource-limit exemption.

These changes are implementation remediation, not Prompt 23 independent acceptance. All inherited
offline research restrictions remain; Prompt 24 is not authorized by CODEX-008B.

## Dependency-aware comparison (CODEX-008D)

An exact recorded research comparison requires the measurement context for each supplied value on
both records. Omitting an applicable dependency is unresolved just like explicit UNKNOWN or ABSENT;
it cannot be supplied by canonical identity or an unrelated contract/currency field. Missing or
unresolved dependencies produce INSUFFICIENT_EVIDENCE even when numbers match or differ. Existing
canonical-identity incompatibility remains an incompatible comparison. Unsupported/contradictory
metadata is not promoted to exact equivalence.

| Supplied values                                                                                                                  | Required interpretation evidence                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| price.tickValue / profitTickValue / lossTickValue                                                                                | price.tickCurrency                                                                                                                                                        |
| volume.minimum / maximum / increment / origin / limit / sampleQuantity / tiers                                                   | volume.unit                                                                                                                                                               |
| margin.initial / maintenance / hedged / tiers                                                                                    | margin.currency and margin.mode                                                                                                                                           |
| contract.size / multiplier                                                                                                       | contract.unit (also required by the existing contract profile)                                                                                                            |
| price.point / tick / minimumIncrement / gridOrigin / samplePrice / tiers; constraints.minimumIncrement / priceLower / priceUpper | price.quotation                                                                                                                                                           |
| price.tiers                                                                                                                      | contract.quoteCurrency, the existing tier-validation category currency                                                                                                    |
| constraints.quantityIncrement                                                                                                    | volume.unit                                                                                                                                                               |
| volume.minimumNotional                                                                                                           | No dedicated notional-currency binding exists in the current schema; supplied notional evidence remains insufficient for exact comparison. No contract-currency fallback. |

Dependencies activate only for supplied DECLARED values, including zero monetary amounts. An empty
optional category does not activate requirements. Optional samples, underlyingUnit and unrelated
account/jurisdiction/effective-date fields do not become universal comparison requirements. Existing
explicit unresolved-field and relevant invalid-validation protections remain. Fixed-amount margin
metadata may be compared with its declared currency/mode without claiming actual account-level
applicability. Unsupported margin modes remain unsupported when dependencies are resolved.

Matching complete values and units may still exact-match under recorded policy. Different declared
currencies or quantity units produce incompatible contract semantics, without implicit conversion.
Price quotation and category units retain their accepted authority; no new economic identity,
monetary valuation or external broker authentication is inferred.

The existing differences array also carries deterministic COMPARISON_DEPENDENCY_* evidence records.
Their before/after payloads identify applicable declarations, required declarations, missing field
paths and any unbound interpretation. They can appear even when raw field values are identical; they
explain insufficient evidence, not a fabricated numerical difference. These records consume the
existing maxComparisons budget; overflow rejects COMPARISON_CAPACITY rather than truncating
evidence.

Comparison and CHANGES queries apply these semantics to eligible immutable historical records. No
specification body, stored qualification, generation, policy fingerprint or source reference is
rewritten. Recovery still validates exact stored derivation under its authorized policy and enforces
current resources. Comparison-result fingerprints may change with corrected interpretation while
underlying specification fingerprints remain unchanged. All prior qualifications and offline-only
restrictions remain; this remediation is not Prompt 23 acceptance or Prompt 24 authorization.

When a supplied value lacks an applicable dependency, its individual difference is also classified
as `INSUFFICIENT_EVIDENCE`; a numeric mismatch alone does not establish a material difference in
unresolved units. Complete values retain their existing material-difference classification.
