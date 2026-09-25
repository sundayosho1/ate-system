# 0018 — Canonical Clock and UTC Authority

## Status

Accepted.

## Context

ATE workflows need one authoritative source for timestamps used in events, persistence records,
diagnostics, audit evidence and runtime readiness. Direct use of ambient wall-clock APIs across
business modules would make tests non-deterministic and could create contradictory timelines.

## Decision

Introduce `@ate/time` as the temporal authority package. Canonical instants are normalized UTC
timestamps, created through explicit clock implementations or parsing helpers. Runtime, event and
persistence integrations consume injected clocks rather than discovering current time themselves.

## Alternatives Considered

- Let each package call `Date.now()` or `new Date()` directly. Rejected because it fragments
  authority and makes replay/simulation hard.
- Store local timestamps. Rejected because offsets and daylight saving transitions are ambiguous.

## Consequences

Code that needs "now" must receive a clock. Tests can pin time with virtual clocks.

## Security Impact

Temporal provenance improves audit evidence and reduces spoofed or unexplained timestamps.

## Operational Impact

Operators can inspect clock mode, source, quality and scheduler state through diagnostics.

## Reversibility

The package is a narrow boundary. Implementations can be replaced if exported contracts remain
stable.
