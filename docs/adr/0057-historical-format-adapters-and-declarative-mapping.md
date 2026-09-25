# ADR-0057 — Historical Format Adapters and Declarative Mapping

## Status

Accepted

## Decision

Prompt 14 supports CSV, JSON, NDJSON and Parquet through explicit adapters. Source fields map to
Prompt 13 semantics through declarative mapping specifications. Mappings do not execute code.

## Consequences

- Ambiguous files require explicit mapping.
- Provider-specific source layouts do not leak into downstream canonical observations.
- Parquet decoding uses `hyparquet` rather than hand-written decoding.
