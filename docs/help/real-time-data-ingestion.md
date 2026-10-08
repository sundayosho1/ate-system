# Real-Time Data Ingestion

## Purpose and authorities

Prompt 17 implements data-only, provider-neutral ingestion. External observations are untrusted. A
connected transport is not a healthy stream. Valid data is not quality certification, research
qualification or trading permission. No commercial provider or broker credentials are required.

`@ate/realtime-data` owns adapter/session orchestration, desired/applied subscriptions, bounded
intake and delivery, stream-integrity evidence and capture manifests. Prompt 13 owns canonical
schemas; Prompt 6 owns clocks/scheduling; Prompts 7–12 own configuration/governance; Prompt 14 owns
historical materialization/storage; Prompt 15 owns quality assessment; Prompt 16 owns dataset
registration, lineage and eligibility. There is no automatic dataset materialization or
qualification.

## Provider adapter contract

Register a data-only `ProviderAdapter` before startup. Registry capacity, stable identities,
capability metadata, source references and duplicate registration are validated. Each adapter
supports async connect/disconnect/subscribe/unsubscribe with abort signals and a synchronous,
deterministic normalizer. External provider payloads must enter callbacks and pass ingress bounds
and Prompt 13 validation; no adapter publishes accepted observations directly. Implementations must
detach listeners when the session signal aborts and honor operation cancellation. The scripted
adapter retains at most 32 callback contexts for adversarial testing and uses no network or sleeps.

Capabilities explicitly declare observation kinds, STREAM/SNAPSHOT modes, source timestamp, sequence
and event-ID support, heartbeat, flow-control, snapshot and subscription-confirmation support,
reconnect semantics, entitlement reference and redistribution permission. This package implements
REJECT_NEWEST, not source pausing. Snapshot transport behavior belongs to the adapter. No order,
account or position action is exposed. Roles are source metadata, never automatic failover.

## Connection and subscription lifecycle

Connections follow an explicit transition graph: DISCONNECTED → CONNECTING → CONNECTED; failures
enter DEGRADED, then bounded RECONNECTING or FAILED; shutdown enters DISCONNECTING then DISCONNECTED
or FAILED. Every attempt gets a fresh session identity. Final session records are frozen and
bounded; eviction is counted. Generation and abort fencing reject old callbacks. Concurrent connects
join the pending attempt; a stopped instance cannot be restarted accidentally.

Subscriptions separate desired ACTIVE/CLOSED from provider-applied NONE/CONFIRMED/UNCERTAIN.
Registration is idempotent by exact request; conflicting IDs or duplicate logical requests fail.
Requests are reconciled in sorted subscription-ID order on every reconnect. Absent provider
confirmation means UNCERTAIN and DEGRADED, not invented activation. Unsubscribe cancels pending
acknowledgements. Supplied authorized desired subscriptions are restored before connecting. Closed
records count toward capacity; explicit new service lifecycle is needed to reclaim history.
Channel/timeframe are declared source requests, not broker symbol discovery or a global registry.
Material options are immutable for an instance: changing them requires new connection/capture
sessions and a new effective configuration fingerprint. Subscription changes during capture fail
until capture is completed/aborted, preserving declared capture provenance.

## Ingress, normalization and time

Callbacks enqueue immutable envelopes containing source/adapter/version/session/subscription,
provider symbol and kind, optional provider event/sequence/source time, receive time, local
sequence, payload fingerprint and configuration fingerprint. Raw objects are bounded before
normalization; accessors, custom prototypes, cycles, secret-shaped keys, sensitive URL parameters,
nonfinite numbers, oversized strings and deep objects fail without echoing input. No code is
evaluated. Batch callers must present the current session identity. Callback processing is
synchronous and bounded; accepted data drains in one scheduled microtask without one task per
observation.

Normalizer output supplies financial fields and explicit event time. Ingestion owns source,
observation identity, receive time, provenance and sequence attachment. Reserved authority fields
are rejected. Quote, tick, trade, supplied bar and market-status payloads reuse Prompt 13 schemas.
Supplied bars are validated, never aggregated. Numeric primitives retain decimal strings and
financial instrument references must match the subscription.

Event/source timestamps are external evidence. Receive/processing timestamps use the injected clock.
Naive, invalid and excessively future timestamps fail; missing source time stays absent. Missing
event time is rejected because Prompt 13 requires it, never replaced with receive time. Late and
regressing observations are independently classified; configured rejection policies can reject them,
otherwise arrival order and original event time are preserved with warnings. Processing time
regression is rejected. Reported processing latency is a bounded cumulative clock measurement, not a
high-resolution performance guarantee.

