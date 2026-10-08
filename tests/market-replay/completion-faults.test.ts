import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";
import { VirtualClock, DeterministicScheduler } from "@ate/time";
import { hash } from "@ate/multitimeframe";
import { ConsumerChannel } from "@ate/realtime-data";
import {
  ReplayController,
  FilesystemReplayCheckpointRepository,
  createReplaySpecification,
  createReplayCheckpoint,
  type ReplayCommandResult,
  type ReplayCheckpointRepository,
} from "@ate/market-replay";
import { replayFixture, stream, t } from "./fixtures.js";
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
const ok = (r: ReplayCommandResult) => {
  if (!r.ok) throw Error(r.code);
  return r.checkpoint;
};
async function setup(changes: Record<string, unknown> = {}) {
  const f = replayFixture();
  const { fingerprint: _fp, ...raw } = f.spec;
  const spec = createReplaySpecification({ ...raw, ...changes });
  const root = mkdtempSync(join(tmpdir(), "ate-completion-fault-"));
  roots.push(root);
  const clock = new VirtualClock(t("13:00:00"));
  const repository = new FilesystemReplayCheckpointRepository(root, clock, spec.resourceLimits);
  const c = new ReplayController(spec, f.inputs, repository);
  ok(await c.initialize());
  return { ...f, spec, root, clock, repository, c };
}
describe("remaining completion and adversarial obligations", () => {
  it("leaves pending descriptors and prior cursor intact when scheduled cancellation fails", async () => {
    const f = await setup({
      tasks: [
        {
          taskId: "invalid-final",
          dueAt: t("10:00:00"),
          action: {
            kind: "PUBLISH",
            streamId: hash(stream),
            timeframe: "M1",
            eventAt: t("10:00:00"),
            final: true,
          },
        },
        {
          taskId: "remaining-snapshot",
          dueAt: t("10:00:00"),
          action: {
            kind: "SNAPSHOT",
            streamId: hash(stream),
            timeframes: ["M1"],
            includeIncomplete: false,
          },
        },
      ],
    });
    const prior = f.c.currentCheckpoint();
    const cancel = vi.spyOn(DeterministicScheduler.prototype, "cancel").mockReturnValue(false);
    const stop = vi.spyOn(DeterministicScheduler.prototype, "stop");
    expect(await f.c.runToTime(t("10:00:00"))).toMatchObject({ ok: false, state: "FAILED" });
    expect(cancel).toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
    expect(f.c.currentCheckpoint()).toEqual(prior);
    expect(await f.c.stop()).toMatchObject({ ok: false });
    const fresh = new ReplayController(f.spec, f.inputs, f.repository);
    expect(ok(await fresh.initialize()).pendingTasks).toHaveLength(2);
  });
  it("rejects checkpoint capacity exhaustion while retaining exact durable history", async () => {
    const base = replayFixture();
    const f = await setup({ resourceLimits: { ...base.spec.resourceLimits, maxCheckpoints: 1 } });
    expect(await f.c.stepEvent()).toMatchObject({ ok: false });
    expect(f.c.currentCheckpoint()?.cursor).toBe(0);
    const fresh = new ReplayController(f.spec, f.inputs, f.repository);
    expect(ok(await fresh.initialize()).cursor).toBe(0);
  });
  it("does not evict evidence when channel admission exceeds retention", async () => {
    const base = replayFixture();
    const f = await setup({
      resourceLimits: { ...base.spec.resourceLimits, maxEvidenceRecords: 1 },
    });
    expect(
      await f.c.observeConsumerChannel(new ConsumerChannel("bounded", 1), "capture"),
    ).toMatchObject({ ok: false });
    expect(f.c.currentCheckpoint()?.evidence).toEqual([]);
  });
  it("retains an admission failure when the first durable guard cannot be written", async () => {
    const f = await setup();
    const faulty: ReplayCheckpointRepository = {
      recover: (s) => f.repository.recover(s),
      publish: (id) => f.repository.publish(id),
      commit: (cp) => ({
        ok: false,
        code: "GUARD_FAILED",
        operationId: cp.checkpointId,
        commitment: "CONFIRMED_NOT_COMMITTED",
      }),
    };
    const c = new ReplayController(f.spec, f.inputs, faulty);
    ok(await c.initialize());
    expect(
      await c.observeConsumerChannel(new ConsumerChannel("guard", 1), "capture"),
    ).toMatchObject({ ok: false, code: "GUARD_FAILED" });
    expect(await c.stop()).toMatchObject({ ok: false, code: "RECOVERY_OBLIGATION" });
    expect(c.diagnostics().obligation?.commitment).toBe("CHANNEL_ADMISSION_UNACKNOWLEDGED");
  });
  it("rejects competing output identities at the same session generation", async () => {
    const f = await setup();
    const cp = f.c.currentCheckpoint()!;
    expect(
      f.repository.commit(createReplayCheckpoint({ ...cp, generation: 2, state: "PAUSED" })).ok,
    ).toBe(true);
    expect(
      f.repository.commit(createReplayCheckpoint({ ...cp, generation: 2, state: "STOPPED" })),
    ).toMatchObject({ ok: false });
    expect(ok(await new ReplayController(f.spec, f.inputs, f.repository).initialize()).state).toBe(
      "PAUSED",
    );
  });
  it("rejects changed configuration on fresh resume without modifying artifacts", async () => {
    const f = await setup();
    ok(await f.c.pause());
    const before = readdirSync(f.root).map((n) => readFileSync(join(f.root, n), "utf8"));
    const { fingerprint: _fp, ...raw } = f.spec;
    const changed = createReplaySpecification({ ...raw, configurationFingerprint: hash("drift") });
    expect(await new ReplayController(changed, f.inputs, f.repository).initialize()).toMatchObject({
      ok: false,
    });
    expect(readdirSync(f.root).map((n) => readFileSync(join(f.root, n), "utf8"))).toEqual(before);
  });
  it("rejects corrupted persisted owner content rather than trusting a commit marker", async () => {
    const f = await setup();
    const path = join(
      f.root,
      readdirSync(f.root).find((n) => n.endsWith(".json"))!,
    );
    const content = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    content.checkpoint = {};
    writeFileSync(path, JSON.stringify(content));
    expect(await new ReplayController(f.spec, f.inputs, f.repository).initialize()).toMatchObject({
      ok: false,
      state: "RECOVERY_REQUIRED",
    });
    expect(readFileSync(path, "utf8")).toContain('"checkpoint":{}');
  });
  it("does not complete with an unresolved publication marker", async () => {
    const f = await setup();
    const faulty: ReplayCheckpointRepository = {
      recover: (s) => f.repository.recover(s),
      commit: (cp) => f.repository.commit(cp),
      publish: (id) => ({
        ok: false,
        code: "PUBLICATION_PENDING",
        operationId: id,
        commitment: "UNKNOWN_COMMITMENT",
      }),
    };
    const c = new ReplayController(f.spec, f.inputs, faulty);
    ok(await c.initialize());
    expect(await c.runToEnd()).toMatchObject({ ok: false, state: "RECOVERY_REQUIRED" });
    expect(c.diagnostics().state).not.toBe("COMPLETED");
    expect(await c.stop()).toMatchObject({ ok: false });
  });
});
