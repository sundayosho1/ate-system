# ATE — CODEX-002G PROMPT 17 INDEPENDENT RE-AUDIT REPORT

## A. Executive Verdict

F04-R2 is corrected for compliant synchronous repositories, including failures after real durable
manifest commitment. Immediate UNKNOWN evidence, failed readiness, truthful later/repeated shutdown,
ownership-safe non-compensation and fresh recovery were independently reproduced. The filesystem
no-mutation certificate is enforced before the first attempted mutating call, and seven additional
fault probes found no incorrectly certified mutation.

Recommend conditional acceptance of the bounded offline research foundation. F05/F06 remain
unqualified, and repository certificates require trusted, contract-compliant implementations. The
service does not independently authenticate a custom repository's certificate against disk; an
intentionally false certificate bypasses accounting. This is a demonstrated trust limitation, not a
demonstrated defect in the compliant filesystem repository. Untrusted repository implementations
must not be admitted under this recommendation.

Fresh verification passed 292 permanent tests across 19 files, 31 capture tests, and 10 additional
temporary probes. Security gates reported zero vulnerabilities. This is a fresh source/runtime
review in the same assistant session as implementation, not a separate organizational acceptance
decision. No application or permanent test files, ledger, commit or remote branch were changed.
Prompt 18 remains blocked pending independent acceptance.

## B. Exact Commit and Repository State

- Repository: `sundayosho1/ate-system`, `/workspace/ate-system`.
- Branch: `codex/prompt-17-creation-remediation`.
- Exact target: `6632caed6558017690f98e6f3ee1e2cbb7435658`.
- Direct parent: `f09b068e6642e0094f6c19fafe836d8370287cb1`.
- Working tree clean before and after audit.
- Version: `0.17.0-realtime-data.1`; Node 24.19.0/npm 11.9.0 satisfy >=22/>=10 declarations.
- Expected four-file diff: 317 insertions/8 deletions.
- Prompt 17 original `1a55f1d`, CODEX-002B `eb1a593`, CODEX-002D `f09b068` and dependency
  remediation `4311e58` remain ancestors.

Commands: `git branch --show-current`, `git rev-parse HEAD HEAD^`, `git status --short`,
`git merge-base --is-ancestor`, `git diff HEAD^ HEAD --stat`, and full `git diff HEAD^ HEAD`.
Ledger, capability manifest, package manifests and lockfile have no parent-to-target diff. Ledger
still records independent acceptance pending and Prompt 18 NOT STARTED. No baseline mismatch
occurred.

## C. Four-File Diff Review

Reviewed actual diff and surrounding contracts/runtime, not merely delivery claims:

| File                                              | Actual change                                                                                      | Assessment                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `packages/realtime-data/src/service.ts`           | Additive start-result type; UNKNOWN retention independent of stopping unless certified no mutation | Corrects missing ordinary-running accounting path                              |
| `packages/realtime-data/src/capture.ts`           | Optional NOT_CREATED result certificate and mutation-attempt boundary                              | Enforced for filesystem implementation; not a global rollback guarantee        |
| `tests/realtime-data/capture-remediation.test.ts` | Ten appended cases, helpers, expanded filesystem imports                                           | Existing 21 cases/fixture logic preserved                                      |
| `docs/help/real-time-data-ingestion.md`           | Commitment, ownership, certificate and recovery explanation                                        | Matches inspected compliant-port behavior; explicit trust/platform limitations |

A byte comparison from the unchanged `tmpdir` import through the original capture suite confirms
original fixtures/assertions are preserved; only its first filesystem import expanded.
`remediation.test.ts` and all other original tests are unchanged. No manifest format, hash rule,
recovery algorithm, scheduler, state authority or dependency change is present.

## D. F04-R2 Reproduction

Independent probe:
`independent exact F04-R2 before shutdown preserves obligation and fresh recovery`, in
`/tmp/ate-002g-probes/outcomes.test.ts`. It uses the real FilesystemCaptureRepository, successfully
publishes a RUNNING manifest, then returns structured PERSISTENCE_FAILED without a certificate
before initiating shutdown.

Actual observations/assertions:

1. Creation returns the injected structured failure.
2. Immediately: FAILED, recoveryRequired true, provider capture ID `exact`, lastKnownManifestState
   UNKNOWN, cleanupConfirmed false, no active capture, readiness false.
3. Disk remains honestly RUNNING.
4. Later stop and repeated stop return the same failure.
5. Abort count is zero on the uncertain identity.
6. A fresh service/new repository at the same root starts successfully and commits ABORTED through
   existing recovery.
