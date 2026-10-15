# Canonical Symbol Mapping Laboratory

Prompt22 / @ate/canonical-symbol-mapping, version0.22.0-canonical-symbol-mapping.1. Implementation
pending independent technical audit and governance acceptance. Prompt23 NOT AUTHORIZED.

## Identities and scope

DISCOVERED ≠ NORMALIZED ≠ ECONOMICALLY IDENTICAL ≠ RESEARCH-APPROVED ≠ CURRENTLY AVAILABLE ≠
SUITABLE ≠ AUTHORIZED TO TRADE. Research association is not trading authorization. This library is
offline: no MT5 connection/login, broker credentials, network discovery, live subscriptions,
signals, orders, financial execution, autonomous trading or production deployment.

P20 issues actual canonical IDs (`ins-...`), taxonomy and immutable revisions; illustrative labels
such as FX:EURUSD are not persisted IDs. P21 owns namespace identity, raw observation, immutable
catalogue, B1 normalization and selector-specific proposals/decisions. P22 owns only derived
whole-observation qualification and mapping-set lineage. Raw names/keys are never primary economic
IDs.

## Configuration and preparation

Register mappingConfigurationDefinitions(clock) and mappingConfigurationSchemas(clock) with the
existing configuration/schema authorities. Supply an EffectiveConfiguration resolving
`broker.mapping.policyJson` in RESEARCH mode and register mappingStateOwnership() in the accepted
StateAuthorityRegistry. Call initialize() and check the structured result before
preparing/publishing. Supply actual READY upstream owners with their retained history and
configuration; no fabricated IDs.

All policy fields are required in the JSON value. Start from exported defaultPolicy, change explicit
fields and retain version1. Unknown fields, duplicate schemes/quality classes and invalid bounds
reject. The JSON below is the actual default, not an ungrounded confidence model.

```json
{
  "version": 1,
  "maxCatalogues": 16,
  "maxNamespaces": 16,
  "maxObservations": 256,
  "maxClaims": 16,
  "maxCandidates": 128,
  "maxConflicts": 512,
  "maxGroupMembers": 256,
  "maxSets": 128,
  "maxSnapshotBytes": 4194304,
  "maxRetainedBytes": 67108864,
  "maxInputBytes": 65536,
  "maxInputDepth": 20,
  "maxQueryResults": 100,
  "maxRegistryHistory": 512,
  "maxSourceAgeMs": 86400000,
  "requireVerifiedIdentifiers": false,
  "minIndependentClaims": 1,
  "identifierSchemes": ["RESEARCH", "ISIN", "FIGI"],
  "sourceQuality": ["SYNTHETIC", "UNVERIFIED_RECORDED"],
  "canonicalQualification": ["EVIDENCE_QUALIFIED", "VERIFIED"],
  "compatibleHistoryPolicies": []
}
```

Defaults follow existing finite research capacity conventions. Limits are atomic:
catalogue/namespace/ observation/claim/candidate/conflict/group/set/input/depth/snapshot/history
capacities cannot be truncated into a falsely unique result. maxConflicts also bounds aggregate
reason-code evidence. maxCandidates bounds economic candidates across claims and each key lookup;
maxRegistryHistory bounds public owner-view reconstruction. Exact JSON snapshot bytes and retained
bytes remain separate. No accepted upstream limit is raised by this package.

## Import approved offline evidence

Only reference actual retained owner evidence. Do not pass raw source records as substitute
identity. Use prepare(request) to inspect a deterministic candidate without publication,
publish(request) to publish after exact repository ACK, or publishJson(jsonText) for a strict
duplicate-key-safe JSON input. The supported request is:

```ts
const sourceRoot = brokerCatalogue.snapshot();
const canonicalRoot = canonicalRegistry.snapshot();
if (!sourceRoot.ok || !sourceRoot.value || !canonicalRoot.ok || !canonicalRoot.value)
  throw Error("Actual READY owner snapshots required");
const request = {
  requestId: "offline-mapping-001",
  registrySnapshot: canonicalRoot.value.fingerprint,
  sources: sourceRoot.value.catalogues.map((catalogue) => ({
    ownerId: brokerCatalogue.diagnostics().laboratoryId,
    ownerSnapshot: sourceRoot.value!.fingerprint,
    catalogueFingerprint: catalogue.fingerprint,
  })),
  assertions: [],
  approvals: [],
};
const result = await mappingService.publish(request);
if (!result.ok) throw Error(result.error.code);
```

