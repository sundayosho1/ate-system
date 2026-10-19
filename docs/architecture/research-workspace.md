# Research workspace architecture and authority preservation

## Contract flow

Explicit bounded JSON → immutable snapshot → source-context-qualified release overlay → accepted
public knowledge validation → accepted public reporting revalidation → context-only links →
seven-axis diagnostics and manual improvement views → bounded query, handover or redacted export.

No owner service callback, private import, file resolver or network operation is accepted. P6 Clock
is an explicitly supplied time authority, not a general owner read. Report fingerprints remain
separate from workspace and redacted-export fingerprints. Knowledge is never inserted into native
observations.

## Public schemas

`ate.workspace.release/1`: id/revision, historical knowledge commit/manifest fingerprint, reporting
validation baseline, accepted governance commit/record refs, scope, qualifications/source bindings,
observedAt and non-authoritative/UNESTABLISHED status. Authentication context supplies
authenticatedCommit, verifiedBindings, qualificationRegisterFingerprint and an inert clock-context
descriptor. The actual callable P6 Clock is separately supplied to composeWorkspace. No embedded
context field authenticates itself.

`ate.workspace.compose/1`:
id,overlay,knowledge(catalogue/sourceManifest/qualificationIds),report|null,links,improvementRecords,handoverRequest.
Handover request is currently an empty object; no activation flag is supported. Verified source
bindings must cover every provided source-manifest record. C-Q01 metadata-only trust remains: source
references do not scientifically authenticate explanatory wording.

Links bind immutable knowledge entry/revision/fingerprint, report fingerprint, optional facet,
owner/source commit and qualifications with CONTEXT_ONLY relationship. Duplicates/unresolved links
reject. No relationship grants source authority or current action.

`ate.workspace.view/1` retains derived identities, original report, qualified diagnostic rows,
supplied improvement views, guidance, qualifications, policy and budget. Current authority is always
UNKNOWN. Re-import checks fingerprint, fixed baselines, report consistency, qualifications and
non-authoritative guidance; supplied view hashes are not signatures. No current readiness follows
from a view.

`ate.workspace.query/1`: offset>=0,limit default20/max50, optional exact
owner,prompt1–27,axis,section. Contradictory owner/prompt and unsupported keys reject. Stable
section/owner/prompt/id/revision ordering; explicit totalRecords/nextOffset. Empty filtered records
are supplied-subset results, not authoritative owner absence. Diagnostics/improvement entry points
constrain their section.

Improvement projection retains supplied evidence references; decisionAuthority NOT_ESTABLISHED and
mutationAuthority false. No durable improvement case, approval engine or remediation executor
exists. Handover descriptors describe future UI grouping/accessibility; no frontend implementation
exists.

## W1 cumulative work model

Ceilings:
input4MiB,depth16,nodes10000,knowledge128,reports1,artifacts8,links128,facets64,improvements32,charts4,points256,output/export1MiB,calls8,clockReads2,concurrency1,ownerReads0,retries0.
Lower R1/D1/embedded owner limits always win.

The ledger is monotonic within each public operation. Validation bootstrap, re-import, hashing,
dependency reservations and output serialization share credits; none is refunded after a dependency
rejects. Stricter caller policy cannot raise an embedded ceiling. Independently initiated calls are
separate operation domains; there is no cross-call execution-time, process memory, rate-limit or
persistent quota service.

Knowledge validation reserves16logical structural visits per supplied input node, improvement
validation8. These conservatively cover their pinned accepted validation/copy/graph paths. Reporting
uses the accepted public D1 maxNodes policy: half of remaining node credits is reserved as the owner
query ceiling; fixed policy-admission overhead is reserved separately and the original embedded
policy is still minimized by the owner. All reserved credits remain spent. Byte reservations include
conservative repeated-processing costs. Unknown cost or unsupported schema denies admission; no
arbitrary method/callback invocation is supported.

