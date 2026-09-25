# ADR-0001: Modular Monolith with Ports and Adapters

## Status

Accepted

## Context

ATE must eventually support many domains: configuration, market data, instrument registry, MOSE,
market intelligence, strategies, risk, portfolio, capital protection, execution, MT5 integration,
reconciliation, research, and frontend operations. Prompt 1 must establish boundaries without
prematurely building future services.

## Decision

ATE will initially use a modular monolith architecture with strong domain boundaries, clean
architecture principles, ports/adapters, dependency inversion, and event-driven integration where
appropriate.

Selected components may later become separate workers/services when operational or scaling evidence
justifies separation.

## Alternatives Considered

- Immediate microservices: rejected as premature operational complexity.
- Single unstructured application: rejected because it risks duplicate authorities and tight
  coupling.
- MT5-centric Expert Advisor architecture: rejected because ATE Core must hold the primary
  intelligence.

## Consequences

- Clear package/module boundaries are required.
- Core domain logic remains testable and infrastructure-independent.
- Future service extraction remains possible.

## Security Impact

Security-sensitive boundaries can be centralized and audited before being exposed through adapters.

## Operational Impact

Initial deployment remains simpler than distributed microservices while preserving future
worker/service options.

## Reversibility

Moderate. Well-maintained boundaries make future extraction feasible.
