# ADR 0089 — Offline broker symbol catalogue and research mappings

Status: IMPLEMENTED — pending independent technical audit and governance acceptance. CODEX-006,
Prompt 21. Baseline `8d8f29ae7c69943f7d9542e29bde9323ed96b266`.

## Decision

Add `@ate/broker-symbol-catalogue` as a derived research owner, registered explicitly through the
existing persistence state-authority registry. Broker namespace, terminal fixture and catalogue
source identifiers establish observation context, not authenticated broker or live session identity.
Raw decimal spelling, source declarations and missing fields remain intact. B1 comparison rules
reuse N1 exact/case normalization once, with a bounded governed suffix removal and fixed-key check.
No economic identity is derived from the symbol key. Catalogue input order is canonically sorted;
publication history preserves governed input, clock provenance and immutable full fingerprints.

P20 public snapshot history is replayed into P20's own read-only resolver to qualify historical
proposal evidence. We do not copy its economic resolver or allow P21 writes to canonical identity.
Name-only matches cannot receive research association approval. Scoped identifiers supply distinct
economic claim evidence; explicit checker approval, actual candidate membership, maker-checker
separation and nonconflicting/current evidence are required. These are research claims, never
financial or present-availability authorization. Approval uses the existing configuration authority
resolver. Catalogue changes, registry changes and source age fence new association and expose
staleness without modifying prior decisions. All caller-owned artifacts retain their original
hashes.

Immutable repository publication/readback acknowledgements advance derived state. Unknown outcomes
fence the service; no successful repeated shutdown conceals a recovery obligation. A fresh instance
validates the complete retained chain, input-derived observations, actual P20 resolution evidence
and decision certificates. Partial roots, generation gaps, edited/rehashed semantics and
incompatible governance fail closed. This is the existing trusted-root/single-writer pattern, not a
new global commitment, event, identity or clock authority. Terminating trusted owners and honest
certificates remain required. There is no migration, repair deletion, fsync certification or
historical membership registry. Explicit limits reject excess state rather than silently evicting
evidence.

## Qualification

Bounded offline research only. F05 Windows/open-handle/filesystem and F06 production throughput,
power-loss durability remain unqualified. T01, M02, O-C01/O-C02 and Q01-A remain unchanged. Runtime
Unicode behavior is qualified with the tested Node runtime. `EVIDENCED` source claims require a
trusted verifier port and applicable governance; no verifier or cryptographic broker attestation is
invented. Historical presence, visibility and trade mode do not establish availability now.

No network imports, live discovery, broker login/account, orders or trading are supported. No
production or financial deployment approval. Prompt 22 requires separate authorization.

## CODEX-006B corrective successor

A21-M01 applies the existing declared-family/raw/key catalogue inspection semantics consistently
across all query kinds before pagination. Historical predicates use each root's retained catalogues,
never later membership. Mapping predicates inspect the exact source observation; canonical economic
classification remains the Prompt 20 owner's separate authority. No immutable history is rewritten.

A21-M02 qualifies the owner's checkedAt between observations bracketing synchronous resolution, with
stable validated clock provenance. That actual checkedAt remains decidedAt, preserving stored
schema/recovery compatibility without a tolerance window. The accepted evidence type has no expiry
interval, issuance timestamp, signature or caller-selected evaluation time. Strict shape, actor,
checker authority, authorization, maker separation, chronology and current context remain required.
Clock/proposal/registry eligibility is checked again after the callback; exact ACK/UNKNOWN fencing
is unchanged. Trusted honest owners are required; no new historical membership authority or stronger
source-authenticity claim is introduced. See the help appendix and new deterministic regressions.

This is corrective implementation, not conditional acceptance. All prior operational qualifications
and CODEX-006A historical failed assertions remain preserved outside the checkout.
