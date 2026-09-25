# ADR-0065 — Quality Report Storage and Publication

## Status

Accepted

## Decision

Quality reports use repository abstractions with separate staging and publication phases. Filesystem
storage uses managed generated paths under configured roots.

## Consequences

- Consumers only read published reports.
- Partial staging failures do not become authoritative quality evidence.
- Raw dataset names, provider symbols and source filenames never become storage paths.
