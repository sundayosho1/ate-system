# CODEX-004R — Prompt 19 implementation evidence index

Starting checkpoint: `bd37a789e6ccac5ba6b7ab2e87a050581df40be1`. Released Prompt 18 governance
ancestor: `b69530ac75210e62780082034d90e8b1a0a18443`. Development branch:
`codex/prompt-19-completion`; no main merge or accepted-history modification. Release target:
`0.19.0-market-replay.1`. Implementation completion is separate from independent acceptance, which
remains PENDING. The final external delivery report records the exact published source SHA and
actual final gate results. Prompt 20 is NOT STARTED / NOT AUTHORIZED.

## G01–G09 closure evidence

| Gap | Implementation                                                                                                                   | Permanent evidence / observed result                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G01 | Controller/pipeline; joined real canonical import/quality/catalogue; accepted cutoff selection                                   | `acceptance.test.ts`: four streams, two instruments/providers, both modes, missing sequence, actual overflow, gap/reconnect, incomplete H1, late correction, pause/recovery, branch and two equivalent uninterrupted runs. `original-cutoffs.test.ts` matches the actual original owner's exact revision IDs/time/state at all seven cutoffs and rejects expired correction after recovery.                                                |
| G02 | `branch.ts`; immutable reservation, private child namespace, publication marker and exact marked operation verification          | `branch.test.ts`: parent checkpoint/files byte-for-byte preserved; independently reconstructed policy; governed configuration; retries; after-reservation/child/publication interrupts; incompatible context; competing child IDs; bounded capacity; corrupt marker; completed parent. Whole fixture retains parent read/loss history in child tasks.                                                                                      |
| G03 | `controller.ts:observeConsumerChannel/reconcileConsumerRead`; pending durable fence before actual await                          | `async-consumer.test.ts`: capacity-one overflow, loss during read, interrupted stop, repeated stop, fresh pending guard, source reconciliation, post-read persistence failure, future input rejection, closed discard. `owner-integration.test.ts`: actual P17 service, two adapters/four subscriptions, captures/shared channel, three rejected deliveries, all-stream fence. First-guard failure covered in `completion-faults.test.ts`. |
| G04 | `runtime-service.ts`; Prompt 3 runtime, configuration, Prompt 5 derived authority and Prompt 4 event owners                      | `runtime-integration.test.ts`: actual managed runtime start/stop, registration, lifecycle/config drift/disabled/capacity checks, retained event failure and retry, policy mismatch rejection. No trading capabilities.                                                                                                                                                                                                                     |
| G05 | `aggregate-source.ts`; actual owner snapshot/read, exact selected IDs and canonical quality handoff                              | `aggregate-source.test.ts`: committed evidence, source/calendar mismatch, invented/future selection, inconsistent content, mutation, corrupt inherited evidence rejected during real replay with cursor unchanged.                                                                                                                                                                                                                         |
| G06 | `sources.ts`; bounded P14 pagination, real P15/P16 binding and full selected artifact identity                                   | `source-integrity.test.ts`: real import/report/catalogue; missing/repeated/regressed/oversized/corrupt pages, mutation, schema, missing/mismatched/oversized report, lifecycle/content/metadata mutation, unknown publication, source/calendar. `owner-integration.test.ts` preserves real quality through hierarchical M1→M5 and retains incomplete coverage.                                                                             |
| G07 | Atomic staging/cursor/checkpoint; deterministic scheduler cleanup and honest commitment handling                                 | 24-fault matrix below plus existing permanent suites; all 498 starting tests unchanged. New architecture and resource guards do not replace any existing control.                                                                                                                                                                                                                                                                          |
| G08 | `comparison.ts`; full checkpoint and owner state validation, semantic projection and independently reconstructed child reference | `comparison.test.ts`, `branch.test.ts`, whole fixture and `reproducibility.test.ts`: IDENTICAL / EXPECTED_DIFFERENCE / UNEXPLAINED_DIVERGENCE / INCOMPARABLE; policy, missing/corrupt evidence, continuity, lineage/quality, checkpoint boundary; storage/host/lifecycle metadata separated. Legacy metadata-only API cannot certify changed policy.                                                                                       |
| G09 | Complete replay help/config guide; ADRs 0085–0087; DATA-211–223; release/capability/ledger distinction                           | `docs/help/deterministic-market-replay.md`, current evidence index, capabilities and prompt ledger. Root release advanced only after the full pre-release gate passed (578 tests / 48 files, zero audit findings), and the final tree is verified separately before publication.                                                                                                                                                           |

