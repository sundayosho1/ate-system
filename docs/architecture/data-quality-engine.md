# Data Quality Engine

Prompt 15 establishes `@ate/data-quality`, the deterministic quality-assessment package for
published Prompt 14 historical datasets.

It detects and reports quality issues. It does not repair observations, mutate datasets, certify
fitness for every use, authorize strategies, authorize execution, connect to providers, aggregate
bars, replay data, own dataset catalogue authority, or enable paper/live trading.

## Authority boundary

The package owns:

- quality profiles and rule definitions;
- rule execution status (`PASS`, `FINDINGS`, `NOT_APPLICABLE`, `INSUFFICIENT_EVIDENCE`, `FAILED`);
- bounded findings, evidence and suppression counts;
- quality scores and quality classes;
- explicit non-live intended-use qualification diagnostics;
- immutable report fingerprints;
- report staging and atomic publication;
- runtime health/readiness/diagnostics;
- summary-only event registrations.

The package consumes historical datasets through `HistoricalDatasetRepository` only. It does not
read private storage files and does not become a second historical-data authority.

## Validity distinctions

Prompt 15 preserves four separate concepts:

- **Structural validity**: Prompt 13 contract validation already accepted each canonical observation
  before dataset membership.
- **Import validity**: Prompt 14 artifact intake, mapping, rejections and publication status.
- **Data quality**: Prompt 15 findings, score and class for the observed dataset content.
- **Fitness for purpose**: a downstream decision that remains explicitly not assessed or requires
  further assessment. A quality score never authorizes trading.

## Rules and findings

The default profile includes rules for:

- dataset and partition integrity;
- import rejection evidence and coverage;
- bar gaps/overlaps;
- duplicate observations;
- timestamp, sequence, freshness and staleness anomalies;
- crossed/wide quote spreads;
- OHLC consistency;
- price outliers;
- volume evidence;
- timezone/session evidence;
- provenance completeness.

Findings carry category, dimension, severity, bounded evidence samples and optional observation
coordinates. Evidence caps are visible through `suppressedFindingCount`; omitted findings are not
silently hidden.

## Reports

Reports are staged before publication and are immutable after publication. Report fingerprints bind
dataset content fingerprint, profile identity/version/fingerprint, rule outcomes, findings, score
and summary. Volatile runtime metadata such as `generatedAt` and rule durations is excluded from the
semantic report fingerprint.

## Runtime and configuration

`DataQualityRuntimeService` integrates with `@ate/runtime` for health/readiness. It is supported in
development, research, backtest and simulation modes only.

Managed configuration declares bounded report analysis settings:

- `data.quality.maxObservations`;
- `data.quality.evidenceLimitPerRule`;
- `data.quality.defaultFreshnessMaxAgeMs`;
- `data.quality.reportStorageRoot`.

The capability registry exposes `data.dataQualityEngine` as an optional implemented capability
depending on Prompt 13 market-data contracts and Prompt 14 historical data laboratory.

## Event policy

Events are low-volume summaries:

- `data-quality.report.published.v1`;
- `data-quality.analysis.failed.v1`.

Events do not emit row-level findings or raw source values.

## Non-goals

Prompt 15 explicitly excludes:

- Dataset Catalogue and lineage graph authority, implemented separately in Prompt 16;
- real-time ingestion, provider APIs and WebSockets;
- aggregation, replay and backtesting engines;
- Universal Instrument Registry and market calendars;
- MOSE, intelligence, indicators and regime detection;
- strategies, risk, portfolio, capital protection and account allocation;
- MT5, execution, paper trading and live trading.
