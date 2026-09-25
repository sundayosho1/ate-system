# Safety Invariants

These invariants are mandatory architecture constraints. Future implementation must preserve them
unless an explicit approved ADR supersedes a rule.

## INV-001 — Fail Closed

When safety-critical state is unknown, unavailable, stale, contradictory, or untrusted, ATE should
reject new exposure rather than assume safety.

## INV-002 — No Direct Strategy Execution

Strategies generate candidates. They do not place broker orders or directly create execution
instructions.

## INV-003 — Risk Veto

Risk can reject any candidate or decision regardless of strategy quality.

## INV-004 — Protection Supremacy

Capital Protection can reject, reduce, suspend, protect, or halt activity regardless of strategy or
portfolio preference.

## INV-005 — Account Mandate Supremacy

No trade may violate account-specific permissions, restrictions, or risk mandates.

## INV-006 — Explicit Live Eligibility

Research, backtest, simulation, or paper capability does not imply live eligibility.

## INV-007 — Environment Isolation

Research, backtest, simulation, paper, and live execution must remain explicitly separated.

## INV-008 — No Silent Self-Modification

Learning components may not silently modify production trading, strategy, risk, or protection
configuration.

## INV-009 — Idempotent Capital-Bearing Commands

Capital-bearing execution commands must ultimately use stable identities and duplicate-prevention
semantics.

## INV-010 — Reconciliation Required

ATE must never assume external execution state indefinitely without reconciliation against
observable broker/MT5 state.

## INV-011 — No Embedded Secrets

Secrets must not exist in committed source code, templates, logs, tests, or documentation.

## INV-012 — Auditable Sensitive Actions

Sensitive state changes must eventually be attributable to a human or system actor with time,
reason, previous state, new state, and correlation identity.

## INV-013 — Deterministic Risk Logic

Risk-critical calculations must be reproducible for a given input, code version, configuration
version, and data snapshot.

## INV-014 — No Floating-Point Casualness

Financial calculations requiring deterministic decimal behavior must use explicit precision and
rounding rules.

## INV-015 — Data Health Before Decision

Unhealthy, insufficient, stale, malformed, or contradictory data must be capable of preventing
candidate generation, approval, or execution.

## INV-016 — NO_ACTION Is Valid

No system component may require a trade merely because the market is open or a strategy exists.

## INV-017 — Configuration Validation

Invalid configuration must not silently activate.

## INV-018 — Broker Specifications Are Authoritative

ATE must not hard-code assumptions about tick size, point size, tick value, volume limits, volume
step, margin, trading sessions, contract size, or broker restrictions.

## INV-019 — External Intelligence Is Non-Authoritative

News, sentiment, macro feeds, and external analytics cannot override deterministic safety controls.

## INV-020 — Production Changes Are Versioned

Sensitive production configuration and strategy changes must eventually be versioned and auditable.

## INV-021 — Capability Truthfulness

Documentation, APIs, manifests, and UI must not imply capabilities that have not been implemented
and verified.

## INV-022 — No Duplicate Authorities

ATE must avoid competing sources of truth for accounts, positions, orders, market data
normalization, clocks, risk state, configuration, audit, and protection state.

## Prompt 6 temporal invariants

These invariants specialize the general safety rules for time authority.

## TIME-001 — Single Runtime Clock Authority

Each runtime must have one selected clock authority for current UTC instants.

## TIME-002 — UTC Durable Evidence

Durable event, state, audit, outbox, inbox and dead-letter evidence must use UTC instants.

## TIME-003 — Naive Timestamps Rejected

Timestamp input that lacks `Z` or an explicit offset must not become canonical evidence.

## TIME-004 — Monotonic Durations

Elapsed-duration logic must use monotonic time where clock jumps could affect correctness.

## TIME-005 — No Test Clocks In Live Mode

`LIVE` runtime mode must reject virtual, simulation and replay clocks.

## TIME-006 — Explicit Clock Mode

Clock mode must be explicit and visible in diagnostics.

## TIME-007 — Clock Provenance Required

Clock outputs must include a known source/provenance model at the clock boundary.

