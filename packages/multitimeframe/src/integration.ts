import { runtimeModes, type UtcTimestamp } from "@ate/domain";
import { serviceDescriptor, type RuntimeManagedService, type ServiceId } from "@ate/runtime";
import type { Clock } from "@ate/time";
import type { StateAuthorityRegistry, StateDomain, StateOwner } from "@ate/persistence";
import type { AcceptedObservation, ConsumerChannel } from "@ate/realtime-data";
import type { HistoricalDatasetRepository, HistoricalDatasetId } from "@ate/historical-data";
import type { DataQualityReport } from "@ate/data-quality";
import { z } from "zod";
import type { EventFactory, InternalEventBus, EventTypeRegistration } from "@ate/events";
import type { AggregationEngine } from "./engine.js";
import { failure, hash, type Result } from "./primitives.js";
import type { Input, QualityEvidence } from "./types.js";
export const qualityEvidence = (report: DataQualityReport): QualityEvidence => ({
  reportId: report.reportId,
  reportFingerprint: report.reportFingerprint,
  findings: report.findings.map((f) => ({
    findingId: f.findingId,
    category: f.category,
    severity: f.severity,
  })),
  suppressed: report.summary.suppressedFindingCount,
});
export const realtimeInput = (
  accepted: AcceptedObservation,
  sourceFingerprint: string,
  artifactId: string,
): Input => ({
  observation: accepted.observation,
  identity: accepted.ingress.eventId ?? accepted.observation.observationId,
  sessionId: accepted.ingress.sessionId,
  channel: accepted.ingress.subscriptionId,
  origin: "REALTIME",
  sourceFingerprint,
  artifactId,
  availability: "VERIFIED",
  continuity: accepted.warnings.some((w) =>
    ["SEQUENCE_GAP", "CONTINUITY_UNCERTAIN", "SUBSCRIPTION_UNCERTAIN", "OUT_OF_ORDER"].includes(w),
  )
    ? "GAP"
    : "CONTINUOUS",
  ...(accepted.ingress.providerSequence
    ? { orderingSequence: accepted.ingress.providerSequence }
    : {}),
  warnings: accepted.warnings,
});
const seenChannels = new WeakMap<AggregationEngine, WeakSet<ConsumerChannel>>();
export async function consumeRealtime(
  engine: AggregationEngine,
  consumer: ConsumerChannel,
  streamId: string,
  sourceFingerprint: string,
  artifactId: string,
  limit: number,
): Promise<Result<number>> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw Error("CONSUMER_LIMIT");
  const seen = seenChannels.get(engine) ?? new WeakSet<ConsumerChannel>();
  seenChannels.set(engine, seen);
  const observeLoss = () => {
    const discarded = consumer.queue.enqueued - consumer.queue.dequeued - consumer.queue.depth;
    // Healthy reads need no extra checkpoint clone; all loss/closure paths still
    // go through the durable authority before consuming retained observations.
    if (consumer.queue.rejected === 0 && !consumer.degraded && !consumer.closed && discarded === 0)
      return { ok: true as const, value: undefined };
    const result = engine.observeConsumerLoss({
      contextFingerprint: hash({ sourceFingerprint, artifactId }),
      newChannel: !seen.has(consumer),
      consumerId: consumer.consumerId,
      rejected: consumer.queue.rejected,
      degraded: consumer.degraded,
      closed: consumer.closed,
      // Prompt 17 does not expose loss scope/time. Closed-channel clearing can
      // discard queued accepted observations without incrementing rejection count.
      discarded,
    });
    if (result.ok) seen.add(consumer);
    return result;
  };
  let count = 0;
  for (let i = 0; i < limit; i++) {
    const before = observeLoss();
    if (!before.ok) return before;
    const accepted = await consumer.read();
    const after = observeLoss();
    if (!after.ok) return after;
    if (!accepted) break;
    const r = engine.ingest(streamId, realtimeInput(accepted, sourceFingerprint, artifactId));
    if (!r.ok) return r;
    count++;
  }
  const last = observeLoss();
  if (!last.ok) return last;
  return { ok: true, value: count };
}
export async function consumeHistorical(
  engine: AggregationEngine,
  repository: HistoricalDatasetRepository,
  datasetId: HistoricalDatasetId,
  streamId: string,
  sourceFingerprint: string,
  channel: string,
  limit: number,
  sourcePublishedAt?: UtcTimestamp,
  cursor?: string,
): Promise<Result<Readonly<{ count: number; nextCursor?: string }>>> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw Error("HISTORICAL_LIMIT");
  const page = await repository.query({ datasetId, limit, ...(cursor ? { cursor } : {}) });
  if (!page.ok) return page;
  let count = 0;
  for (const observation of page.value.observations) {
    const r = engine.ingest(streamId, {
      observation,
      identity: observation.observationId,
      sessionId: datasetId,
      channel,
      origin: "HISTORICAL",
      sourceFingerprint,
      artifactId: datasetId,
      availability: sourcePublishedAt ? "VERIFIED" : "UNKNOWN",
      ...(sourcePublishedAt ? { sourcePublishedAt } : {}),
      continuity: "UNKNOWN",
      warnings: [],
    });
    if (!r.ok) return r;
    count++;
  }
  return {
    ok: true,
    value: { count, ...(page.value.nextCursor ? { nextCursor: page.value.nextCursor } : {}) },
  };
}
export const aggregationControlEvent = {
  eventType: "data.multitimeframe.control",
  version: 1,
  category: "OPERATIONAL",
  schema: z
    .object({
      kind: z.string().max(64),
      timestamp: z.string().max(64),
      operationId: z.string().max(64),
    })
    .strict(),
  description: "Bounded aggregation commit/recovery summaries, never individual observations.",
  owner: "@ate/multitimeframe",
} satisfies EventTypeRegistration;
export async function flushAggregationControl(
  engine: AggregationEngine,
  factory: EventFactory,
  bus: InternalEventBus,
  limit: number,
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw Error("CONTROL_LIMIT");
  let published = 0,
    failed = 0;
  for (let i = 0; i < limit; i++) {
    const payload = engine.readControl();
    if (!payload) break;
    const event = factory.createRootEvent({
      eventType: aggregationControlEvent.eventType,
      payload,
    });
    if (!event.ok) {
      failed++;
      continue;
    }
    const r = await bus.publish(event.value);
    if (r.status === "DELIVERED" || r.status === "ACCEPTED") published++;
    else failed++;
  }
  return { published, failed };
}
export const registerAggregationAuthority = (registry: StateAuthorityRegistry) =>
  registry.register({
    stateDomain: "data.multitimeframe.revisions" as StateDomain,
    owner: "multitimeframe" as StateOwner,
    authorityType: "DERIVED",
    writeAuthority: "@ate/multitimeframe",
    readers: [
      "@ate/runtime",
      "@ate/historical-data",
      "@ate/data-quality",
      "@ate/dataset-catalogue",
    ],
    durable: true,
    historyRequired: true,
    reconciliationRequired: true,
    runtimeModes,
    description:
      "Owned bounded derived revision/checkpoint state; no dataset registration, quality scoring or trading authority.",
  });
