# ADR-0005: MT5 as Adapter Boundary

## Status

Accepted

## Context

MetaTrader 5 is the initial execution ecosystem, but ATE must remain a broker-neutral autonomous
platform whose intelligence lives outside the EA.

## Decision

MT5 is treated as an adapter boundary:

```text
ATE CORE
EXECUTION PORT
MT5 ADAPTER / GATEWAY
CONNECTOR EA
MT5 TERMINAL
BROKER
```

The Connector EA should remain lightweight and execution/data focused.

## Alternatives Considered

- Embed strategy/risk intelligence in MQL5: rejected because it couples ATE to MT5 and weakens
  research/governance.
- Ignore MT5 constraints until late: rejected because Windows VPS and broker specifications affect
  architecture.

## Consequences

- Core contracts must be broker/platform neutral.
- Broker specifications must be discovered and validated.
- MT5 code belongs in adapter/gateway boundaries, not domain logic.

## Security Impact

Broker/MT5 credentials must never be committed or exposed. Connector communication must be designed
securely when implemented.

## Operational Impact

Execution nodes may run on Windows VPS with one or more MT5 terminals.

## Reversibility

Moderate. Adapter boundaries allow additional execution platforms later.
