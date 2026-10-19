# Opportunity research help

See [architecture](../architecture/mose-opportunities.md),
[administration](mose-opportunities-administration.md),
[developer guide](mose-opportunities-developer.md) and [glossary](mose-opportunities-glossary.md).

## What the eight states mean

| State         | Research meaning                                                                              |
| ------------- | --------------------------------------------------------------------------------------------- |
| DORMANT       | Governed watch declaration; market absence has not been established.                          |
| OBSERVING     | A genuinely completed scanner observation and a final available bar support observation.      |
| INTERESTING   | An approved hypothesis-specific finite predicate is satisfied.                                |
| SETUP_FORMING | The next separately approved research predicate is satisfied.                                 |
| CANDIDATE     | The declared candidate predicate is satisfied; no ranking is implied.                         |
| QUALIFIED     | An opportunity-lifecycle qualification, with no profitability or execution certification.     |
| INVALIDATED   | Positive, applicable evidence contradicts continued qualification. An outage is insufficient. |
| EXPIRED       | The known deadline has elapsed according to the accepted offline clock.                       |

Terminal states are absorbing within the same generation. Restart requires a new governed generation
naming the terminal predecessor. A retry must not create a new generation or erase prior
obligations.

## Why no action is useful

Missing, stale, conflicting or unavailable evidence does not establish absence. UNKNOWN does not
become NONE. CONSISTENCY_UNESTABLISHED does not establish a complete source set. Default-disabled
promotion manifests cannot be replaced with attention tiers, actor overrides or unsupported
TRENDING/HIGH_VOLATILITY labels.

A historical ACK identifies an earlier repository acknowledgement. It does not renew current
eligibility, current source availability or readiness. Local runtime initialization and current
operational authority are separate diagnostic axes. Supplied native evidence is historical; the
runtime performs no silent owner refresh.

## Point-in-time example

At a declared 10:15 decision, only bars finalized and available by the knowledge cutoff may
contribute. An H1 09:00–10:00 window and H4 04:00–08:00 window still need actual calendar, lineage,
quality and age evidence. H1 10:00–11:00 and H4 08:00–12:00 are unfinished and cannot be
substituted. An M15 bar available at 10:15:00.001 is invisible at 10:15:00.000. The default
five-minute age ceiling may also exclude otherwise finalized older bars; it must not be silently
increased to make the example pass.

## Reports and exports

Local distribution counts describe retained keys only. Unknown global coverage has a null
denominator. Candidate-to-qualified ratios require a complete eligible cohort and are UNSUPPORTED
when that evidence is absent. Text/table alternatives accompany chart metadata; UNKNOWN must not be
plotted as zero. Exports redact supplied sensitive fields, preserve source identities and remain
historical artifacts.

## Safe troubleshooting

For SOURCE_UNVERIFIED, retain native Result and immutable identity; obtain genuine source authority
rather than replacing it with a hash. For CONSISTENCY_UNESTABLISHED, supply an accepted scoped
consistency proof or retain the unresolved result. For POLICY_DISABLED, obtain the genuine approved
manifest/configuration; do not enable a caller Boolean alone. For COMMITMENT_UNKNOWN, use the
original operation identity for explicit readback recovery. See the administration runbooks before
retrying.

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
