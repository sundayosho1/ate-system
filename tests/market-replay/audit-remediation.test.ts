import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { VirtualClock } from "@ate/time";
import { hash, optionsFromEffective } from "@ate/multitimeframe";
import type { LifecycleContext, RuntimeInstanceId } from "@ate/runtime";
import { ConsumerChannel } from "@ate/realtime-data";
import {
  ReplayController,
  FilesystemReplayCheckpointRepository,
  FilesystemReplayBranchRegistry,
  createReplaySpecification,
  createReplayInputManifest,
  immutableReplayInputs,
  completeReplayBranchSpecification,
  compareReplayCheckpoints,
  createReplayCheckpoint,
  replayOutputIdentity,
  type ReplayCommandResult,
  type ReplaySessionSpecification,
  type ReplayResolvedInputs,
  type ReplayLimits,
  type ReplayTaskDescriptor,
} from "@ate/market-replay";
import { replayFixture, stream, observation, t } from "./fixtures.js";
import { governedFixture } from "./integration-fixtures.js";
const roots: string[] = [];
function root() {
  const p = mkdtempSync(join(tmpdir(), "ate-004b-"));
  roots.push(p);
  return p;
}
afterEach(() => {
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
function ok(r: ReplayCommandResult) {
  if (!r.ok) throw Error(r.code);
  return r.checkpoint;
}
const clock = () => new VirtualClock(t("18:00:00"));
const context: LifecycleContext = {
  runtimeInstanceId: "40000000-0000-4000-8000-000000000100" as RuntimeInstanceId,
  runtimeMode: "RESEARCH",
  signal: new AbortController().signal,
  now: () => t("18:00:00"),
};
function repository(s: ReplaySessionSpecification, path = root()) {
  return new FilesystemReplayCheckpointRepository(path, clock(), s.resourceLimits);
}
function raw(s: ReplaySessionSpecification) {
  const { fingerprint: _fp, ...body } = s;
  return body;
}
function child(s: ReplaySessionSpecification) {
  return createReplaySpecification({
    ...raw(s),
    sessionId: "remediation-child",
    configurationFingerprint: hash("child-policy"),
    aggregation: { ...s.aggregation, options: { ...s.aggregation.options, allowedLatenessMs: 1 } },
  });
}
async function bounded(
  limits: Partial<ReplayLimits> = {},
  tasks: readonly ReplayTaskDescriptor[] = [],
) {
  const f = replayFixture(undefined, undefined, tasks);
  const spec = createReplaySpecification({
    ...raw(f.spec),
    resourceLimits: { ...f.spec.resourceLimits, maxEventsPerBatch: 1, ...limits },
  });
  const path = root(),
    repo = repository(spec, path),
    c = new ReplayController(spec, f.inputs, repo);
  ok(await c.initialize());
  return { ...f, spec, path, repo, c };
}
function artifacts(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of readdirSync(path, { withFileTypes: true })) {
    const p = join(path, e.name);
    if (e.isDirectory())
      for (const [k, v] of Object.entries(artifacts(p))) out[e.name + "/" + k] = v;
    else out[e.name] = hash(readFileSync(p).toString("base64"));
  }
  return out;
}
function substituted(
  f: ReturnType<typeof replayFixture>,
  changes = { originReference: "another-root", originFingerprint: hash("another-origin") },
) {
  const { fingerprint: _fp, contentFingerprint: _content, ...manifest } = f.manifest;
  const m = createReplayInputManifest({ ...manifest, ...changes }, f.spec.resourceLimits);
  expect(m.manifestId).toBe(f.manifest.manifestId);
  expect(m.contentFingerprint).toBe(f.manifest.contentFingerprint);
  const inputs = immutableReplayInputs([m]);
  expect(inputs.fingerprint).not.toBe(f.inputs.fingerprint);
  return inputs;
}
it("H01/A: constructor rejection releases admission, permits a governed branch and repeated stop", async () => {
  const f = await governedFixture();
  expect((await f.runtime.start()).ok).toBe(true);
  const emptyPath = root();
  await expect(
    f.service.admit(raw(f.spec), immutableReplayInputs([]), repository(f.spec, emptyPath)),
  ).rejects.toThrow("INPUT_SPECIFICATION_MISMATCH");
  expect(f.service.diagnostics()).toMatchObject({
    busy: false,
    sessions: 0,
    pendingControlEvents: 0,
  });
  expect(artifacts(emptyPath)).toEqual({});
  expect((await f.service.managedService.checkReadiness!(context)).status).toBe("READY");
  expect((await f.service.managedService.checkHealth!(context)).status).toBe("HEALTHY");
  const c = await f.service.admit(raw(f.spec), f.inputs, repository(f.spec));
  ok(await c.runToTime(t("10:00:00")));
  const changed = await governedFixture(true, { "data.multitimeframe.allowedLatenessMs": 1 });
  const registry = new FilesystemReplayBranchRegistry(root(), clock(), f.spec.resourceLimits);
  const result = await registry.forkGoverned(
    c,
    {
      ...raw(changed.spec),
      sessionId: "subsequent-child",
      aggregation: {
        ...changed.spec.aggregation,
        options: optionsFromEffective(changed.configuration).options,
      },
    },
    f.inputs,
    changed.configuration,
  );
  expect(result.ok).toBe(true);
  expect(c.diagnostics().obligation).toBeNull();
  await f.service.shutdown();
  await f.service.shutdown();
  expect(f.service.diagnostics()).toMatchObject({ busy: false, lifecycle: "STOPPED" });
});
it("H01: in-flight admission is not ready/healthy; reentrant admission and shutdown cannot clear its lock", async () => {
  const f = await governedFixture();
  await f.runtime.start();
  let entered!: () => void, release!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    seen = new Promise<void>((r) => (entered = r));
  const inputs: ReplayResolvedInputs = {
    ...f.inputs,
    verify: async () => {
      entered();
      await gate;
      await f.inputs.verify();
    },
  };
  const pending = f.service.admit(raw(f.spec), inputs, repository(f.spec));
  const rejected = expect(pending).rejects.toThrow("STOP_REQUESTED");
  await seen;
  expect(f.service.diagnostics()).toMatchObject({ busy: true, sessions: 1 });
  expect((await f.service.managedService.checkReadiness!(context)).status).toBe("NOT_READY");
  expect((await f.service.managedService.checkHealth!(context)).status).toBe("DEGRADED");
  await expect(f.service.admit(raw(f.spec), f.inputs, repository(f.spec))).rejects.toThrow(
    "REPLAY_ADMISSION_NOT_READY",
  );
  await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  expect(f.service.diagnostics().busy).toBe(true);
  release();
  await rejected;
  expect(f.service.diagnostics().busy).toBe(false);
  await f.service.shutdown();
  await f.service.shutdown();
  expect(f.service.diagnostics().lifecycle).toBe("STOPPED");
});
it("H01: real post-commit unknown evidence survives transient lock cleanup and repeated shutdown", async () => {
  const f = await governedFixture();
  await f.runtime.start();
  const repo = repository(f.spec);
  await expect(
    f.service.admit(raw(f.spec), f.inputs, {
      recover: (s) => repo.recover(s),
      commit: (cp) => {
        const r = repo.commit(cp);
        if (!r.ok) return r;
        return {
          ok: false,
          code: "INJECTED_AFTER_COMMIT",
          operationId: r.value.operationId,
          commitment: "UNKNOWN_COMMITMENT",
        };
      },
      publish: (id) => repo.publish(id),
    }),
  ).rejects.toThrow();
  expect(f.service.diagnostics()).toMatchObject({ busy: false, sessions: 1 });
  expect(f.service.diagnostics().sessionStates[0]?.obligation).toMatchObject({
    commitment: "UNKNOWN_COMMITMENT",
  });
  expect((await f.service.managedService.checkReadiness!(context)).status).toBe("NOT_READY");
  expect((await f.service.managedService.checkHealth!(context)).status).toBe("DEGRADED");
  await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  const fresh = new ReplayController(f.spec, f.inputs, repo);
  expect((await fresh.initialize()).ok).toBe(true);
});
it("H02/D: governed child requires a complete independent reference read before expected difference", async () => {
  const f = await governedFixture();
  const parent = new ReplayController(f.spec, f.inputs, repository(f.spec));
  ok(await parent.initialize());
  ok(await parent.runToTime(t("10:00:00")));
  const policy = await governedFixture(true, { "data.multitimeframe.allowedLatenessMs": 1 });
  const registry = new FilesystemReplayBranchRegistry(root(), clock(), f.spec.resourceLimits);
  const fork = await registry.forkGoverned(
    parent,
    {
      ...raw(policy.spec),
      sessionId: "held-reference-child",
      aggregation: {
        ...policy.spec.aggregation,
        options: optionsFromEffective(policy.configuration).options,
      },
    },
    f.inputs,
    policy.configuration,
  );
  if (!fork.ok) throw Error(fork.code);
  const cp = parent.currentCheckpoint()!,
    spec = fork.controller.specification;
  ok(
    await fork.controller.observeConsumerChannel(
      new ConsumerChannel("reference-reader", 1),
      "reference-artifact",
    ),
  );
  const reference = new ReplayController(spec, f.inputs, repository(spec));
  ok(await reference.initialize());
  ok(await reference.runToTime(cp.logicalTime));
  ok(await reference.pause());
  let entered!: () => void, release!: () => void;
  const seen = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r));
  class Held extends ConsumerChannel {
    override async read() {
      entered();
      await gate;
      return super.read();
    }
  }
  const pending = reference.observeConsumerChannel(
    new Held("reference-reader", 1),
    "reference-artifact",
  );
  await seen;
  const compare = () =>
    compareReplayCheckpoints(
      { specification: f.spec, checkpoint: cp },
      { specification: spec, checkpoint: fork.controller.currentCheckpoint()! },
      { specification: spec, checkpoint: reference.currentCheckpoint()! },
    );
  expect(
    reference.currentCheckpoint()!.evidence.some((e) => e.kind === "CHANNEL_READ_PENDING"),
  ).toBe(true);
  expect(reference.diagnostics().pendingConsumerReads).toBe(1);
  const held = compare();
  expect(held.classification).toBe("INCOMPARABLE");
  expect(held.reasons).toContain("REFERENCE_UNRESOLVED_READ_EVIDENCE");
  release();
  ok(await pending);
  expect(reference.diagnostics().pendingConsumerReads).toBe(0);
  expect(compare().classification).toBe("EXPECTED_DIFFERENCE");
  const left = { specification: f.spec, checkpoint: cp },
    right = { specification: spec, checkpoint: fork.controller.currentCheckpoint()! };
  for (const bad of [
    createReplayCheckpoint({ ...reference.currentCheckpoint()!, timestampComplete: false }),
    createReplayCheckpoint({
      ...reference.currentCheckpoint()!,
      inputFingerprint: hash("different-context"),
    }),
    { ...reference.currentCheckpoint()!, fingerprint: hash("corrupt") },
  ])
    expect(
      compareReplayCheckpoints(left, right, { specification: spec, checkpoint: bad })
        .classification,
    ).toBe("INCOMPARABLE");
});
it("H02: incomplete cohorts and recovery lifecycle cannot qualify any comparison participant", async () => {
  const f = await bounded();
  const initial = f.c.currentCheckpoint()!;
  const incomplete = ok(await f.c.stepEvent());
  expect(incomplete.timestampComplete).toBe(false);
  const input = { specification: f.spec, checkpoint: incomplete };
  expect(compareReplayCheckpoints(input, input).classification).toBe("INCOMPARABLE");
  const failed = {
    specification: f.spec,
    checkpoint: createReplayCheckpoint({ ...initial, state: "RECOVERY_REQUIRED" }),
  };
  expect(compareReplayCheckpoints(failed, failed).classification).toBe("INCOMPARABLE");
  const good = { specification: f.spec, checkpoint: initial };
  expect(compareReplayCheckpoints(good, good).classification).toBe("IDENTICAL");
});
it("M01: batch-one reconstruction completes equal-time tasks/snapshots, preserves exact fork and immutable parent", async () => {
  const tasks: ReplayTaskDescriptor[] = [
    {
      taskId: "cohort-snapshot",
      dueAt: t("10:00:00"),
      action: {
        kind: "SNAPSHOT",
        streamId: hash(stream),
        timeframes: ["M1"],
        includeIncomplete: true,
      },
    },
  ];
  const f = await bounded({}, tasks);
  expect(await f.c.stepTimestamp()).toMatchObject({ ok: false, code: "TIMESTAMP_BATCH_CAPACITY" });
  const first = ok(await f.c.stepEvent());
  expect(first.timestampComplete).toBe(false);
  expect(first.snapshots).toHaveLength(0);
  while (f.c.diagnostics().state !== "COMPLETED") ok(await f.c.stepEvent());
  const before = f.c.currentCheckpoint()!,
    files = artifacts(f.path);
  const path = root(),
    registry = new FilesystemReplayBranchRegistry(path, clock(), f.spec.resourceLimits);
  const result = await registry.fork(f.c, child(f.spec), f.inputs);
  if (!result.ok) throw Error(result.code);
  const cp = result.controller.currentCheckpoint()!;
  expect(cp).toMatchObject({ logicalTime: before.logicalTime, cursor: 3, timestampComplete: true });
  expect(cp.snapshots).toHaveLength(1);
  expect(cp.snapshots[0]?.inputCursor).toBe(2);
  expect(result.controller.specification.resourceLimits.maxEventsPerBatch).toBe(1);
  for (let i = 0; i < 3; i++) {
    const recovered = await new FilesystemReplayBranchRegistry(
      path,
      clock(),
      f.spec.resourceLimits,
    ).recover(result.record.evidence.branchId, f.inputs);
    if (!recovered.ok) throw Error(recovered.code);
    expect(
      replayOutputIdentity({
        specification: recovered.controller.specification,
        checkpoint: recovered.controller.currentCheckpoint()!,
      }),
    ).toBe(
      replayOutputIdentity({ specification: result.controller.specification, checkpoint: cp }),
    );
  }
  expect(f.c.currentCheckpoint()).toEqual(before);
  expect(artifacts(f.path)).toEqual(files);
});
for (const stage of ["AFTER_RESERVATION", "AFTER_CHILD_RECOVERY", "AFTER_PUBLICATION"] as const)
  it(`M01/E: batch-one recovery after ${stage} at exact repository capacity is idempotent`, async () => {
    const f = await bounded({ maxRepositoryOperations: 5, maxCheckpoints: 5 });
    while (f.c.diagnostics().state !== "COMPLETED") ok(await f.c.stepEvent());
    expect(f.c.currentCheckpoint()!.generation).toBe(5);
    const path = root(),
      before = artifacts(f.path);
    const registry = new FilesystemReplayBranchRegistry(
      path,
      clock(),
      f.spec.resourceLimits,
      (s) => {
        if (s === stage) throw Error("INJECTED_BRANCH_INTERRUPTION");
      },
    );
    const fork = await registry.fork(f.c, child(f.spec), f.inputs);
    expect(fork.ok).toBe(false);
    if (fork.ok || !fork.branchId) throw Error("IDENTITY_REQUIRED");
    let previous: ReturnType<typeof artifacts> | undefined;
    for (let i = 0; i < 3; i++) {
      const fresh = new FilesystemReplayBranchRegistry(path, clock(), f.spec.resourceLimits);
      const r = await fresh.recover(fork.branchId, f.inputs);
      if (!r.ok) throw Error(r.code);
      expect(r.controller.currentCheckpoint()).toMatchObject({
        generation: 5,
        cursor: 3,
        timestampComplete: true,
      });
      expect(fresh.records()).toHaveLength(1);
      const files = artifacts(path);
      if (previous) expect(files).toEqual(previous);
      previous = files;
    }
    expect(artifacts(f.path)).toEqual(before);
  });
