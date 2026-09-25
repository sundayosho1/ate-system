# Dataset Catalogue and Lineage Help

## Overview

The Dataset Catalogue registers governed dataset metadata. It answers which dataset families and
immutable versions exist, where they came from, which quality reports apply, how they relate to
parents/children, whether integrity is verified and why they are or are not eligible for a research
use.

## Why Dataset Identity Matters

Research and future replay/backtesting must bind exact dataset versions. A newer dataset version
must never silently replace the exact version selected by a reproducible run.

## Dataset Families

A family is a stable logical data asset. Family identity dimensions include instrument scope,
observation-kind scope, timeframe scope, source scope, schema family and origin type.

## Dataset Versions

A version is one immutable governed materialized state. Content changes, schema changes, mapping
changes and material provenance changes require a new version.

## Content Fingerprints

Prompt 14 content fingerprints identify canonical content. They are not dataset-version IDs.

## Dataset Manifests

Prompt 14 manifests remain the authority for historical content summaries, partitions and content
fingerprints.

## Registration

Registration validates the manifest, provenance, lineage parents, quality references and integrity
metadata, then atomically writes a catalogue version record.

## Provenance and Source Artifacts

The catalogue records source artifact ID/checksum, import-plan fingerprint, source/provider
references and schema identity. Filenames are never provenance authority.

## Transformations

Prompt 16 records transformation metadata such as `IMPORT`, `FILTER`, `MERGE`, `NORMALIZE` and
`QUALITY_GATED_SELECTION`. It does not execute transformations.

## Lineage

Lineage connects source artifacts and parent dataset versions to target dataset versions. Ancestry,
descendants, root sources and impact analysis are bounded.

## Broken Lineage and Orphans

Unknown governed parents, self-lineage and cycles fail closed. A root imported dataset with valid
external/source provenance is not an orphan.

## Integrity Verification

Integrity verification checks registered fingerprints against available authoritative evidence and
records new verification evidence. It does not rewrite historical content.

## Quality Report References

Prompt 15 reports may be linked by report ID. The catalogue stores report references and
qualification evidence; Prompt 15 remains quality score authority.

## Dataset Lifecycle

States are `REGISTERED`, `QUALIFIED`, `ACTIVE`, `SUPERSEDED`, `DEPRECATED`, `QUARANTINED`,
`INVALIDATED` and `RETIRED`. Transitions are recorded with reason, actor, timestamp and evidence.

## Eligibility

Eligibility is evidence-based and intended-use-specific. It may return `ELIGIBLE`,
`ELIGIBLE_WITH_WARNINGS`, `NOT_ELIGIBLE` or `INSUFFICIENT_EVIDENCE`.

There is no live-trading eligibility.

## Reproducibility

Reproducibility records exact source checksums, parent versions, import-plan/configuration
fingerprints, transformation fingerprints, schema and expected output fingerprint.

## Catalogue Discovery

Queries can filter by family, version, instrument, observation kind, timeframe, source, lifecycle,
integrity, quality qualification and intended-use eligibility. Queries are bounded and ordered
deterministically.

## Impact Analysis

Impact analysis reports known downstream dependants. It does not automatically invalidate them.

## Active Versions

Active pointers are separate from immutable versions. Changing active selection does not mutate
dataset content and does not authorize trading.

## Configuration

Important settings:

- `data.catalogue.maxQueryPageSize`;
- `data.catalogue.maxLineageDepth`;
- `data.catalogue.maxLineageNodes`;
- `data.catalogue.maxParentsPerDataset`;
- `data.catalogue.requireQualityForQualification`;
- `data.catalogue.requireVerifiedIntegrity`;
- `data.catalogue.storageRoot`.

## Troubleshooting

- `DATASET_MANIFEST_MISMATCH`: Prompt 14 manifest could not be resolved.
- `DATASET_QUALITY_REFERENCE_INVALID`: Prompt 15 report does not match the dataset content.
- `DATASET_LINEAGE_PARENT_NOT_FOUND`: governed parent version is unknown.
- `DATASET_LINEAGE_CYCLE`: requested lineage would create a cycle.
- `DATASET_ACTIVE_VERSION_CONFLICT`: active pointer changed since caller's expected version.
- `DATASET_QUERY_LIMIT_EXCEEDED`: reduce query page size.

## Audit Information

Registration, lifecycle, quality-link and lineage events are summary-only. They do not contain full
datasets or unbounded graph payloads.

## Related Features

Prompt 13 defines canonical market-data contracts. Prompt 14 publishes historical datasets. Prompt
15 produces quality reports. Prompts 17-19 remain future ingestion, aggregation and replay scope.
