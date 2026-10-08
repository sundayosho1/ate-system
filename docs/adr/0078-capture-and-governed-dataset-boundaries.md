# ADR-0078 — Capture and Governed Dataset Boundaries

## Status

Proposed for independent Prompt 17 review

## Decision

Publish completed capture manifests only after verified bounded content finalization. Recover
running sessions as aborted; reject manifest/content corruption. Emit a CAPTURE_ONLY handoff without
dataset registration.

## Consequences

Prompt 14 owns materialization/storage, Prompt 15 assessment and Prompt 16 catalogue eligibility.
File fsync/rename cannot guarantee every filesystem power-loss outcome; inconsistencies fail
verification. Single writer and operator retention are required.
