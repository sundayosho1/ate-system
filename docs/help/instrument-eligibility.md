# Instrument eligibility — governed offline research

Prompt 24 / CODEX-009 adds `@ate/instrument-eligibility`, version `0.24.0-instrument-eligibility.1`.
Implementation is pending independent technical audit and separate governance acceptance. Prompt 25
is not authorized. This library cannot connect to MT5, authenticate to brokers, place orders, run
autonomous strategies or authorize production deployment.

Instrument exists → instrument is mapped → data is qualified → research is permitted → validation is
attested → offline simulation is permitted. Each arrow is an explicit governed decision, not a
consequence of a stage number, complete metadata, a catalogue listing or an available backtest.

## Setup and owner interfaces

Use Node >=22, npm >=10, `npm ci`, then `VITEST_MAX_WORKERS=2 npm run verify`. In environments where
the default npm cache is not writable, use `npm ci --cache /tmp/ate-npm-cache`; keep checksum and
TLS verification enabled. No terminal, credentials, external service or running network feed is
needed.

Register `eligibilityConfigurationDefinitions(clock)` and `eligibilityConfigurationSchemas(clock)`
through existing configuration registries and `eligibilityStateOwnership()` through P5's
StateAuthorityRegistry. Resolve an EffectiveConfiguration in RESEARCH mode. Supply the governed JSON
policy using **broker.eligibility.policyJson**. There is no ungoverned constructor policy.

Construct `InstrumentEligibility(serviceId, ports)` with the accepted clock, configuration supplier,
state registry, existing ApprovalAuthorityResolver, accepted P20 registry, P21 catalogue owners, P22
mapping, P23 specifications, P14 historical repository, P15 quality repository, P16 catalogue
service/repository, exact retained P19 replay evidence resolver, and a P24 repository.

The replay resolver returns `{specification, checkpoint, inputs}` from trusted actual P19 owners.
The engine calls the inputs' verification function, P19's DeterministicReplaySequencer and
compareReplayCheckpoints. P19 supplies bounded quality, correction, timestamp-cohort and
consumer-loss semantics. No caller boolean or replay hash alone proves research validation. Inputs
must bind the exact historical manifest, quality report and catalogue-version origin, not just equal
prices.

P20 canonical IDs and P13 UUID market-instrument IDs are different namespaces. Dataset bindings must
identify the owner UUID and an explicit P20 `associateResearchEvidence` reference fingerprint for
that exact catalogue version and canonical revision. This is a maker/checker-governed **research
association**, not externally verified economic equivalence. Never relabel accepted market records.
P22 source namespace/catalogue/observation bindings must also match the selected mapping.

Executable real-owner setups are in `tests/instrument-eligibility/fixtures.ts`. Those synthetic
fixtures include test-only grants and declarations; do not copy them as real approvals or evidence.
Production integration must inject established authority; the library never creates human roles or
grants. It consumes existing CONFIGURATION_CHECKER authority with the configured approval policy.

## Lifecycle and current capabilities

Stages: DISCOVERED, MAPPED, DATA_QUALIFIED, RESEARCH, VALIDATED, SIMULATION, LIVE_ELIGIBLE, ACTIVE.
Discovery requires genuine accepted P21 evidence and canonical identity. Mapping remains a separate
admission. Only adjacent forward transitions through SIMULATION, or deliberate retention at the
current stage, are allowed. LIVE_ELIGIBLE and ACTIVE are reserved, non-operational and prohibited.

Dispositions are separate: NONE, PENDING_EVIDENCE, UNDER_REVIEW, SUSPENDED, REVOKED, EXPIRED,
QUARANTINED and RETIRED. Historical VALIDATED plus current SUSPENDED is possible and confers no
current eligibility. Retirement is terminal. Reinstatement requires a new separated approval and
fresh evaluation; disappearing symptoms do not restore eligibility automatically.

Capability gates are independent:

