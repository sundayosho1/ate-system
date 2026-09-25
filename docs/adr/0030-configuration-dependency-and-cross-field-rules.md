# ADR-0030 — Configuration Dependency and Cross-Field Rules

## Status

Accepted

## Context

Some configuration is only valid in relation to other settings. Prompt 8 must support dependency,
conditional, mutual-exclusion and cross-field validation without allowing configuration to execute
arbitrary code.

## Decision

Schemas declare data-only rule descriptors. The validation engine implements deterministic built-in
rules for dependencies, mutual exclusions, conditional requirements and a small set of cross-field
checks such as runtime-mode/context matching, values matching and values differing.

## Consequences

- Configuration remains declarative and cannot run code.
- Reports can explain rule violations with stable phases.
- Future prompts may add reviewed built-in rule identifiers, but arbitrary user-provided validators
  are not part of Prompt 8.
