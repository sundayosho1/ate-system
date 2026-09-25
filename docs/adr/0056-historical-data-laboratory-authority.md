# ADR-0056 — Historical Data Laboratory Authority and Offline Intake Boundary

## Status

Accepted

## Context

Prompt 14 needs historical file intake and research datasets without weakening Prompt 13 canonical
contracts or implementing live ingestion.

## Decision

Create `@ate/historical-data` as a dedicated offline data-laboratory package. It owns controlled
artifact intake, format adapters, declarative mapping, canonical normalization, structural
validation, dataset publication and bounded research access.

## Consequences

- `@ate/domain` remains the canonical market-data contract authority.
- Historical file parsing/storage does not enter domain contracts.
- Real-time provider ingestion remains Prompt 17 scope.