## TIME-008 — Backward Clock Movement Degrades Trust

Backward wall-clock movement must be detected and treated as untrusted temporal state.

## TIME-009 — Large Clock Jumps Are Visible

Large wall-clock jumps must be reported through clock-quality diagnostics.

## TIME-010 — IANA Timezones Only

Local timezone conversion must use IANA timezone IDs, not abbreviations.

## TIME-011 — DST Ambiguity Is Explicit

Nonexistent or ambiguous local times must return explicit errors instead of silent guesses.

## TIME-012 — Broker Time Is Not Canonical By Default

Broker/server time must carry provenance and conversion context before it can influence canonical
UTC evidence.

## TIME-013 — Market Time Does Not Imply Sessions

Timezone support does not imply market calendar, holiday or trading-session implementation.

## TIME-014 — Freshness Is Clock Relative

Freshness classification must be relative to the selected clock authority and include future-skew
protection.

## TIME-015 — Deterministic Scheduling

Scheduled work must have stable ordering by due time, priority and sequence when running under the
deterministic scheduler.

## TIME-016 — Bounded Timers

Schedulers and timer queues must be bounded and fail visibly on capacity exhaustion.

## TIME-017 — Replay Time Cannot Regress During Playback

Replay stepping must not move backward except through an explicit reset before rerun.

## TIME-018 — Time Readiness Is Not Trading Authority

Healthy time service readiness does not authorize market data ingestion, strategy execution, broker
order submission or live trading.

## Prompt 7 configuration invariants

These invariants specialize the general safety rules for managed configuration.

## CFG-001 — Single Configuration Authority

Managed configuration has one authoritative control plane.

## CFG-002 — Deterministic Resolution

Identical inputs must produce equivalent effective configuration.

## CFG-003 — Explicit Scope

Overrides must declare explicit scope.

## CFG-004 — Explicit Precedence

Precedence is policy, not insertion order.

## CFG-005 — Conflict Fails Closed

Unresolved equal-precedence conflicts are never silently selected.

## CFG-006 — Provenance Required

Every effective value can explain its source, scope and override chain.

## CFG-007 — Atomic Publication

Consumers never observe partially applied snapshots.

## CFG-008 — Immutable Effective Snapshot

Published snapshots and effective configurations are immutable.

## CFG-009 — Environment Isolation

Research, backtest or simulation configuration cannot silently contaminate live operation.

## CFG-010 — Secrets Excluded

Secret material is not ordinary configuration.

## CFG-011 — Unknown Keys Rejected

Unknown authoritative configuration does not silently become active.

## CFG-012 — Safe Missing-Value Semantics

Missing values never produce undocumented permissive behavior.

## CFG-013 — Configuration Cannot Override Safety Constitution

Configuration operates within permanent safety invariants.

## CFG-014 — Cache Is Non-Authoritative

Cache accelerates resolution but never owns configuration.

## CFG-015 — Snapshot Identity

Effective configuration has deterministic snapshot/fingerprint identity.

## CFG-016 — No Silent Last-Write-Wins

Conflicts are resolved by policy or rejected.

## CFG-017 — No Arbitrary Code Execution

Configuration cannot execute code.

## CFG-018 — Bootstrap Is Minimal

Bootstrap configuration remains separate and intentionally small.

## CFG-019 — Runtime Context Is Explicit

Resolution never relies on hidden mutable operational context.

## CFG-020 — Failed Candidate Is Never Partially Published

Invalid refreshes leave active configuration coherent where policy permits continued operation.

## Prompt 8 configuration schema invariants

These invariants specialize managed configuration validation.

## CFG-021 — Schema Authority Is Central

Configuration schemas are owned by the configuration authority, not by scattered business modules.

## CFG-022 — Schema Defaults Self-Validate

A default value is not admissible unless it satisfies its own schema.

## CFG-023 — Types Are Enforced Before Activation

Value type metadata must be enforced before a value becomes active.

## CFG-024 — Units Are Explicit

Durations, counts, percentages and other bounded quantities must document their unit.

## CFG-025 — Ranges Are Explicit

