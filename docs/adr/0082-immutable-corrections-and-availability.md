# ADR-0082: Immutable corrections and bitemporal availability

Status: Accepted for implementation; independent Prompt 18 acceptance pending.

Date: 2026-10-08

## Context

Prompt 18 extends the conditionally accepted Prompt 17 offline research foundation.

## Decision

Append parented revisions and update only actual dependent windows. Stable content and lineage
hashes exclude mutable process availability. Actual commit/publication and finality determine
point-in-time visibility; recovery never backdates publication.

## Consequences

Policies and operation evidence must be retained. Resource failures are structured and observable.
No production, broker or trading authority is added. See
[aggregation help](../help/multi-timeframe-aggregation.md).

## CODEX-003B evidence and horizon correction

Ever-finalized immutable history establishes correction eligibility relative to the original window
end. Invalidation, parent propagation, reconciliation or restart cannot reset an expired horizon.
Initial historical construction without final history remains supported; later modifications obey
the horizon.

Canonical handoff includes a bounded self-contained quality manifest binding revision, source,
lineage, coverage, availability and report/finding references. Suppression counts deduplicate
immutable report references. Missing/corrupt inherited manifests reject; oversize projection never
truncates evidence. Legacy aggregate handoff checkpoints missing evidence fail closed rather than
gaining a certificate.

AS_KNOWN means latest eligible verified revision; a newer known ineligible successor adds a visible
warning while preserving selection. Hierarchical lineage conflicts still reject the affected
selection. Point-in-time revision knowledge is within current governed registry context;
registration history is not bitemporal. These qualifications add no quality scoring, catalogue or
registry authority.
