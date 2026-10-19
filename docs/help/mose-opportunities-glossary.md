# Opportunity glossary

See [user help](mose-opportunities.md) for the eight states and
[administration](mose-opportunities-administration.md) for recovery.

| Term                      | Meaning                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| OpportunityKey            | Domain-separated full SHA256 identity for a governed opportunity generation; distinct from UUID OpportunityId. |
| JournalGeneration         | Global acknowledged record position within the bounded own-domain root.                                        |
| EventSequence             | Per-key acknowledged event position; duplicate commands do not advance it.                                     |
| StateGeneration           | Actual lifecycle transition count, distinct from journal position.                                             |
| Decision cutoff           | Latest event-time boundary a decision may use.                                                                 |
| Knowledge cutoff          | Latest available-time boundary visible to that historical decision.                                            |
| Finality                  | Accepted owner statement about a bar revision; not a guarantee of current eligibility.                         |
| Correction                | New immutable evidence with an explicit predecessor; never a rewrite of what was known earlier.                |
| ACK                       | Historical repository acknowledgement with exact identity and storage qualification.                           |
| NONE                      | Trustworthy absence of a P28 publication for this specific operation.                                          |
| UNKNOWN                   | Unresolved source or publication evidence; never confirmed exclusion or zero coverage.                         |
| CONSISTENCY_UNESTABLISHED | No supported scoped consistency proof; matching totals are insufficient.                                       |
| NO_ACTION                 | Safe decision without a fabricated self-transition or promotion.                                               |
| QUALIFIED                 | Historical opportunity lifecycle state, without profitability, ranking or execution authority.                 |
| Trusted host              | Reviewed local verifier under T01; not a new IAM or scientific validation owner.                               |
| Predicate manifest        | Approved finite hypothesis-specific dimensions and scalar comparisons; no general feature classifier.          |
| P29 handoff               | Immutable pull artifact, with ranking unavailable.                                                             |
| P30 handoff               | Scoped retained-history artifact, with global denominator and coverage unknown.                                |

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