Minimums and maximums must be declared for bounded safety-relevant values.

## CFG-026 — Enums Are Closed

Enumerated configuration values must reject unknown strings.

## CFG-027 — Object Shape Is Declared

Structured configuration must declare required properties where behavior depends on them.

## CFG-028 — Dependency Rules Are Declarative

Configuration dependencies must be declared as data, not executable code.

## CFG-029 — Conditional Rules Are Visible

Contextual requirements must be visible in schema metadata and validation reports.

## CFG-030 — Mutual Exclusions Fail Closed

Mutually exclusive settings must not both become active.

## CFG-031 — Cross-Field Rules Are Deterministic

Cross-field validation must use deterministic built-in rule identifiers.

## CFG-032 — Validation Reports Are Safe

Validation reports must not expose secret material or raw sensitive values.

## CFG-033 — Validation Phases Are Stable

Validation reports must identify the phase where an issue occurred.

## CFG-034 — Blocking Issues Prevent Publication

Errors and critical validation issues must block candidate publication.

## CFG-035 — Effective Configuration Is Validated

Resolved effective configuration must be validated before being treated as consumable.

## CFG-036 — Schema Fingerprints Are Deterministic

Equivalent schemas must produce equivalent semantic fingerprints.

## CFG-037 — Runtime Context Must Match Runtime Configuration

The effective runtime-mode configuration must not contradict the resolution context.

## CFG-038 — Secret References Are Typed

Secret references are only valid where the schema permits secret references.

## CFG-039 — Invalid Resolution Is Not Cached

An effective configuration with blocking validation issues must not be inserted into the cache.

## CFG-040 — Schema Validation Is Not Version Lifecycle

Schema validation does not imply configuration approval, promotion, rollback or history.

## Prompt 9 configuration version-history invariants

These invariants specialize immutable managed configuration history.

## CFG-041 — Every Authoritative Change Is Versioned

Authoritative managed configuration changes cannot bypass immutable version history.

## CFG-042 — Configuration Versions Are Immutable

Historical semantic version records are never edited in place.

## CFG-043 — History Is Append-Only

Configuration history grows through new records rather than rewriting old records.

## CFG-044 — Version Attribution Is Required

Every authoritative configuration version has attributable origin.

## CFG-045 — Parentage Is Explicit

Every non-root version identifies its historical predecessor.

## CFG-046 — Version Lineage Is Acyclic

Configuration version history cannot contain cycles.

## CFG-047 — Version Content Is Reconstructable

Historical configuration can be deterministically reconstructed.

## CFG-048 — Historical Fingerprints Are Verifiable

Reconstructed historical configuration must match its recorded semantic fingerprint.

## CFG-049 — Current State and History Must Agree

Current configuration cannot claim a version inconsistent with its semantic content.

## CFG-050 — Stale Writers Cannot Silently Win

Version creation uses explicit concurrency authority.

## CFG-051 — Version Order Is Not Timestamp Authority

Historical succession is determined by version lineage/concurrency semantics, not wall-clock
ordering.

## CFG-052 — Reversal Never Rewrites History

Returning to earlier semantic configuration creates a new historical fact.

## CFG-053 — Reconstruction Is Not Rollback

Historical reconstruction cannot itself activate configuration.

## CFG-054 — Attribution Is Not Approval

Creator identity never implies maker-checker approval.

## CFG-055 — Historical Schema Identity Is Preserved

Versions retain the schema fingerprint under which they were validated.

## CFG-056 — Sensitive History Is Redacted

Version history never exposes secret material.

## CFG-057 — History Queries Are Bounded

Version history cannot be consumed through unbounded reads.

## CFG-058 — Version Creation Is Atomic

A durable configuration transition cannot leave current state and version history inconsistent.

## CFG-059 — Invalid Configuration Cannot Become a Versioned Authority

Prompt 8 blocking validation prevents authoritative version creation/publication.

## CFG-060 — History Recovery Cannot Rewrite History

Restart/recovery may rebuild derived state but never mutate historical facts.

## Prompt 10 feature-flag and capability-control invariants

