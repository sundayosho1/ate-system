# ADR-0008: Zod Runtime Schemas and decimal.js Domain Primitives

## Status

Accepted

## Context

Prompt 2 requires strongly typed contracts plus runtime validation for payloads crossing trust
boundaries. TypeScript types alone cannot validate API input, MT5 messages, persisted events,
imported datasets, or integration payloads.

Prompt 1 also prohibits casual binary floating-point arithmetic for financial values. ATE needs
deterministic decimal representation for money, price, quantity, percentage, ratio, and rate
primitives.

## Decision

Use:

- Zod for runtime validation schemas aligned with TypeScript inference.
- decimal.js for deterministic decimal parsing, comparison, rounding, and arithmetic where Prompt 2
  primitives require it.

Domain contracts remain infrastructure-independent and do not import MT5, database clients, HTTP
frameworks, React, filesystem APIs, or broker SDKs.

## Alternatives Considered

- TypeScript-only interfaces: rejected because external payloads would not be validated at runtime.
- JSON Schema first: useful for interoperability but less ergonomic for the TypeScript contract
  package at this stage.
- Native JavaScript numbers: rejected for capital/price/risk precision.
- BigInt scaled integers for every decimal: powerful but premature before instrument-specific
  precision and broker specifications exist.

## Consequences

- Important contracts have executable schemas and typed outputs.
- Invalid payloads fail explicitly instead of being coerced.
- Decimal serialization uses plain base-10 strings and rejects NaN, Infinity, and scientific
  notation.
- Future JSON Schema generation can be added from the contract layer when API, MT5 protocol, or
  event contracts require it.

## Security Impact

Runtime validation reduces unsafe deserialization risk. Error handling must avoid leaking secrets;
Prompt 2 contracts intentionally exclude credentials from account models.

## Operational Impact

Contract parsing is deterministic across Linux development and Windows VPS operation. Timestamps are
timezone-explicit and normalized to UTC.

## Reversibility

Moderate. Zod schemas and decimal primitives are centralized in `@ate/domain`, making future
replacement possible but non-trivial once other modules depend on them.
