# Prompt Implementation Ledger

This ledger tracks governed development prompts. Do not mark future prompts complete before
implementation and verification.

| Prompt | Title                                                                 | Status    | Version/Checkpoint               | Completion Date | Test Baseline    | Important ADRs            | Migrations | Known Limitations                                                                                                                                                              |
| ------ | --------------------------------------------------------------------- | --------- | -------------------------------- | --------------- | ---------------- | ------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1      | Master Architecture, Repository Foundation & Engineering Constitution | Completed | `0.1.0-foundation.1`             | 2026-09-25      | `npm run verify` | ADR-0001 through ADR-0007 | None       | No trading/runtime functionality implemented                                                                                                                                   |
| 2      | Core Domain Contracts & Canonical Trading Language                    | Completed | `0.2.0-domain.1`                 | 2026-09-25      | `npm run verify` | ADR-0008                  | None       | Contracts only; no engines or trading behavior implemented                                                                                                                     |
| 3      | Application Runtime, Lifecycle & Graceful Degradation                 | Completed | `0.3.0-runtime.1`                | 2026-09-25      | `npm run verify` | ADR-0009                  | None       | Runtime infrastructure only; no trading services implemented                                                                                                                   |
| 4      | Event Architecture, Internal Event Bus & Delivery Semantics           | Completed | `0.4.0-events.1`                 | 2026-09-25      | `npm run verify` | ADR-0010 through ADR-0012 | None       | In-memory event infrastructure only; no durable event store, external broker, market-data ingestion, MT5, or trading behavior implemented                                      |
| 5      | Persistence, State Authority & Transactional Integrity                | Completed | `0.5.0-persistence.1`            | 2026-09-25      | `npm run verify` | ADR-0013 through ADR-0017 | None       | Persistence foundation only; no market-data platform, trading accounts, risk/portfolio/execution engines, MT5, or live trading implemented                                     |
| 6      | Clock, Time Authority, Temporal Integrity & Deterministic Runtime     | Completed | `0.6.0-time.1`                   | 2026-09-25      | `npm run verify` | ADR-0018 through ADR-0022 | None       | Time foundation only; no market calendars/sessions, market-data replay engine, trading services, MT5, or live trading implemented                                              |
| 7      | Hierarchical Configuration Engine                                     | Completed | `0.7.0-config.1`                 | 2026-09-25      | `npm run verify` | ADR-0023 through ADR-0027 | None       | Configuration foundation only; Prompt 8 schemas, Prompt 9 version lifecycle, approvals, promotion/rollback, frontend and trading remain future scope                           |
| 8      | Configuration Schema, Validation, Constraints & Invalid Rejection     | Completed | `0.8.0-config-schema.1`          | 2026-09-25      | `npm run verify` | ADR-0028 through ADR-0030 | None       | Schema validation foundation only; Prompt 9 version lifecycle, approvals, promotion/rollback, frontend, feature flags and trading remain future scope                          |
| 9      | Immutable Configuration Versioning                                    | Completed | `0.9.0-config-versioning.1`      | 2026-09-25      | `npm run verify` | ADR-0031 through ADR-0035 | None       | Immutable version-history foundation only; Prompt 10 feature flags, Prompt 11 maker-checker approval, Prompt 12 promotion/rollback, frontend and trading remain future scope   |
| 10     | Feature Flags and Capability Control                                  | Completed | `0.10.0-capabilities.1`          | 2026-09-25      | `npm run verify` | ADR-0036 through ADR-0040 | None       | Capability-control foundation only; Prompt 11 maker-checker approval, Prompt 12 promotion/rollback, frontend, market data, MT5, execution and trading remain future scope      |
| 11     | Maker-Checker Configuration Approval                                  | Completed | `0.11.0-config-approval.1`       | 2026-09-25      | `npm run verify` | ADR-0041 through ADR-0045 | None       | Approval governance foundation only; Prompt 12 promotion/rollback, enterprise RBAC/IAM, frontend, market data, MT5, execution and trading remain future scope                  |
| 12     | Controlled Configuration Promotion, Activation and Rollback Authority | Completed | `0.12.0-config-promotion.1`      | 2026-09-25      | `npm run verify` | ADR-0046 through ADR-0050 | None       | Phase II configuration/control-plane complete; no market data, MT5, execution, paper/live trading, frontend, enterprise RBAC/IAM or production durable release adapter         |
| 13     | Universal Market Data Contracts                                       | Completed | `0.13.0-market-data-contracts.1` | 2026-09-25      | `npm run verify` | ADR-0051 through ADR-0055 | None       | Contracts only; no historical storage, data-quality engine, dataset catalogue, provider ingestion, aggregation, replay, instrument registry, MOSE, strategy, risk or execution |
| 14     | Historical Data Laboratory                                            | Completed | `0.14.0-historical-data.1`       | 2026-09-25      | `npm run verify` | ADR-0056 through ADR-0060 | None       | Offline historical artifact intake and research datasets only; no data-quality scoring, catalogue, live ingestion, aggregation, replay, instrument registry or trading         |
| 15     | Data Quality Engine                                                   | Completed | `0.15.0-data-quality.1`          | 2026-09-25      | `npm run verify` | ADR-0061 through ADR-0066 | None       | Historical dataset quality assessment and immutable reports only; no catalogue, live ingestion, aggregation, replay, instrument registry, MOSE, strategy, risk or execution    |
| 16     | Dataset Catalogue and Lineage                                         | Completed | `0.16.0-dataset-catalogue.1`     | 2026-09-25      | `npm run verify` | ADR-0067 through ADR-0072 | None       | Dataset identity, lineage and metadata governance only; no real-time ingestion, aggregation, replay, instrument registry, MOSE, strategy, risk, execution or trading           |