7. The old service retains its failure after disk recovery.

Probe passed. Permanent counterpart
[capture-remediation.test.ts:483](/workspace/ate-system/tests/realtime-data/capture-remediation.test.ts:483)
also freshly passed. Source
[service.ts:1114](/workspace/ate-system/packages/realtime-data/src/service.ts:1114) now retains
uncertified structured outcomes regardless of stopping. **F04-R2 CLOSED for the documented trusted
contract.**

## E. No-Mutation Certificate Review

Contract [capture.ts:37](/workspace/ate-system/packages/realtime-data/src/capture.ts:37), type :50:
NOT_CREATED means this attempt performed no mutating storage operation. It says nothing about
preexisting artifacts. Uncertified generic results remain compatible and uncertain.

Boundary [capture.ts:140](/workspace/ate-system/packages/realtime-data/src/capture.ts:140):
read-only validation/discovery/path checks occur before mutationAttempted; the flag is set at :159
before mkdirSync. It never resets within that call. Catch at :167 can issue NOT_CREATED only before
this boundary. Constructor root setup predates the attempt and is not certified as mutation-free.

Seven independent fault variants all passed, each asserting failure, no certificate, exactly one
injected fault, retained UNKNOWN, failed later/repeated stop and actual recovery behavior:

| Injected fault                        | Observed storage/recovery result                                       |
| ------------------------------------- | ---------------------------------------------------------------------- |
| mkdir before actual mutation          | No artifact; fresh discovery succeeds; old instance remains failed     |
| mkdir after actual directory creation | Incomplete directory; fresh startup fails closed                       |
| records.partial open                  | Directory exists without complete manifest; fresh startup fails closed |
| manifest write after real write       | Partial creation evidence; no certificate; fresh startup fails closed  |
| manifest fsync                        | No committed manifest; fresh startup fails closed                      |
| manifest rename before actual rename  | Temporary manifest/partial content; fresh startup fails closed         |
| manifest rename after real rename     | Actual RUNNING manifest; fresh recovery commits ABORTED                |

Permanent :696 independently confirms legitimate symlink rejection: certificate emitted, no writes
through the link, no new obligation, successful idempotent stop. Permanent :710 confirms real
partial creation/oversized publication cannot be certified and fresh startup fails. A separate
independent pre-write invalid-state probe with an existing COMPLETED identity proves certification
does not imply artifact absence; its exact manifest bytes/hash verification remain unchanged.

### Certificate trust limitation — T01

The service checks `result.commitment` directly at service :1116; it does not inspect disk or
establish certificate provenance. Independent probe
`contract-violating false certificate is trusted port evidence, not independent disk proof`
deliberately commits RUNNING and lies by returning NOT_CREATED. **Observed:** no recovery
obligation, successful stop, RUNNING left on disk; fresh repository recovery still discovers/aborts
it.

This probe's passing assertions establish the limitation, not safe behavior of an untrusted
implementation. Such a return violates the explicit repository contract. A custom port can similarly
lie about success, abort or recovery, so the service cannot be described as validating arbitrary
untrusted storage implementations. Help :297–306 explicitly requires custom repositories to honor
the contract; root/writer trust is documented at :125–141. No evidence establishes that hostile
storage ports are supported inputs. Acceptance is therefore conditional on trusted,
contract-compliant repositories. If untrusted repository execution is required, this recommendation
does not apply and additional enforcement/design is needed. The certificate is **not** independently
verified general filesystem proof.

## F. Complete Creation Outcome Matrix

All referenced permanent tests were actually executed in the targeted and full runs. `C` means
`tests/realtime-data/capture-remediation.test.ts`; `R` means
`tests/realtime-data/remediation.test.ts`.

