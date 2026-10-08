# ADR-0075 — Real-Time Temporal and Sequence Semantics

## Status

Proposed for independent Prompt 17 review

## Decision

Reuse Prompt 6 clocks/scheduler and Prompt 13 contracts. Preserve independent event/source, receive
and processing timestamps; separate local ingress from provider per-subscription/session sequence.

## Consequences

Late data can be accepted with warning. Consecutive numbering is used only when explicitly declared;
opaque identities never imply missing data. No missing timestamp is fabricated.