These invariants specialize managed configuration for runtime capability enablement.

## CFG-061 — Capability Registry Is Build Truth

Runtime flags cannot make an unimplemented capability implemented.

## CFG-062 — Feature Flags Use Configuration Authority

Feature flags must be declared configuration keys resolved by the managed configuration authority.

## CFG-063 — No Second Configuration Engine

Feature flags cannot become an ad hoc parallel settings store.

## CFG-064 — Mandatory Core Cannot Be Flag-Disabled

Constitutional/control-plane safety capabilities cannot be controlled by ordinary feature flags.

## CFG-065 — Capability States Are Explicit

Enabled, disabled, unavailable, blocked and degraded states must be distinguishable.

## CFG-066 — Capability Reasons Are Stable

Capability decisions must expose stable reason codes suitable for diagnostics and tests.

## CFG-067 — Dependency Gating Fails Closed

Unavailable, disabled or blocked dependencies cannot silently enable dependants.

## CFG-068 — Capability Dependency Graph Is Acyclic

Capability dependencies must not contain cycles.

## CFG-069 — Runtime Mode Gates Are Enforced

A capability unavailable for the current runtime mode must be blocked.

## CFG-070 — Service Readiness Is Not Configuration

Runtime health/readiness can degrade capability state but must not mutate configuration truth.

## CFG-071 — Restart-Required Changes Are Visible

Restart-required feature changes must expose pending-restart state before becoming applied state.

## CFG-072 — Capability Snapshots Are Immutable

Effective capability snapshots must be immutable once published.

## CFG-073 — Capability Snapshot Identity Is Deterministic

Equivalent capability inputs must produce equivalent semantic fingerprints.

## CFG-074 — Capability Provenance References Configuration

Effective capability state must reference the configuration snapshot and available version/schema
fingerprints that produced it.

## CFG-075 — Capability Events Are Safe

Capability events must not expose raw configuration values, secrets or sensitive material.

## CFG-076 — Capability Control Is Not Approval

Flag enablement cannot imply maker-checker approval or authorization.

## CFG-077 — Capability Control Is Not Promotion or Rollback

Flag evaluation cannot activate configuration promotion or operational rollback workflows.

## CFG-078 — Capability Control Is Not Random Rollout

Prompt 10 does not provide user targeting, percentages or randomized rollout behavior.

## CFG-079 — Future Trading Capabilities Stay Unavailable

Market data, MT5, execution and live trading remain unavailable until their implementation prompts
complete and verify them.

## CFG-080 — Capability Diagnostics Must Be Truthful

Docs, manifests, diagnostics and tests must not imply capabilities beyond the verified build.

## Prompt 11 maker-checker approval invariants

These invariants specialize managed configuration governance.

## CFG-081 — Sensitive Changes Require Independent Approval

A configuration change classified as approval-required cannot become governance eligible without
required independent checker approval.

## CFG-082 — Maker Cannot Check Own Sensitive Change

The maker cannot satisfy checker requirements for their own approval-required version.

## CFG-083 — Approval Binds to Exact Version

Approval cannot float between configuration versions.

## CFG-084 — Approval Binds to Exact Content

Configuration, change-set, schema and policy identities must match approval evidence.

## CFG-085 — Validation Precedes Approval

Invalid configuration cannot be approved into validity.

## CFG-086 — Approval Cannot Override Constitutional Safety

Governance authorization remains subordinate to permanent safety authority.

## CFG-087 — Approval Decisions Are Immutable

Historical approval/rejection decisions cannot be edited in place.

## CFG-088 — Approval History Is Append-Only

Revocation and reapproval create new governance evidence rather than rewriting history.

## CFG-089 — Checker Authority Fails Closed

Unverifiable checker authority cannot satisfy approval.

## CFG-090 — Approval Policy Cannot Self-Downgrade

A candidate change cannot weaken the policy used to determine its own approval requirement.

## CFG-091 — Governance Policy Changes Are Governed

Changes weakening or changing approval authority cannot bypass existing governance.

## CFG-092 — Expired Approval Is Not Valid Approval

