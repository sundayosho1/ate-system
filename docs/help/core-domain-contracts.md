# Help: Core Domain Contracts

## Overview

Core Domain Contracts are the shared ATE language used by future modules to communicate about
instruments, accounts, market observations, strategies, candidates, decisions, orders, positions,
trades, portfolios, events, money, time, provenance, and reasons.

## Purpose

They prevent future modules from inventing incompatible definitions of the same concept. This is
essential for auditability, safety, reproducibility, multi-account routing, broker neutrality, and
future MT5 integration.

## How it works

The `@ate/domain` package exposes:

- branded identifiers;
- financial primitives;
- canonical enums/states;
- runtime validation schemas;
- serialization-safe contracts;
- explicit validation results;
- public exports through the package root.

Invalid external payloads fail explicitly. They do not silently coerce to safe looking defaults.

## Usage

Developers should:

1. Import from `@ate/domain`.
2. Parse untrusted payloads with `parseDomainContract`.
3. Use `domainSchemas` for trust-boundary validation.
4. Preserve correlation and causation IDs.
5. Serialize decimals as strings.
6. Use explicit `NO_ACTION` decisions when no trade should occur.
7. Keep broker/MT5 mappings in adapter boundaries, not domain objects.

## Configuration help

Prompt 2 introduces no runtime operator configuration.

Contract-level behavior is governed by code and tests:

- identifier validation uses UUID strings;
- decimal values use plain base-10 strings;
- timestamps require timezone-explicit input and normalize to UTC;
- enum/state values reject unknown strings;
- durable contracts use `schemaVersion`.

## State help

Important state families include:

- Runtime modes: DEVELOPMENT, RESEARCH, BACKTEST, SIMULATION, PAPER, LIVE
- Protection states: NORMAL, CAUTION, REDUCED_RISK, DEFENSIVE, NO_NEW_TRADES, PROTECTED, HALTED
- Candidate states: CREATED, OBSERVING, QUALIFIED, REJECTED, INVALIDATED, EXPIRED, APPROVED
- Order states: CREATED, VALIDATING, SUBMITTED, ACKNOWLEDGED, PARTIALLY_FILLED, FILLED, REJECTED,
  CANCEL_PENDING, CANCELLED, EXPIRED, UNKNOWN, RECONCILIATION_REQUIRED

## Warnings

- A domain contract does not imply an engine has been implemented.
- A candidate is not an approval.
- A master decision is not an account-specific order.
- An execution intent is not broker execution.
- `LIVE` must never be an implicit fallback.
- Scores are not guaranteed win probabilities.

## Troubleshooting

If validation fails:

1. Inspect returned issues.
2. Check IDs are UUID strings.
3. Check decimals are strings, not JavaScript numbers.
4. Check timestamps include timezone/offset.
5. Check enum values exactly match canonical states.
6. Check required provenance exists for observations and candidates.
7. Check OHLC bars satisfy universal structural rules.

## Related features

- Engineering Constitution
- Safety Invariants
- Configuration Principles
- Core Domain Contracts architecture document
- Glossary

## Audit information

Prompt 2 does not implement audit storage. Contracts include identifiers, actors, correlation IDs,
causation IDs, reasons, timestamps, and provenance so future audit architecture can attribute
important actions correctly.
