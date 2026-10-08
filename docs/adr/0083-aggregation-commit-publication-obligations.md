# ADR-0083: Commit publication and recovery obligations

Status: Accepted for implementation; independent Prompt 18 acceptance pending.

Date: 2026-10-08

## Context

Prompt 18 extends the conditionally accepted Prompt 17 offline research foundation.

## Decision

Content and publication are separate bounded synchronous steps. Only pre-mutation certification
proves no commitment. Unknown and committed failures retain operation obligations outside diagnostic
buffers. Repeated stop cannot conceal failure. Trusted single-writer roots are mandatory.

## Consequences

Policies and operation evidence must be retained. Resource failures are structured and observable.
No production, broker or trading authority is added. See
[aggregation help](../help/multi-timeframe-aggregation.md).

## CODEX-003B capacity correction

Capacity is measured in distinct immutable operation IDs. Each slot reserves its content,
publication marker and two temporary paths. The same inventory contract governs admission,
publication and recovery; registration consumes a slot, and marker creation does not consume an
extra slot.

Exactly-full stores recover at unchanged limits. New work rejects before mutation with truthful
no-commit evidence. Unknown/orphan/oversized artifacts and incompatible lower limits fail closed
without deletion. Post-write failure retains unknown/committed obligations; repeated shutdown cannot
conceal them. A failed continuity-fence persistence also fails runtime health even if that attempted
fence was certified uncommitted. Trusted single-writer and durability restrictions remain mandatory.
