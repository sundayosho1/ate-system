# Configuration Schema and Validation Help

Prompt 8 helps operators and developers understand why configuration did or did not activate.

## What changed

Managed configuration can now be checked against schemas before it becomes active. A schema can
describe:

- the expected value type;
- allowed values;
- ranges and units;
- object shape;
- allowed scopes;
- dependencies between settings;
- conditional requirements;
- cross-field rules;
- safe help metadata.

## When invalid configuration is rejected

If a candidate snapshot contains a blocking schema issue, the runtime configuration service returns
`CONFIGURATION_VALIDATION_FAILED`. The previous active snapshot remains active when one exists.

Common causes include:

- typo in an enum value, such as an unsupported log level;
- numeric value outside the declared range;
- required object property missing;
- environment-specific entry applied to an unsupported runtime mode;
- dependency or mutual-exclusion rule violation;
- runtime mode value not matching the context being resolved.

## Reading a validation report

Reports include:

- `publicationAllowed` — whether blocking issues were absent;
- `summary.issueCount` — all issues;
- `summary.blockingIssueCount` — errors and critical errors;
- `summary.phaseCounts` — where issues occurred;
- `issues[].phase` — stable phase name;
- `issues[].constraint` — violated constraint name when applicable.

Reports avoid raw secret values. Secret-bearing configuration must use secret references.

## Current boundaries

Prompt 8 validates configuration shape and activation safety only. It does not provide historical
configuration versions, approvals, promotion, rollback, UI editing, trading, market-data ingestion,
risk, portfolio, broker execution, MT5 connectivity or live trading. Prompts 9-10 now add immutable
version history and capability-control foundations on top of these validation gates.
