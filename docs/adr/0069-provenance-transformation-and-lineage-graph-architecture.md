# ADR-0069 — Provenance, Transformation and Lineage Graph Architecture

## Status

Accepted

## Decision

Dataset lineage is a bounded directed graph over dataset versions and source/external nodes.
Transformations are recorded as metadata, not executed by the catalogue.

Derivation lineage is distinct from associations such as quality reports.

## Consequences

- Parent references must resolve for governed ATE dataset versions.
- Self-lineage and cycles fail closed.
- Impact analysis reports descendants but does not automatically invalidate them.
