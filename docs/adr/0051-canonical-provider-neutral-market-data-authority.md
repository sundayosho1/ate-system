# ADR-0051 — Canonical Provider-Neutral Market Data Authority

## Status

Accepted

## Context

Phase III needs one market-data language before historical storage, quality scoring, ingestion,
aggregation or replay can be implemented. Prompt 2 already established `@ate/domain` as the
infrastructure-independent authority for instruments, prices, timestamps, quotes, bars and
provenance.

## Decision

Universal market-data contracts are implemented in `@ate/domain`. The package owns canonical
contracts and validation only. Provider adapters, raw payload retention, market-data transport,
historical stores and runtime feed authority remain future data-plane concerns.

## Consequences

- Downstream packages have one provider-neutral contract authority.
- No new package authority is created prematurely.
- `@ate/domain` remains free of provider SDKs, network clients, databases and trading engines.

## Reversibility

A future high-throughput data-plane package may depend on these contracts or re-export them, but it
must not redefine incompatible canonical market-data semantics.
