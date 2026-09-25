# ADR-0041 — Maker-Checker Approval Authority

## Status

Accepted

## Context

Prompt 11 must determine whether sensitive configuration versions have independent governance
authorization without implementing promotion or enterprise RBAC.

## Decision

`@ate/configuration` owns a maker-checker approval authority with policies, requests, decisions,
revocations, eligibility results and safe diagnostics.

## Consequences

- Approval is a separate authority from validation, versioning and capability control.
- Approval evidence is exact-version bound.
- Prompt 12 can consume approval eligibility without reinterpreting history.