All test paths in this document are under `tests/market-replay/`; implementation paths are under
`packages/market-replay/src/` unless stated otherwise.

## A–L permanent coverage

| Group           | Evidence                                                                                                                                                                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A specification | `sequencer.test.ts`, `temporal-evidence.test.ts`, `runtime-integration.test.ts`: immutable identities, scopes, modes, ranges, limit/cfg fingerprints, finance flags rejected.                                                                |
| B manifests     | `source-integrity.test.ts`, `owner-boundaries.test.ts`, `aggregate-source.test.ts`: actual owner imports/captures/revisions, corruption, schema and paging faults.                                                                           |
| C ordering      | `sequencer.test.ts`, `acceptance.test.ts`: equal/missing/mixed sequence, conflicting duplicates, canonical permutations, cross-provider uncertainty.                                                                                         |
| D clock         | `controller.test.ts`, `reproducibility.test.ts`, `original-cutoffs.test.ts`: existing virtual time, stepping/cohorts, forward boundaries, scheduler order, pause/resume and same outputs.                                                    |
| E lifecycle     | `controller.test.ts`, `storage-faults.test.ts`, `async-consumer.test.ts`, `runtime-integration.test.ts`: reentrancy, pending stop/pause, failed commit, repeated shutdown and explicit recovery.                                             |
| F owners        | `source-integrity.test.ts`, `owner-integration.test.ts`, `aggregate-source.test.ts`: actual P14/P15/P16/P17/P18 APIs; no parallel canonical, calendar or scoring authority.                                                                  |
| G temporal      | `temporal-evidence.test.ts`, `original-cutoffs.test.ts`, `acceptance.test.ts`: delayed receipt/publication/quality, incomplete H1/H4 selection, unknown successors, correction knowledge and horizon; current registry restriction explicit. |
| H integrity     | `async-consumer.test.ts`, `owner-integration.test.ts`, `acceptance.test.ts`: source gap/reconnect, unknown-scope overflow, reconciliation, incomplete/end-of-stream evidence.                                                                |
| I recovery      | `storage-faults.test.ts`, `completion-faults.test.ts`, `controller.test.ts`, `resource-bounds.test.ts`: exact cursor/time/tasks, real partial/post-content/post-marker artifacts, repeat/corrupt/cfg/capacity faults.                        |
| J branches      | `branch.test.ts`, `acceptance.test.ts`: parent immutability, lineage, independently reconstructed policy, context/resource/retry/fresh-registry recovery.                                                                                    |
| K comparison    | `comparison.test.ts`, `branch.test.ts`, `reproducibility.test.ts`, `acceptance.test.ts`: all classifications, missing/corrupt/incompatible evidence, semantic versus operational differences.                                                |
| L architecture  | `architecture.test.ts`, `storage-faults.test.ts`, `resource-bounds.test.ts`, existing P17/P18 architecture tests: owner imports, no wall-clock/random/financial/provider/future authority, trusted roots, parsing/retention bounds.          |

## Mandatory 24-fault matrix

