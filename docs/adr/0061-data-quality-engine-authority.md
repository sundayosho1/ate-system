# ADR-0061 — Data Quality Engine Authority

## Status

Accepted

## Decision

Data-quality assessment is owned by `@ate/data-quality`, a dedicated package separate from
`@ate/domain`, `@ate/historical-data`, strategies, risk, execution and MOSE.

The engine consumes Prompt 14 datasets through public repository/query contracts and publishes
immutable quality reports.

## Consequences

- Prompt 13 structural validation remains contract authority.
- Prompt 14 import validity remains historical-laboratory authority.
- Prompt 15 owns quality findings, scores and non-trading qualification diagnostics.
- No quality rule may silently repair or mutate canonical observations.
