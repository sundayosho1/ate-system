# Opportunity administration

See [user help](mose-opportunities.md) and [developer contracts](mose-opportunities-developer.md).

## Authority and configuration

The trusted host is an explicitly reviewed local composition dependency, not a new identity service.
It must verify a genuine issuer, actor, applicable configuration approval, manifest approval, source
provenance and scoped consistency evidence before granting the exact capture fingerprint. An
arbitrary host implementation can lie; T01 remains mandatory. P5 StateAuthorityRegistry supplies
domain/owner/runtime checks and does not independently certify the actor or scientific validity.

No composition driver, live owner read, network listener, automatic polling or automatic recovery is
enabled. Filesystem storage requires explicit policy opt-in and a trusted, exclusive single-writer
root. Promotion defaults to disabled. Even explicitly enabled manifests require actual host-verified
approval references.

Every effective ceiling is the minimum of hard O1, original immutable policy, a supplied stricter
policy and applicable accepted-owner limits. Omitted query policy preserves governing limits. No
budget resets across fields or evidence packets are permitted. Lower limits can make a request
impossible; they do not authorize partial READY recovery.

## Frozen O1 profile

| Setting                              | Hard/default value |
| ------------------------------------ | ------------------ |
| `maxLiveKeys`                        | `32`               |
| `maxJournalRecords`                  | `256`              |
| `maxRecordBytes`                     | `65536`            |
| `maxRequestBytes`                    | `65536`            |
| `maxRetainedJournalBytes`            | `16777216`         |
| `maxOperationNodes`                  | `10000`            |
| `maxDepth`                           | `16`               |
| `maxEvidenceRefs`                    | `32`               |
| `maxTimeframes`                      | `4`                |
| `maxDimensions`                      | `8`                |
| `maxClausesPerManifest`              | `16`               |
| `maxEdgeManifests`                   | `9`                |
| `maxIdentifierBytes`                 | `128`              |
| `maxReasons`                         | `16`               |
| `defaultPageSize`                    | `20`               |
| `maxPageSize`                        | `50`               |
| `maxOffset`                          | `256`              |
| `maxOutputBytes`                     | `65536`            |
| `maxSnapshotsPerRecord`              | `1`                |
| `maxSnapshotBytesWithinRecord`       | `65536`            |
| `maxReplayRecords`                   | `256`              |
| `writerConcurrency`                  | `1`                |
| `maxUnresolvedOperations`            | `1`                |
| `defaultOwnerReads`                  | `0`                |
| `maxExplicitApprovedOwnerReads`      | `8`                |
| `ownerReadConcurrency`               | `1`                |
| `automaticRetries`                   | `0`                |
| `explicitRecoveryAttemptsPerRequest` | `1`                |
| `defaultEvidenceMaxAgeMs`            | `300000`           |
| `defaultExpiryMs`                    | `3600000`          |
| `maxExpiryMs`                        | `86400000`         |
| `compositionDriverEnabled`           | `false`            |
| `filesystemEnabled`                  | `false`            |
| `T2T5EnabledByDefault`               | `false`            |
| `tradingAuthorized`                  | `false`            |

Node counts include object/array containers and scalar values; root depth is one. Serialized byte
ceilings use UTF-8. Identifier ceilings are UTF-8 bytes. All numerical maxima apply together.
Returned pages do not certify completeness outside their declared local scope. Retained journals
have no automatic eviction, compaction or idempotency reset.

## Storage and recovery runbooks

Memory ACKs are explicitly VOLATILE_PROCESS_LOCAL. A new empty memory repository has no recovered
history. Offline filesystem ACKs do not certify Windows behavior, concurrent writers or power-loss
durability. Symlinks, unexpected files, invalid UTF-8, duplicate/noncanonical JSON, noncontiguous
generations and mismatched content fail closed.

For COMMITMENT_UNKNOWN, preserve the exact root, operation ID, record fingerprint, prior head and
raw callback result. Stop new mutation. Repeated shutdown must report the unresolved obligation.
Explicit recovery may clear it only through exact authenticated readback. Do not substitute a new
command, delete pending debt, infer NONE from an exception, or blindly rewrite journal bytes.

For JOURNAL_CORRUPT/RECOVERY_REQUIRED, retain physical artifacts and detached digests outside the
application checkout. Perform read-only inspection with the authorized owner. No automatic repair or
reconstruction of missing provenance is authorized.

For BUDGET_EXHAUSTED/CAPACITY_EXHAUSTED, retain policy identity, exact request size, node/depth
counts and journal head. Reduce an explicitly bounded query when permitted. Do not raise O1, evict
history, change timeouts or bypass accepted owner limits.

For STALE_PREDECESSOR/COMMAND_CONFLICT, compare full head and command fingerprints. A generation
number alone is insufficient. Re-read through the bounded query interface and obtain authority for a
genuinely new command; do not relabel a historical ACK as fresh admission.

All inherited qualifications remain binding: F05 Windows, F06 throughput/power-loss durability, T01
trusted owner/root/single writer, M02 current registry context, O-C01/O-C02 callback/history
distinctions, Q01-A decimal representation, OPEN A26-Q01 fairness, OPEN A26C-L01 pagination, OPEN
C-OP01 glossary and OPEN D-E-L01 diagnostic reason fidelity. Preserve all 49 crosswalk rows, B-R/D-R
risks, C-Q01–C-Q04, E-G gaps and qualified Phase V V-R risks in accepted governance records; this
package closes none of them.

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