Expired evidence cannot satisfy a current approval gate.

## CFG-093 — Revoked Approval Is Not Valid Approval

Revoked evidence cannot satisfy a current approval gate.

## CFG-094 — Rejected Version Remains Historical

Rejection cannot delete or rewrite configuration history.

## CFG-095 — Superseding Version Requires Independent Governance Evaluation

Approval of one version never automatically approves its successor.

## CFG-096 — Approval Is Not Promotion

Approval alone cannot perform environment promotion or rollback.

## CFG-097 — Approval Is Not Capability Implementation

Approval cannot make unimplemented functionality available.

## CFG-098 — Approval-Gated Change Cannot Apply Before Approval

Sensitive operational behavior must not change while required approval is pending.

## CFG-099 — Approval Evidence Is Environment-Bound Where Applicable

Approval cannot silently transfer across environment boundaries.

## CFG-100 — Governance Evidence Is Auditable and Safe

Approval provenance must remain inspectable without exposing secrets.

## Prompt 12 configuration release invariants

These invariants specialize controlled promotion, activation and rollback.

## CFG-101 — Promotion Uses Explicit Environment Transitions

Environment promotion cannot rely on implicit enum ordering.

## CFG-102 — Promotion Binds to Exact Source Version

Promotion cannot float to a newer source version.

## CFG-103 — Promotion Binds to Destination Baseline

A stale destination baseline invalidates the plan.

## CFG-104 — Destination Configuration Must Validate

Source validity does not substitute for destination validation.

## CFG-105 — Promotion Cannot Create Capability Truth

Promotion cannot make unavailable functionality implemented.

## CFG-106 — Destination Governance Must Be Satisfied

Required destination approval cannot be bypassed.

## CFG-107 — Promotion Is Atomic

Destination cannot observe partially promoted configuration.

## CFG-108 — Latest Is Not Active

Configuration creation order cannot determine active authority.

## CFG-109 — Active Pointer Is Explicit Authority

Environment active state must be explicitly recorded.

## CFG-110 — Promotion History Is Immutable

Promotion evidence cannot be rewritten.

## CFG-111 — Environment Promotion Isolated

Promotion to one environment cannot silently activate another.

## CFG-112 — Promotion Policy Cannot Self-Downgrade

Candidate configuration cannot weaken its own release gate.

## CFG-113 — Non-Promotable Configuration Cannot Cross Environments

Environment-local values remain local.

## CFG-114 — Secrets Are Never Promoted as Resolved Values

Secret material remains protected.

## CFG-115 — Promotion Requires Final Pre-Activation Recheck

Eligibility cannot rely solely on stale planning-time state.

## CFG-116 — Known-Good State Requires Verification

Active does not automatically mean known-good.

## CFG-117 — Rollback Targets Exact Known-Good State

Rollback cannot restore approximate historical configuration.

## CFG-118 — Rollback Does Not Rewrite History

Rollback creates new evidence while preserving failed/replaced versions.

## CFG-119 — Rollback Is Governed

Rollback cannot bypass applicable approval and safety policies.

## CFG-120 — Rollback Must Revalidate Target

Historical success does not guarantee current eligibility.

## CFG-121 — Promotion Concurrency Fails Closed

Concurrent stale plans cannot silently overwrite active state.

## CFG-122 — Rollback Concurrency Fails Closed

Concurrent stale rollback plans cannot silently overwrite active state.

## CFG-123 — Restart-Required State Must Be Truthful

Configuration cannot be reported operationally effective before required restart.

## CFG-124 — Promotion Lineage Must Be Traceable

Release evidence must preserve promotion ancestry.

## CFG-125 — Release Events Must Follow Durable State

Release events must describe committed authoritative state.

## CFG-126 — Promotion Cannot Authorize Trading

Configuration promotion cannot imply trading authority.

## CFG-127 — Cross-Environment Approval Is Not Implicit

Approval in one environment does not silently authorize another environment.

## CFG-128 — Failed Promotion Preserves Previous Active State

Failed promotion cannot corrupt the destination active pointer.

