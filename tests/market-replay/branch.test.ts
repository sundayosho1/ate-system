import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, afterEach } from "vitest";
import { VirtualClock } from "@ate/time";
import { hash } from "@ate/multitimeframe";
import {
  ReplayController,
  FilesystemReplayCheckpointRepository,
  FilesystemReplayBranchRegistry,
  createReplaySpecification,
  compareReplayCheckpoints,
  type BranchCreationStage,
  type ReplayCommandResult,
} from "@ate/market-replay";
import { governedFixture } from "./integration-fixtures.js";
import { replayFixture, t } from "./fixtures.js";
const roots: string[] = [];
afterEach(() => {
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
const ok = (r: ReplayCommandResult) => {
  if (!r.ok) throw Error(r.code);
  return r.checkpoint;
};
async function setup() {
  const f = replayFixture();
  const root = mkdtempSync(join(tmpdir(), "ate-branch-"));
  roots.push(root);
  const clock = new VirtualClock(t("13:00:00"));
  const parentRoot = join(root, "parent");
  const repository = new FilesystemReplayCheckpointRepository(
    parentRoot,
    clock,
    f.spec.resourceLimits,
  );
  const parent = new ReplayController(f.spec, f.inputs, repository);
  ok(await parent.initialize());
  ok(await parent.runToTime(t("10:00:00")));
  const { fingerprint: _fingerprint, ...spec } = f.spec;
  const child = createReplaySpecification({
    ...spec,
    sessionId: "child-1",
    configurationFingerprint: hash("changed-policy"),
    aggregation: { ...spec.aggregation, directTimeframes: ["M1"] },
  });
  return { ...f, root, clock, parentRoot, parent, child };
}
describe("durable reconstructed branch lifecycle", () => {
  it("validates configuration branch creation through the existing effective configuration owner", async () => {
    const f = await setup();
    const governed = await governedFixture();
    const { fingerprint: _fp, ...raw } = f.spec;
    const registry = new FilesystemReplayBranchRegistry(
      join(f.root, "branches"),
      f.clock,
      f.spec.resourceLimits,
    );
    const branch = await registry.forkGoverned(
      f.parent,
      {
        ...raw,
        sessionId: "governed-child",
        configurationFingerprint: governed.configuration.fingerprint,
      },
      f.inputs,
      governed.configuration,
    );
    expect(branch.ok).toBe(true);
    const disabled = await governedFixture(false);
    expect(
      await registry.forkGoverned(
        f.parent,
        {
          ...raw,
          sessionId: "disabled-child",
          configurationFingerprint: disabled.configuration.fingerprint,
        },
        f.inputs,
        disabled.configuration,
      ),
    ).toMatchObject({
      ok: false,
      code: "GOVERNED_BRANCH_CONFIGURATION",
      commitment: "CONFIRMED_NOT_COMMITTED",
    });
    expect(registry.records()).toHaveLength(1);
  });

  it("classifies a policy branch only against a separately reconstructed reference", async () => {
    const f = await setup();
    const registry = new FilesystemReplayBranchRegistry(
      join(f.root, "branches"),
      f.clock,
      f.spec.resourceLimits,
    );
    const branch = await registry.fork(f.parent, f.child, f.inputs);
    if (!branch.ok) throw Error(branch.code);
    const reference = new ReplayController(
      f.child,
      f.inputs,
      new FilesystemReplayCheckpointRepository(
        join(f.root, "reference"),
        f.clock,
        f.child.resourceLimits,
      ),
    );
    ok(await reference.initialize());
    ok(await reference.runToTime(t("10:00:00")));
    ok(await reference.pause());
    const left = { specification: f.spec, checkpoint: f.parent.currentCheckpoint()! },
      right = { specification: f.child, checkpoint: branch.controller.currentCheckpoint()! };
    expect(compareReplayCheckpoints(left, right).classification).toBe("INCOMPARABLE");
    expect(
      compareReplayCheckpoints(left, right, {
        specification: f.child,
        checkpoint: reference.currentCheckpoint()!,
      }).classification,
    ).toBe("EXPECTED_DIFFERENCE");
  });
  it("rejects competing child identities before reserving another branch", async () => {
    const f = await setup();
    const registry = new FilesystemReplayBranchRegistry(
      join(f.root, "branches"),
      f.clock,
      f.spec.resourceLimits,
    );
    expect((await registry.fork(f.parent, f.child, f.inputs)).ok).toBe(true);
    const { fingerprint: _fp, ...raw } = f.child;
    const incompatible = createReplaySpecification({
      ...raw,
      configurationFingerprint: hash("competing-policy"),
    });
    expect(await registry.fork(f.parent, incompatible, f.inputs)).toMatchObject({
      ok: false,
      commitment: "CONFIRMED_NOT_COMMITTED",
    });
    expect(registry.records()).toHaveLength(1);
  });

  it("reconstructs changed policy and never writes parent history", async () => {
    const f = await setup();
    const before = JSON.stringify(f.parent.currentCheckpoint());
    const files = readdirSync(f.parentRoot).map((p) => [
      p,
      readFileSync(join(f.parentRoot, p), "utf8"),
    ]);
    const registry = new FilesystemReplayBranchRegistry(
      join(f.root, "branches"),
      f.clock,
      f.spec.resourceLimits,
    );
    const branch = await registry.fork(f.parent, f.child, f.inputs);
    if (!branch.ok) throw Error(branch.code);
    expect(branch.controller.currentCheckpoint()?.cursor).toBe(2);
    expect(branch.controller.currentCheckpoint()?.state).toBe("PAUSED");
    expect(
      branch.controller.currentCheckpoint()?.aggregation.windows.every((w) => w.timeframe === "M1"),
    ).toBe(true);
    expect(branch.record.evidence.changedFields).toContain("aggregation");
    expect(JSON.stringify(f.parent.currentCheckpoint())).toBe(before);
    expect(
      readdirSync(f.parentRoot).map((p) => [p, readFileSync(join(f.parentRoot, p), "utf8")]),
    ).toEqual(files);
    expect(registry.records()).toEqual([branch.record]);
  });
  it("retries published creation without new checkpoint effects", async () => {
    const f = await setup();
    const registry = new FilesystemReplayBranchRegistry(
      join(f.root, "branches"),
      f.clock,
      f.spec.resourceLimits,
    );
    const first = await registry.fork(f.parent, f.child, f.inputs);
    if (!first.ok) throw Error(first.code);
    const cp = first.controller.currentCheckpoint();
    const second = await registry.fork(f.parent, f.child, f.inputs);
    if (!second.ok) throw Error(second.code);
    expect(second.controller.currentCheckpoint()).toEqual(cp);
    expect(registry.records()).toHaveLength(1);
  });
  for (const stage of ["AFTER_RESERVATION", "AFTER_CHILD_RECOVERY", "AFTER_PUBLICATION"] as const)
    it(`recovers interruption at ${stage}`, async () => {
      const f = await setup();
      const path = join(f.root, "branches");
      const registry = new FilesystemReplayBranchRegistry(
        path,
        f.clock,
        f.spec.resourceLimits,
        (at: BranchCreationStage) => {
          if (at === stage) throw Error("fault");
        },
      );
      const interrupted = await registry.fork(f.parent, f.child, f.inputs);
      expect(interrupted).toMatchObject({ ok: false, commitment: "UNKNOWN_COMMITMENT" });
      if (interrupted.ok || !interrupted.branchId) throw Error("missing identity");
      const fresh = new FilesystemReplayBranchRegistry(path, f.clock, f.spec.resourceLimits);
      const recovered = await fresh.recover(interrupted.branchId, f.inputs);
      if (!recovered.ok) throw Error(recovered.code);
      expect(recovered.controller.currentCheckpoint()?.cursor).toBe(2);
      expect(fresh.records()).toHaveLength(1);
      expect((await fresh.recover(interrupted.branchId, f.inputs)).ok).toBe(true);
    });
  it("certifies a pre-reservation rejection without artifacts", async () => {
    const f = await setup();
    const path = join(f.root, "branches");
    const registry = new FilesystemReplayBranchRegistry(
      path,
      f.clock,
      f.spec.resourceLimits,
      (at) => {
        if (at === "BEFORE_RESERVATION") throw Error("fault");
      },
    );
    expect(await registry.fork(f.parent, f.child, f.inputs)).toMatchObject({
      ok: false,
      commitment: "CONFIRMED_NOT_COMMITTED",
    });
    expect(readdirSync(path)).toEqual(["sessions"]);
  });
  it("rejects source and calendar changes instead of inheriting incompatible state", async () => {
    const f = await setup();
    const registry = new FilesystemReplayBranchRegistry(
      join(f.root, "branches"),
      f.clock,
      f.spec.resourceLimits,
    );
    const { fingerprint: _fp, ...child } = f.child;
    const changed = createReplaySpecification({
      ...child,
      streams: [{ ...child.streams[0]!, basis: "ASK" }],
    });
    expect(await registry.fork(f.parent, changed, f.inputs)).toMatchObject({
      ok: false,
      commitment: "CONFIRMED_NOT_COMMITTED",
    });
  });
  it("enforces branch capacity without overwriting a prior identity", async () => {
    const f = await setup();
    const registry = new FilesystemReplayBranchRegistry(join(f.root, "branches"), f.clock, {
      ...f.spec.resourceLimits,
      maxBranches: 1,
    });
    expect((await registry.fork(f.parent, f.child, f.inputs)).ok).toBe(true);
    const { fingerprint: _fp, ...spec } = f.child;
    expect(
      await registry.fork(
        f.parent,
        createReplaySpecification({ ...spec, sessionId: "child-2" }),
        f.inputs,
      ),
    ).toMatchObject({ ok: false, commitment: "CONFIRMED_NOT_COMMITTED" });
    expect(registry.records()).toHaveLength(1);
  });
  it("does not accept marker corruption as a published branch", async () => {
    const f = await setup();
    const path = join(f.root, "branches");
    const registry = new FilesystemReplayBranchRegistry(path, f.clock, f.spec.resourceLimits);
    expect((await registry.fork(f.parent, f.child, f.inputs)).ok).toBe(true);
    const marker = readdirSync(path).find((p) => p.endsWith(".visible"))!;
    writeFileSync(join(path, marker), "{}");
    expect(() => registry.records()).toThrow("BRANCH_MARKER_INTEGRITY");
  });
  it("branches a completed parent without inventing another parent generation", async () => {
    const f = await setup();
    ok(await f.parent.runToEnd());
    const before = f.parent.currentCheckpoint();
    const registry = new FilesystemReplayBranchRegistry(
      join(f.root, "branches"),
      f.clock,
      f.spec.resourceLimits,
    );
    const result = await registry.fork(f.parent, f.child, f.inputs);
    if (!result.ok) throw Error(result.code);
    expect(result.controller.currentCheckpoint()?.state).toBe("COMPLETED");
    expect(f.parent.currentCheckpoint()).toEqual(before);
  });
});
