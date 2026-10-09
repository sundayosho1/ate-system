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
  createReplaySpecification,
  ReplayRuntimeService,
} from "@ate/market-replay";
import type {
  ReplayCheckpoint,
  ReplayCommandResult,
  ReplaySessionSpecification,
  ReplayTaskDescriptor,
} from "@ate/market-replay";
import { ConsumerChannel } from "@ate/realtime-data";
import type { LifecycleContext, RuntimeInstanceId } from "@ate/runtime";
import { governedFixture } from "./integration-fixtures.js";
import { t, stream } from "./fixtures.js";
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
async function setup(limit = 1, tasks: readonly ReplayTaskDescriptor[] = []) {
  const base = await governedFixture(true, {
    "research.replay.maxEvidenceRecords": limit,
    "research.replay.maxSessions": 4,
  });
  const f = { ...base, spec: createReplaySpecification({ ...raw(base.spec), tasks }) };
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
      subscriberId: "004N-regression",
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
  const root = mkdtempSync(join(tmpdir(), "ate-004n-"));
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
  for (const report of [
    "matching",
    "stale",
    "failure",
    "throw",
    "missing",
    "malformed",
    "ok-getter",
  ] as const)
    it(`${action}/${report}: actual filesystem ACK owns result and control summary`, async () => {
      const f = await setup(),
        c = await admit(f);
      if (action === "resume")
        expect((await f.service.command(f.spec.sessionId, (x) => x.pause())).ok).toBe(true);
      const before = cp(c),
        count = f.observed.length;
      const operation = f.service.command(f.spec.sessionId, async (owner) => {
        const actual = await owner[action]();
        expect(actual.ok).toBe(true);
        if (report === "matching") return actual;
        if (report === "stale") return { ok: true, checkpoint: before };
        if (report === "failure") return { ok: false, code: "REPORT_FAILURE", state: before.state };
        if (report === "throw") throw Error("REPORT_FAILURE");
        if (report === "missing") return { ok: true } as ReplayCommandResult;
        if (report === "malformed") return { ok: true, checkpoint: {} } as ReplayCommandResult;
        return {
          get ok(): true {
            throw Error("RESULT_GETTER");
          },
        } as ReplayCommandResult;
      });
      if (report === "matching" || report === "stale")
        expect(await operation).toEqual({ ok: true, checkpoint: cp(c) });
      else if (report === "failure")
        expect(await operation).toMatchObject({ ok: false, code: "REPORT_FAILURE" });
      else await expect(operation).rejects.toThrow();
      const actual = cp(c);
      expect(actual.generation).toBe(before.generation + 1);
      expect(actual.fingerprint).not.toBe(before.fingerprint);
      expect(actual.checkpointId).toBe(before.checkpointId);
      expect(replayOperationId(actual)).not.toBe(replayOperationId(before));
      expect(recovered(f)).toEqual(actual);
      if (report === "matching" || report === "stale") {
        expect(f.observed).toHaveLength(count + 1);
        expect(f.service.diagnostics().pendingControlEvents).toBe(0);
        await available(f);
      } else {
        pending(f, actual);
        await unavailable(f);
        expect(f.observed).toHaveLength(count);
        await expect(f.service.command(f.spec.sessionId, (x) => x.pause())).rejects.toThrow(
          "CONTROL_PUBLICATION_REQUIRED",
        );
        await f.service.retryControlEvents();
        await available(f);
      }
      exact(f.observed[count]!, actual);
      await f.service.shutdown();
      const finalFiles = files(f.path),
        calls = f.calls.length,
        delivered = f.observed.length;
      await f.service.shutdown();
      expect(files(f.path)).toEqual(finalFiles);
      expect(f.calls).toHaveLength(calls);
      expect(f.observed).toHaveLength(delivered);
    });
for (const action of ["pause", "resume", "stop"] as const)
  for (const fault of ["reader", "factory", "ambiguous"] as const)
    it(`${action}/stale/${fault}: retained actual ACK survives failed preparation and repeated shutdown`, async () => {
      const f = await setup(),
        c = await admit(f);
      if (action === "resume") await f.service.command(f.spec.sessionId, (x) => x.pause());
      const before = cp(c),
        publish = f.bus.publish.bind(f.bus);
      const attempted: ATEEvent[] = [];
      if (fault === "factory")
        vi.spyOn(f.eventFactory, "createRootEvent").mockImplementationOnce(() => {
          throw Error("FACTORY");
        });
      if (fault === "ambiguous")
        vi.spyOn(f.bus, "publish").mockImplementationOnce(async (event) => {
          attempted.push(event);
          await publish(event);
          throw Error("REPORT_LOST");
        });
      await expect(
        f.service.command(f.spec.sessionId, async (owner) => {
          expect((await owner[action]()).ok).toBe(true);
          if (fault === "reader")
            f.setReader(() => {
              throw Error("READER");
            });
          return { ok: true, checkpoint: before };
        }),
      ).rejects.toThrow();
      const actual = cp(c),
        durable = files(f.path),
        calls = f.calls.length;
      expect(recovered(f)).toEqual(actual);
      expect(f.service.diagnostics().controlPublications).toEqual([
        expect.objectContaining({
          generation: actual.generation,
          checkpointId: actual.checkpointId,
          phase: fault === "ambiguous" ? "UNCERTAIN" : "FAILED",
          uncertain: fault === "ambiguous",
        }),
      ]);
      await unavailable(f);
      for (let i = 0; i < 2; i++)
        await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
      expect(files(f.path)).toEqual(durable);
      expect(f.calls).toHaveLength(calls);
      f.setReader();
      await f.service.retryControlEvents();
      exact(f.observed.at(-1)!, actual);
      if (fault === "ambiguous") expect(f.observed.at(-1)).toEqual(attempted[0]);
      expect(f.service.diagnostics().pendingControlEvents).toBe(0);
      await unavailable(f); // STOPPING is not restored by publication retry.
      await f.service.shutdown();
      await f.service.shutdown();
    });
for (const action of ["event", "timestamp", "run", "reconstruct", "snapshot"] as const)
  for (const report of ["matching", "stale"] as const)
    it(`${action}/${report}: generic command uses owner ACK rather than callback evidence`, async () => {
      const f = await setup(16),
        c = await admit(f),
        before = cp(c);
      const result = await f.service.command(f.spec.sessionId, async (owner) => {
        const r =
          action === "event"
            ? await owner.stepEvent()
            : action === "timestamp"
              ? await owner.stepTimestamp()
              : action === "run"
                ? await owner.runToTime(t("10:01:00"))
                : action === "reconstruct"
                  ? await owner.reconstructToTime(t("10:01:00"))
                  : await owner.snapshot(hash(stream), ["M1"], true);
        expect(r.ok).toBe(true);
        return report === "matching" ? r : { ok: true, checkpoint: before };
      });
      const actual = cp(c);
      expect(actual.generation).toBeGreaterThan(before.generation);
      if (action !== "snapshot") expect(actual.cursor).toBeGreaterThan(before.cursor);
      expect(actual.checkpointId).not.toBe(before.checkpointId);
      expect(result).toEqual({ ok: true, checkpoint: actual });
      expect(recovered(f)).toEqual(actual);
      exact(f.observed.at(-1)!, actual);
      expect(f.service.diagnostics().pendingControlEvents).toBe(0);
      await available(f);
      await f.service.shutdown();
    });
it("unchanged no-op success performs no repository write or phantom publication", async () => {
  const f = await setup(),
    c = await admit(f),
    before = cp(c),
    disk = files(f.path),
    calls = f.calls.length,
    events = f.observed.length;
  expect(
    await f.service.command(f.spec.sessionId, () =>
      Promise.resolve({ ok: true, checkpoint: before }),
    ),
  ).toEqual({ ok: true, checkpoint: before });
  expect(files(f.path)).toEqual(disk);
  expect(f.calls).toHaveLength(calls);
  expect(f.observed).toHaveLength(events);
  expect(f.service.diagnostics().pendingControlEvents).toBe(0);
  await available(f);
});
for (const failure of ["unsuccessful", "throw", "non-error"] as const)
  it(`unchanged/${failure}: no callback report fabricates a new ACK`, async () => {
    const f = await setup(),
      c = await admit(f),
      before = cp(c),
      disk = files(f.path),
      events = f.observed.length;
    const nonError = vi.fn<() => Promise<ReplayCommandResult>>().mockRejectedValue("NON_ERROR");
    const operation = f.service.command(f.spec.sessionId, async () => {
      if (failure === "non-error") return nonError();
      if (failure === "throw") throw Error("NO_ACK");
      return { ok: false, code: "NO_ACK", state: "READY" };
    });
    if (failure === "unsuccessful") expect((await operation).ok).toBe(false);
    else if (failure === "non-error") await expect(operation).rejects.toBe("NON_ERROR");
    else await expect(operation).rejects.toThrow("NO_ACK");
    expect(cp(c)).toEqual(before);
    expect(files(f.path)).toEqual(disk);
    expect(f.observed).toHaveLength(events);
    expect(f.service.diagnostics().pendingControlEvents).toBe(0);
    await available(f);
  });
it("missing no-op success evidence rejects without inventing a publication", async () => {
  const f = await setup(),
    c = await admit(f),
    before = cp(c),
    disk = files(f.path);
  await expect(
    f.service.command(f.spec.sessionId, () => Promise.resolve({ ok: true } as ReplayCommandResult)),
  ).rejects.toThrow();
  expect(cp(c)).toEqual(before);
  expect(files(f.path)).toEqual(disk);
  expect(f.service.diagnostics().pendingControlEvents).toBe(0);
  await available(f);
});
for (const report of ["corrupt", "foreign", "checkpoint-getter", "ok-nonboolean"] as const)
  it(`${report}: consistency failure follows actual ACK retention`, async () => {
    const f = await setup(),
      c = await admit(f),
      before = cp(c);
    await expect(
      f.service.command(f.spec.sessionId, async (owner) => {
        expect((await owner.pause()).ok).toBe(true);
        if (report === "corrupt")
          return { ok: true, checkpoint: { ...before, fingerprint: hash("WRONG") } };
        if (report === "foreign")
          return { ok: true, checkpoint: { ...before, sessionId: "FOREIGN" } };
        if (report === "checkpoint-getter")
          return {
            ok: true,
            get checkpoint(): ReplayCheckpoint {
              throw Error("CHECKPOINT_GETTER");
            },
          };
        return { ok: "true", checkpoint: before } as unknown as ReplayCommandResult;
      }),
    ).rejects.toThrow();
    const actual = cp(c);
    pending(f, actual);
    await unavailable(f);
    await f.service.retryControlEvents();
    exact(f.observed.at(-1)!, actual);
    await available(f);
  });
it("honest UNKNOWN commitment plus success-like report cannot certify the old ACK; fresh fencing recovers real durable data", async () => {
  const f = await setup(),
    c = await admit(f),
    before = cp(c),
    commit = f.repository.commit.bind(f.repository);
  vi.spyOn(f.repository, "commit").mockImplementation((checkpoint) => {
    const r = commit(checkpoint);
    return r.ok
      ? {
          ok: false,
          code: "REPORT_UNKNOWN",
          commitment: "UNKNOWN_COMMITMENT",
          operationId: r.value.operationId,
        }
      : r;
  });
  await expect(
    f.service.command(f.spec.sessionId, async (owner) => {
      expect((await owner.pause()).ok).toBe(false);
      return { ok: true, checkpoint: before };
    }),
  ).rejects.toThrow("REPLAY_COMMAND_ACKNOWLEDGEMENT_REQUIRED");
  expect(cp(c)).toEqual(before);
  expect(c.diagnostics().obligation?.commitment).toBe("UNKNOWN_COMMITMENT");
  expect(f.service.diagnostics().pendingControlEvents).toBe(0);
  await unavailable(f);
  await f.service.retryControlEvents();
  expect(c.diagnostics().obligation?.commitment).toBe("UNKNOWN_COMMITMENT");
  await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  vi.restoreAllMocks();
  const fresh = await setup(),
    owner = await fresh.service.admit(raw(f.spec), f.inputs, f.repository),
    actual = cp(owner);
  expect(actual.generation).toBe(before.generation + 1);
  expect(actual.state).toBe("PAUSED");
  expect(owner.diagnostics().obligation).toBeNull();
  exact(fresh.observed[0]!, actual);
  const events = fresh.observed.length;
  expect(
    await fresh.service.command(f.spec.sessionId, () =>
      Promise.resolve({ ok: true, checkpoint: actual }),
    ),
  ).toEqual({ ok: true, checkpoint: actual });
  expect(fresh.observed).toHaveLength(events);
  await available(fresh);
  await fresh.service.shutdown();
});
it("proven noncommitment with unchanged success report creates no fabricated new ACK", async () => {
  const f = await setup(),
    c = await admit(f),
    before = cp(c),
    disk = files(f.path),
    events = f.observed.length;
  vi.spyOn(f.repository, "commit").mockReturnValueOnce({
    ok: false,
    code: "NO_COMMIT",
    commitment: "CONFIRMED_NOT_COMMITTED",
    operationId: replayOperationId(before),
  });
  expect(
    await f.service.command(f.spec.sessionId, async (owner) => {
      expect((await owner.pause()).ok).toBe(false);
      return { ok: true, checkpoint: before };
    }),
  ).toEqual({ ok: true, checkpoint: before });
  expect(cp(c)).toEqual(before);
  expect(files(f.path)).toEqual(disk);
  expect(f.observed).toHaveLength(events);
  expect(c.diagnostics().obligation).toBeNull();
  expect(f.service.diagnostics().pendingControlEvents).toBe(0);
});
it("reentrant result getter observes retained actual ACK and cannot enter competing runtime work", async () => {
  const f = await setup(),
    c = await admit(f),
    before = cp(c);
  let competing: Promise<ReplayCommandResult> | undefined, retry: Promise<void> | undefined;
  await expect(
    f.service.command(f.spec.sessionId, async (owner) => {
      await owner.pause();
      return {
        get ok(): true {
          pending(f, cp(c));
          expect(f.service.diagnostics().busy).toBe(true);
          competing = f.service.command(f.spec.sessionId, (x) => x.resume());
          retry = f.service.retryControlEvents();
          void competing.catch(() => undefined);
          void retry.catch(() => undefined);
          throw Error("REENTRANT_GETTER");
        },
        checkpoint: before,
      };
    }),
  ).rejects.toThrow("REENTRANT_GETTER");
  await expect(competing).rejects.toThrow("REPLAY_RUNTIME_NOT_READY");
  await expect(retry).rejects.toThrow("REPLAY_RUNTIME_NOT_READY");
  pending(f, cp(c));
  await f.service.retryControlEvents();
  exact(f.observed.at(-1)!, cp(c));
});
it("capacity one with two owners fences new work after stale-success preparation failure", async () => {
  const f = await setup(),
    a = await admit(f),
    b = await admit(f, "other"),
    before = cp(a),
    bcp = cp(b);
  await expect(
    f.service.command(f.spec.sessionId, async (owner) => {
      await owner.pause();
      f.setReader(() => {
        throw Error("PREP");
      });
      return { ok: true, checkpoint: before };
    }),
  ).rejects.toThrow("PREP");
  expect(f.service.diagnostics().controlPublications).toEqual([
    expect.objectContaining({
      sessionId: cp(a).sessionId,
      checkpointId: cp(a).checkpointId,
      generation: cp(a).generation,
      phase: "FAILED",
      uncertain: false,
    }),
  ]);
  for (const id of [f.spec.sessionId, "other"])
    await expect(f.service.command(id, (x) => x.resume())).rejects.toThrow(
      "CONTROL_PUBLICATION_REQUIRED",
    );
  expect(cp(b)).toEqual(bcp);
  f.setReader();
  await f.service.retryControlEvents();
  exact(f.observed.at(-1)!, cp(a));
  expect((await f.service.command("other", (x) => x.pause())).ok).toBe(true);
});
it("FIFO successful prefix and ambiguous suffix retain original identities through bounded shutdown retry", async () => {
  const f = await setup(2),
    a = await admit(f, "a"),
    b = await admit(f, "b"),
    deferred = await admit(f, "c"),
    before = cp(deferred);
  f.setReader(() => {
    throw Error("PREP");
  });
  await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  expect(f.service.diagnostics().controlPublications.map((x) => x.sessionId)).toEqual(["a", "b"]);
  expect(cp(deferred)).toEqual(before);
  f.setReader();
  const publish = f.bus.publish.bind(f.bus);
  vi.spyOn(f.bus, "publish")
    .mockImplementationOnce(publish)
    .mockImplementationOnce(async (event) => {
      await publish(event);
      throw Error("REPORT_UNKNOWN");
    });
  await expect(f.service.retryControlEvents()).rejects.toThrow("REPORT_UNKNOWN");
  expect(f.service.diagnostics().controlPublications).toEqual([
    expect.objectContaining({ sessionId: "b", phase: "UNCERTAIN" }),
  ]);
  exact(
    f.observed.find((e) => e.payload.sessionId === "a" && e.payload.state === "STOPPED")!,
    cp(a),
  );
  exact(
    f.observed.find((e) => e.payload.sessionId === "b" && e.payload.state === "STOPPED")!,
    cp(b),
  );
  const last = f.observed.at(-1);
  await f.service.retryControlEvents();
  expect(f.observed.at(-1)).toEqual(last);
  await f.service.shutdown();
  await f.service.shutdown();
  expect(cp(deferred).state).toBe("STOPPED");
});
it("same-semantic-ID generations retain distinct exact summaries despite success reports from generation one", async () => {
  const f = await setup(),
    c = await admit(f),
    before = cp(c),
    identities = new Set<string>();
  for (let i = 0; i < 3; i++)
    for (const action of ["pause", "resume"] as const) {
      expect(
        await f.service.command(f.spec.sessionId, async (owner) => {
          await owner[action]();
          return { ok: true, checkpoint: before };
        }),
      ).toEqual({ ok: true, checkpoint: cp(c) });
      expect(cp(c).checkpointId).toBe(before.checkpointId);
      exact(f.observed.at(-1)!, cp(c));
      identities.add(identity(cp(c)));
    }
  expect(identities.size).toBe(6);
});
it("busy prewrite shutdown cancellation produces no ACK or summary from stale success evidence", async () => {
  const f = await setup(),
    c = await admit(f),
    before = cp(c),
    disk = files(f.path),
    hold = gate(),
    entered = gate();
  f.setVerifier(async () => {
    entered.release();
    await hold.promise;
  });
  const operation = f.service.command(f.spec.sessionId, async (owner) => {
    expect((await owner.pause()).ok).toBe(false);
    return { ok: true, checkpoint: before };
  });
  await entered.promise;
  await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  hold.release();
  await expect(operation).rejects.toThrow("REPLAY_COMMAND_ACKNOWLEDGEMENT_REQUIRED");
  expect(cp(c)).toEqual(before);
  expect(files(f.path)).toEqual(disk);
  expect(f.service.diagnostics().pendingControlEvents).toBe(0);
  await unavailable(f);
  f.setVerifier();
  await f.service.shutdown();
  await f.service.shutdown();
});
it("real pending consumer-read reconciliation uses actual ACK despite stale success report", async () => {
  const tasks: readonly ReplayTaskDescriptor[] = [
    {
      taskId: "004N-reconciliation",
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
          evidenceId: "004N-source-reconciliation",
          reconciled: true,
        },
      },
    },
  ];
  const f = await setup(16, tasks),
    c = await admit(f),
    held = gate(),
    entered = gate();
  class Held extends ConsumerChannel {
    public override async read() {
      entered.release();
      await held.promise;
      return undefined;
    }
  }
  const observation = c.observeConsumerChannel(new Held("004N-read", 1), "004N-artifact");
  await entered.promise;
  expect((await c.stop()).ok).toBe(false);
  held.release();
  expect((await observation).ok).toBe(false);
  const fresh = await setup(16, tasks),
    owner = await fresh.service.admit(raw(f.spec), f.inputs, f.repository);
  expect(
    (await fresh.service.command(f.spec.sessionId, (x) => x.runToTime(t("10:02:00")))).ok,
  ).toBe(true);
  const before = cp(owner),
    id = before.evidence.find((e) => e.kind === "CHANNEL_READ_PENDING")?.identity;
  if (!id) throw Error("PENDING_READ_REQUIRED");
  expect(owner.diagnostics().pendingConsumerReads).toBe(1);
  const result = await fresh.service.command(f.spec.sessionId, async (x) => {
    expect((await x.reconcileConsumerRead(id)).ok).toBe(true);
    return { ok: true, checkpoint: before };
  });
  const actual = cp(owner);
  expect(actual.generation).toBe(before.generation + 1);
  expect(actual.evidence).toContainEqual(
    expect.objectContaining({ kind: "CHANNEL_READ_RECONCILED", identity: id }),
  );
  expect(result).toEqual({ ok: true, checkpoint: actual });
  expect(owner.diagnostics().pendingConsumerReads).toBe(0);
  exact(fresh.observed.at(-1)!, actual);
  expect(recovered(f)).toEqual(actual);
  await available(fresh);
  await fresh.service.shutdown();
});
it("new acknowledged summary remains protected when a subsequent genuine storage uncertainty prevents success", async () => {
  const f = await setup(),
    c = await admit(f),
    before = cp(c),
    commit = f.repository.commit.bind(f.repository);
  await expect(
    f.service.command(f.spec.sessionId, async (owner) => {
      expect((await owner.pause()).ok).toBe(true);
      vi.spyOn(f.repository, "commit").mockImplementation((checkpoint) => {
        const r = commit(checkpoint);
        return r.ok
          ? {
              ok: false,
              code: "UNKNOWN",
              commitment: "UNKNOWN_COMMITMENT",
              operationId: r.value.operationId,
            }
          : r;
      });
      expect((await owner.resume()).ok).toBe(false);
      return { ok: true, checkpoint: before };
    }),
  ).rejects.toThrow("REPLAY_COMMAND_ACKNOWLEDGEMENT_REQUIRED");
  const acknowledged = cp(c);
  expect(acknowledged.generation).toBe(before.generation + 1);
  expect(acknowledged.state).toBe("PAUSED");
  pending(f, acknowledged);
  expect(c.diagnostics().obligation?.commitment).toBe("UNKNOWN_COMMITMENT");
  await unavailable(f);
  await f.service.retryControlEvents();
  exact(f.observed.at(-1)!, acknowledged);
  expect(c.diagnostics().obligation?.commitment).toBe("UNKNOWN_COMMITMENT");
  await unavailable(f);
  await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  vi.restoreAllMocks();
  const fresh = await setup(),
    owner = await fresh.service.admit(raw(f.spec), f.inputs, f.repository);
  expect(cp(owner).generation).toBe(before.generation + 2);
  expect(cp(owner).state).toBe("RUNNING");
  exact(fresh.observed[0]!, cp(owner));
  await fresh.service.shutdown();
});