it("M01: interrupted partial cohort reconstructs from acknowledged cursor without publishing a partial branch", async () => {
  const f = await bounded();
  while (f.c.diagnostics().state !== "COMPLETED") ok(await f.c.stepEvent());
  const path = root();
  let calls = 0;
  const inputs: ReplayResolvedInputs = {
    ...f.inputs,
    verify: async () => {
      await f.inputs.verify();
      if (++calls === 4) throw Error("INTERRUPTED_MID_COHORT");
    },
  };
  const registry = new FilesystemReplayBranchRegistry(path, clock(), f.spec.resourceLimits);
  const r = await registry.fork(f.c, child(f.spec), inputs);
  expect(r.ok).toBe(false);
  if (r.ok || !r.branchId) throw Error("IDENTITY_REQUIRED");
  expect(registry.records()).toHaveLength(0);
  const fresh = new FilesystemReplayBranchRegistry(path, clock(), f.spec.resourceLimits);
  const recovered = await fresh.recover(r.branchId, f.inputs);
  if (!recovered.ok) throw Error(recovered.code);
  expect(recovered.controller.currentCheckpoint()).toMatchObject({
    cursor: 3,
    timestampComplete: true,
  });
});
it("M01: bounded reconstruction never passes an earlier exact fork boundary", async () => {
  const f = await bounded();
  ok(await f.c.stepEvent());
  ok(await f.c.stepEvent());
  const cp = f.c.currentCheckpoint()!;
  expect(cp.cursor).toBe(2);
  const r = await new FilesystemReplayBranchRegistry(root(), clock(), f.spec.resourceLimits).fork(
    f.c,
    child(f.spec),
    f.inputs,
  );
  if (!r.ok) throw Error(r.code);
  expect(r.controller.currentCheckpoint()).toMatchObject({
    logicalTime: t("10:00:00"),
    cursor: 2,
    timestampComplete: true,
    state: "PAUSED",
  });
});
it("M01/B: real consumer overflow remains fenced in a bounded child and fresh recovery", async () => {
  const f = await bounded();
  ok(await f.c.reconstructToTime(t("10:01:00")));
  const q = new ConsumerChannel("bounded-loss", 1);
  const item = (n: number) => ({
    observation: observation(t("10:00:00"), n).observation,
    processedAt: t("10:00:00"),
    warnings: [],
    ingress: {
      ingressId: `bounded-${n}`,
      sourceId: stream.sourceId,
      adapterId: "fixture",
      adapterVersion: "1",
      sessionId: "session-1",
      subscriptionId: stream.channel,
      providerSymbol: "TEST",
      observationKind: "QUOTE" as const,
      receivedAt: t("10:00:00"),
      localSequence: n,
      payloadFingerprint: hash(n),
      configurationFingerprint: hash("loss"),
    },
  });
  expect(q.deliver(item(1))).toBe(true);
  expect(q.deliver(item(2))).toBe(false);
  ok(await f.c.observeConsumerChannel(q, "bounded-source"));
  const spec = completeReplayBranchSpecification(f.c.currentCheckpoint()!, f.spec, child(f.spec)),
    path = root();
  const r = await new FilesystemReplayBranchRegistry(path, clock(), f.spec.resourceLimits).fork(
    f.c,
    spec,
    f.inputs,
  );
  if (!r.ok) throw Error(r.code);
  for (const c of [
    r.controller,
    await new FilesystemReplayBranchRegistry(path, clock(), f.spec.resourceLimits).recover(
      r.record.evidence.branchId,
      f.inputs,
    ),
  ]) {
    const cp =
      c instanceof ReplayController
        ? c.currentCheckpoint()!
        : c.ok
          ? c.controller.currentCheckpoint()!
          : undefined;
    expect(cp).toBeDefined();
    expect(cp!.aggregation.watermarks[hash(stream)]?.status).toBe("FENCED");
    expect(Object.values(cp!.aggregation.consumerLosses!)[0]?.rejected).toBe(1);
    expect(cp!.timestampComplete).toBe(true);
  }
});
for (const which of ["reference", "fingerprint", "both"] as const)
  it(`M02/C: identical-content origin ${which} substitution rejects before reservation and comparison`, async () => {
    const f = await bounded();
    ok(await f.c.stepEvent());
    ok(await f.c.stepEvent());
    const inputs = substituted(f, {
      originReference: which === "fingerprint" ? f.manifest.originReference : "another-root",
      originFingerprint:
        which === "reference" ? f.manifest.originFingerprint : hash("another-origin"),
    });
    const path = root(),
      registry = new FilesystemReplayBranchRegistry(path, clock(), f.spec.resourceLimits),
      before = artifacts(path);
    const result = await registry.fork(f.c, child(f.spec), inputs);
    expect(result).toMatchObject({ ok: false, commitment: "CONFIRMED_NOT_COMMITTED" });
    expect(registry.records()).toHaveLength(0);
    expect(artifacts(path)).toEqual(before);
    const foreign = new ReplayController(f.spec, inputs, repository(f.spec));
    ok(await foreign.initialize());
    ok(await foreign.stepEvent());
    ok(await foreign.stepEvent());
    expect(
      compareReplayCheckpoints(
        { specification: f.spec, checkpoint: f.c.currentCheckpoint()! },
        { specification: f.spec, checkpoint: foreign.currentCheckpoint()! },
      ).classification,
    ).toBe("INCOMPARABLE");
  });