## Sequence, deduplication, gaps and freshness

Local ingress sequence is per provider instance and survives reconnect; provider sequence state is
per subscription/session. CONSECUTIVE mode accepts nonnegative integer strings and detects jumps;
OPAQUE mode supplies identity evidence without assuming arithmetic continuity; NONE ignores
unsupported sequences. Wraparound is unsupported: start a new session for a reset. Reconnect resets
provider sequence/dedup state and retains explicit continuity uncertainty.

Provider event ID, otherwise provider sequence, is identity evidence. Conflicting semantic content
under one identity is rejected; equal timestamps/prices without identity evidence are preserved.
Semantic fingerprints reuse Prompt 13. Dedup cache capacity and expiration use injected receive
time. Bounded history eviction can allow an old duplicate through: this is not exactly-once
delivery.

Sequence, heartbeat, connection, configured activity and overflow gaps are unresolved evidence, not
fabricated data or automatic repairs. Error/gap/session histories and control queues are bounded;
metrics expose dropped control records and history eviction. A reconnect never clears uncertainty.
Freshness measures accepted event-time age, separately from provider activity and heartbeat.
UNKNOWN/FRESH/AGING/STALE transitions use the scheduler. Heartbeats do not refresh market evidence.
Only explicit expectedActivity subscriptions generate inactivity time gaps; quiet markets otherwise
retain uncertainty rather than inventing missing ticks.

Reconnect has nonzero capped exponential delay, maximum attempts and a retry window. There is no
random jitter, silent source switch or infinite retry. Budget is per service lifetime; reconnect
exhaustion requires operator action/new governed service instance. Hung adapter operations have
virtual-time deadlines. A hosting application must drive the injected DeterministicScheduler in
normal operation and during startup/shutdown deadlines; the package creates no independent timer.

## Bounded data and control planes

Per-provider raw queues and per-consumer canonical channels expose depth, high-water mark,
enqueue/dequeue/rejection counts and lag as queue depth. REJECT_NEWEST is the only overflow policy:
rejection, loss and unresolved continuity gaps are visible. Slow consumers degrade their own
channels, leaving other consumers and providers operational. Consumers use async read() with
undefined for an empty queue; callers should use their host scheduling rather than busy polling.
Shutdown fences intake, cancels retries/operations, explicitly accounts for discarded queue entries,
aborts active captures, closes consumer queues and disconnects providers concurrently within
scheduler operation deadlines. Native operations cannot revive a stopped instance.

Market observations use the typed data plane. EventRegistry/EventFactory/InternalEventBus receive
only bounded lifecycle/subscription/gap/health/capture summaries through flushRealtimeControl().
Flush has an explicit batch bound and returns failed publication counts. There is no per-tick audit
log. Metrics have fixed names, no arbitrary labels, saturating cumulative counts and safe error
samples.

## Capture and crash recovery

FilesystemCaptureRepository writes bounded deterministic NDJSON accepted records in a managed
capture directory. IDs forbid traversal; existing symlink directories/files are rejected. Storage
root is trusted operator configuration; protect it from concurrent untrusted local writers. Capture
contains source/adapter version, configuration fingerprint, session/subscription lineage,
start/end/event-time ranges, counts, byte length, integrity/loss summaries and content fingerprint.

Writes are fsynced and a RUNNING manifest is atomically replaced after each append. Finalization
checks byte/count consistency, renames content first, then publishes a COMPLETED manifest with
content hash. Manifests have their own semantic checksum. Readers verify both hashes and counts;
content presence alone never proves completion. Recovery aborts RUNNING state, detects malformed or
missing manifests and verifies completed captures. Corrupt state blocks readiness until reviewed.
Finalization is idempotent through verified completed manifests; partial data never qualifies.

Atomic rename is supported by the Node filesystem layer on Windows and Linux on a single filesystem.
File fsync does not guarantee directory metadata durability on every platform or network filesystem.
Power-loss inconsistencies are detected rather than silently called complete. No cross-process
writer arbitration is implemented: use one writer per managed root. Capture count/size limits
require operator retention outside this package; full storage produces explicit failure. Synchronous
bounded writes can affect latency; this is a local capture foundation, not a throughput SLA.

finishCapture() returns a CAPTURE_ONLY materialization handoff with exact source/session/adapter/
configuration/time/content/integrity evidence. Historical materialization, authoritative quality
assessment and catalogue registration remain required. streamIntegrityEvidence() similarly provides
bounded evidence without a quality score. No LIVE_CAPTURE enum is needed because this handoff
creates no dataset or catalogue origin.

## Governed configuration