| #   | Fault                             | Permanent test and actual required observation                                                                                                                                               |
| --- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Before write                      | `controller.test.ts`: certified rejection leaves cursor/obligation unchanged; `storage-faults.test.ts` exception still retains uncertainty.                                                  |
| 2   | After content                     | `storage-faults.test.ts`: committed real content, no false shutdown; fresh exact cursor recovery.                                                                                            |
| 3   | After marker                      | `storage-faults.test.ts`: real visible marker with lost acknowledgment; fresh recovery retains effect once.                                                                                  |
| 4   | Partial artifact                  | `storage-faults.test.ts`: real partial JSON remains; RECOVERY_REQUIRED, no cleanup.                                                                                                          |
| 5   | Unknown commitment                | `storage-faults.test.ts`, `completion-faults.test.ts`: operation identity retained; repeated stop fails.                                                                                     |
| 6   | Repeated recovery                 | `storage-faults.test.ts`, `branch.test.ts`: no new publication time, checkpoint or branch effect.                                                                                            |
| 7   | Reentrant shutdown                | `controller.test.ts`, `storage-faults.test.ts`: dispatch/commit cannot falsely acknowledge shutdown.                                                                                         |
| 8   | Pause with tasks                  | `acceptance.test.ts`, `controller.test.ts`: pending descriptors/time/cursor recovered exactly.                                                                                               |
| 9   | Failed cancellation               | `completion-faults.test.ts`: actual scheduler cancellation rejection, stop invoked, private staged work unpublished, durable descriptors remain.                                             |
| 10  | Source mutation                   | `controller.test.ts`, `source-integrity.test.ts`: no cursor advancement or source substitution.                                                                                              |
| 11  | Missing page                      | `source-integrity.test.ts`: cardinality/content failure.                                                                                                                                     |
| 12  | Repeated page                     | `source-integrity.test.ts`: advancing cursor/content failure, no unbounded loop.                                                                                                             |
| 13  | Consumer overflow                 | `owner-integration.test.ts`, `acceptance.test.ts`: actual queue rejection and conservative all-stream fence.                                                                                 |
| 14  | Await-time loss                   | `async-consumer.test.ts`: actual read gate with additional queue loss before completion; durable guard.                                                                                      |
| 15  | Checkpoint capacity               | `completion-faults.test.ts`: no cursor acknowledgment; original durable state remains recoverable.                                                                                           |
| 16  | Evidence capacity                 | `completion-faults.test.ts`: admission rejects; authoritative evidence not evicted.                                                                                                          |
| 17  | Correction after cutoff           | `original-cutoffs.test.ts`, `acceptance.test.ts`: old selection unchanged; corrected successor appears only at knowledge time.                                                               |
| 18  | Expired correction after recovery | `original-cutoffs.test.ts`: CORRECTION_HORIZON, acknowledged revision history unchanged.                                                                                                     |
| 19  | Corrupt inherited quality         | `aggregate-source.test.ts`: INHERITED_QUALITY_INTEGRITY during actual replay, cursor 0. Existing P18 adversarial handoff tests preserved.                                                    |
| 20  | Conflicting duplicate             | `sequencer.test.ts`: conflicting canonical identity rejected before sequencing.                                                                                                              |
| 21  | Incompatible branch checkpoint    | `branch.test.ts`: incompatible parent/source/scopes or marker rejected, no parent rewrite.                                                                                                   |
| 22  | Competing output identity         | `completion-faults.test.ts`: second different effect at same session generation rejected; first remains recoverable. `branch.test.ts`: competing child identity rejected before reservation. |
| 23  | Pending publication at completion | `completion-faults.test.ts`, `runtime-integration.test.ts`: incomplete publication/event obligation blocks completion claim or successful shutdown; retry explicit.                          |
| 24  | Changed-config resume             | `completion-faults.test.ts`, `runtime-integration.test.ts`: mismatch/drift rejection, artifacts byte-for-byte unchanged.                                                                     |

## Definition-of-done mapping (original 19.36)

1–2: exact ancestry/branch recorded in preflight and final external Git evidence. 3–13: existing
authorities, immutable specification, ordering/clock/playback/scheduler/lifecycle tests. 14–19: real
bounded source adapters, aggregation/quality/loss and original/whole temporal fixtures. 20–22:
atomic full checkpoint and real filesystem fault/idempotent recovery tests. 23–25: immutable durable
branch and independently explained comparison. 26–29: operation reservations, resource guards,
security gates and actual configuration validation. 30–32: help/configuration, safety invariants and
ADRs. 33–35: all starting tests preserved; full tests, secret scan and security gates recorded. 36:
generated exact whole-system/original-cutoff evidence plus complete external delivery report. 37–38:
published SHA match and clean tree recorded after commit in that report. 39–40: independent
acceptance PENDING; Prompt 20 NOT STARTED / NOT AUTHORIZED.

## Boundaries retained

F05 Windows behavior/durability unqualified; F06 production throughput/power-loss durability
unqualified. T01 trusted owner/repository/certificate, single-writer/trusted-root restrictions
remain. M02 current registry context is not historical membership authority. Quality handoff is
bounded; loss scope is conservatively fenced. Native corrected-trade cancellation/migration,
automatic dataset qualification and all broker/trading/Prompt 20 work are absent. Actual bus
summaries remain volatile; checkpoint history owns durable research audit. These are explicit scope
limitations, not waived acceptance criteria or production claims.

## CODEX-004A failed audit and CODEX-004B targeted remediation