| Capability               | Evidence and admission                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| CATALOGUE_INSPECTION     | Accepted discovery and canonical identity                                                       |
| HISTORICAL_DATA_RESEARCH | MAPPED evidence, admitted DATA_QUALIFIED, bound qualified dataset/quality                       |
| MULTI_TIMEFRAME_RESEARCH | Data qualification, P23 PRICE_GRID_RESEARCH, P18 calendar and supported timeframes              |
| SPECIFICATION_COMPARISON | Mapping and P23 CONTRACT_COMPARISON                                                             |
| STRATEGY_RESEARCH        | Unsupported; no strategy-validation owner is invented                                           |
| VALIDATION_REVIEW        | Admitted RESEARCH; identity/price profiles, qualified data, hypothesis/methodology and calendar |
| OFFLINE_SIMULATION       | Admitted SIMULATION; all validation gates plus P23 VOLUME_METADATA_RESEARCH                     |

Only applicable P23 profiles are required. Optional margin/session completeness is not silently a
universal research prerequisite. An aggregation calendar is an explicit P18 research context; it is
not inferred broker hours. P18 owns timeframe resolution, DST, folds and calendar validation. No
exchange schedule is invented. Failing or unavailable owner evidence restricts use even when a
previous promotion succeeded.

## Preview, request, approval and commit

All operations return `{ok:true,value}` or `{ok:false,error:{code,commitment}}`. Check `ok`.
`commitment` is NONE or UNKNOWN; UNKNOWN requires recovery rather than an identity-changing retry.

Call `initialize()` before use. `discover(action)` records a DISCOVER envelope with unique id,
canonical instrumentId, exact context, maker, occurredAt and effectiveAt. Each context names source
owner/catalogue/observation, canonical revision, mapping set and mapping fingerprint, optional
specification, exact dataset bindings, calendar/fingerprint, timeframes, research subject,
hypothesis/methodology/version, replay checkpoints and optional attestation fingerprint.

`evaluateTransition({instrumentId,destination,context})` previews without mutation or approval. Its
allowed outcome means evidence qualifies; it is **not commit authorization**. Assessments report
required dimensions, present/missing/contradictory/expired evidence, reasons, capabilities, clock
instant and deterministic fingerprint. Request and approval remain mandatory.

`requestTransition` accepts kind REQUEST, id, instrumentId, context, destination, maker, occurredAt,
effectiveAt, disposition (null for ordinary retention/promotion), and reason. `approveTransition`
accepts kind APPROVE, id, requestId and checker. Checker must differ from maker, have verified
current authority and an honest clock-bounded resolver certificate. `commitTransition` accepts kind
COMMIT, id, requestId and approvalId. It rechecks evidence, authority and the record version at
request time. Generic `publish(action)` enforces the same checks; it is no bypass.
`publishJson(text)` additionally rejects duplicate JSON keys before parsing destroys that evidence.

Exact replay of an acknowledged id returns the same historical acknowledgment, without a second
write. Reusing an id for changed content rejects IDEMPOTENCY_CONFLICT. An old acknowledgment is not
proof of present readiness or present evidence validity (O-C02).

## External validation attestations

VALIDATED means **governed, attested research validation**, not profitability, independent
scientific verification, strategy safety or production suitability. The owner's P24-INT-01
resolution permits this narrowly owned reference contract without introducing a strategy-validation
engine.

`createAttestation(body)` constructs immutable declaration/evidence fingerprints. It grants nothing.
`recordAttestation` accepts kind ATTEST, unique id, full declaration and checker. A declaration
identifies attestationId, sourceId, issuer actor, validation subject, canonical instrument,
hypothesis, methodology/version, research policy/version, exact datasets/quality/association
bindings, exact P19 replay participants, source-declared experiment references,
PASSED/FAILED/INCONCLUSIVE outcome, issuance/effective/expiry times, explicit
CURRENT/REVOKED/SUPERSEDED source status, supersession reference and provenance. The configured
source/issuer/methodology allowlist must match; issuer and checker both require existing authority
and must be distinct. The allowlist does not itself grant authority. Evidence references are
issuer-attested declarations; no inaccessible external research artifact is certified by this
engine. Actual referenced dataset/replay owners are independently resolved and checked. T01's honest
sources and certificates remain necessary.

Only current PASSED evidence, matching the requested subject/hypothesis/methodology/dataset context,
may support RESEARCH → VALIDATED. Missing, forged, future, expired, FAILED, INCONCLUSIVE, REVOKED or
SUPERSEDED evidence cannot. Expiry is inclusive (`expiresAt <= evaluation time`). A null expiry is
still bounded by maxEvidenceAgeMs. Record a governed ATTEST_STATUS action with attestation
fingerprint, status REVOKED or SUPERSEDED, distinct authorized checker and reason to withdraw a
declaration. This records P24 governance status; it does not pretend to poll an external validation
authority. A superseding declaration has its own new identity and approval; old history remains
immutable.

