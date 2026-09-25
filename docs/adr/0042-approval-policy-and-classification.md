# ADR-0042 — Approval Policy and Sensitive Change Classification

## Status

Accepted

## Context

Governance requirements must be deterministic, explainable and bounded.

## Decision

Approval policies are declarative records with stable IDs, versions, fingerprints, classifications
and bounded conditions. Prompt 11 uses `STANDARD`, `SENSITIVE` and `CRITICAL` classifications. Where
policies overlap, stricter classification/authority/approval count wins.

## Consequences

- No arbitrary executable approval rules are introduced.
- Policy fingerprints are preserved with request and eligibility evidence.
- Governance-policy changes can themselves be classified as critical.