The completion statements above record CODEX-004R's implementation delivery, not acceptance.
Independent CODEX-004A audited `97ace0e431b47cdbb51d838edc84189b0d22ea2d` and returned AUDIT FAILED
— MANDATORY REMEDIATION REQUIRED despite 579 passing permanent tests. It confirmed A19-H01
(admission lock), A19-H02 (unfinished reference), A19-M01 (bounded branch reconstruction), and
A19-M02 (full source-origin binding). Preserve the original report/probes and failed results.

CODEX-004B works only on `codex/prompt-19-audit-remediation`, preserving release version
`0.19.0-market-replay.1`, accepted owner packages, dependencies/lockfile and all 579 existing tests.
Targeted source corrections are in replay runtime-service, comparison, controller and branch.
Permanent `tests/market-replay/audit-remediation.test.ts` adds 23 cases, including A–E combined
scenarios, genuine post-commit uncertainty, held real ConsumerChannel reads, exact-capacity and
mid-cohort interruption recovery, source substitution and rehashed record integrity rejection. The
runtime still retains genuine uncertain commitments; explicit timestamp capacity rejection is
preserved; no new scheduler, quality authority, data owner or source-origin substitution contract is
introduced.

The original external CODEX-004A assertions are rerun unchanged, with evidence paths redirected to
CODEX-004B so audit history is preserved. Implementation tests and reproduced audit probes are
distinct; neither constitutes independent acceptance. The final delivery report records actual
command outcomes, total counts, publication SHA and remote verification.

Current status: TARGETED REMEDIATION — PENDING INDEPENDENT RE-AUDIT AND ACCEPTANCE. F05/F06/T01/M02
and the no-trading/Prompt-20 restrictions remain mandatory.

## CODEX-004C failure and CODEX-004D lifecycle remediation

CODEX-004C independently audited `2468d596ecddeab3274951728be37ef5f0a55245` and returned RE-AUDIT
FAILED despite 602 passing permanent tests and all 43 original probes passing. HIGH A19-H01-R1
retained a failed empty admission after source verification rejected before repository access. The
audit report and both independent failed reproductions remain preserved.

CODEX-004D uses `codex/prompt-19-lifecycle-remediation` from that exact target. Source changes are
limited to controller initialization provenance and runtime provisional-disposal/diagnostic
handling. `tests/market-replay/lifecycle-remediation.test.ts` adds eleven deterministic regressions
covering A–J: real file/actual historical owner verification, constructor rejection, unknown durable
commitment, synchronous reentrancy, delayed rejection/shutdown, immutable bounded diagnostics,
repeated identity rejection/capacity, and post-repository/recovered-content failures. The 602
existing tests remain unchanged. Root/replay version, dependencies and capability flags are
unchanged.

The external delivery report records actual complete verification, unchanged original probe results,
phase-accounting limitations in the two original CODEX-004C assertions, security results and
publication SHA. A successful retry/stop necessarily makes repository calls; zero-call verification
must identify the rejected attempt's boundary, not count later successful operations. No original
external assertion is suppressed or described as passing if its unchanged run fails.

Current status: SECOND TARGETED LIFECYCLE REMEDIATION — PENDING INDEPENDENT RE-AUDIT. Neither
implementation tests nor probe reproduction constitute acceptance. F05/F06/T01/M02 and
offline/no-broker/no-trading/Prompt-20 restrictions remain mandatory.

## CODEX-004E failure and CODEX-004F exception-safety remediation

CODEX-004E independently re-examined `eb9b54273f580d81610a84dd0f924a6b47dfe095` and returned
RE-AUDIT FAILED for HIGH A19-H01-R2 despite all 613 permanent tests passing. Four adversarial cases
showed diagnostic extraction escaping initialization failure handling, stranding VALIDATING and
falsely certifying READY/HEALTHY. The original source/results and failed report remain unchanged.

CODEX-004F uses `codex/prompt-19-exception-safety-remediation` from that exact source. Changes are
limited to the existing replay controller/runtime, one new permanent regression file and necessary
lifecycle documentation. Failure finalization precedes total bounded diagnostic extraction; runtime
contains exceptional initialization exits through authoritative controller provenance, disposes only
settled provisional owners and requires initialized checkpoint/state evidence for readiness.

