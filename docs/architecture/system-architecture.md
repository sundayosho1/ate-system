# System Architecture

## Mission

ATE is intended to become a broker-neutral, multi-asset, multi-strategy, multi-account autonomous
trading platform. MetaTrader 5 is the initial execution ecosystem, not the core intelligence.

## Conceptual lifecycle

```text
OBSERVE
VALIDATE
UNDERSTAND
CLASSIFY
DETECT
GENERATE
SCORE
RANK
RISK CHECK
PORTFOLIO CHECK
PROTECTION CHECK
DECIDE
ALLOCATE
EXECUTE
CONFIRM
RECONCILE
MANAGE
EXIT
MEASURE
ATTRIBUTE
LEARN
RESEARCH
VALIDATE IMPROVEMENTS
```

ATE may return `NO_ACTION` at any decision point.

## Architectural style

ATE should begin as a modular monolith with domain boundaries, clean architecture, ports/adapters,
event-driven integration where appropriate, and dependency inversion. Do not create microservices
prematurely.

## Dependency rule

Core domain/business logic must not directly depend on:

- MT5 or MQL5;
- specific brokers;
- databases;
- HTTP or frontend frameworks;
- news, market-data, or notification providers;
- operating-system-specific APIs.

External systems integrate through ports, contracts, adapters, and application services.

## Authoritative domain boundaries

Prompt 1 documents boundaries only. Future prompts implement functionality.

| Boundary                        | Ownership                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------- |
| Core Runtime                    | Process lifecycle, runtime mode, startup/shutdown conventions                    |
| Configuration                   | Typed, validated, versionable, auditable configuration                           |
| Events                          | Event contracts, registry, routing, correlation, causation, delivery diagnostics |
| Persistence                     | State ownership, migrations, transactions, history, audit, outbox/inbox          |
| Market Data                     | Broker/provider-neutral market observations and snapshots                        |
| Instrument Registry             | Canonical instruments, broker-symbol mapping, specifications                     |
| MOSE                            | Market Opportunity Surveillance Engine lifecycle and prioritization              |
| Market Intelligence             | Market structure, volatility, momentum, session, feature context                 |
| Regime Detection                | Trend/range/breakout/volatility/uncertain regime classifications                 |
| Strategies                      | Candidate generation; no direct execution                                        |
| Candidate/Decision Intelligence | Candidate scoring, ranking, master decision context                              |
| Risk                            | Deterministic risk checks and veto authority                                     |
| Portfolio                       | Concentration, correlation, exposure, diversification constraints                |
| Capital Protection              | Global and scoped protection states and halts                                    |
| Accounts                        | Account identity, mandates, balances/equity, permissions                         |
| Allocation                      | Account-specific execution instruction planning                                  |
| Execution                       | Broker-neutral execution commands and lifecycle                                  |
| MT5 Integration                 | MT5 gateway and Connector EA adapter boundary                                    |
| Reconciliation                  | Comparison between ATE state and external broker/MT5 state                       |
| Trade Management                | Post-entry management, exits, lifecycle tracking                                 |
| Historical Data                 | Dataset ingestion, normalization, quality, versioning                            |
| Backtesting                     | Deterministic historical evaluation                                              |
| Research                        | Hypotheses, experiments, attribution, reproducibility                            |
| Learning                        | Controlled, non-silent adaptation and research promotion                         |
| Third-Party Integrations        | Provider adapters for data, news, notifications, storage                         |
| Reporting                       | Operational and analytical reports                                               |
| Alerts                          | Operator notifications and escalation                                            |
| Audit                           | Durable records of sensitive actions and state changes                           |
| Security                        | Authentication, authorization, secrets, least privilege                          |
| Observability                   | Logs, metrics, traces, health, readiness                                         |
| Help                            | Contextual help, module help, searchable help content                            |
| Frontend                        | Control Center UI and configuration UX                                           |
| Administration                  | Operator workflows and governed system management                                |

## Repository architecture

The repository is organized to support future implementation without creating fake business modules:

- `apps/` for future deployable applications;
- `packages/` for future shared domain/application/infrastructure packages;
- `mt5/` for future MQL5 Connector EA and MT5 gateway artifacts;
- `docs/` for documentation-as-code;
- `config/` for machine-readable governance records;
- `tests/` for foundation and future system tests;
- `scripts/` for repository automation;
- `deployment/` for future deployment/runbook assets.

## Status semantics

Different status families must not be conflated.

### Health

- `HEALTHY`
- `DEGRADED`
- `UNAVAILABLE`

### Trading/operation

- `ACTIVE`
- `SUSPENDED`
- `PROTECTED`
- `HALTED`

### Opportunity

- `OBSERVING`
- `FORMING`
- `CANDIDATE`
- `QUALIFIED`
- `REJECTED`
- `INVALIDATED`
- `EXPIRED`

### Environment

- `DEVELOPMENT`
- `RESEARCH`
- `BACKTEST`
- `SIMULATION`
- `PAPER`
- `LIVE`

Future UI, APIs, and persistence should use explicit enumerations/contracts where practical.

## Error model

Future errors should be machine-readable, operator-understandable, attributable, and traceable by
correlation ID where appropriate.

Minimum categories:

- validation errors;
- authorization errors;
- configuration errors;
- data-quality errors;
- integration errors;
- broker/execution errors;
- transient infrastructure errors;
- invariant violations;
- safety/protection rejections;
- internal system errors.

Errors must not expose secrets or sensitive internals.

## Event principles

Prompt 4 implements the internal event architecture in `@ate/events`. Events communicate facts; they
do not grant trading authority or replace future persistent state authority. Events carry:

- event ID;
- event type;
- version;
- timestamp;
- source;
- correlation ID;
- causation ID;
- actor/system identity;
- payload;
- schema version.

The event bus validates registered types, routes to subscribers, preserves immutable event views,
records structured delivery results, applies subscriber-scoped idempotency, supports per-key
ordering, rejects saturation visibly, performs bounded retries, records dead letters and exposes
health/readiness diagnostics.

ATE separates the control/event plane from the future market-data plane. Raw high-volume ticks,
quotes and bars do not have to traverse the general event bus.

## Observability principles

ATE must be observable from the beginning.

- Logs: structured, leveled, contextual, no secrets.
- Metrics: machine-readable operational measurements.
- Traces/correlation: follow important operations across components.
- Health: explicit liveness/readiness/health semantics.

Operational logs answer what the software is doing. Audit records answer who or what changed
important state, when, and why.

## API principles

Future APIs should include:

- versioning;
- typed request/response contracts;
- validation;
- consistent error envelopes;
- authentication and authorization;
- idempotency for capital-bearing commands;
- pagination and filtering for collections;
- correlation IDs;
- rate limiting where appropriate;
- API documentation.

## Persistence principles

Prompt 5 implements the persistence/state authority foundation. The permanent principles are:

- explicit state ownership;
- controlled migrations;
- transactional integrity;
- reproducibility;
- appropriate immutability;
- auditability;
- no silent destructive schema changes;
- backup awareness;
- retention policies where applicable.

Events describe what happened. Authoritative state describes what is currently true. State history
explains how authoritative state changed. Audit explains who or what caused meaningful actions. The
transactional outbox prevents committed state changes from being separated from required events. The
durable inbox protects subscribers from duplicate effects. Caches and projections never become
authority.

## Frontend principles

The Control Center must be responsive, accessible, professional, information-dense without clutter,
keyboard-usable where practical, and built from a reusable design system. It must avoid
consumer-gambling visual language and expose contextual help.

## MT5 boundary

```text
ATE CORE
EXECUTION PORT
MT5 ADAPTER / GATEWAY
CONNECTOR EA
MT5 TERMINAL
BROKER
```

MT5 is an adapter and execution/data interface. ATE Core must remain broker-neutral and
platform-neutral.

## Third-party boundary

Provider categories such as market data, historical data, macro data, economic calendar, news,
notifications, monitoring, and storage must integrate through adapters. Optional providers must not
override deterministic safety controls.

## Windows VPS compatibility

ATE must remain compatible with Windows VPS operation. Do not hard-code local development paths into
runtime logic. Consider Windows filesystem behavior, service/process management, MT5 terminals,
environment variables, logging, monitoring, backup, networking, and restart behavior.
