# Data Quality Engine Help

Use `@ate/data-quality` to assess a published historical dataset and produce an immutable quality
report.

## Typical flow

1. Import and publish a historical dataset with `@ate/historical-data`.
2. Create a quality profile, usually `createDefaultDataQualityProfile()`.
3. Construct `DataQualityEngine` with:
   - a `Clock`;
   - the historical dataset repository;
   - a data-quality report repository.
4. Call `analyzeDataset({ datasetId, profile, runtimeMode, asOf })`.
5. Read the published report from the returned value or report repository.

## Reading a report

Important fields:

- `structuralValidity`: whether Prompt 13 structural validity was already satisfied before quality
  analysis.
- `importValidity`: whether Prompt 14 import completed cleanly or with rejections.
- `dataQuality`: Prompt 15 quality class.
- `score`: bounded diagnostic score and qualification.
- `score.doesNotAuthorizeTrading`: always `true`.
- `ruleExecutions`: rule statuses, counts and suppressed finding counts.
- `findings`: bounded evidence samples.
- `reportFingerprint`: deterministic semantic identity excluding volatile runtime metadata.

## Rule statuses

- `PASS`: rule ran and found no issues.
- `FINDINGS`: rule ran and emitted findings.
- `NOT_APPLICABLE`: rule does not apply to the dataset.
- `INSUFFICIENT_EVIDENCE`: rule needs more evidence than the dataset/profile supplied.
- `FAILED`: rule execution failed visibly.

## Safe interpretation

Quality reports are diagnostics. They do not:

- mutate or repair source data;
- convert rejected source rows into canonical observations;
- declare a dataset fit for every purpose;
- authorize candidate generation, risk approval, order submission, paper trading or live trading.

If a consumer needs data fitness for a future workflow, it must define its own explicit acceptance
criteria over report fields and still remain subordinate to safety controls.

## Configuration

The central configuration authority owns these keys:

- `data.quality.maxObservations`;
- `data.quality.evidenceLimitPerRule`;
- `data.quality.defaultFreshnessMaxAgeMs`;
- `data.quality.reportStorageRoot`.

Do not create module-local alternatives for these values.

## Troubleshooting

- `DATA_QUALITY_DATASET_NOT_FOUND`: confirm the dataset is published in the historical repository.
- `DATA_QUALITY_QUERY_FAILED`: check historical query bounds and repository readiness.
- `DATA_QUALITY_PROFILE_INVALID`: verify profile rules, score threshold and observation limits.
- `INSUFFICIENT_EVIDENCE`: inspect rule messages and consider a profile with appropriate scope.
- High `suppressedFindingCount`: increase evidence limits only if the report consumer needs more
  samples.
