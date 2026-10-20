# Opportunity developer contracts

See [architecture](../architecture/mose-opportunities.md),
[administration](mose-opportunities-administration.md) and
[package exports](../../packages/mose-opportunities/src/index.ts).

## APIs and trust boundary

Use `captureOpportunityContext(context, capture, policy)` to materialize an immutable supplied
packet for standalone evaluation. This preparation function does not authenticate a source or grant
mutation authority. It throws explicit validation errors for malformed structure. Serialized
contexts lose the opaque capture and must be materialized again by the reviewed trusted host.

P18 `readRevision` returns plain native data, retained without an invented Result envelope. Its
reference uses `nativeResultStatus: UNSUPPORTED` to mark the absence of a native Result family,
rather than claiming an owner ACK. P25/P27 native query Results and scanner query/history Results
remain intact; referenced records are selected by immutable identity without wrapping selected
payloads in fabricated success Results.

Create a bounded policy, own-domain authority registration, accepted P6 REPLAY/SIMULATION clock and
an OpportunityRepository. Initialize OpportunityRuntime explicitly. A reviewed
TrustedHostAuthorization supplies an immutable capture map and verifies exact grants. Evaluate
strict `ate.opportunity-evaluate/1` input plus `ate.opportunity-context/1` context. Commit the
returned opaque proposal, not a JSON reconstruction. Context DTOs contain references; captured
native owner payloads are retained separately within the own-domain journal.

The pure evaluator reads supplied inert captures only. It does not invoke accepted owners. Runtime
commit verifies the genuine host grant against full key, root, actor, policy, capture fingerprint
and issuance/expiry. It checks domain ownership before reserving a publication. A historical
idempotent command returns its original ACK, with no new record or renewed current authority.

## Fingerprints and identity

OpportunityKey is `opp28:` plus a full domain-separated SHA256 digest. It is not the accepted UUID
OpportunityId and must never be cast to that brand. It binds the complete subject, source origin,
immutable policy and generation predecessor.

P18 calendar and content fingerprints use the accepted bare lowercase 64-hex encoding. Bare evidence
fingerprints are allowed only for `@ate/multitimeframe@0.18.0-multitimeframe.1` BAR captures, with
exact revision, generation, content, calendar, origin, subject, finality, correction and time
binding. Generic P28 policy, event, journal, head, command and source-origin fingerprints retain
`sha256:` encoding. Do not add or strip a prefix from native P18 bytes.

Canonical P28 JSON orders object keys by Unicode codepoint, preserves array order, rejects nonfinite
numbers, cycles, getters and unsupported object representations. Evidence order is normalized
deterministically after conflict checking and deduplication. Journal fingerprinting excludes its own
fingerprint and snapshot.head.fingerprint self-references; both carry the resulting full
fingerprint. Every other stored field remains bound.

## Persistence and effects

Repository load is a bounded own-domain historical read. compareAppend is an own-domain mutation
requiring contiguous generation, exact predecessor and deterministic replay. No generic owner method
invocation or private upstream import is allowed. Callback exceptions after possible writes produce
UNKNOWN; only a trustworthy prewrite NONE permits safe cleanup. Wrong/malformed ACKs retain the
original obligation. Fresh recovery validates historical captured policy and evidence without
silently refreshing current state.

## Verification

Keep all accepted owner packages byte-identical. Protect all 18 new source files, exact
metadata/lock and the approved eight inherited-test compatibility changes. Run adversarial
property-read, commitment, subject/origin substitution, correction/time, capacity, recovery,
reentrancy and export tests. All 36 approved journeys and 46 acceptance criteria require actual
executable evidence; passing unit tests alone is insufficient. Technical and governance acceptance
remain separate from implementation delivery.

## Native instrument evidence and future owners

P18 stream InstrumentId remains a UUID. P20 and P25 canonical instrument IDs remain `ins-` plus
their native full hexadecimal identity. Neither is cast or rewritten. The optional supplied
`NativeCapture.instrumentBinding` retains the accepted legacy Instrument, the genuine P20
`associateLegacyInstrument` Result and exact `snapshotAt` Result. Its owner/version, reference
fingerprint, selected revision, snapshot and generation must agree. P28 capture availability is
verified by the reviewed trusted host; P20 has no association issuance timestamp and P28 invents
none. Missing, contradictory or future proof blocks the dependent transition. A valid research
association does not prove economic equivalence, current eligibility or execution suitability.

P19 manifest/input fingerprints retain bare native hexadecimal only under
`@ate/market-replay@0.19.0-market-replay.1`. P18 calendar/content fingerprints retain their
separately approved native encoding. All P28-owned digests retain their prefixed form. P25
observationId and P27 assessment id are preserved as native reference fingerprints; owner records
without a native generation use zero as an explicitly unestablished generation, not an invented
owner revision. The exact P25 checkpoint ACK is separately linked through genuine completed scanner
work. All native payload bytes are additionally bound by the distinct P28
capture/event/command/journal digests. Fingerprints and successful structural validation alone never
authenticate a source.

