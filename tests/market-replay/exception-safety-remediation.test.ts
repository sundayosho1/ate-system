import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, it, expect, vi } from "vitest";
import { hash } from "@ate/multitimeframe";
import * as aggregationOwner from "@ate/multitimeframe";
import type { LifecycleContext, RuntimeInstanceId } from "@ate/runtime";
import {
  ReplayController,
  FilesystemReplayCheckpointRepository,
  immutableReplayInputs,
  resolveHistoricalReplayInputs,
  createReplayCheckpoint,
  type ReplayCheckpointRepository,
  type ReplayResolvedInputs,
  type ReplaySessionSpecification,
  type ReplayState,
  type ReplayCommandResult,
} from "@ate/market-replay";
import { governedFixture } from "./integration-fixtures.js";
import { historicalFixture } from "./historical-fixture.js";
import { t } from "./fixtures.js";
const fallback = "UNCLASSIFIED_INITIALIZATION_FAILURE";
const roots: string[] = [];
function root() {
  const p = mkdtempSync(join(tmpdir(), "ate-004f-"));
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
function raw(s: ReplaySessionSpecification) {
  const { fingerprint: _fp, ...body } = s;
  return body;
}
async function setup(overrides: Record<string, unknown> = {}) {
  const f = await governedFixture(true, overrides);
  expect((await f.runtime.start()).ok).toBe(true);
  const path = root(),
    repository = new FilesystemReplayCheckpointRepository(path, f.clock, f.spec.resourceLimits);
  let calls = 0;
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
  return { ...f, path, repository, port, calls: () => calls };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function available(f: Fixture) {
  expect((await f.service.managedService.checkReadiness!(context)).status).toBe("READY");
  expect((await f.service.managedService.checkHealth!(context)).status).toBe("HEALTHY");
}
async function unavailable(f: Fixture) {
  expect((await f.service.managedService.checkReadiness!(context)).status).toBe("NOT_READY");
  expect((await f.service.managedService.checkHealth!(context)).status).toBe("DEGRADED");
}
async function stopTwice(f: Fixture) {
  await f.service.shutdown();
  const calls = f.calls();
  await f.service.shutdown();
  expect(f.calls()).toBe(calls);
  expect(f.service.diagnostics().lifecycle).toBe("STOPPED");
}
async function phaseA(f: Fixture, failureCode = fallback) {
  expect(f.calls()).toBe(0);
  expect(readdirSync(f.path)).toEqual([]);
  expect(f.service.diagnostics()).toMatchObject({
    sessions: 0,
    busy: false,
    pendingControlEvents: 0,
    sessionStates: [],
  });
  expect(f.service.diagnostics().disposedAdmissions).toHaveLength(1);
  expect(f.service.diagnostics().disposedAdmissions[0]).toMatchObject({
    failureCode,
    sourceVerification: "FAILED",
    repositoryPhase: "NOT_INITIATED",
    at: f.clock.now(),
  });
  await available(f);
}
async function retry(f: Fixture, inputs: ReplayResolvedInputs = f.inputs) {
  const c = await f.service.admit(raw(f.spec), inputs, f.port);
  expect(c.currentCheckpoint()?.sessionId).toBe(f.spec.sessionId);
  expect(c.diagnostics()).toMatchObject({
    state: "READY",
    obligation: null,
    sourceVerification: "VERIFIED",
  });
  expect(f.calls()).toBeGreaterThan(0);
  await available(f);
  await stopTwice(f);
  return c;
}
function hostileError(onRead: () => void = () => {}) {
  const error = new Error();
  Object.defineProperty(error, "message", {
    get: () => {
      onRead();
      throw Error("DIAGNOSTIC_ACCESS_FAILED");
    },
  });
  return error;
}
function rejecting(f: Fixture, rejection: unknown) {
  return immutableReplayInputs(f.inputs.manifests, () => {
    // The supported verifier contract permits arbitrary JS rejection values.
    return new Promise<void>((_resolve, reject) => {
      // Invoke the native reject capability with the exact adversarial value.
      // No Error conversion may hide the rejection shape under test.
      Reflect.apply(reject, undefined, [rejection]);
    });
  });
}
function originalInitialization(): (this: ReplayController) => Promise<ReplayCommandResult> {
  const original: unknown = Reflect.get(ReplayController.prototype, "initialize");
  if (typeof original !== "function") throw Error("INITIALIZER_MISSING");
  return original as (this: ReplayController) => Promise<ReplayCommandResult>;
}
it("A: lifecycle is terminal before a throwing message accessor; zero effects, same identity retry and repeated stop", async () => {
  const f = await setup();
  let reads = 0;
  let observed: ReturnType<ReplayController["diagnostics"]> | undefined;
  const error = hostileError(() => {
    reads++;
    observed = f.service.diagnostics().sessionStates[0];
  });
  await expect(f.service.admit(raw(f.spec), rejecting(f, error), f.port)).rejects.toThrow(
    "INITIALIZATION_FAILED",
  );
  expect(reads).toBe(1);
  // Assert outside the guarded accessor so diagnostic containment cannot swallow
  // a failed lifecycle assertion.
  expect(observed).toMatchObject({
    state: "FAILED",
    sourceVerification: "FAILED",
    repositoryPhase: "NOT_INITIATED",
    checkpointId: null,
    obligation: null,
  });
  await phaseA(f);
  await retry(f);
});
it("B: a valid first message read is retained without a second accessor invocation", async () => {
  const f = await setup();
  let reads = 0;
  const error = new Error();
  Object.defineProperty(error, "message", {
    get: () => {
      if (++reads === 1) return "SOURCE_VERIFICATION_FAILED";
      throw Error("SECOND_READ_FAILED");
    },
  });
  await expect(f.service.admit(raw(f.spec), rejecting(f, error), f.port)).rejects.toThrow(
    "INITIALIZATION_FAILED",
  );
  expect(reads).toBe(1);
  await phaseA(f, "SOURCE_VERIFICATION_FAILED");
  await retry(f);
});
const revoked = Proxy.revocable({}, {});
revoked.revoke();
const coercion = {
  [Symbol.toPrimitive]: () => {
    throw Error("COERCION_MUST_NOT_RUN");
  },
};
const symbolError = new Error();
Object.defineProperty(symbolError, "message", { value: Symbol("source detail") });
const numberError = new Error();
Object.defineProperty(numberError, "message", { value: 17 });
const proxy = new Proxy(
  {},
  {
    get: () => {
      throw Error("PROXY_ACCESS_FAILED");
    },
  },
);
it.each([
  ["normal Error", Error("SOURCE_VERIFICATION_FAILED"), "SOURCE_VERIFICATION_FAILED"],
  ["C Symbol message", symbolError, fallback],
  ["D throwing Proxy", proxy, fallback],
  ["D revoked Proxy", revoked.proxy, fallback],
  ["E string", "PRIVATE_REJECTION_TEXT", fallback],
  ["E number", 17, fallback],
  ["E null", null, fallback],
  ["E undefined", undefined, fallback],
  ["object without message", {}, fallback],
  ["malformed message", Error("private verifier payload"), fallback],
  ["non-string message", numberError, fallback],
  ["message with hostile coercion", { message: coercion }, fallback],
  ["overlong message", Error("A".repeat(129)), fallback],
] satisfies [string, unknown, string][])(
  "C/D/E: total bounded normalization for %s",
  async (_label, rejection, expected) => {
    const f = await setup();
    await expect(f.service.admit(raw(f.spec), rejecting(f, rejection), f.port)).rejects.toThrow(
      "INITIALIZATION_FAILED",
    );
    await phaseA(f, expected);
    expect(JSON.stringify(f.service.diagnostics())).not.toContain("private verifier payload");
    await retry(f);
  },
);
it("F/O: repeated hostile errors obey configured diagnostic/session capacity and immutable evidence snapshots", async () => {
  const f = await setup({
    "research.replay.maxSessions": 1,
    "research.replay.maxEvidenceRecords": 2,
  });
  let reads = 0;
  const inputs = rejecting(
    f,
    hostileError(() => reads++),
  );
  await expect(f.service.admit(raw(f.spec), inputs, f.port)).rejects.toThrow(
    "INITIALIZATION_FAILED",
  );
  const before = f.service.diagnostics();
  for (let i = 1; i < 9; i++) {
    await expect(f.service.admit(raw(f.spec), inputs, f.port)).rejects.toThrow(
      "INITIALIZATION_FAILED",
    );
    expect(f.calls()).toBe(0);
    expect(f.service.diagnostics()).toMatchObject({
      sessions: 0,
      busy: false,
      pendingControlEvents: 0,
    });
    expect(f.service.diagnostics().disposedAdmissions.length).toBeLessThanOrEqual(2);
  }
  expect(reads).toBe(9);
  expect(f.service.diagnostics()).toMatchObject({
    evictedAdmissionDiagnostics: 7,
    failedAdmissionDiagnosticSamples: 0,
  });
  expect(Object.isFrozen(before)).toBe(true);
  expect(Object.isFrozen(before.disposedAdmissions)).toBe(true);
  expect(Object.isFrozen(before.disposedAdmissions[0])).toBe(true);
  expect(before.disposedAdmissions).toHaveLength(1);
  expect(before.evictedAdmissionDiagnostics).toBe(0);
  expect(before.disposedAdmissions[0]?.failureCode).toBe(fallback);
  expect(readdirSync(f.path)).toEqual([]);
  await retry(f);
});
it("G: actual source bytes mutate, hostile verifier rejection stays side-effect-free, restored bytes permit same identity", async () => {
  const f = await setup(),
    file = join(root(), "source.json");
  const accepted = JSON.stringify(f.inputs.manifests);
  writeFileSync(file, accepted);
  const fingerprint = hash(readFileSync(file, "utf8"));
  const inputs = immutableReplayInputs(f.inputs.manifests, () => {
    if (hash(readFileSync(file, "utf8")) !== fingerprint) return Promise.reject(hostileError());
    return Promise.resolve();
  });
  writeFileSync(file, accepted + "\n");
  await expect(f.service.admit(raw(f.spec), inputs, f.port)).rejects.toThrow(
    "INITIALIZATION_FAILED",
  );
  await phaseA(f);
  writeFileSync(file, accepted);
  await inputs.verify();
  await retry(f, inputs);
});
it("H: actual historical owner rejection remains primary despite hostile diagnostic wrapping", async () => {
  const f = await setup(),
    h = await historicalFixture(),
    originalInputs = await resolveHistoricalReplayInputs(h.options),
    m = originalInputs.manifests[0];
  if (!m) throw Error("HISTORICAL_MANIFEST_MISSING");
  const spec = {
    ...raw(f.spec),
    sessionId: "exception-historical",
    sourceManifestIds: [m.manifestId],
    datasetFingerprints: [m.contentFingerprint],
  };
  const original = h.repository.getManifest.bind(h.repository);
  h.repository.getManifest = async (id) => {
    const r = await original(id);
    return r.ok
      ? { ...r, value: { ...r.value, observationCount: r.value.observationCount + 1 } }
      : r;
  };
  let primary: unknown;
  const inputs = immutableReplayInputs(originalInputs.manifests, async () => {
    try {
      await originalInputs.verify();
    } catch (error) {
      primary = error;
      throw hostileError();
    }
  });
  await expect(f.service.admit(spec, inputs, f.port)).rejects.toThrow("INITIALIZATION_FAILED");
  expect(primary).toBeInstanceOf(Error);
  expect((primary as Error).message).toBe("HISTORICAL_CONTENT_INTEGRITY");
  await phaseA(f);
  h.repository.getManifest = original;
  await inputs.verify();
  const c = await f.service.admit(spec, inputs, f.port);
  expect(c.currentCheckpoint()?.sessionId).toBe(spec.sessionId);
  await available(f);
  await stopTwice(f);
});
it("I: unexpected exit before verification is finalized from NOT_STARTED provenance and safely disposed", async () => {
  const f = await setup();
  const init = vi
    .spyOn(ReplayController.prototype, "initialize")
    .mockImplementationOnce(() => Promise.reject(hostileError()));
  await expect(f.service.admit(raw(f.spec), f.inputs, f.port)).rejects.toThrow(
    "INITIALIZATION_FAILED",
  );
  expect(f.calls()).toBe(0);
  expect(f.service.diagnostics()).toMatchObject({
    sessions: 0,
    busy: false,
    disposedAdmissions: [
      {
        sourceVerification: "NOT_STARTED",
        repositoryPhase: "NOT_INITIATED",
        failureCode: fallback,
      },
    ],
  });
  await available(f);
  init.mockRestore();
  await retry(f);
});
it("I: exceptional exit after settled source rejection reuses authoritative provenance, not exception text", async () => {
  const f = await setup(),
    original = originalInitialization();
  const initializationSpy = vi.spyOn(ReplayController.prototype, "initialize");
  const init = initializationSpy.mockImplementationOnce(async function (this: ReplayController) {
    expect((await original.call(this)).ok).toBe(false);
    throw hostileError();
  });
  await expect(
    f.service.admit(raw(f.spec), rejecting(f, Error("SOURCE_FAILED")), f.port),
  ).rejects.toThrow("INITIALIZATION_FAILED");
  await phaseA(f);
  init.mockRestore();
  await retry(f);
});
it("I/J: unexpected exit after an actual uncertain write retains the real obligation and fresh recovery", async () => {
  const f = await setup(),
    original = originalInitialization();
  const initializationSpy = vi.spyOn(ReplayController.prototype, "initialize");
  initializationSpy.mockImplementationOnce(async function (this: ReplayController) {
    expect((await original.call(this)).ok).toBe(false);
    throw hostileError();
  });
  const port: ReplayCheckpointRepository = {
    ...f.port,
    commit: (cp) => {
      const r = f.port.commit(cp);
      return r.ok
        ? {
            ok: false,
            operationId: r.value.operationId,
            code: "REAL_WRITE_UNCERTAIN",
            commitment: "UNKNOWN_COMMITMENT",
          }
        : r;
    },
  };
  await expect(f.service.admit(raw(f.spec), f.inputs, port)).rejects.toThrow(
    "INITIALIZATION_FAILED",
  );
  expect(readdirSync(f.path).length).toBeGreaterThan(0);
  expect(f.service.diagnostics()).toMatchObject({
    sessions: 1,
    disposedAdmissions: [],
    sessionStates: [
      {
        state: "RECOVERY_REQUIRED",
        repositoryPhase: "WRITE_INITIATED",
        checkpointId: null,
        obligation: { commitment: "UNKNOWN_COMMITMENT" },
      },
    ],
  });
  await unavailable(f);
  await expect(f.service.admit(raw(f.spec), f.inputs, f.port)).rejects.toThrow(
    "SESSION_IDENTITY_CONFLICT",
  );
  await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  const fresh = new ReplayController(f.spec, f.inputs, f.repository);
  expect((await fresh.initialize()).ok).toBe(true);
  expect(fresh.diagnostics().obligation).toBeNull();
});
it("I: unexpected exit after initiated recovery keeps null-acknowledgement uncertainty", async () => {
  const f = await setup(),
    original = originalInitialization();
  const initializationSpy = vi.spyOn(ReplayController.prototype, "initialize");
  initializationSpy.mockImplementationOnce(async function (this: ReplayController) {
    await original.call(this);
    throw hostileError();
  });
  await expect(
    f.service.admit(raw(f.spec), f.inputs, {
      ...f.port,
      recover: (s) => {
        f.port.recover(s);
        throw Error("RECOVERY_LOST");
      },
    }),
  ).rejects.toThrow("INITIALIZATION_FAILED");
  expect(f.service.diagnostics()).toMatchObject({
    sessions: 1,
    disposedAdmissions: [],
    sessionStates: [
      {
        repositoryPhase: "RECOVERY_IN_FLIGHT",
        checkpointId: null,
        obligation: { commitment: "UNKNOWN_COMMITMENT" },
      },
    ],
  });
  await unavailable(f);
  await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
});
it("K: corrupt recovered view is retained across exceptional exit, with null acknowledgement and genuine content", async () => {
  const f = await setup(),
    seed = new ReplayController(f.spec, f.inputs, f.repository);
  expect((await seed.initialize()).ok).toBe(true);
  const original = originalInitialization();
  const initializationSpy = vi.spyOn(ReplayController.prototype, "initialize");
  initializationSpy.mockImplementationOnce(async function (this: ReplayController) {
    await original.call(this);
    throw hostileError();
  });
  const port: ReplayCheckpointRepository = {
    ...f.port,
    recover: (s) => {
      const r = f.port.recover(s);
      return r.ok && r.value
        ? {
            ok: true,
            value: {
              ...r.value,
              checkpoint: createReplayCheckpoint({ ...r.value.checkpoint, cursor: 999 }),
            },
          }
        : r;
    },
  };
  await expect(f.service.admit(raw(f.spec), f.inputs, port)).rejects.toThrow(
    "INITIALIZATION_FAILED",
  );
  expect(f.service.diagnostics()).toMatchObject({
    sessions: 1,
    disposedAdmissions: [],
    sessionStates: [
      {
        state: "FAILED",
        repositoryPhase: "RECOVERED_CONTENT",
        checkpointId: null,
        obligation: null,
      },
    ],
  });
  await unavailable(f);
  await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  const fresh = new ReplayController(f.spec, f.inputs, f.repository);
  expect((await fresh.initialize()).ok).toBe(true);
  expect(fresh.currentCheckpoint()).toEqual(seed.currentCheckpoint());
});
it("L: readiness explicitly rejects noninitialized/failed/recovery views even with an acknowledged checkpoint and no runtime lock", async () => {
  const f = await setup(),
    c = await f.service.admit(raw(f.spec), f.inputs, f.port),
    original = c.diagnostics();
  await available(f);
  const diagnostic = vi.spyOn(c, "diagnostics");
  // Fault-injected diagnostic views exercise the fail-closed predicate; they do
  // not claim these are legal transitions or mutate authoritative owner state.
  for (const state of [
    "CREATED",
    "VALIDATING",
    "FAILED",
    "STOPPING",
    "RECOVERY_REQUIRED",
  ] satisfies ReplayState[]) {
    diagnostic.mockReturnValue({ ...original, state, busy: false });
    await unavailable(f);
  }
  diagnostic.mockReturnValue({ ...original, busy: true });
  await unavailable(f);
  diagnostic.mockReturnValue({ ...original, sourceVerification: "FAILED" });
  await unavailable(f);
  diagnostic.mockRestore();
  const checkpoint = vi.spyOn(c, "currentCheckpoint").mockReturnValue(undefined);
  await unavailable(f);
  checkpoint.mockRestore();
  await available(f);
  await stopTwice(f);
});
it("L: runtime control publication uncertainty stays unavailable until real event retry", async () => {
  const f = await setup();
  await f.bus.stop();
  await expect(f.service.admit(raw(f.spec), f.inputs, f.port)).rejects.toThrow(
    "REPLAY_CONTROL_PUBLICATION_FAILED",
  );
  expect(f.service.diagnostics()).toMatchObject({
    sessions: 1,
    pendingControlEvents: 1,
    disposedAdmissions: [],
  });
  expect(f.service.diagnostics().sessionStates[0]?.checkpointId).not.toBeNull();
  await unavailable(f);
  f.bus.start();
  await f.service.retryControlEvents();
  await available(f);
  await stopTwice(f);
});
it("M/N: held verification, concurrent shutdown, hostile rejection and settled replacement ownership", async () => {
  const f = await setup();
  let enter!: () => void, resolve!: () => void, reject!: (error: unknown) => void;
  const seen = new Promise<void>((r) => (enter = r)),
    gate = new Promise<void>((a, b) => {
      resolve = a;
      reject = b;
    });
  const inputs = immutableReplayInputs(f.inputs.manifests, async () => {
    enter();
    await gate;
  });
  const pending = f.service.admit(raw(f.spec), inputs, f.port),
    expected = expect(pending).rejects.toThrow("INITIALIZATION_FAILED");
  await seen;
  await unavailable(f);
  await expect(f.service.admit(raw(f.spec), f.inputs, f.port)).rejects.toThrow(
    "REPLAY_ADMISSION_NOT_READY",
  );
  reject(hostileError());
  await expected;
  await phaseA(f);
  const replacement = await f.service.admit(raw(f.spec), f.inputs, f.port),
    checkpoint = replacement.currentCheckpoint();
  resolve();
  reject(hostileError());
  await Promise.resolve();
  expect(replacement.currentCheckpoint()).toEqual(checkpoint);
  expect(f.service.sessionSpecifications()).toEqual([replacement.specification]);
  await stopTwice(f);
});
it("M: shutdown during a held verifier cannot report success; hostile rejection then allows repeated clean stop", async () => {
  const f = await setup();
  let enter!: () => void, reject!: (error: unknown) => void;
  const seen = new Promise<void>((r) => (enter = r)),
    gate = new Promise<void>((_a, b) => (reject = b));
  const pending = f.service.admit(
      raw(f.spec),
      immutableReplayInputs(f.inputs.manifests, async () => {
        enter();
        await gate;
      }),
      f.port,
    ),
    expected = expect(pending).rejects.toThrow("INITIALIZATION_FAILED");
  await seen;
  await unavailable(f);
  await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  reject(hostileError());
  await expected;
  expect(f.calls()).toBe(0);
  expect(f.service.diagnostics()).toMatchObject({
    sessions: 0,
    busy: false,
    lifecycle: "STOPPING",
  });
  await unavailable(f);
  await stopTwice(f);
});
it("diagnostic getter reentrant shutdown cannot strand a failed pre-repository owner", async () => {
  const f = await setup();
  let nested: Promise<unknown> | undefined, stopping: Promise<unknown> | undefined;
  const error = hostileError(() => {
    nested = f.service.admit(raw(f.spec), f.inputs, f.port).catch((e: Error) => e.message);
    stopping = f.service.shutdown().catch((e: Error) => e.message);
  });
  await expect(f.service.admit(raw(f.spec), rejecting(f, error), f.port)).rejects.toThrow(
    "INITIALIZATION_FAILED",
  );
  expect(await nested).toBe("REPLAY_ADMISSION_NOT_READY");
  expect(await stopping).toBe("REPLAY_SHUTDOWN_OBLIGATION");
  expect(f.calls()).toBe(0);
  expect(f.service.diagnostics()).toMatchObject({
    sessions: 0,
    busy: false,
    lifecycle: "STOPPING",
  });
  await stopTwice(f);
});
it("optional diagnostic sampling failure cannot replace public failure or poison retry", async () => {
  const f = await setup();
  vi.spyOn(f.clock, "now").mockImplementationOnce(() => {
    throw Error("SAMPLE_CLOCK_UNAVAILABLE");
  });
  await expect(f.service.admit(raw(f.spec), rejecting(f, hostileError()), f.port)).rejects.toThrow(
    "INITIALIZATION_FAILED",
  );
  expect(f.calls()).toBe(0);
  expect(f.service.diagnostics()).toMatchObject({
    sessions: 0,
    busy: false,
    disposedAdmissions: [],
    failedAdmissionDiagnosticSamples: 1,
    evictedAdmissionDiagnostics: 0,
  });
  await available(f);
  await retry(f);
});
it("active controller work cannot be certified settled by exceptional-exit containment", async () => {
  const f = await setup();
  let enter!: () => void, reject!: (error: unknown) => void;
  const seen = new Promise<void>((r) => (enter = r)),
    gate = new Promise<void>((_a, b) => (reject = b));
  const inputs = immutableReplayInputs(f.inputs.manifests, async () => {
    enter();
    await gate;
  });
  const c = new ReplayController(f.spec, inputs, f.repository),
    init = c.initialize();
  const expected = expect(init).resolves.toMatchObject({
    ok: false,
    code: "INITIALIZATION_FAILED",
    state: "FAILED",
  });
  await seen;
  expect(c.containInitializationException(hostileError())).toMatchObject({
    ok: false,
    code: "INITIALIZATION_FAILED",
    state: "VALIDATING",
  });
  expect(c.canDisposeProvisionalAdmission()).toBe(false);
  expect(c.diagnostics()).toMatchObject({
    sourceVerification: "IN_FLIGHT",
    busy: true,
    repositoryPhase: "NOT_INITIATED",
  });
  reject(hostileError());
  await expected;
  expect(c.canDisposeProvisionalAdmission()).toBe(true);
  expect(readdirSync(f.path)).toEqual([]);
  await stopTwice(f);
});
it("I/J: an unexpected exit after acknowledged commitment cannot delete its durable session", async () => {
  const f = await setup(),
    original = originalInitialization();
  const initializationSpy = vi.spyOn(ReplayController.prototype, "initialize");
  let acknowledged: ReturnType<ReplayController["currentCheckpoint"]>;
  initializationSpy.mockImplementationOnce(async function (this: ReplayController) {
    await original.call(this);
    acknowledged = this.currentCheckpoint();
    throw hostileError();
  });
  await expect(f.service.admit(raw(f.spec), f.inputs, f.port)).rejects.toThrow(
    "INITIALIZATION_FAILED",
  );
  expect(acknowledged).toBeDefined();
  expect(f.service.diagnostics()).toMatchObject({
    sessions: 1,
    disposedAdmissions: [],
    sessionStates: [
      {
        state: "FAILED",
        repositoryPhase: "WRITE_INITIATED",
        checkpointId: acknowledged?.checkpointId,
        obligation: null,
      },
    ],
  });
  await unavailable(f);
  await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  const fresh = new ReplayController(f.spec, f.inputs, f.repository);
  expect((await fresh.initialize()).ok).toBe(true);
  expect(fresh.currentCheckpoint()).toEqual(acknowledged);
});
it("I/J: publication uncertainty preserves confirmed content through an unexpected initialization exit", async () => {
  const f = await setup(),
    original = originalInitialization();
  const initializationSpy = vi.spyOn(ReplayController.prototype, "initialize");
  initializationSpy.mockImplementationOnce(async function (this: ReplayController) {
    await original.call(this);
    throw hostileError();
  });
  const port: ReplayCheckpointRepository = {
    ...f.port,
    publish: (operationId) => ({
      ok: false,
      code: "PUBLICATION_UNRESOLVED",
      operationId,
      commitment: "COMMITTED",
    }),
  };
  await expect(f.service.admit(raw(f.spec), f.inputs, port)).rejects.toThrow(
    "INITIALIZATION_FAILED",
  );
  expect(f.service.diagnostics()).toMatchObject({
    sessions: 1,
    disposedAdmissions: [],
    sessionStates: [
      {
        state: "RECOVERY_REQUIRED",
        repositoryPhase: "WRITE_INITIATED",
        checkpointId: null,
        obligation: { commitment: "COMMITTED" },
      },
    ],
  });
  expect(readdirSync(f.path).length).toBeGreaterThan(0);
  await unavailable(f);
  await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  const fresh = new ReplayController(f.spec, f.inputs, f.repository);
  expect((await fresh.initialize()).ok).toBe(true);
});
it("I: verified source followed by a pure pre-repository failure releases only the settled provisional owner", async () => {
  const f = await setup(),
    originalHash = aggregationOwner.hash;
  const hashing = vi.spyOn(aggregationOwner, "hash").mockImplementation((value: unknown) => {
    // Initialization hashes the session identity before setting any recovery
    // obligation or entering the repository. Fail this pure boundary only.
    if (value === f.spec.sessionId) throw hostileError();
    return originalHash(value);
  });
  await expect(f.service.admit(raw(f.spec), f.inputs, f.port)).rejects.toThrow(
    "INITIALIZATION_FAILED",
  );
  expect(f.calls()).toBe(0);
  expect(readdirSync(f.path)).toEqual([]);
  expect(f.service.diagnostics()).toMatchObject({
    sessions: 0,
    busy: false,
    pendingControlEvents: 0,
    disposedAdmissions: [
      { sourceVerification: "VERIFIED", repositoryPhase: "NOT_INITIATED", failureCode: fallback },
    ],
  });
  hashing.mockRestore();
  await available(f);
  await retry(f);
});
