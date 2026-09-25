# Historical Data Laboratory

Prompt 14 establishes `@ate/historical-data`, the offline historical-data intake and research-access
package. It turns untrusted source artifacts into structurally valid Prompt 13 canonical market-data
observations and immutable local historical datasets.

It does not implement Prompt 16 dataset catalogue, Prompt 17 real-time ingestion, Prompt 18
aggregation, Prompt 19 replay, Prompt 20 instrument registry, MOSE, strategies, risk, execution or
trading. Prompt 15 quality scoring is implemented separately in `@ate/data-quality`.

## Authority boundary

The package owns:

- source artifact intake and SHA-256 checksums;
- format detection;
- CSV, JSON, NDJSON and Parquet parser adapters;
- source schema inspection;
- declarative mapping specifications;
- import-plan fingerprints;
- canonical normalization into Prompt 13 observations;
- structural validation reuse;
- rejection/quarantine evidence;
- immutable dataset manifests;
- staging and atomic publication;
- bounded research queries;
- runtime health/readiness/diagnostics.

The package does not decide whether data is clean, complete, representative or tradeable.

## Source artifacts

`HistoricalSourceArtifact` records content-aware identity: artifact ID, sanitized display filename,
declared/detected format, byte size, SHA-256 checksum, import timestamp, actor, source/provider and
safe metadata. Filenames are display metadata only and never become internal paths.

## Supported formats

- CSV: bounded rows, columns, fields and row length.
- JSON: bounded arrays, strings and nesting.
- NDJSON: one logical object record per line with line location.
- Parquet: `hyparquet`-backed metadata and row decoding.

Format detection uses extension, signature and parser probes. Declared-format mismatch fails.

## Mapping and normalization

Mappings are declarative. They define observation kind, instrument mapping, provider symbol,
timestamp semantics, timezone, timeframe, OHLC/bid/ask/trade fields and volume semantics. They do
not execute code.

Naive timestamps require declared UTC or IANA timezone interpretation before Prompt 13 validation.
Bar imports require explicit interval start/end and timeframe semantics.

## Import plans

`HistoricalImportPlan` binds artifact checksum, format evidence, source schema, mapping, rejection
policy, duplicate policy, limits and canonical schema identity. The plan fingerprint changes when
artifact bytes or mapping semantics change.

## Rejections and quarantine

Rejected records preserve source location, safe bounded source evidence, reason code and canonical
validation errors. Quarantine is evidence only and is excluded from normal historical queries.

## Dataset construction

Accepted observations are ordered deterministically by event time, instrument, observation kind,
comparable sequence and observation ID. The resulting dataset manifest records counts, instruments,
kinds, time range, timeframes, partitions, source refs, artifact checksum, plan fingerprint and
content fingerprint.

## Staging and publication

Repositories distinguish staged and published datasets. Research queries only see published
datasets. Filesystem publication uses managed generated paths under configured roots; raw filenames
are never trusted paths.

## Query API

Queries require a dataset ID and bounded limit. Filters support instrument, observation kind,
event-time range, timeframe and source. Range semantics use `[startInclusive, endExclusive)`.

## Runtime service

`HistoricalDataRuntimeService` integrates with `@ate/runtime` for health, readiness and bounded
diagnostics. Supported runtime modes are development/research/backtest/simulation; live import
authority is not claimed.

## Future integration

- Prompt 15 consumes published datasets for quality assessment through public repository/query
  contracts.
- Prompt 16 registers manifests in the global catalogue.
- Prompt 19 reads datasets for deterministic replay.
- Prompt 73+ may consume quality-approved/catalogued datasets for backtesting.
