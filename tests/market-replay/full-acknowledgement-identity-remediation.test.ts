import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { defaultDeliveryPolicy, subscriptionId } from "@ate/events";
import type { ATEEvent } from "@ate/events";
import { canonicalRevisionId, hash } from "@ate/multitimeframe";
import {
  buildReplayResearchRuntime,
  FilesystemReplayCheckpointRepository,
  immutableReplayInputs,
  replayOperationId,
  ReplayRuntimeService,
} from "@ate/market-replay";
import type {
  ReplayCheckpoint,
  ReplayCommandResult,
  ReplaySessionSpecification,
} from "@ate/market-replay";
import type { LifecycleContext, RuntimeInstanceId } from "@ate/runtime";
import { governedFixture } from "./integration-fixtures.js";
import { t } from "./fixtures.js";
const roots: string[] = [];
const context: LifecycleContext = {
  runtimeInstanceId: "40000000-0000-4000-8000-000000000112" as RuntimeInstanceId,
  runtimeMode: "RESEARCH",
  signal: new AbortController().signal,
  now: () => t("13:00:00"),
};
type Payload = Pick<
  ReplayCheckpoint,
  "sessionId" | "checkpointId" | "state" | "logicalTime" | "cursor"
> & { researchOnly: true };
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function raw(spec: ReplaySessionSpecification) {
  const { fingerprint: _fp, ...value } = spec;
  return value;
}
function files(path: string) {
  return Object.fromEntries(
    readdirSync(path)
      .sort()
      .map((name) => [name, hash(readFileSync(join(path, name), "utf8"))]),
  );
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { release, promise };
}
async function setup(limit = 1) {
  const f = await governedFixture(true, {
    "research.replay.maxEvidenceRecords": limit,
    "research.replay.maxSessions": 4,
  });
  let effective = f.configuration,
    reader: (() => void) | undefined,
    verifier: (() => Promise<void> | void) | undefined;
  const service = new ReplayRuntimeService({
    clock: f.clock,
    configuration: () => {
      reader?.();
      return effective;
    },
    authority: f.authority,
    eventRegistry: f.eventRegistry,
    eventFactory: f.eventFactory,
    eventBus: f.bus,
  });
  const built = buildReplayResearchRuntime(service, {
    runtimeInstanceId: context.runtimeInstanceId,
    runtimeVersion: "0.19.0-market-replay.1",
    mode: "RESEARCH",
    clock: f.clock,
  });
  if (!built.ok) throw Error("COMPOSITION_FAILED");
  expect((await built.runtime.start()).ok).toBe(true);
  const observed: ATEEvent<Payload>[] = [];
  expect(
    f.bus.register<Payload>({
      subscriptionId: subscriptionId("data.replay.ack-regression"),
      subscriberId: "004L-regression",
      description: "Original acknowledged-generation control observations",
      eventTypes: ["data.replay.control.v1"],
      criticality: "OPTIONAL",
      policy: defaultDeliveryPolicy,
      handler: ({ event }) => {
        observed.push(event);
        return { status: "SUCCESS" };
      },
    }).ok,
  ).toBe(true);
  const root = mkdtempSync(join(tmpdir(), "ate-004l-"));
  roots.push(root);
  const path = join(root, "checkpoints"),
    source = join(root, "source.json"),
    content = JSON.stringify(f.inputs.manifests);
  writeFileSync(source, content);
  const inputs = immutableReplayInputs(f.inputs.manifests, async () => {
    if (readFileSync(source, "utf8") !== content) throw Error("SOURCE_CHANGED");
    await verifier?.();
  });
  const repository = new FilesystemReplayCheckpointRepository(path, f.clock, f.spec.resourceLimits),
    calls: string[] = [];
  const port = {
    recover: (spec: ReplaySessionSpecification) => {
      calls.push("recover");
      return repository.recover(spec);
    },
    commit: (cp: ReplayCheckpoint) => {
      calls.push("commit:" + replayOperationId(cp));
      return repository.commit(cp);
    },
    publish: (id: string) => {
      calls.push("publish:" + id);
      return repository.publish(id);
    },
  };
  return {
    ...f,
    service,
    runtime: built.runtime,
    observed,
    path,
    source,
    content,
    inputs,
    repository,
    port,
    calls,
    setReader: (v?: () => void) => {
      reader = v;
    },
    setVerifier: (v?: () => Promise<void> | void) => {
      verifier = v;
    },
    setEffective: (v: typeof effective) => {
      effective = v;
    },
  };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function admit(f: Fixture, sessionId = f.spec.sessionId) {
  return f.service.admit({ ...raw(f.spec), sessionId }, f.inputs, f.port);
}
function cp(owner: Awaited<ReturnType<typeof admit>>) {
  const value = owner.currentCheckpoint();
  if (!value) throw Error("ACTUAL_ACK_REQUIRED");
  return value;
}
function recovered(f: Fixture) {
  const r = f.repository.recover(f.spec);
  if (!r.ok || !r.value) throw Error("DURABLE_RECOVERY_REQUIRED");
  return r.value.checkpoint;
}
function identity(c: ReplayCheckpoint) {
  return canonicalRevisionId(
    hash({ session: c.sessionId, generation: c.generation, fingerprint: c.fingerprint }),
  );
}
function exact(event: ATEEvent<Payload>, c: ReplayCheckpoint) {
  expect(event.payload).toEqual({
    sessionId: c.sessionId,
    checkpointId: c.checkpointId,
    state: c.state,
    logicalTime: c.logicalTime,
    cursor: c.cursor,
    researchOnly: true,
  });
  expect(event.envelope.eventId).toBe(identity(c));
  expect(event.envelope.runtimeMode).toBe("RESEARCH");
}
async function unavailable(f: Fixture) {
  expect((await f.service.managedService.checkReadiness!(context)).status).toBe("NOT_READY");
  expect((await f.service.managedService.checkHealth!(context)).status).toBe("DEGRADED");
}
async function available(f: Fixture) {
  expect((await f.service.managedService.checkReadiness!(context)).status).toBe("READY");
  expect((await f.service.managedService.checkHealth!(context)).status).toBe("HEALTHY");
}
function pending(f: Fixture, c: ReplayCheckpoint) {
  expect(f.service.diagnostics().controlPublications).toEqual([
    {
      sessionId: c.sessionId,
      checkpointId: c.checkpointId,
      generation: c.generation,
      configurationFingerprint: f.spec.configurationFingerprint,
      phase: "PENDING",
      uncertain: false,
    },
  ]);
}
for (const action of ["pause", "resume", "stop"] as const)
  for (const failure of ["throw", "unsuccessful"] as const)
    it(`${action}/${failure}: retain real same-semantic-ID ACK before releasing callback lock`, async () => {
      const f = await setup(),
        owner = await admit(f);
      if (action === "resume")
        expect((await f.service.command(f.spec.sessionId, (c) => c.pause())).ok).toBe(true);
      const before = cp(owner),
        observed = f.observed.length,
        error = Error("CONFIRMED_NOT_COMMITTED");
      const operation = f.service.command(f.spec.sessionId, async (c) => {
        expect((await c[action]()).ok).toBe(true);
        if (failure === "throw") throw error;
        return { ok: false, code: "CONFIRMED_NOT_COMMITTED", state: c.diagnostics().state };
      });
      if (failure === "throw") await expect(operation).rejects.toBe(error);
      else expect(await operation).toMatchObject({ ok: false, code: "CONFIRMED_NOT_COMMITTED" });
      const after = cp(owner),
        disk = files(f.path),
        calls = f.calls.length;
      expect(after.checkpointId).toBe(before.checkpointId);
      expect(after.generation).toBe(before.generation + 1);
      expect(after.fingerprint).not.toBe(before.fingerprint);
      expect(replayOperationId(after)).not.toBe(replayOperationId(before));
      expect(recovered(f)).toEqual(after);
      pending(f, after);
      expect(f.observed).toHaveLength(observed);
      await unavailable(f);
      for (let n = 0; n < 2; n++)
        await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
      expect(cp(owner)).toEqual(after);
      expect(files(f.path)).toEqual(disk);
      expect(f.calls).toHaveLength(calls);
      await f.service.retryControlEvents();
      exact(f.observed.at(-1)!, after);
      expect(f.observed).toHaveLength(observed + 1);
      expect(files(f.path)).toEqual(disk);
      expect(f.calls).toHaveLength(calls);
      await unavailable(f);
      await f.service.shutdown();
      const stoppedCalls = f.calls.length,
        events = f.observed.length;
      await f.service.shutdown();
      expect(f.calls).toHaveLength(stoppedCalls);
      expect(f.observed).toHaveLength(events);
    });
for (const failure of ["throw", "unsuccessful"] as const)
  it(`no ACK/${failure}: callback failure does not fabricate state, storage or publication`, async () => {
    const f = await setup(),
      c = await admit(f),
      before = cp(c),
      disk = files(f.path),
      calls = f.calls.length,
      events = f.observed.length;
    const command = f.service.command(f.spec.sessionId, async () => {
      await Promise.resolve();
      if (failure === "throw") throw Error("NOT_STARTED");
      return { ok: false, code: "NOT_STARTED", state: "READY" };
    });
    if (failure === "throw") await expect(command).rejects.toThrow("NOT_STARTED");
    else expect((await command).ok).toBe(false);
    expect(cp(c)).toEqual(before);
    expect(files(f.path)).toEqual(disk);
    expect(f.calls).toHaveLength(calls);
    expect(f.observed).toHaveLength(events);
    expect(f.service.diagnostics().pendingControlEvents).toBe(0);
    await available(f);
  });
it("pre-repository source rejection creates neither acknowledgement nor control summary", async () => {
  const f = await setup();
  writeFileSync(f.source, "changed");
  await expect(admit(f)).rejects.toThrow("INITIALIZATION_FAILED");
  expect(f.calls).toEqual([]);
  expect(files(f.path)).toEqual({});
  expect(f.service.diagnostics()).toMatchObject({
    busy: false,
    sessions: 0,
    pendingControlEvents: 0,
  });
  await available(f);
  writeFileSync(f.source, f.content);
  await admit(f);
  await f.service.shutdown();
});
it("post-admission source rejection preserves the last ACK without inventing a new publication", async () => {
  const f = await setup(),
    c = await admit(f),
    before = cp(c),
    disk = files(f.path),
    calls = f.calls.length;
  writeFileSync(f.source, "changed");
  expect(await f.service.command(f.spec.sessionId, (x) => x.pause())).toMatchObject({
    ok: false,
    code: "SOURCE_VERIFICATION_FAILED",
  });
  expect(cp(c)).toEqual(before);
  expect(files(f.path)).toEqual(disk);
  expect(f.calls).toHaveLength(calls);
  expect(f.service.diagnostics().pendingControlEvents).toBe(0);
  await unavailable(f);
});
it("honest UNKNOWN on a same-ID control generation remains storage uncertainty, not an ACK", async () => {
  const f = await setup(),
    c = await admit(f),
    before = cp(c),
    original = f.repository.commit.bind(f.repository);
  let unknown = true;
  vi.spyOn(f.repository, "commit").mockImplementation((checkpoint) => {
    const r = original(checkpoint);
    return unknown && r.ok
      ? {
          ok: false,
          code: "CONTROL_PUBLICATION_REQUIRED",
          commitment: "UNKNOWN_COMMITMENT",
          operationId: r.value.operationId,
        }
      : r;
  });
  expect((await f.service.command(f.spec.sessionId, (x) => x.pause())).ok).toBe(false);
  expect(cp(c)).toEqual(before);
  expect(c.diagnostics().obligation?.commitment).toBe("UNKNOWN_COMMITMENT");
  expect(f.service.diagnostics().pendingControlEvents).toBe(0);
  await f.service.retryControlEvents();
  expect(c.diagnostics().obligation?.commitment).toBe("UNKNOWN_COMMITMENT");
  await unavailable(f);
  await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  unknown = false;
  const fresh = await setup(),
    owner = await fresh.service.admit(raw(f.spec), f.inputs, f.repository);
  expect(cp(owner)).toMatchObject({
    generation: before.generation + 1,
    checkpointId: before.checkpointId,
    state: "PAUSED",
  });
  expect(owner.diagnostics().obligation).toBeNull();
  exact(fresh.observed[0]!, cp(owner));
  await fresh.service.shutdown();
});
it("same ACK reobservation after a no-op STOPPED callback does not create another descriptor", async () => {
  const f = await setup(),
    c = await admit(f);
  expect((await f.service.command(f.spec.sessionId, (x) => x.stop())).ok).toBe(true);
  const stopped = cp(c),
    calls = f.calls.length,
    events = f.observed.length;
  for (let n = 0; n < 3; n++)
    await expect(
      f.service.command(f.spec.sessionId, async (x) => {
        expect((await x.stop()).ok).toBe(true);
        throw Error("SAME_ACK");
      }),
    ).rejects.toThrow("SAME_ACK");
  expect(cp(c)).toEqual(stopped);
  expect(f.calls).toHaveLength(calls);
  expect(f.observed).toHaveLength(events);
  expect(f.service.diagnostics().pendingControlEvents).toBe(0);
  await available(f);
});
it("capacity one fences the next same-ID generation and other owners until exact discharge", async () => {
  const f = await setup(),
    a = await admit(f),
    b = await admit(f, "second");
  await expect(
    f.service.command(f.spec.sessionId, async (c) => {
      await c.pause();
      throw Error("AFTER_PAUSE");
    }),
  ).rejects.toThrow("AFTER_PAUSE");
  const after = cp(a),
    other = cp(b),
    calls = f.calls.length;
  pending(f, after);
  await expect(f.service.command(f.spec.sessionId, (c) => c.resume())).rejects.toThrow(
    "CONTROL_PUBLICATION_REQUIRED",
  );
  await expect(f.service.command("second", (c) => c.pause())).rejects.toThrow(
    "CONTROL_PUBLICATION_REQUIRED",
  );
  await expect(admit(f, "third")).rejects.toThrow("CONTROL_PUBLICATION_REQUIRED");
  expect(cp(b)).toEqual(other);
  expect(f.calls).toHaveLength(calls);
  await unavailable(f);
  await f.service.retryControlEvents();
  expect(f.service.diagnostics().pendingControlEvents).toBe(0);
  expect((await f.service.command(f.spec.sessionId, (c) => c.resume())).ok).toBe(true);
  expect(cp(a).checkpointId).toBe(after.checkpointId);
  exact(f.observed.at(-1)!, cp(a));
  await f.service.shutdown();
});
it("discovered ACK precedes repeated configuration failure without another diagnostic or hash callback", async () => {
  const f = await setup(),
    c = await admit(f);
  let reads = 0;
  await expect(
    f.service.command(f.spec.sessionId, async (owner) => {
      expect((await owner.pause()).ok).toBe(true);
      f.setReader(() => {
        reads++;
        throw Error("READER_FAILED");
      });
      throw Error("CALLBACK_FAILED");
    }),
  ).rejects.toThrow("CALLBACK_FAILED");
  const after = cp(c),
    disk = files(f.path);
  pending(f, after);
  expect(reads).toBe(0);
  await unavailable(f);
  expect(reads).toBe(0);
  for (let n = 0; n < 2; n++) {
    await expect(f.service.retryControlEvents()).rejects.toThrow("READER_FAILED");
    expect(f.service.diagnostics().controlPublications[0]).toMatchObject({
      generation: after.generation,
      phase: "FAILED",
    });
  }
  f.setReader();
  await f.service.retryControlEvents();
  exact(f.observed.at(-1)!, after);
  expect(files(f.path)).toEqual(disk);
  await available(f);
});
it("ambiguous state-only delivery caches the original envelope through failed preparation and duplicate retry", async () => {
  const f = await setup(),
    c = await admit(f);
  await expect(
    f.service.command(f.spec.sessionId, async (owner) => {
      await owner.pause();
      throw Error("AFTER_ACK");
    }),
  ).rejects.toThrow("AFTER_ACK");
  const after = cp(c),
    original = f.bus.publish.bind(f.bus);
  let envelope: ATEEvent | undefined;
  vi.spyOn(f.bus, "publish").mockImplementationOnce(async (event) => {
    envelope = event;
    await original(event);
    throw Error("REPORT_LOST");
  });
  await expect(f.service.retryControlEvents()).rejects.toThrow("REPORT_LOST");
  expect(f.service.diagnostics().controlPublications[0]).toMatchObject({
    generation: after.generation,
    phase: "UNCERTAIN",
    uncertain: true,
  });
  exact(f.observed.at(-1)!, after);
  const count = f.observed.length;
  f.setReader(() => {
    throw Error("LATER_READER");
  });
  await expect(f.service.retryControlEvents()).rejects.toThrow("LATER_READER");
  expect(f.service.diagnostics().controlPublications[0]?.uncertain).toBe(true);
  f.setReader();
  expect(f.clock.advanceTo(t("14:00:00")).ok).toBe(true);
  const publish = vi.spyOn(f.bus, "publish");
  publish.mockImplementationOnce(async (event) => {
    expect(event).toBe(envelope);
    return original(event);
  });
  await f.service.retryControlEvents();
  expect(f.observed).toHaveLength(count);
  expect(f.observed.at(-1)!.envelope.eventTimestamp).toBe(t("13:00:00"));
  await available(f);
});
it("four pause/resume cycles retain distinct ACK and event identities despite one semantic checkpoint ID", async () => {
  const f = await setup(),
    c = await admit(f),
    first = cp(c),
    acknowledgements = [first],
    events = [identity(first)];
  for (let n = 0; n < 4; n++)
    for (const action of ["pause", "resume"] as const) {
      await expect(
        f.service.command(f.spec.sessionId, async (owner) => {
          expect((await owner[action]()).ok).toBe(true);
          throw Error("AFTER_CONTROL");
        }),
      ).rejects.toThrow("AFTER_CONTROL");
      const current = cp(c);
      expect(current.checkpointId).toBe(first.checkpointId);
      pending(f, current);
      await unavailable(f);
      await f.service.retryControlEvents();
      exact(f.observed.at(-1)!, current);
      await available(f);
      acknowledgements.push(current);
      events.push(identity(current));
    }
  expect(acknowledgements.map((x) => x.generation)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  expect(new Set(acknowledgements.map(replayOperationId)).size).toBe(9);
  expect(new Set(events).size).toBe(9);
  expect(f.observed.map((x) => x.envelope.eventId)).toEqual(events);
  await f.service.shutdown();
});
for (const failure of ["throw", "unsuccessful"] as const)
  it(`cursor-changing ACK/${failure} preserves previously corrected callback behavior`, async () => {
    const f = await setup(),
      c = await admit(f),
      before = cp(c);
    const promise = f.service.command(f.spec.sessionId, async (owner) => {
      await owner.stepEvent();
      if (failure === "throw") throw Error("AFTER_STEP");
      return { ok: false, code: "AFTER_STEP", state: owner.diagnostics().state };
    });
    if (failure === "throw") await expect(promise).rejects.toThrow("AFTER_STEP");
    else expect((await promise).ok).toBe(false);
    const current = cp(c);
    expect(current.checkpointId).not.toBe(before.checkpointId);
    pending(f, current);
    await f.service.retryControlEvents();
    exact(f.observed.at(-1)!, current);
    await available(f);
  });
it("ACKed stop followed by concurrent shutdown and callback failure retains the original STOPPED summary", async () => {
  const f = await setup(),
    c = await admit(f),
    before = cp(c);
  await expect(
    f.service.command(f.spec.sessionId, async (owner) => {
      expect((await owner.stop()).ok).toBe(true);
      await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
      throw Error("AFTER_STOP_AND_SHUTDOWN");
    }),
  ).rejects.toThrow("AFTER_STOP_AND_SHUTDOWN");
  const stopped = cp(c);
  expect(stopped.generation).toBe(before.generation + 1);
  expect(stopped.checkpointId).toBe(before.checkpointId);
  pending(f, stopped);
  await unavailable(f);
  await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  const calls = f.calls.length;
  await f.service.retryControlEvents();
  exact(f.observed.at(-1)!, stopped);
  await unavailable(f);
  await f.service.shutdown();
  expect(f.calls).toHaveLength(calls);
  await f.service.shutdown();
});
it("prewrite cancellation does not invent a control ACK or clear an actual lifecycle fence", async () => {
  const f = await setup(),
    c = await admit(f),
    before = cp(c),
    disk = files(f.path),
    calls = f.calls.length,
    enter = gate(),
    hold = gate();
  f.setVerifier(async () => {
    enter.release();
    await hold.promise;
  });
  const operation = f.service.command(f.spec.sessionId, (owner) => owner.pause());
  await enter.promise;
  await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  hold.release();
  expect((await operation).ok).toBe(false);
  expect(cp(c)).toEqual(before);
  expect(files(f.path)).toEqual(disk);
  expect(f.calls).toHaveLength(calls);
  expect(f.service.diagnostics().pendingControlEvents).toBe(0);
  await unavailable(f);
  f.setVerifier();
  await f.service.shutdown();
});
for (const failure of [
  "null",
  "ok-getter",
  "checkpoint-getter",
  "non-error",
  "message-getter",
  "stale-observation",
] as const)
  it(`${failure}: abnormal callback outcome cannot erase its authoritative same-ID ACK`, async () => {
    const f = await setup(),
      c = await admit(f),
      previous = cp(c);
    let messageReads = 0;
    const hostile = Object.defineProperty(Error(), "message", {
      get() {
        messageReads++;
        throw Error("HOSTILE_MESSAGE");
      },
    });
    const nonErrorRejection = vi
      .fn<() => Promise<ReplayCommandResult>>()
      .mockRejectedValue("NON_ERROR");
    const operation = f.service.command(f.spec.sessionId, async (owner) => {
      expect((await owner.pause()).ok).toBe(true);
      if (failure === "null") return null as unknown as ReplayCommandResult;
      if (failure === "ok-getter")
        return {
          get ok() {
            throw Error("RESULT_OK");
          },
        } as unknown as ReplayCommandResult;
      if (failure === "checkpoint-getter")
        return {
          ok: true,
          get checkpoint(): ReplayCheckpoint {
            throw Error("RESULT_CP");
          },
        };
      if (failure === "non-error") return nonErrorRejection();
      if (failure === "message-getter") return Promise.reject<ReplayCommandResult>(hostile);
      expect(previous.generation).toBe(1);
      return { ok: false, code: "STALE_OBSERVATION", state: previous.state };
    });
    if (failure === "stale-observation") expect((await operation).ok).toBe(false);
    else if (failure === "message-getter") await expect(operation).rejects.toBe(hostile);
    else if (failure === "non-error") await expect(operation).rejects.toBe("NON_ERROR");
    else await expect(operation).rejects.toThrow();
    const current = cp(c);
    pending(f, current);
    expect(messageReads).toBe(0);
    expect(current.generation).toBe(2);
    expect(recovered(f)).toEqual(current);
    await unavailable(f);
    await f.service.retryControlEvents();
    exact(f.observed.at(-1)!, current);
    await available(f);
  });
it("current governance drift blocks retry after discovery without replacing full ACK identity", async () => {
  const f = await setup(),
    c = await admit(f);
  await expect(
    f.service.command(f.spec.sessionId, async (owner) => {
      await owner.pause();
      throw Error("AFTER_ACK");
    }),
  ).rejects.toThrow("AFTER_ACK");
  const current = cp(c),
    disk = files(f.path),
    changed = await governedFixture(true, {
      "research.replay.maxEvidenceRecords": 1,
      "research.replay.maxSessions": 3,
    });
  f.setEffective(changed.configuration);
  await expect(f.service.retryControlEvents()).rejects.toThrow("GOVERNED_CONFIGURATION_MISMATCH");
  expect(f.service.diagnostics().controlPublications[0]).toMatchObject({
    checkpointId: current.checkpointId,
    generation: current.generation,
    configurationFingerprint: f.spec.configurationFingerprint,
  });
  expect(files(f.path)).toEqual(disk);
  f.setEffective(f.configuration);
  await f.service.retryControlEvents();
  exact(f.observed.at(-1)!, current);
  await available(f);
});
it("reentrant retry/command during preparation cannot acknowledge the next same-ID generation", async () => {
  const f = await setup(),
    c = await admit(f);
  await expect(
    f.service.command(f.spec.sessionId, async (owner) => {
      await owner.pause();
      throw Error("AFTER_ACK");
    }),
  ).rejects.toThrow("AFTER_ACK");
  const current = cp(c);
  let nested: Promise<unknown[]> | undefined;
  let inside: ReturnType<ReplayRuntimeService["diagnostics"]> | undefined;
  f.setReader(() => {
    f.setReader();
    inside = f.service.diagnostics();
    nested = Promise.all([
      f.service
        .command(f.spec.sessionId, (owner) => owner.resume())
        .catch((error: unknown) => error),
      f.service.retryControlEvents().catch((error: unknown) => error),
      Promise.resolve(f.service.managedService.checkReadiness!(context)),
    ]);
  });
  await f.service.retryControlEvents();
  const values = await nested;
  expect(values?.[0]).toBeInstanceOf(Error);
  expect(values?.[1]).toBeInstanceOf(Error);
  expect(values?.[2]).toMatchObject({ status: "NOT_READY" });
  expect(inside).toMatchObject({ busy: true, pendingControlEvents: 1 });
  expect(cp(c)).toEqual(current);
  exact(f.observed.at(-1)!, current);
  expect(f.service.diagnostics().pendingControlEvents).toBe(0);
  await available(f);
});
it("success-path preparation failure followed by exception discovery reuses one full ACK descriptor", async () => {
  const f = await setup(),
    c = await admit(f);
  vi.spyOn(f.eventFactory, "createRootEvent").mockImplementationOnce(() => {
    throw Error("FACTORY_THROW");
  });
  await expect(f.service.command(f.spec.sessionId, (owner) => owner.pause())).rejects.toThrow(
    "FACTORY_THROW",
  );
  const current = cp(c);
  expect(f.service.diagnostics().controlPublications).toHaveLength(1);
  expect(f.service.diagnostics().controlPublications[0]).toMatchObject({
    generation: current.generation,
    phase: "FAILED",
  });
  await f.service.retryControlEvents();
  exact(f.observed.at(-1)!, current);
  expect(f.observed).toHaveLength(2);
  await available(f);
});
