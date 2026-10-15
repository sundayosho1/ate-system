import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { fingerprint } from "@ate/configuration";
import {
  InstrumentEligibility,
  FilesystemEligibilityRepository,
  MemoryEligibilityRepository,
  ok,
  fail,
  defaultPolicy,
  type Repository,
  type Snapshot,
} from "@ate/instrument-eligibility";
import { fixture, take, root, checker, maker, time, configuration } from "./fixtures.js";
describe("hostile native and wire eligibility boundaries", () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => {
    f = await fixture();
    await f.discover();
  });
  afterAll(async () => {
    await f.service.stop();
  });
  for (const raw of [
    null,
    undefined,
    true,
    42,
    "request",
    [],
    {},
    NaN,
    Infinity,
    1n,
    () => 0,
    new Date(),
    new Map(),
    new Set(),
    Object.create(null) as unknown,
  ])
    it(`rejects non-envelope ${Object.prototype.toString.call(raw)} without mutation`, async () => {
      const n = f.service.diagnostics().history;
      expect((await f.service.publish(raw)).ok).toBe(false);
      expect(f.service.diagnostics().history).toBe(n);
      expect(f.service.diagnostics().readiness).toBe("READY");
    });
  for (const raw of [
    '{"kind":"REQUEST","kind":"DISCOVER"}',
    '{"x":{"x":1,"x":2}}',
    '{"x":1,}',
    "{",
    "[]",
    "null",
    '"x"',
    '{"__proto__":{}}',
    '{"x":"\\ud800"}',
  ])
    it(`rejects hostile JSON ${raw.slice(0, 35)}`, async () => {
      const n = f.service.diagnostics().history;
      expect((await f.service.publishJson(raw)).ok).toBe(false);
      expect(f.service.diagnostics().history).toBe(n);
    });
  it("rejects cyclic objects, accessors and revoked proxies without executing getters", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let calls = 0;
    const getter = {
      get kind() {
        calls++;
        throw Error("getter invoked");
      },
    };
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();
    for (const raw of [
      cyclic,
      getter,
      revocable.proxy,
      new Proxy(
        {},
        {
          ownKeys() {
            throw Error("proxy invoked");
          },
        },
      ),
    ])
      expect((await f.service.publish(raw)).ok).toBe(false);
    expect(calls).toBe(0);
  });
  it("enforces physical UTF-8 bytes, depth and unexpected-field rejection", async () => {
    const r = f.request("MAPPED");
    for (const raw of [
      { ...r, reason: "界".repeat(30000) },
      { ...r, unexpected: true },
      { ...r, reason: "\ud800" },
      { ...r, reason: "a\u0000b" },
    ])
      expect((await f.service.publish(raw)).ok).toBe(false);
    let deep: unknown = {};
    for (let i = 0; i < 25; i++) deep = { nested: deep };
    expect((await f.service.publish(deep)).ok).toBe(false);
  });
  it("rejects sparse arrays and forbidden prototype keys", async () => {
    const r = f.request("MAPPED");
    const a: unknown[] = [];
    a.length = 2;
    expect((await f.service.publish({ ...r, context: { ...r.context, datasets: a } })).ok).toBe(
      false,
    );
    expect((await f.service.publishJson('{"kind":"REQUEST","constructor":{}}')).ok).toBe(false);
  });
});
describe("genuine commitment uncertainty and immutable recovery", () => {
  it("acknowledged bytes followed by thrown callback fence shutdown, then recover from actual filesystem", async () => {
    const repository = new FilesystemEligibilityRepository(root());
    const f = await fixture(undefined, {
      load: () => repository.load(),
      commit: async (s) => {
        take(await repository.commit(s));
        throw Error("AFTER_COMMIT");
      },
    });
    const r = await f.service.discover({
      kind: "DISCOVER",
      id: "one",
      instrumentId: f.context.instrumentId,
      context: f.context,
      maker,
      occurredAt: time,
      effectiveAt: time,
    });
    expect(r).toMatchObject({ ok: false, error: { commitment: "UNKNOWN" } });
    expect(f.service.diagnostics().pending).toMatchObject({ generation: 1 });
    expect((await f.service.stop()).ok).toBe(false);
    expect((await f.service.stop()).ok).toBe(false);
    const fresh = new InstrumentEligibility("eligibility-lab", { ...f.ports, repository });
    take(await fresh.initialize());
    expect(take(await fresh.getEligibility(f.context.instrumentId)).recorded.stage).toBe(
      "DISCOVERED",
    );
    take(await fresh.stop());
  });
  for (const mode of [
    "structured-unknown",
    "malformed-ack",
    "wrong-ack",
    "throw-before-write",
  ] as const)
    it(`${mode} retains unknown obligation and cannot claim success`, async () => {
      const memory = new MemoryEligibilityRepository();
      const repository: Repository = {
        load: () => memory.load(),
        commit: async (s) => {
          await Promise.resolve();
          if (mode === "structured-unknown") return fail("UNKNOWN", "UNKNOWN");
          if (mode === "throw-before-write") throw Error("before");
          if (mode === "wrong-ack") return ok({ ...s, generation: 999 });
          return { ok: true, value: null } as unknown as ReturnType<
            Repository["commit"]
          > extends Promise<infer T>
            ? T
            : never;
        },
      };
      const f = await fixture(undefined, repository);
      expect(
        (
          await f.service.discover({
            kind: "DISCOVER",
            id: "one",
            instrumentId: f.context.instrumentId,
            context: f.context,
            maker,
            occurredAt: time,
            effectiveAt: time,
          })
        ).ok,
      ).toBe(false);
      expect(f.service.diagnostics().readiness).toBe("NOT_READY");
      expect(f.service.diagnostics().pending).not.toBeNull();
      expect((await f.service.stop()).ok).toBe(false);
    });
  it("honest NONE failure permits retry without phantom record", async () => {
    const memory = new MemoryEligibilityRepository();
    let deny = true;
    const f = await fixture(undefined, {
      load: () => memory.load(),
      commit: (s) => (deny ? Promise.resolve(fail("CAPACITY")) : memory.commit(s)),
    });
    const raw = {
      kind: "DISCOVER",
      id: "retry",
      instrumentId: f.context.instrumentId,
      context: f.context,
      maker,
      occurredAt: time,
      effectiveAt: time,
    };
    expect((await f.service.publish(raw)).ok).toBe(false);
    expect(f.service.diagnostics().records).toBe(0);
    expect(f.service.diagnostics().pending).toBeNull();
    deny = false;
    take(await f.service.publish(raw));
    take(await f.service.stop());
    take(await f.service.stop());
  });
  it("concurrent and reentrant operations cannot overtake publication", async () => {
    const memory = new MemoryEligibilityRepository();
    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    let entered: () => void = () => {};
    const signaled = new Promise<void>((r) => {
      entered = r;
    });
    const f = await fixture(undefined, {
      load: () => memory.load(),
      commit: async (s) => {
        entered();
        await held;
        return memory.commit(s);
      },
    });
    const pending = f.discover();
    await signaled;
    expect((await f.service.requestTransition(f.request("MAPPED"))).ok).toBe(false);
    expect((await f.service.stop()).ok).toBe(false);
    release();
    await pending;
    expect(f.service.diagnostics().history).toBe(1);
    expect(f.service.diagnostics().readiness).toBe("NOT_READY");
    take(await f.service.stop());
  });
  for (const corruption of [
    "hash",
    "generation",
    "previous",
    "decision",
    "service",
    "certificate",
  ] as const)
    it(`detects ${corruption} history corruption on fresh instance`, async () => {
      const memory = new MemoryEligibilityRepository();
      const f = await fixture(undefined, memory);
      await f.discover();
      await f.promote("MAPPED");
      const loaded = take(await memory.load()) as Snapshot[];
      const rows = structuredClone(loaded);
      const s = rows.at(-1)!;
      if (corruption === "hash") s.fingerprint = "sha256:" + "0".repeat(64);
      if (corruption === "generation") s.generation = 99;
      if (corruption === "previous") s.previous = null;
      if (corruption === "service") s.serviceId = "foreign";
      if (corruption === "decision") s.assessment!.allowed = false;
      if (corruption === "certificate") s.certificates = [];
      if (corruption !== "hash") {
        const { fingerprint: ignored, ...body } = s;
        void ignored;
        s.fingerprint = fingerprint(body);
      }
      const fresh = new InstrumentEligibility("eligibility-lab", {
        ...f.ports,
        repository: { load: () => Promise.resolve(ok(rows)), commit: (s) => memory.commit(s) },
      });
      expect((await fresh.initialize()).ok).toBe(false);
      expect(fresh.diagnostics().readiness).toBe("NOT_READY");
      expect((await fresh.stop()).ok).toBe(false);
    });
  it("rejects root and generation symlink substitution", async () => {
    const actual = root(),
      parent = root(),
      link = join(parent, "alias");
    await symlink(actual, link);
    expect((await new FilesystemEligibilityRepository(link).load()).ok).toBe(false);
    await writeFile(join(actual, "original.json"), "{}");
    const other = root();
    await symlink(join(actual, "original.json"), join(other, "generation-00000001.json"));
    expect((await new FilesystemEligibilityRepository(other).load()).ok).toBe(false);
  });
  it("rejects interrupted publication markers, generation gaps and duplicate wire keys", async () => {
    for (const [name, content] of [
      ["generation-00000001.json.pending", "{}"],
      ["generation-00000002.json", "{}"],
      ["generation-00000001.json", '{"a":1,"a":2}'],
    ]) {
      const path = root();
      await writeFile(join(path, name!), content!);
      expect((await new FilesystemEligibilityRepository(path).load()).ok).toBe(false);
    }
  });
  it("preserves original bytes across repeat recovery and read-only history queries", async () => {
    const path = root(),
      repository = new FilesystemEligibilityRepository(path);
    const f = await fixture(undefined, repository);
    await f.toResearch();
    take(await f.service.stop());
    const file = join(path, "generation-00000001.json"),
      before = await readFile(file);
    for (let i = 0; i < 2; i++) {
      const fresh = new InstrumentEligibility("eligibility-lab", f.ports);
      take(await fresh.initialize());
      take(fresh.historicalEligibility({ instrumentId: f.context.instrumentId, asOf: time }));
      take(await fresh.stop());
    }
    expect(await readFile(file)).toEqual(before);
  });
  it("recovery enforces current budgets without truncating accepted history", async () => {
    const f = await fixture();
    await f.toResearch();
    const lower = await configuration(
      { ...f.policy, maxHistory: 2, maxRecoverySteps: 2 },
      f.ports.clock,
    );
    const fresh = new InstrumentEligibility("eligibility-lab", {
      ...f.ports,
      configuration: () => lower,
    });
    expect((await fresh.initialize()).ok).toBe(false);
    expect(fresh.diagnostics().history).toBe(0);
  });
  it("disallows unavailable recovery and changed authority certificates", async () => {
    const f = await fixture();
    await f.discover();
    await f.promote("MAPPED");
    const fresh = new InstrumentEligibility("eligibility-lab", {
      ...f.ports,
      authorityResolver: {
        resolve: () => {
          throw Error("REVOKED");
        },
      },
    });
    expect((await fresh.initialize()).ok).toBe(false);
    const absent = new InstrumentEligibility("eligibility-lab", {
      ...f.ports,
      repository: {
        load: () => Promise.resolve(fail("UNAVAILABLE", "UNKNOWN")),
        commit: (s) => f.repository.commit(s),
      },
    });
    expect((await absent.initialize()).ok).toBe(false);
  });
  it("exact history limit rejects one beyond without storage calls", async () => {
    const p = { ...defaultPolicy, maxHistory: 1, maxRecoverySteps: 1 };
    const f = await fixture(p);
    await f.discover();
    expect((await f.service.requestTransition(f.request("MAPPED"))).ok).toBe(false);
    expect(f.service.diagnostics().history).toBe(1);
  });
  it("low-level COMMIT cannot bypass approval", async () => {
    const f = await fixture();
    await f.discover();
    const r = f.request("MAPPED");
    take(await f.service.requestTransition(r));
    expect(
      (
        await f.service.publish({
          kind: "COMMIT",
          id: "bypass",
          requestId: r.id,
          approvalId: "fabricated",
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await f.service.approveTransition({
          kind: "APPROVE",
          id: "self",
          requestId: r.id,
          checker: maker,
        })
      ).ok,
    ).toBe(false);
    take(
      await f.service.approveTransition({ kind: "APPROVE", id: "legit", requestId: r.id, checker }),
    );
  });
});
it("pre-repository initialization rejection carries no fabricated durable uncertainty", async () => {
  const f = await fixture();
  let calls = 0;
  const denied = new InstrumentEligibility("eligibility-lab", {
    ...f.ports,
    configuration: () => {
      throw Error("POLICY_REQUIRED");
    },
    repository: {
      load: () => {
        calls++;
        return Promise.resolve(ok([]));
      },
      commit: (s) => f.repository.commit(s),
    },
  });
  expect(await denied.initialize()).toMatchObject({ ok: false, error: { commitment: "NONE" } });
  expect(calls).toBe(0);
  expect(denied.diagnostics().pending).toBeNull();
  take(await denied.stop());
  take(await denied.stop());
});
it("honest empty recovery permits truthful cancellation while unknown recovery remains protected", async () => {
  const f = await fixture();
  const service: InstrumentEligibility = new InstrumentEligibility("eligibility-lab", {
    ...f.ports,
    repository: {
      load: async () => {
        const stop = await service.stop();
        expect(stop.ok).toBe(false);
        return ok([]);
      },
      commit: (s) => f.repository.commit(s),
    },
  });
  expect(await service.initialize()).toMatchObject({ ok: false, error: { commitment: "NONE" } });
  expect(service.diagnostics().pending).toBeNull();
  take(await service.stop());
  take(await service.stop());
});
