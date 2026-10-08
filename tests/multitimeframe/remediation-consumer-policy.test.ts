import { describe, it, expect } from "vitest";
import { ConsumerChannel, type AcceptedObservation } from "@ate/realtime-data";
import {
  AggregationEngine,
  MemoryAggregationRepository,
  TimeframeRegistry,
  utcCalendar,
  defaultOptions,
  consumeRealtime,
  hash,
  canonicalBar,
  type Input,
} from "@ate/multitimeframe";
import { fixture, observation, unwrap, t, evidence, set, stream, config } from "./fixtures.js";
const accepted = (f: ReturnType<typeof fixture>, id: number): AcceptedObservation => ({
  observation: observation(t(`10:00:${String(id).padStart(2, "0")}`), id).observation,
  processedAt: f.clock.now(),
  warnings: [],
  ingress: {
    ingressId: String(id),
    sourceId: stream.sourceId,
    adapterId: "fixture",
    adapterVersion: "1",
    sessionId: "session-1",
    subscriptionId: "quotes",
    providerSymbol: "FIXTURE",
    observationKind: "QUOTE",
    eventId: String(id),
    receivedAt: f.clock.now(),
    localSequence: id,
    payloadFingerprint: hash(id),
    configurationFingerprint: config,
  },
});
const ready = (edges: readonly { child: string; parent: string }[] = []) => {
  const f = fixture(["M1"], {}, undefined, edges);
  unwrap(f.engine.ingest(f.streamId, observation(t("10:00:01"), 1)));
  evidence(f, f.clock.now());
  return f;
};
const consume = (
  f: ReturnType<typeof fixture>,
  c: ConsumerChannel,
  id = f.streamId,
  artifact = "realtime",
) => consumeRealtime(f.engine, c, id, stream.sourceFingerprint, artifact, 1);
const restart = (f: ReturnType<typeof fixture>) =>
  new AggregationEngine({
    clock: f.clock,
    repository: f.repository,
    registry: new TimeframeRegistry(),
    calendar: utcCalendar,
    configurationFingerprint: config,
    options: { ...defaultOptions, enabled: true },
    directTimeframes: ["M1"],
  });