`tests/market-replay/exception-safety-remediation.test.ts` adds 33 permanent regressions for
required A–O cases: hostile/second-read/Symbol/proxy/primitive rejection values, actual file and
historical-owner failures, unexpected initialization exit before/after repository activity, real
uncertain and confirmed commitment, corrupt recovered view, readiness views and actual held
admission/control publication, concurrent/reentrant shutdown, same-identity replacement, immutable
bounded diagnostics and failed optional sampling. The 613 prior permanent tests remain
byte-unchanged. Version, dependencies, capability flags and all 11 upstream owner packages remain
unchanged.

The external delivery report records actual permanent/security results, unchanged original A/C/E
probe assertions, original-versus-approved-phase accounting, and exact commit/remote verification.
The two unchanged C cumulative-counter failures remain reported separately as historical measurement
defects; they are never relabeled passing. No audit source, assertion or failed history is replaced.

Current status: THIRD EXCEPTION-SAFETY REMEDIATION — PENDING INDEPENDENT RE-AUDIT AND ACCEPTANCE.
F05/F06/T01/M02, single-writer/trusted-root, bounded quality and explicit loss reconciliation
remain. No Prompt 19 acceptance successor, production/trading approval or Prompt 20 authorization is
created.

## Fourth post-admission remediation — CODEX-004G/004H

CODEX-004G audited `24d83df399a4cde76d668ddbd102d53dd46cd89a` and failed HIGH A19-H01-R3 despite 646
passing tests / 51 files. Initializer-specific R2 was closed, but post-admission runBoundary
diagnostics could throw before terminal failure classification, leaving false READY/HEALTHY. The
original three passing controls and twelve failed probes, source/assertions/results and audit report
remain historical evidence outside the checkout.

CODEX-004H starts from that exact SHA on `codex/prompt-19-boundary-exception-remediation`.
Controller post-admission finalization precedes the reused guarded diagnostic normalizer, retains
acknowledged identity/checkpoint and genuine obligations, and restores its selected terminal state
after reentrant diagnostics. Source-failure paths for snapshots and pending-read reconciliation use
the same authority; valid-source snapshot-request rejection remains nonfatal. No runtime/upstream
owner, version, dependency, capability or accepted Prompt 18 governance change is introduced.

`tests/market-replay/boundary-exception-remediation.test.ts` covers the real-file 15-case audit
matrix, five bounded-reconstruction variants, lifecycle-before-access observation, phase-A unchanged
durable identity and phase-B unavailable commands/repeated failed stop/fresh trusted recovery.
Additional cases cover proxy/primitive/coercion faults, concurrent/reentrant shutdown/commands,
honest actual unknown/committed storage outcomes, recovered content, pending runtime events,
configuration/origin mismatch, governed branch reconstruction and adjacent source-failure paths.
Original permanent tests remain unchanged; assertions captured in getters are evaluated outside
normalization catches.

The external delivery report records actual final permanent counts/gates, original unchanged G/E/A/C
results, separate 24-fault execution, approved phase-corrected accounting, protected-file/evidence
hashes and exact local/remote publication identity. The two unchanged C cumulative-counter failures
remain reported separately; their authorized phase-corrected probes verify zero effects immediately
after rejection and legitimate later persistence. No failed history is rewritten or labeled passed.

This is implementation remediation only, pending independent re-audit and acceptance.
F05/F06/T01/M02, current-registry and bounded quality/correction/source-loss constraints,
trusted-root/single-writer, offline scope and Prompt 20 restrictions remain mandatory.

## Fifth control-publication remediation — CODEX-004I/004J

CODEX-004I audited `8d70bef74418551216b4c0f16a88055a5348a17d`: original R3 matrix15/15 and all694
permanent tests passed, but HIGH A19-H01-R4 exposed lost in-process publication work after real
acknowledgement. Its four failing assertions, three confirmation phases/healthy controls, report and
complete independent appendix remain unchanged outside checkout.

CODEX-004J retains the original checkpoint/specification before fallible publication preparation,
checks immutable bounded capacity before new acknowledgement, validates current configuration on
publication/retry, preserves cached identity and ambiguous dispatch, serializes FIFO retry and
prevents repeated stop superseding pending summaries. A callback's unsuccessful exit after real
advancement retains its last acknowledgement. Busy shutdown requests cancellation without another
checkpoint through the existing controller state/flag authority; no repository/branch/comparison
refactor or second owner is introduced.

