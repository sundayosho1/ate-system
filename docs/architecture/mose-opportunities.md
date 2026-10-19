# Offline opportunity state-machine architecture

Prompt 28 exclusively owns opportunity lifecycle transitions. P26 owns immutable scanning plans and
receipt semantics; P27 owns attention recommendations; P29 ranking and P30 surveillance
reconciliation remain unavailable. No accepted owner is modified or duplicated.

Public entry points live in [index.ts](../../packages/mose-opportunities/src/index.ts).
[Developer contracts](../help/mose-opportunities-developer.md),
[user help](../help/mose-opportunities.md),
[administration](../help/mose-opportunities-administration.md) and
[glossary](../help/mose-opportunities-glossary.md) describe the trust and resource boundaries.

## Exact transition graph

I denotes historical idempotency/no new transition. T1–T9 require their specific evidence gates.
DENY cannot be overridden by actor or attention tier. Governed BIRTH into DORMANT precedes the
graph.

| From / To     | DORMANT | OBSERVING | INTERESTING | SETUP_FORMING | CANDIDATE | QUALIFIED | INVALIDATED | EXPIRED |
| ------------- | ------- | --------- | ----------- | ------------- | --------- | --------- | ----------- | ------- |
| DORMANT       | I       | T1        | DENY        | DENY          | DENY      | DENY      | T8          | T9      |
| OBSERVING     | T7      | I         | T2          | DENY          | DENY      | DENY      | T8          | T9      |
| INTERESTING   | DENY    | T6        | I           | T3            | DENY      | DENY      | T8          | T9      |
| SETUP_FORMING | DENY    | DENY      | T6          | I             | T4        | DENY      | T8          | T9      |
| CANDIDATE     | DENY    | DENY      | DENY        | T6            | I         | T5        | T8          | T9      |
| QUALIFIED     | DENY    | DENY      | DENY        | DENY          | T6        | I         | T8          | T9      |
| INVALIDATED   | DENY    | DENY      | DENY        | DENY          | DENY      | DENY      | I           | DENY    |
| EXPIRED       | DENY    | DENY      | DENY        | DENY          | DENY      | DENY      | DENY        | I       |

T1 requires completed native observation/receipt and final available bar. T2–T5 require genuine
approved finite manifests and distinct confirmations, with promotions disabled by default. T6
requires positive correction/weakening evidence. T7 is governed watch deactivation. T8 requires
positive applicable invalidation evidence; missing owners do not establish it. T9 requires a known
elapsed deadline. Invalidation has priority over expiry when both apply; terminal generations remain
absorbing.

## Evidence and effect boundaries

The evaluator consumes bounded supplied evidence under an opaque capture capability. JSON
references, source hashes and current-readiness Booleans cannot mint that capability. The trusted
host must verify actual owner provenance, source bindings, policy approval, issuer and actor
authority under T01. All four accepted passive diagnostic routes remain DISABLED. No driver or live
owner refresh is installed.

The journal retains original native evidence, policy, cutoffs, source references and deterministic
proposals. Compare-and-append binds full previous fingerprint; UNKNOWN retains one original
publication obligation. Recovery validates exact immutable historical facts, keeping current
authority unestablished. Single-writer/trusted-root, Windows, durability and throughput
qualifications remain mandatory.

Standalone reports do not extend accepted P1–P27 reporting/workspace schemas to Prompt 28. Native
integration remains UNSUPPORTED. Local distribution is scoped to retained keys, candidate ratios
remain unsupported without a complete cohort and future P29/P30 handoffs cannot grant new authority.

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

## Event chain versus physical journal chain

Every captured context carries an explicit `previousEventFingerprint`. Birth requires null; later
same-key events require the exact previously acknowledged event digest. The existing historical ACK
head continues to bind the complete physical journal record. Pure event identity uses the event
predecessor, while commit and recovery independently verify both chains. Idempotent acknowledged
commands return the original acknowledgement without publishing another event or renewing authority.

Exports charge their input, derived redaction tree and serialized representations cumulatively
against O1. A redacted replacement string is still an output node. Exhaustion returns an explicit
failure, never a successful partial export. No numerical resource limit is increased.