Output serialization reserves its complete bounded structural passes before hashing. Counters
describe this explicit logical snapshot/reservation model, not every CPU instruction, GC allocation
or synchronous cancellation guarantee. R1/C-Q03/T01 limitations remain binding. No memory-isolation,
execution-time, production throughput or universal admission guarantee is claimed.

## Source authority and point-in-time evidence

Reporting remains the accepted supplied-evidence owner: EFFECTIVE/AVAILABLE/asOf/knowledgeCutoff,
native ACK/NONE/UNKNOWN, correction lineage and original obligations are retained. No historical ACK
becomes current authorization. Unknown denominator never becomes zero/COMPLETE. Concurrent
cross-owner read consistency remains CONSISTENCY_UNESTABLISHED. No global health or readiness is
invented.

## Qualifications (preserved, not resolved)

All49rows,12B-R,12D-R,C-Q01–04,allP1–27restrictions and8Eplanninggaps remain. OPEN
A26-Q01,A26C-L01,C-OP01,D-E-L01remain OPEN. Static source trust, Windows/open-handle, power-loss
durability, throughput, trusted root/single writer, timing and reviewer participation limitations
remain. The following source-preservation table retains the49meanings and original preservation
rules.

| ID                      | Meaning                                                                                                                                                                                                                                                                                                                                                                             | Preservation rule                                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A22-Q01                 | Default research qualification is not external authentication. requireVerifiedIdentifiers=false and minIndependentClaims=1 can qualify synthetic/unverified observations against the selected canonical owner registry; no proof a real broker supplied or authenticated them.                                                                                                      | Retain full meaning/prohibited interpretation/operational consequence/future dependency; no stronger current authority or production claim in knowledge/report/API/UX |
| A22-Q02                 | Normalized scoped distinctness is not independent attestation. Different scheme/scope/authority/value identities may count separately under policy without independent external witnesses.                                                                                                                                                                                          | Retain full meaning/prohibited interpretation/operational consequence/future dependency; no stronger current authority or production claim in knowledge/report/API/UX |
| A22-Q03                 | Verified technical views do not create or replace Prompt21 approval authority. The existing P21 retained-view helper does not forward the verifier parameter; unsupported verified-history approval paths remain unsupported.                                                                                                                                                       | Retain full meaning/prohibited interpretation/operational consequence/future dependency; no stronger current authority or production claim in knowledge/report/API/UX |
| A22-Q04                 | Economic grouping is not contract equivalence. Shared canonical identity does not establish equal contract specifications, complete tick/grid data, suitability, current availability or execution eligibility.                                                                                                                                                                     | Retain full meaning/prohibited interpretation/operational consequence/future dependency; no stronger current authority or production claim in knowledge/report/API/UX |
| A22-Q05                 | A STORED researchApproved=true flag can expose historical Prompt21 selector approval even when stored whole-observation outcome is INSUFFICIENT_EVIDENCE. It is not current whole-observation approval or permission.                                                                                                                                                               | Retain full meaning/prohibited interpretation/operational consequence/future dependency; no stronger current authority or production claim in knowledge/report/API/UX |
| A22-Q06                 | Operational qualification is bounded to the documented offline Linux research environment and trusted implementations/root/single-writer assumptions. Windows, production throughput, physical power-loss durability and stronger hostile-owner guarantees remain unqualified.                                                                                                      | Retain full meaning/prohibited interpretation/operational consequence/future dependency; no stronger current authority or production claim in knowledge/report/API/UX |
| F05                     | Windows filesystem, locking, open-handle and durability execution remains unqualified.                                                                                                                                                                                                                                                                                              | Retain full meaning/prohibited interpretation/operational consequence/future dependency; no stronger current authority or production claim in knowledge/report/API/UX |
| F06                     | Production capture/mapping throughput and physical power-loss durability are unqualified; ACK/readback does not certify fsync.                                                                                                                                                                                                                                                      | Retain full meaning/prohibited interpretation/operational consequence/future dependency; no stronger current authority or production claim in knowledge/report/API/UX |
| T01                     | Honest terminating trusted owner/repository/verifier implementations and structured certificates, trusted root and applicable single writer are mandatory.                                                                                                                                                                                                                          | Retain full meaning/prohibited interpretation/operational consequence/future dependency; no stronger current authority or production claim in knowledge/report/API/UX |
| M02                     | Current governed registry/configuration/calendar context is not complete historical bitemporal membership authority.                                                                                                                                                                                                                                                                | Retain full meaning/prohibited interpretation/operational consequence/future dependency; no stronger current authority or production claim in knowledge/report/API/UX |
| O-C01                   | A genuine repository acknowledgement certifies its publication, not completion of every surrounding compound callback operation.                                                                                                                                                                                                                                                    | Retain full meaning/prohibited interpretation/operational consequence/future dependency; no stronger current authority or production claim in knowledge/report/API/UX |
| O-C02                   | Historical acknowledgement does not automatically imply current READY/HEALTHY or completed clean shutdown.                                                                                                                                                                                                                                                                          | Retain full meaning/prohibited interpretation/operational consequence/future dependency; no stronger current authority or production claim in knowledge/report/API/UX |
| Q01-A                   | Canonical parsed fixed-point/decimal identity is authenticated semantically, not as every original raw decimal lexeme; physical byte limits remain distinct.                                                                                                                                                                                                                        | Retain full meaning/prohibited interpretation/operational consequence/future dependency; no stronger current authority or production claim in knowledge/report/API/UX |
| Q-HIST                  | Current checker governance determines fresh recoverability. Honest historical approvals are not retroactive fraud; future incompatible policies need not recover.                                                                                                                                                                                                                   | Retain full meaning/prohibited interpretation/operational consequence/future dependency; no stronger current authority or production claim in knowledge/report/API/UX |
| Q-TICK                  | No complete tick-grid/tick-value/broker-contract/execution-suitability certification; preserved original B003 remains failed.                                                                                                                                                                                                                                                       | Retain full meaning/prohibited interpretation/operational consequence/future dependency; no stronger current authority or production claim in knowledge/report/API/UX |
| Q-SELECTOR              | Accepted P21 selector-specific canonical association does not establish agreement of every source identifier; preserved original B005 remains failed.                                                                                                                                                                                                                               | Retain full meaning/prohibited interpretation/operational consequence/future dependency; no stronger current authority or production claim in knowledge/report/API/UX |
| Q-T01                   | Trusted structured certificates and unsigned root fingerprints do not cryptographically authenticate a dishonest issuer or fully replaced coherent root.                                                                                                                                                                                                                            | Retain full meaning/prohibited interpretation/operational consequence/future dependency; no stronger current authority or production claim in knowledge/report/API/UX |
| INHERITED-OTHER         | All additional accepted historical restrictions remain: bounded quality evidence; explicit consumer-loss reconciliation; conservative source fences; unsupported legacy/native corrections; volatile publication summaries/no universal exactly-once outbox; same-runtime Unicode qualification; no automatic incompatible-root migration; and prior accepted audit qualifications. | Retain full meaning/prohibited interpretation/operational consequence/future dependency; no stronger current authority or production claim in knowledge/report/API/UX |
| E-T01                   | Verification timing stability remains unqualified. CODEX-008E three-worker full runs each timed out on a different unchanged owner test (1,732 passes/one timeout each). Both suites pass alone (five cases). One complete two-worker run passes 1,733 tests/99 files.                                                                                                              | Retain full meaning/prohibited interpretation/operational consequence/future dependency; no stronger current authority or production claim in knowledge/report/API/UX |
| REVIEWER-PARTICIPATION  | The technical reviewer/assistant participated in implementation, remediation and prior A–E audits; the same assistant prepares this governance review. New adversarial harnesses do not establish organizational independence.                                                                                                                                                      | Retain full meaning/prohibited interpretation/operational consequence/future dependency; no stronger current authority or production claim in knowledge/report/API/UX |
| A23-Q01                 | The current strict schema has no dedicated minimum-notional currency binding. A supplied volume.minimumNotional remains insufficient for exact comparison, even if another contract/canonical currency is present.                                                                                                                                                                  | Retain full meaning/prohibited interpretation/operational consequence/future dependency; no stronger current authority or production claim in knowledge/report/API/UX |
| A23-Q02                 | Dependency explanation records consume existing maxComparisons. A comparison may now conservatively reject when its full evidence exceeds the declared budget; exact/one-over behavior is intentional.                                                                                                                                                                              | Retain full meaning/prohibited interpretation/operational consequence/future dependency; no stronger current authority or production claim in knowledge/report/API/UX |
| A23-Q03                 | Corrected computed comparison semantics and result fingerprints apply to eligible historical records, while stored generation bodies, qualification/policy/source fingerprints and exact derivation remain immutable. Compatibility is explicit; false-derived or incompatible histories fail closed rather than migrate.                                                           | Retain full meaning/prohibited interpretation/operational consequence/future dependency; no stronger current authority or production claim in knowledge/report/API/UX |
| HISTORICAL-EVIDENCE     | Original failed audits, developer-gate failures and harness assertions remain failed historical evidence. Current E replays preserve original IJ5 and four rawEvidence assertion failures separately; corrected controls and current-source invariant results are not retrospective passes. Earlier P20/P21/P22 failures and authorized phase/manifest exceptions remain preserved. | Retain full meaning/prohibited interpretation/operational consequence/future dependency; no stronger current authority or production claim in knowledge/report/API/UX |
| RESEARCH-SCOPE          | P23 acceptance would cover only deterministic offline specification research, declared metadata validation, versioned history, dependency-aware research comparison, immutable evidence/governed recovery and bounded read-only research queries.                                                                                                                                   | Retain full meaning/prohibited interpretation/operational consequence/future dependency; no stronger current authority or production claim in knowledge/report/API/UX |
| C-Q01                   | Historical PAUSED shutdown intent is not independently authenticated from retained evidence.                                                                                                                                                                                                                                                                                        | No automatic repair, stronger claim or reinterpretation                                                                                                               |
| C-Q02                   | Finite history can retain unresolved obligations; do not bypass capacity or erase debt.                                                                                                                                                                                                                                                                                             | No automatic repair, stronger claim or reinterpretation                                                                                                               |
| M-Q01 / L-Q01           | Negative provenance is volatile; recovered legacy exclusion cannot create new authority-dependent publication.                                                                                                                                                                                                                                                                      | No automatic repair, stronger claim or reinterpretation                                                                                                               |
| M-Q02                   | Historical VERIFIED/coverage facts are not current authority; preserve explicit current fields.                                                                                                                                                                                                                                                                                     | No automatic repair, stronger claim or reinterpretation                                                                                                               |
| A26-Q01                 | OPEN scanner admission fairness; recommendation rotation does not cure starvation.                                                                                                                                                                                                                                                                                                  | No automatic repair, stronger claim or reinterpretation                                                                                                               |
| A26C-L01                | OPEN work-only nextOffset; explicit receipt offsets/totalRequests without pretending a pinned snapshot.                                                                                                                                                                                                                                                                             | No automatic repair, stronger claim or reinterpretation                                                                                                               |
| Included-zero-event     | Accepted P19 constructors do not establish an included zero-event replay.                                                                                                                                                                                                                                                                                                           | No automatic repair, stronger claim or reinterpretation                                                                                                               |
| Missing native envelope | Historical genuine/malformed native negatives may yield identical old bytes; hashes cannot invent missing provenance.                                                                                                                                                                                                                                                               | No automatic repair, stronger claim or reinterpretation                                                                                                               |
| V-R01                   | Full original risk/mitigation text retained in source register                                                                                                                                                                                                                                                                                                                      | Do not implement future P28–P30 or silently assume missing authority, snapshot, fairness or performance guarantees                                                    |
| V-R02                   | Full original risk/mitigation text retained in source register                                                                                                                                                                                                                                                                                                                      | Do not implement future P28–P30 or silently assume missing authority, snapshot, fairness or performance guarantees                                                    |
| V-R03                   | Full original risk/mitigation text retained in source register                                                                                                                                                                                                                                                                                                                      | Do not implement future P28–P30 or silently assume missing authority, snapshot, fairness or performance guarantees                                                    |
| V-R04                   | Full original risk/mitigation text retained in source register                                                                                                                                                                                                                                                                                                                      | Do not implement future P28–P30 or silently assume missing authority, snapshot, fairness or performance guarantees                                                    |
| V-R05                   | Full original risk/mitigation text retained in source register                                                                                                                                                                                                                                                                                                                      | Do not implement future P28–P30 or silently assume missing authority, snapshot, fairness or performance guarantees                                                    |
| V-R06                   | Full original risk/mitigation text retained in source register                                                                                                                                                                                                                                                                                                                      | Do not implement future P28–P30 or silently assume missing authority, snapshot, fairness or performance guarantees                                                    |
| V-R07                   | Full original risk/mitigation text retained in source register                                                                                                                                                                                                                                                                                                                      | Do not implement future P28–P30 or silently assume missing authority, snapshot, fairness or performance guarantees                                                    |
| V-R08                   | Full original risk/mitigation text retained in source register                                                                                                                                                                                                                                                                                                                      | Do not implement future P28–P30 or silently assume missing authority, snapshot, fairness or performance guarantees                                                    |
| AC01                    | One receipt settles at most one original floor                                                                                                                                                                                                                                                                                                                                      | Projection/help/UI must preserve owner statement and explicit unsupported/unknown outcomes                                                                            |
| AC02                    | Attempts/credits/budgets/debt conserved                                                                                                                                                                                                                                                                                                                                             | Projection/help/UI must preserve owner statement and explicit unsupported/unknown outcomes                                                                            |
| AC03                    | Missing consistency cannot imply absence/completeness                                                                                                                                                                                                                                                                                                                               | Projection/help/UI must preserve owner statement and explicit unsupported/unknown outcomes                                                                            |
| AC04                    | P26 installed plan immutable                                                                                                                                                                                                                                                                                                                                                        | Projection/help/UI must preserve owner statement and explicit unsupported/unknown outcomes                                                                            |
| AC05                    | A26-Q01/A26C-L01 remain OPEN                                                                                                                                                                                                                                                                                                                                                        | Projection/help/UI must preserve owner statement and explicit unsupported/unknown outcomes                                                                            |
| AC06                    | P28 exclusively owns future opportunity states                                                                                                                                                                                                                                                                                                                                      | Projection/help/UI must preserve owner statement and explicit unsupported/unknown outcomes                                                                            |
| AC07                    | Submission/dispatch disabled by default and require genuine authority                                                                                                                                                                                                                                                                                                               | Projection/help/UI must preserve owner statement and explicit unsupported/unknown outcomes                                                                            |
| AC08                    | All inherited governance/source/evidence boundaries intact                                                                                                                                                                                                                                                                                                                          | Projection/help/UI must preserve owner statement and explicit unsupported/unknown outcomes                                                                            |

