# Universal instrument registry — offline research

Prompt 20 describes instruments. A canonical ID is an opaque, stable research identity, not a
subscription, broker symbol, tradability decision, suitability assessment or trading authorization.
**SUPPORTED ≠ AVAILABLE ≠ SUITABLE ≠ AUTHORIZED.** No network discovery or execution API is
provided.

## Configure through the existing owner

Register `instrumentRegistryConfigurationDefinitions(clock)` and
`instrumentRegistryConfigurationSchemas(clock)` with the existing configuration and schema
registries. They are opt-in: existing foundational configuration fingerprints do not change. Publish
`instrument.registry.policyJson` through your existing governed configuration sources,
validation/versioning and maker-checker/release workflow where required. Resolve an
`EffectiveConfiguration` using the accepted configuration owner. The new package has no separate
configuration service. Missing policy, configuration conflicts or missing required keys reject
construction. Use `defaultPolicy` as an explicit synthetic research starting value, not a hidden
fallback. Pass a function returning the current resolved configuration to the registry.

Policies specify supported families, accepted identifier schemes, recognized currencies, taxonomy
versions, N1 normalization, `EXACT_IDEMPOTENT` duplicate handling and `RECORD_AND_REJECT` conflicts.
Unknown policy fields and unsupported modes reject. Taxonomy version/category codes must be unique;
parents must exist, remain within family and be acyclic. Historical versions cannot be overwritten.
Changing policy/configuration blocks the active instance. Existing stored snapshots require the same
policy/configuration; cross-policy migration is not implemented. Use separately governed namespaces
and separately reviewed migration work instead of rewriting history.

| Setting                         |   Default | Behavior                                          |
| ------------------------------- | --------: | ------------------------------------------------- |
| maxAliases / maxRelationships   |   32 / 32 | Per definition; excess rejects before persistence |
| maxRevisions                    |        64 | Per instrument; no history eviction               |
| maxImportBatch                  |        64 | Each nonempty structured or JSON batch            |
| maxRecordBytes                  |     65536 | Bounded safe native input traversal               |
| maxCandidates / maxQueryResults |   64 / 64 | Ambiguity fails closed; bounded search pages      |
| maxInstruments                  |       256 | Distinct economic identities                      |
| maxSnapshots                    |       512 | Immutable persisted registry generations          |
| maxSnapshotBytes                |  16777216 | Entire generation envelope                        |
| maxConflicts / maxImports       | 256 / 512 | Retained evidence, no silent eviction             |

Count limits validate in 1–10000; byte limits 256–1048576 per record and 4096–67108864 per snapshot.
All supported limits remain independently enforced; exhausting any required capacity rejects the
operation. History and conflict queries are bounded by their declared retention limits. No policy
value authorizes trading or provider availability.

## Identity and family distinctions

I1 derives `ins-<full SHA256>` using the existing configuration fingerprint contract and a strictly
validated family identity key. Display name, aliases and mutable classification do not enter the ID.
Keys contain the explicit family/kind and relevant discriminators: FX direction/settlement; equity
issuer/share-class/venue; fund identity/share-class/venue; index administrator/variant; bond
issuance, maturity/currency/coupon/seniority; physical/benchmark/synthetic commodity
reference/grade/location; futures underlying/venue/contract/expiry or explicit continuous-series
rule; option call/put, underlying/expiry/strike/currency/contract; digital network/asset or venue
pair; rates/tenor; governed OTHER namespace/key. Currency records differ from FX pairs, index
references from funds/derivatives, and network tokens from venue products. Canonical decimal strings
remove trailing fractional zeros. Authoritative discriminator selection remains a trusted evidence
responsibility, not external discovery.

Incomplete identities can use OTHER/PROVISIONAL with explicit research namespace/key and PROVISIONAL
qualification. They cannot be falsely VERIFIED. Recognized evidence must explicitly support verified
claims; familiar tickers or format-valid identifiers do not suffice. Built-in currencies are an
explicit finite research policy list, not a downloaded universal reference database.

## Register and import

Construct `new InstrumentRegistry(registryId, { clock, repository, configuration })` using the
accepted Clock and either `MemoryRegistryRepository` or `FilesystemRegistryRepository`. Call
`await initialize()` and check the structured result before registration or queries.
`register(definition)` stores one immutable revision. The definition contains schemaVersion1,
family-specific identity, displayName, taxonomyVersion/classification, administrative status,
qualification, identifiers/aliases/relationships and at least one evidence claim.

