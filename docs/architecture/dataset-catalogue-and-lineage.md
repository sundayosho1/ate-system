# Dataset Catalogue and Lineage

Prompt 16 establishes `@ate/dataset-catalogue`, the authority for governed data-asset identity,
immutable dataset versions, provenance, lineage, integrity metadata, Prompt 15 quality references,
lifecycle state, intended-use eligibility, reproducibility evidence, discovery and impact analysis.

It is not dataset storage, not data-quality scoring, not a transformation engine, not ingestion, not
aggregation, not replay and not trading authority.

## Authority boundary

The catalogue owns:

- dataset family identity;
- immutable dataset version identity;
- registration fingerprints;
- provenance references;
- transformation metadata;
- lineage edges and bounded graph traversal;
- integrity verification evidence;
- Prompt 15 quality report references;
- lifecycle transition history;
- active-version pointers;
- evidence-based eligibility;
- reproducibility metadata;
- bounded discovery and impact analysis;
- catalogue runtime diagnostics.

Prompt 14 remains authority for historical dataset content and storage. Prompt 15 remains authority
for quality findings, scores and reports.

## Identity separation

Prompt 16 separates:

- dataset family ID: stable logical data asset;
- dataset version ID: immutable governed version;
- content fingerprint: Prompt 14 canonical content identity;
- registration fingerprint: semantic registration metadata identity;
- catalogue state fingerprint: lifecycle/quality/integrity association state.

Content changes create new dataset versions. Quality reanalysis and lifecycle changes do not mutate
dataset content identity.

## Registration

Registration validates Prompt 14 manifests, builds safe content summaries, records source artifact
and import-plan provenance, attaches quality references where available, creates lineage edges and
persists an immutable catalogue record atomically.

Repeated registration of identical semantic metadata is idempotent. Conflicting reuse of a dataset
version ID fails closed.

## Lineage

Lineage is a directed graph over dataset versions and external/source artifact nodes. Derivation
lineage is distinct from associations such as quality reports. The implementation supports parents,
children, ancestry, descendants, root-source resolution and impact analysis with depth and node
bounds.

Self-lineage and unknown governed parents are rejected. Derivation cycle prevention is enforced at
registration boundaries.

## Integrity

`DatasetIntegrityMetadata` binds content fingerprint, manifest fingerprint, partition checksums,
schema identity, provenance fingerprint, lineage fingerprint and verification history. Rechecking
integrity creates new verification evidence; it never rewrites the registered fingerprint.

## Quality references

The catalogue stores Prompt 15 report references: report ID, profile, report fingerprint, score,
classification and qualification. It does not recalculate quality scores or invent catalogue quality
scores.

## Lifecycle and eligibility

Lifecycle states include `REGISTERED`, `QUALIFIED`, `ACTIVE`, `SUPERSEDED`, `DEPRECATED`,
`QUARANTINED`, `INVALIDATED` and `RETIRED`.

Eligibility is derived from evidence: lifecycle, integrity, quality reference, intended use and
policy. Active selection does not authorize strategy execution, paper trading or live trading.

## Reproducibility and snapshots

Reproducibility records exact source checksums, parent version IDs, import-plan/configuration
fingerprints, transformation fingerprints and expected output content fingerprint. Catalogue
snapshots fingerprint semantic catalogue state for future reproducible research.

## Runtime/configuration

`DatasetCatalogueRuntimeService` integrates with runtime health/readiness. Managed configuration
declares query, lineage, parent-count, integrity and quality-policy bounds under `data.catalogue.*`.

## Non-goals

Prompt 16 does not implement Prompt 17 real-time ingestion, Prompt 18 aggregation, Prompt 19 replay,
Prompt 20 instrument registry, provider connections, WebSockets, broker discovery, MOSE, indicators,
strategies, risk, portfolio, account allocation, MT5, paper trading or live trading.
