# Glossary

This glossary defines canonical ATE terminology. Future prompts should use these terms consistently.

| Term                          | Definition                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ATE                           | Autonomous Trading Engine; the overall platform.                                                                                                                          |
| MOSE                          | Market Opportunity Surveillance Engine; future subsystem that observes approved markets and promotes developing opportunities through surveillance states.                |
| Instrument                    | A tradable market concept independent of broker naming.                                                                                                                   |
| Broker Symbol                 | Broker/platform-specific symbol string, such as `EURUSD.a`.                                                                                                               |
| Canonical Instrument          | ATE's normalized instrument identity, such as `FX:EURUSD`.                                                                                                                |
| Trading Universe              | All instruments known or potentially available to ATE.                                                                                                                    |
| Approved Universe             | Instruments explicitly authorized for deeper observation or research/trading according to lifecycle state.                                                                |
| Active Universe               | Approved instruments currently enabled for active processing in a runtime mode.                                                                                           |
| Market Observation            | Raw or normalized data point observed from a provider/broker.                                                                                                             |
| Market Snapshot               | Point-in-time view of relevant market state.                                                                                                                              |
| Market Intelligence           | Reusable interpretation of market structure, volatility, momentum, session, spread, and context.                                                                          |
| Regime                        | Market classification such as `TREND`, `RANGE`, `BREAKOUT`, `HIGH_VOLATILITY`, `LOW_VOLATILITY`, `ABNORMAL`, or `UNCERTAIN`.                                              |
| Strategy                      | A bounded candidate-generation method. Strategies do not place broker orders.                                                                                             |
| Setup                         | Market condition pattern that may develop into a candidate.                                                                                                               |
| Candidate                     | Standardized potential trade idea produced by a strategy for evaluation.                                                                                                  |
| Signal Score                  | Quantitative assessment of candidate quality; not a guaranteed win probability unless calibrated and justified.                                                           |
| Opportunity                   | Developing or qualified market condition tracked through a lifecycle.                                                                                                     |
| Master Trade Decision         | Canonical decision that may later be allocated to eligible accounts after required checks.                                                                                |
| Risk Approval                 | Deterministic risk authorization for a candidate/decision; risk may veto.                                                                                                 |
| Account Allocation            | Account-specific execution planning based on account mandate, equity, margin, eligibility, exposure, broker specs, and protection state.                                  |
| Execution Instruction         | Broker-neutral instruction generated after all required approvals.                                                                                                        |
| Order                         | Broker/platform order request or accepted order representation.                                                                                                           |
| Position                      | Open market exposure observed or tracked for an account.                                                                                                                  |
| Trade                         | Completed or lifecycle-managed trading activity with entry, management, exit, and outcome context.                                                                        |
| Portfolio                     | Aggregate exposure and risk context across accounts, instruments, strategies, and asset classes.                                                                          |
| Account Mandate               | Account-specific permissions, limits, and operating constraints.                                                                                                          |
| Protection State              | Capital protection state such as `NORMAL`, `CAUTION`, `REDUCED_RISK`, `DEFENSIVE`, `NO_NEW_TRADES`, `PROTECTED`, or `HALTED`.                                             |
| Execution Node                | Runtime environment responsible for execution-facing operations, potentially colocated with MT5 terminals.                                                                |
| MT5 Gateway                   | Adapter/service boundary between ATE execution contracts and MT5 Connector EA/terminal communication.                                                                     |
| Connector EA                  | Lightweight MetaTrader 5 Expert Advisor responsible for connectivity, state forwarding, instruction receipt, order submission, confirmations, and reconciliation support. |
| Reconciliation                | Process of comparing ATE internal state with externally observable MT5/broker state.                                                                                      |
| Dataset                       | Versioned collection of data used for research, backtesting, or analysis.                                                                                                 |
| Experiment                    | Controlled research activity with code, data, configuration, and parameters.                                                                                              |
| Backtest                      | Deterministic historical evaluation against versioned data and configuration.                                                                                             |
| Simulation                    | Non-capital-bearing operation against simulated or replayed conditions.                                                                                                   |
| Paper                         | Non-capital-bearing forward operation against current/near-current market conditions where supported.                                                                     |
| Live                          | Capital-bearing operation.                                                                                                                                                |
| NO_ACTION                     | Valid decision indicating no justified exposure or action should occur.                                                                                                   |
| Entity                        | Domain object with stable identity and lifecycle, such as Account, Instrument, Candidate, Decision, Order, Position or Trade.                                             |
| Value Object                  | Domain object defined by values rather than identity, such as Money, Price, Quantity, Percentage, Timestamp or CurrencyCode.                                              |
| Domain Event                  | Record that something occurred, carried in a versioned event envelope.                                                                                                    |
| Event Envelope                | Canonical Prompt 2 structure carrying event ID, type, timestamp, source, actor, correlation, causation, runtime mode and payload.                                         |
| Event Registry                | Prompt 4 registry of known event types, categories, versions, owners, descriptions and payload validators.                                                                |
| Event Bus                     | Prompt 4 in-process communication service that validates, routes and delivers registered events to subscribers.                                                           |
| Event Subscription            | Stable subscriber registration with event routes, subscriber identity, criticality, delivery policy and handler.                                                          |
| Delivery Result               | Structured publication/handler outcome showing subscribers, attempts, successes, duplicates, failures, retries, dead-letter state and duration.                           |
| Dead Letter                   | In-memory Prompt 4 record of an event/subscription delivery that failed after bounded handling and requires investigation before explicit replay.                         |
| Ordering Key                  | Optional event metadata defining a scoped sequence boundary such as an instrument, account, order, position or correlation chain.                                         |
| Execution Intent              | Account-specific requested execution intent derived from a master decision; distinct from broker order submission.                                                        |
| Fill                          | Execution record for all or part of an order; one order may have multiple fills.                                                                                          |
| Reason Code                   | Stable machine-readable reason with category, authority, severity, summary and evidence references.                                                                       |
| Correlation ID                | Identifier connecting related commands, events, logs, audit records and contract objects across a workflow.                                                               |
| Causation ID                  | Identifier pointing to the preceding cause of an event or decision in a workflow chain.                                                                                   |
| Idempotency Key               | Stable duplicate-protection key. Prompt 4 scopes event handler idempotency by subscription ID plus key.                                                                   |
| Schema Version                | Explicit version on durable or serialized contracts whose shape or meaning may evolve.                                                                                    |
| Provenance                    | Source and quality context explaining where data came from, when it was observed/ingested and what quality state applied.                                                 |
| Data Quality Status           | Canonical quality vocabulary: UNKNOWN, HEALTHY, DEGRADED, STALE, INVALID, MISSING.                                                                                        |
| Runtime Mode                  | Canonical execution context: DEVELOPMENT, RESEARCH, BACKTEST, SIMULATION, PAPER or LIVE.                                                                                  |
| Decimal                       | Plain base-10 string representation used to avoid silent JavaScript floating-point assumptions.                                                                           |
| Percentage                    | Ratio-based percentage value where `0.01` means 1% and `1` means 100%.                                                                                                    |
| Broker Instrument Reference   | Contract linking a broker-specific symbol to a canonical ATE instrument without embedding broker details in the Instrument itself.                                        |
| Runtime Instance ID           | Stable identifier for one ATE runtime instance during its lifetime.                                                                                                       |
| ATE Runtime                   | Application lifecycle controller responsible for composition, dependency validation, startup, health/readiness, degradation, recovery, shutdown and snapshots.            |
| Service Descriptor            | Structured runtime metadata for a managed service, including service ID, criticality, dependencies, supported modes and capabilities.                                     |
| Service Criticality           | Runtime classification: CRITICAL, REQUIRED or OPTIONAL.                                                                                                                   |
| Health                        | Operational condition indicating whether a service/runtime appears functioning.                                                                                           |
| Readiness                     | Operational condition indicating whether a service/runtime is safe/capable for its intended workload.                                                                     |
| Runtime Snapshot              | Immutable operational view of runtime state, services, health, readiness, capabilities, failures and degradations.                                                        |
| Degradation Report            | Structured runtime record describing a degraded/failed service, affected capabilities, affected dependants and recoverability.                                            |
| Control/Event Plane           | Application/domain event plane for decisions, lifecycle facts, state transitions, alerts, execution outcomes, reconciliation outcomes, analytics and research facts.      |
| Market Data Plane             | Future high-volume observation transport for ticks, quotes and bars that may use specialized pipelines rather than the general event bus.                                 |
| Authoritative State           | Canonical durable state owned by one responsible state domain/service through one controlled write path.                                                                  |
| External Authoritative State  | State whose ultimate authority belongs to an external system, such as future broker/MT5-confirmed facts.                                                                  |
| Derived State                 | Calculated state produced from authoritative inputs.                                                                                                                      |
| Projection                    | Read-optimized representation derived from authoritative records/events; not write authority.                                                                             |
| Cache                         | Temporary performance optimization; never authoritative.                                                                                                                  |
| State Authority Registry      | Prompt 5 registry declaring state domains, owners, authority type, write authority, durability, history, reconciliation and runtime-mode scope.                           |
| Optimistic Concurrency        | Expected-version write model preventing stale writers from silently overwriting newer authoritative state.                                                                |
| State History                 | Append-only record of authoritative state transitions.                                                                                                                    |
| Audit Record                  | Append-only evidence of meaningful actions, actors, outcomes, affected resources, correlation and causation.                                                              |
| Transactional Outbox          | Durable event record committed atomically with state/history so event dispatch occurs after commit.                                                                       |
| Durable Inbox                 | Persistent subscriber/idempotency processing record preventing duplicate side effects across restart.                                                                     |
| Clock Authority               | The single runtime-selected source of current UTC instants for events, persistence, diagnostics and audit evidence.                                                       |
| UTC Instant                   | Canonical timezone-explicit timestamp normalized to UTC, such as `2026-09-25T00:00:00.000Z`.                                                                              |
| Monotonic Time                | Process-local elapsed-time source that does not move backward with wall-clock corrections.                                                                                |
| Virtual Clock                 | Explicitly advanced non-system clock used for deterministic tests and controlled workflows.                                                                               |
| Simulation Clock              | Non-capital-bearing clock used to advance simulated workflows without waiting for wall time.                                                                              |
| Replay Clock                  | Clock that steps through a known timestamp sequence for repeatable replay.                                                                                                |
| Clock Quality                 | Assessment of clock trust based on provenance and wall-clock versus monotonic behavior.                                                                                   |
| IANA Timezone                 | Canonical timezone identifier such as `America/New_York`; abbreviations such as `EST` are not accepted as authoritative identifiers.                                      |
| Deterministic Scheduler       | Clock-driven scheduler that runs due tasks in stable due-time, priority and sequence order.                                                                               |
| Freshness                     | Classification of observed data age relative to the authoritative clock, such as fresh, stale, expired or future-skewed.                                                  |
| Configuration Domain          | Category of what is configured, such as SYSTEM, DATA, RISK or EXECUTION; not the same as scope.                                                                           |
| Configuration Scope           | Explicit location where a configuration entry applies, such as SYSTEM, ENVIRONMENT:PAPER or INSTRUMENT:FX:EURUSD.                                                         |
| Configuration Context         | Multidimensional request context used to select applicable configuration scopes.                                                                                          |
| Effective Configuration       | Immutable resolved configuration for one context and snapshot.                                                                                                            |
| Configuration Provenance      | Explanation of which source/scope supplied a value, what was considered, what was overridden and why the winner won.                                                      |
| Configuration Snapshot        | Immutable coherent configuration view produced by source loading and atomic publication.                                                                                  |
| Configuration Fingerprint     | Deterministic semantic identity for a configuration snapshot or effective configuration.                                                                                  |
| Bootstrap Configuration       | Minimal startup configuration needed before the managed configuration authority is available.                                                                             |
| Configuration Schema          | Prompt 8 contract for a configuration key, including value type, constraints, dependencies, conditionals, cross-field rules and help metadata.                            |
| Schema Fingerprint            | Deterministic semantic identity for a set of configuration schemas.                                                                                                       |
| Validation Report             | Safe Prompt 8 report describing schema, source-entry, constraint, dependency, cross-field or effective-configuration validation issues.                                   |
| Publication Gate              | Runtime validation boundary that blocks a candidate configuration snapshot from becoming active when blocking issues are present.                                         |
| Configuration Constraint      | Declared type, enum, range, unit, object, list or secret-reference rule that a configuration value must satisfy.                                                          |
| Configuration Dependency Rule | Declarative relationship requiring or restricting one setting based on another setting.                                                                                   |
| Configuration Version         | Prompt 9 immutable historical record for one configuration state/change in a version stream.                                                                              |
| Configuration Version ID      | Stable identity of one immutable configuration version record; not interchangeable with a content fingerprint.                                                            |
| Version Stream                | Runtime-mode scoped sequence of configuration versions, such as `configuration.simulation.default`.                                                                       |
| Current Version Pointer       | Mutable pointer identifying the latest version in a stream; separate from immutable version records.                                                                      |
| Change Set                    | Structured operations that produced a configuration version, such as added, modified or removed entries.                                                                  |
| Configuration Diff            | Directional machine-readable comparison from one configuration version to another.                                                                                        |
| Version Lineage               | Parent/root/ancestor relationships connecting immutable configuration versions.                                                                                           |
| Historical Reconstruction     | Read-only rebuilding of the canonical configuration represented by a historical version.                                                                                  |
| Capability Registry           | Prompt 10 build-truth catalog of implemented and explicitly unimplemented capabilities, dependencies, conflicts and runtime-mode scope.                                   |
| Feature Flag                  | Managed boolean configuration key that requests an optional implemented capability; it cannot implement future functionality by itself.                                   |
| Effective Capability          | Deterministic Prompt 10 result for one capability, including enabled/disabled/unavailable/blocked/degraded state, reason codes and provenance.                            |
| Capability Snapshot           | Immutable Prompt 10 view of all effective capabilities and feature flags for one configuration snapshot/runtime mode.                                                     |
| Pending Restart               | Capability-control state showing that desired configuration differs from applied state for a restart-required flag.                                                       |
| Maker                         | Actor that proposed/created an immutable configuration version.                                                                                                           |
| Checker                       | Independent actor authorized to review an approval-required configuration version.                                                                                        |
| Approval Request              | Prompt 11 immutable review request bound to one configuration version and semantic fingerprints.                                                                          |
| Approval Decision             | Prompt 11 immutable approve/reject evidence from an authorized checker.                                                                                                   |
| Approval Eligibility          | Current Prompt 11 result showing whether a version satisfies governance requirements.                                                                                     |
| Proposed Configuration        | Validated/versioned configuration candidate that is not yet applied because governance or later promotion gates are unsatisfied.                                          |
| Promotion Request             | Prompt 12 immutable request to move an exact source configuration version toward a destination environment.                                                               |
| Promotion Plan                | Deterministic Prompt 12 explanation of destination validation, diff, capabilities, approvals, drift and restart impact before activation.                                 |
| Active Release State          | Prompt 12 authoritative active configuration pointer and fingerprints for one governed environment.                                                                       |
| Known-Good Configuration      | Prompt 12 verified active release eligible as an exact rollback target.                                                                                                   |
| Rollback Request              | Prompt 12 immutable request to restore an exact known-good configuration without rewriting history.                                                                       |

## Identifier conventions

Future entities should use stable identifiers rather than mutable names.

Recommended names:

- `instrument_id`
- `account_id`
- `strategy_id`
- `candidate_id`
- `decision_id`
- `execution_id`
- `position_id`
- `trade_id`
- `dataset_id`
- `experiment_id`
- `configuration_version_id`
- `correlation_id`

Rules:

1. Identifiers should be stable for the entity lifecycle.
2. Human-readable names may change and must not be primary references.
3. External/broker identifiers must be stored separately from ATE identifiers.
4. Correlation IDs should connect related commands, events, logs, and audit records.
5. Idempotency keys must be explicit for capital-bearing commands when implemented.
