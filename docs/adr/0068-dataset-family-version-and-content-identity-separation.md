# ADR-0068 — Dataset Family, Version and Content Identity Separation

## Status

Accepted

## Decision

Dataset family identity, immutable dataset-version identity and content fingerprint identity are
separate concepts.

Version fingerprints bind immutable registration semantics. Catalogue state fingerprints bind
mutable governance associations such as lifecycle, integrity and quality references.

## Consequences

- A content change creates a new dataset version.
- A new quality report does not create a new dataset version.
- Lifecycle changes do not rewrite dataset content identity.