Register the foundational configuration definitions/schemas and resolve effective configuration
through the existing authority; realtimeOptionsFromEffective() consumes values and preserves its
fingerprint. Validate again at startup. Cross-field retry maximum must not be below initial delay.
All settings below use SYSTEM/ENVIRONMENT scope, DATA domain, fail-closed validation and RESTART
semantics. Every change requires a new instance/session; active capture provenance never changes. No
independent environment-variable authority or commercial credentials are introduced.

| Key (`data.realtime.` prefix) | Type    | Default                    | Valid range      | Purpose / effect / dependency                                                                                                                                        |
| ----------------------------- | ------- | -------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`                     | boolean | `false`                    | true / false     | Enable authorized data-only ingestion; does not configure a commercial provider. Requires enabled for provider activity; resource/storage validation remains active. |
| `maxProviders`                | integer | `8`                        | 1–32             | Bound registered adapters and concurrent sessions. Requires enabled for provider activity; resource/storage validation remains active.                               |
| `queueCapacity`               | integer | `256`                      | 1–10000          | Per-provider raw ingress capacity; reject newest and degrade on overflow. Requires enabled for provider activity; resource/storage validation remains active.        |
| `consumerQueueCapacity`       | integer | `256`                      | 1–10000          | Per-consumer accepted queue capacity; isolated overflow is explicit. Requires enabled for provider activity; resource/storage validation remains active.             |
| `maxConsumers`                | integer | `16`                       | 1–128            | Bound data-plane consumer cardinality. Requires enabled for provider activity; resource/storage validation remains active.                                           |
| `maxSubscriptions`            | integer | `64`                       | 1–1000           | Bound subscription records per provider, including closed records. Requires enabled for provider activity; resource/storage validation remains active.               |
| `maxMessageBytes`             | integer | `65536`                    | 128–1048576      | Bound raw payload and envelope bytes before normalization. Requires enabled for provider activity; resource/storage validation remains active.                       |
| `maxBatchSize`                | integer | `64`                       | 1–1000           | Bound a single callback batch. Requires enabled for provider activity; resource/storage validation remains active.                                                   |
| `maxDepth`                    | integer | `8`                        | 1–16             | Bound input nesting depth. Requires enabled for provider activity; resource/storage validation remains active.                                                       |
| `maxStringLength`             | integer | `1024`                     | 64–8192          | Bound individual input strings. Requires enabled for provider activity; resource/storage validation remains active.                                                  |
| `dedupCapacity`               | integer | `1024`                     | 1–10000          | Bound recent provider identity evidence per subscription. Requires enabled for provider activity; resource/storage validation remains active.                        |
| `dedupWindowMs`               | integer | `60000`                    | 1–3600000        | Expire identity evidence using receive-time clock authority. Requires enabled for provider activity; resource/storage validation remains active.                     |
| `maxFutureSkewMs`             | integer | `1000`                     | 0–60000          | Reject event/source times excessively ahead of receive time. Requires enabled for provider activity; resource/storage validation remains active.                     |
| `maxLateAgeMs`                | integer | `60000`                    | 1–86400000       | Classify old event/source evidence as late. Requires enabled for provider activity; resource/storage validation remains active.                                      |
| `rejectLate`                  | boolean | `false`                    | true / false     | Reject late observations when explicitly required; otherwise warn. Requires enabled for provider activity; resource/storage validation remains active.               |
| `rejectOutOfOrder`            | boolean | `false`                    | true / false     | Reject regressions when required; otherwise preserve arrival order and warning. Requires enabled for provider activity; resource/storage validation remains active.  |
| `staleAfterMs`                | integer | `30000`                    | 1–86400000       | Observation freshness threshold; not a quality score. Requires enabled for provider activity; resource/storage validation remains active.                            |
| `heartbeatTimeoutMs`          | integer | `10000`                    | 1–3600000        | Transport liveness deadline only when adapter supports heartbeats. Requires enabled for provider activity; resource/storage validation remains active.               |
| `monitorIntervalMs`           | integer | `1000`                     | 1–60000          | Virtual-scheduler monitor interval. Requires enabled for provider activity; resource/storage validation remains active.                                              |
| `operationTimeoutMs`          | integer | `5000`                     | 1–60000          | Bound adapter connect/subscribe/disconnect operations via scheduler. Requires enabled for provider activity; resource/storage validation remains active.             |
| `reconnectMaxAttempts`        | integer | `3`                        | 0–10             | Bound reconnect attempts in the retry window. Requires enabled for provider activity; resource/storage validation remains active.                                    |
| `reconnectWindowMs`           | integer | `60000`                    | 1–3600000        | Maximum elapsed retry window; exhaustion requires explicit operator action. Requires enabled for provider activity; resource/storage validation remains active.      |
| `reconnectInitialDelayMs`     | integer | `1000`                     | 1–60000          | Nonzero initial retry delay. Requires enabled for provider activity; resource/storage validation remains active.                                                     |
| `reconnectMaxDelayMs`         | integer | `10000`                    | 1–300000         | Bound exponential retry delay; deterministic with no jitter. Requires enabled for provider activity; resource/storage validation remains active.                     |
| `maxEvidence`                 | integer | `100`                      | 1–1000           | Bound session, gap, error and control histories; counters disclose eviction. Requires enabled for provider activity; resource/storage validation remains active.     |
| `captureEnabled`              | boolean | `false`                    | true / false     | Enable capture artifact writing; never automatic dataset registration. Requires enabled for provider activity; resource/storage validation remains active.           |
| `captureStorageRoot`          | string  | `".ate/realtime-captures"` | 1–512 characters | Managed capture-only filesystem root; trusted operator path. Requires captureEnabled.                                                                                |
| `captureMaxFileBytes`         | integer | `10485760`                 | 1024–67108864    | Bound canonical capture content and recovery reads. Requires captureEnabled.                                                                                         |
| `captureMaxSessions`          | integer | `32`                       | 1–1000           | Bound capture manifest count and lineage references. Requires captureEnabled.                                                                                        |

## Deterministic example

```typescript
const clock = new VirtualClock(mustParseUtc("2026-10-08T10:00:00.000Z"));
const scheduler = new DeterministicScheduler(clock);
const options = { ...defaultRealtimeOptions, enabled: true };
const source = dataSourceRefSchema.parse({
  sourceId: "30000000-0000-4000-8000-000000000001",
  sourceType: "SIMULATION",
  name: "Offline fixture",
  role: "PRIMARY",
});
const adapter = new ScriptedAdapter(source);
const service = new RealtimeDataService({
  clock,
  scheduler,
  options,
  configurationFingerprint: fingerprint(options),
});
service.register(adapter);
await service.start();
await service.subscribe({
  subscriptionId: "quotes",
  sourceId: source.sourceId,
  instrumentId: "30000000-0000-4000-8000-000000000002",
  providerSymbol: "EURUSD",
  observationKind: "QUOTE",
  mode: "STREAM",
  expectedActivity: false,
});
const consumerResult = service.consumer("research-evidence");
if (!consumerResult.ok) throw new Error(consumerResult.error.code);
adapter.emit({
  subscriptionId: "quotes",
  sourceId: source.sourceId,
  observationKind: "QUOTE",
  payload: {
    eventTime: clock.now(),
    bid: {
      value: "1.23",
      instrumentId: "30000000-0000-4000-8000-000000000002",
      quoteCurrency: "USD",
    },
  },
});
await service.drain();
const evidence = await consumerResult.value.read();
await service.stop();
```

Imports come from @ate/realtime-data, @ate/domain and @ate/time. The example uses an explicitly
fingerprinted test configuration; production composition must use governed effective configuration.

## Troubleshooting and limitations

- INVALID_TIMESTAMP: inspect timezone/source evidence; do not substitute receive time.
- IDENTITY_CONFLICT: provider reused an identity for different semantic content; investigate source.
- QUEUE_OVERFLOW: inspect raw/consumer depth, loss counts and unresolved gaps; increasing bounds
  requires governed restart, not silent dropping.
- RECONNECT_EXHAUSTED: review adapter failure, retry window and source continuity before restart.
- CAPTURE_INTEGRITY_FAILED: inspect incomplete/corrupt files; never label them completed manually.
- UNCERTAIN applied state: require provider acknowledgement before claiming confirmed subscription.
- Scheduler deadlines not firing: verify the host drives runDueTasks() with the injected clock.
- No commercial provider configured: expected for the scripted baseline, not an ATE-wide outage.

Commercial adapters, provider credentials, deployment host, performance qualification, dataset
materialization, quality scoring of streaming evidence, aggregation (Prompt 18), replay (19),
instrument registry (20), MOSE, frontend and all trading/execution capabilities remain deferred.
Windows behavior is designed against Node supported filesystem APIs; execution validation in this
task is on Linux.

### Prompt 17 audit remediation semantics

Scheduled retries dispatch a tracked connection attempt and return immediately to the existing
sequential scheduler. The host can therefore execute operation deadlines and unrelated scheduled
work while a provider operation remains pending. No additional timer or clock authority is used.

Freshness derives from the latest accepted canonical event time and the current injected clock,
including immediate readiness queries before the next monitor cycle. Old arrivals do not replace
newer event-time evidence. Diagnostics distinguish last accepted arrival's event time, latest
accepted event time, and last event accepted within the FRESH age threshold. Invalid or duplicate
observations cannot independently advance these timestamps. Missing canonical event time is
rejected; missing optional source time remains an explicit warning rather than fabricated evidence.
Applied subscription uncertainty and unresolved continuity still prevent required-source readiness.

Native callbacks validate a bounded root envelope and required field types before dereferencing or
fingerprinting payloads. Malformed envelopes return safe structured rejection evidence. Registry
wrappers, their source identity and capability metadata are immutable; adapter methods remain bound.

Capture creation requires successfully initialized running lifecycle state. STOPPING, STOPPED,
FAILED and incomplete startup reject creation. If a custom capture repository callback initiates
shutdown during synchronous creation, the new capture is aborted before creation can report success.
Finalization remains synchronous; pending raw ingress rejects completion and shutdown accounts for
that capture by aborting it. These corrections do not alter the single-writer, synchronous storage
or filesystem durability limitations above. Windows execution and production throughput/durability
qualification remain outstanding.

### Capture cleanup failure and recovery

Successful repository creation confirms the capture and registers it as active, unless lifecycle
permission was lost during the synchronous call, in which case confirmed creation is compensated.
The `CaptureRepository.start` result has no failure-atomicity guarantee: a structured failure or
exception does not prove that no durable artifact was created. Without explicit no-commit evidence,
both retain UNKNOWN commitment immediately, even before shutdown starts. The service fails closed,
rejects further creation and readiness, and propagates the obligation through subsequent and
repeated shutdown. It does not abort an uncertain identity that may belong to a preexisting or
unrelated capture.

Only explicit `commitment: "NOT_CREATED"` on a failed start certifies that the attempt performed no
mutating storage operation. The filesystem repository provides this evidence only when validation,
discovery or path checks fail before its first mutating call is attempted. It does not assert that
no preexisting artifact exists. Once directory creation is attempted, later failures remain UNKNOWN,
even if that call reports failure. Custom repositories must honor the same contract; absent evidence
fails closed. A pre-call lifecycle or ID rejection invokes no repository operation. Generic error
codes alone never establish no-commit, and the service does not acquire an obligation for an
explicitly proven no-mutation rejection. UNKNOWN does not assert an artifact exists. Fresh startup
uses existing discovery: no discovered manifest means no capture to recover; RUNNING is marked
ABORTED only after successful abort; COMPLETED remains immutable and is verified. Failed discovery
or recovery fails startup. Partial or malformed artifacts continue to follow the existing
fail-closed repository policy.

Capture creation reserves one slot per provider before invoking the synchronous repository port.
Reentrant starts for that provider are rejected. If creation initiates shutdown, a confirmed created
capture is compensated exactly once through the existing repository abort operation. Structured
abort failures and thrown abort exceptions are failures, not confirmed cleanup. Thrown exceptions
produce a safe `PERSISTENCE_FAILED` result without exposing exception details.

Unresolved cleanup keeps bounded per-provider `captureRecovery` evidence: capture ID, last known
manifest state, structured error, `cleanupConfirmed: false` and `recoveryRequired: true`.
Diagnostics also expose aggregate `recoveryRequired` and a pending creation ID. A confirmed creation
whose abort fails has last known state RUNNING; an exceptional or failed creation whose commitment
cannot be established is UNKNOWN. These labels describe knowledge, not a fabricated filesystem
transition. The durable manifest remains authoritative and is never changed to ABORTED merely
because abort was attempted. Existing control summaries signal RECOVERY_REQUIRED.

Shutdown consults the retained obligation after its asynchronous adapter work, so compensation
failure inside a synchronous creation callback cannot escape the shutdown result. The existing
FAILED service state and failed structured shutdown result represent unresolved mandatory cleanup;
readiness is false. Repeated stop preserves this failure and does not automatically retry capture
storage operations. Ordinary confirmed cleanup still permits successful idempotent stop.

Recover through a fresh managed service instance using the same capture repository root. Startup's
existing manifest discovery aborts recoverable RUNNING captures and verifies completed captures;
failed recovery fails startup. The previous failed instance retains its historical failure even if
another instance subsequently recovers the disk artifacts. Do not clear this evidence by retrying
stop or claim success until recovery is confirmed by the existing authority. This change adds no
storage format, lifecycle state, clock, uncontrolled retry, or unbounded recovery registry. Windows
execution and synchronous capture throughput/durability qualification remain unverified.