The service receives a ReadonlyMap of source owners and copies its registry wrapper; caller map
mutation cannot replace a bound owner. Owner IDs must match real P21 laboratory IDs. Duplicate
source references reject. Source list order is canonicalized. Exact source
root/catalogue/observation and exact P20 root remain bound to each conclusion. A reused requestId is
idempotent only with identical request/policy and unchanged current owner context; changed
input/context cannot hide behind a retry.

## Evidence sufficiency and all identifiers

Every supplied material identifier is retained and resolved through the actual P20 owner. Store raw
claim, index, policy support, full result/status/evidence, actual candidates and normalized scoped
evidenceIdentity. Independent count means distinct owner-normalized scheme/scope/authority/value,
not statistical independence or proof of external source origin. Alternate spellings of one claim
cannot inflate minIndependentClaims. Scheme precedence is governed by identifierSchemes; no scheme
is universal economic proof regardless of scope/authority.

Default policy permits owner-qualified RESEARCH claims from synthetic/unverified offline source
classes and evidence-qualified canonical definitions. It does not label them externally verified.
requireVerifiedIdentifiers=true requires actual owner EXACT_MATCH (verified identifier evidence);
canonicalQualification separately governs definition qualification. Source quality classes are
explicitly accepted by policy; supplemental assertions/name keys cannot promote weak claims.

All material claims must be supported, uniquely matched, sufficient and consistent. Disagreeing IDs
produce IDENTIFIER_CONFLICT; any ambiguous claim remains MULTIPLE_CANDIDATES even if another
selected claim is unique. Missing/no-match/invalid/unsupported evidence remains visible. One
supported claim plus an unresolved material claim is insufficient. No selected claim certifies
whole-record agreement.

## Normalization, suffixes and collisions

P21 B1 keys/rule/version/raw/transformation evidence are retained unchanged. Explicitly governed
suffix rules may handle synthetic EURUSD.a/EURUSDm/EURUSD-pro; the common spelling alone is
lookup-only. No automatic suffix inference or repeated stripping. General prefix removal is not
supported by B1: `.EURUSD` remains its recorded key. Unsupported prefix grammar is a documented
capability gap, not silently implemented as a new normalizer.

Lookup candidates cannot become identity-qualified groups without sufficient identifiers. Same key
with distinct qualified IDs produces NORMALIZED_KEY_DISTINCT_IDENTITIES conflict evidence; groups
remain separate by actual ID, with no name-based merger or insertion-order winner. Multiple source
symbols for one ID remain separate members, including same-name observations in distinct namespaces.

## Economic versus contract metadata

Source precision, point/tick size, contract size, volume bounds/steps, currencies, trade mode,
venue, underlying and expiry remain in immutable observation evidence. Canonical identity is
separate from broker contract equality. Group contractEquivalence is always NOT_ESTABLISHED; no
tick-value/grid, margin, leverage, executable quantity, costs or trading suitability are derived.

Source family/base/quote/venue/underlying/contract/expiry contradictions are checked when the actual
P20 identity exposes the corresponding discriminator. P21 quality flags prevent qualification. P20
identitySchema supplies family-specific and canonical decimal semantics; no FX-only identity model.

P21's raw schema does not contain option strike/right, digital network, share class or bond
maturity. An explicit P22 supplemental assertion may carry these constraints with exact source
references, evidenceReference and contentFingerprint over the entire assertion excluding that
fingerprint field. It is negative/consistency evidence only: not an attestation, sufficient
identifier or raw-owner edit. Contradictory or family-inapplicable assertions give
SOURCE_METADATA_CONFLICT. Malformed, unmatched, duplicate or falsely hashed assertions reject the
whole request. Decimal constraint comparison uses P20 canonical parsing (Q01-A); spelling alone is
not a new economic difference.

## Outcomes and explanations

