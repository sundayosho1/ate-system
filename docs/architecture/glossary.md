# Glossary

This glossary defines canonical ATE terminology. Future prompts should use these terms consistently.

| Term                  | Definition                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ATE                   | Autonomous Trading Engine; the overall platform.                                                                                                                          |
| MOSE                  | Market Opportunity Surveillance Engine; future subsystem that observes approved markets and promotes developing opportunities through surveillance states.                |
| Instrument            | A tradable market concept independent of broker naming.                                                                                                                   |
| Broker Symbol         | Broker/platform-specific symbol string, such as `EURUSD.a`.                                                                                                               |
| Canonical Instrument  | ATE's normalized instrument identity, such as `FX:EURUSD`.                                                                                                                |
| Trading Universe      | All instruments known or potentially available to ATE.                                                                                                                    |
| Approved Universe     | Instruments explicitly authorized for deeper observation or research/trading according to lifecycle state.                                                                |
| Active Universe       | Approved instruments currently enabled for active processing in a runtime mode.                                                                                           |
| Market Observation    | Raw or normalized data point observed from a provider/broker.                                                                                                             |
| Market Snapshot       | Point-in-time view of relevant market state.                                                                                                                              |
| Market Intelligence   | Reusable interpretation of market structure, volatility, momentum, session, spread, and context.                                                                          |
| Regime                | Market classification such as `TREND`, `RANGE`, `BREAKOUT`, `HIGH_VOLATILITY`, `LOW_VOLATILITY`, `ABNORMAL`, or `UNCERTAIN`.                                              |
| Strategy              | A bounded candidate-generation method. Strategies do not place broker orders.                                                                                             |
| Setup                 | Market condition pattern that may develop into a candidate.                                                                                                               |
| Candidate             | Standardized potential trade idea produced by a strategy for evaluation.                                                                                                  |
| Signal Score          | Quantitative assessment of candidate quality; not a guaranteed win probability unless calibrated and justified.                                                           |
| Opportunity           | Developing or qualified market condition tracked through a lifecycle.                                                                                                     |
| Master Trade Decision | Canonical decision that may later be allocated to eligible accounts after required checks.                                                                                |
| Risk Approval         | Deterministic risk authorization for a candidate/decision; risk may veto.                                                                                                 |
| Account Allocation    | Account-specific execution planning based on account mandate, equity, margin, eligibility, exposure, broker specs, and protection state.                                  |
| Execution Instruction | Broker-neutral instruction generated after all required approvals.                                                                                                        |
| Order                 | Broker/platform order request or accepted order representation.                                                                                                           |
| Position              | Open market exposure observed or tracked for an account.                                                                                                                  |
| Trade                 | Completed or lifecycle-managed trading activity with entry, management, exit, and outcome context.                                                                        |
| Portfolio             | Aggregate exposure and risk context across accounts, instruments, strategies, and asset classes.                                                                          |
| Account Mandate       | Account-specific permissions, limits, and operating constraints.                                                                                                          |
| Protection State      | Capital protection state such as `NORMAL`, `CAUTION`, `REDUCED_RISK`, `DEFENSIVE`, `NO_NEW_TRADES`, `PROTECTED`, or `HALTED`.                                             |
| Execution Node        | Runtime environment responsible for execution-facing operations, potentially colocated with MT5 terminals.                                                                |
| MT5 Gateway           | Adapter/service boundary between ATE execution contracts and MT5 Connector EA/terminal communication.                                                                     |
| Connector EA          | Lightweight MetaTrader 5 Expert Advisor responsible for connectivity, state forwarding, instruction receipt, order submission, confirmations, and reconciliation support. |
| Reconciliation        | Process of comparing ATE internal state with externally observable MT5/broker state.                                                                                      |
| Dataset               | Versioned collection of data used for research, backtesting, or analysis.                                                                                                 |
| Experiment            | Controlled research activity with code, data, configuration, and parameters.                                                                                              |
| Backtest              | Deterministic historical evaluation against versioned data and configuration.                                                                                             |
| Simulation            | Non-capital-bearing operation against simulated or replayed conditions.                                                                                                   |
| Paper                 | Non-capital-bearing forward operation against current/near-current market conditions where supported.                                                                     |
| Live                  | Capital-bearing operation.                                                                                                                                                |
| NO_ACTION             | Valid decision indicating no justified exposure or action should occur.                                                                                                   |

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
