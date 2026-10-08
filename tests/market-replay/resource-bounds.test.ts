import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { hash } from "@ate/multitimeframe";
import { VirtualClock } from "@ate/time";
import {
  ReplayController,
  FilesystemReplayCheckpointRepository,
  createReplaySpecification,
  createReplayInputManifest,
  defaultReplayLimits,
  type ReplayCommandResult,
} from "@ate/market-replay";
import { replayFixture, stream, t } from "./fixtures.js";
const roots: string[] = [];
afterEach(() => {
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
const ok = (r: ReplayCommandResult) => {
  if (!r.ok) throw Error(r.code);
  return r.checkpoint;
};
function bounded(limits: Partial<typeof defaultReplayLimits>) {
  const f = replayFixture();
  const { fingerprint: _fp, ...raw } = f.spec;
  const spec = createReplaySpecification({
    ...raw,
    resourceLimits: { ...defaultReplayLimits, ...limits },
  });
  const root = mkdtempSync(join(tmpdir(), "ate-replay-limit-"));
  roots.push(root);
  const c = new ReplayController(
    spec,
    f.inputs,
    new FilesystemReplayCheckpointRepository(
      root,
      new VirtualClock(t("13:00:00")),
      spec.resourceLimits,
    ),
  );
  return { ...f, spec, c };
}
describe("coherent per-operation bounds without evidence eviction", () => {
  it("rejects timestamp cohorts exceeding batch work but permits explicit atomic event stepping", async () => {
    const f = bounded({ maxEventsPerBatch: 1 });
    ok(await f.c.initialize());
    expect(await f.c.stepTimestamp()).toMatchObject({
      ok: false,
      code: "TIMESTAMP_BATCH_CAPACITY",
    });
    expect(f.c.currentCheckpoint()?.cursor).toBe(0);
    expect(ok(await f.c.stepEvent()).cursor).toBe(1);
    expect(ok(await f.c.stepEvent()).cursor).toBe(2);
  });
  it("rejects oversized checkpoint content without acknowledging source cursor", async () => {
    const f = bounded({ maxCheckpointBytes: 4096 });
    ok(await f.c.initialize());
    expect(await f.c.stepTimestamp()).toMatchObject({ ok: false });
    expect(f.c.currentCheckpoint()?.cursor).toBe(0);
  });
  it("rejects snapshot retention overflow without changing its retained evidence", async () => {
    const f = bounded({ maxSnapshots: 1 });
    ok(await f.c.initialize());
    const first = ok(await f.c.snapshot(hash(stream), ["M1"]));
    expect(await f.c.snapshot(hash(stream), ["M1"])).toMatchObject({
      ok: false,
      code: "SNAPSHOT_CAPACITY",
    });
    expect(f.c.currentCheckpoint()?.snapshots).toEqual(first.snapshots);
  });
  it("rejects input-event limits before constructing a replay session", () => {
    const f = replayFixture();
    const { fingerprint: _fp, contentFingerprint: _content, ...raw } = f.manifest;
    expect(() =>
      createReplayInputManifest(raw, { ...defaultReplayLimits, maxEventsPerSession: 1 }),
    ).toThrow("INPUT_EVENT_LIMIT");
  });
  it("rejects bounded input byte overflow", () => {
    const f = replayFixture();
    const { fingerprint: _fp, contentFingerprint: _content, ...raw } = f.manifest;
    expect(() =>
      createReplayInputManifest(
        { ...raw, originReference: "x".repeat(10000) },
        { ...defaultReplayLimits, maxInputBytes: 4096 },
      ),
    ).toThrow();
  });
  it("rejects excess quality references rather than truncating their history", () => {
    const f = replayFixture();
    const { fingerprint: _fp, contentFingerprint: _content, ...raw } = f.manifest;
    expect(() =>
      createReplayInputManifest(
        { ...raw, qualityReferences: Array.from({ length: 129 }, (_, i) => hash({ i })) },
        defaultReplayLimits,
      ),
    ).toThrow();
  });
  it("rejects scheduled descriptor overflow during immutable specification admission", () => {
    const f = replayFixture();
    const { fingerprint: _fp, ...raw } = f.spec;
    expect(() =>
      createReplaySpecification({
        ...raw,
        resourceLimits: { ...defaultReplayLimits, maxPendingTasks: 1 },
        tasks: [1, 2].map((i) => ({
          taskId: `fence-${i}`,
          dueAt: t("10:00:00"),
          action: { kind: "FENCE", streamId: hash(stream), reason: "SOURCE_GAP" },
        })),
      }),
    ).toThrow("REPLAY_SCOPE");
  });
});