| Outcome                         | Meaning                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| NO_CANDIDATE                    | Supplied supported claims have no actual canonical match                                      |
| INSUFFICIENT_EVIDENCE           | Missing, unsupported, unverified under selected policy, unresolved or too few distinct claims |
| UNIQUE_QUALIFIED_CANDIDATE      | All material identifiers satisfy policy and agree; technical only                             |
| MULTIPLE_CANDIDATES             | Unresolved owner ambiguity; no implicit intersection winner                                   |
| IDENTIFIER_CONFLICT             | Actual material claims disagree on IDs or have disjoint candidate sets                        |
| TAXONOMY_CONFLICT               | Source declared family conflicts with actual canonical family                                 |
| SOURCE_METADATA_CONFLICT        | Identity-relevant source/supplemental metadata or source quality conflicts                    |
| STALE_SOURCE / STALE_REGISTRY   | Exact retained evidence is not current within evaluation context                              |
| POLICY_INCOMPATIBLE             | Current governed policy/configuration differs from stored qualification                       |
| HISTORICAL_EVIDENCE_UNAVAILABLE | Exact missing owner/mapping history returns structured rejection, never latest fallback       |

The last two can be current-view/rejection codes rather than invented persistent observations when
actual owner evidence is absent. Reason codes, full claims, exact references, policy/configuration,
clock/evaluation provenance, normalization hash, IDs/revisions, original approval and record/set
fingerprints answer the audit questions without invented confidence scores. Prior mapping references
are in snapshot.supersedes; generation/full set identity qualify every query result's selected root.

## Research approval and owner integration

UNIQUE_QUALIFIED_CANDIDATE is not APPROVED_FOR_RESEARCH_ASSOCIATION. Review through the existing P21
maker/checker and actor/policy authority only. To capture approval, include an approval reference
with ownerId/catalogueFingerprint/observationFingerprint/proposalId; exact proposal/last decision
must be present in the selected source root and target/registry evidence must agree.

P21 selector-specific approval never overrides a P22 whole-observation conflict. For opt-in research
integration, call
associateResearchEvidence(mappingFingerprint,{owner,ownerReference,ownerFingerprint}) using an
existing supported upstream owner label. It requires current technical qualification and actual
current P21 approved decision/target, then delegates the accepted P21/P20 association API.
Historical upstream payloads/fingerprints are not rewritten or re-certified. No new
role/certificate/ review lifecycle; Q-HIST current authority/recoverability qualifications remain.

## Queries, current context and retained history

query({kind,scope,offset,limit,...filters}) supports MAPPINGS,GROUPS,CONFLICTS,HISTORY. scope
defaults CURRENT; explicit STORED returns original evaluation evidence. CURRENT captures one
accepted query instant and derives staleness without changing stored records. family refers to
actual canonical candidate family, not broker declared family. Raw names/normalized keys are exact
comparisons.

Supported filters:
snapshotFingerprint,ownerId,namespaceKey,catalogueFingerprint,observationFingerprint,
instrumentId,family,rawSymbol,normalizedKey,outcome,qualifiedOnly. All combine AND on one mapping
before pagination. MAPPINGS returns matched records and derived state. GROUPS/CONFLICTS retain the
original immutable whole group/conflict plus separately labeled matchingMembers; member predicates
select the group by existential matching member, never mutate its original evidence. HISTORY matches
one mapping in that historical set. Unfiltered HISTORY includes all retained roots.

Exact snapshotFingerprint/snapshot(fullFingerprint) never falls back. Valid absent source filters
return empty; unknown exact set returns HISTORICAL_EVIDENCE_UNAVAILABLE. Invalid family/unknown
field/malformed pagination rejects with NONE. total counts filtered results; nextOffset refers to
that set, including empty/end pages. Ordering follows canonical record hashes, IDs and append
history.

Compare exact retained roots with compare(before,after):
ADDED,MISSING_FROM_MAPPING_SET,SOURCE_CHANGED,
REGISTRY_CHANGED,POLICY_CHANGED,QUALIFICATION_CHANGED. Missing from a selected mapping set is not
proof a broker delisted a symbol; P21 owns source completeness/reconciliation.
Identity/source/policy changes require explicit new qualification; no redirect to a newer revision
or historical bitemporal membership claim. compatibleHistoryPolicies must explicitly authorize
retained old policy hashes on fresh startup; incompatible/corrupt roots fail closed, never
auto-migrate or delete. Changed policy views are flagged, not rewritten. Runtime policy drift
requires a fresh governed service.

