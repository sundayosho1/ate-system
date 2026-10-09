# ADR 0088 — Canonical instrument research registry

Status: IMPLEMENTED — pending independent technical audit and governance acceptance. Prompt20,
CODEX-005. Baseline80ac4eac4becb24f52621b048364b0c137136081.

## Decision

Add @ate/instrument-registry without replacing any accepted owner. Dataset catalogue remains owner
of dataset identity/version/lineage. Market-data/capture/aggregation/replay contracts remain
unchanged. Registry associations are explicit new versioned references, never historical rebinding
or ownership. A caller validates the external artifact with its existing owner; the registry
verifies only its own snapshot/revision membership and association contract.

I1 hashes strict economic identity discriminators using the existing configuration fingerprint
contract, full SHA256, independent of ticker/display/clock. N1 uses explicit scoped Unicode/case/
notation normalization and retains source originals. Taxonomies are policy-selected immutable
versions. The opt-in INSTRUMENT configuration definition reuses existing
schema/resolver/version/release and maker-checker authorities; no existing foundational
configuration fingerprint changes.

Revision semantic identity excludes recording clock metadata and normalization trace. The trace and
original source evidence remain stored in immutable snapshots. Full snapshot fingerprints protect
actual recorded history, including operational recording metadata; they do not certify historic
exchange truth. Export manifests identify semantic revision references and therefore exclude host
recording time. Recording time exclusively uses the injected accepted Clock.

## Field ownership

| Field                                                                               | Classification                                                                                |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| I1 family/kind and family-specific identity key                                     | Identity-defining; immutable for one canonical ID                                             |
| schemaVersion and original accepted revision reference                              | Immutable descriptive/contract evidence                                                       |
| displayName/shortName/description/jurisdiction/currency                             | Revisable descriptive; justification and expected-revision required                           |
| taxonomyVersion/classification                                                      | Revisable descriptive under explicitly governed taxonomy; never rewrites previous revisions   |
| identifiers/aliases/evidence/qualification                                          | Evidence-qualified claims; syntax alone is not verification                                   |
| relationships                                                                       | Evidence-qualified, revisable typed graph; current/frozen revision references remain distinct |
| recordedAt/clockProvenance                                                          | Recording evidence, not source availability or canonical identity                             |
| issuer/shareClass, maturity/strike/expiry/network etc.                              | Type-dependent identity discriminators; irrelevant fields forbidden by strict unions          |
| broker availability, detailed session lifecycle, suitability, execution eligibility | Not owned by Prompt20                                                                         |

## Persistence and failure

Repository ports return explicit NONE/UNKNOWN commitment failures; honest native certificates and
trusted terminating owners are mandatory. Service mutations serialize, prepare bounded whole
snapshots before writing and publish in-memory state only after exact ACK. Once repository entry
occurs, exceptions cannot establish noncommitment. UNKNOWN blocks read/write/shutdown; fresh
recovery validates complete retained chains under the same governed policy. An unresolved staging
file blocks recovery and remains discoverable, never silently deleted. Accepted port patterns are
reused rather than introducing database/transaction/state authorities. Single trusted root, one
writer; exclusive immutable filesystem publication/readback is not fsync or power-loss
certification.

## Scope and consequences

Supported administrative statuses are not real-world instrument lifecycle/trading permission.
Relationships may have semantic cycles only where allowed; organization issuer relationships are
unsupported without an entity owner. Missing underlying targets fail closed. Alias collisions are
AMBIGUOUS; conflicting same-batch identity definitions reject atomically, never pick a first
candidate. Cross-policy migration and full historical governance membership are not implemented.

F05 Windows and F06 production throughput/power-loss qualification remain outstanding. T01 trust/
certificates/root/single writer and M02 current governance context remain mandatory. Preserve
bounded quality, conservative source/consumer-loss fences and legacy correction limits. Prompt19
publication remains volatile with no universal exactly-once delivery. Research only; no network
discovery, broker, order/execution/suitability authority, deployment approval or Prompt21
implementation.

## Legacy domain compatibility

Existing domain instrumentSchema is a UUID structural contract with canonicalSymbol/assetClass and
historical lifecycle labels; it is not replaced or reinterpreted. I1 IDs are registry-scoped
economic identities. Explicit associateLegacyInstrument validation/reference links a supplied legacy
record to a caller-selected immutable registry revision, preserving the old UUID/hash. No automatic
economic identity proof, provider mapping, old lifecycle authorization or retrospective data rewrite
occurs. This resolves the schema ownership overlap through an opt-in public-contract adapter.

## CODEX-005B corrective invariant

Admission and recovery share the final normalized-definition contract: strict schema, bounded
traversal and UTF-8 canonical stored JSON bytes under the unchanged governed maxRecordBytes.
Normalization completes NFC after case conversion and PAIR delimiter removal. Invalid expansion
rejects before repository entry; post-entry uncertainty and exact acknowledgement rules are
unchanged. No new clock, configuration, fingerprint or repository authority is introduced.

An additive optional Normalization.path binds new N1 traces to sorted final definition fields.
Recovery validates complete, ordered, one-to-one trace transformations; valid legacy pathless traces
use rule/value matching and remain immutable. Exact originals and paths are snapshot metadata,
excluded from economic/semantic revision identity. Traces retain their existing snapshot budget;
this is not a new record-policy knob or a relaxation of definition bounds. Hashes establish internal
consistency, not authenticity of self-consistent source originals, and legacy equal-valued fields
remain indistinguishable without paths.

Resolution summaries include matching scoped claim evidence alongside general definition evidence,
with deterministic deduplication and unchanged selection/verification classifications. The original
failed CODEX-005A evidence is preserved separately. This decision records targeted corrective
implementation only; technical re-audit and governance acceptance remain pending.
