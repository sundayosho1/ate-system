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
