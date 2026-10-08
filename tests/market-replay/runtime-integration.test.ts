import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, afterEach } from "vitest";
import { stateDomain } from "@ate/persistence";
import { hash } from "@ate/multitimeframe";
import { FilesystemReplayCheckpointRepository } from "@ate/market-replay";
import { governedFixture } from "./integration-fixtures.js";
const roots: string[] = [];
afterEach(() => {
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
async function setup(enabled = true) {
  const f = await governedFixture(enabled);
  const root = mkdtempSync(join(tmpdir(), "ate-runtime-replay-"));
  roots.push(root);
  const repository = new FilesystemReplayCheckpointRepository(root, f.clock, f.spec.resourceLimits);
  return { ...f, repository };
}
describe("research runtime admission and existing owner authorities", () => {
  it("registers replay through the actual application runtime and existing owners", async () => {
    const f = await setup();
    expect((await f.runtime.start()).ok).toBe(true);
    expect(f.authority.require(stateDomain("data.replay.sessions"))).toMatchObject({
      ok: true,
      value: { writeAuthority: "@ate/market-replay" },
    });
    expect(f.eventRegistry.require("data.replay.control.v1").ok).toBe(true);
    const { fingerprint: _fp, ...spec } = f.spec;
    await f.service.admit(spec, f.inputs, f.repository);
    expect(f.service.diagnostics()).toMatchObject({
      sessions: 1,
      pendingControlEvents: 0,
      researchOnly: true,
      tradingAuthorized: false,
    });
    const run = await f.service.command(f.spec.sessionId, (c) => c.runToEnd());
    expect(run.ok).toBe(true);
    expect((await f.runtime.stop()).ok).toBe(true);
  });
  it("rejects disabled configuration without admitting a session", async () => {
    const f = await setup(false);
    expect((await f.runtime.start()).ok).toBe(true);
    const { fingerprint: _fp, ...spec } = f.spec;
    await expect(f.service.admit(spec, f.inputs, f.repository)).rejects.toThrow("REPLAY_DISABLED");
    expect(f.service.diagnostics().sessions).toBe(0);
  });
  it("rejects admission outside governed lifecycle and duplicate identity", async () => {
    const f = await setup();
    const { fingerprint: _fp, ...spec } = f.spec;
    await expect(f.service.admit(spec, f.inputs, f.repository)).rejects.toThrow(
      "REPLAY_ADMISSION_NOT_READY",
    );
    await f.runtime.start();
    await f.service.admit(spec, f.inputs, f.repository);
    await expect(f.service.admit(spec, f.inputs, f.repository)).rejects.toThrow(
      "SESSION_IDENTITY_CONFLICT",
    );
    await f.runtime.stop();
    await expect(f.service.admit(spec, f.inputs, f.repository)).rejects.toThrow(
      "REPLAY_ADMISSION_NOT_READY",
    );
  });
  it("detects configuration drift before replay progression", async () => {
    const f = await setup();
    await f.runtime.start();
    const { fingerprint: _fp, ...spec } = f.spec;
    const c = await f.service.admit(spec, f.inputs, f.repository);
    f.setConfiguration({
      ...f.configuration,
      fingerprint: `sha256:${hash("changed")}` as typeof f.configuration.fingerprint,
    });
    await expect(f.service.command(f.spec.sessionId, (c) => c.stepEvent())).rejects.toThrow(
      "CONFIGURATION_DRIFT",
    );
    expect(c.currentCheckpoint()?.cursor).toBe(0);
  });
  it("retains failed event publication and prevents successful shutdown until retry", async () => {
    const f = await setup();
    await f.runtime.start();
    await f.bus.stop();
    const { fingerprint: _fp, ...spec } = f.spec;
    await expect(f.service.admit(spec, f.inputs, f.repository)).rejects.toThrow(
      "REPLAY_CONTROL_PUBLICATION_FAILED",
    );
    expect(f.service.diagnostics().pendingControlEvents).toBe(1);
    await expect(f.service.shutdown()).rejects.toThrow("REPLAY_SHUTDOWN_OBLIGATION");
    f.bus.start();
    await f.service.retryControlEvents();
    await f.service.shutdown();
    expect(f.service.diagnostics().lifecycle).toBe("STOPPED");
  });
  it("requires the effective owner configuration fingerprint", async () => {
    const f = await setup();
    await f.runtime.start();
    const { fingerprint: _fp, ...spec } = f.spec;
    await expect(
      f.service.admit(
        { ...spec, configurationFingerprint: hash("invented") },
        f.inputs,
        f.repository,
      ),
    ).rejects.toThrow();
  });
});
describe("runtime resource and policy admission", () => {
  it("enforces the actual configured session limit before creating another session", async () => {
    const f = await governedFixture(true, { "research.replay.maxSessions": 1 });
    const root = mkdtempSync(join(tmpdir(), "ate-runtime-bounded-"));
    roots.push(root);
    expect((await f.runtime.start()).ok).toBe(true);
    const repository = new FilesystemReplayCheckpointRepository(
      root,
      f.clock,
      f.spec.resourceLimits,
    );
    const { fingerprint: _fp, ...raw } = f.spec;
    await f.service.admit(raw, f.inputs, repository);
    await expect(
      f.service.admit({ ...raw, sessionId: "second" }, f.inputs, repository),
    ).rejects.toThrow("SESSION_CAPACITY");
    expect(f.service.diagnostics().sessions).toBe(1);
    await f.runtime.stop();
  });
  it("rejects aggregation policy drift even when the caller supplies the current configuration fingerprint", async () => {
    const f = await setup();
    await f.runtime.start();
    const { fingerprint: _fp, ...raw } = f.spec;
    await expect(
      f.service.admit(
        { ...raw, aggregation: { ...raw.aggregation, directTimeframes: ["M1"] } },
        f.inputs,
        f.repository,
      ),
    ).rejects.toThrow("GOVERNED_AGGREGATION_MISMATCH");
    expect(f.service.diagnostics().sessions).toBe(0);
    await f.runtime.stop();
  });
  it("rejects replay admission when the governed aggregation owner is disabled", async () => {
    const f = await governedFixture(true, { "data.multitimeframe.enabled": false });
    const root = mkdtempSync(join(tmpdir(), "ate-disabled-aggregation-"));
    roots.push(root);
    await f.runtime.start();
    const { fingerprint: _fp, ...raw } = f.spec;
    await expect(
      f.service.admit(
        raw,
        f.inputs,
        new FilesystemReplayCheckpointRepository(root, f.clock, f.spec.resourceLimits),
      ),
    ).rejects.toThrow("AGGREGATION_DISABLED");
    expect(f.service.diagnostics().sessions).toBe(0);
    await f.runtime.stop();
  });
});
