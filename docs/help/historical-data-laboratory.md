# Historical Data Laboratory Help

## Overview

The Historical Data Laboratory imports offline market-data files into immutable research datasets.
It validates structure and mapping into Prompt 13 canonical observations. It does not score quality
or certify data for trading.

## Supported Formats

Supported formats are CSV, JSON, NDJSON and Parquet. Parquet uses `hyparquet`.

## Preparing Data

Know the source, canonical instrument, provider symbol, timestamp meaning, timezone, timeframe and
volume semantics before importing.

## Upload / Import Workflow

Artifact -> inspect -> map -> plan -> dry run -> import -> quarantine/review -> publish -> query.

## Mapping

Mappings declare how source fields become bid, ask, trade price, OHLC, volume, timeframe,
instrument, provider symbol and timestamps.

## Timezones

Canonical observations require UTC instants. Naive source timestamps require explicit UTC or IANA
timezone mapping. Ambiguous/nonexistent local times are rejected.

## CSV

CSV supports headers by default, optional explicit header profiles, delimiters, quoted fields and
bounded rows/fields/columns. Spreadsheet formulas are plain text.

## JSON

JSON can be one object or an array of objects. Nesting and record counts are bounded.

## Parquet

Parquet schema and rows are read through `hyparquet`. Corrupt or unsupported files fail safely.

## Import Profiles

Profiles are reusable mappings with stable identity/version/fingerprint.

## Rejections

Records can be rejected for parse failures, missing mapping, invalid timestamps, invalid decimals,
unknown volume semantics, invalid OHLC or Prompt 13 structural validation failure.

## Quarantine

Quarantine stores rejected-record evidence for inspection. It is not canonical market data and does
not appear in normal queries.

## Partial Imports

Partial datasets are explicitly marked `COMPLETED_WITH_REJECTIONS`. They are structurally published
but not quality-certified.

## Dataset Manifest

The manifest records artifact checksum, plan fingerprint, canonical schema identity, counts,
instruments, kinds, time range, partitions, content fingerprint and provenance references.

## Querying

Queries are bounded and deterministic. Filters include dataset, instrument, observation kind,
event-time range, timeframe and source. Pagination uses cursors.

## Reproducibility

Same artifact bytes plus same mapping and canonical schema should produce the same content
fingerprint.

## Safety Limits

Limits bound file size, rows, columns, field length, nesting, rejections and query page size.

## Troubleshooting

- Format mismatch: declared format does not match content.
- Timestamp rejected: add UTC offset or explicit timezone mapping.
- Decimal rejected: use plain base-10 strings.
- Invalid OHLC: source high/low/open/close is structurally impossible.
- Unknown volume: declare trade volume, tick volume, quote count or unavailable.
- Publication failed: check managed storage roots and path permissions.

## Related Features

Prompt 15 quality scoring is implemented separately in `@ate/data-quality` and consumes published
datasets through repository/query contracts. Prompt 16 catalogue/lineage is implemented separately
in `@ate/dataset-catalogue`. Prompt 17 real-time ingestion, Prompt 18 aggregation and Prompt 19
replay remain future scope.
