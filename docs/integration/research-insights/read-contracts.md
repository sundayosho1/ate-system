# Read contracts and view states

The only implemented methods are pure foundation validation/catalogue/search/serialization and an
explicitly injected P6clock timestamp capture. Operational owner methods are default-denied.
DataQualityEngine.analyzeDataset produces reports; ReplayController.snapshot publishes checkpoints;
P25/P26/P27health refresh owner state. Do not call these for a passive view.

Display KNOWN0/false separately from UNKNOWN/UNSUPPORTED/NOT_APPLICABLE. A valid empty static search
is EMPTY_OBSERVED; loading/unavailable/invalid/partial/stale/historical views never fall back to
green/zero/COMPLETE. ReportManifest describes requested facets, not all markets. P26requests require
explicitoffset/totalRequests in a future adapter; nextOffset is work-only. P27current denominator
remains unestablished. No generation pin can be inferred from stable totals.

All13schema families are listed in docs/knowledge/schemas.json and enforced by
contractDefinitions/validateInsightRecord. Full owner IDs/fingerprints and Result
operation/phase/commitment remain. Unknown major version rejects. Shape validation is not source
authentication. No arbitrary native object or repository is a wire DTO.