All evidence includes sourceType/sourceId, contentFingerprint, originalValue, timeAuthority,
verification and evidenceReference. UNKNOWN external time omits observedAt; SOURCE_ASSERTED or
EVIDENCED includes a canonical UTC timestamp. Recording time comes only from the injected clock.
Future source observations are rejected. Import time is not historical exchange-event proof.

For an offline JSON array, call `await registry.importJson(jsonText)`. For structured records call
`await registry.importRecords(records)`. No external download occurs. The complete batch is
validated and deterministically ordered before a single generation commitment. Referenced underlying
records in the same batch are topologically admitted. Unknown targets/cycles reject without partial
writes. Invalid JSON, empty/unbounded batches and hostile native objects produce structured
rejection.

Example expected outcomes for synthetic records:

- Import two different share classes: two REGISTERED outcomes and different IDs.
- Re-import the same batch, even permuted: the original manifest and no extra generation.
- Re-import a changed name under the same key: CONFLICT, original revision preserved.
- Two unverified scoped ticker claims: AMBIGUOUS, two candidates; no guessed selection.

A committed import manifest preserves inputFingerprint, importId and each input's REGISTERED,
IDEMPOTENT or CONFLICT outcome/revision. Conflicts are explicit evidence, not successful instrument
updates. Registering different content under an existing identity also records a conflict.

## Normalize and resolve

N1 trims supported whitespace, applies NFC and explicit EXACT/CASE/PAIR rules, and retains original
values in provenance and normalization trace. PAIR punctuation normalization is scoped notation,
never proof of equivalent venues. Identifier schemes have explicit validation, including ISIN
checksum, CFI shape, FIGI format/reserved-prefix/checksum validation and governed currencies. Format
validation does not certify external identity or licensing. Provider/broker/terminal claims remain
imported offline assertions, not live mapping services; authoritative mapping belongs to Prompt 21.

`resolve({ canonicalId })` returns the exact stored identity/revision. An identifier query supplies
scheme/value/scope and optionally authority; an alias query supplies value/scope/aliasKind/rule.
Explicit family/jurisdiction filters narrow candidates without fallback. Verified scoped identifier
claims may yield EXACT_MATCH; unverified claims and aliases yield QUALIFIED_MATCH. Multiple
candidates yield AMBIGUOUS. Missing scope/interpretation yields INSUFFICIENT_EVIDENCE, unknown
schemes UNSUPPORTED_SCHEME, missing matches NOT_FOUND, malformed queries INVALID_INPUT. Candidate
overflow returns AMBIGUOUS with CANDIDATE_CAPACITY, never a truncated unique match.

## Revisions, queries and relationships

Use `revise(id, expectedRevision, definition, justification)` for permitted metadata changes. Stale
revision preconditions and identity changes reject. Retirement does not erase history or permit
reactivation. `get`, `revision`, `history`, `diff`, `snapshot`, `snapshotAt`, `search`, `taxonomy`,
`relationships`, `provenance`, `exportManifest` and `conflicts` are read-only with structured
results. Search uses explicit bounded offset/limit and ordinal ID sorting. Returned records are
deeply frozen.

Relationships carry typed evidence and known canonical targets. Self references reject. TRACKS_INDEX
requires fund→index; SHARE_CLASS_OF requires equity→equity; UNDERLYING_OF validates the target
derivative's explicit underlying; REPRESENTS_ASSET requires digital→digital. DERIVED_FROM,
SHARE_CLASS_OF and REPLACES chains reject semantic cycles; REFERENCES/RELATED_INSTRUMENT can form
non-authorizing cycles. ISSUED_BY is not implemented because no organization identity owner exists.
Derivative registration requires a known non-derivative underlying in this bounded foundation.

## Persistence and recovery

Filesystem storage uses exclusive immutable generation files, bounded deterministic serialization,
staging/link publication and full readback before ACK. Snapshots retain all prior revision/conflict/
import prefixes. Fresh initialization verifies registry/configuration/policy identities, generation
chain, fingerprints, cross-instrument revision identity, taxonomy/relations and retained history. A
corrupt or unresolved pending file returns RECOVERY_REQUIRED; it is never silently deleted or
reported recovered. Inspect retained artifacts under the trusted root; do not manually clear genuine
uncertainty. Restore a verified backup or use a separately authorized recovery procedure.

