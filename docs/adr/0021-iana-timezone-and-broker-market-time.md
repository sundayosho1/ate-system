# 0021 — IANA Timezone and Broker/Market Time

## Status

Accepted.

## Context

ATE will eventually receive broker, provider and market-local times. Timezone abbreviations such as
`EST` or `CST` are ambiguous, and daylight saving transitions create nonexistent and duplicated
local timestamps.

## Decision

Use UTC instants as the canonical persisted form. Convert local time using IANA timezone IDs. Reject
timezone abbreviations and detect ambiguous or nonexistent local times. Broker and market time are
modeled as profiles with explicit timezone, fixed-offset and provenance fields only; Prompt 6 does
not implement market calendars or sessions.

## Alternatives Considered

- Persist local broker timestamps as authoritative values. Rejected because offset rules can change
  and ambiguity would leak into downstream systems.
- Implement full market calendars now. Rejected because sessions and holidays are outside Prompt 6.

## Consequences

Consumers must preserve source/provenance when converting external time to canonical UTC.

## Security Impact

Explicit timezone validation reduces spoofing and operator confusion in audit records.

## Operational Impact

Help content can guide operators through timezone and DST failures.

## Reversibility

Future calendar services can build on the same UTC/IANA boundary.
