import { beforeAll, it, expect } from "vitest";
import { writeFile, readFile, readdir, symlink } from "node:fs/promises";
import {
  MOSECoreRuntime,
  FilesystemMOSERepository,
  MemoryMOSERepository,
  type Repository,
  policySchema,
  defaultPolicy,
} from "@ate/mose-core";
import { owners, fixture, take, root, type Owners } from "./fixtures.js";
let base: Owners;
beforeAll(async () => {
  base = await owners();
});
for (const [name, raw] of [
  ["null", null],
  ["undefined", undefined],
  ["boolean", true],
  ["number", 42],
  ["array", []],
  ["empty", {}],
  ["NaN", NaN],
  ["infinity", Infinity],
  ["bigint", 1n],
  ["function", () => 0],
  ["date", new Date()],
  ["map", new Map()],
  ["set", new Set()],
] as const)
  it(`native ${name} is rejected without a phantom receipt`, async () => {
    const f = await fixture(base);
    const r = await f.service.dispatch(raw);
    expect(r.ok).toBe(false);
    expect(f.service.diagnostics()).toMatchObject({
      history: 0,
      recoveryObligation: null,
      readiness: "READY",
    });
  });
for (const [name, raw] of [
  ["duplicate-members", '{"kind":"CREATE","kind":"STOP"}'],
  ["nested-duplicate", '{"a":{"x":1,"x":2}}'],
  ["truncated", "{"],
  ["trailing-comma", '{"kind":"STOP",}'],
  ["non-envelope", "[]"],
  ["control-escape", '{"kind":"\\u0000"}'],
  ["surrogate-escape", '{"kind":"\\ud800"}'],
] as const)
  it(`wire ${name} cannot erase evidence or advance history`, async () => {
    const f = await fixture(base);
    expect((await f.service.dispatchJson(raw)).ok).toBe(false);
    expect(f.service.diagnostics().history).toBe(0);
  });
it("hostile getters and proxy traps are never invoked", async () => {
  const f = await fixture(base);
  let calls = 0;
  const accessor = {
    get kind() {
      calls++;
      throw Error("GETTER");
    },
  };
  const proxy = new Proxy(
    {},
    {
      getOwnPropertyDescriptor() {
        calls++;
        throw Error("PROXY");
      },
    },
  );
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const raw of [accessor, proxy, revoked.proxy])
    expect((await f.service.dispatch(raw)).ok).toBe(false);
  expect(calls).toBe(0);
  expect(f.service.diagnostics().history).toBe(0);
});
it("cycles, symbols and sparse arrays cannot be silently normalized", async () => {
  const f = await fixture(base),
    cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  for (const raw of [cycle, { [Symbol("hidden")]: 1 }, { ...f.create(), instruments: Array(2) }])
    expect((await f.service.dispatch(raw)).ok).toBe(false);
});
it("native nesting and physical UTF-8 byte budgets fail before publication", async () => {
  const f = await fixture(base);
  let deep: unknown = {};
  for (let n = 0; n < 30; n++) deep = { child: deep };
  for (const raw of [deep, { ...f.create(), unexpected: "界".repeat(70000) }])
    expect((await f.service.dispatch(raw)).ok).toBe(false);
  expect(f.service.diagnostics().recoveryObligation).toBeNull();
});
it("serialized extra bytes cannot be hidden behind semantic JSON equivalence", async () => {
  const f = await fixture(base);
  const raw = JSON.stringify(f.create()) + " ".repeat(f.policy.maxInputBytes);
  expect((await f.service.dispatchJson(raw)).ok).toBe(false);
});
it("known no-commit rejection preserves clean state and successful retry identity", async () => {
  const actual = new MemoryMOSERepository();
  let first = true;
  const repository: Repository = {
    load: () => actual.load(),
    commit: (c) => {
      if (first) {
        first = false;
        return Promise.resolve({
          ok: false,
          error: { code: "NO_COMMIT", commitment: "NONE", auditCorrelationId: "owner-no-write" },
        });
      }
      return actual.commit(c);
    },
  };
  const f = await fixture(base, {}, repository),
    a = f.create();
  expect(await f.service.dispatch(a)).toMatchObject({ ok: false, error: { commitment: "NONE" } });
  expect(f.service.diagnostics()).toMatchObject({ history: 0, recoveryObligation: null });
  take(await f.service.dispatch(a));
  expect(f.service.diagnostics().history).toBe(1);
});
for (const mode of [
  "throw-after-commit",
  "structured-unknown",
  "malformed-ack",
  "wrong-ack",
] as const)
  it(`${mode} retains real publication debt and physical recovery`, async () => {
    const path = root(),
      actual = new FilesystemMOSERepository(path);
    const repository: Repository = {
      load: () => actual.load(),
      commit: async (c) => {
        take(await actual.commit(c));
        if (mode === "throw-after-commit") throw Error("ACK_LOST");
        if (mode === "structured-unknown")
          return {
            ok: false,
            error: { code: "ACK_LOST", commitment: "UNKNOWN", auditCorrelationId: "test" },
          };
        return {
          ok: true,
          value:
            mode === "wrong-ack"
              ? { ...c, fingerprint: "sha256:" + "0".repeat(64) }
              : ({} as typeof c),
        };
      },
    };
    const f = await fixture(base, {}, repository);
    expect((await f.service.dispatch(f.create())).ok).toBe(false);
    expect(f.service.diagnostics()).toMatchObject({
      lifecycle: "RECOVERY_REQUIRED",
      readiness: "NOT_READY",
      health: "DEGRADED",
    });
    expect((await f.service.stop()).ok).toBe(false);
    expect((await f.service.stop()).ok).toBe(false);
    const reader = new MOSECoreRuntime("mose-lab", { ...f.ports, repository: actual });
    take(await reader.initialize());
    expect(reader.getUniverse("session-A").ok).toBe(true);
    take(await reader.stop());
  });