Repository exceptions, lost responses and mismatched ACKs fail closed as UNKNOWN. Existing instances
block reads/writes and shutdown while recovery is required. Fresh instances can recover real
committed snapshots under the same trusted repository contract. Held operations fence reentrant
calls/readiness; `stop()` rejects busy or unresolved obligations and is repeatable after clean
completion.

## Research integration and limitations

`associateResearchEvidence` binds a canonical revision and exact registry snapshot to an explicit
versioned owner reference/fingerprint. It validates registry identity and revision membership. It
never changes existing datasets, capture manifests, aggregate revisions, replay specifications,
checkpoints or branches. It does not independently validate the external owner artifact; callers
must use that owner's accepted validation contract. Prompt16 retains all dataset catalogue/lineage
ownership. Existing verified/reconstruction replay fixtures remain reproducible.

F05 Windows filesystem/open-handle/locking/durability remains unqualified. F06 production throughput
and power-loss durability remains unqualified. T01 trusted terminating owners/repositories, honest
certificates, trusted root and single writer remain mandatory. M02 current governance context is not
historical bitemporal membership; a recorded revision does not prove historical knowledge.
Prompt19's in-process summaries remain volatile, with no durable outbox/universal exactly-once
subscriber claim. No broker/live discovery, contract-session lifecycle engine, suitability or
execution eligibility, production/trading deployment or Prompt21 functionality is implemented.

## Troubleshooting

| Result / symptom                    | Research response                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| INVALID_INPUT                       | Check strict schema, provenance and family identity; existing content is preserved |
| IDENTITY_CONFLICT                   | Inspect conflicts and revision history; use explicit revise for permitted metadata |
| STALE_REVISION                      | Read current revision and review intervening evidence before retry                 |
| AMBIGUOUS                           | Supply scope/authority/family evidence; never choose first candidate               |
| UNSUPPORTED_SCHEME / CLASSIFICATION | Govern a supported policy/taxonomy change; do not coerce                           |
| REGISTRY_NOT_READY                  | Inspect lifecycle/busy/configuration/recovery obligations                          |
| COMMITMENT_UNKNOWN                  | Preserve root and artifacts; obtain verified fresh recovery, never infer no write  |
| Capacity rejection                  | Review declared limits and retained evidence; do not evict authoritative history   |

Run `npm ci`, `npm run verify`, `npm audit`, `npm audit --omit=dev` and `npm ls --all` for the
complete research verification workflow. Implementation completion awaits separate technical audit
and governance acceptance. Prompt21 needs separate specification and authorization.

Export manifests contain semantic revision references and exclude recording time; full storage
snapshot fingerprints include recorded operational metadata for integrity. Neither establishes
historical market availability. Revision fingerprints and canonical IDs exclude recording-clock
metadata.

Strict schema structural caps also apply: 128 claims/aliases/relationships/evidence items per
record, 128 taxonomy categories and16taxonomy versions. Raising a policy limit does not override
these schema limits. Import input fingerprints bind sorted normalized definition fingerprints;
recovery checks each outcome against the corresponding accepted revision or retained conflict
evidence. Changed-field sets include both additions and removals of optional metadata.

`maxRetainedSnapshotBytes` defaults to67108864 and validates in4096–1073741824. All retained
generation bytes are reserved before ACK, bounding fresh recovery as well as one write. The
filesystem repository has a matching fourth constructor argument `maxRetainedBytes`; use the
governed value when overriding. Batch byte traversal/JSON input is additionally capped by
maxSnapshotBytes. Capacity rejects before writing rather than acknowledging state that would exceed
the declared recovery budget.

Configuration drift or source validation before repository entry rejects without inventing a durable
obligation. Restoring the original governed configuration permits a valid retry. Diagnostics report
current configuration alignment; while busy that field is null (not checked), with NOT_READY. Read
guards reject reentrant mutation/stop without changing definitions or persisted evidence. Startup
rejection before repository access is FAILED with commitment NONE and supports initialization retry;
repository/read/integrity uncertainty remains RECOVERY_REQUIRED and cannot be cleared by stop.

The accepted domain `instrumentSchema` keeps its UUID instrumentId/canonicalSymbol/assetClass/status
contract. `associateLegacyInstrument(registry, legacyRecord, selection)` validates that contract and
makes an explicit new research reference to the selected registry revision/snapshot. The legacy UUID
and hash remain unchanged; an opaque I1 registry ID is never inserted into accepted UUID fields.
This opt-in adapter does not infer economic equivalence, transfer legacy LIVE_ELIGIBLE/ACTIVE status
into registry authorization or act as a provider/broker mapping service. Old structural contracts
are not a registry economic-identity assignment engine; Prompt20 adds that governed engine while
preserving all legacy identifiers and evidence.