### B-R risks — retained source text

| B-R01 | Public synchronous read may allocate/scan beyond projection byte limit before return |
OPEN; live adapter blocked if genuine source cost cannot be bounded | Owner configuration
retention/call bound and exact method review, or immutable-input-only mode | | B-R02 | Current
multiowner consistency absent | QUALIFIED; affirmative globalcurrentcomplete claim prohibited |
Explicit unestablished fixtures; no invented pin from equal totals | | B-R03 | Native structural
Result/hostile accessor ambiguity | OPEN implementation proof requirement | Once-only field capture
and representationcontract/exception tests; no plainobject preference | | B-R04 | Metadata current
overlay could masquerade as owner acceptance | OPEN security design gate | External owner
decision/implementation/governance refs, forgedselfauth negatives | | B-R05 | Exact existing
source/ledger guards conflict with authorized successors | OPEN future compatibility approval |
Exact approved existing-test diff, historypreservation and mutationcontrols; no automaticrefresh | |
B-R06 | Missing archive access makes freshclone evidence nonportable | QUALIFIED; unavailablefact
explicit | Access/retention/trust-root policy; unavailable not pass | | B-R07 | Proposed R1 budgets
not calibrated performance limits | PROPOSED_FOR_OWNER_REVIEW; cannot imply production qualification
| Bounded fixture/cost/cap tests and owner acceptance; no upstream capincrease | | B-R08 | Future
remote identity/transport not implemented | BLOCKED_REMOTE_SCOPE | Separate authorization and
security design; no APIserver in initialwave | | B-R09 | Export/redaction may expose private
paths/native content | OPEN acceptancegate | Fieldallowlist and traversal/secret/untrustedcontent
negatives | | B-R10 | Glossary/publicbinding census mistaken for semantic completeness | QUALIFIED
planning constraint | Perentry owner review; no autogenerated definitionauthority or endpointcount |
| B-R11 | Report polling causes gate/rejection effects or health obligations | OPEN
denied-by-default protection | Exact effect allowlist; no automatichealthrefresh; runtime
effecttests | | B-R12 | Blueprint review mistaken for implementation/governance authorization |
BLOCKED unless separate instruction | Explicit future owner authorization and exact file/scope
manifest |

