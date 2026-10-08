# Prompt 18 Conditional-Acceptance Decision — CODEX-003D

## Authority and decision

Decision date: **2026-10-08 (Africa/Lagos)**. Governance approval reference: the project reviewer's
user-supplied **ATE — CODEX-003D: Prompt 18 Conditional Acceptance, Governance Closure & Prompt 19
Baseline Preparation** instruction.

**PROMPT 18 — CONDITIONALLY ACCEPTED**, exclusively for bounded offline market-data research.

The reviewer explicitly accepts implementation commit
[`30f72360c44396e689efe0bdb82fe356bc92b3eb`](https://github.com/sundayosho1/ate-system/commit/30f72360c44396e689efe0bdb82fe356bc92b3eb),
from `codex/prompt-18-remediation`, version `0.18.0-multitimeframe.1`. Its direct parent is
`58050965dfbe7e90d530e74d822fd6cd0fff854d`. Acceptance is scoped to that exact source, not arbitrary
later implementations.

CODEX-003C is supporting technical evidence, not the project-level acceptance authority. It was
performed in the implementation assistant session and must not be described as an external human or
organizational audit. This CODEX-003D reviewer instruction supplies the separate project-level
acceptance authorization.

## Historical evidence

| Record     | Source checkpoint                                            | Historical outcome and external report                                                              |
| ---------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| CODEX-003A | `58050965dfbe7e90d530e74d822fd6cd0fff854d`                   | FAILED; `ATE-CODEX-003A-PROMPT-18-INDEPENDENT-AUDIT-REPORT.md`                                      |
| CODEX-003B | `30f72360c44396e689efe0bdb82fe356bc92b3eb`                   | Mandatory remediation COMPLETE; `ATE-CODEX-003B-PROMPT-18-MANDATORY-REMEDIATION-DELIVERY-REPORT.md` |
| CODEX-003C | `30f72360c44396e689efe0bdb82fe356bc92b3eb`                   | PASSED WITH NONBLOCKING CONDITIONS; `ATE-CODEX-003C-PROMPT-18-INDEPENDENT-REAUDIT-REPORT.md`        |
| CODEX-003D | Accepted source above; governance successor identified below | Project reviewer authorizes CONDITIONAL ACCEPTANCE; governance-only record                          |

The external reports and raw evidence remain under `/workspace/ate-reports`, in their corresponding
`CODEX-003A-evidence`, `CODEX-003B-evidence` and `CODEX-003C-evidence` directories. These filenames
identify the reviewed external artifacts; they are not asserted to be committed repository files. No
historical audit evidence is edited, replaced or deleted by this decision.

CODEX-003C's exact verdict was **RE-AUDIT PASSED WITH NONBLOCKING CONDITIONS — RECOMMENDED FOR
CONDITIONAL ACCEPTANCE**. Its fresh permanent verification passed **454 tests in 30 files**, with
all **377** previous tests retained and **77** permanent regressions added. Its separately designed
target suite passed **48 adversarial probes**. Five separate parent probes reproduced the original
HIGH defects; those defect assertions are not counted as target acceptance successes. Security and
dependency gates passed. These technical results support this decision without qualifying
unsupported production environments.

## Accepted mandatory findings

| Finding | Disposition | Accepted corrected behavior                                                                                                                        |
| ------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| A18-H01 | CLOSED      | Equivalent authorized input permutations preserve deterministic OHLC/content/lineage; constructed ordering retains uncertainty.                    |
| A18-H02 | CLOSED      | Supported canonical aggregate handoffs retain verifiable adverse quality, report membership and suppression, or reject explicitly.                 |
| A18-H03 | CLOSED      | Admission/publication/recovery share operation capacity; uncertain writes retain obligations and acknowledged supported state remains recoverable. |
| A18-H04 | CLOSED      | Finalized-history correction eligibility cannot be reopened by invalidation, reconciliation, propagation or recovery.                              |
| A18-H05 | CLOSED      | Observed consumer loss fences affected continuity; draining cannot authorize unsupported complete finality.                                        |

M01 is resolved for the documented latest-eligible verified selection with ineligible-successor
warnings. L01 early incompatible-volume rejection is closed. M02 remains the explicit context
restriction below. Closures confer no authority beyond the bounded tested contracts.

## Continuing conditions and prohibited claims

- **F05 — Windows qualification outstanding:** Windows execution, open-handle behavior and
  filesystem durability are unverified. No Windows deployment approval is granted.
- **F06 — Production performance and durability outstanding:** Production throughput, latency,
  power-loss durability and operational readiness are unqualified. No production operation is
  approved.
- **T01 — Trusted repository authority:** Trusted implementations, compliant repository/certificate
  contracts, trusted roots and single-writer restrictions remain mandatory. A no-mutation
  certificate describes the certified attempt; it does not establish independent artifact
  nonexistence, ownership or filesystem authenticity. Untrusted or falsely certifying adapters
  remain outside acceptance.
- **M02 — Current registry context:** Point-in-time guarantees certify eligible revision knowledge
  within current governed registry/calendar/configuration context, not historical registry
  membership or fully bitemporal registration authority.
- **Quality evidence bounds:** Oversized or unverifiable handoffs must fail explicitly. No silent
  truncation, fabricated score or unsupported external resolver is allowed.
- **Legacy evidence:** No unsupported migration, automatic repair, silent history rewriting or
  invented report membership. Legacy membership that was never retained cannot be certified by
  acceptance.
- **Consumer loss:** Unknown loss scope requires conservative fencing; drain alone never reconciles.
  Justified reconciliation through existing authority remains required. Failed loss persistence must
  fail closed.
- **Native corrections:** Native corrected-trade cancellation/replacement is outside the Prompt 18
  observation contract. Supported ordinary late observations and canonical BAR replacement must
  retain their existing horizon and integrity restrictions.
- **Capability scope:** No live trading, broker connectivity, financial execution or future-prompt
  functionality is authorized. Existing Prompt 17 conditional restrictions remain in force.

Acceptance does not weaken any condition or change application source, tests, runtime settings,
security controls, capability declarations, dependencies, lockfile or application version.

## Distinct baseline identities and release control

**Accepted Prompt 18 source baseline:** `30f72360c44396e689efe0bdb82fe356bc92b3eb`.

**Prompt 18 governance successor:** the immutable commit first adding this decision and the
corresponding
[authoritative ledger entry](prompt-ledger.md#prompt-18-project-conditional-acceptance--codex-003d)
on `codex/prompt-18-conditional-acceptance`. Its SHA is recorded in the CODEX-003D delivery report
after publication and independent remote-SHA verification. A commit cannot contain its own final
hash; identify the successor from Git history and the external publication record, then verify its
parent and complete changed-file inventory.

The successor must be a direct child of the accepted source and must change only
`docs/development/prompt-ledger.md` and `docs/development/prompt-18-conditional-acceptance.md`. No
force-push, historical amendment or merge into `main` is authorized.

Prompt 19 may use that verified governance successor as its starting baseline **only after separate
implementation authorization and specification**. **Prompt 19 is NOT STARTED and NOT AUTHORIZED FOR
IMPLEMENTATION.** Governance preparation is not an implementation assignment.
