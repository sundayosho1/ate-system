import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, afterEach } from "vitest";
import { VirtualClock } from "@ate/time";
import {
  AggregationEngine,
  MemoryAggregationRepository,
  TimeframeRegistry,
  utcCalendar,
  defaultOptions,
  hash,
} from "@ate/multitimeframe";
import {
  FilesystemCaptureRepository,
  type AcceptedObservation,
  type CaptureManifest,
} from "@ate/realtime-data";
import { resolveCaptureReplayInputs, defaultReplayLimits } from "@ate/market-replay";
import { t, observation, stream } from "./fixtures.js";
import { config } from "../multitimeframe/fixtures.js";
const roots: string[] = [];
afterEach(() => {
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
function engine(mode: "VIRTUAL" | "REPLAY" = "REPLAY") {
  const clock = new VirtualClock(t("10:00:00"), mode);
  const repository = new MemoryAggregationRepository(clock);
  const input = {
    clock,
    repository,
    registry: new TimeframeRegistry(),
    calendar: utcCalendar,
    configurationFingerprint: config,
    options: { ...defaultOptions, enabled: true },
    directTimeframes: ["M1"],
  };
  return { clock, repository, input, engine: new AggregationEngine(input) };
}
function ok<T>(r: { ok: true; value: T } | { ok: false; error: { code: string } }): T {
  if (!r.ok) throw Error(r.error.code);
  return r.value;
}
describe("replay owner authority extensions", () => {
  it("permits exact replay checkpoint restore while normal recovery retains continuity fencing", () => {
    const f = engine();
    ok(f.engine.start());
    const id = ok(f.engine.registerStream(stream));
    ok(f.engine.ingestReplay(id, observation(t("10:00:00"), 1), "VERIFIED_POINT_IN_TIME"));
    ok(
      f.engine.watermark(id, {
        sessionId: "session-1",
        through: t("10:00:00"),
        observedAt: t("10:00:00"),
        coverage: "COMPLETE_COVERAGE",
        kind: "CONTINUITY",
        evidenceId: "source-evidence",
        reconciled: true,
      }),
    );
    const cp = ok(f.engine.exportReplayCheckpoint());
    const normal = new AggregationEngine(f.input);
    ok(normal.start());
    expect(ok(normal.exportReplayCheckpoint()).watermarks[id]?.status).toBe("FENCED");
    const restored = new AggregationEngine({
      ...f.input,
      repository: new MemoryAggregationRepository(f.clock),
    });
    ok(restored.startFromReplayCheckpoint(cp, f.clock.now()));
    expect(ok(restored.exportReplayCheckpoint())).toEqual(cp);
  });
  it("rejects replay restore and ingest outside replay mode", () => {
    const f = engine("VIRTUAL");
    ok(f.engine.start());
    const id = ok(f.engine.registerStream(stream));
    expect(
      f.engine.ingestReplay(id, observation(t("10:00:00"), 1), "EVENT_TIME_RECONSTRUCTION"),
    ).toMatchObject({ ok: false });
    expect(f.engine.exportReplayCheckpoint()).toMatchObject({ ok: false });
  });
  it("rejects mismatched replay restore boundary and corrupt owner state", () => {
    const f = engine();
    ok(f.engine.start());
    ok(f.engine.registerStream(stream));
    const cp = ok(f.engine.exportReplayCheckpoint());
    const b = engine();
    expect(b.engine.startFromReplayCheckpoint(cp, t("10:01:00"))).toMatchObject({ ok: false });
    const c = engine();
    expect(
      c.engine.startFromReplayCheckpoint({ ...cp, generation: cp.generation + 1 }, t("10:00:00")),
    ).toMatchObject({ ok: false });
  });
  it("ordinary ingest still rejects future receipts; reconstruction preserves them as unknown", () => {
    const f = engine();
    ok(f.engine.start());
    const id = ok(f.engine.registerStream(stream));
    const future = observation(t("10:00:00"), 1, "1", t("11:00:00"));
    expect(f.engine.ingest(id, future)).toMatchObject({ ok: false });
    ok(f.engine.ingestReplay(id, future, "EVENT_TIME_RECONSTRUCTION"));
    expect(ok(f.engine.exportReplayCheckpoint()).windows[0]?.contributions[0]?.availability).toBe(
      "UNKNOWN",
    );
  });
  it("reads only complete verified capture records and retains capture-only qualification", async () => {
    const clock = new VirtualClock(t("10:00:00"));
    const root = mkdtempSync(join(tmpdir(), "ate-replay-capture-"));
    roots.push(root);
    const repository = new FilesystemCaptureRepository(root, clock, 1048576, 16);
    const input = observation(t("10:00:00"), 1);
    const manifest: CaptureManifest = {
      captureId: "capture-1",
      source: input.observation.source,
      adapterId: "fixture",
      adapterVersion: "1",
      configurationFingerprint: config,
      startedAt: clock.now(),
      state: "RUNNING",
      sessionIds: ["session-1"],
      subscriptions: [
        {
          subscriptionId: "quotes",
          sourceId: stream.sourceId,
          instrumentId: stream.instrumentId,
          providerSymbol: "FIXTURE",
          observationKind: "QUOTE",
          mode: "STREAM",
          expectedActivity: false,
        },
      ],
      count: 0,
      bytes: 0,
      evidence: { rejected: 0, duplicates: 0, late: 0, gaps: 0, overflow: 0 },
      storageReference: "capture-1",
    };
    ok(repository.start(manifest));
    expect(repository.readRecords("capture-1", 1)).toMatchObject({ ok: false });
    const accepted: AcceptedObservation = {
      ingress: {
        ingressId: "ingress-1",
        sourceId: stream.sourceId,
        adapterId: "fixture",
        adapterVersion: "1",
        sessionId: "session-1",
        subscriptionId: "quotes",
        providerSymbol: "FIXTURE",
        observationKind: "QUOTE",
        receivedAt: clock.now(),
        localSequence: 1,
        payloadFingerprint: hash(input.observation),
        configurationFingerprint: config,
      },
      observation: input.observation,
      processedAt: clock.now(),
      warnings: [],
    };
    ok(repository.append("capture-1", accepted));
    const handoff = ok(repository.finish("capture-1", manifest.evidence));
    expect(handoff.researchQualified).toBe(false);
    expect(ok(repository.readRecords("capture-1", 1)).records).toEqual([accepted]);
    expect(repository.readRecords("capture-1", 0)).toMatchObject({ ok: false });
    expect(repository.readRecords("capture-1", 1, 2)).toMatchObject({ ok: false });
    const resolved = await resolveCaptureReplayInputs({
      manifestId: "capture-input",
      repository,
      captureId: "capture-1",
      scopes: [stream],
      sourceFingerprint: stream.sourceFingerprint,
      calendarFingerprint: hash("calendar"),
      limits: defaultReplayLimits,
    });
    expect(resolved.manifests[0]?.kind).toBe("CAPTURE");
    expect(resolved.manifests[0]?.records[0]?.input.origin).toBe("REALTIME");
    await resolved.verify();
  });
});