REPLAY_REPRODUCIBLE, VALIDATION_ATTESTED and VALIDATION_INDEPENDENTLY_VERIFIED are distinct. The
third is always false: no independent validation owner has supplied such certification. Replay alone
cannot establish successful hypothesis validation. Without configured and verifiable issuer
authority, stay at RESEARCH with explicit missing-authority/evidence reasons.

## Suspension, recovery and historical inspection

`suspendEligibility`, `revokeEligibility` and `reinstateEligibility` accept REQUEST envelopes with
SUSPENDED, REVOKED or NONE disposition, respectively; **they only request**. Approval/commit are
still required. Request other dispositions through requestTransition. Suspension and expiry require
applicable current failure/expiry evidence. Other explicit blocking dispositions are governed
administrative decisions with reasons. Do not change stage in the same disposition request.

`getEligibility(instrumentId)` separates the recorded record from CURRENT_REEVALUATION and its
per-capability results. `dependencyImpact(instrumentId)` classifies current evidence impact; it
never edits an upstream artifact. Revocation, changed canonical revision/mapping/specification,
replaced or quarantined data, missing provenance and incompatible policy cannot be treated as an
unobserved no-change. Apply blocking dispositions explicitly through governance.

`historicalEligibility({instrumentId,asOf})` answers recorded knowledge, not current re-evaluation.
`getEligibilityHistory({instrumentId,asOf,offset,limit})` pages recorded discovery, request and
commit evidence (approval is found by its immutable decision reference).
`getEligibilityEvidence(ref)` and `explainEligibilityDecision(ref)` return exact retained
publication evidence. `getEligibilityChanges({before,after})` and
`compareEligibilityVersions({before,after})` expose exact version pairs, including their policy,
evidence, time and authority; callers must not mistake a changed request for an accepted promotion.
Future as-of queries reject. Observation, occurrence, evaluation, decision-publication and effective
times remain distinct. Visibility requires the recorded publication time; backdated effective times
cannot leak later knowledge into earlier queries.

MemoryEligibilityRepository is an in-memory research repository. FilesystemEligibilityRepository
uses exclusive pending-file creation, immutable hard-link publication and exact readback before ACK.
Default constructor bounds: 16 MiB per file, 512 generations, 64 MiB retained. Single writer and
trusted root/ancestors are mandatory. Root and generation symlinks reject. Generation gaps, pending
markers, malformed JSON, corruption, rehashed invalid decisions and unknown responses fail closed.
There is no destructive automatic repair or silent truncation. Preserve the root and investigate
RECOVERY_REQUIRED; never delete an uncertain obligation merely to force clean shutdown.

The service records the exact publication obligation before calling storage. Throws, malformed ACK,
wrong content or UNKNOWN retain it, block readiness and make repeated stop fail. An honest NONE
rejection permits retry. A genuine ACK is retained even when a callback requests shutdown. Fresh
initialization rederives the chain against recorded policy/time and immutable owners, validates
current bounds and rechecks authority. Exact historical owners must remain available. Source
verification callbacks must terminate honestly (T01). A stopped owner or unavailable source prevents
recovery; this engine does not fabricate historical evidence or recreate owner artifacts.

`diagnostics()` exposes lifecycle, readiness, health, pending publication identity, retained counts
and one bounded lastError. Service readiness is operational readiness, not instrument eligibility.
`stop()` is repeatable after successful completion. While work is in flight it requests cancellation
and returns OPERATION_IN_FLIGHT; retry after the operation settles. It never reports clean shutdown
while a publication/recovery obligation is unresolved. Volatile summaries are not durable evidence.

## Governed configuration limits

The complete defaults (also exercised by permanent tests) are:

