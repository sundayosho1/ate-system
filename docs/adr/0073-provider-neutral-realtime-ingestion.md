# ADR-0073 — Provider-Neutral Real-Time Ingestion

## Status

Proposed for independent Prompt 17 review

## Decision

Use a data-only adapter port and a bounded deterministic ingestion pipeline. Validate adapter
capability metadata and every untrusted payload through Prompt 13 before publication. No commercial
provider is required.

## Consequences

Vendor transports remain replaceable. The scripted adapter proves faulty behavior offline. No
execution methods exist.
