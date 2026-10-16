import { beforeAll, it, expect } from "vitest";
import {
  FilesystemMOSERepository,
  MemoryMOSERepository,
  MOSECoreRuntime,
  type Repository,
} from "@ate/mose-core";
import { owners, fixture, take, root, configuration, type Owners } from "./fixtures.js";
import { recover, stored, loadCheckpoints } from "./remediation-helpers.js";
let base: Owners;
beforeAll(async () => {
  base = await owners();
});
const size = (v: unknown) => Buffer.byteLength(JSON.stringify(v));
async function bounded(count: number, delta: number, physical: boolean) {
  const measure = await fixture(base, { maxRetainedBytes: 1000000 });
  await measure.setup();
  for (let i = 1; i < count; i++) take(await measure.start());
  const rows = await loadCheckpoints(measure.repository),
    total = rows.reduce((n, c) => n + size(c), 0);
  let limit = total + delta;
  for (let i = 0; i < 4; i++) limit = total + count * (String(limit).length - 7) + delta;
  const repo = physical
    ? new FilesystemMOSERepository(root(), 1048576, 512, limit)
    : new MemoryMOSERepository();
  const f = await fixture(base, { maxRetainedBytes: limit }, repo),
    results = [];
  results.push(await f.service.dispatch(f.create()));
  for (let i = 1; i < count; i++) results.push(await f.start());
  return { f, results, limit };
}
it("original G23 intact 8836-byte acknowledged physical artifact recovers at identical capacity", async () => {
  const f = await stored(base, "G23");
  expect(f.first.state.sessions[0]!.universe.policy.maxRetainedBytes).toBe(8836);
  expect(size(f.first)).toBe(8836);
  take(f.result);
  expect(f.reader.diagnostics().history).toBe(1);
  expect(take(await f.f.repository.load())).toEqual([f.first]);
});
for (const physical of [false, true])
  for (const count of [1, 2, 10])
    for (const delta of [-1, 0, 1])
      it(`${physical ? "filesystem" : "memory"} ${count} generations ${delta === 0 ? "exact" : delta < 0 ? "one byte over budget" : "one byte below budget"} preserves recovery parity`, async () => {
        const { f, results, limit } = await bounded(count, delta, physical),
          last = results.at(-1)!;
        if (delta < 0) {
          expect(last.ok).toBe(false);
          expect(f.service.diagnostics().pendingAcknowledgments).toBe(0);
          expect(await loadCheckpoints(f.repository)).toHaveLength(count - 1);
        } else {
          take(last);
          const rows = await loadCheckpoints(f.repository);
          expect(rows).toHaveLength(count);
          expect(rows.reduce((n, c) => n + size(c), 0)).toBe(limit - delta);
          expect(size(rows)).toBe(limit - delta + count + 1);
          take((await recover(f)).result);
          if (count === 10) expect(rows.at(-1)!.generation).toBe(10);
        }
      });
it("exact-capacity lost ACK retains genuine debt and fresh recovery succeeds", async () => {
  const measured = await bounded(1, 0, true),
    limit = measured.limit,
    repo = new FilesystemMOSERepository(root(), 1048576, 512, limit),
    f = await fixture(base, { maxRetainedBytes: limit }, repo);
  f.ports.repository = {
    load: () => repo.load(),
    commit: async (c) => {
      take(await repo.commit(c));
      throw Error("ACK_LOST");
    },
  };
  expect((await f.service.dispatch(f.create())).ok).toBe(false);
  expect(f.service.diagnostics().pendingAcknowledgments).toBe(1);
  expect((await f.service.stop()).ok).toBe(false);
  take((await recover(f, repo)).result);
});
it("exact capacity honest NONE supports same-command retry without phantom obligation", async () => {
  const { limit } = await bounded(1, 0, false),
    repo = new MemoryMOSERepository(),
    f = await fixture(base, { maxRetainedBytes: limit }, repo),
    a = f.create();
  f.ports.repository = {
    load: () => repo.load(),
    commit: () =>
      Promise.resolve({
        ok: false,
        error: { code: "NO_SPACE", commitment: "NONE", auditCorrelationId: "test" },
      }),
  };
  expect((await f.service.dispatch(a)).ok).toBe(false);
  expect(f.service.diagnostics().pendingAcknowledgments).toBe(0);
  f.ports.repository = repo;
  take(await f.service.dispatch(a));
  take((await recover(f)).result);
});
it("genuine UNKNOWN without a write never becomes successful shutdown", async () => {
  const f = await fixture(base);
  f.ports.repository = {
    load: () => f.repository.load(),
    commit: () =>
      Promise.resolve({
        ok: false,
        error: { code: "UNCERTAIN", commitment: "UNKNOWN", auditCorrelationId: "test" },
      }),
  };
  expect((await f.service.dispatch(f.create())).ok).toBe(false);
  expect((await f.service.stop()).ok).toBe(false);
  expect((await f.service.stop()).ok).toBe(false);
  expect(f.service.diagnostics().pendingAcknowledgments).toBe(1);
});
for (const physical of [false, true])
  it(`${physical ? "physical" : "memory"} stricter current retained limit refuses intact oversized history without rewriting`, async () => {
    const { f, limit } = await bounded(1, 0, physical);
    const rows = await loadCheckpoints(f.repository);
    f.setConfiguration(await configuration({ ...f.policy, maxRetainedBytes: limit - 1 }, f.clock));
    const n = await recover(f);
    expect(n.result.ok).toBe(false);
    expect(n.reader.diagnostics().lifecycle).toBe("RECOVERY_REQUIRED");
    expect(await loadCheckpoints(f.repository)).toEqual(rows);
  });
for (const fault of ["getter", "sparse", "oversized", "proxy"] as const)
  it(`recovery collection ${fault} remains bounded without invoking native traps`, async () => {
    let invoked = false;
    let value: unknown = [];
    if (fault === "getter") {
      value = Object.defineProperty([null], "0", {
        enumerable: true,
        get() {
          invoked = true;
          throw Error("GETTER");
        },
      });
    }
    if (fault === "sparse") value = Array(2);
    if (fault === "oversized") value = Array(513);
    if (fault === "proxy")
      value = new Proxy([], {
        get() {
          invoked = true;
          throw Error("TRAP");
        },
      });
    const repo: Repository = {
      load: () => Promise.resolve({ ok: true, value: value as readonly unknown[] }),
      commit: () => Promise.reject(Error("NO_WRITE")),
    };
    const f = await fixture(base, {}, repo, false);
    expect((await f.service.initialize()).ok).toBe(false);
    expect(invoked).toBe(false);
    expect((await f.service.stop()).ok).toBe(false);
  });
it("memory and physical recovery agree on identical retained checkpoint accounting", async () => {
  const { f } = await bounded(2, 0, false),
    rows = await loadCheckpoints(f.repository);
  const repo = new FilesystemMOSERepository(root(), 1048576, 512, f.policy.maxRetainedBytes);
  for (const row of rows) take(await repo.commit(row));
  const n = new MOSECoreRuntime("mose-lab", { ...f.ports, repository: repo });
  take(await n.initialize());
  expect(n.diagnostics().history).toBe(2);
});