| Transition                         | Observed result                                                 | Executed evidence                                          |
| ---------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------- |
| Success/active registration        | Real RUNNING capture active; shutdown accounts it               | C:263; R:424                                               |
| Pre-call rejection                 | No port operation before valid initialized lifecycle/safe ID    | R:419/:436/:446/:453/:460; unchanged unsafe-path case      |
| Proven no-mutation failure         | No new obligation; safe stop; no claim about existing artifacts | C:696; independent preexisting-COMPLETED certificate probe |
| Unknown structured failure         | Immediate UNKNOWN and FAILED, false readiness                   | C:483/:551; independent exact probe                        |
| Unknown thrown failure             | Safe PERSISTENCE_FAILED, UNKNOWN, no exception detail leak      | C:396/:445/:551                                            |
| Success followed by lifecycle loss | Confirmed capture compensated through existing abort            | C:126; R:524                                               |
| Successful compensation            | ABORTED only after repository success; idempotent stop          | C:126/:204                                                 |
| Structured failed compensation     | RUNNING/obligation retained; parent/repeated stop fail          | C:135/:165/:194                                            |
| Thrown compensation                | Structured failure and honest RUNNING evidence                  | C:135/:165                                                 |
| Failure during shutdown            | Parent shared-obligation check detects uncertainty              | C:421/:580                                                 |
| Failure before shutdown            | Later and repeated stop fail                                    | C:483; independent exact probe                             |
| Reentrant stop                     | Guard prevents recursion/duplicate compensation                 | C:338/:580                                                 |
| Repeated stop                      | Failure persists without retry; success remains idempotent      | C:194/:204/:483/:696                                       |
| Fresh recovery                     | RUNNING discovered and aborted by actual repository             | C:224/:483; independent exact/rename-after probes          |
| Failed recovery                    | Startup/readiness fail; no false ABORTED                        | C:244/:528/:710; independent partial-artifact probes       |
| Preexisting COMPLETED identity     | Duplicate failure doesn't abort/alter completed content         | C:665; independent certificate probe                       |
| Partial artifact/no manifest       | UNKNOWN retained; recovery fails closed                         | C:710; independent mkdir/open/write/fsync/rename-before    |
| Multi-provider nested creation     | Separate IDs/UNKNOWN retained; both durably recover             | C:598                                                      |
| Diagnostic history eviction        | One sample evicted without losing obligations                   | C:354/:598                                                 |
| Late callbacks                     | Cannot activate/retry after capture failure or stop             | C:309/:644; R:492                                          |
| Already FAILED                     | New creation rejected; old evidence preserved                   | C:483/:528/:551; R:453                                     |

No additional unaccounted commitment path was reproduced in compliant repository outcomes. T01 is
the explicitly demonstrated out-of-contract trust limitation.

## G. Lifecycle, Shutdown and Readiness

Creation reserves the bounded provider slot before the synchronous call and clears it in finally
(:1086–1113). Uncertified result retention at :1116 uses the existing immutable recovery record,
marks failed and emits bounded RECOVERY_REQUIRED evidence (:1142). It does not fabricate active
capture state or abort unknown ownership.

Diagnostics expose aggregate recoveryRequired (:1218), provider pending ID and recovery record
(:1243). Readiness rejects failed/stopping state (:1256). New capture guards reject FAILED,
STOPPING, STOPPED, incomplete initialization, occupied reservation or obligation (:1069).

Final stop consults shared obligations after adapter work (:1332); already-stopped calls consult
them at :1279. Reentrant synchronous failures finish before the asynchronous stop continuation
checks shared state. Pending disconnect and repeated stop cases passed; no uncontrolled storage
retry or new lifecycle authority was found.

## H. Manifest Integrity and Recovery

Existing repository authority remains abort :291, recover :301 and verify :262. Recovery aborts
actual RUNNING state, verifies COMPLETED, and fails on incomplete/malformed artifacts. Content
rename precedes completed commit marker; hash/count/byte verification remains unchanged.

C:279/:298/:665 and independent probes verify completed preservation, interrupted content, unknown
creation discovery and failed partial recovery. Actual rename-after injection is particularly
relevant: repository operation failed after a real manifest commit, yet service uncertainty remained
retained and fresh recovery operated on real disk evidence. UNKNOWN does not invent an artifact when
failed mkdir made none. No false COMPLETED/ABORTED state was observed in compliant fault paths.
Partial roots may require controlled operator repair under existing policy; this audit does not
qualify power-loss recovery for every filesystem.

## I. Reentrant and Multi-Provider Fault Review

Inspected reservations and per-provider retention, final stop and bounded diagnostics. C:320 fences
recursive same-provider starts; C:338 prevents reentrant abort-stop recursion; C:384 keeps shutdown
failure while disconnect is pending; C:598 nests two real provider creations with maxEvidence=1 and
preserves correct source/capture identities despite actual eviction. Both are recovered through the
existing repository.

A retained obligation cannot be overwritten by another permitted start because global
failed/provider guards reject it. Cross-provider synchronous nesting is bounded by provider slots.
No competing recovery registry, new unbounded loop, deadlock or duplicate uncertain-identity
compensation was demonstrated. Stress/performance qualification was not performed.