it("M02: fresh recovery rejects substituted inputs without changing published lineage", async () => {
  const f = await bounded();
  ok(await f.c.stepEvent());
  ok(await f.c.stepEvent());
  const path = root(),
    registry = new FilesystemReplayBranchRegistry(path, clock(), f.spec.resourceLimits);
  const valid = await registry.fork(f.c, child(f.spec), f.inputs);
  if (!valid.ok) throw Error(valid.code);
  const before = artifacts(path);
  const result = await new FilesystemReplayBranchRegistry(
    path,
    clock(),
    f.spec.resourceLimits,
  ).recover(valid.record.evidence.branchId, substituted(f));
  expect(result.ok).toBe(false);
  expect(artifacts(path)).toEqual(before);
  expect(
    (
      await new FilesystemReplayBranchRegistry(path, clock(), f.spec.resourceLimits).recover(
        valid.record.evidence.branchId,
        f.inputs,
      )
    ).ok,
  ).toBe(true);
});
it("M02: rehashed branch record cannot sever full parent input binding", async () => {
  const f = await bounded();
  ok(await f.c.stepEvent());
  ok(await f.c.stepEvent());
  const path = root();
  const registry = new FilesystemReplayBranchRegistry(path, clock(), f.spec.resourceLimits, (s) => {
    if (s === "AFTER_RESERVATION") throw Error("RESERVED");
  });
  const r = await registry.fork(f.c, child(f.spec), f.inputs);
  if (r.ok || !r.branchId) throw Error("RESERVATION_REQUIRED");
  const file = join(path, r.branchId + ".json"),
    record = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  delete record.fingerprint;
  record.inputFingerprint = substituted(f).fingerprint;
  writeFileSync(file, JSON.stringify({ ...record, fingerprint: hash(record) }));
  const before = artifacts(path),
    fresh = new FilesystemReplayBranchRegistry(path, clock(), f.spec.resourceLimits);
  expect((await fresh.recover(r.branchId, substituted(f))).ok).toBe(false);
  expect(artifacts(path)).toEqual(before);
  expect(fresh.records()).toHaveLength(0);
});
it("M02: source revalidation failure immediately before publication retains discoverable reservation", async () => {
  const f = await bounded();
  while (f.c.diagnostics().state !== "COMPLETED") ok(await f.c.stepEvent());
  const path = root();
  let calls = 0;
  const inputs: ReplayResolvedInputs = {
    ...f.inputs,
    verify: async () => {
      await f.inputs.verify();
      if (++calls === 7) throw Error("SOURCE_INVALIDATED_BEFORE_BRANCH_PUBLICATION");
    },
  };
  const registry = new FilesystemReplayBranchRegistry(path, clock(), f.spec.resourceLimits);
  const r = await registry.fork(f.c, child(f.spec), inputs);
  expect(r.ok).toBe(false);
  if (r.ok || !r.branchId) throw Error("RESERVATION_REQUIRED");
  expect(registry.records()).toHaveLength(0);
  const recovered = await new FilesystemReplayBranchRegistry(
    path,
    clock(),
    f.spec.resourceLimits,
  ).recover(r.branchId, f.inputs);
  expect(recovered.ok).toBe(true);
});
it("H01: synchronous repository callback cannot reenter admission or report successful shutdown", async () => {
  const f = await governedFixture();
  await f.runtime.start();
  const repo = repository(f.spec);
  let nested: Promise<unknown> | undefined, stopping: Promise<unknown> | undefined;
  await expect(
    f.service.admit(raw(f.spec), f.inputs, {
      recover: (s) => {
        nested = f.service.admit(raw(f.spec), f.inputs, repo).catch((e: Error) => e.message);
        stopping = f.service.shutdown().catch((e: Error) => e.message);
        return repo.recover(s);
      },
      commit: (cp) => repo.commit(cp),
      publish: (id) => repo.publish(id),
    }),
  ).rejects.toThrow("STOP_REQUESTED");
  expect(await nested).toBe("REPLAY_ADMISSION_NOT_READY");
  expect(await stopping).toBe("REPLAY_SHUTDOWN_OBLIGATION");
  expect(f.service.diagnostics().busy).toBe(false);
  // The honest empty recovery result establishes no checkpoint commitment; cancellation
  // leaves no phantom registration. A fresh owner can initialize the same namespace.
  const fresh = new ReplayController(f.spec, f.inputs, repo);
  expect((await fresh.initialize()).ok).toBe(true);
  await f.service.shutdown();
  await f.service.shutdown();
  expect(f.service.diagnostics().lifecycle).toBe("STOPPED");
});
it("M01/E: a paused complete fork at exact capacity publishes after interrupted marker without redundant controls", async () => {
  const f = await bounded({ maxRepositoryOperations: 4, maxCheckpoints: 4 });
  ok(await f.c.stepEvent());
  ok(await f.c.stepEvent());
  const path = root();
  let calls = 0;
  const inputs: ReplayResolvedInputs = {
    ...f.inputs,
    verify: async () => {
      await f.inputs.verify();
      if (++calls === 6) throw Error("INTERRUPTED_BEFORE_MARKER");
    },
  };
  const registry = new FilesystemReplayBranchRegistry(path, clock(), f.spec.resourceLimits);
  const r = await registry.fork(f.c, child(f.spec), inputs);
  expect(r.ok).toBe(false);
  if (r.ok || !r.branchId) throw Error("RESERVATION_REQUIRED");
  expect(registry.records()).toHaveLength(0);
  let previous: ReturnType<typeof artifacts> | undefined;
  for (let i = 0; i < 3; i++) {
    const recovered = await new FilesystemReplayBranchRegistry(
      path,
      clock(),
      f.spec.resourceLimits,
    ).recover(r.branchId, f.inputs);
    if (!recovered.ok) throw Error(recovered.code);
    expect(recovered.controller.currentCheckpoint()).toMatchObject({
      state: "PAUSED",
      generation: 4,
      cursor: 2,
      timestampComplete: true,
      logicalTime: t("10:00:00"),
    });
    const files = artifacts(path);
    if (previous) expect(files).toEqual(previous);
    previous = files;
  }
});
it("M02: published branch record validation rejects a rehashed foreign parent context", async () => {
  const f = await bounded();
  ok(await f.c.stepEvent());
  ok(await f.c.stepEvent());
  const path = root(),
    registry = new FilesystemReplayBranchRegistry(path, clock(), f.spec.resourceLimits);
  const r = await registry.fork(f.c, child(f.spec), f.inputs);
  if (!r.ok) throw Error(r.code);
  const file = join(path, r.record.evidence.branchId + ".json"),
    { fingerprint: _fp, ...body } = r.record;
  writeFileSync(
    file,
    JSON.stringify({
      ...body,
      inputFingerprint: substituted(f).fingerprint,
      fingerprint: hash({ ...body, inputFingerprint: substituted(f).fingerprint }),
    }),
  );
  const fresh = new FilesystemReplayBranchRegistry(path, clock(), f.spec.resourceLimits),
    before = artifacts(path);
  expect(() => fresh.records()).toThrow("BRANCH_PARENT_INPUT_CONTEXT");
  expect((await fresh.recover(r.record.evidence.branchId, f.inputs)).ok).toBe(false);
  expect(artifacts(path)).toEqual(before);
});
it("M02: identical observations with changed qualification context cannot masquerade as a policy branch", async () => {
  const f = await bounded();
  ok(await f.c.stepEvent());
  ok(await f.c.stepEvent());
  const { fingerprint: _fp, contentFingerprint: _content, ...body } = f.manifest;
  const manifest = createReplayInputManifest(
    { ...body, qualityReferences: [hash("another-qualification")] },
    f.spec.resourceLimits,
  );
  expect(manifest.contentFingerprint).toBe(f.manifest.contentFingerprint);
  const inputs = immutableReplayInputs([manifest]);
  expect(inputs.fingerprint).not.toBe(f.inputs.fingerprint);
  const path = root(),
    registry = new FilesystemReplayBranchRegistry(path, clock(), f.spec.resourceLimits),
    before = artifacts(path);
  expect(await registry.fork(f.c, child(f.spec), inputs)).toMatchObject({
    ok: false,
    commitment: "CONFIRMED_NOT_COMMITTED",
  });
  expect(artifacts(path)).toEqual(before);
});
it("M01/E: a fitting cohort keeps timestamp-equivalent operation capacity during bounded reconstruction", async () => {
  const f = await bounded({ maxEventsPerBatch: 64, maxRepositoryOperations: 4, maxCheckpoints: 4 });
  ok(await f.c.runToEnd());
  expect(f.c.currentCheckpoint()!.generation).toBe(4);
  const path = root(),
    registry = new FilesystemReplayBranchRegistry(path, clock(), f.spec.resourceLimits);
  const r = await registry.fork(f.c, child(f.spec), f.inputs);
  if (!r.ok) throw Error(r.code);
  expect(r.controller.currentCheckpoint()).toMatchObject({
    generation: 4,
    cursor: 3,
    timestampComplete: true,
    state: "COMPLETED",
  });
  expect(
    (
      await new FilesystemReplayBranchRegistry(path, clock(), f.spec.resourceLimits).recover(
        r.record.evidence.branchId,
        f.inputs,
      )
    ).ok,
  ).toBe(true);
});