## CFG-129 — Failed Rollback Preserves Coherent Authoritative State

Failed rollback cannot leave mixed active state.

## CFG-130 — Unknown Activation Outcome Fails Closed

Uncertain activation state must block readiness until recovered.

## Prompt 13 data invariants

These invariants specialize the general safety rules for canonical market-data contracts.

## DATA-001 — Canonical Data Is Provider Neutral

Canonical market-data contracts cannot depend on provider-specific wire formats or SDK types.

## DATA-002 — Every Observation Identifies Its Instrument

No canonical market observation may be anonymous or rely on provider symbol as instrument identity.

## DATA-003 — Every Observation Is Attributable

Source and provenance evidence cannot silently disappear from canonical observations.

## DATA-004 — Financial Prices Use Safe Decimal Representation

Authoritative market prices must use domain decimal/price primitives, not JavaScript floats.

## DATA-005 — Price Semantics Are Explicit

Bid, ask, trade/last, open, high, low and close fields are not interchangeable.

## DATA-006 — Event Time Is Distinct From Receive Time

Market event time and ATE receive time must remain separately represented.

## DATA-007 — Naive Timestamps Are Forbidden

Canonical market-data timestamps must be timezone-explicit UTC-normalized evidence.

## DATA-008 — Provider Symbol Is Not Canonical Instrument Identity

Provider symbols are provenance/source evidence and do not replace canonical instrument IDs.

## DATA-009 — Missing Is Not Zero

Absent price, quantity or volume evidence must not be fabricated as zero.

## DATA-010 — Derived Data Is Identified As Derived

Calculated observations such as derived bars, spreads or mids must carry transformation provenance.

## DATA-011 — Simulated Data Cannot Masquerade As Observed Data

Simulation-origin observations must be distinguishable from provider-observed market facts.

## DATA-012 — Replay Does Not Erase Original Provenance

Replay delivery context must not replace original observation source evidence.

## DATA-013 — Market Observations Are Immutable

Published observations are value records; corrections create new evidence instead of mutation.

## DATA-014 — Corrections Do Not Rewrite Historical Observations

Corrections must reference original and replacement observations explicitly.

## DATA-015 — Tick Does Not Imply Trade

Tick contracts must discriminate quote, trade and combined update semantics.

## DATA-016 — Volume Semantics Are Explicit

Trade volume, tick volume, quote count and unavailable volume are distinct.

## DATA-017 — Timeframe Is Explicit

Bars must carry timeframe identity; it is not inferred from timestamp difference.

## DATA-018 — Bar Interval Semantics Are Explicit

Bar intervals use explicit start/end boundaries with `[start, end)` semantics.

## DATA-019 — Bar Finality Is Explicit

Forming and final bars must be represented explicitly.

## DATA-020 — Sequence Scope Is Explicit

Provider sequence values require scope evidence before comparison.

## DATA-021 — Source Ordering Is Not Global Ordering

Provider-local sequence or receive order cannot be treated as global market order.

## DATA-022 — Out-of-Order Arrival Is Representable

Canonical contracts must permit late and out-of-order observations.

## DATA-023 — Contract Validation Does Not Pretend To Be Quality Assessment

Prompt 13 structural validation does not implement Prompt 15 quality scoring.

## DATA-024 — Raw Provider Payload Is Not Canonical Market Data

Canonical observations may carry bounded references/metadata, not arbitrary raw vendor payloads.

## DATA-025 — Metadata Is Bounded

Market-data metadata must enforce key, value and collection bounds.

## DATA-026 — Unknown Precision Is Not Fabricated Precision

Timestamp precision must be preserved when known and marked unknown when unavailable.

## DATA-027 — Derived Spread Cannot Contradict Canonical Bid/Ask

Canonical spread helpers derive from bid/ask instead of storing independent contradictory values.

## DATA-028 — Structural Errors Are Never Silently Repaired

Malformed bars, timestamps, quantities or identifiers are rejected rather than auto-corrected.

## DATA-029 — Dataset/Transformation Provenance Must Remain Traceable

Dataset and transformation references must remain available for future lineage authority.