| Setting                   | Default              | Meaning                                                                       |
| ------------------------- | -------------------- | ----------------------------------------------------------------------------- |
| version                   | 1                    | Policy schema version                                                         |
| policyId                  | eligibility.research | Research policy identity                                                      |
| approvalPolicyId          | eligibility.research | Existing authority resolver policy context                                    |
| allowQualityWarnings      | false                | Explicit opt-in to nonblocking owner-qualified warnings; never failed quality |
| maxRecords                | 128                  | Canonical eligibility identities                                              |
| maxHistory                | 512                  | All retained publications                                                     |
| maxEvidence               | 32                   | Evidence references per declaration/context                                   |
| maxDependencies           | 64                   | Dataset plus fixed owner dependency references                                |
| maxRequests               | 128                  | All retained transition requests, not an evicting pending cache               |
| maxApprovals              | 128                  | All retained approvals                                                        |
| maxDiagnostics            | 128                  | Upper budget; implementation retains only one lastError                       |
| maxQueryResults           | 100                  | Page result bound; offset bounded by maxHistory                               |
| maxInputBytes             | 65536                | Physical UTF-8 bytes for native deterministic JSON and wire input             |
| maxInputDepth             | 20                   | Native nesting bound; wire parser ceiling 20                                  |
| maxSnapshotBytes          | 1048576              | Publication/recovery snapshot bytes                                           |
| maxRetainedBytes          | 67108864             | Total retained snapshot bytes                                                 |
| maxRecoverySteps          | 512                  | Maximum processed publication entries; per-entry work is also bounded         |
| maxEvidenceAgeMs          | 604800000            | Maximum evidence age, seven days                                              |
| compatibleHistoryPolicies | []                   | Explicit fingerprints of allowed historical policies                          |
| validationSources         | []                   | No external validation issuer enabled by default                              |

Positive counts have schema ceilings of 10,000; byte ceilings and source arrays are in policySchema.
Budgets apply at native/wire admission, publication and fresh recovery. Capacity exhaustion rejects;
no accepted history, requests, approvals or obligations are evicted. No background job or unbounded
cache is introduced. Changes require a new service/configuration context and explicit compatible
history fingerprints; current running configuration changes fail closed rather than reinterpret
state.

## Troubleshooting and retained qualifications

Missing owner evidence: initialize the real owners and retain the exact referenced versions.
MAPPING_NOT_QUALIFIED: inspect current source observation, identifier consistency and mapping
approval. DATASET_NOT_QUALIFIED: verify active exact version, provenance, quality report, integrity,
UUID association and intended-use eligibility. Warnings require explicit allowQualityWarnings; no
ERROR/failed result is waived. SPECIFICATION_EVIDENCE_INCOMPLETE: inspect the applicable P23
profile, not all profiles. VALIDATION_EVIDENCE_MISSING / VALIDATION_AUTHORITY_MISSING: obtain
genuine governed declarations; do not substitute replay output. APPROVAL_REQUIRED /
MAKER_CHECKER_SEPARATION: use existing distinct authorized actors, not invented identities.
POLICY_INCOMPATIBLE: retain recorded policy and configure explicit compatibility after governance
review. RECOVERY_REQUIRED / ACK_MISMATCH: preserve storage, obligation and raw diagnostics for
investigation. Never report a caught error as a passing operation.

All 25 Prompt 23 qualifications remain binding, including E-T01 timing uncertainty, F05 unqualified
Windows filesystem/open handles, F06 unqualified throughput/power-loss durability, T01 trusted
honest terminating owners/repositories/certificates/roots and single writer, M02 current governed
registry context (not complete historical membership), O-C01 compound callbacks versus ACK, O-C02
historical ACK versus readiness, Q01-A canonical decimals, Q-HIST, Q-TICK, Q-SELECTOR, Q-T01,
A22-Q01–Q06, A23-Q01–Q03, historical failures and reviewer participation. Bounded quality evidence,
explicit consumer-loss reconciliation, conservative source fences and unsupported legacy/native
corrections remain. No live connectivity, broker authentication, order placement, financial
execution, production approval, independent scientific validation or Prompt 25 capability is
implied.

Run the ten journeys and adversarial checks with:

```sh
npx vitest run tests/instrument-eligibility --maxWorkers=2
VITEST_MAX_WORKERS=2 npm run verify
npm audit --json
npm audit --omit=dev --json
npm ls --all --json
```

## CODEX-009B remediation semantics

