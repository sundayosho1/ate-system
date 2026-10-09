import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { hash } from "@ate/multitimeframe";
import { ConsumerChannel } from "@ate/realtime-data";
import type { LifecycleContext, RuntimeInstanceId } from "@ate/runtime";
import {
  ReplayController,
  FilesystemReplayCheckpointRepository,
  FilesystemReplayBranchRegistry,
  immutableReplayInputs,
  createReplaySpecification,
  createReplayInputManifest,
  compareReplayCheckpoints,
  type ReplayCheckpointRepository,
  type ReplaySessionSpecification,
  type ReplayTaskDescriptor,
} from "@ate/market-replay";
import { governedFixture } from "./integration-fixtures.js";
import { t, stream } from "./fixtures.js";
const roots: string[] = [];
function root() {
  const p = mkdtempSync(join(tmpdir(), "ate-004h-"));
  roots.push(p);
  return p;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
const context: LifecycleContext = {
  runtimeInstanceId: "40000000-0000-4000-8000-000000000100" as RuntimeInstanceId,
  runtimeMode: "RESEARCH",
  signal: new AbortController().signal,
  now: () => t("13:00:00"),
};
function raw(spec: ReplaySessionSpecification) {
  const { fingerprint: _fp, ...body } = spec;
  return body;
}
function artifacts(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const p = join(path, entry.name);
    if (entry.isDirectory())
      for (const [key, value] of Object.entries(artifacts(p))) out[entry.name + "/" + key] = value;
    else out[entry.name] = hash(readFileSync(p).toString("base64"));
  }
  return out;
}
async function setup(tasks: readonly ReplayTaskDescriptor[] = []) {
  const f = await governedFixture();
  expect((await f.runtime.start()).ok).toBe(true);
  const path = root(),
    source = join(root(), "origin.json"),
    content = JSON.stringify(f.inputs.manifests),
    fingerprint = hash(content);
  writeFileSync(source, content);
  let calls = 0;
  let rejection: unknown = Error("SOURCE_FINGERPRINT_MISMATCH");
  const inputs = immutableReplayInputs(
    f.inputs.manifests,
    () =>
      new Promise<void>((resolve, reject) => {
        if (hash(readFileSync(source, "utf8")) !== fingerprint)
          Reflect.apply(reject, undefined, [rejection]);
        else resolve();
      }),
  );
  const repository = new FilesystemReplayCheckpointRepository(path, f.clock, f.spec.resourceLimits);
  const port: ReplayCheckpointRepository = {
    recover: (s) => {
      calls++;
      return repository.recover(s);
    },
    commit: (cp) => {
      calls++;
      return repository.commit(cp);
    },
    publish: (id) => {
      calls++;
      return repository.publish(id);
    },
  };
  const spec = createReplaySpecification({ ...raw(f.spec), tasks });
  const controller = await f.service.admit(raw(spec), inputs, port);
  const checkpoint = controller.currentCheckpoint();
  if (!checkpoint) throw Error("CHECKPOINT_MISSING");
  return {
    ...f,
    spec,
    path,
    source,
    content,
    inputs,
    repository,
    port,
    controller,
    checkpoint,
    calls: () => calls,
    failWith: (value: unknown) => {
      rejection = value;
      writeFileSync(source, content + "\n");
    },
    restore: () => writeFileSync(source, content),
  };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function unavailable(f: Fixture) {
  expect((await f.service.managedService.checkReadiness!(context)).status).toBe("NOT_READY");
  expect((await f.service.managedService.checkHealth!(context)).status).toBe("DEGRADED");
}
async function phaseA(f: Fixture, before: Record<string, string>, count: number) {
  expect(f.controller.diagnostics()).toMatchObject({
    state: "FAILED",
    busy: false,
    obligation: null,
    checkpointId: f.checkpoint.checkpointId,
    cursor: f.checkpoint.cursor,
  });
  expect(f.service.diagnostics()).toMatchObject({
    sessions: 1,
    busy: false,
    pendingControlEvents: 0,
    disposedAdmissions: [],
  });
  expect(f.controller.currentCheckpoint()).toEqual(f.checkpoint);
  expect(f.controller.canDisposeProvisionalAdmission()).toBe(false);
  expect(artifacts(f.path)).toEqual(before);
  expect(f.calls()).toBe(count);
  await unavailable(f);
}
async function phaseB(f: Fixture, before: Record<string, string>, count: number) {
  f.restore();
  await f.inputs.verify();
  if (f.service.diagnostics().lifecycle === "READY") {
    expect(await f.service.command(f.spec.sessionId, (c) => c.stepEvent())).toMatchObject({
      ok: false,
      code: "INVALID_LIFECYCLE",
      state: "FAILED",
    });
    await expect(f.service.admit(raw(f.spec), f.inputs, f.port)).rejects.toThrow(
      "SESSION_IDENTITY_CONFLICT",
    );
  } else {
    await expect(f.service.command(f.spec.sessionId, (c) => c.stepEvent())).rejects.toThrow(
      "REPLAY_RUNTIME_NOT_READY",
    );
    await expect(f.service.admit(raw(f.spec), f.inputs, f.port)).rejects.toThrow(
      "REPLAY_ADMISSION_NOT_READY",
    );
  }
  expect(await f.controller.stepEvent()).toMatchObject({
    ok: false,
    code: "INVALID_LIFECYCLE",
    state: "FAILED",
  });
  expect(await f.controller.resume()).toMatchObject({ ok: false, code: "INVALID_LIFECYCLE" });
  for (const operation of ["runToTime", "reconstructToTime"] as const) {
    expect(await f.controller[operation](f.checkpoint.logicalTime)).toMatchObject({
      ok: false,
      code: "INVALID_LIFECYCLE",
      state: "FAILED",
    });
  }
  await unavailable(f);
  for (let i = 0; i < 2; i++)
    await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  expect(f.service.diagnostics().sessions).toBe(1);
  expect(f.calls()).toBe(count);
  expect(artifacts(f.path)).toEqual(before);
  const fresh = await governedFixture();
  expect((await fresh.runtime.start()).ok).toBe(true);
  const recovered = await fresh.service.admit(raw(f.spec), f.inputs, f.repository);
  expect(recovered.currentCheckpoint()).toEqual(f.checkpoint);
  expect((await fresh.service.managedService.checkReadiness!(context)).status).toBe("READY");
  expect(artifacts(f.path)).toEqual(before);
  await fresh.service.shutdown();
  const stopped = artifacts(f.path);
  await fresh.service.shutdown();
  expect(artifacts(f.path)).toEqual(stopped);
}
const operations = ["stepEvent", "stepTimestamp", "runToTime", "reconstructToTime"] as const;
type Operation = (typeof operations)[number];
function dispatch(c: ReplayController, operation: Operation) {
  return operation === "runToTime" || operation === "reconstructToTime"
    ? c[operation](t("10:01:00"))
    : c[operation]();
}
for (const operation of operations)
  for (const payload of ["normal", "first-read", "second-read", "symbol", "revoked"] as const)
    it(`real post-admission failure ${operation} / ${payload} preserves identity and recovers only fresh`, async () => {
      const f = await setup(),
        before = artifacts(f.path),
        count = f.calls();
      let reads = 0;
      const seen: ReturnType<ReplayController["diagnostics"]>[] = [];
      const error = Error("SOURCE_FINGERPRINT_MISMATCH");
      let rejection: unknown = error;
      if (payload === "first-read" || payload === "second-read")
        Object.defineProperty(error, "message", {
          get: () => {
            seen.push(f.controller.diagnostics());
            reads++;
            if (payload === "second-read" && reads === 1) return "SOURCE_FINGERPRINT_MISMATCH";
            throw Error("DIAGNOSTIC_ACCESS_FAILURE");
          },
        });
      if (payload === "symbol")
        Object.defineProperty(error, "message", { value: Symbol("private") });
      if (payload === "revoked") {
        const p = Proxy.revocable({}, {});
        p.revoke();
        rejection = p.proxy;
      }
      f.failWith(rejection);
      const result = await f.service.command(f.spec.sessionId, (c) => dispatch(c, operation));
      expect(result).toEqual({ ok: false, code: "REPLAY_BOUNDARY_FAILED", state: "FAILED" });
      for (const d of seen)
        expect(d).toMatchObject({
          state: "FAILED",
          busy: true,
          obligation: null,
          checkpointId: f.checkpoint.checkpointId,
        });
      expect(reads).toBe(payload === "first-read" || payload === "second-read" ? 1 : 0);
      expect(f.controller.diagnostics().lastFailureCode).toBe(
        payload === "normal" || payload === "second-read"
          ? "SOURCE_FINGERPRINT_MISMATCH"
          : "UNCLASSIFIED_BOUNDARY_FAILURE",
      );
      await phaseA(f, before, count);
      await phaseB(f, before, count);
    });
for (const payload of [
  "throw-proxy",
  "side-getter",
  "number",
  "string",
  "null",
  "undefined",
  "malformed",
  "overlong",
  "coercion",
] as const)
  it(`additional post-admission rejection ${payload}`, async () => {
    const f = await setup(),
      before = artifacts(f.path),
      count = f.calls();
    let reads = 0,
      coercions = 0;
    const seen: ReturnType<ReplayController["diagnostics"]>[] = [];
    let rejection: unknown;
    if (payload === "throw-proxy")
      rejection = new Proxy(
        {},
        {
          get: () => {
            reads++;
            seen.push(f.controller.diagnostics());
            throw Error("TRAP_FAILURE");
          },
        },
      );
    else if (payload === "side-getter")
      rejection = Object.defineProperty({}, "message", {
        get: () => {
          reads++;
          seen.push(f.controller.diagnostics());
          return "SOURCE_INVALID";
        },
      });
    else if (payload === "number") rejection = 7;
    else if (payload === "string") rejection = "SOURCE_INVALID";
    else if (payload === "null") rejection = null;
    else if (payload === "undefined") rejection = undefined;
    else if (payload === "malformed") rejection = Error("private /source/path");
    else if (payload === "overlong") rejection = Error("X".repeat(129));
    else
      rejection = {
        message: {
          [Symbol.toPrimitive]: () => {
            coercions++;
            throw Error("COERCION");
          },
        },
      };
    f.failWith(rejection);
    expect(await f.service.command(f.spec.sessionId, (c) => c.stepEvent())).toMatchObject({
      ok: false,
      code: "REPLAY_BOUNDARY_FAILED",
      state: "FAILED",
    });
    expect(reads).toBeLessThanOrEqual(1);
    expect(coercions).toBe(0);
    for (const d of seen) expect(d.state).toBe("FAILED");
    expect(f.controller.diagnostics().lastFailureCode).toBe(
      payload === "side-getter" ? "SOURCE_INVALID" : "UNCLASSIFIED_BOUNDARY_FAILURE",
    );
    await phaseA(f, before, count);
    await phaseB(f, before, count);
  });
for (const action of ["shutdown", "command"] as const)
  it(`reentrant diagnostic ${action} cannot replace terminal failure`, async () => {
    const f = await setup(),
      before = artifacts(f.path),
      count = f.calls();
    let nested: Promise<unknown> | undefined;
    let seen: ReturnType<ReplayController["diagnostics"]> | undefined;
    const error = Object.defineProperty(Error(), "message", {
      get: () => {
        seen = f.controller.diagnostics();
        nested =
          action === "shutdown"
            ? f.service
                .shutdown()
                .catch((e: unknown) => (e instanceof Error ? e.message : "UNKNOWN"))
            : f.service
                .command(f.spec.sessionId, (c) => c.stepEvent())
                .catch((e: unknown) => (e instanceof Error ? e.message : "UNKNOWN"));
        throw Error("GETTER_FAILED");
      },
    });
    f.failWith(error);
    expect(await f.service.command(f.spec.sessionId, (c) => c.stepEvent())).toMatchObject({
      ok: false,
      code: "REPLAY_BOUNDARY_FAILED",
      state: "FAILED",
    });
    expect(seen?.state).toBe("FAILED");
    expect(await nested).toBe(
      action === "shutdown" ? "REPLAY_SHUTDOWN_OBLIGATION" : "REPLAY_RUNTIME_NOT_READY",
    );
    await phaseA(f, before, count);
    await phaseB(f, before, count);
  });
it("held boundary excludes competitors and failed concurrent shutdown cannot erase final failure", async () => {
  const f = await setup();
  let release: ((reason: unknown) => void) | undefined, entered: (() => void) | undefined;
  let armed = false;
  const seen = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((_resolve, reject) => {
    release = (reason) => {
      Reflect.apply(reject, undefined, [reason]);
    };
  });
  const inputs = immutableReplayInputs(f.inputs.manifests, async () => {
    if (armed) {
      entered?.();
      await gate;
    } else await f.inputs.verify();
  });
  const g = await governedFixture();
  expect((await g.runtime.start()).ok).toBe(true);
  const c = await g.service.admit(raw(f.spec), inputs, f.repository),
    cp = c.currentCheckpoint(),
    before = artifacts(f.path);
  armed = true;
  const pending = g.service.command(f.spec.sessionId, (x) => x.stepEvent());
  await seen;
  await expect(g.service.command(f.spec.sessionId, (x) => x.stepTimestamp())).rejects.toThrow(
    "REPLAY_RUNTIME_NOT_READY",
  );
  await expect(g.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  const accessorStates: string[] = [];
  release?.(
    Object.defineProperty(Error(), "message", {
      get: () => {
        accessorStates.push(c.diagnostics().state);
        throw Error("DIAGNOSTIC_FAILED");
      },
    }),
  );
  expect(await pending).toMatchObject({
    ok: false,
    code: "REPLAY_BOUNDARY_FAILED",
    state: "FAILED",
  });
  expect(accessorStates).toEqual(["FAILED"]);
  expect(c.currentCheckpoint()).toEqual(cp);
  expect(artifacts(f.path)).toEqual(before);
  expect(g.service.diagnostics()).toMatchObject({
    busy: false,
    sessions: 1,
    lifecycle: "STOPPING",
  });
  for (let i = 0; i < 2; i++)
    await expect(g.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
});
for (const commitment of ["UNKNOWN_COMMITMENT", "COMMITTED"] as const)
  it(`exceptional storage reporting preserves actual ${commitment} and predecessor acknowledgement`, async () => {
    const f = await governedFixture();
    expect((await f.runtime.start()).ok).toBe(true);
    const path = root(),
      repo = new FilesystemReplayCheckpointRepository(path, f.clock, f.spec.resourceLimits);
    let armed = false;
    const seen: ReturnType<ReplayController["diagnostics"]>[] = [];
    const error = Object.defineProperty(Error(), "message", {
      get: () => {
        if (c) seen.push(c.diagnostics());
        throw Error("RESULT_DIAGNOSTIC_FAILED");
      },
    });
    const port: ReplayCheckpointRepository = {
      recover: (s) => repo.recover(s),
      commit: (cp) => {
        const r = repo.commit(cp);
        if (armed && commitment === "UNKNOWN_COMMITMENT") {
          if (!r.ok) throw Error(r.code);
          return {
            ok: false,
            operationId: r.value.operationId,
            commitment,
            get code(): string {
              throw error;
            },
          };
        }
        return r;
      },
      publish: (id) =>
        armed && commitment === "COMMITTED"
          ? {
              ok: false,
              operationId: id,
              commitment,
              get code(): string {
                throw error;
              },
            }
          : repo.publish(id),
    };
    const c: ReplayController = await f.service.admit(raw(f.spec), f.inputs, port);
    const acknowledged = c.currentCheckpoint(),
      before = artifacts(path);
    armed = true;
    expect(await f.service.command(f.spec.sessionId, (x) => x.stepEvent())).toMatchObject({
      ok: false,
      code: "STORAGE_EXCEPTION",
      state: "RECOVERY_REQUIRED",
    });
    expect(seen).toHaveLength(0);
    expect(c.diagnostics()).toMatchObject({
      state: "RECOVERY_REQUIRED",
      obligation: { commitment },
      busy: false,
    });
    expect(c.currentCheckpoint()).toEqual(acknowledged);
    expect(artifacts(path)).not.toEqual(before);
    expect(c.canDisposeProvisionalAdmission()).toBe(false);
    expect((await f.service.managedService.checkReadiness!(context)).status).toBe("NOT_READY");
    expect((await f.service.managedService.checkHealth!(context)).status).toBe("DEGRADED");
    for (let i = 0; i < 2; i++)
      await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
    await expect(f.service.command(f.spec.sessionId, (x) => x.stepEvent())).rejects.toThrow(
      "REPLAY_RUNTIME_NOT_READY",
    );
    expect(await c.stepEvent()).toMatchObject({ ok: false, code: "INVALID_LIFECYCLE" });
    expect(c.diagnostics().obligation?.commitment).toBe(commitment);
    armed = false;
    const fresh = new ReplayController(f.spec, f.inputs, repo);
    expect((await fresh.initialize()).ok).toBe(true);
    expect(fresh.currentCheckpoint()?.cursor).toBe(1);
    expect(fresh.diagnostics().obligation).toBeNull();
  });
it("actual recovered content remains registered after later validation fails", async () => {
  const f = await setup(),
    g = await governedFixture();
  expect((await g.runtime.start()).ok).toBe(true);
  const c = await g.service.admit(raw(f.spec), f.inputs, f.repository),
    before = artifacts(f.path);
  expect(c.diagnostics().repositoryPhase).toBe("RECOVERED_CONTENT");
  f.failWith({ message: Symbol("failure") });
  expect(await g.service.command(f.spec.sessionId, (x) => x.stepEvent())).toMatchObject({
    ok: false,
    code: "REPLAY_BOUNDARY_FAILED",
    state: "FAILED",
  });
  expect(c.currentCheckpoint()).toEqual(f.checkpoint);
  expect(artifacts(f.path)).toEqual(before);
  expect(g.service.diagnostics().sessions).toBe(1);
  expect((await g.service.managedService.checkReadiness!(context)).status).toBe("NOT_READY");
});
it("pending runtime control publication prevents dispatch and is retained", async () => {
  const f = await setup();
  await f.bus.stop();
  await expect(f.service.command(f.spec.sessionId, (c) => c.stepEvent())).rejects.toThrow(
    "REPLAY_CONTROL_PUBLICATION_FAILED",
  );
  const cp = f.controller.currentCheckpoint(),
    before = artifacts(f.path);
  f.failWith({ message: Symbol("failure") });
  await expect(f.service.command(f.spec.sessionId, (c) => c.stepEvent())).rejects.toThrow(
    "CONTROL_PUBLICATION_REQUIRED",
  );
  expect(f.controller.currentCheckpoint()).toEqual(cp);
  expect(artifacts(f.path)).toEqual(before);
  expect(f.service.diagnostics().pendingControlEvents).toBe(1);
  await unavailable(f);
  f.restore();
  f.bus.start();
  await f.service.retryControlEvents();
  await f.service.shutdown();
  await f.service.shutdown();
});
it("configuration mismatch rejects before a boundary without rewriting durable evidence", async () => {
  const f = await setup(),
    before = artifacts(f.path),
    count = f.calls();
  const changed = await governedFixture(true, { "data.multitimeframe.allowedLatenessMs": 250 });
  f.setConfiguration(changed.configuration);
  await expect(f.service.command(f.spec.sessionId, (c) => c.stepEvent())).rejects.toThrow(
    "CONFIGURATION_DRIFT",
  );
  expect(f.controller.currentCheckpoint()).toEqual(f.checkpoint);
  expect(artifacts(f.path)).toEqual(before);
  expect(f.calls()).toBe(count);
  await unavailable(f);
  f.setConfiguration(f.configuration);
  await f.service.shutdown();
  await f.service.shutdown();
});
it("source-origin substitution cannot reuse acknowledged input identity", async () => {
  const f = await setup(),
    before = artifacts(f.path);
  const {
    fingerprint: _fp,
    contentFingerprint: _content,
    manifestId: _id,
    ...body
  } = f.inputs.manifests[0]!;
  const manifest = createReplayInputManifest(
    {
      ...body,
      manifestId: f.inputs.manifests[0]!.manifestId,
      originReference: "substituted",
      originFingerprint: hash("different-origin"),
    },
    f.spec.resourceLimits,
  );
  const changed = immutableReplayInputs([manifest]);
  const fresh = new ReplayController(f.spec, f.inputs, f.repository);
  expect((await fresh.initialize()).ok).toBe(true);
  expect(manifest.contentFingerprint).toBe(f.inputs.manifests[0]!.contentFingerprint);
  const substituted = new ReplayController(f.spec, changed, f.repository);
  expect(await substituted.initialize()).toMatchObject({
    ok: false,
    code: "INITIALIZATION_FAILED",
    state: "FAILED",
  });
  expect(substituted.currentCheckpoint()).toBeUndefined();
  expect(substituted.diagnostics().repositoryPhase).toBe("RECOVERED_CONTENT");
  expect(substituted.canDisposeProvisionalAdmission()).toBe(false);
  expect(artifacts(f.path)).toEqual(before);
  await f.service.shutdown();
});
for (const stage of ["healthy", "failed-reconstruction"] as const)
  it(`governed branch ${stage} uses shared bounded replay boundaries`, async () => {
    const f = await setup();
    expect((await f.service.command(f.spec.sessionId, (c) => c.runToTime(t("10:01:00")))).ok).toBe(
      true,
    );
    const parent = f.controller.currentCheckpoint(),
      before = artifacts(f.path);
    const registry = new FilesystemReplayBranchRegistry(root(), f.clock, f.spec.resourceLimits);
    let validations = 0;
    const inputs = immutableReplayInputs(f.inputs.manifests, async () => {
      validations++;
      if (stage === "failed-reconstruction" && validations === 3)
        throw Object.defineProperty(Error(), "message", {
          get: () => {
            throw Error("BRANCH_DIAGNOSTIC");
          },
        });
      await f.inputs.verify();
    });
    const spec = { ...raw(f.spec), sessionId: "004H-child" };
    const result = await registry.forkGoverned(f.controller, spec, inputs, f.configuration);
    if (stage === "healthy") {
      expect(result.ok).toBe(true);
      if (!result.ok) throw Error(result.code);
      expect(result.controller.currentCheckpoint()?.cursor).toBe(parent?.cursor);
    } else {
      expect(result).toMatchObject({
        ok: false,
        code: "BRANCH_CREATION_REQUIRED_RECOVERY",
        commitment: "UNKNOWN_COMMITMENT",
      });
      expect(registry.records()).toEqual([]);
      if (result.ok || !result.branchId) throw Error("EXPECTED_RESERVED_BRANCH");
      const recovered = await registry.recover(result.branchId, f.inputs);
      expect(recovered.ok).toBe(true);
    }
    expect(f.controller.currentCheckpoint()).toEqual(parent);
    expect(artifacts(f.path)).toEqual(before);
    await f.service.shutdown();
  });
it("comparison corrupt evidence remains INCOMPARABLE and cannot change lifecycle", async () => {
  const f = await setup();
  const cp = f.checkpoint,
    before = artifacts(f.path);
  const comparison = compareReplayCheckpoints(
    { specification: f.spec, checkpoint: cp },
    {
      specification: createReplaySpecification(raw(f.spec)),
      checkpoint: { ...cp, cursor: cp.cursor + 99 },
    },
  );
  expect(comparison.classification).toBe("INCOMPARABLE");
  expect(f.controller.diagnostics().state).toBe("READY");
  expect(f.controller.currentCheckpoint()).toEqual(cp);
  expect(artifacts(f.path)).toEqual(before);
  expect((await f.service.managedService.checkReadiness!(context)).status).toBe("READY");
  await f.service.shutdown();
});
it("resume followed by public stepping cannot hide post-admission source failure", async () => {
  const f = await setup();
  expect((await f.service.command(f.spec.sessionId, (c) => c.pause())).ok).toBe(true);
  expect((await f.service.command(f.spec.sessionId, (c) => c.resume())).ok).toBe(true);
  const cp = f.controller.currentCheckpoint(),
    before = artifacts(f.path);
  f.failWith({ message: Symbol("invalid") });
  expect(await f.service.command(f.spec.sessionId, (c) => c.stepTimestamp())).toMatchObject({
    ok: false,
    code: "REPLAY_BOUNDARY_FAILED",
    state: "FAILED",
  });
  expect(f.controller.currentCheckpoint()).toEqual(cp);
  expect(artifacts(f.path)).toEqual(before);
  await unavailable(f);
});
for (const payload of ["normal", "hostile"] as const)
  it(`snapshot source failure ${payload} finalizes before diagnostics`, async () => {
    const f = await setup(),
      before = artifacts(f.path),
      count = f.calls();
    const seen: string[] = [];
    const rejection =
      payload === "normal"
        ? Error("SOURCE_INVALID")
        : Object.defineProperty(Error(), "message", {
            get: () => {
              seen.push(f.controller.diagnostics().state);
              throw Error("MESSAGE_FAILED");
            },
          });
    f.failWith(rejection);
    expect(
      await f.service.command(f.spec.sessionId, (c) => c.snapshot(hash(stream), ["M1"])),
    ).toMatchObject({ ok: false, code: "SNAPSHOT_REJECTED", state: "FAILED" });
    expect(seen).toEqual(payload === "hostile" ? ["FAILED"] : []);
    await phaseA(f, before, count);
    await phaseB(f, before, count);
  });
it("invalid snapshot request after successful source validation remains nonfatal", async () => {
  const f = await setup(),
    before = artifacts(f.path),
    count = f.calls();
  expect(
    await f.service.command(f.spec.sessionId, (c) =>
      c.snapshot(hash("unknown-stream"), ["UNKNOWN"]),
    ),
  ).toMatchObject({ ok: false, code: "SNAPSHOT_REJECTED", state: "READY" });
  expect(f.controller.currentCheckpoint()).toEqual(f.checkpoint);
  expect(artifacts(f.path)).toEqual(before);
  expect(f.calls()).toBe(count);
  expect((await f.service.managedService.checkReadiness!(context)).status).toBe("READY");
  await f.service.shutdown();
  await f.service.shutdown();
});
it("snapshot diagnostic reentrant shutdown cannot replace terminal source failure", async () => {
  const f = await setup(),
    before = artifacts(f.path),
    count = f.calls();
  let stop: Promise<unknown> | undefined;
  let at: string | undefined;
  f.failWith(
    Object.defineProperty(Error(), "message", {
      get: () => {
        at = f.controller.diagnostics().state;
        stop = f.service
          .shutdown()
          .catch((e: unknown) => (e instanceof Error ? e.message : "UNKNOWN"));
        throw Error("MESSAGE_FAILED");
      },
    }),
  );
  expect(
    await f.service.command(f.spec.sessionId, (c) => c.snapshot(hash(stream), ["M1"])),
  ).toMatchObject({ ok: false, code: "SNAPSHOT_REJECTED", state: "FAILED" });
  expect(at).toBe("FAILED");
  expect(await stop).toBe("REPLAY_SHUTDOWN_OBLIGATION");
  await phaseA(f, before, count);
  await phaseB(f, before, count);
});
for (const payload of ["normal", "hostile"] as const)
  it(`actual pending-read reconciliation source failure ${payload} preserves read obligation`, async () => {
    const tasks: readonly ReplayTaskDescriptor[] = [
      {
        taskId: "004H-reconciliation",
        dueAt: t("10:02:00"),
        action: {
          kind: "WATERMARK",
          streamId: hash(stream),
          authorityReference: "recorded-source-owner",
          evidence: {
            sessionId: "session-1",
            through: t("10:02:00"),
            observedAt: t("10:02:00"),
            coverage: "COMPLETE_COVERAGE",
            kind: "END_OF_STREAM",
            evidenceId: "004H-source-reconciliation",
            reconciled: true,
          },
        },
      },
    ];
    const f = await setup(tasks);
    let enter: (() => void) | undefined, release: ((value: undefined) => void) | undefined;
    const seen = new Promise<void>((r) => {
        enter = r;
      }),
      gate = new Promise<undefined>((r) => {
        release = r;
      });
    class Held extends ConsumerChannel {
      public override async read() {
        enter?.();
        return gate;
      }
    }
    const pending = f.controller.observeConsumerChannel(
      new Held("004H-reconcile", 1),
      "004H-artifact",
    );
    await seen;
    expect((await f.controller.stop()).ok).toBe(false);
    release?.(undefined);
    expect((await pending).ok).toBe(false);
    const recoveredRuntime = await governedFixture();
    expect((await recoveredRuntime.runtime.start()).ok).toBe(true);
    const c = await recoveredRuntime.service.admit(raw(f.spec), f.inputs, f.repository);
    expect(
      (await recoveredRuntime.service.command(f.spec.sessionId, (x) => x.runToTime(t("10:02:00"))))
        .ok,
    ).toBe(true);
    const checkpoint = c.currentCheckpoint();
    if (!checkpoint) throw Error("CHECKPOINT_MISSING");
    const id = checkpoint.evidence.find((e) => e.kind === "CHANNEL_READ_PENDING")?.identity;
    if (!id) throw Error("PENDING_READ_MISSING");
    expect(c.diagnostics().pendingConsumerReads).toBe(1);
    const before = artifacts(f.path);
    const states: string[] = [];
    f.failWith(
      payload === "normal"
        ? Error("SOURCE_INVALID")
        : Object.defineProperty(Error(), "message", {
            get: () => {
              states.push(c.diagnostics().state);
              throw Error("MESSAGE_FAILED");
            },
          }),
    );
    expect(
      await recoveredRuntime.service.command(f.spec.sessionId, (x) => x.reconcileConsumerRead(id)),
    ).toMatchObject({ ok: false, code: "SOURCE_VERIFICATION_FAILED", state: "FAILED" });
    expect(states).toEqual(payload === "hostile" ? ["FAILED"] : []);
    expect(c.diagnostics()).toMatchObject({
      state: "FAILED",
      busy: false,
      pendingConsumerReads: 1,
    });
    expect(c.currentCheckpoint()).toEqual(checkpoint);
    expect(artifacts(f.path)).toEqual(before);
    expect(recoveredRuntime.service.diagnostics()).toMatchObject({ sessions: 1, busy: false });
    expect((await recoveredRuntime.service.managedService.checkReadiness!(context)).status).toBe(
      "NOT_READY",
    );
    for (let i = 0; i < 2; i++)
      await expect(recoveredRuntime.service.shutdown()).rejects.toThrow(
        "REPLAY_SHUTDOWN_OBLIGATION",
      );
    f.restore();
    const fresh = new ReplayController(f.spec, f.inputs, f.repository);
    expect((await fresh.initialize()).ok).toBe(true);
    expect(fresh.diagnostics().pendingConsumerReads).toBe(1);
    expect((await fresh.reconcileConsumerRead(id)).ok).toBe(true);
    expect(fresh.diagnostics().pendingConsumerReads).toBe(0);
    expect((await fresh.stop()).ok).toBe(true);
  });
