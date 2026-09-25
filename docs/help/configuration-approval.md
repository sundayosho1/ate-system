# Configuration Approval Help

Configuration approval exists so sensitive valid changes do not become operational merely because
one actor proposed them.

## Key terms

| Term                    | Meaning                                                                    |
| ----------------------- | -------------------------------------------------------------------------- |
| Maker                   | Actor recorded on the immutable configuration version.                     |
| Checker                 | Independent actor reviewing the exact version.                             |
| Approval request        | Immutable review request bound to one version and fingerprints.            |
| Approval decision       | Immutable approve/reject evidence from an authorized checker.              |
| Approval eligibility    | Current answer for whether the version satisfies governance requirements.  |
| Pre-governance baseline | Explicit historical baseline that predates maker-checker; not an approval. |

## Statuses

- `NOT_REQUIRED`: policy says the version does not require independent approval.
- `PENDING`: approval is required and not yet satisfied.
- `APPROVED`: required checker evidence is valid.
- `REJECTED`: checker rejected the request.
- `EXPIRED`: approval evidence aged out under policy.
- `REVOKED`: approval was explicitly revoked.
- `SUPERSEDED`: another version replaced the reviewed version.
- `STALE`: binding fingerprints or policy evidence no longer match.

## What checkers review

Reviewers inspect safe evidence:

- version ID and stream;
- maker;
- changed keys and scopes;
- safe Prompt 9 diff information;
- affected capabilities;
- validation warnings;
- classification and policy;
- required checker authority;
- restart/capability implications;
- approval expiry where applicable.

Secret values remain redacted. Approval does not grant secret disclosure.

## What approval does not do

Approval is not validation, capability implementation, promotion, rollback, enterprise RBAC,
emergency bypass or trading authorization. It only establishes governance eligibility for the exact
version under the recorded policy.

## Troubleshooting

- `APPROVAL_MAKER_CHECKER_CONFLICT`: maker attempted to check their own change.
- `APPROVAL_CHECKER_UNAUTHORIZED`: checker authority could not be verified.
- `APPROVAL_NOT_SATISFIED`: required approval evidence is missing.
- `APPROVAL_EXPIRED`: approval evidence exceeded policy expiry.
- `APPROVAL_REVOKED`: approval was revoked by an authorized actor.
- `APPROVAL_POLICY_FINGERPRINT_MISMATCH`: policy-of-record changed and current eligibility requires
  re-evaluation/reapproval.

Pending approval is normal. It should block approval-gated behavior, not necessarily the whole
runtime.
