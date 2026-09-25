# Configuration Versioning and History

Prompt 9 adds the ATE configuration history authority. It records immutable configuration versions
with attribution, schema association, configuration fingerprints, snapshot identity, change sets,
structured diffs, lineage and historical reconstruction.

Prompt 9 itself did not implement feature flags. Prompt 10 now consumes version/schema provenance
for capability-control snapshots. Maker-checker approval, promotion, environment promotion,
operational rollback, market data, risk, portfolio, MT5, execution and live trading remain future
scope.

## Authority model

Configuration history has one state authority: `configuration.versionhistory`.

- Current configuration answers what the runtime has published.
- Schema authority answers which validation rules apply.
- Version history answers what immutable configuration facts have existed.

The current-version pointer is mutable state. Version records are immutable historical records.

## Version content strategy

Prompt 9 stores an immutable canonical full snapshot representation plus structured change-set
metadata. Full canonical content makes reconstruction bounded and integrity checks direct. Change
sets and diffs make operator explanation possible without replaying unbounded history.

## Version stream

The initial stream model is runtime-mode scoped:

```text
configuration.<runtime-mode>.default
```

This preserves environment isolation. Cross-environment promotion remains Prompt 12 scope.

## Lineage

Every non-root version has a `parentVersionId`. Historical derivation uses `derivedFromVersionId`
when content was based on an older version while parentage remains the current chronological stream.
This supports:

```text
V1 -> V2 -> V3 -> V4
```

where `V4.derivedFromVersionId = V1` without rewriting V2 or V3.

## Reconstruction is not rollback

Historical reconstruction returns canonical historical content and verifies its fingerprint. It does
not publish, activate, promote or roll back configuration. A previous version can become the content
basis for a new version, but operational rollback belongs to Prompt 12.

## Concurrency and idempotency

Version creation uses expected-parent semantics. A stale writer cannot silently overwrite newer
history. Idempotency keys deduplicate repeated submission of the same operation; semantic equality
alone does not collapse distinct historical facts.

## Integrity

Integrity verification checks configuration content fingerprint, version-record fingerprint, root
semantics and self-parent rejection. Lineage traversal is bounded and detects cycles or missing
parents.

## Security

Version history is not a secret vault. Secret references are redacted in stored version rendering,
diffs, diagnostics and events while preserving fingerprints for deterministic change detection.
