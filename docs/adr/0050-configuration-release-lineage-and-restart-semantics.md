# ADR-0050 — Configuration Release Lineage and Restart Semantics

## Status

Accepted

## Context

Operators must reconstruct how an active configuration reached an environment and whether runtime
behavior reflects restart-required changes.

## Decision

Release evidence preserves source version, destination environment, prior active version, activation
record and operation kind. Restart-required promotions record restart-pending state, running version
and target post-restart version.

## Alternatives Considered

- Treat rollback as destructive undo/redo. Rejected because lineage would be lost.
- Report restart-required changes as fully applied. Rejected because it would mislead operators.

## Consequences

- Promotion lineage can answer which upstream configuration produced a destination release.
- Rollback-of-rollback is modeled as more release evidence, not destructive undo/redo.
- Prompt 12 records restart truth but does not orchestrate Windows service restarts.

## Security Impact

Lineage and restart diagnostics use safe release metadata rather than raw configuration values.

## Operational Impact

Future Control Center screens can display active, known-good, pending promotion and restart state.

## Reversibility

Lineage remains reconstructable because release evidence is append-only.
