import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { VirtualClock } from "@ate/time";
import {
  ReplayController,
  FilesystemReplayCheckpointRepository,
  immutableReplayInputs,
  type ReplayCheckpointRepository,
  type ReplayCommandResult,
} from "@ate/market-replay";
import { replayFixture, t, observation } from "./fixtures.js";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function setup() {
  const f = replayFixture();
  const root = mkdtempSync(join(tmpdir(), "ate-replay-"));
  roots.push(root);
  const storageClock = new VirtualClock(t("13:00:00"));
  const repository = new FilesystemReplayCheckpointRepository(
    root,
    storageClock,
    f.spec.resourceLimits,
  );
  const controller = new ReplayController(f.spec, f.inputs, repository);
  return { ...f, root, storageClock, repository, controller };
}
function check(r: ReplayCommandResult) {
  if (!r.ok) throw Error(r.code);
  return r.checkpoint;
}
describe("replay cursor and aggregate transaction", () => {
  it("completes event stepping with no lookahead between equal-time events", async () => {
    const f = setup();
    check(await f.controller.initialize());
    const one = check(await f.controller.stepEvent());
    expect(one.cursor).toBe(1);
    expect(one.timestampComplete).toBe(false);
    expect(
      one.aggregation.windows.flatMap((w) => w.contributions).every((c) => c.identity === "1"),
    ).toBe(true);
    const two = check(await f.controller.stepEvent());
    expect(two.timestampComplete).toBe(true);
    expect(two.cursor).toBe(2);
    expect(check(await f.controller.stepEvent()).state).toBe("RUNNING");
    const complete = check(await f.controller.stepEvent());
    expect(complete.state).toBe("COMPLETED");
    expect(complete.logicalTime).toBe(f.spec.endTime);
  });
  it("reconstructs historical receivedAt without granting verified availability", async () => {
    const f = setup();
    const original = replayFixture(undefined, [
      { input: observation(t("10:00:00"), 1, "1", t("11:00:00")) },
    ]);
    const c = new ReplayController(original.spec, original.inputs, f.repository);
    check(await c.initialize());
    const cp = check(await c.stepEvent());
    const contributions = cp.aggregation.windows.flatMap((w) => w.contributions);
    expect(contributions.length).toBeGreaterThan(0);
    expect(
      contributions.every((c) => c.receivedAt === t("11:00:00") && c.availability === "UNKNOWN"),
    ).toBe(true);
  });
  it("recovers a partial timestamp in a fresh controller without repeating its prefix", async () => {
    const f = setup();
    check(await f.controller.initialize());
    check(await f.controller.stepEvent());
    const fresh = new ReplayController(f.spec, f.inputs, f.repository);
    expect(check(await fresh.initialize()).cursor).toBe(1);
    const cp = check(await fresh.stepTimestamp());
    expect(cp.cursor).toBe(2);
    expect(
      cp.aggregation.windows
        .filter((w) => w.timeframe === "M1")[0]
        ?.contributions.map((c) => c.identity),
    ).toEqual(["1", "2"]);
  });
  it("produces identical semantic state under timestamp and event stepping", async () => {
    const a = setup(),
      b = setup();
    check(await a.controller.initialize());
    check(await b.controller.initialize());
    check(await a.controller.runToEnd());
    while (b.controller.diagnostics().state !== "COMPLETED") check(await b.controller.stepEvent());
    expect(a.controller.semanticFingerprint()).toBe(b.controller.semanticFingerprint());
  });
  it("blocks automatic progression while paused and persists resume", async () => {
    const f = setup();
    check(await f.controller.initialize());
    check(await f.controller.pause());
    expect(await f.controller.runToEnd()).toMatchObject({ ok: false, code: "SESSION_PAUSED" });
    check(await f.controller.stepEvent());
    expect(f.controller.diagnostics().state).toBe("PAUSED");
    check(await f.controller.resume());
    expect(check(await f.controller.runToEnd()).state).toBe("COMPLETED");
  });
  it("preserves publication failures across repeated stop and fresh recovery", async () => {
    const f = setup();
    check(await f.controller.initialize());
    let fail = true;
    const faulty: ReplayCheckpointRepository = {
      commit: (c) => f.repository.commit(c),
      recover: (s) => f.repository.recover(s),
      publish: (id) =>
        fail
          ? { ok: false, code: "INJECTED_POST_CONTENT", commitment: "COMMITTED", operationId: id }
          : f.repository.publish(id),
    };
    const c = new ReplayController(f.spec, f.inputs, faulty);
    check(await c.initialize());
    expect(await c.stepEvent()).toMatchObject({ ok: false, state: "RECOVERY_REQUIRED" });
    expect(await c.stop()).toMatchObject({ ok: false, code: "RECOVERY_OBLIGATION" });
    expect(await c.stop()).toMatchObject({ ok: false, code: "RECOVERY_OBLIGATION" });
    fail = false;
    const fresh = new ReplayController(f.spec, f.inputs, f.repository);
    expect(check(await fresh.initialize()).cursor).toBe(1);
    expect(check(await fresh.stepEvent()).cursor).toBe(2);
  });
  it("does not advance the visible cursor on certified pre-write rejection", async () => {
    const f = setup();
    check(await f.controller.initialize());
    const faulty: ReplayCheckpointRepository = {
      commit: (c) => ({
        ok: false,
        code: "CAPACITY",
        commitment: "CONFIRMED_NOT_COMMITTED",
        operationId: c.checkpointId,
      }),
      publish: (id) => f.repository.publish(id),
      recover: (s) => f.repository.recover(s),
    };
    const c = new ReplayController(f.spec, f.inputs, faulty);
    check(await c.initialize());
    expect(await c.stepEvent()).toMatchObject({ ok: false, code: "CAPACITY" });
    expect(c.currentCheckpoint()?.cursor).toBe(0);
    expect(c.diagnostics().obligation).toBeNull();
  });
  it("detects manifest mutation before progress without acknowledging input", async () => {
    const f = setup();
    let mutation = false;
    const inputs = immutableReplayInputs(f.inputs.manifests, () =>
      mutation ? Promise.reject(Error("SOURCE_CHANGED")) : Promise.resolve(),
    );
    const c = new ReplayController(f.spec, inputs, f.repository);
    check(await c.initialize());
    mutation = true;
    expect(await c.stepEvent()).toMatchObject({ ok: false, state: "FAILED" });
    expect(c.currentCheckpoint()?.cursor).toBe(0);
  });
  it("rejects reentrant advancement during source verification", async () => {
    const f = setup();
    let nested: ReplayCommandResult | undefined;
    let initializing = true;
    const inputs = immutableReplayInputs(f.inputs.manifests, async () => {
      if (!initializing) nested = await c.stepEvent();
    });
    const c = new ReplayController(f.spec, inputs, f.repository);
    check(await c.initialize());
    initializing = false;
    check(await c.stepEvent());
    expect(nested).toMatchObject({ ok: false, code: "REENTRANT_OPERATION" });
  });
  it("rejects corrupt content on recovery instead of publishing it", async () => {
    const f = setup();
    check(await f.controller.initialize());
    const file = readdirSync(f.root).find((n) => n.endsWith(".json"))!;
    const content = readFileSync(join(f.root, file), "utf8");
    writeFileSync(join(f.root, file), content.replace('"cursor":0', '"cursor":1'));
    const fresh = new ReplayController(f.spec, f.inputs, f.repository);
    expect(await fresh.initialize()).toMatchObject({ ok: false, state: "RECOVERY_REQUIRED" });
  });
  it("preserves a failed reentrant shutdown until an explicit settling stop", async () => {
    const f = setup();
    let stopping = false;
    let result: ReplayCommandResult | undefined;
    const inputs = immutableReplayInputs(f.inputs.manifests, async () => {
      if (stopping) result = await c.stop();
    });
    const c = new ReplayController(f.spec, inputs, f.repository);
    check(await c.initialize());
    stopping = true;
    expect(await c.stepEvent()).toMatchObject({ ok: false, code: "STOP_REQUESTED" });
    expect(result).toMatchObject({ ok: false, code: "SHUTDOWN_IN_PROGRESS" });
    stopping = false;
    expect(check(await c.stop()).state).toBe("STOPPED");
    expect(check(await c.stop()).state).toBe("STOPPED");
  });
});
