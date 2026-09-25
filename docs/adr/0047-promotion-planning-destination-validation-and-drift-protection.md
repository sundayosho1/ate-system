# ADR-0047 — Promotion Planning, Destination Validation and Drift Protection

## Status

Accepted

## Context

A valid source version may not be valid for a destination environment, and destination active state
can change after planning.

## Decision

Promotion requests bind exact source version and destination baseline. Promotion plans validate the
resulting destination effective configuration, preserve destination-local values, reject
non-promotable changes, evaluate capabilities and approvals, and become stale if the destination
baseline changes.

## Alternatives Considered

- Validate only the source version. Rejected because destinations may differ.
- Allow plans to float to current destination state. Rejected because it weakens concurrency safety.

## Consequences

- Plans are deterministic explanations, not execution.
- Promotion never silently mutates source values to fit destination validation.
- Stale plans fail closed and require replanning.

## Security Impact

Plans use safe diffs, IDs, fingerprints and reason codes rather than raw secret material.

## Operational Impact

Operators get explicit blockers for drift, validation, capability and approval failures.

## Reversibility

Blocked or stale plans can be recreated; historical plans remain immutable evidence.