export class AggregationRuntimeService {
  public readonly managedService: RuntimeManagedService;
  public constructor(engine: AggregationEngine, clock: Clock) {
    const serviceId = "multitimeframe-aggregation" as ServiceId;
    this.managedService = {
      descriptor: serviceDescriptor({
        serviceId,
        name: "Multi-Timeframe Aggregation",
        version: "0.18.0-multitimeframe.1",
        description: "Offline governed research aggregation.",
        criticality: "OPTIONAL",
        dependencies: [],
        optionalDependencies: [],
        supportedModes: runtimeModes,
        degradationPolicy: "CONTINUE_WITHOUT_CAPABILITY",
        capabilities: ["MARKET_DATA_READ"],
        healthCapability: true,
        readinessCapability: true,
        recoverable: true,
      }),
      initialize: async () => {
        await Promise.resolve();
        const r = engine.start();
        if (!r.ok) throw Error(r.error.code);
      },
      stop: async () => {
        await Promise.resolve();
        const r = engine.stop();
        if (!r.ok) throw Error(r.error.code);
      },
      checkHealth: async () => {
        await Promise.resolve();
        return {
          status: engine.diagnostics().ready ? "HEALTHY" : "DEGRADED",
          timestamp: clock.now(),
          serviceId,
          reason: "Research authority only; source coverage is separate",
          details: { tradingAuthorized: false },
        };
      },
      checkReadiness: async () => {
        await Promise.resolve();
        return {
          status: engine.diagnostics().ready ? "READY" : "NOT_READY",
          timestamp: clock.now(),
          serviceId,
          reason: "No unresolved checkpoint obligation",
          details: { tradingAuthorized: false },
        };
      },
    };
  }
}
export const integrationFailure = (clock: Clock) => failure(clock, "INTEGRATION_REJECTED");