describe("CODEX-003B H05 realtime loss integrity", () => {
  it("blocks complete finality in the capacity-one sequence-less audit scenario", async () => {
    const f = ready(),
      c = new ConsumerChannel("audit", 1);
    expect(c.deliver(accepted(f, 2))).toBe(true);
    expect(c.deliver(accepted(f, 3))).toBe(false);
    expect(unwrap(await consume(f, c))).toBe(1);
    expect(c.degraded).toBe(true);
    expect(f.engine.diagnostics().watermarks[f.streamId]!.status).toBe("FENCED");
    expect(f.engine.publishWindow(f.streamId, "M1", t("10:00:00"), true)).toMatchObject({
      ok: false,
      error: { code: "FINALITY_EVIDENCE" },
    });
    expect(Object.values(f.engine.diagnostics().consumerLosses)[0]).toMatchObject({
      rejected: 1,
      scope: "UNKNOWN_CHANNEL_SCOPE",
      observedAt: f.clock.now(),
      affectedStreams: [f.streamId],
    });
  });
  it("draining and repeated calls do not restore continuity; explicit reconciliation can", async () => {
    const f = ready(),
      c = new ConsumerChannel("audit", 1);
    c.deliver(accepted(f, 2));
    c.deliver(accepted(f, 3));
    unwrap(await consume(f, c));
    const original = f.engine.diagnostics().consumerLosses;
    expect(unwrap(await consume(f, c))).toBe(0);
    expect(f.engine.diagnostics().consumerLosses).toEqual(original);
    expect(f.engine.diagnostics().watermarks[f.streamId]!.status).toBe("FENCED");
    evidence(f, f.clock.now());
    expect(unwrap(await consume(f, c))).toBe(0);
    expect(f.engine.diagnostics().watermarks[f.streamId]!.status).toBe("CONTINUOUS");
    expect(f.engine.publishWindow(f.streamId, "M1", t("10:00:00"), true).ok).toBe(true);
  });
  it("a second loss after reconciliation fences again", async () => {
    const f = ready(),
      c = new ConsumerChannel("audit", 1);
    c.deliver(accepted(f, 2));
    c.deliver(accepted(f, 3));
    unwrap(await consume(f, c));
    evidence(f, f.clock.now());
    c.deliver(accepted(f, 4));
    c.deliver(accepted(f, 5));
    unwrap(await consume(f, c));
    expect(f.engine.diagnostics().watermarks[f.streamId]!.status).toBe("FENCED");
    expect(Object.values(f.engine.diagnostics().consumerLosses)[0]!.rejected).toBe(2);
  });
  it("distinct actual channel objects with reused identifiers cannot hide a new loss", async () => {
    const f = ready(),
      first = new ConsumerChannel("same-name", 1);
    first.deliver(accepted(f, 2));
    first.deliver(accepted(f, 3));
    unwrap(await consume(f, first));
    evidence(f, f.clock.now());
    const second = new ConsumerChannel("same-name", 1);
    second.deliver(accepted(f, 4));
    second.deliver(accepted(f, 5));
    unwrap(await consume(f, second));
    expect(f.engine.diagnostics().watermarks[f.streamId]!.status).toBe("FENCED");
    expect(Object.values(f.engine.diagnostics().consumerLosses)[0]!.observations).toBe(2);
  });
  it("captures loss arriving during the asynchronous read boundary", async () => {
    const f = ready(),
      c = new ConsumerChannel("during-read", 1);
    c.deliver(accepted(f, 2));
    const read = c.read.bind(c);
    c.read = async () => {
      const retained = await read();
      c.deliver(accepted(f, 3));
      c.deliver(accepted(f, 4));
      return retained;
    };
    unwrap(await consume(f, c));
    expect(f.engine.diagnostics().watermarks[f.streamId]!.status).toBe("FENCED");
    expect(f.engine.publishWindow(f.streamId, "M1", t("10:00:00"), true).ok).toBe(false);
  });
  it("unknown scope conservatively fences multiple instruments, subscriptions and providers", async () => {
    const f = ready();
    const ids = [
      f.streamId,
      unwrap(
        f.engine.registerStream({
          ...stream,
          instrumentId: "40000000-0000-4000-8000-000000000009",
          channel: "other-subscription",
        }),
      ),
      unwrap(
        f.engine.registerStream({
          ...stream,
          sourceId: "40000000-0000-4000-8000-000000000008",
          sourceFingerprint: hash("provider-two"),
        }),
      ),
    ];
    for (const id of ids.slice(1))
      unwrap(
        f.engine.watermark(id, {
          sessionId: "session-1",
          through: f.clock.now(),
          observedAt: f.clock.now(),
          coverage: "COMPLETE_COVERAGE",
          kind: "END_OF_STREAM",
          evidenceId: "provider-proof",
          reconciled: true,
        }),
      );
    const c = new ConsumerChannel("mixed", 1);
    c.deliver(accepted(f, 2));
    c.deliver(accepted(f, 3));
    unwrap(await consume(f, c));
    for (const id of ids) expect(f.engine.diagnostics().watermarks[id]!.status).toBe("FENCED");
    unwrap(
      f.engine.watermark(ids[1]!, {
        sessionId: "session-1",
        through: f.clock.now(),
        observedAt: f.clock.now(),
        coverage: "COMPLETE_COVERAGE",
        kind: "END_OF_STREAM",
        evidenceId: "healthy-proof",
        reconciled: true,
      }),
    );
    expect(f.engine.diagnostics().watermarks[f.streamId]!.status).toBe("FENCED");
    expect(f.engine.diagnostics().watermarks[ids[2]!]!.status).toBe("FENCED");
  });
  it("scoped observation warnings fence their source without degrading unrelated scopes", async () => {
    const f = ready(),
      other = unwrap(
        f.engine.registerStream({
          ...stream,
          instrumentId: "40000000-0000-4000-8000-000000000007",
        }),
      );
    unwrap(
      f.engine.watermark(other, {
        sessionId: "session-1",
        through: f.clock.now(),
        observedAt: f.clock.now(),
        coverage: "COMPLETE_COVERAGE",
        kind: "END_OF_STREAM",
        evidenceId: "other-proof",
        reconciled: true,
      }),
    );
    const c = new ConsumerChannel("scoped", 1);
    c.deliver({ ...accepted(f, 2), warnings: ["CONTINUITY_UNCERTAIN"] });
    unwrap(await consume(f, c));
    expect(f.engine.diagnostics().watermarks[f.streamId]!.status).toBe("FENCED");
    expect(f.engine.diagnostics().watermarks[other]!.status).toBe("CONTINUOUS");
  });
  it("unscoped degradation with no counter still fences and remains visible", async () => {
    const f = ready(),
      c = new ConsumerChannel("unknown", 1);
    c.degraded = true;
    expect(unwrap(await consume(f, c))).toBe(0);
    expect(f.engine.diagnostics().watermarks[f.streamId]!.status).toBe("FENCED");
    expect(Object.values(f.engine.diagnostics().consumerLosses)[0]!.degraded).toBe(true);
  });
  it("clearing queued observations during close is treated as loss", async () => {
    const f = ready(),
      c = new ConsumerChannel("closed", 1);
    c.deliver(accepted(f, 2));
    expect(c.close()).toBe(1);
    unwrap(await consume(f, c));
    expect(f.engine.diagnostics().watermarks[f.streamId]!.status).toBe("FENCED");
    expect(Object.values(f.engine.diagnostics().consumerLosses)[0]!.discarded).toBe(1);
  });
  it("no-loss normal operations retain complete watermark authority", async () => {
    const f = ready(),
      c = new ConsumerChannel("healthy", 2);
    c.deliver(accepted(f, 2));
    expect(unwrap(await consume(f, c))).toBe(1);
    expect(f.engine.diagnostics().watermarks[f.streamId]!.status).toBe("CONTINUOUS");
    expect(f.engine.publishWindow(f.streamId, "M1", t("10:00:00"), true).ok).toBe(true);
    expect(f.engine.diagnostics().consumerLosses).toEqual({});
  });
  it("loss evidence survives recovery and never auto-clears on channel drain", async () => {
    const f = ready(),
      c = new ConsumerChannel("recovery", 1);
    c.deliver(accepted(f, 2));
    c.deliver(accepted(f, 3));
    unwrap(await consume(f, c));
    const saved = f.engine.diagnostics().consumerLosses;
    const r = restart(f);
    unwrap(r.start());
    expect(r.diagnostics().consumerLosses).toEqual(saved);
    expect(r.diagnostics().watermarks[f.streamId]!.status).toBe("FENCED");
    unwrap(await consumeRealtime(r, c, f.streamId, stream.sourceFingerprint, "realtime", 1));
    expect(r.diagnostics().watermarks[f.streamId]!.status).toBe("FENCED");
  });
  it("known loss fences newly registered potentially affected scopes", async () => {
    const f = ready(),
      c = new ConsumerChannel("registration", 1);
    c.degraded = true;
    unwrap(await consume(f, c));
    const other = unwrap(f.engine.registerStream({ ...stream, basis: "ASK" }));
    unwrap(
      f.engine.watermark(other, {
        sessionId: "session-1",
        through: f.clock.now(),
        observedAt: f.clock.now(),
        coverage: "COMPLETE_COVERAGE",
        kind: "END_OF_STREAM",
        evidenceId: "new-proof",
        reconciled: true,
      }),
    );
    unwrap(await consume(f, c));
    expect(f.engine.diagnostics().watermarks[other]!.status).toBe("FENCED");
  });
  it("durable loss bounds fail closed instead of truncating obligations", async () => {
    const f = fixture(["M1"], { maxEvidence: 1 });
    const a = new ConsumerChannel("first", 1);
    a.degraded = true;
    unwrap(await consume(f, a));
    const b = new ConsumerChannel("second", 1);
    b.degraded = true;
    expect(await consume(f, b)).toMatchObject({
      ok: false,
      error: { code: "CONSUMER_LOSS_LIMIT" },
    });
    expect(f.engine.diagnostics().ready).toBe(false);
    expect(f.engine.stop().ok).toBe(false);
    expect(Object.keys(f.engine.diagnostics().consumerLosses)).toHaveLength(1);
  });
  it("cannot report a healthy engine when the loss fence cannot be committed", async () => {
    let fail = false;
    const f = fixture(["M1"], {}, (clock) => {
      const repo = new MemoryAggregationRepository(clock);
      return {
        commit: (...args) =>
          fail
            ? {
                ok: false,
                error: { code: "CAPACITY", timestamp: clock.now() },
                commitment: "CONFIRMED_NOT_COMMITTED",
              }
            : repo.commit(...args),
        publish: (...args) => repo.publish(...args),
        recover: (context) => repo.recover(context),
      };
    });
    unwrap(f.engine.ingest(f.streamId, observation(t("10:00:01"), 1)));
    evidence(f, f.clock.now());
    fail = true;
    const c = new ConsumerChannel("failure", 1);
    c.degraded = true;
    expect((await consume(f, c)).ok).toBe(false);
    expect(f.engine.diagnostics().ready).toBe(false);
    expect(f.engine.publishWindow(f.streamId, "M1", t("10:00:00"), true).ok).toBe(false);
    expect(f.engine.stop().ok).toBe(false);
  });
  it("consumer loss during hierarchical aggregation blocks parent finality and permits truthful provisional evidence", async () => {
    const f = ready([
      { child: "M1", parent: "M5" },
      { child: "M5", parent: "M15" },
    ]);
    unwrap(f.engine.publishWindow(f.streamId, "M1", t("10:00:00"), true));
    const c = new ConsumerChannel("hierarchy", 1);
    c.deliver(accepted(f, 2));
    c.deliver(accepted(f, 3));
    unwrap(await consume(f, c));
    for (const tf of ["M1", "M5", "M15"])
      expect(f.engine.publishWindow(f.streamId, tf, t("10:00:00"), true).ok).toBe(false);
    const histories = f.engine.diagnostics().revisionCount;
    expect(histories).toBeGreaterThan(1);
  });
});
describe("CODEX-003B M01/M02/L01 qualified policies", () => {
  it("AS_KNOWN retains latest eligible verified data but warns about a known ineligible successor", () => {
    const f = ready();
    const old = unwrap(f.engine.publishWindow(f.streamId, "M1", t("10:00:00"), true));
    const before = {
      streamId: f.streamId,
      timeframes: ["M1"],
      asOf: f.clock.now(),
      cutoff: f.clock.now(),
    };
    const original = unwrap(f.engine.snapshot(before));
    set(f, t("12:00:01"));
    unwrap(
      f.engine.ingest(f.streamId, { ...observation(t("10:00:02"), 2, "9"), origin: "HISTORICAL" }),
    );
    const current = unwrap(
      f.engine.snapshot({ ...before, asOf: f.clock.now(), cutoff: f.clock.now() }),
    );
    expect(current.selected.M1!.revisionId).toBe(old);
    expect(current.warnings).toEqual({ M1: "KNOWN_INELIGIBLE_SUCCESSOR" });
    expect(unwrap(f.engine.snapshot(before))).toEqual(original);
    const reconstruction = unwrap(
      f.engine.snapshot({
        ...before,
        asOf: f.clock.now(),
        cutoff: f.clock.now(),
        evidenceClass: "EVENT_TIME_RECONSTRUCTION",
      }),
    );
    expect(reconstruction.selected.M1!.high).toBe("9");
    expect(reconstruction.warnings).toBeUndefined();
  });
  it("hierarchical AS_KNOWN cannot mix a current child and a superseded parent", () => {
    const f = ready([{ child: "M1", parent: "M5" }]);
    unwrap(f.engine.publishWindow(f.streamId, "M1", t("10:00:00"), true));
    unwrap(f.engine.publishWindow(f.streamId, "M5", t("10:00:00"), true));
    set(f, t("12:00:01"));
    unwrap(
      f.engine.ingest(f.streamId, { ...observation(t("10:00:02"), 2, "9"), origin: "HISTORICAL" }),
    );
    const snap = unwrap(
      f.engine.snapshot({
        streamId: f.streamId,
        timeframes: ["M1", "M5"],
        asOf: f.clock.now(),
        cutoff: f.clock.now(),
        includeIncomplete: true,
      }),
    );
    expect(snap.warnings?.M1).toBe("KNOWN_INELIGIBLE_SUCCESSOR");
    expect(snap.missing.M5).toBe("REVISION_CONFLICT");
  });
  it("INITIAL_ONLY intentionally selects eligible original without an AS_KNOWN warning", () => {
    const f = ready();
    const initial = unwrap(f.engine.publishWindow(f.streamId, "M1", t("10:00:00"), true));
    set(f, t("12:00:01"));
    unwrap(f.engine.ingest(f.streamId, observation(t("10:00:02"), 2, "9")));
    const snap = unwrap(
      f.engine.snapshot({
        streamId: f.streamId,
        timeframes: ["M1"],
        asOf: f.clock.now(),
        cutoff: f.clock.now(),
        correctionPolicy: "INITIAL_ONLY",
      }),
    );
    expect(snap.selected.M1!.revisionId).toBe(initial);
    expect(snap.warnings).toBeUndefined();
  });
  it("point-in-time revision guarantee is within current registry context, not bitemporal registration", () => {
    const f = ready(),
      scope = { ...stream, instrumentId: "40000000-0000-4000-8000-000000000099" };
    const req = {
      streamId: hash(scope),
      timeframes: ["M1"],
      asOf: f.clock.now(),
      cutoff: f.clock.now(),
    };
    expect(f.engine.snapshot(req)).toMatchObject({ ok: false, error: { code: "SOURCE_MISMATCH" } });
    set(f, t("12:00:05"));
    unwrap(f.engine.registerStream(scope));
    const s = unwrap(f.engine.snapshot(req));
    expect(s.selected).toEqual({});
    expect(s.missing.M1).toBe("NO_ELIGIBLE_REVISION");
    expect(s.sourceFingerprint).toBe(scope.sourceFingerprint);
  });
  it("rejects an incompatible required volume class before retaining the unusable contribution", () => {
    const f = ready(),
      id = unwrap(f.engine.publishWindow(f.streamId, "M1", t("10:00:00"), true)),
      bar = canonicalBar(f.engine.readRevision(id)!);
    const invalid = marketObservationSchema.parse({
      ...bar,
      volumes: [{ volumeType: "TRADE_VOLUME", quantity: { value: "1", unit: "ASSET_UNITS" } }],
    });
    const target = fixture(["M5"]);
    const input: Input = {
      ...observation(t("10:00:00"), 2),
      observation: invalid,
      identity: bar.observationId,
    };
    expect(target.engine.ingest(target.streamId, input)).toMatchObject({
      ok: false,
      error: { code: "VOLUME_MISSING" },
    });
    expect(target.engine.diagnostics().windowCount).toBe(0);
  });
});
import { marketObservationSchema, marketDataCorrectionSchema } from "@ate/domain";

