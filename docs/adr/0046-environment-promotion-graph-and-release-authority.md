# ADR-0046 — Environment Promotion Graph and Release Authority

## Status

Accepted

## Context

Prompt 12 must promote configuration through explicit environments without relying on enum order or
latest-version timestamps.

## Decision

Configuration release governance is owned by `configuration.release`. The default graph is explicit:
`DEVELOPMENT -> RESEARCH -> BACKTEST -> SIMULATION -> PAPER -> LIVE`. Same-environment activation is
separate from cross-environment promotion.

## Alternatives Considered

- Infer promotion from runtime-mode enum order. Rejected because it would hide policy.
- Treat latest version as active. Rejected because version history is not release authority.

## Consequences

- Skipped transitions fail closed by default.
- The version-history current pointer is not the active release pointer.
- Promotion to `LIVE` remains configuration governance only, not trading authorization.

## Security Impact

Release state exposes IDs, fingerprints and safe status only.

## Operational Impact

Operators can reason about allowed transitions and active release authority explicitly.

## Reversibility

Future ADRs may add governed graph edges without rewriting existing release evidence.