The new publication-obligation-remediation permanent suite covers R4-01–20 plus preparation/report
inspection faults, actual storage certificates, queued stop interleaving and pre/post-ack callback
exceptions. Tests use real governed runtime owners, typed actual event-context payload observations
and filesystem evidence; the accepted694 tests remain unchanged. The external delivery report
records actual final counts, before/after four exact failures, historical/regression/security gates,
source/evidence hashes and published commit. Original C38/40 failures remain separately visible;
approved phase-corrected2/2 is not a rewrite of historical assertions.

Current status: FIFTH PUBLICATION-OBLIGATION REMEDIATION — PENDING INDEPENDENT RE-AUDIT AND
ACCEPTANCE. Version stays0.19.0-market-replay.1. F05/F06/T01/M02, bounded quality, explicit loss,
trusted-root/single-writer and offline restrictions remain. No Prompt20 implementation or authority
is created; independent technical review and separate external governance acceptance are required.

## Sixth full-acknowledgement remediation — CODEX-004K/004L

CODEX-004K audited b5c7714c205e4bc1fb6231d2ca2d92e49814e899 with733 tests/53 files passing and
confirmed HIGH A19-H01-R4-R1. State-only control generations can share semantic checkpointId;
failed-callback discovery therefore omitted real ACKs, false healthy availability and retry
evidence. Its original sources, nine failed results, durable artifacts and failed report remain
unchanged.

CODEX-004L compares the same authoritative owner's generation/full fingerprint before retaining the
last real ACK. It performs no hash, governance/clock or diagnostic callback before retention. The
semantic ID/storage operation/event algorithms, controller, eleven upstream packages, dependencies,
version and capabilities remain unchanged. Existing locks/pending fences prevent competing
same-session generations; reobserved one-ACK preparation failures retain one descriptor.

The focused permanent suite covers state-only pause/resume/stop throws and unsuccessful results,
full event/operation identity, real recovery, no-ACK/source/prewrite cancellation controls, honest
UNKNOWN, capacity one, same-ID cycles, drift, reader/dispatch ambiguity and
malformed/getter/non-Error callback outcomes. Existing733 tests are preserved; actual counts and
security/historical results are recorded in the external delivery report. Original K confirmation
probes contain contradictory fault-observation assertions. The user authorized preserving their
unchanged historical failures separately, requiring the six original K01 positive-invariant probes
unchanged and all distinct new acceptance probes to pass. Original sources/reports remain untouched;
no failed harness is reported as passed. This clarification changes test accounting only, not
runtime or governance requirements.

SIXTH FULL-ACKNOWLEDGEMENT-IDENTITY REMEDIATION — PENDING INDEPENDENT RE-AUDIT AND ACCEPTANCE.
Version0.19.0-market-replay.1 remains unchanged. F05/F06/T01/M02, offline/no-financial and Prompt20
restrictions remain mandatory. This record does not independently close the finding or accept19.

## CODEX-004N authoritative success-path acknowledgement remediation

Parent: `84587f10d0b4e4478463a0b46b9e4dee2944e55c`; dedicated branch:
`codex/prompt-19-authoritative-success-ack-remediation`. Version remains `0.19.0-market-replay.1`.
CODEX-004M's genuine stale-success fault is preserved outside the checkout with its original
sources, results and reports. Before remediation its unchanged campaign is 17/18 (one genuine
failure); post-remediation results are recorded in the external N delivery report.

Runtime-only correction unifies actual owner ACK discovery before success/failure result inspection.
Existing checkpoint validation follows retention; valid stale success reconciles to the actual ACK.
No new storage/event/hash authority, controller redesign, dependency or capability change is made.
The additive `authoritative-success-ack-remediation.test.ts` covers actual filesystem control and
cursor-changing ACKs, generic command operations, report getters, no-op/no-ACK, preparation
failures, uncertain delivery, exact retry, capacity/FIFO, reentrancy, shutdown and real fenced
recovery.

All starting 762 permanent tests are preserved byte-for-byte. Historical K contradictory
confirmation assertions and C cumulative-counter measurement failures remain unchanged and are
reported separately from positive-invariant acceptance alternatives; they are not claimed passed.
The complete immutable before/after evidence, commands, gate outcomes and publication SHA are in
`/workspace/ate-reports/ATE-CODEX-004N-PROMPT-19-AUTHORITATIVE-SUCCESS-PATH-ACKNOWLEDGEMENT-REMEDIATION-DELIVERY-REPORT.md`.

