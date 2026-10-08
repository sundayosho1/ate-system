import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VirtualClock } from "@ate/time";
import {
  ReplayController,
  FilesystemReplayCheckpointRepository,
  createReplayCheckpoint,
  type ReplayCheckpointRepository,
  type ReplayCommandResult,
} from "@ate/market-replay";
import { replayFixture, t } from "./fixtures.js";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function ok(r: ReplayCommandResult) {
  if (!r.ok) throw Error(r.code);
  return r.checkpoint;
}
function setup() {
  const f = replayFixture();
  const root = mkdtempSync(join(tmpdir(), "ate-replay-fault-"));
  roots.push(root);
  const clock = new VirtualClock(t("13:00:00"));
  const repository = new FilesystemReplayCheckpointRepository(root, clock, f.spec.resourceLimits);
  return { ...f, root, clock, repository };
}
describe("unknown commitment and repository certificate obligations", () => {
  for (const stage of ["before-content", "after-content", "after-marker"] as const)
    it(`preserves ${stage} exceptions until fresh recovery`, async () => {
      const f = setup();
      const initial = new ReplayController(f.spec, f.inputs, f.repository);
      ok(await initial.initialize());
      const faulty: ReplayCheckpointRepository = {
        recover: (s) => f.repository.recover(s),
        commit: (c) => {
          if (stage === "before-content") throw Error("unknown");
          const r = f.repository.commit(c);
          if (stage === "after-content") throw Error("unknown");
          return r;
        },
        publish: (id) => {
          const r = f.repository.publish(id);
          throw Error(`after-marker:${r.ok}`);
        },
      };
      const c = new ReplayController(f.spec, f.inputs, faulty);
      ok(await c.initialize());
      expect(await c.stepEvent()).toMatchObject({ ok: false, state: "RECOVERY_REQUIRED" });
      const obligation = c.diagnostics().obligation;
      expect(obligation).not.toBeNull();
      expect(await c.stop()).toMatchObject({ ok: false, code: "RECOVERY_OBLIGATION" });
      expect(c.diagnostics().obligation).toEqual(obligation);
      const fresh = new ReplayController(f.spec, f.inputs, f.repository);
      expect(ok(await fresh.initialize()).cursor).toBe(stage === "before-content" ? 0 : 1);
    });
  it("detects reentrant shutdown after content commitment and before marker publication", async () => {
    const f = setup();
    const initial = new ReplayController(f.spec, f.inputs, f.repository);
    ok(await initial.initialize());
    let nested: Promise<ReplayCommandResult> | undefined;
    const faulty: ReplayCheckpointRepository = {
      recover: (s) => f.repository.recover(s),
      commit: (cp) => {
        const result = f.repository.commit(cp);
        nested = c.stop();
        return result;
      },
      publish: (id) => f.repository.publish(id),
    };
    const c = new ReplayController(f.spec, f.inputs, faulty);
    ok(await c.initialize());
    expect(await c.stepEvent()).toMatchObject({ ok: false, code: "COMMITTED_DURING_SHUTDOWN" });
    expect(await nested).toMatchObject({ ok: false, code: "SHUTDOWN_IN_PROGRESS" });
    expect(await c.stop()).toMatchObject({ ok: false, code: "RECOVERY_OBLIGATION" });
    const fresh = new ReplayController(f.spec, f.inputs, f.repository);
    expect(ok(await fresh.initialize()).cursor).toBe(1);
  });
  it("recovers missing publication markers once without inventing the original publication time", async () => {
    const f = setup();
    const c = new ReplayController(f.spec, f.inputs, f.repository);
    const cp = ok(await c.initialize());
    const next = createReplayCheckpoint({ ...cp, generation: 2, state: "PAUSED" });
    expect(f.repository.commit(next).ok).toBe(true);
    f.clock.advanceTo(t("14:00:00"));
    const recovered = f.repository.recover(f.spec);
    if (!recovered.ok) throw Error(recovered.code);
    expect(recovered.value?.committedAt).toBe(t("13:00:00"));
    expect(recovered.value?.publishedAt).toBe(t("14:00:00"));
    f.clock.advanceTo(t("15:00:00"));
    expect(f.repository.recover(f.spec)).toEqual(recovered);
  });
  it("refuses partial content artifacts without deleting recovery evidence", async () => {
    const f = setup();
    writeFileSync(join(f.root, "a".repeat(64) + ".json.tmp"), '{"partial":');
    const c = new ReplayController(f.spec, f.inputs, f.repository);
    expect(await c.initialize()).toMatchObject({ ok: false, state: "RECOVERY_REQUIRED" });
    expect(readdirSync(f.root)).toHaveLength(1);
  });
  it("refuses marker hash corruption", async () => {
    const f = setup();
    const c = new ReplayController(f.spec, f.inputs, f.repository);
    ok(await c.initialize());
    const marker = readdirSync(f.root).find((n) => n.endsWith(".visible"))!;
    const content = JSON.parse(readFileSync(join(f.root, marker), "utf8")) as {
      fingerprint: string;
    };
    content.fingerprint = "b".repeat(64);
    writeFileSync(join(f.root, marker), JSON.stringify(content));
    const fresh = new ReplayController(f.spec, f.inputs, f.repository);
    expect(await fresh.initialize()).toMatchObject({ ok: false, state: "RECOVERY_REQUIRED" });
  });
  it("rejects symlink storage instead of reading an external target", async () => {
    const f = setup();
    const path = join(f.root, "a".repeat(64) + ".json");
    symlinkSync("/etc/passwd", path);
    const c = new ReplayController(f.spec, f.inputs, f.repository);
    expect(await c.initialize()).toMatchObject({ ok: false, state: "RECOVERY_REQUIRED" });
  });
});