VERIFIED source labels and format-valid fingerprints are claims, not authentication. Authoritative
registration/recovery requires a supplied trusted, deterministic, terminating offline
`verifyEvidence(evidence, definition): boolean` port for every VERIFIED claim. Default is
fail-closed. The caller must use its accepted evidence owner to verify the exact supplied immutable
definition; no built-in callback downloads data or assumes a recognizable source name is
trustworthy. Current verification is required again on fresh recovery. `prepare`
validates/normalizes claim syntax only; it does not independently certify a record. Honest native
validation remains within T01. Unverified research imports remain EVIDENCE_QUALIFIED/PROVISIONAL and
never become verified through string shape.

EVIDENCED external timestamps likewise require the trusted verification port, even when instrument
identity remains unverified. Verified owner callbacks receive deeply frozen definitions/evidence
both during admission and fresh recovery. Filesystem recovery reads one bounded generation at a time
after checking total retained bytes, avoiding an unbounded concurrent file-open campaign.

An exact canonical-ID lookup means CANONICAL_IDENTITY_ADDRESS, not independently verified economic
facts. Inspect the returned definition's qualification. A VERIFIED_SCOPED_IDENTIFIER result instead
requires the trusted verifier-backed identifier claim; neither status grants trading authorization.
Repository certificates use exact boolean outcomes and closed structured fields; malformed/lost ACKs
retain UNKNOWN commitment, even when actual backing storage contains recoverable committed content.

`taxonomy(version)` includes the immutable version fingerprint; `taxonomyVersionFingerprint`
canonicalizes category/kind ordering and binds category meanings, parents and deprecation. Exported
defaultPolicy/defaultTaxonomy templates are frozen; use structuredClone before proposing changes
through the existing governed configuration workflow. Registered versions cannot be mutated.

## Final normalization and recovery integrity — CODEX-005B

Every publishing API (register, revise, importRecords, importJson) validates the final normalized
record before calling the repository. The effective maxRecordBytes bounds both native traversal and
the UTF-8 canonical JSON definition, including claims, evidence, relationships and optional
metadata. Normalization expansion does not increase the governed budget. Supported transformations
finish in NFC after case/PAIR notation conversion; invalid oversized or empty output is rejected,
never truncated. A pre-entry INVALID_INPUT/NONE leaves the acknowledged history intact and permits
valid retry. Genuine repository uncertainty remains UNKNOWN and requires recovery.

Retained N1 traces describe displayName, identifier/alias values and applicable strike/coupon
normalization; fields never traced by the contract do not gain invented historical originals. New
entries include canonical paths (for example displayName, identity.coupon, aliases.0.value) whose
indices refer to the sorted final claims. Entries use ascending existing fingerprint order. Recovery
checks each original transformation, rule, status, final value and one-to-one field association.
Older entirely pathless traces are qualified by the same rule/value matching and original checks;
identical legacy entries may describe distinct equal-valued fields. Mixed pathful/pathless entries,
missing/extra/conflicting associations or contradictory traces fail recovery without repairing or
deleting files. Metadata remains bounded by maxSnapshotBytes and field cardinality. Trace paths and
originals do not affect I1 economic IDs or semantic revision IDs.

A trace consistency check detects logical contradictions; self-hashed storage cannot prove that a
self-consistent historical original was authentic. Legacy pathless evidence cannot distinguish
original attribution among equal-valued fields with the same rule. Trusted evidence owners, honest
certificates, trusted root and a single writer remain necessary; no cryptographic source attestation
or historical exchange truth is implied.

Resolution.evidence contains general candidate evidence plus the certificates of claims actually
matched by the scoped query, sorted and deduplicated by full fingerprint. Unmatched identifier/alias
certificates are omitted. canonicalId queries retain general evidence only. Evidence inclusion does
not promote unverified claims or alter exact/qualified/ambiguous selection semantics.

This is implementation remediation, not independent acceptance. The failed CODEX-005A report and
results remain historical evidence. F05 Windows and F06 production throughput/power-loss durability
remain unqualified; T01/M02 and all inherited restrictions remain. No broker, execution, production
deployment or Prompt21 authorization is granted.
