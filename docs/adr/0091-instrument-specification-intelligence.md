# ADR-0091 — Derived offline instrument specification intelligence

Status: implemented for independent review; governance acceptance pending.

## Decision and ownership

Use a separate `@ate/instrument-specifications` package. Contract declarations, validation rules,
completeness profiles and immutable specification revisions cannot cleanly live in the canonical
identity registry, raw broker catalogue or identity-mapping engine without mixing authorities. P20
retains economic identity and canonical revisions. P21 retains raw source observations,
normalization and maker/checker decisions. P22 retains mapping qualification. P23 consumes their
public read interfaces and never writes them. A qualified identity is not contract equivalence.

Use the existing P6 Clock, P7–12 effective configuration and schema registries, P5 state ownership
and mutation validation, and P18 CalendarBoundaryResolver. State domain/owner
`instrument.specifications` is DERIVED, durable, history/reconciliation required, RESEARCH only. No
parallel clock, calendar, identity, approval, event or executable-permission authority is added.

## Evidence and exactness

Each bounded immutable request binds an exact P22 mapping set and mapping fingerprint. Resolve its
real canonical revision and source namespace/catalogue/observation via P20/P22 public interfaces.
Only UNIQUE_QUALIFIED_CANDIDATE mappings with an actual target may support a specification. Current
admission checks P22's current qualification; recovery reconstructs the exact retained historical
mapping, without silently substituting its latest source. Mapping/source changes are explicit
current reconciliation fences. Historical policy/configuration incompatibility fails closed.

Fields retain DECLARED, ABSENT, UNKNOWN, UNSUPPORTED or CONTRADICTORY states and provenance. No
absent broker value is filled in. Exact bounded decimal strings normalize through BigInt at 18
fractional places; no floating-point monetary identity. Raw request evidence is retained beside
normalized fields. Financial exponent/fractional quotation conventions outside the supported decimal
contract are rejected or explicitly UNSUPPORTED, never guessed. Canonical JSON fingerprints identify
parsed evidence, not a cryptographic broker signature or every physical JSON lexeme.

## Publication and lifecycle

Immutable version lineage binds the original request, policy, configuration, calendar context,
canonical/source identities, evaluation time and clock provenance. Validate bounds and P5 mutation
authority before calling storage. Only an exact full-body generation acknowledgement permits local
publication. UNKNOWN, thrown/malformed or wrong acknowledgements retain the original obligation,
NOT_READY/DEGRADED and failed repeated shutdown. Honest NONE permits retry. Reentrant operations
cannot acquire publication authority. Recovery rebuilds every derived result rather than trusting
rehashed conclusions. Historical prefixes cannot be overwritten.

Memory and filesystem repositories implement the same contract. Filesystem publication uses
exclusive pending creation, immutable hard-link publication, pending unlink and readback; rejects
unexpected files, pending artifacts, gaps, symlinks, oversized or corrupt generations. Trusted root,
trusted ancestors, single writer and honest terminating repositories/owners remain mandatory.
ACK/readback is not fsync or physical power-loss durability. No root migration is implicit.

## Scope and consequences

Bounded offline research only. Session calendars reuse the accepted explicit/calendar semantics;
free-form weekly declarations are retained as UNSUPPORTED interpretations unless accompanied by an
accepted calendar. Fixed-amount margin declarations are internally compared; other calculation modes
remain unsupported. No exchange rates or unit conversion is invented: compare like units, report
incompatible or unsupported semantics otherwise. No execution suitability, tradability, margin
sufficiency, sizing, profitability ranking, live broker/MT5 or production authority.

All accepted P20–22 qualifications and historical failures remain in force. P23 improves evidence
inspection; it does not retroactively pass B003 or B005 or erase Q-TICK/A22-Q04. Independent
technical review and a separate owner governance decision remain required. Prompt24 is not
authorized.
