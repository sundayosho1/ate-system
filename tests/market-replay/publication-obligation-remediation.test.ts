import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { defaultDeliveryPolicy, subscriptionId } from "@ate/events";
import type { ATEEvent } from "@ate/events";
import { hash, canonicalRevisionId } from "@ate/multitimeframe";
import {
  buildReplayResearchRuntime,
  createReplaySpecification,
  FilesystemReplayCheckpointRepository,
  immutableReplayInputs,
  ReplayRuntimeService,
} from "@ate/market-replay";
import type {
  ReplayCheckpoint,
  ReplayCheckpointRepository,
  ReplaySessionSpecification,
} from "@ate/market-replay";
import type { LifecycleContext, RuntimeInstanceId } from "@ate/runtime";
import { governedFixture } from "./integration-fixtures.js";
import { t } from "./fixtures.js";
const roots: string[] = [];
const context: LifecycleContext = {
  runtimeInstanceId: "40000000-0000-4000-8000-000000000104" as RuntimeInstanceId,
  runtimeMode: "RESEARCH",
  signal: new AbortController().signal,
  now: () => t("13:00:00"),
};
type Payload = Pick<
  ReplayCheckpoint,
  "sessionId" | "checkpointId" | "state" | "logicalTime" | "cursor"
> & {
  researchOnly: true;
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function raw(specification: ReplaySessionSpecification) {
  const { fingerprint: _fp, ...value } = specification;
  return value;
}
function files(path: string) {
  return Object.fromEntries(
    readdirSync(path).map((name) => [name, hash(readFileSync(join(path, name), "utf8"))]),
  );
}
async function setup(limit = 4) {
  const f = await governedFixture(true, {
    "research.replay.maxEvidenceRecords": limit,
    "research.replay.maxSessions": 8,
  });
  let effective = f.configuration;
  let reader: (() => void) | undefined;
  let afterVerify: (() => void) | undefined;
  let afterPublication: (() => void) | undefined;
  let sourceRejection: unknown = Error("SOURCE_CHANGED");
  const service = new ReplayRuntimeService({
    clock: f.clock,
    configuration: () => {
      const callback = reader;
      reader = undefined;
      callback?.();
      return effective;
    },
    authority: f.authority,
    eventRegistry: f.eventRegistry,
    eventFactory: f.eventFactory,
    eventBus: f.bus,
  });
  const composed = buildReplayResearchRuntime(service, {
    runtimeInstanceId: context.runtimeInstanceId,
    runtimeVersion: "0.19.0-market-replay.1",
    mode: "RESEARCH",
    clock: f.clock,
  });
  if (!composed.ok) throw Error("RUNTIME_COMPOSITION");
  expect((await composed.runtime.start()).ok).toBe(true);
  const observed: ATEEvent<Payload>[] = [];
  expect(
    f.bus.register<Payload>({
      subscriptionId: subscriptionId("data.replay.audit-j"),
      subscriberId: "004J-auditor",
      description: "Actual research control summary observations",
      eventTypes: ["data.replay.control.v1"],
      criticality: "OPTIONAL",
      policy: defaultDeliveryPolicy,
      handler: ({ event }) => {
        observed.push(event);
        return { status: "SUCCESS" };
      },
    }).ok,
  ).toBe(true);
  const root = mkdtempSync(join(tmpdir(), "ate-004j-"));
  roots.push(root);
  const path = join(root, "checkpoints"),
    source = join(root, "source.json");
  const content = JSON.stringify(f.inputs.manifests);
  writeFileSync(source, content);
  const inputs = immutableReplayInputs(f.inputs.manifests, async () => {
    if (readFileSync(source, "utf8") !== content) throw sourceRejection;
    const callback = afterVerify;
    afterVerify = undefined;
    callback?.();
    await Promise.resolve();
  });
  const repository = new FilesystemReplayCheckpointRepository(path, f.clock, f.spec.resourceLimits);
  const calls: string[] = [];
  const port: ReplayCheckpointRepository = {
    recover: (specification) => {
      calls.push("recover");
      return repository.recover(specification);
    },
    commit: (checkpoint) => {
      calls.push("commit:" + checkpoint.checkpointId);
      return repository.commit(checkpoint);
    },
    publish: (id) => {
      calls.push("publish:" + id);
      const result = repository.publish(id);
      if (result.ok) {
        const callback = afterPublication;
        afterPublication = undefined;
        callback?.();
      }
      return result;
    },
  };
  return {
    ...f,
    service,
    runtime: composed.runtime,
    root,
    path,
    source,
    content,
    inputs,
    repository,
    port,
    calls,
    observed,
    setReader: (callback: () => void) => {
      reader = callback;
    },
    setAfterVerify: (callback: () => void) => {
      afterVerify = callback;
    },
    setAfterPublication: (callback: () => void) => {
      afterPublication = callback;
    },
    setEffective: (value: typeof effective) => {
      effective = value;
    },
    setSourceRejection: (value: unknown) => {
      sourceRejection = value;
    },
  };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function admit(f: Fixture, sessionId = f.spec.sessionId, port = f.port) {
  return f.service.admit({ ...raw(f.spec), sessionId }, f.inputs, port);
}
function failReader(f: Fixture) {
  f.setReader(() => {
    throw Error("TRANSIENT_CONFIGURATION_READ");
  });
}
function recovered(f: Fixture, sessionId = f.spec.sessionId) {
  const spec = createReplaySpecification({ ...raw(f.spec), sessionId });
  const result = f.repository.recover(spec);
  if (!result.ok || !result.value) throw Error("EXPECTED_REAL_CHECKPOINT");
  return result.value.checkpoint;
}
async function unavailable(f: Fixture) {
  expect((await f.service.managedService.checkReadiness!(context)).status).toBe("NOT_READY");
  expect((await f.service.managedService.checkHealth!(context)).status).toBe("DEGRADED");
}
async function available(f: Fixture) {
  expect((await f.service.managedService.checkReadiness!(context)).status).toBe("READY");
  expect((await f.service.managedService.checkHealth!(context)).status).toBe("HEALTHY");
}
function summary(event: ATEEvent<Payload>, checkpoint: ReplayCheckpoint) {
  expect(event.payload).toEqual({
    sessionId: checkpoint.sessionId,
    checkpointId: checkpoint.checkpointId,
    state: checkpoint.state,
    logicalTime: checkpoint.logicalTime,
    cursor: checkpoint.cursor,
    researchOnly: true,
  });
  expect(event.envelope.eventId).toBe(
    canonicalRevisionId(
      hash({
        session: checkpoint.sessionId,
        generation: checkpoint.generation,
        fingerprint: checkpoint.fingerprint,
      }),
    ),
  );
}
for (const phase of ["admission", "event", "shutdown"] as const)
  it(`R4-0${phase === "admission" ? 1 : phase === "event" ? 2 : 3}: ${phase} reader failure retains the exact acknowledged summary`, async () => {
    const f = await setup();
    if (phase !== "admission") await admit(f);
    f.setAfterVerify(() => failReader(f));
    const operation =
      phase === "admission"
        ? admit(f)
        : phase === "event"
          ? f.service.command(f.spec.sessionId, (c) => c.stepEvent())
          : f.service.shutdown();
    await expect(operation).rejects.toThrow(
      phase === "shutdown" ? "REPLAY_SHUTDOWN_OBLIGATION" : "TRANSIENT_CONFIGURATION_READ",
    );
    const checkpoint = recovered(f),
      before = files(f.path),
      calls = f.calls.length;
    expect(f.service.diagnostics().controlPublications).toEqual([
      {
        sessionId: checkpoint.sessionId,
        checkpointId: checkpoint.checkpointId,
        generation: checkpoint.generation,
        configurationFingerprint: f.spec.configurationFingerprint,
        phase: "FAILED",
        uncertain: false,
      },
    ]);
    expect(f.observed).toHaveLength(phase === "admission" ? 0 : 1);
    await unavailable(f);
    await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
    expect(f.calls).toHaveLength(calls);
    await f.service.retryControlEvents();
    summary(f.observed.at(-1)!, checkpoint);
    expect(f.service.diagnostics().pendingControlEvents).toBe(0);
    expect(files(f.path)).toEqual(before);
    expect(f.calls).toHaveLength(calls);
    await unavailable(f);
    await f.service.shutdown();
    const stoppedCalls = f.calls.length,
      eventCount = f.observed.length;
    await f.service.shutdown();
    expect(f.calls).toHaveLength(stoppedCalls);
    expect(f.observed).toHaveLength(eventCount);
  });
for (const phase of ["admission", "event", "shutdown"] as const)
  it(`R4-0${phase === "admission" ? 4 : phase === "event" ? 5 : 6}: healthy ${phase} preserves normal publication`, async () => {
    const f = await setup();
    const controller = await admit(f);
    if (phase === "event")
      expect((await f.service.command(f.spec.sessionId, (c) => c.stepEvent())).ok).toBe(true);
    if (phase === "shutdown") await f.service.shutdown();
    summary(f.observed.at(-1)!, controller.currentCheckpoint()!);
    expect(f.observed).toHaveLength(phase === "admission" ? 1 : 2);
    expect(f.service.diagnostics().pendingControlEvents).toBe(0);
    if (phase !== "shutdown") await available(f);
    else await unavailable(f);
    await f.service.shutdown();
    const calls = f.calls.length,
      count = f.observed.length;
    await f.service.shutdown();
    expect(f.calls).toHaveLength(calls);
    expect(f.observed).toHaveLength(count);
  });
it("R4-07: repeated reader failures during retry preserve the original descriptor and files", async () => {
  const f = await setup();
  f.setAfterVerify(() => failReader(f));
  await expect(admit(f)).rejects.toThrow("TRANSIENT_CONFIGURATION_READ");
  const checkpoint = recovered(f),
    before = files(f.path),
    calls = f.calls.length;
  for (let i = 0; i < 3; i++) {
    failReader(f);
    await expect(f.service.retryControlEvents()).rejects.toThrow("TRANSIENT_CONFIGURATION_READ");
    expect(f.service.diagnostics().controlPublications[0]?.checkpointId).toBe(
      checkpoint.checkpointId,
    );
    await unavailable(f);
  }
  await f.service.retryControlEvents();
  summary(f.observed[0]!, checkpoint);
  expect(f.observed).toHaveLength(1);
  expect(files(f.path)).toEqual(before);
  expect(f.calls).toHaveLength(calls);
  await available(f);
});
it("R4-08: capacity one defers unacknowledged owners without losing the first stopped summary", async () => {
  const f = await setup(1);
  const first = await admit(f, "one"),
    second = await admit(f, "two"),
    third = await admit(f, "three");
  const secondBefore = second.currentCheckpoint(),
    thirdBefore = third.currentCheckpoint();
  await f.bus.stop();
  await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  expect(f.service.diagnostics().pendingControlEvents).toBe(1);
  expect(first.currentCheckpoint()?.state).toBe("STOPPED");
  expect(second.currentCheckpoint()).toEqual(secondBefore);
  expect(third.currentCheckpoint()).toEqual(thirdBefore);
  const before = files(f.path),
    calls = f.calls.length;
  for (let i = 0; i < 2; i++)
    await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  expect(files(f.path)).toEqual(before);
  expect(f.calls).toHaveLength(calls);
  await unavailable(f);
  f.bus.start();
  await f.service.retryControlEvents();
  summary(f.observed.at(-1)!, first.currentCheckpoint()!);
  await f.service.shutdown();
  expect(second.currentCheckpoint()?.state).toBe("STOPPED");
  expect(third.currentCheckpoint()?.state).toBe("STOPPED");
  expect(f.service.diagnostics()).toMatchObject({ lifecycle: "STOPPED", pendingControlEvents: 0 });
});
for (const kind of ["throw", "structured", "clock"] as const)
  it(`R4-09: ${kind} envelope preparation failure preserves acknowledgement`, async () => {
    const f = await setup();
    const controller = await admit(f);
    if (kind === "throw")
      vi.spyOn(f.eventFactory, "createRootEvent").mockImplementationOnce(() => {
        throw Error("ENVELOPE_FAILURE");
      });
    if (kind === "structured") {
      const error = f.eventFactory.createRootEvent({
        eventType: "unregistered.event.v1",
        payload: {},
      });
      expect(error.ok).toBe(false);
      vi.spyOn(f.eventFactory, "createRootEvent").mockReturnValueOnce(error);
    }
    if (kind === "clock")
      f.setAfterPublication(() => {
        vi.spyOn(f.clock, "now").mockImplementationOnce(() => {
          throw Error("ENVELOPE_CLOCK_FAILURE");
        });
      });
    await expect(f.service.command(f.spec.sessionId, (c) => c.stepEvent())).rejects.toThrow();
    const checkpoint = controller.currentCheckpoint()!,
      before = files(f.path);
    expect(checkpoint.cursor).toBe(1);
    expect(f.service.diagnostics().controlPublications[0]).toMatchObject({
      checkpointId: checkpoint.checkpointId,
      phase: "FAILED",
      uncertain: false,
    });
    vi.restoreAllMocks();
    await unavailable(f);
    await f.service.retryControlEvents();
    summary(f.observed.at(-1)!, checkpoint);
    expect(files(f.path)).toEqual(before);
  });
for (const kind of ["rejected", "after-delivery"] as const)
  it(`R4-10: event authority ${kind} preserves known failure or genuine reporting uncertainty`, async () => {
    const f = await setup();
    const controller = await admit(f),
      original = f.bus.publish.bind(f.bus);
    if (kind === "rejected") await f.bus.stop();
    else
      vi.spyOn(f.bus, "publish").mockImplementationOnce(async (event) => {
        await original(event);
        throw Error("REPORT_AFTER_DELIVERY");
      });
    await expect(f.service.command(f.spec.sessionId, (c) => c.stepEvent())).rejects.toThrow();
    const checkpoint = controller.currentCheckpoint()!,
      before = files(f.path);
    expect(f.service.diagnostics().controlPublications[0]).toMatchObject({
      checkpointId: checkpoint.checkpointId,
      phase: kind === "rejected" ? "FAILED" : "UNCERTAIN",
      uncertain: kind === "after-delivery",
    });
    if (kind === "after-delivery") {
      summary(f.observed.at(-1)!, checkpoint);
      failReader(f);
      await expect(f.service.retryControlEvents()).rejects.toThrow("TRANSIENT_CONFIGURATION_READ");
      expect(f.service.diagnostics().controlPublications[0]?.phase).toBe("UNCERTAIN");
    }
    vi.restoreAllMocks();
    f.bus.start();
    await f.service.retryControlEvents();
    expect(
      f.observed.filter((e) => e.payload.checkpointId === checkpoint.checkpointId),
    ).toHaveLength(1);
    expect(f.service.diagnostics().pendingControlEvents).toBe(0);
    expect(files(f.path)).toEqual(before);
  });
for (const action of ["readiness", "shutdown", "command", "admission", "retry"] as const)
  it(`R4-11: publication reader reenters ${action} under the original operation lock`, async () => {
    const f = await setup();
    await admit(f);
    let nested: Promise<unknown> | undefined;
    let inside: ReturnType<ReplayRuntimeService["diagnostics"]> | undefined;
    f.setAfterVerify(() =>
      f.setReader(() => {
        inside = f.service.diagnostics();
        if (action === "readiness")
          nested = Promise.resolve(f.service.managedService.checkReadiness!(context));
        if (action === "shutdown") nested = f.service.shutdown().catch((error: unknown) => error);
        if (action === "command")
          nested = f.service
            .command(f.spec.sessionId, (c) => c.stepEvent())
            .catch((error: unknown) => error);
        if (action === "admission") nested = admit(f, "nested").catch((error: unknown) => error);
        if (action === "retry")
          nested = f.service.retryControlEvents().catch((error: unknown) => error);
      }),
    );
    expect((await f.service.command(f.spec.sessionId, (c) => c.stepEvent())).ok).toBe(true);
    const result = await nested;
    expect(inside).toMatchObject({ busy: true, sessions: 1, pendingControlEvents: 1 });
    expect(inside?.controlPublications[0]?.phase).toBe("PREPARING");
    if (action === "readiness") expect(result).toMatchObject({ status: "NOT_READY" });
    else expect(result).toBeInstanceOf(Error);
    expect(f.service.diagnostics()).toMatchObject({
      busy: false,
      sessions: 1,
      pendingControlEvents: 0,
    });
    expect(f.observed).toHaveLength(2);
    if (action === "shutdown") {
      await unavailable(f);
      await f.service.shutdown();
    } else await available(f);
  });
it("R4-12: held asynchronous dispatch retains PUBLISHING and excludes concurrent runtime work", async () => {
  const f = await setup();
  const controller = await admit(f),
    original = f.bus.publish.bind(f.bus);
  let release!: () => void, enter!: () => void;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    seen = new Promise<void>((resolve) => {
      enter = resolve;
    });
  vi.spyOn(f.bus, "publish").mockImplementationOnce(async (event) => {
    enter();
    await gate;
    return original(event);
  });
  const operation = f.service.command(f.spec.sessionId, (c) => c.stepEvent());
  await seen;
  const checkpoint = controller.currentCheckpoint()!,
    before = files(f.path);
  expect(f.service.diagnostics().controlPublications[0]?.phase).toBe("PUBLISHING");
  await unavailable(f);
  await expect(f.service.retryControlEvents()).rejects.toThrow("REPLAY_RUNTIME_NOT_READY");
  await expect(f.service.command(f.spec.sessionId, (c) => c.stepEvent())).rejects.toThrow(
    "REPLAY_RUNTIME_NOT_READY",
  );
  await expect(admit(f, "nested")).rejects.toThrow("REPLAY_ADMISSION_NOT_READY");
  await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  expect(files(f.path)).toEqual(before);
  release();
  expect((await operation).ok).toBe(true);
  summary(f.observed.at(-1)!, checkpoint);
  expect(f.service.diagnostics().pendingControlEvents).toBe(0);
  await f.service.shutdown();
  await f.service.shutdown();
});
it("R4-13: configuration drift and clock advancement cannot replace the retained checkpoint or envelope", async () => {
  const f = await setup();
  const controller = await admit(f);
  await f.bus.stop();
  await expect(f.service.command(f.spec.sessionId, (c) => c.stepEvent())).rejects.toThrow(
    "REPLAY_CONTROL_PUBLICATION_FAILED",
  );
  const checkpoint = controller.currentCheckpoint()!,
    before = files(f.path);
  const changed = await governedFixture(true, { "research.replay.maxSnapshots": 7 });
  f.setEffective(changed.configuration);
  await expect(f.service.retryControlEvents()).rejects.toThrow("GOVERNED_CONFIGURATION_MISMATCH");
  expect(f.service.diagnostics().controlPublications[0]?.configurationFingerprint).toBe(
    f.spec.configurationFingerprint,
  );
  f.setEffective(f.configuration);
  expect(f.clock.advanceTo(t("13:01:00")).ok).toBe(true);
  f.bus.start();
  await f.service.retryControlEvents();
  const event = f.observed.at(-1)!;
  summary(event, checkpoint);
  expect(event.envelope.eventTimestamp).toBe(t("13:00:00"));
  expect(files(f.path)).toEqual(before);
  expect(controller.currentCheckpoint()).toEqual(checkpoint);
});
it("R4-14: multiple pending summaries obey capacity and FIFO, including partial retry success", async () => {
  const f = await setup(2);
  const first = await admit(f, "one"),
    second = await admit(f, "two"),
    third = await admit(f, "three");
  const thirdBefore = third.currentCheckpoint();
  await f.bus.stop();
  await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  expect(f.service.diagnostics().controlPublications.map((x) => [x.sessionId, x.phase])).toEqual([
    ["one", "FAILED"],
    ["two", "PENDING"],
  ]);
  expect(third.currentCheckpoint()).toEqual(thirdBefore);
  f.bus.start();
  const original = f.bus.publish.bind(f.bus);
  vi.spyOn(f.bus, "publish")
    .mockImplementationOnce(original)
    .mockRejectedValueOnce(Error("SECOND_REPORT_UNKNOWN"));
  await expect(f.service.retryControlEvents()).rejects.toThrow("SECOND_REPORT_UNKNOWN");
  summary(f.observed.at(-1)!, first.currentCheckpoint()!);
  expect(f.service.diagnostics().controlPublications).toHaveLength(1);
  expect(f.service.diagnostics().controlPublications[0]).toMatchObject({
    sessionId: "two",
    phase: "UNCERTAIN",
  });
  vi.restoreAllMocks();
  await f.service.retryControlEvents();
  summary(f.observed.at(-1)!, second.currentCheckpoint()!);
  await f.service.shutdown();
  expect(third.currentCheckpoint()?.state).toBe("STOPPED");
  expect(
    f.observed.filter((e) => e.payload.state === "STOPPED").map((e) => e.payload.sessionId),
  ).toEqual(["one", "two", "three"]);
});
it("R4-15: repeated shutdown cannot conceal a missed earlier RUNNING summary with a later STOPPED summary", async () => {
  const f = await setup();
  const controller = await admit(f);
  f.setAfterVerify(() => failReader(f));
  await expect(f.service.command(f.spec.sessionId, (c) => c.stepEvent())).rejects.toThrow(
    "TRANSIENT_CONFIGURATION_READ",
  );
  const checkpoint = controller.currentCheckpoint()!,
    calls = f.calls.length;
  for (let i = 0; i < 3; i++)
    await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  expect(f.calls).toHaveLength(calls);
  expect(controller.currentCheckpoint()).toEqual(checkpoint);
  expect(f.observed).toHaveLength(1);
  await f.service.retryControlEvents();
  summary(f.observed[1]!, checkpoint);
  await f.service.shutdown();
  expect(f.observed.map((e) => e.payload.state)).toEqual(["READY", "RUNNING", "STOPPED"]);
  await f.service.shutdown();
});
it("R4-16: honest actual UNKNOWN_COMMITMENT remains a storage obligation, not a pending control summary", async () => {
  const f = await setup();
  let fail = false;
  const port: ReplayCheckpointRepository = {
    ...f.port,
    commit: (checkpoint) => {
      const result = f.port.commit(checkpoint);
      return fail && result.ok
        ? {
            ok: false,
            code: "REPORT_UNKNOWN",
            commitment: "UNKNOWN_COMMITMENT",
            operationId: result.value.operationId,
          }
        : result;
    },
  };
  const controller = await admit(f, f.spec.sessionId, port),
    prior = controller.currentCheckpoint();
  fail = true;
  expect((await f.service.command(f.spec.sessionId, (c) => c.stepEvent())).ok).toBe(false);
  expect(controller.currentCheckpoint()).toEqual(prior);
  expect(controller.diagnostics().obligation?.commitment).toBe("UNKNOWN_COMMITMENT");
  expect(f.service.diagnostics().pendingControlEvents).toBe(0);
  await f.service.retryControlEvents();
  expect(controller.diagnostics().obligation?.commitment).toBe("UNKNOWN_COMMITMENT");
  await unavailable(f);
  for (let i = 0; i < 2; i++)
    await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  const fresh = await setup();
  const recoveredOwner = await fresh.service.admit(raw(f.spec), f.inputs, f.repository);
  expect(recoveredOwner.currentCheckpoint()?.cursor).toBe(1);
  expect(recoveredOwner.diagnostics().obligation).toBeNull();
  await unavailable(f);
  await available(fresh);
});
it("R4-17: provably pre-repository source rejection fabricates no control-publication obligation", async () => {
  const f = await setup();
  writeFileSync(f.source, "changed");
  await expect(admit(f)).rejects.toThrow("INITIALIZATION_FAILED");
  expect(f.service.diagnostics()).toMatchObject({
    sessions: 0,
    pendingControlEvents: 0,
    controlPublications: [],
    busy: false,
  });
  expect(f.calls).toEqual([]);
  expect(files(f.path)).toEqual({});
  await available(f);
  writeFileSync(f.source, f.content);
  await admit(f);
  await f.service.shutdown();
  await f.service.shutdown();
});
it("R4-18: readiness follows failure, held retry, genuine discharge and stopped lifecycle", async () => {
  const f = await setup();
  f.setAfterVerify(() => failReader(f));
  await expect(admit(f)).rejects.toThrow("TRANSIENT_CONFIGURATION_READ");
  await unavailable(f);
  const original = f.bus.publish.bind(f.bus);
  let release!: () => void, enter!: () => void;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    seen = new Promise<void>((resolve) => {
      enter = resolve;
    });
  vi.spyOn(f.bus, "publish").mockImplementationOnce(async (event) => {
    enter();
    await gate;
    return original(event);
  });
  const retry = f.service.retryControlEvents();
  await seen;
  expect(f.service.diagnostics()).toMatchObject({ busy: true, pendingControlEvents: 1 });
  await unavailable(f);
  release();
  await retry;
  await available(f);
  await f.service.shutdown();
  await unavailable(f);
});
it("R4-19: closed R3 source finalization still precedes hostile diagnostics with checkpoint preservation", async () => {
  const f = await setup();
  const controller = await admit(f),
    checkpoint = controller.currentCheckpoint(),
    before = files(f.path);
  let state: string | undefined;
  f.setSourceRejection(
    Object.defineProperty(Error(), "message", {
      get: () => {
        state = controller.diagnostics().state;
        throw Error("HOSTILE_DIAGNOSTIC");
      },
    }),
  );
  writeFileSync(f.source, "changed");
  expect(await f.service.command(f.spec.sessionId, (c) => c.stepEvent())).toMatchObject({
    ok: false,
    code: "REPLAY_BOUNDARY_FAILED",
    state: "FAILED",
  });
  expect(state).toBe("FAILED");
  expect(controller.currentCheckpoint()).toEqual(checkpoint);
  expect(files(f.path)).toEqual(before);
  expect(f.service.diagnostics().pendingControlEvents).toBe(0);
  await unavailable(f);
});
it("R4-20: retained failure is attributed to the exact session and gates unrelated new runtime commands", async () => {
  const f = await setup();
  const first = await admit(f, "one"),
    second = await admit(f, "two");
  const secondBefore = second.currentCheckpoint();
  f.setAfterVerify(() => failReader(f));
  await expect(f.service.command("one", (c) => c.stepEvent())).rejects.toThrow(
    "TRANSIENT_CONFIGURATION_READ",
  );
  expect(f.service.diagnostics().controlPublications[0]?.sessionId).toBe("one");
  expect(second.currentCheckpoint()).toEqual(secondBefore);
  await expect(f.service.command("two", (c) => c.stepEvent())).rejects.toThrow(
    "CONTROL_PUBLICATION_REQUIRED",
  );
  await unavailable(f);
  await f.service.retryControlEvents();
  summary(f.observed.at(-1)!, first.currentCheckpoint()!);
  expect((await f.service.command("two", (c) => c.stepEvent())).ok).toBe(true);
  summary(f.observed.at(-1)!, second.currentCheckpoint()!);
  await available(f);
});
it("invalid actual governed configuration retains the summary until original configuration is restored", async () => {
  const f = await setup(),
    disabled = await governedFixture(false);
  f.setAfterVerify(() => f.setEffective(disabled.configuration));
  await expect(admit(f)).rejects.toThrow("REPLAY_DISABLED");
  const checkpoint = recovered(f);
  expect(f.service.diagnostics().pendingControlEvents).toBe(1);
  await unavailable(f);
  await expect(f.service.retryControlEvents()).rejects.toThrow("REPLAY_DISABLED");
  f.setEffective(f.configuration);
  await f.service.retryControlEvents();
  summary(f.observed[0]!, checkpoint);
  await available(f);
});
it("acknowledgement followed by queued shutdown before admission continuation retains a PENDING summary", async () => {
  const f = await setup();
  let shutdown: Promise<unknown> | undefined;
  f.setAfterPublication(() =>
    queueMicrotask(() => {
      shutdown = f.service.shutdown().catch((error: unknown) => error);
    }),
  );
  await expect(admit(f)).rejects.toThrow("SHUTDOWN_DURING_ADMISSION");
  expect(await shutdown).toBeInstanceOf(Error);
  expect(f.service.diagnostics().controlPublications[0]?.phase).toBe("PENDING");
  const checkpoint = recovered(f),
    before = files(f.path);
  await unavailable(f);
  await f.service.retryControlEvents();
  summary(f.observed[0]!, checkpoint);
  expect(files(f.path)).toEqual(before);
  await f.service.shutdown();
  await f.service.shutdown();
});
for (const action of ["command", "admission", "shutdown"] as const)
  it(`pre-acknowledgement reader reentrancy ${action} cannot bypass the admission/command lock`, async () => {
    const f = await setup(),
      controller = await admit(f),
      checkpoint = controller.currentCheckpoint();
    let nested: Promise<unknown> | undefined;
    let inside: ReturnType<ReplayRuntimeService["diagnostics"]> | undefined;
    f.setReader(() => {
      inside = f.service.diagnostics();
      if (action === "command")
        nested = f.service
          .command(f.spec.sessionId, (c) => c.stepEvent())
          .catch((error: unknown) => error);
      if (action === "admission") nested = admit(f, "nested").catch((error: unknown) => error);
      if (action === "shutdown") nested = f.service.shutdown().catch((error: unknown) => error);
      throw Error("PREFLIGHT_READER_FAILURE");
    });
    await expect(f.service.command(f.spec.sessionId, (c) => c.stepEvent())).rejects.toThrow(
      "PREFLIGHT_READER_FAILURE",
    );
    expect(await nested).toBeInstanceOf(Error);
    expect(inside).toMatchObject({ busy: true, pendingControlEvents: 0, sessions: 1 });
    expect(controller.currentCheckpoint()).toEqual(checkpoint);
    expect(f.service.diagnostics()).toMatchObject({
      busy: false,
      pendingControlEvents: 0,
      sessions: 1,
    });
    await f.service.shutdown();
  });
it("pre-admission configuration reader failure leaves no provisional or publication obligation", async () => {
  const f = await setup();
  failReader(f);
  await expect(admit(f)).rejects.toThrow("TRANSIENT_CONFIGURATION_READ");
  expect(f.service.diagnostics()).toMatchObject({
    sessions: 0,
    pendingControlEvents: 0,
    busy: false,
  });
  expect(f.calls).toEqual([]);
  expect(files(f.path)).toEqual({});
  await available(f);
  await admit(f);
  await f.service.shutdown();
  await f.service.shutdown();
});
it("publication result inspection failure after actual delivery retains ambiguity and original identity", async () => {
  const f = await setup(),
    controller = await admit(f),
    original = f.bus.publish.bind(f.bus);
  vi.spyOn(f.bus, "publish").mockImplementationOnce(async (event) => {
    const result = { ...(await original(event)) };
    Object.defineProperty(result, "status", {
      get: () => {
        throw Error("RESULT_REPORT_FAILURE");
      },
    });
    return result;
  });
  await expect(f.service.command(f.spec.sessionId, (c) => c.stepEvent())).rejects.toThrow(
    "RESULT_REPORT_FAILURE",
  );
  const checkpoint = controller.currentCheckpoint()!,
    before = files(f.path);
  expect(f.service.diagnostics().controlPublications[0]).toMatchObject({
    phase: "UNCERTAIN",
    uncertain: true,
    checkpointId: checkpoint.checkpointId,
  });
  summary(f.observed.at(-1)!, checkpoint);
  vi.restoreAllMocks();
  await f.service.retryControlEvents();
  expect(f.observed.filter((e) => e.payload.checkpointId === checkpoint.checkpointId)).toHaveLength(
    1,
  );
  expect(f.service.diagnostics().pendingControlEvents).toBe(0);
  expect(files(f.path)).toEqual(before);
});
it("runtime callback shutdown cancels an idle owner without an extra checkpoint or publication", async () => {
  const f = await setup(),
    controller = await admit(f);
  const checkpoint = controller.currentCheckpoint(),
    before = files(f.path),
    calls = f.calls.length;
  const result = await f.service.command(f.spec.sessionId, async (owner) => {
    await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
    return owner.stepEvent();
  });
  expect(result).toMatchObject({ ok: false, code: "INVALID_LIFECYCLE", state: "STOPPING" });
  expect(controller.currentCheckpoint()).toEqual(checkpoint);
  expect(files(f.path)).toEqual(before);
  expect(f.calls).toHaveLength(calls);
  expect(f.service.diagnostics().pendingControlEvents).toBe(0);
  await unavailable(f);
  await f.service.shutdown();
  await f.service.shutdown();
  expect(controller.currentCheckpoint()?.cursor).toBe(checkpoint?.cursor);
});
it("actual repository prewrite refusal supplies its own noncommitment certificate and no control obligation", async () => {
  const f = await setup();
  // A deliberately stricter local fault store rejects before write; governed limits stay unchanged.
  const path = join(f.root, "rejecting-checkpoints");
  const repository = new FilesystemReplayCheckpointRepository(path, f.clock, {
    ...f.spec.resourceLimits,
    maxCheckpointBytes: 1,
  });
  let result: ReturnType<ReplayCheckpointRepository["commit"]> | undefined;
  let publications = 0;
  const port: ReplayCheckpointRepository = {
    recover: (specification) => repository.recover(specification),
    commit: (checkpoint) => {
      result = repository.commit(checkpoint);
      return result;
    },
    publish: (id) => {
      publications++;
      return repository.publish(id);
    },
  };
  await expect(admit(f, f.spec.sessionId, port)).rejects.toThrow("COMMIT_FAILED");
  expect(result).toMatchObject({ ok: false, commitment: "CONFIRMED_NOT_COMMITTED" });
  expect(publications).toBe(0);
  expect(f.service.diagnostics()).toMatchObject({ pendingControlEvents: 0, busy: false });
  expect(f.service.diagnostics().sessionStates[0]).toMatchObject({
    checkpointId: null,
    obligation: null,
  });
  expect(files(path)).toEqual({});
  await unavailable(f);
});
for (const outcome of ["throw", "unsuccessful"] as const)
  it(`runtime callback ${outcome} after actual acknowledgement retains the last owner checkpoint`, async () => {
    const f = await setup(),
      controller = await admit(f);
    const operation = f.service.command(f.spec.sessionId, async (owner) => {
      const result = await owner.stepEvent();
      expect(result.ok).toBe(true);
      if (outcome === "throw") throw Error("CALLER_AFTER_ACKNOWLEDGEMENT");
      return { ok: false, code: "CALLER_AFTER_ACKNOWLEDGEMENT", state: owner.diagnostics().state };
    });
    if (outcome === "throw")
      await expect(operation).rejects.toThrow("CALLER_AFTER_ACKNOWLEDGEMENT");
    else expect(await operation).toMatchObject({ ok: false, code: "CALLER_AFTER_ACKNOWLEDGEMENT" });
    const checkpoint = controller.currentCheckpoint()!,
      before = files(f.path);
    expect(f.service.diagnostics().controlPublications[0]).toMatchObject({
      checkpointId: checkpoint.checkpointId,
      phase: "PENDING",
    });
    await unavailable(f);
    await f.service.retryControlEvents();
    summary(f.observed.at(-1)!, checkpoint);
    expect(files(f.path)).toEqual(before);
    await available(f);
  });
it("pending publication preserves governed identity conflict and excludes a different admission", async () => {
  const f = await setup();
  await f.bus.stop();
  await expect(admit(f)).rejects.toThrow("REPLAY_CONTROL_PUBLICATION_FAILED");
  const checkpoint = recovered(f),
    before = files(f.path);
  await expect(admit(f)).rejects.toThrow("SESSION_IDENTITY_CONFLICT");
  await expect(admit(f, "different")).rejects.toThrow("CONTROL_PUBLICATION_REQUIRED");
  expect(f.service.diagnostics()).toMatchObject({
    sessions: 1,
    pendingControlEvents: 1,
    busy: false,
  });
  expect(f.service.diagnostics().controlPublications[0]?.checkpointId).toBe(
    checkpoint.checkpointId,
  );
  expect(files(f.path)).toEqual(before);
  f.bus.start();
  await f.service.retryControlEvents();
  await f.service.shutdown();
});