### D-R risks — retained source records

```json
[
  {
    "id": "D-R01",
    "title": "Unavailable passive owner contracts",
    "status": "OPEN DESIGN LIMIT",
    "risk": "Many gated reads update rejection diagnostics or call configuration/current owners. Full current-owner diagnostics cannot be delivered from supplied historical artifacts.",
    "control": "Default DENY; explicit unsupported axes, separate reviewed route expansion."
  },
  {
    "id": "D-R02",
    "title": "Missing pre-call resource bound",
    "status": "OPEN ADMISSION BLOCKER",
    "risk": "Post-return response-size validation cannot bound internal owner clone/scan or nested O(E^2) cost.",
    "control": "No bound/no invocation; genuine source/config evidence; no invented certificate."
  },
  {
    "id": "D-R03",
    "title": "Cross-owner observation atomicity",
    "status": "QUALIFIED",
    "risk": "No universal generation-pinned barrier; sequential stable totals cannot prove consistency.",
    "control": "SEQUENTIAL_UNESTABLISHED and CONSISTENCY_UNESTABLISHED; no authoritative joined absence."
  },
  {
    "id": "D-R04",
    "title": "Native Result representation/TOCTOU",
    "status": "OPEN ACCEPTANCE GATE",
    "risk": "Universal failure mapping or repeated getters can fabricate trusted negatives.",
    "control": "Family-specific single captures; adversarial representations and NONE/UNKNOWN controls."
  },
  {
    "id": "D-R05",
    "title": "Historical versus current authority",
    "status": "QUALIFIED",
    "risk": "Historical ACK/health/self-hash or legacy negative provenance can look current in a unified panel.",
    "control": "Separate temporal/current-authority facts; no operational grant or new COMPLETE."
  },
  {
    "id": "D-R06",
    "title": "Wait/cancellation leak",
    "status": "OPEN ACCEPTANCE GATE",
    "risk": "A timeout cannot stop sync owner work; detached never-settling reads can accumulate.",
    "control": "Concurrency1 retained token; no overlap, consume eventual rejection; T01."
  },
  {
    "id": "D-R07",
    "title": "Chart precision and false denominators",
    "status": "OPEN ACCEPTANCE GATE",
    "risk": "Plotting/aggregation can erase unknown gaps, round decimals or sum overlapping scopes.",
    "control": "Exact strings/units, Fact gaps, scope-qualified ratios and no unsupported global score."
  },
  {
    "id": "D-R08",
    "title": "Forged findings/approvals",
    "status": "OPEN ACCEPTANCE GATE",
    "risk": "A supplied decisionRef or proposed improvement can be mistaken for owner-approved action.",
    "control": "Authenticate source separately, historical status projection only; no execution/approval engine."
  },
  {
    "id": "D-R09",
    "title": "Export identity/privacy",
    "status": "QUALIFIED; D1filesystem disabled",
    "risk": "Redaction changes digest; untrusted paths and details may expose credentials or enable traversal.",
    "control": "In-memory field allowlist/newprojectionhash; no path lookup, no listener, no secret resolution."
  },
  {
    "id": "D-R10",
    "title": "Architecture/lock compatibility",
    "status": "REQUIRES SEPARATE APPROVAL",
    "risk": "New package conflicts with six historical test guards and exact workspace-key lists.",
    "control": "Preserve original evidence, propose exact patch/mutation controls, explicit owner exception; no auto-refresh."
  },
  {
    "id": "D-R11",
    "title": "Source-corpus staleness/completeness",
    "status": "QUALIFIED",
    "risk": "Accepted knowledge source baseline6307 and lexical reason catalogue are not current live proof or exhaustive semantic registry.",
    "control": "Show exact corpus baseline, missing help/code state and separate authenticated governance layer."
  },
  {
    "id": "D-R12",
    "title": "Planning mistaken for acceptance",
    "status": "BLOCKED WITHOUT AUTHORIZATION",
    "risk": "Implementation packages, D1limits, DoD, review scenarios and roadmap are proposals.",
    "control": "Separate owner implementation/test/lock permission, independent audit and governance; no advancement automatically."
  }
]
```