## Persistence, diagnostics and error recovery

Use MemoryMappingRepository or FilesystemMappingRepository with policy-aligned finite limits.
Exclusive immutable file publication/readback ACK must exactly match the candidate. Proven NONE
retains previous state/retry; UNKNOWN/throw/malformed/wrong ACK/late context loss retain exact
original generation/full fingerprint in unresolvedPublication, NOT_READY/DEGRADED and pending1.
Repeated stop cannot conceal that obligation. Fresh service requires intact mapping and actual
upstream retained owner histories with compatible governed policy. No automatic repair, deletion or
fabricated readiness.

initialize/prepare/publish/publishJson/query/snapshot/compare/associate/stop return structured
results. Preinit/poststop queries reject; held work/reentrant calls return BUSY. Input
depth/bytes/native proxies/accessors/cycles/Unicode/duplicate JSON keys are checked without
executing attacker descriptors. Diagnose using error.code,commitment and diagnostics; inspect actual
immutable files/owner roots. No credentials should be supplied. Tests/fixtures are not live broker
listings.

## Qualifications and acceptance boundary

Q-HIST historical checker versus current recovery authority. Q-TICK incomplete tick/grid
suitability. Q-SELECTOR original P21 selector-specific contract and B005 failure remain historical;
P22's stronger whole-observation contract does not rewrite them. Q-T01 unsigned
trusted-root/structured-certificate limit. F05 Windows/open-handle/durability and F06 production
throughput/power-loss unqualified. T01 honest terminating trusted
owners/repositories/verifiers/certificates, trusted root/single writer. M02 current governed
context, not historical bitemporal membership. O-C01 compound operation versus ACK, O-C02 historical
ACK versus readiness, Q01-A parsed decimals versus raw lexemes. Preserve bounded quality, explicit
consumer-loss reconciliation, source fences, legacy/native corrections, volatile summaries,
same-runtime Unicode and incompatible-root qualifications. B003 remains a historical failed
assertion. No cryptographic source/certificate proof, complete contract equality or trading
approval.

Recognized verified P20 histories require the accepted P20 verifier on reconstruction. Supply
verifyRegistryEvidence in MappingPorts, delegating that existing trusted offline verifier. Without
it, verified histories fail closed rather than downgrade. P21 registryView has no verifier argument,
so P22's small retained-view adapter uses the existing P20 constructor/verifier interface directly;
it does not implement a new identity resolver or authenticity authority. P21 proposal creation on
such histories may remain unsupported by its current helper; this package does not extend that
accepted interface or create replacement approval. Qualified mapping without P21 approval stays
unapproved. Real verifier/honest-certificate restrictions remain T01; development verified fixtures
are synthetic trusted-owner tests, not broker/source authentication claims.

The page response includes scope,selectedSnapshot and generation; HISTORY pages carry individual
root generations and use null for unfiltered selectedSnapshot. Reconciliation uses hashed field
tuples, not ambiguous delimiter concatenation. maxSnapshotBytes also bounds retained owner snapshot
reads; a small mapping output does not guarantee an oversized source root can be inspected at that
limit.

CURRENT_AUTHORITY_UNAVAILABLE distinguishes unavailable current upstream authority from changed
history or original fraud. Diagnostics degrades when bound upstream owners are not READY; retained
STORED evidence remains inspectable without inventing current availability. Future source
import/root publication times cannot qualify at an earlier evaluation instant. The source-owner
registry is finite (1–128 configured owners); per-request configured limits and strict contracts
both apply.

Each record stores source.contextSnapshot separately from the requested ownerSnapshot: the former is
the actual retained current-at-evaluation owner context; the latter selects immutable source input.
Reconciliation retains every exact catalogue/observation identity. Same namespace/raw slots are
paired across versions only when unambiguous on both sides; multiple historical versions never
choose an insertion/hash-order winner. Missing/added records remain explicit in ambiguous slots.

The effective configuration context must be RESEARCH; LIVE/PAPER or other runtime modes cannot be
relabeled by a mutation call. Validation failures expose stable bounded codes rather than raw Zod
payload messages. Supplemental fingerprints bind schema-parsed timestamp content; use
assertionSchema for canonical request construction. They are not authentication of every original
date/decimal lexeme.
