import { it, expect } from "vitest";
import {
  InstrumentSpecifications,
  defaultPolicy,
  MemorySpecificationRepository,
  FilesystemSpecificationRepository,
  ok,
  fail,
} from "@ate/instrument-specifications";
import { fixture, take, declared, effective, root } from "./fixtures.js";
it.each([null, 1, true, "primitive", [], {}, NaN, Infinity])(
  "rejects malformed native envelope %s without touching storage",
  async (raw) => {
    const f = await fixture();
    expect((await f.service.publish(raw)).ok).toBe(false);
    expect(take(await f.repository.load())).toHaveLength(0);
    expect(f.service.diagnostics().pending).toBe(0);
    take(await f.service.publish(f.request()));
  },
);
it.each(['{"schemaVersion":1,"schemaVersion":1}', '{"x":1,}', "[", "null", '{"__proto__":{}}'])(
  "strict JSON rejects %s with no publication",
  async (json) => {
    const f = await fixture();
    expect((await f.service.publishJson(json)).ok).toBe(false);
    expect(take(await f.repository.load())).toHaveLength(0);
  },
);
it.each(["getter", "proxy", "cyclic", "prototype", "symbol", "hole"] as const)(
  "hostile %s cannot escape boundary or execute getter",
  async (mode) => {
    const f = await fixture();
    let calls = 0;
    const r: Record<string, unknown> = structuredClone(f.request());
    if (mode === "getter")
      Object.defineProperty(r, "requestId", {
        get() {
          calls++;
          throw Error("GETTER");
        },
        enumerable: true,
      });
    if (mode === "proxy") {
      const proxy = new Proxy(r, {
        ownKeys() {
          calls++;
          throw Error("TRAP");
        },
      });
      expect((await f.service.publish(proxy)).ok).toBe(false);
    } else {
      if (mode === "cyclic") r["loop"] = r;
      if (mode === "prototype")
        Object.defineProperty(r, "__proto__", { value: {}, enumerable: true });
      if (mode === "symbol") Object.defineProperty(r, Symbol("hidden"), { value: 1 });
      if (mode === "hole") r["holes"] = new Array(3);
      expect((await f.service.publish(r)).ok).toBe(false);
    }
    expect(calls).toBe(0);
    expect(take(await f.repository.load())).toHaveLength(0);
  },
);
it.each(["NaN", "1e100", "0x10", "1.0000000000000000001", "9".repeat(55)])(
  "rejects decimal encoding %s without poisoning identity retry",
  async (value) => {
    const f = await fixture(),
      r = f.request();
    r.metadata.price.tick = declared(value);
    expect((await f.service.publish(r)).ok).toBe(false);
    expect(f.service.diagnostics().pending).toBe(0);
    take(await f.service.publish(f.request()));
  },
);
it.each(["schema", "unknown-field", "timestamp", "state-value", "deep", "unicode"] as const)(
  "fails closed for %s native input",
  async (mode) => {
    const f = await fixture(),
      r = structuredClone(f.request()) as unknown as Record<string, unknown>;
    if (mode === "schema") r["schemaVersion"] = 2;
    if (mode === "unknown-field") r["unknown"] = true;
    if (mode === "timestamp") r["sourceDeclaredAt"] = "2026-99-99";
    if (mode === "state-value")
      (r["metadata"] as Record<string, unknown>)["price"] = {
        tick: { state: "ABSENT", value: "0.1", evidence: "bad" },
      };
    if (mode === "deep") {
      let nested: Record<string, unknown> = {};
      r["nested"] = nested;
      for (let i = 0; i < 25; i++) {
        const next = {};
        nested["next"] = next;
        nested = next;
      }
    }
    if (mode === "unicode") r["rawEvidence"] = "\ud800";
    expect((await f.service.publish(r)).ok).toBe(false);
    expect(take(await f.repository.load())).toHaveLength(0);
  },
);
it.each(["maxSpecifications", "maxRevisions", "maxHistoryDepth"] as const)(
  "enforces exact %s capacity and fresh recovery",
  async (limit) => {
    const p = { ...defaultPolicy, [limit]: 1 },
      f = await fixture(p),
      s = take(await f.service.publish(f.request()));
    expect((await f.service.publish(f.request("over"))).ok).toBe(false);
    expect(take(f.service.snapshot())?.fingerprint).toBe(s.fingerprint);
    const reader = new InstrumentSpecifications("spec-lab", f.ports);
    expect(take(await reader.initialize())?.fingerprint).toBe(s.fingerprint);
  },
);
it.each([
  ["snapshot bytes", { ...defaultPolicy, maxSnapshotBytes: 4096 }],
  ["diagnostics", { ...defaultPolicy, maxDiagnostics: 1 }],
  ["fields", { ...defaultPolicy, maxFields: 1 }],
] as const)("rejects %s capacity before commit", async (_, p) => {
  const f = await fixture(p);
  expect((await f.service.publish(f.request())).ok).toBe(false);
  expect(take(await f.repository.load())).toHaveLength(0);
  expect(f.service.diagnostics().pending).toBe(0);
});
it("tier resource limits apply before repository publication and recovery", async () => {
  const f = await fixture({ ...defaultPolicy, maxPriceTiers: 1 }),
    r = f.request();
  r.metadata.price.tiers = declared([
    {
      lower: "0",
      upper: "1",
      increment: "0.01",
      lowerInclusive: true,
      upperInclusive: false,
      unit: "USD",
    },
    {
      lower: "1",
      upper: "2",
      increment: "0.1",
      lowerInclusive: true,
      upperInclusive: false,
      unit: "USD",
    },
  ]);
  expect((await f.service.publish(r)).ok).toBe(false);
  expect(take(await f.repository.load())).toHaveLength(0);
});
it("rejects configuration and state authority failures before repository calls", async () => {
  let calls = 0;
  const f = await fixture(
    defaultPolicy,
    {
      load: async () => {
        await Promise.resolve();

        calls++;
        return ok([]);
      },
      commit: () => Promise.resolve(fail("NO")),
    },
    false,
  );
  f.setConfig(await effective({ ...defaultPolicy, maxInputDepth: 1 }));
  expect((await f.service.initialize()).ok).toBe(true);
  expect((await f.service.publish(f.request())).ok).toBe(false);
  expect(calls).toBe(1);
});
it("initialization load uncertainty and hostile thrown errors remain structured and fail-closed", async () => {
  const hostile = new Proxy(new Error("injected"), {
    get() {
      throw Error("TRAP");
    },
  });
  const f = await fixture(
    defaultPolicy,
    {
      load: async () => {
        await Promise.resolve();

        throw hostile;
      },
      commit: () => Promise.resolve(fail("NO")),
    },
    false,
  );
  expect((await f.service.initialize()).ok).toBe(false);
  expect(f.service.diagnostics().recoveryRequired).toBe(true);
  expect((await f.service.stop()).ok).toBe(false);
});
it("filesystem byte and history bounds are validated at construction", () => {
  for (const args of [
    [1, 1, 4096],
    [4096, 0, 4096],
    [4096, 1, 1],
  ])
    expect(() => new FilesystemSpecificationRepository(root(), args[0], args[1], args[2])).toThrow(
      "REPOSITORY_BOUNDS",
    );
});
it("same request identity cannot be substituted after publication", async () => {
  const f = await fixture(),
    s = take(await f.service.publish(f.request())),
    r = f.request();
  r.metadata.contract.size = declared("2");
  expect(await f.service.publish(r)).toMatchObject({
    ok: false,
    error: { code: "REQUEST_ID_CONFLICT" },
  });
  expect(take(f.service.snapshot())?.fingerprint).toBe(s.fingerprint);
});
it("stopped upstream mapping cannot admit a specification", async () => {
  const f = await fixture();
  take(await f.mapping.service.stop());
  expect((await f.service.publish(f.request())).ok).toBe(false);
  expect(f.service.diagnostics().readiness).toBe("NOT_READY");
  expect(take(await f.repository.load())).toHaveLength(0);
});
it("configuration reentry cannot create a phantom publication or shutdown success", async () => {
  const f = await fixture();
  const original = f.ports.configuration;
  let nested: unknown;
  const service = new InstrumentSpecifications("spec-reentry", {
    ...f.ports,
    repository: new MemorySpecificationRepository(),
    configuration: () => {
      nested = service.snapshot();
      return original();
    },
  });
  take(await service.initialize());
  expect(nested).toMatchObject({ ok: false });
  expect(service.diagnostics().generation).toBe(0);
});

it("comparison bounds reject one-beyond declared capacity without changing either version", async () => {
  const f = await fixture({ ...defaultPolicy, maxComparisons: 1 }),
    a = take(await f.service.publish(f.request())),
    r = f.request("changed");
  r.metadata.contract.size = declared("2");
  r.metadata.volume.maximum = declared("99");
  const b = take(await f.service.publish(r));
  expect(f.service.compare(a.fingerprint, b.fingerprint)).toMatchObject({
    ok: false,
    error: { code: "COMPARISON_CAPACITY" },
  });
  expect(take(f.service.snapshot(a.fingerprint))).toEqual(a);
  expect(take(f.service.snapshot(b.fingerprint))).toEqual(b);
});
