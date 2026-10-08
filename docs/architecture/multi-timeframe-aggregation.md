# Multi-Timeframe Aggregation Architecture

`@ate/multitimeframe` owns bounded derived revision/checkpoint state. Input adapters feed canonical
observations with explicit evidence into source-scoped windows. Graph parents reference exact child
revisions. Publication requires durable checkpoint then a visibility marker. Snapshot selection
reads immutable published history at the requested knowledge cutoff. See ADR-0079 through ADR-0084,
DATA-177 through DATA-200, and the [operating guide](../help/multi-timeframe-aggregation.md).

## Authority map

| Concern                           | Authority                             |
| --------------------------------- | ------------------------------------- |
| Observation/schema/price basis    | Prompt 13 @ate/domain                 |
| Clock/timezone/DST                | Prompt 6 @ate/time                    |
| Config/version/approval/promotion | Prompts 7–12 @ate/configuration       |
| Derived state ownership           | Prompt 5 @ate/persistence             |
| Lifecycle and control events      | Prompts 3–4 @ate/runtime, @ate/events |
| Capture/subscription ingress      | Prompt 17 @ate/realtime-data          |
| Historical materialization        | Prompt 14 @ate/historical-data        |
| Quality assessment                | Prompt 15 @ate/data-quality           |
| Dataset registration              | Prompt 16 @ate/dataset-catalogue      |

No implicit authority transfer occurs between these domains. Concrete operations are synchronous and
content-bounded; managed lifecycle integrates with runtime promises. There are no autonomous timers
or financial actions. Publication notifications are hints, durable query history is authoritative.

## CODEX-003B remediation boundaries

- Ordering uses a transitive deterministic total comparator with explicit uncertainty; identity
  ranking is a research construction policy, not provider-confirmed chronology.
- A canonical aggregate includes a bounded self-contained hashed quality manifest. Inherited
  manifests and suppression-reference membership persist in derived checkpoints; missing mandatory
  inherited evidence fails closed. Prompt 15 continues to own quality assessment.
- Filesystem capacity counts immutable operation IDs, reserving all content/marker/temp paths.
  Successfully acknowledged states remain recoverable at unchanged bounds; no artifacts are deleted
  to fit capacity. Inability to persist a continuity fence makes the runtime fail closed.
- Correction eligibility uses immutable finalized history and the original window end, including
  invalidated/recovered windows and hierarchical parents. Initial historical construction is
  separate.
- Channel-wide consumer loss has unknown source scope under the existing Prompt 17 contract and
  fences all potentially affected engine streams. Loss evidence is bounded, durable and never
  silently evicted. Draining does not reconcile continuity; explicit justified watermark authority
  does.
- AS_KNOWN preserves latest-eligible selection with visible ineligible-successor warnings.
  Point-in-time revision selection is within current registry/configuration context; no bitemporal
  registry is claimed.

See the
[help contract](../help/multi-timeframe-aggregation.md#codex-003b-corrected-research-contracts) for
limits, migration restrictions and failure/reconciliation behavior. Native trade correction records,
production operation, Windows durability and Prompt 19 remain outside this remediation.
