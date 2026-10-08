import { marketObservationSchema, type UtcTimestamp } from "@ate/domain";
import { VirtualClock, mustParseUtc, durationMs } from "@ate/time";
import {
  AggregationEngine,
  MemoryAggregationRepository,
  TimeframeRegistry,
  utcCalendar,
  defaultOptions,
  hash,
  type Input,
  type Options,
  type AggregationRepository,
  type EngineInput,
  type Stream,
} from "@ate/multitimeframe";
export const sourceId = "40000000-0000-4000-8000-000000000001",
  instrumentId = "40000000-0000-4000-8000-000000000002";
export const t = (value: string): UtcTimestamp =>
  mustParseUtc(value.includes("T") ? value : `2026-10-08T${value}.000Z`);
export const config = hash("test-config"),
  sourceFingerprint = hash("source");
export const stream: Stream = {
  sourceId,
  instrumentId,
  channel: "quotes",
  basis: "BID",
  priceCurrency: "USD",
  sourceFingerprint,
  volumeType: "QUOTE_COUNT",
  volumeUnit: "TICKS",
};
export const unwrap = <T>(
  r: { ok: true; value: T } | { ok: false; error: { code: string } },
): T => {
  if (!r.ok) throw Error(r.error.code);
  return r.value;
};
export function fixture(
  codes: readonly string[] = ["M1", "M5", "M15", "H1", "H4"],
  options: Partial<Options> = {},
  repositoryFactory?: (clock: VirtualClock) => AggregationRepository,
  edges: EngineInput["edges"] = [],
) {
  const clock = new VirtualClock(t("12:00:00")),
    repository = repositoryFactory?.(clock) ?? new MemoryAggregationRepository(clock);
  const engine = new AggregationEngine({
    clock,
    repository,
    registry: new TimeframeRegistry(),
    calendar: utcCalendar,
    configurationFingerprint: config,
    options: { ...defaultOptions, enabled: true, ...options },
    directTimeframes: codes,
    edges,
  });
  unwrap(engine.start());
  const streamId = unwrap(engine.registerStream(stream));
  return { clock, repository, engine, streamId };
}
export function set(f: { clock: VirtualClock }, value: UtcTimestamp) {
  const ms = Date.parse(value) - Date.parse(f.clock.now());
  if (ms < 0) throw Error("fixture clock regression");
  unwrap(f.clock.advanceBy(durationMs(ms)));
}
export function observation(at: UtcTimestamp, id: number, price = "1", receivedAt = at): Input {
  const observation = marketObservationSchema.parse({
    schemaVersion: 1,
    observationId: `40000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    observationKind: "QUOTE",
    instrumentId,
    source: { sourceId, sourceType: "SIMULATION", name: "fixture" },
    eventTime: at,
    receivedAt,
    bid: { value: price, instrumentId, quoteCurrency: "USD" },
    ask: { value: price, instrumentId, quoteCurrency: "USD" },
    provenance: {
      source: { sourceId, sourceType: "SIMULATION", name: "fixture" },
      origin: "SIMULATED",
    },
    qualityAnnotations: [],
    metadata: {},
  });
  return {
    observation,
    identity: String(id),
    sessionId: "session-1",
    channel: "quotes",
    origin: "FIXTURE",
    sourceFingerprint,
    artifactId: "fixture",
    availability: "VERIFIED",
    continuity: "CONTINUOUS",
    orderingSequence: String(id),
    warnings: [],
  };
}
export const evidence = (
  f: ReturnType<typeof fixture>,
  through: UtcTimestamp,
  coverage: "COMPLETE_COVERAGE" | "INCOMPLETE" | "UNKNOWN" = "COMPLETE_COVERAGE",
) =>
  unwrap(
    f.engine.watermark(f.streamId, {
      sessionId: "session-1",
      through,
      observedAt: f.clock.now(),
      coverage,
      kind: "END_OF_STREAM",
      evidenceId: "eos",
      reconciled: true,
    }),
  );