describe("CODEX-003B supported consumer and correction boundaries", () => {
  it("closed empty channels are conservatively fenced without inventing an exact dropped count", async () => {
    const f = ready(),
      c = new ConsumerChannel("closed-empty", 1);
    c.close();
    unwrap(await consume(f, c));
    expect(f.engine.diagnostics().watermarks[f.streamId]!.status).toBe("FENCED");
    expect(Object.values(f.engine.diagnostics().consumerLosses)[0]).toMatchObject({
      discarded: 0,
      closed: true,
      scope: "UNKNOWN_CHANNEL_SCOPE",
    });
  });
  it("keeps native corrected-trade records outside observation ingestion with structured rejection", () => {
    const f = ready(),
      a = observation(t("10:00:01"), 1).observation,
      b = observation(t("10:00:02"), 2).observation;
    const correction = marketDataCorrectionSchema.parse({
      schemaVersion: 1,
      correctionId: observation(t("10:00:03"), 3).observation.observationId,
      originalObservationId: a.observationId,
      replacementObservationId: b.observationId,
      correctedAt: f.clock.now(),
      source: a.source,
      provenance: a.provenance,
      metadata: {},
    });
    expect(
      f.engine.ingest(f.streamId, {
        ...observation(t("10:00:04"), 4),
        observation: correction as unknown as Input["observation"],
      }),
    ).toMatchObject({ ok: false, error: { code: "INPUT_REJECTED" } });
  });
});

describe("CODEX-003B queue-clearing loss", () => {
  it("detects cleared accepted backlog even while the channel remains open", async () => {
    const f = ready(),
      c = new ConsumerChannel("open-cleared", 1);
    c.deliver(accepted(f, 2));
    expect(c.queue.clear()).toBe(1);
    unwrap(await consume(f, c));
    expect(f.engine.diagnostics().watermarks[f.streamId]!.status).toBe("FENCED");
    expect(Object.values(f.engine.diagnostics().consumerLosses)[0]!.discarded).toBe(1);
    evidence(f, f.clock.now());
    unwrap(await consume(f, c));
    expect(f.engine.diagnostics().watermarks[f.streamId]!.status).toBe("CONTINUOUS");
  });
});