Each operation shares its cumulative O1 meter through nested runtime, repository and recovery calls.
Newly captured native trees are fully charged. Internal decoder reuse is allowed only for an
immutable graph already charged by that same operation meter; a later operation must charge it
again. Generic repeated capture retains its full logical charge. All simultaneous limits remain
binding: 10,000 work nodes, 256 records, 16MiB storage, 64KiB records/requests/outputs and depth16
are maxima, not guaranteed minimum capacity. No partial recovery, eviction or artificial counter
reset is permitted.

Prompt 29 (P29) alone will own ranking; Prompt 30 (P30) alone will own surveillance reconciliation.
Both remain unauthorized. P28 provides immutable historical pull artifacts with qualified local
denominators and native binding evidence. Unknown global coverage, confidence, current health or
eligibility is never represented as zero or complete. All four passive diagnostic owner routes and
automatic composition remain disabled. Current authority requires genuinely reviewed
trusted-host/configuration/Actor proof; a historical ACK does not renew it. No frontend, listener,
broker connectivity, financial execution, autonomous remediation or production deployment is
provided.

All functionality described here is bounded offline historical and synthetic research.

## Event lineage and cumulative exports

`CapturedContext.previousEventFingerprint` is required: use `null` for birth, otherwise the exact
preceding acknowledged `JournalRecord.proposal.eventFingerprint` for the same OpportunityKey.
`historicalState.head.fingerprint` remains the physical journal/ACK digest. These identities are
separately bound and must never be substituted. Commit and fresh recovery compare the event
predecessor against actual acknowledged history, in addition to checking the complete journal head.
Missing provenance cannot be invented; contexts serialized before this contract amendment require
explicit rematerialization from genuine history. Historical draft artifacts are preserved unchanged.

Export accounting includes the entire input graph, the derived redacted graph (including replacement
strings) and each flat JSON/CSV output representation. All consume the same operation node budget;
no transformation resets the counter. An export rejected during construction returns failure with
NONE and no successful partial value. Individual maxima remain subject to every simultaneous O1
limit; they do not guarantee a minimum journal capacity.

## Deterministic evidence-reference ordering

The admitted outer evidence-reference collection is order-insensitive. Temporal priority
(`availableAt`, then `eventAt`) and existing namespace, record and fingerprint keys are preserved;
owner, owner version, runtime, generation and source origin break remaining ties across distinct
immutable identities. Exact reference duplicates retain the existing deduplication rule, and
contradictory bytes for one immutable identity still reject.

This normalization does not reorder native event histories, temporal observations,
revision/correction chains, quality-reference sequences or physical journal records. Materially
changed evidence remains distinct. An equivalent reordered command retry returns its retained ACK
without a new event, generation or mutation-authority grant; a genuine command conflict continues to
reject. Historical ACKs do not establish current readiness, eligibility, trading authority or
durable recovery beyond the accepted storage qualification. All O1 limits and trusted-host
source-verification requirements remain binding.

## Proposed legacy-prefix compatibility (owner review only)

This detached proposal adds an optional `verifyLegacyJournalPrefix` method to the reviewed
trusted-host contract. It must authenticate original ACK provenance and return the exact root,
producer implementation SHA, prefix generation, physical journal fingerprint, issuer, approval
reference and acknowledgement-proof reference. Returning echoed caller fields, a matching hash or a
version flag is insufficient. No built-in production verifier, credential service or receipt
authority is supplied.

The only proposed legacy producer is `6103ca13670d6a75f85b03c24bec567f86a5e467`. Its attested prefix
is fully replayed under the original evidence ordering and checked against the original event,
command, physical journal ACK, subject, policy, native bindings and predecessor chain. The exact
attested prefix head must match before any records receive internal legacy proof. Without a reviewed
verifier, current canonical validation remains the default. A missing, unresolved, contradictory or
incomplete attestation fails closed.

A filesystem host must be supplied explicitly as the optional third constructor argument and as the
runtime's existing host argument. The repository never permits an attested legacy boundary to
include the next append. Every appended row follows the corrected canonical contract. Memory
repositories retain strict canonical-only append behavior; volatile state is not a historical
durability guarantee.

An equivalent historical retry compares a current-canonical projection of the fully validated
original details against the complete proposed command. Ordered native arrays and every
non-reference context field remain significant. Only a genuinely equivalent retry returns the
original ACK without a write or new mutation grant. Historical details, hashes, state and generation
remain unchanged. This is not current eligibility, readiness or trading authority. Unknown
publication and unresolved obligations still require genuine recovery. All work shares the existing
O1 budget; a read or retry can fail closed when simultaneous limits are exhausted.