Validation qualification considers every current, verified declaration whose instrument, subject,
hypothesis, methodology/version, dataset/quality/association and replay bindings, policy/version,
configured source/issuer and effective period apply. Different outcomes among those declarations
produce **VALIDATION_DECLARATION_CONFLICT**. Selecting a PASSED fingerprint, changing declaration
ID, or publishing a newer declaration does not resolve the conflict. Unrelated or expired
declarations are not applicable. A governed ATTEST_STATUS revocation or supersession can close an
applicable conflicting declaration; the original immutable declaration and historical stages remain
retained. No fabricated reference or unverified checker can close it. Qualification is recomputed
afterwards. New declarations can be recorded after VALIDATED or SIMULATION without pretending that
evidence recording is a backwards stage transition; conflicts then restrict current
validation/simulation.

Compatible history retains its recorded semantic policy, but each recovered action must satisfy
**current maxInputBytes and maxInputDepth** as well as current history, snapshot and retained
budgets. Oversized or overdeep history rejects initialization with recovery required, never silent
truncation or READY/HEALTHY. Preserve the intact root and unresolved publication evidence. A fresh
service with a valid governed budget may retry recovery under the same identity; an already failed
reader does not reset itself, and an original writer's unknown obligation is not cleared by another
reader.

These corrections do not constitute technical or governance acceptance. Prompt 25, live
connectivity, financial execution and production deployment remain unauthorized; all inherited
qualifications apply.

Conflict applicability compares the exact dataset-binding multiset and exact replay participant
pairs independent of list order. Reordering identical evidence cannot hide a negative declaration.
This comparison does not rewrite stored declarations, fingerprints or historical actions, and does
not relax the selected declaration's exact context-binding checks.

## Complete replay-origin qualification (CODEX-009D)

P24 requires bidirectional coverage of the complete immutable historical dataset origins in **each**
P19 replay participant. A selected PASSED declaration cannot compensate for an omitted input. The
identity is the historical dataset ID plus P19's origin fingerprint, computed from the complete P14
manifest, P15 report and P16 catalogue-version record. P20's explicit research association remains
separately required for every declared version. Matching prices, origin counts, friendly names or
manifest positions do not establish identity.

The qualified domain is a set of full origin identities; repeated declarations cannot inflate it.
P19 owns manifest and event multiplicity: its specification requires unique manifest IDs and dataset
content fingerprints, and its sequencer checks their exact input lists. Valid disjoint partitions of
one dataset may have different manifest/content identities but the same full origin. P24 compares
that origin once while retaining all P19 manifests and events; it does not merge records or require
one manifest per dataset. Duplicate manifest IDs/content remain rejected by P19. An undeclared
origin still fails even when another origin appears in multiple partitions.

Different catalogue versions participate in full origin identity; simultaneous versions sharing
identical content are not supported by P19's unique-content specification. Versions in one family
still obey P16's active-version rule. No inactive version becomes current merely because it appears
in a replay. Complete one-, two- and three-origin research remains supported when each origin has
qualified owner evidence.

Missing, extra, substituted, unresolved or unsupported origins deny replay reproducibility and
attestation receipt. VALIDATED/SIMULATION qualification, transition previews, requests, approval,
commit and current eligibility reuse this evidence gate. RESEARCH may remain available for evidence
review; it does not imply validation. P19's IDENTICAL comparison additionally requires compatible
complete immutable input fingerprints; P24 does not assume output equality alone proves origins.

Fresh recovery re-derives retained decisions. Previously recorded evidence that falsely claimed
reproducible complete origins is fenced with `HISTORICAL_REPLAY_ORIGIN_INCOMPLETE`:
RECOVERY_REQUIRED, NOT_READY, DEGRADED and a retained recovery obligation. Repeated shutdown cannot
conceal the failure. No historical file is rewritten, truncated, deleted, automatically repaired or
upgraded. Source restoration may support recovery only when the unchanged historical claims are
actually valid; a new process is not authority to repair an under-declared history.

Current depth-limit rejection reports `INPUT_DEPTH_LIMIT_N`, where N is the governed applicable
limit. The bounded existing error-label field is used; no new diagnostic/public schema is added.
`INPUT_BOUNDS` still identifies the separate input-node budget. Both retain existing fail-closed
recovery/readiness and shutdown behavior. No input contents or secrets appear in these labels.

All prior qualifications and offline-only prohibitions remain. This remediation does not record
technical/governance acceptance or authorize Prompt 25, live connectivity, trading or deployment.