it("reentrant shutdown during repository callback retains acknowledged publication truth", async () => {
  const actual = new MemoryMOSERepository();
  let stopResult: unknown;
  const repository: Repository = {
    load: () => actual.load(),
    commit: async (c) => {
      stopResult = await service.stop();
      return actual.commit(c);
    },
  };
  const f = await fixture(base, {}, repository);
  const service = f.service;
  const c = take(await service.dispatch(f.create()));
  expect(stopResult).toMatchObject({ ok: false });
  expect(c.generation).toBe(1);
  expect(service.diagnostics()).toMatchObject({
    history: 1,
    lifecycle: "STOPPING",
    readiness: "NOT_READY",
    recoveryObligation: null,
  });
});
it("held initialization canceled by stop preserves nonempty recovery obligation", async () => {
  const path = root(),
    actual = new FilesystemMOSERepository(path),
    f = await fixture(base, {}, actual);
  await f.setup();
  let release: () => void = () => {
    throw Error("NOT_HELD");
  };
  const hold = new Promise<void>((r) => {
    release = r;
  });
  const reader = new MOSECoreRuntime("mose-lab", {
    ...f.ports,
    repository: {
      load: async () => {
        await hold;
        return actual.load();
      },
      commit: (c) => actual.commit(c),
    },
  });
  const pending = reader.initialize();
  expect((await reader.stop()).ok).toBe(false);
  release();
  expect((await pending).ok).toBe(false);
  expect(reader.diagnostics().recoveryObligation).not.toBeNull();
  expect((await reader.stop()).ok).toBe(false);
});
it("honest empty canceled recovery does not invent durable uncertainty", async () => {
  const f = await fixture(base, {}, undefined, false);
  let release: () => void = () => {
    throw Error("NOT_HELD");
  };
  const hold = new Promise<void>((r) => {
    release = r;
  });
  const original = f.ports.repository;
  f.ports.repository = {
    load: async () => {
      await hold;
      return original.load();
    },
    commit: (c) => original.commit(c),
  };
  const pending = f.service.initialize();
  expect((await f.service.stop()).ok).toBe(false);
  release();
  expect(await pending).toMatchObject({ ok: false, error: { commitment: "NONE" } });
  expect(f.service.diagnostics().recoveryObligation).toBeNull();
  take(await f.service.stop());
});
for (const fault of ["truncated", "stray-file", "pending-file", "symlink"] as const)
  it(`physical ${fault} is fenced without successful shutdown`, async () => {
    const path = root(),
      repo = new FilesystemMOSERepository(path),
      f = await fixture(base, {}, repo);
    await f.setup();
    const name = (await readdir(path))[0]!;
    if (fault === "truncated") await writeFile(path + "/" + name, "{");
    if (fault === "stray-file") await writeFile(path + "/unknown", "x");
    if (fault === "pending-file") await writeFile(path + "/" + name + ".pending", "x");
    if (fault === "symlink") await symlink(path + "/" + name, path + "/other");
    const before = await readdir(path),
      reader = new MOSECoreRuntime("mose-lab", { ...f.ports, repository: repo });
    expect((await reader.initialize()).ok).toBe(false);
    expect((await reader.stop()).ok).toBe(false);
    expect(await readdir(path)).toEqual(before);
  });
it("duplicate physical JSON keys cannot preserve a forged semantic readback", async () => {
  const path = root(),
    repo = new FilesystemMOSERepository(path),
    f = await fixture(base, {}, repo);
  await f.setup();
  const name = (await readdir(path))[0]!,
    file = path + "/" + name,
    raw = await readFile(file, "utf8");
  await writeFile(file, raw.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'));
  const reader = new MOSECoreRuntime("mose-lab", { ...f.ports, repository: repo });
  expect((await reader.initialize()).ok).toBe(false);
});
it("normal publication cannot exceed its own declared recovery work budget", async () => {
  const f = await fixture(base, { maxRecoverySteps: 1 });
  await f.setup();
  expect((await f.start()).ok).toBe(false);
  const reader = new MOSECoreRuntime("mose-lab", f.ports);
  take(await reader.initialize());
  expect(reader.getUniverse("session-A").ok).toBe(true);
});
for (const [name, patch] of [
  ["negative-queue", { maxQueued: 0 }],
  ["excessive-depth", { maxInputDepth: 21 }],
  ["multiple-acks", { maxOutstandingAcknowledgments: 2 }],
  ["zero-batch", { maxBatch: 0 }],
  ["unbounded-input", { maxInputBytes: 1073741824 }],
  ["negative-age", { maxEvidenceAgeMs: -1 }],
] as const)
  it(`configuration ${name} is rejected by the governed schema`, () => {
    expect(() => policySchema.parse({ ...defaultPolicy, ...patch })).toThrow();
  });