## DATA-030 — Market Data Contracts Do Not Authorize Trading

Canonical data representation never grants strategy, risk, execution, paper or live trading
authority.

## Prompt 14 historical data invariants

These invariants specialize the data rules for offline historical artifact intake and research
datasets.

## DATA-031 — Historical Inputs Are Untrusted

Every imported artifact must pass controlled intake before parsing or publication.

## DATA-032 — Source Artifact Identity Is Content-Aware

Filename alone cannot establish artifact identity; content checksum is required.

## DATA-033 — Historical Import Is Reproducible

Equivalent artifact bytes, mapping semantics and canonical schema produce equivalent content
fingerprints.

## DATA-034 — Source Format Is Not Canonical Format

CSV, JSON, NDJSON and Parquet layouts cannot leak into downstream domain logic.

## DATA-035 — Mapping Is Explicit

Ambiguous source semantics cannot be silently guessed.

## DATA-036 — Naive Source Time Requires Explicit Timezone Interpretation

Naive timestamps require declared UTC or IANA timezone semantics before canonical conversion.

## DATA-037 — Bar Timestamp Meaning Is Explicit

Open-time versus close-time semantics cannot be guessed.

## DATA-038 — Volume Meaning Is Explicit

Historical volume columns require declared Prompt 13 volume semantics.

## DATA-039 — Imported Prices Use Canonical Decimal Authority

Imported prices must validate through domain decimal/price contracts.

## DATA-040 — Structural Validation Precedes Publication

Normalized records must pass Prompt 13 structural validation before dataset membership.

## DATA-041 — Rejected Records Are Not Canonical Dataset Members

Rejected source records remain evidence only and are excluded from published observations.

## DATA-042 — Quarantine Is Isolated From Research Queries

Quarantined records must not appear in normal historical query results.

## DATA-043 — Partial Import Status Is Explicit

Datasets completed with rejections must state that status in session statistics and manifest.

## DATA-044 — Historical Dataset Publication Is Atomic

Staged datasets are not authoritative until manifest and observations publish coherently.

## DATA-045 — Published Historical Datasets Are Immutable

Published datasets and partitions are append-only evidence; corrections require new data.

## DATA-046 — Import Failure Cannot Expose Partial Authoritative Data

Failed imports cannot become published datasets.

## DATA-047 — Source Position Is Preserved

Accepted and rejected records retain bounded source-location evidence.

## DATA-048 — Canonical Query Ordering Is Deterministic

Historical query ordering is stable and documented.

## DATA-049 — Dataset Content Fingerprints Exclude Volatile Operational Metadata

Content fingerprints depend on canonical content/order, not random IDs or wall-clock import time.

## DATA-050 — Import Plans Are Immutable

Plan fingerprints bind artifact checksum, mapping, limits and canonical schema identity.

## DATA-051 — Mapping Transformations Are Declarative

Historical mapping cannot execute arbitrary code.

## DATA-052 — Historical Imports Cannot Execute Source Code

Macros, formulas, scripts, eval and shell execution are forbidden in import paths.

## DATA-053 — Historical Import Resource Usage Is Bounded

File size, row count, field size, columns, nesting, rejections and queries must be bounded.

## DATA-054 — Original Filenames Are Never Trusted Paths

Original filenames are display metadata only.

## DATA-055 — Historical Queries Are Bounded

No unbounded historical query API may be exposed.

## DATA-056 — Import Statistics Are Not Quality Scores

Prompt 14 statistics are descriptive and do not assess trustworthiness.

## DATA-057 — Duplicate Evidence Is Not Silently Destroyed

Duplicate candidates are recorded according to explicit policy.

## DATA-058 — Historical Storage Does Not Imply Backtest Eligibility

Published structural datasets are not automatically clean or backtest-ready.

## DATA-059 — Historical Data Does Not Authorize Trading

Historical datasets cannot grant strategy, execution, paper or live trading authority.

## DATA-060 — Prompt 15 Owns Quality Judgment

Quality scoring, outlier detection and gap assessment remain Prompt 15 scope.

## Prompt 15 data-quality invariants