Implementation completion is subject to recorded successful verification and does not close
A19-H01-R4-R2 independently. Prompt 19 acceptance stays PENDING; Prompt 20 NOT AUTHORIZED.
F05/F06/T01/M02 and all bounded offline research-only restrictions remain.

## CODEX-004P conditional governance acceptance record

This append-only record accepts implementation `da70072222a22ca1564f307be9891c397496532e`, version
`0.19.0-market-replay.1`, after CODEX-004O's conditional technical re-audit. **Authorized option A
approval was explicitly supplied by the project decision-maker in this session.** Capacity supplied:
Project Owner / Authorized Project Representative. Approval date supplied: 9 October 2026. The
supplied name field was literally "[Insert your name]"; no personal name is inferred or invented.
Authority is the session user's explicit project-owner declaration. The approval explicitly
identifies the exact SHA, conditions, all five historical exceptions, O-C01/O-C02 and reviewer
participation, and authorizes only these governance appendices. Verbatim external approval evidence:
CODEX-004P-evidence/authorized-user-approval.txt; SHA256
`a7ba4f4b17753a39aa185dc87bd6e757af49e6601c57ab9851e03fdb464fd999`. This is authorized governance
approval, not organizationally independent technical certification. The technical reviewer
participated in earlier implementation/audit/test work; the review is not organizationally
independent. Earlier failed audits and remediation evidence remain intact.

Authorized decision: Prompt 19 CONDITIONALLY ACCEPTED for bounded offline research infrastructure
only. Prompt 20 remains NOT AUTHORIZED; unrelated prompt statuses and accepted upstream authorities
remain unchanged. The technical baseline is the exact SHA above; its verified governance-only direct
successor carries this acceptance record.

F05: Windows filesystem/open-handle/locking/durability unqualified. F06: production throughput and
actual power-loss durability unqualified. T01: trusted terminating owners/repositories, honest
native certificates, trusted root and single-writer assumptions mandatory. M02: current
registry/calendar governance context, not complete historical bitemporal membership. Pending
summaries are volatile; no durable outbox or universal exactly-once subscriber delivery. Bounded
quality evidence, explicit consumer-loss reconciliation, conservative source fences and unsupported
legacy/native correction limits remain. Offline research only: no broker, trading, orders, financial
execution, live execution or production deployment approval.

O-C01: callback success certifies the actual acknowledged owner checkpoint, not every internal
operation in a compound callback. A caller requiring aggregate failure must propagate the relevant
rejected operation; no additional transaction-level atomicity is claimed.

O-C02: a historical ACK does not certify current READY/HEALTHY or completed shutdown. Later
cancellation may leave STOPPING while the genuine earlier ACK is published. Inspect current
lifecycle, readiness, health, pending publication and storage/recovery obligations separately. An
ACK neither authorizes more work nor invalidates an earlier real commitment after cancellation. This
clarifies the phase of earlier stopping-owner wording without rewriting historical evidence.

Historical exceptions explicitly acknowledged in the authorized approval: original C 38/40 (two
cumulative-call measurement failures; phase-corrected 2/2), original K confirmation 1/4 (three
contradictory pending=0/pending=1 defect-observation assertions). Those five failures remain
failures and their source/results/exit codes remain preserved. Original K01 six positive invariants
and separately identified corrected-behavior tests pass; no runtime invariant is waived.

Technical evidence: original M 18/18 unchanged; O 50/50; permanent 820/820 across 55 files, zero
skipped; format/lint/typecheck/secrets/full and production audits/dependency graph passed. These are
authenticated CODEX-004O results; fresh governance-successor verification is recorded in the
external CODEX-004P delivery report. Neither verification is production qualification. Finding
closures are technical within tested supported scope, not proof of universal absence. External
CODEX-004P finding and historical exception registers identify original failures, remediation SHAs
and final raw evidence. The recorded approval preserves this distinction.

Implementation, technical verification, governance acceptance and operational qualification are
separate decisions. Accepted scope comprises authenticated deterministic replay, governed
clocks/sequence, supported multi-timeframe integration, point-in-time versus event-time
reconstruction, checkpoints/recovery, branches/comparison, source/quality evidence, lifecycle,
bounded summaries and exact ACK identity.
