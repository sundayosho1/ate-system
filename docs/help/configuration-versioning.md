# Configuration Versioning Help

Prompt 9 records immutable configuration history.

## What is a configuration version?

A configuration version is an immutable historical record containing:

- version ID;
- runtime-mode stream;
- parent version;
- optional historical basis;
- configuration fingerprint;
- schema fingerprint;
- snapshot ID;
- actor attribution;
- change reason;
- creation time from the ATE clock authority;
- structured change set;
- safe canonical content for reconstruction.

## Version ID vs configuration fingerprint

Two versions may represent the same semantic configuration and therefore share a configuration
fingerprint. They must still have different version IDs when they are distinct historical facts.

## Current version

The current-version pointer identifies the latest version in a stream. It is mutable. Historical
version records are not mutable.

## Change sets and diffs

Change sets explain what produced a version. Diffs compare two versions directionally:

```text
FROM V1 TO V2
```

They report added, changed and removed entries plus unchanged counts. Sensitive and secret-reference
values are redacted.

## Historical reconstruction

Reconstruction returns the historical configuration represented by a version and verifies the
recorded fingerprint. Reconstruction is read-only.

Reconstruction is not rollback. It does not activate configuration, promote configuration or replace
current runtime state. Prompt 12 release authority owns those governed actions.

## Candidate from history

A previous version can be used as the basis for a new version. The new version records:

- current parent version;
- historical `derivedFromVersionId`;
- current schema validation evidence;
- a new version ID.

This preserves history; operational rollback creates separate release evidence.

## Attribution vs approval

`actor` identifies who or what created a version. It does not mean the version was approved. Prompt
11 maker-checker approval binds separate governance evidence to exact version IDs and fingerprints.

## Troubleshooting

- `CONFIGURATION_VERSION_NOT_FOUND`: requested version ID does not exist.
- `CONFIGURATION_VERSION_CONCURRENCY_CONFLICT`: expected parent was stale.
- `CONFIGURATION_VERSION_NO_SEMANTIC_CHANGE`: submitted content equals the current parent.
- `CONFIGURATION_VALIDATION_FAILED`: Prompt 8 schema validation rejected the candidate.
- `CONFIGURATION_VERSION_INTEGRITY_FAILED`: recorded fingerprints or lineage are inconsistent.
- `CONFIGURATION_VERSION_RECONSTRUCTION_FAILED`: historical content cannot be safely reconstructed.
- `CONFIGURATION_VERSION_DIFF_LIMIT_EXCEEDED`: requested diff exceeded configured bounds.

Configuration versioning itself does not provide promotion, rollback, MT5, execution or live
trading. Prompt 12 release authority can promote or roll back exact versions without rewriting
version history.