## J. Prior Finding Preservation

Source and actual permanent assertions were inspected; all executed in the fresh full suite.

| Finding                   | Source/test evidence                                                                               | Observed result                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| F01 reconnect timeout     | service :457 dispatch returns immediately with rejection handling; R:95–198 nine cases             | Pending retries do not starve deadlines/unrelated work; cancellation, late outcomes, exhaustion pass             |
| F02 freshness/readiness   | service :1032/:1256; timestamp updates after canonical/dedup checks :951; R:200–330 fourteen cases | Immediate stale/duplicate/future/invalid observations cannot establish freshness/readiness                       |
| F03 native input          | schema :50, bounded/schema boundary :634, guarded fingerprinting; R:385 sixteen cases              | Structured rejection, no escaping callback exception, unrelated streams continue                                 |
| F04-R1 cleanup failure    | service :1132/:1142/:1332; C:135/:165/:194/:224/:384                                               | Structured/exception aborts retain honest RUNNING state and failed parent/repeated stop; fresh recovery succeeds |
| F07 registry immutability | adapters :60 frozen wrapper/bound methods; R:553                                                   | External wrapper mutation fails while normal adapter function/readiness works                                    |

All remain CLOSED on inspected source/executed evidence. The original fixture assertions were not
weakened or replaced with passing approximations. The bounded microtask flush does not advance
virtual time or hide a blocked scheduler. Residual production/adapter/platform qualification is
separate.

## K. Security and Architecture

Dependency remediation `4311e58` is preserved; installed graph contains source-map-js 1.2.2.
Full/production audits report zero vulnerabilities; npm ls --all validates the graph; secret hygiene
passes 309 files. npm ci leaves the lockfile unchanged.

Ten source packages remain, preserving all original nine and realtime-data. Version, exports,
workspace manifests, configuration/governance/canonical contracts, state/events, clock/scheduler,
hashing/storage formats and source isolation have no unrelated diff. No live broker/trading
implementation, Prompt 18 aggregation or Prompt 19 replay was introduced. Audit controls and
accepted/pending capability policy are unchanged. Typecheck is the declared compile gate, not a
deployment qualification.

## L. Windows and Capture Performance Limitations

**F05 CONDITIONALLY ACCEPTED for offline foundation:** actual Windows execution, open handles,
rename semantics and filesystem durability remain unverified. Linux execution cannot certify Windows
production.

**F06 CONDITIONALLY ACCEPTED for offline foundation:** synchronous capture throughput/latency and
power-loss durability remain unqualified. No load benchmark, production SLA or trading deployment
test was run. File fsync does not prove directory metadata durability across all filesystems.

References: capture write/rename implementation, help :125–141/:258/:336. Single writer and trusted
root remain required. These limitations are nonblocking for the bounded offline foundation only;
unsupported production claims remain blocked.

## M. Full Verification Results

| Executed command/gate                                            | Actual outcome                                                             |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Exact Git/ancestry/diff preflight                                | Required target/parent, clean tree, expected four files, preserved history |
| `npm ci --cache /workspace/.npm-cache`                           | Exit 0; 159 packages installed; lock unchanged                             |
| `npx vitest run tests/realtime-data/capture-remediation.test.ts` | Exit 0; 1 file/31 passed; 0 failed/skipped                                 |
| `npm run verify`                                                 | Exit 0                                                                     |
| Formatting / ESLint / `tsc --noEmit`                             | Passed                                                                     |
| Full automated suite                                             | 19 files/292 passed, 0 failed/skipped                                      |
| Secret scan                                                      | Passed, 309 repository files                                               |
| Verification audit                                               | 0 vulnerabilities                                                          |
| `npm audit`                                                      | Exit 0, 0 vulnerabilities                                                  |
| `npm audit --omit=dev`                                           | Exit 0, 0 vulnerabilities                                                  |
| `npm ls --all`                                                   | Exit 0, valid graph                                                        |
| Independent temporary probes                                     | Exit 0, 1 file/10 passed, 0 failed/skipped                                 |
| `git diff --check`, target/parent diff check                     | Passed                                                                     |
| Final `git status --short`                                       | Empty                                                                      |

