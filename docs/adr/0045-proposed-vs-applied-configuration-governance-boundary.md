# ADR-0045 — Proposed vs Applied Configuration Governance Boundary

## Status

Accepted

## Context

Prompts 7-10 publish technically valid configuration snapshots. Prompt 11 must prevent
approval-required changes from changing operational behavior before approval.

## Decision

Prompt 11 introduces a governed publication gate that distinguishes proposed/versioned configuration
from applied configuration. Approval-required versions are not applied until current approval
eligibility is satisfied.

## Consequences

- Pending approval is normal and does not imply runtime failure.
- Approval means governance eligible, not promoted across environments.
- Prompt 12 can build promotion and rollback on top of the eligibility contract.
