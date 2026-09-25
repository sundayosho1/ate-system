# 0024 — Scope, Context and Precedence Model

## Status

Accepted.

## Context

ATE configuration is multidimensional. A request may include environment, broker, account, asset
class, instrument, timeframe, regime, strategy and portfolio context. "Most specific wins" is not
deterministic when dimensions cross.

## Decision

Represent scope precedence as explicit policy. Applicable entries are ordered by policy rank, not
source order or object traversal. Equal-rank conflicting candidates fail closed with a structured
configuration conflict.

## Alternatives Considered

- Hard-code a universal object tree. Rejected because ATE contexts are not one-dimensional.
- Let source load order break ties. Rejected because it is not explainable or safe.

## Consequences

Every effective value can explain which scope supplied it and why that scope won.

## Security Impact

Precedence ambiguity cannot silently activate unsafe values.

## Operational Impact

Control Center can show candidates, rejected entries and winning policy.

## Reversibility

Policies can be refined per definition without replacing the resolver.
