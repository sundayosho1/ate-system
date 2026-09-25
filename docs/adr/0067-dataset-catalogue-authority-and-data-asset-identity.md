# ADR-0067 — Dataset Catalogue Authority and Data-Asset Identity

## Status

Accepted

## Decision

`@ate/dataset-catalogue` is the sole authority for governed dataset family/version metadata,
lineage, lifecycle, eligibility, integrity references and reproducibility metadata.

Prompt 14 remains dataset content/storage authority. Prompt 15 remains quality-report authority.

## Consequences

- Catalogue records reference content by stable public IDs and fingerprints.
- Catalogue registration is not historical dataset publication.
- Catalogue qualification/active state is not trading authorization.