These invariants specialize the data rules for historical dataset quality assessment.

## DATA-061 — Quality Engine Has One Authority

Quality findings, scores and quality reports are owned by `@ate/data-quality`.

## DATA-062 — Quality Does Not Mutate Data

Quality analysis detects and reports issues only; it never repairs, rewrites or deletes
observations.

## DATA-063 — Structural Validity Remains Distinct

Prompt 13 structural validity is not the same as Prompt 15 data quality.

## DATA-064 — Import Validity Remains Distinct

Prompt 14 import success or rejection counts are not quality scores.

## DATA-065 — Fitness For Purpose Remains Distinct

A quality report does not automatically prove fitness for any downstream workflow.

## DATA-066 — Quality Cannot Authorize Trading

Quality scores and qualifications cannot authorize strategy, risk, execution, paper or live trading.

## DATA-067 — No Live Eligibility Category

Prompt 15 intended-use categories must not include live trading eligibility.

## DATA-068 — Quality Consumes Public Historical APIs

Quality analysis must consume historical datasets through public repository/query contracts.

## DATA-069 — No Private Historical Storage Reads

Quality rules must not depend on private historical storage file layouts.

## DATA-070 — Rule Outcomes Are Explicit

Rules must distinguish pass, findings, not applicable, insufficient evidence and failed execution.

## DATA-071 — Evidence Is Bounded

Quality reports must cap retained evidence and expose suppressed finding counts.

## DATA-072 — Findings Are Stablely Categorized

Findings must carry stable category, dimension and severity fields.

## DATA-073 — Report Publication Is Atomic

Staged quality reports are not authoritative until published coherently.

## DATA-074 — Published Reports Are Immutable

Published quality reports are append-only evidence.

## DATA-075 — Report Fingerprints Exclude Volatile Metadata

Semantic report fingerprints must not depend on generation timestamp or runtime durations.

## DATA-076 — Dataset Identity Is Bound

Quality reports must bind the dataset ID and dataset content fingerprint they assessed.

## DATA-077 — Profile Identity Is Bound

Quality reports must bind the quality profile identity, version and fingerprint.

## DATA-078 — Quality Failures Are Not Silent Passes

Rule or analysis failures must be visible as failed status or explicit errors.

## DATA-079 — Insufficient Evidence Fails Visible

Insufficient evidence must not be reported as clean data.

## DATA-080 — Gaps Are Findings, Not Fills

Gap detection must not synthesize missing observations.

## DATA-081 — Duplicates Are Findings, Not Deletions

Duplicate detection must preserve duplicate evidence instead of silently deduplicating data.

## DATA-082 — Outliers Are Findings, Not Corrections

Outlier detection must not clamp, smooth or replace prices.

## DATA-083 — Staleness Is Clock Relative

Freshness and staleness assessment must state the analysis clock/as-of basis.

## DATA-084 — Quality Events Are Summaries

Quality events must not flood per-finding or row-level payloads.

## DATA-085 — Quality Configuration Is Central

Quality thresholds and storage roots must be declared through managed configuration.

## DATA-086 — Capability Truth Is Dependency-Gated

The data-quality capability depends on market-data contracts and historical-data laboratory
capabilities.

## DATA-087 — Quality Is Not Catalogue Authority

Quality reports do not implement the future Dataset Catalogue or lineage graph.

## DATA-088 — Quality Is Not Ingestion

Quality analysis does not connect to providers, APIs, WebSockets or live feeds.

## DATA-089 — Quality Is Not Replay Or Aggregation

Quality analysis does not replay market data or aggregate new bars.

## DATA-090 — Quality Is Not Intelligence Or Execution

Quality analysis does not implement MOSE, indicators, strategies, risk, portfolio, account
allocation, MT5 or execution.

## Prompt 1 test coverage

Prompt 1 includes foundation tests that verify:

- required governance documents exist;
- the capability manifest truthfully marks trading/execution functions as not implemented;
- the prompt ledger records Prompt 1 only;
- security hygiene scanning is available.

Future prompts must add executable invariant tests when corresponding code exists.