Independent command: `node_modules/.bin/vitest run --config /tmp/ate-002g-probes/vitest.config.mts`.
Probe source/config/log reside outside the checkout. Initial temporary config could not resolve
vitest/config from /tmp; adding an external node_modules symlink to the installed checkout resolved
this setup issue. That zero-test setup failure is not counted as verification. The ten passing
probes comprise exact R2, seven filesystem faults, preexisting-identity certification and one
trust-limit characterization; the last is not an assertion that a lying port is safe. Existing
counts are not inflated by repeatedly running the same capture cases.

Logs: `/tmp/ate-002g-ci.log`, `/tmp/ate-002g-targeted.log`, `/tmp/ate-002g-verify.log`,
`/tmp/ate-002g-audit.log`, `/tmp/ate-002g-prod.log`, `/tmp/ate-002g-deps.log`,
`/tmp/ate-002g-probes/results.log`. No unhandled async rejection was reported. No environment
blocker remains for this Linux audit.

## N. Findings Disposition Matrix

| Finding | Original issue/limitation                                       | Actual evidence                                                                                             | Residual risk                                                            | Disposition                             | Acceptance blocker                                               |
| ------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------- | ---------------------------------------------------------------- |
| F01     | Retry starved timeout scheduler                                 | service :457; R:95 nine fresh passing cases                                                                 | Host must drive deterministic scheduler; commercial adapters unqualified | CLOSED                                  | No                                                               |
| F02     | Stale arrival established readiness                             | service :1032/:1256; R:200 fourteen cases                                                                   | Governed skew/source-time policy is not provider truth certification     | CLOSED                                  | No                                                               |
| F03     | Malformed native envelope escaped boundary                      | service :634; R:385 sixteen cases                                                                           | Trusted normalization still defines provider interpretation              | CLOSED                                  | No                                                               |
| F04     | Capture outcomes escaped accounting                             | R1 permanent :135/:194; R2 permanent :483, exact independent reproduction; filesystem boundary fault probes | Trusted port contract and controlled incomplete-root recovery required   | CLOSED for compliant offline foundation | No within documented scope                                       |
| F05     | Windows filesystem/execution unqualified                        | Source/help review; Linux-only execution                                                                    | Windows/open-handle/durability qualification pending                     | CONDITIONALLY ACCEPTED                  | No for offline foundation; Windows production unsupported        |
| F06     | Production capture throughput/durability unqualified            | Source/tests; no production benchmark/power-loss test                                                       | Latency, storage performance and power-loss behavior unqualified         | CONDITIONALLY ACCEPTED                  | No for offline foundation; production claims unsupported         |
| F07     | Mutable registry wrapper                                        | adapters :60; R:553 passed                                                                                  | Adapter implementation internals remain trusted                          | CLOSED                                  | No                                                               |
| T01     | No independent authentication of custom no-mutation certificate | service :1116; independent false-certificate probe produced successful stop with RUNNING disk artifact      | A lying/compromised storage implementation bypasses the trusted contract | CONDITIONALLY ACCEPTED trust limitation | No for trusted implementations; blocks admitting untrusted ports |

T01 is a confirmed scope limitation with observed behavior, not a newly established HIGH defect in
the compliant filesystem implementation. F05/F06 are untested operational qualifications, not
reproduced correctness failures. No unresolved acceptance-blocking defect was reproduced within the
documented bounded offline contract.

## O. Remaining Acceptance Blockers

No implementation/security blocker remains for the trusted, single-writer offline foundation on
inspected evidence. Independent acceptance itself remains outstanding. Conditional acceptance must
preserve F05/F06 and T01 restrictions; it must not grant Windows production, throughput/durability
certification, trading deployment or untrusted-storage support.

If an acceptance reviewer requires protection against falsely certifying untrusted repositories,
additional work is required before expanding that trust model; the current service does not provide
that guarantee. This report explicitly declines to infer it from a certificate string.

## P. Prompt 18 Readiness Recommendation

Recommend the exact target for **conditional independent acceptance** of Prompt 17 within its
bounded offline scope. Maintain Prompt 18 BLOCKED until an authorized independent decision-maker
records acceptance and explicitly authorizes its implementation. This audit does not modify the
acceptance ledger, approve Prompt 17, or start Prompt 18/19.

## Q. Final Verdict

**RE-AUDIT PASSED WITH NONBLOCKING CONDITIONS — RECOMMENDED FOR CONDITIONAL ACCEPTANCE**

Conditions: trusted contract-compliant capture repositories, single-writer/trusted-root operation,
and retained F05/F06 operational limits. Exact target and application/permanent test files remain
unchanged; final working tree is clean. STOP after this report.
