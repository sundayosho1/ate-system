import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VirtualClock } from "@ate/time";
import { replayFixture } from "./fixtures.js";
import { describe, it, expect } from "vitest";
import { CalendarBoundaryResolver, utcCalendar, hash } from "@ate/multitimeframe";
import {
  resolveAggregateReplayInputs,
  defaultReplayLimits,
  createReplayInputManifest,
  immutableReplayInputs,
  createReplaySpecification,
  ReplayController,
  FilesystemReplayCheckpointRepository,
} from "@ate/market-replay";
import { fixture, observation, t, unwrap, evidence, stream } from "../multitimeframe/fixtures.js";
function source() {
  const f = fixture(["M1"]);
  unwrap(f.engine.ingest(f.streamId, observation(t("11:59:00"), 1)));
  evidence(f, t("12:00:00"));
  const revision = unwrap(f.engine.publishWindow(f.streamId, "M1", t("11:59:00"), true));
  return { ...f, revision };
}
function options(f: ReturnType<typeof source>) {
  return {
    manifestId: "aggregate-input",
    engine: f.engine,
    request: {
      streamId: f.streamId,
      timeframes: ["M1"],
      asOf: t("12:00:00"),
      cutoff: t("12:00:00"),
    },
    stream,
    calendarFingerprint: new CalendarBoundaryResolver(utcCalendar).fingerprint,
    expectedRevisionIds: [f.revision],
    limits: defaultReplayLimits,
  };
}
describe("owner-selected aggregate replay sources", () => {
  it("retains committed revision, publication, lineage and quality evidence", async () => {
    const f = source();
    const inputs = resolveAggregateReplayInputs(options(f));
    const record = inputs.manifests[0]?.records[0];
    expect(record?.input.observation.observationKind).toBe("BAR");
    expect(record?.evidence?.kind).toBe("AGGREGATE_PUBLICATION");
    expect(record?.input.sourcePublishedAt).toBe(t("12:00:00"));
    expect(record?.input.observation.metadata["aggregation.revision"]).toBe(f.revision);
    expect(
      record?.input.observation.metadata["aggregation.qualitymanifestfingerprint"],
    ).toBeTruthy();
    await inputs.verify();
  });
  it("rejects mismatched source and calendar context", () => {
    const f = source();
    expect(() =>
      resolveAggregateReplayInputs({
        ...options(f),
        stream: { ...stream, sourceFingerprint: hash("foreign") },
      }),
    ).toThrow("AGGREGATE_CONTEXT");
    expect(() =>
      resolveAggregateReplayInputs({
        ...options(f),
        calendarFingerprint: hash("foreign-calendar"),
      }),
    ).toThrow("AGGREGATE_CONTEXT");
  });
  it("rejects future/unpublished revision selection and invented revision IDs", () => {
    const f = source();
    expect(() =>
      resolveAggregateReplayInputs({ ...options(f), expectedRevisionIds: [hash("invented")] }),
    ).toThrow("AGGREGATE_SELECTION");
    expect(() =>
      resolveAggregateReplayInputs({
        ...options(f),
        request: { ...options(f).request, cutoff: t("11:59:59") },
      }),
    ).toThrow("AGGREGATE_SELECTION");
  });
  it("rejects corrupt owner read consistency", () => {
    const f = source();
    expect(() =>
      resolveAggregateReplayInputs({
        ...options(f),
        engine: {
          snapshot: (r) => f.engine.snapshot(r),
          readRevision: (id) => ({ ...f.engine.readRevision(id)!, close: "99" }),
        },
      }),
    ).toThrow("AGGREGATE_INTEGRITY");
  });
  it("rejects changed selected evidence during reverification", async () => {
    const f = source();
    let changed = false;
    const inputs = resolveAggregateReplayInputs({
      ...options(f),
      engine: {
        snapshot: (r) => f.engine.snapshot(r),
        readRevision: (id) =>
          changed
            ? { ...f.engine.readRevision(id)!, contentFingerprint: hash("changed") }
            : f.engine.readRevision(id),
      },
    });
    changed = true;
    await expect(inputs.verify()).rejects.toThrow("AGGREGATE_INTEGRITY");
  });
  it("rejects corrupted inherited quality during real replay without acknowledging the input", async () => {
    const f = source();
    const selected = resolveAggregateReplayInputs(options(f));
    const { fingerprint: _fp, contentFingerprint: _content, ...raw } = selected.manifests[0]!;
    const manifest = createReplayInputManifest(
      {
        ...raw,
        records: raw.records.map((r) => ({
          ...r,
          input: {
            ...r.input,
            observation: {
              ...r.input.observation,
              metadata: {
                ...r.input.observation.metadata,
                "aggregation.qualitymanifestfingerprint": hash("corrupt"),
              },
            },
          },
        })),
      },
      defaultReplayLimits,
    );
    const inputs = immutableReplayInputs([manifest]);
    const { fingerprint: _specFp, ...base } = replayFixture("VERIFIED_POINT_IN_TIME").spec;
    const spec = createReplaySpecification({
      ...base,
      sourceManifestIds: [manifest.manifestId],
      datasetFingerprints: [manifest.contentFingerprint],
    });
    const root = mkdtempSync(join(tmpdir(), "ate-replay-quality-corrupt-"));
    try {
      const c = new ReplayController(
        spec,
        inputs,
        new FilesystemReplayCheckpointRepository(
          root,
          new VirtualClock(t("13:00:00")),
          spec.resourceLimits,
        ),
      );
      expect((await c.initialize()).ok).toBe(true);
      expect(await c.runToEnd()).toMatchObject({ ok: false });
      expect(c.diagnostics().lastFailureCode).toBe("INHERITED_QUALITY_INTEGRITY");
      expect(c.currentCheckpoint()?.cursor).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