## P1–27 traceability

| Prompt | Accepted owner            | Integration boundary                                                     |
| ------ | ------------------------- | ------------------------------------------------------------------------ |
| P1     | repository                | Source-linked static metadata and supplied evidence; no owner invocation |
| P2     | domain                    | Source-linked static metadata and supplied evidence; no owner invocation |
| P3     | runtime                   | Source-linked static metadata and supplied evidence; no owner invocation |
| P4     | events                    | Source-linked static metadata and supplied evidence; no owner invocation |
| P5     | persistence               | Source-linked static metadata and supplied evidence; no owner invocation |
| P6     | time                      | Source-linked static metadata and supplied evidence; no owner invocation |
| P7     | configuration             | Source-linked static metadata and supplied evidence; no owner invocation |
| P8     | configuration             | Source-linked static metadata and supplied evidence; no owner invocation |
| P9     | configuration             | Source-linked static metadata and supplied evidence; no owner invocation |
| P10    | configuration             | Source-linked static metadata and supplied evidence; no owner invocation |
| P11    | configuration             | Source-linked static metadata and supplied evidence; no owner invocation |
| P12    | configuration             | Source-linked static metadata and supplied evidence; no owner invocation |
| P13    | domain                    | Source-linked static metadata and supplied evidence; no owner invocation |
| P14    | historical-data           | Source-linked static metadata and supplied evidence; no owner invocation |
| P15    | data-quality              | Source-linked static metadata and supplied evidence; no owner invocation |
| P16    | dataset-catalogue         | Source-linked static metadata and supplied evidence; no owner invocation |
| P17    | realtime-data             | Source-linked static metadata and supplied evidence; no owner invocation |
| P18    | multitimeframe            | Source-linked static metadata and supplied evidence; no owner invocation |
| P19    | market-replay             | Source-linked static metadata and supplied evidence; no owner invocation |
| P20    | instrument-registry       | Source-linked static metadata and supplied evidence; no owner invocation |
| P21    | broker-symbol-catalogue   | Source-linked static metadata and supplied evidence; no owner invocation |
| P22    | canonical-symbol-mapping  | Source-linked static metadata and supplied evidence; no owner invocation |
| P23    | instrument-specifications | Source-linked static metadata and supplied evidence; no owner invocation |
| P24    | instrument-eligibility    | Source-linked static metadata and supplied evidence; no owner invocation |
| P25    | mose-core                 | Source-linked static metadata and supplied evidence; no owner invocation |
| P26    | mose-scanner              | Source-linked static metadata and supplied evidence; no owner invocation |
| P27    | mose-attention            | Source-linked static metadata and supplied evidence; no owner invocation |