| Prompt | Title                           | Status                 | Version/Checkpoint        | Completion Date | Test Baseline                                                  | Important ADRs            | Migrations | Known Limitations                                                                                                                                                                                                                                                               |
| ------ | ------------------------------- | ---------------------- | ------------------------- | --------------- | -------------------------------------------------------------- | ------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 17     | Real-Time Market Data Ingestion | CONDITIONALLY ACCEPTED | `0.17.0-realtime-data.1`  | 2026-10-08      | `npm run verify`; 292 tests across 19 files at accepted commit | ADR-0073 through ADR-0078 | None       | Implementation completed; conditional acceptance covers the bounded offline research foundation only; F05/F06 qualification outstanding; T01 trusted repository/certificate compliance, single writer and trusted root mandatory. No production deployment or trading approval. |
| 18     | Multi-Timeframe Aggregation     | CONDITIONALLY ACCEPTED | `0.18.0-multitimeframe.1` | 2026-10-08      | `npm run verify`; 454 tests / 30 files; 48 adversarial probes  | ADR-0079 through ADR-0084 | None       | Bounded offline market-data research only. CODEX-003D project approval; F05/F06/T01 and registry, quality, legacy, loss and native-correction restrictions remain mandatory.                                                                                                    |

Future prompts remain unimplemented until explicitly received.

## Prompt 17 external conditional acceptance — CODEX-002H

The external acceptance decision supplied in CODEX-002H is recorded on 2026-10-08. This entry
records that decision; implementation and re-audit delivery reports do not themselves grant
acceptance. Implementation completion and external acceptance are separate facts: Prompt 17
implementation is completed, while its acceptance is conditional.

