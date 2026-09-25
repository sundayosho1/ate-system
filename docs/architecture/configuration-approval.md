# Maker-Checker Configuration Approval

Prompt 11 adds the configuration approval governance authority. It determines whether an immutable
configuration version requires independent review, records maker/checker evidence, and answers
whether that exact version is governance-eligible for future governed operations.

It does not implement emergency bypass, enterprise RBAC/IAM, market data, MT5, execution or trading.
Prompt 12 consumes approval eligibility for controlled promotion and rollback governance.

## Authority sequence

```text
CONFIGURATION AUTHORITY
SCHEMA & VALIDATION AUTHORITY
VERSION HISTORY AUTHORITY
CAPABILITY CONTROL AUTHORITY
MAKER-CHECKER GOVERNANCE AUTHORITY
```

Approval remains subordinate to the Engineering Constitution, validation, immutable version
integrity and capability build truth.

## Exact-version binding

Approval belongs to an exact immutable version. Approval evidence binds:

- version ID;
- version stream/runtime mode;
- configuration fingerprint;
- change-set fingerprint;
- schema fingerprint;
- approval-policy fingerprint;
- capability-impact fingerprint.

If a successor version is created, prior approval does not transfer.

## Policy model

Approval policies are bounded declarative records. They use deterministic conditions over changed
keys, domains, scopes, runtime mode, schema governance metadata and capability impact. There is no
arbitrary executable rule engine.

When more than one policy applies, stricter classification/authority/approval count wins. Unsafe
conflicts fail closed.

## Classification

Prompt 11 uses a small governance classification:

- `STANDARD` — valid/versioned/auditable change that policy allows without independent approval;
- `SENSITIVE` — requires independent checker approval;
- `CRITICAL` — requires stricter checker authority and prepares for future multi-approval rules.

## Maker and checker

The maker is the actor recorded on the configuration version. The checker is a separate actor whose
authority is verified at decision time. The maker cannot satisfy checker requirements for their own
approval-required version.

Prompt 11 implements a narrow checker-authority resolver contract, not full RBAC/IAM.

## Approval evidence

Approval requests, decisions and revocations are immutable append-only records. Reapproval appends
new evidence. Rejection and revocation never delete configuration versions or historical decisions.

## Proposed vs applied boundary

Approval-required changes may be validated and versioned while remaining not applied. The governed
publication gate refuses to apply an approval-required version until approval eligibility succeeds.
Approval means governance-eligible; it is not cross-environment promotion.

## Expiry and revocation

Policies may define an approval expiry duration. Expired approval evidence remains historical but no
longer satisfies the current gate. Authorized revocation appends revocation evidence and invalidates
current eligibility.

## Events and diagnostics

Prompt 11 registers safe audit/operational events for requested, approved, rejected, revoked and
invalidated approvals. Diagnostics report bounded counters and safe recent errors without raw
configuration values or secrets.
