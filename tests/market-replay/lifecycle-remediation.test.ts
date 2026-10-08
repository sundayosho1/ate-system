import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, it, expect } from "vitest";
import { hash } from "@ate/multitimeframe";
import type { LifecycleContext, RuntimeInstanceId } from "@ate/runtime";
import {
  FilesystemReplayCheckpointRepository,
  ReplayController,
  immutableReplayInputs,
  resolveHistoricalReplayInputs,
  createReplayCheckpoint,
  type ReplayCheckpointRepository,
  type ReplaySessionSpecification,
} from "@ate/market-replay";
import { governedFixture } from "./integration-fixtures.js";
import { historicalFixture } from "./historical-fixture.js";
import { t } from "./fixtures.js";
const roots: string[] = [];
function root() {
  const p = mkdtempSync(join(tmpdir(), "ate-004d-"));
  roots.push(p);
  return p;
}
afterEach(() => {
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
it("A/G: actual source verification rejects before storage, preserves diagnostics, and retries identical identity", async () => {
  const f = await setup(),
    file = join(root(), "origin.txt");
  writeFileSync(file, "original");
  const accepted = hash(readFileSync(file, "utf8"));
  const inputs = immutableReplayInputs(f.inputs.manifests, async () => {
    await Promise.resolve();
    if (hash(readFileSync(file, "utf8")) !== accepted) throw Error("SOURCE_ORIGIN_CHANGED");
  });
  writeFileSync(file, "mutated");
  await expect(f.service.admit(raw(f.spec), inputs, f.port)).rejects.toThrow(
    "INITIALIZATION_FAILED",
  );
  expect(f.calls()).toBe(0);
  expect(readdirSync(f.path)).toHaveLength(0);
  expect(f.service.diagnostics()).toMatchObject({
    sessions: 0,
    busy: false,
    pendingControlEvents: 0,
    disposedAdmissions: [
      {
        sessionId: f.spec.sessionId,
        at: f.clock.now(),
        failureCode: "SOURCE_ORIGIN_CHANGED",
        repositoryPhase: "NOT_INITIATED",
        sourceVerification: "FAILED",
      },
    ],
  });
  expect((await f.service.managedService.checkReadiness!(context)).status).toBe("READY");
  expect((await f.service.managedService.checkHealth!(context)).status).toBe("HEALTHY");
  writeFileSync(file, "original");
  const c = await f.service.admit(raw(f.spec), inputs, f.port);
  expect(c.diagnostics()).toMatchObject({
    state: "READY",
    repositoryPhase: "WRITE_INITIATED",
    sourceVerification: "VERIFIED",
  });
  expect(f.calls()).toBeGreaterThan(0);
  await f.service.shutdown();
  await f.service.shutdown();
  expect(f.service.diagnostics().lifecycle).toBe("STOPPED");
  expect(f.service.diagnostics().disposedAdmissions).toHaveLength(1);
});
it("B: actual historical owner revalidation releases provisional registration before same-identity retry", async () => {
  const f = await setup(),
    h = await historicalFixture(),
    inputs = await resolveHistoricalReplayInputs(h.options),
    m = inputs.manifests[0];
  if (!m) throw Error("HISTORICAL_MANIFEST_MISSING");
  const spec = {
    ...raw(f.spec),
    sessionId: "lifecycle-historical",
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
  await expect(f.service.admit(spec, inputs, f.port)).rejects.toThrow("INITIALIZATION_FAILED");
  expect(f.calls()).toBe(0);
  expect(f.service.diagnostics().sessions).toBe(0);
  expect(f.service.diagnostics().disposedAdmissions[0]).toMatchObject({
    failureCode: "HISTORICAL_CONTENT_INTEGRITY",
    repositoryPhase: "NOT_INITIATED",
  });
  h.repository.getManifest = original;
  await inputs.verify();
  const c = await f.service.admit(spec, inputs, f.port);
  expect(c.currentCheckpoint()?.sessionId).toBe(spec.sessionId);
  await f.service.shutdown();
  await f.service.shutdown();
});
it("C: incompatible constructor cannot register a session or poison the admission lock", async () => {
  const f = await setup();
  await expect(f.service.admit(raw(f.spec), immutableReplayInputs([]), f.port)).rejects.toThrow(
    "INPUT_SPECIFICATION_MISMATCH",
  );
  expect(f.calls()).toBe(0);
  expect(f.service.diagnostics()).toMatchObject({ busy: false, sessions: 0 });
  await f.service.admit(raw(f.spec), f.inputs, f.port);
  await f.service.shutdown();
  await f.service.shutdown();
});
it("D: real committed content with unknown outcome retains registration and blocks unsafe retry and stop", async () => {
  const f = await setup();
  await expect(
    f.service.admit(raw(f.spec), f.inputs, {
      recover: (s) => f.port.recover(s),
      commit: (cp) => {
        const r = f.port.commit(cp);
        if (!r.ok) return r;
        return {
          ok: false,
          code: "AFTER_REAL_COMMIT",
          operationId: r.value.operationId,
          commitment: "UNKNOWN_COMMITMENT",
        };
      },
      publish: (id) => f.port.publish(id),
    }),
  ).rejects.toThrow("AFTER_REAL_COMMIT");
  expect(readdirSync(f.path).length).toBeGreaterThan(0);
  expect(f.service.diagnostics()).toMatchObject({
    sessions: 1,
    busy: false,
    disposedAdmissions: [],
    sessionStates: [
      { repositoryPhase: "WRITE_INITIATED", obligation: { commitment: "UNKNOWN_COMMITMENT" } },
    ],
  });
  await expect(f.service.admit(raw(f.spec), f.inputs, f.port)).rejects.toThrow(
    "SESSION_IDENTITY_CONFLICT",
  );
  await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  const fresh = new ReplayController(f.spec, f.inputs, f.repository);
  expect((await fresh.initialize()).ok).toBe(true);
});
it("E: callback admission and shutdown during empty recovery cancel only the exact provisional owner", async () => {
  const f = await setup();
  let nested: Promise<unknown> | undefined, stop: Promise<unknown> | undefined;
  await expect(
    f.service.admit(raw(f.spec), f.inputs, {
      recover: (s) => {
        nested = f.service.admit(raw(f.spec), f.inputs, f.port).catch((e: Error) => e.message);
        stop = f.service.shutdown().catch((e: Error) => e.message);
        return f.port.recover(s);
      },
      commit: (cp) => f.port.commit(cp),
      publish: (id) => f.port.publish(id),
    }),
  ).rejects.toThrow("STOP_REQUESTED");
  expect(await nested).toBe("REPLAY_ADMISSION_NOT_READY");
  expect(await stop).toBe("REPLAY_SHUTDOWN_OBLIGATION");
  expect(f.service.diagnostics()).toMatchObject({
    sessions: 0,
    busy: false,
    disposedAdmissions: [
      {
        repositoryPhase: "RECOVERED_EMPTY",
        sourceVerification: "VERIFIED",
        failureCode: "STOP_REQUESTED",
      },
    ],
  });
  await f.service.shutdown();
  await f.service.shutdown();
});
it("F: delayed rejected verifier cannot release the lock or dispose a later same-identity registration", async () => {
  const f = await setup();
  let entered!: () => void, reject!: () => void;
  const seen = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((_resolve, r) => (reject = () => r(Error("DELAYED_SOURCE_REJECTED"))));
  const inputs = immutableReplayInputs(f.inputs.manifests, async () => {
    entered();
    await gate;
  });
  const pending = f.service.admit(raw(f.spec), inputs, f.port),
    expected = expect(pending).rejects.toThrow("INITIALIZATION_FAILED");
  await seen;
  await expect(f.service.admit(raw(f.spec), f.inputs, f.port)).rejects.toThrow(
    "REPLAY_ADMISSION_NOT_READY",
  );
  expect(f.service.diagnostics()).toMatchObject({ busy: true, sessions: 1 });
  reject();
  await expected;
  expect(f.calls()).toBe(0);
  const valid = await f.service.admit(raw(f.spec), f.inputs, f.port);
  await Promise.resolve();
  expect(f.service.diagnostics().sessions).toBe(1);
  expect(valid.currentCheckpoint()?.sessionId).toBe(f.spec.sessionId);
  await f.service.shutdown();
});
it("F: concurrent shutdown and delayed source rejection cleanly dispose before repeated stop", async () => {
  const f = await setup();
  let entered!: () => void, reject!: () => void;
  const seen = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((_resolve, r) => (reject = () => r(Error("DELAYED_SOURCE_REJECTED"))));
  const pending = f.service.admit(
      raw(f.spec),
      immutableReplayInputs(f.inputs.manifests, async () => {
        entered();
        await gate;
      }),
      f.port,
    ),
    expected = expect(pending).rejects.toThrow("INITIALIZATION_FAILED");
  await seen;
  await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  await expect(f.service.admit(raw(f.spec), f.inputs, f.port)).rejects.toThrow(
    "REPLAY_ADMISSION_NOT_READY",
  );
  reject();
  await expected;
  expect(f.service.diagnostics()).toMatchObject({ sessions: 0, busy: false });
  expect(f.calls()).toBe(0);
  await f.service.shutdown();
  await f.service.shutdown();
  expect(f.service.diagnostics().lifecycle).toBe("STOPPED");
});
it("G: diagnostic snapshots are immutable and never store arbitrary verifier messages", async () => {
  const f = await setup();
  await expect(
    f.service.admit(
      raw(f.spec),
      immutableReplayInputs(f.inputs.manifests, async () => {
        await Promise.resolve();
        throw Error("unexpected verifier detail");
      }),
      f.port,
    ),
  ).rejects.toThrow("INITIALIZATION_FAILED");
  const d = f.service.diagnostics();
  expect(Object.isFrozen(d.disposedAdmissions)).toBe(true);
  expect(Object.isFrozen(d.disposedAdmissions[0])).toBe(true);
  expect(d.disposedAdmissions[0]?.failureCode).toBe("UNCLASSIFIED_INITIALIZATION_FAILURE");
  expect(JSON.stringify(d)).not.toContain("unexpected verifier detail");
  expect(d.sessions).toBe(0);
  await f.service.shutdown();
});
it("H/J: repeated rejection preserves configured session capacity and bounds diagnostic eviction", async () => {
  const f = await setup({
    "research.replay.maxSessions": 1,
    "research.replay.maxEvidenceRecords": 2,
  });
  let verifications = 0;
  const inputs = immutableReplayInputs(f.inputs.manifests, async () => {
    await Promise.resolve();
    verifications++;
    throw Error("REPEATED_ORIGIN_REJECTION");
  });
  for (let i = 0; i < 7; i++) {
    await expect(f.service.admit(raw(f.spec), inputs, f.port)).rejects.toThrow(
      "INITIALIZATION_FAILED",
    );
    expect(f.service.diagnostics().sessions).toBe(0);
    expect(f.service.diagnostics().disposedAdmissions.length).toBeLessThanOrEqual(2);
  }
  expect(verifications).toBe(7);
  expect(f.calls()).toBe(0);
  expect(f.service.diagnostics()).toMatchObject({
    evictedAdmissionDiagnostics: 5,
    disposedAdmissions: [
      { failureCode: "REPEATED_ORIGIN_REJECTION" },
      { failureCode: "REPEATED_ORIGIN_REJECTION" },
    ],
  });
  await f.service.admit(raw(f.spec), f.inputs, f.port);
  await expect(
    f.service.admit({ ...raw(f.spec), sessionId: "capacity-bypass" }, f.inputs, f.port),
  ).rejects.toThrow("SESSION_CAPACITY");
  expect(f.service.diagnostics().sessions).toBe(1);
  await f.service.shutdown();
  await f.service.shutdown();
});
it("I: exception after recovery was initiated retains unknown obligation even without acknowledged checkpoint", async () => {
  const f = await setup();
  await expect(
    f.service.admit(raw(f.spec), f.inputs, {
      recover: (s) => {
        f.port.recover(s);
        throw Error("RECOVERY_RESULT_LOST");
      },
      commit: (cp) => f.port.commit(cp),
      publish: (id) => f.port.publish(id),
    }),
  ).rejects.toThrow("INITIALIZATION_FAILED");
  expect(f.service.diagnostics()).toMatchObject({
    sessions: 1,
    disposedAdmissions: [],
    sessionStates: [
      {
        repositoryPhase: "RECOVERY_IN_FLIGHT",
        sourceVerification: "VERIFIED",
        checkpointId: null,
        obligation: { commitment: "UNKNOWN_COMMITMENT" },
      },
    ],
  });
  await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
});
it("I: recovered durable content validation failure cannot be disposed on null checkpoint alone", async () => {
  const f = await setup(),
    seed = new ReplayController(f.spec, f.inputs, f.repository);
  expect((await seed.initialize()).ok).toBe(true);
  const original = f.repository.recover.bind(f.repository);
  await expect(
    f.service.admit(raw(f.spec), f.inputs, {
      recover: (s) => {
        const r = original(s);
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
      commit: (cp) => f.port.commit(cp),
      publish: (id) => f.port.publish(id),
    }),
  ).rejects.toThrow("INITIALIZATION_FAILED");
  expect(f.service.diagnostics()).toMatchObject({
    sessions: 1,
    disposedAdmissions: [],
    sessionStates: [{ repositoryPhase: "RECOVERED_CONTENT", checkpointId: null, state: "FAILED" }],
  });
  await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
  const fresh = new ReplayController(f.spec, f.inputs, f.repository);
  expect((await fresh.initialize()).ok).toBe(true);
});
