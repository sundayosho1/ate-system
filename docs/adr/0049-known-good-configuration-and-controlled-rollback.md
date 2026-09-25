# ADR-0049 — Known-Good Configuration and Controlled Rollback

## Status

Accepted

## Context

Rollback must restore exact trustworthy configuration without rewriting history.

## Decision

A configuration release becomes rollback-eligible only after activation and verification record a
known-good fact. Rollback targets exact known-good versions, revalidates them under current
destination policy/schema/capability conditions, and records new rollback execution evidence.

## Alternatives Considered

- Roll back to the previous version automatically. Rejected because previous may not be known-good.
- Rewrite active history as undo. Rejected because release history must be append-only.

## Consequences

- Active does not automatically mean known-good before verification.
- Old success does not bypass current rollback eligibility.
- Rollback preserves failed/replaced versions and does not delete history.

## Security Impact

Rollback evidence records safe IDs, fingerprints, actors and reasons only.

## Operational Impact

Operators can select exact known-good targets and see why a rollback is blocked.

## Reversibility

Rollback-of-rollback is represented by additional release evidence.
