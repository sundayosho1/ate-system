# Core Domain Contracts

Prompt 2 establishes `@ate/domain`, the authoritative ATE domain-language package.

The package defines contracts and validation only. It does not implement trading behavior,
market-data ingestion, strategies, risk calculations, portfolio calculations, MT5 connectivity,
broker execution, persistence, APIs, or frontend UI.

## Package boundary

`@ate/domain` is:

- infrastructure-independent;
- framework-independent;
- broker-independent;
- database-independent;
- frontend-independent;
- deterministic;
- testable in isolation.

It must not import MT5 libraries, broker SDKs, database clients, HTTP frameworks, React, filesystem
APIs, or third-party market-data clients.

## Domain taxonomy

### Entity

Has stable identity and lifecycle.

Examples:

- Account
- Instrument
- Candidate
- Decision
- Order
- Position
- Trade

### Value object

Defined by values rather than identity.

Examples:

- Money
- Price
- Quantity
- Percentage
- Timestamp
- Timeframe
- CurrencyCode

### Enumeration / closed state

Known bounded vocabulary.

Examples:

- RuntimeMode
- CandidateState
- OrderState
- PositionState

### Domain event

Represents something that occurred. Prompt 2 defines the canonical event envelope but does not
implement an event bus.

### Command / intent

Represents something requested. Prompt 2 defines execution intent as a contract only; no order
submission exists.

### Snapshot

Immutable representation of state at a particular time, such as AccountSnapshot, MarketSnapshot, and
PortfolioSnapshot.

## Important distinctions

### Setup vs Signal vs Candidate vs Decision

- Setup: market condition of interest.
- Signal: strategy-derived indication from a setup/condition.
- Candidate: normalized trade proposition entering downstream gates.
- Decision: authoritative outcome from an authority, including `NO_ACTION`.

### Decision vs Execution Intent vs Order

- Master Trade Decision: ATE-level decision before account-specific translation.
- Account Execution Intent: account-specific requested intent derived from a master decision.
- Order: broker-neutral ATE order lifecycle representation.

### Order vs Fill vs Position vs Trade

- Order: requested broker-neutral order.
- Fill: execution record; one order may have zero, one, or many fills.
- Position: open/closing/closed account exposure.
- Trade: logical lifecycle for analytics/research that may aggregate orders, fills, and position
  history.

### Canonical instrument vs broker symbol

The canonical Instrument represents ATE's normalized market concept, such as `FX:EURUSD`.
BrokerInstrumentReference represents broker-specific symbols such as `EURUSD.a`.

Broker-specific contract specifications do not belong inside the canonical Instrument.

### Account vs account snapshot

Account is relatively stable identity and mandate/protection context. AccountSnapshot is
time-varying financial/account state observed from a source.

Credentials are never part of Account.

### Portfolio vs portfolio snapshot

Portfolio is identity and membership context. PortfolioSnapshot represents point-in-time aggregate
state and exposure references.

## Financial precision

Decimal values serialize as plain base-10 strings.

Invalid examples:

- `NaN`
- `Infinity`
- `1e-8`
- JavaScript number inputs for decimal contracts

Money always includes amount and currency. Money arithmetic rejects incompatible currencies.

Percentage uses ratio semantics:

- `0.01` means 1%
- `1` means 100%

## Time semantics

Serialized timestamps must be timezone-explicit. Domain parsing normalizes valid offset timestamps
to UTC ISO strings.

Prompt 2 defines time contracts but not the clock engine.

## Versioning

Durable or externally serialized contracts include `schemaVersion` where they are expected to
evolve.

Schema versions increment when serialized contract meaning changes.

Event types use a versioned pattern such as:

```text
decision.recorded.v1
```

## Validation

Runtime schemas reject structurally invalid values, including malformed IDs, invalid timestamps,
malformed decimals, impossible OHLC bars, unknown states, invalid schema versions, missing required
provenance, and invalid runtime modes.

Structural validation belongs to `@ate/domain`. Business-policy decisions belong to future engines.

## Serialization

Canonical JSON rules:

- IDs are UUID strings and opaque to business logic.
- Decimal values are strings.
- Enums serialize as uppercase strings.
- Timestamps serialize as UTC ISO strings.
- Optional fields remain explicit in schemas and must not be fabricated.
- Currency codes are uppercase alphanumeric identifiers.

## Correlation and causation

Domain contracts support future traceability through correlation and causation IDs across:

```text
MARKET EVENT
SETUP
SIGNAL
CANDIDATE
DECISION
ALLOCATION
EXECUTION INTENT
ORDER
FILL
POSITION
TRADE
```

## Public API discipline

Consumers should import from:

```ts
import { domainSchemas, parseDomainContract } from "@ate/domain";
```

Do not import deep internal paths from `packages/domain/src/...`.

## Backward compatibility foundation

Future contract evolution should follow:

- Additive optional fields are usually backward compatible.
- Meaning changes require schema/event version increments.
- Removed/renamed required fields are breaking changes.
- Fixtures in `tests/fixtures/domain/` provide early compatibility coverage.
- Deprecated fields should remain documented until removed through an approved migration path.

## Prompt 13 market-data evolution

Prompt 13 matures the original quote/bar foundations into the universal canonical market-data
contract authority. `@ate/domain` now includes provider-neutral market observations for quotes,
trades, ticks, OHLCV bars and market status; explicit event/source/receive timestamps; provider
symbol and source provenance; sequence scopes; typed volume; bounded metadata; correction records;
and deterministic market-data serialization helpers.

These remain contracts only. Provider ingestion, historical storage, data-quality scoring,
aggregation, replay, instrument registry, MOSE, strategy, risk and execution behavior remain future
scope.