- Accepted source commit:
  [`6632caed6558017690f98e6f3ee1e2cbb7435658`](https://github.com/sundayosho1/ate-system/commit/6632caed6558017690f98e6f3ee1e2cbb7435658).
- Accepted source branch: `codex/prompt-17-creation-remediation`.
- Accepted version: `0.17.0-realtime-data.1`.
- Status: **CONDITIONALLY ACCEPTED**.
- Accepted scope: **bounded offline research foundation** with deterministic scripted adapters and
  bounded ingestion/capture. No commercial-provider qualification, automatic dataset
  materialization, aggregation, replay, instrument registry, production deployment or trading
  approval is conferred.
- Acceptance evidence:
  [CODEX-002G independent re-audit report](audits/CODEX-002G-prompt-17-re-audit.md), with its
  original conditional recommendation and verification evidence preserved as a historical snapshot.
  Its then-pending acceptance statements are historical; this external decision is the subsequent
  governance record.

### Mandatory finding closure

| Finding | Accepted disposition | Scope                                                                              |
| ------- | -------------------- | ---------------------------------------------------------------------------------- |
| F01     | CLOSED               | Scheduled reconnect timeout and deterministic scheduler progress                   |
| F02     | CLOSED               | Immediate freshness/readiness for stale, duplicate, future or invalid observations |
| F03     | CLOSED               | Safe native-envelope rejection at the callback boundary                            |
| F04-R1  | CLOSED               | Failed creation compensation and truthful parent/repeated shutdown                 |
| F04-R2  | CLOSED               | Unknown creation commitment, retained recovery obligations and truthful shutdown   |
| F07     | CLOSED               | Adapter registry-wrapper immutability                                              |

Closures apply within the accepted bounded offline contract and do not remove the conditions below.

### Mandatory conditions and operational limitations

- **F05:** Windows execution, open-handle behavior and filesystem durability qualification remain
  outstanding. No Windows production approval may be inferred.
- **F06:** Synchronous production capture throughput, latency and power-loss durability
  qualification remain outstanding. Passing bounded tests does not establish a production SLA or
  durability claim.
- **T01:** Capture repositories must be trusted implementations that comply with the certificate
  contract. `NOT_CREATED` certifies no attempted storage mutation by that creation attempt; it does
  not prove artifact nonexistence, ownership or independent filesystem verification. Untrusted or
  falsely certifying implementations are outside acceptance.
- One writer per managed capture root and trusted-root operation remain mandatory. Protect the root
  against concurrent untrusted writers; incomplete/corrupt roots follow existing fail-closed
  recovery.
- This decision grants **no production deployment or trading approval**. Unsupported operational,
  provider, aggregation or trading claims remain prohibited.

### Historical audit and remediation references

| Record                            | Source checkpoint                                                                                                                       | Historical outcome/reference                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Original Prompt 17 implementation | [`1a55f1dde294eee1f5a6a3d2cd3e681ed0a3f809`](https://github.com/sundayosho1/ate-system/commit/1a55f1dde294eee1f5a6a3d2cd3e681ed0a3f809) | `ATE-PROMPT-17-DELIVERY-REPORT.md`; original ingestion/capture foundation                                       |
| CODEX-002A                        | `1a55f1dde294eee1f5a6a3d2cd3e681ed0a3f809`                                                                                              | `ATE-CODEX-002A-PROMPT-17-AUDIT-REPORT.md`; mandatory remediation findings                                      |
| CODEX-002B                        | [`eb1a593a85570fd9615b410b4210b77fdd59c61a`](https://github.com/sundayosho1/ate-system/commit/eb1a593a85570fd9615b410b4210b77fdd59c61a) | `ATE-CODEX-002B-PROMPT-17-REMEDIATION-REPORT.md`; first remediation checkpoint                                  |
| CODEX-002C                        | `eb1a593a85570fd9615b410b4210b77fdd59c61a`                                                                                              | `ATE-CODEX-002C-PROMPT-17-REAUDIT-REPORT.md`; F04-R1 remained open                                              |
| CODEX-002D                        | [`f09b068e6642e0094f6c19fafe836d8370287cb1`](https://github.com/sundayosho1/ate-system/commit/f09b068e6642e0094f6c19fafe836d8370287cb1) | `ATE-CODEX-002D-F04-R1-REMEDIATION-REPORT.md`; capture compensation remediation                                 |
| CODEX-002E                        | `f09b068e6642e0094f6c19fafe836d8370287cb1`                                                                                              | `ATE-CODEX-002E-PROMPT-17-FINAL-REAUDIT-REPORT.md`; F04-R1 corrected, F04-R2 identified                         |
| CODEX-002F                        | `6632caed6558017690f98e6f3ee1e2cbb7435658`                                                                                              | `ATE-CODEX-002F-F04-R2-REMEDIATION-DELIVERY-REPORT.md`; creation outcome remediation                            |
| CODEX-002G                        | `6632caed6558017690f98e6f3ee1e2cbb7435658`                                                                                              | [Archived independent re-audit](audits/CODEX-002G-prompt-17-re-audit.md); conditional acceptance recommendation |
| CODEX-002H                        | Accepted source above; governance successor identified by this record's commit                                                          | External conditional acceptance recorded; Prompt 18 baseline released, implementation not started               |

Earlier named delivery/audit artifacts remain historical external reports; the commit links identify
immutable source checkpoints. CODEX-002G is additionally archived here for durable acceptance
evidence. Dependency security remediation
[`4311e58eed5bbcba3d8967570bd4775ac2ec1da3`](https://github.com/sundayosho1/ate-system/commit/4311e58eed5bbcba3d8967570bd4775ac2ec1da3)
remains in accepted ancestry and must be preserved.

## Prompt 18 authoritative development baseline

Prompt 18 may proceed only from accepted source commit `6632caed6558017690f98e6f3ee1e2cbb7435658` or
a **verified direct successor** whose only changes are this CODEX-002H governance update. The
successor's Git commit identifies the released baseline; verify its parent against the accepted SHA
and verify that Prompt 17 source, tests, dependencies, version and capability manifest are
unchanged. The README-only `main` is not the application baseline.

Prompt 18 remains **NOT STARTED** and requires a separate implementation assignment. Its
specification must preserve:

- Prompt 6 clock, scheduler and deterministic time authority.
- Prompt 13 canonical market-data authority and contract validation.
- Prompt 14–16 historical dataset, quality assessment, catalogue and lineage boundaries.
- Prompt 17 ingestion, capture, recovery, source isolation and certificate contracts.
- Deterministic aggregation and point-in-time correctness, with **no look-ahead**.
- All conditional acceptance restrictions, with no unsupported production or trading claims.

This baseline release does not implement aggregation, change application capability availability,
change the application version or authorize Prompt 19.

## Prompt 18 implementation — CODEX-003

Dedicated development branch: `codex/prompt-18-multitimeframe`. Source baseline:
`a2212cbbac82ba691d2d673536646236c482c650`. Implementation completion does not constitute
independent acceptance. All Prompt 17 conditions remain mandatory. Prompt 19: NOT STARTED; separate
specification and authorization required.

## Prompt 18 mandatory remediation — CODEX-003B

Dedicated successor branch: `codex/prompt-18-remediation`, from audited commit
`58050965dfbe7e90d530e74d822fd6cd0fff854d` (parent `a2212cbbac82ba691d2d673536646236c482c650`).
CODEX-003A found five HIGH defects; its failed audit remains historical evidence and is not
superseded by implementation claims.

CODEX-003B implements permanent corrections for A18-H01 ordering, A18-H02 inherited quality, A18-H03
filesystem capacity, A18-H04 correction horizons and A18-H05 upstream consumer loss. M01/M02 policy
qualifications and L01 early volume validation are documented and tested. Application version
remains `0.18.0-multitimeframe.1`. Independent re-audit is required; Prompt 18 remains
**IMPLEMENTATION COMPLETE — INDEPENDENT ACCEPTANCE PENDING**, not accepted. Prompt 17 acceptance,
findings closures, F05/F06/T01, trusted-root/single-writer and research-only restrictions remain
unchanged. Prompt 19 remains **NOT STARTED / BLOCKED** pending acceptance and a separate explicit
implementation authorization. The immutable commit containing this entry identifies the remediation
checkpoint; exact verification/publication evidence accompanies CODEX-003B.

## Prompt 18 project conditional acceptance — CODEX-003D

Recorded on **2026-10-08 (Africa/Lagos)** under the project reviewer's explicit CODEX-003D
conditional-acceptance authorization. This project-level decision is separate from the supporting
CODEX-003C technical re-audit, which was performed in the implementation assistant session and is
not represented as an external human audit.

- Status: **CONDITIONALLY ACCEPTED**.
- Exact accepted implementation and remediation commit:
  [`30f72360c44396e689efe0bdb82fe356bc92b3eb`](https://github.com/sundayosho1/ate-system/commit/30f72360c44396e689efe0bdb82fe356bc92b3eb).
- Accepted source branch: `codex/prompt-18-remediation`; direct parent:
  `58050965dfbe7e90d530e74d822fd6cd0fff854d`.
- Accepted version: `0.18.0-multitimeframe.1`.
- Scope: **bounded offline market-data research only**.
- Permanent verified baseline: **454 tests across 30 files**, retaining all 377 prior tests and
  adding 77 permanent regressions. CODEX-003C also executed **48 separate adversarial target
  probes**, with five parent probes reproducing the original defects.
- Supporting re-audit verdict: **RE-AUDIT PASSED WITH NONBLOCKING CONDITIONS — RECOMMENDED FOR
  CONDITIONAL ACCEPTANCE**. This recommendation alone did not grant acceptance.
- Full decision, history, conditions and evidence references:
  [CODEX-003D conditional-acceptance decision](prompt-18-conditional-acceptance.md).

### Prompt 18 mandatory findings closure

| Finding | Accepted disposition | Corrected contract                                                                   |
| ------- | -------------------- | ------------------------------------------------------------------------------------ |
| A18-H01 | CLOSED               | Deterministic observation ordering with explicit market-order uncertainty            |
| A18-H02 | CLOSED               | Bounded verifiable inherited quality evidence, report membership and suppression     |
| A18-H03 | CLOSED               | Consistent filesystem operation capacity, truthful commitments and recoverability    |
| A18-H04 | CLOSED               | Finalized-history correction horizon across invalidation, hierarchy and recovery     |
| A18-H05 | CLOSED               | Consumer-loss fencing, durable evidence and justified reconciliation before finality |

Closures apply only within the accepted bounded contract. **F05, F06 and T01 remain mandatory**:
Windows qualification and production performance/durability remain outstanding; trusted repository
implementation, compliant contracts, a trusted root and a single writer remain required. **M02**
limits point-in-time claims to revision knowledge within current governed registry context. Bounded
quality handoffs must fail explicitly without truncation; legacy evidence cannot gain unsupported
migration, repair or invented report membership. Unknown consumer-loss scope requires conservative
fencing and justified reconciliation. Native corrected-trade cancellation/replacement remains
unsupported. No live trading, broker connectivity, financial execution, Windows deployment or
production operation is approved.

### Prompt 18 history and Prompt 19 baseline

CODEX-003A's **FAILED** initial audit, CODEX-003B's completed remediation and CODEX-003C's qualified
technical recommendation remain historical evidence; none is rewritten by this acceptance record.
Earlier pending/NOT STARTED entries above describe their historical checkpoints. This CODEX-003D
entry records the subsequent project-level acceptance decision; unrelated prompt statuses are
unchanged.

The **accepted Prompt 18 source baseline** is `30f72360c44396e689efe0bdb82fe356bc92b3eb`. The
distinct **governance successor** is the new immutable commit introducing this decision and ledger
entry on `codex/prompt-18-conditional-acceptance`. Its direct parent must be the accepted source and
its complete diff must contain only these governance documents. The CODEX-003D delivery report
records the exact successor SHA after publication and verifies the matching remote branch SHA; do
not treat the source SHA as the governance successor.

Prompt 19 may use that verified governance successor only after a separate implementation
specification and explicit authorization. **Prompt 19: NOT STARTED — IMPLEMENTATION NOT
AUTHORIZED.** This governance release does not implement Prompt 19 or expand any capability.

## Prompt 19 implementation work — CODEX-004 (historical starting checkpoint)

The separate CODEX-004 specification explicitly authorizes Prompt 19 from governance successor
`b69530ac75210e62780082034d90e8b1a0a18443`. Earlier NOT STARTED / NOT AUTHORIZED statements above
record the previous governance release and remain historical evidence.

| Prompt | Title                                         | Current status                     | Target version           | Independent acceptance               | Limitations                                                                                                                                                                         |
| ------ | --------------------------------------------- | ---------------------------------- | ------------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19     | Deterministic whole-system market-data replay | IN PROGRESS — REMEDIATION REQUIRED | `0.19.0-market-replay.1` | PENDING; not implementation-complete | Full multi-source end-to-end qualification, branch orchestration, aggregate input adapter, architecture/runtime authority integration and complete fault matrix remain outstanding. |
| 20     | Future separate assignment                    | NOT STARTED — NOT AUTHORIZED       | None                     | None                                 | No implementation in CODEX-004.                                                                                                                                                     |

Work is isolated on `codex/prompt-19-market-replay`. Accepted Prompt 17/18 commits are unchanged.
The application release version and `completed_prompt` remain at Prompt 18; the new workspace
package identifies its development target only. A passing regression suite does not satisfy the
complete Prompt 19 definition of done. See [replay help](../help/deterministic-market-replay.md).

## Prompt 19 completion — CODEX-004R

CODEX-004R supplements the original full Prompt 19 specification from exact starting checkpoint
`bd37a789e6ccac5ba6b7ab2e87a050581df40be1` on dedicated `codex/prompt-19-completion`. All G01–G09
and original mandatory implementation criteria are covered by the source and permanent
[evidence index](prompt-19-completion-evidence.md). The full pre-release gate passed 578 tests
across 48 files with zero audit findings before advancing the root release; the final source commit
and publication/gate evidence are recorded in the external CODEX-004R delivery report.

| Prompt | Current implementation status                         | Version                  | Independent acceptance      |
| ------ | ----------------------------------------------------- | ------------------------ | --------------------------- |
| 19     | IMPLEMENTATION COMPLETE — READY FOR INDEPENDENT AUDIT | `0.19.0-market-replay.1` | PENDING — not self-accepted |
| 20     | NOT STARTED — NOT AUTHORIZED                          | None                     | None                        |

Historical audit/remediation and Prompt 17/18 conditional acceptance references above remain intact.
No unrelated prompt status is changed. F05 Windows qualification, F06 production capture throughput/
durability, T01 trusted implementations/certificates and single-writer/trusted-root, M02 current
registry context, bounded quality handoff and conservative source-loss restrictions remain
mandatory. No production deployment, broker connectivity, trading or future-prompt approval is
inferred.
