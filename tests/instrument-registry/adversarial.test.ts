import { it, expect } from "vitest";
import {
  InstrumentRegistry,
  MemoryRegistryRepository,
  ok,
  defaultPolicy,
} from "@ate/instrument-registry";
import { setup, equity, take, effective, time } from "./fixtures.js";
import { VirtualClock } from "@ate/time";
it.each(
  [
    null,
    true,
    42,
    "ticker",
    [],
    { family: "EQUITY" },
    new Date(),
    new Map(),
    Object.create({ inherited: true }) as unknown,
    {
      get displayName() {
        throw Error("hostile");
      },
    },
    new Proxy(
      {},
      {
        get() {
          throw Error("proxy");
        },
      },
    ),
  ].map((raw, i) => [i, () => raw] as const),
)("hostile native registration case %i is safely rejected", async (_i, make) => {
  const { registry } = await setup();
  expect((await registry.register(make())).ok).toBe(false);
  take(await registry.register(equity()));
  expect(registry.diagnostics().generation).toBe(1);
});
it("circular native input is bounded without recursion escape", async () => {
  const { registry } = await setup();
  const d: Record<string, unknown> = {};
  d.self = d;
  expect((await registry.register(d)).ok).toBe(false);
  expect(registry.diagnostics().generation).toBe(0);
});
it("prototype pollution payload cannot mutate Object.prototype", async () => {
  const { registry } = await setup();
  const d = JSON.parse('{"__proto__":{"polluted":true}}') as unknown;
  expect((await registry.register(d)).ok).toBe(false);
  expect(Object.prototype).not.toHaveProperty("polluted");
});
it("payload limit prevents oversized source evidence", async () => {
  const { registry } = await setup({ ...defaultPolicy, maxRecordBytes: 256 });
  expect((await registry.register(equity())).ok).toBe(false);
  expect(registry.diagnostics().generation).toBe(0);
});
it("held commit fences reads, reentrant admission and shutdown", async () => {
  const cfg = await effective(),
    clock = new VirtualClock(time),
    backing = new MemoryRegistryRepository();
  let release: () => void = () => {
    throw Error("NOT_ENTERED");
  };
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const registry = new InstrumentRegistry("synthetic-registry", {
    clock,
    configuration: () => cfg,
    repository: {
      load: () => backing.load(),
      commit: async (s) => {
        await held;
        return backing.commit(s);
      },
    },
  });
  take(await registry.initialize());
  const pending = registry.register(equity());
  expect(registry.diagnostics().busy).toBe(true);
  expect(registry.search().ok).toBe(false);
  expect((await registry.stop()).ok).toBe(false);
  expect((await registry.register(equity("B"))).ok).toBe(false);
  release();
  take(await pending);
  take(await registry.stop());
  take(await registry.stop());
});
it("rejected read during startup does not expose partial state", async () => {
  const cfg = await effective();
  const registry: InstrumentRegistry = new InstrumentRegistry("synthetic-registry", {
    clock: new VirtualClock(time),
    configuration: () => cfg,
    repository: {
      load: async () => {
        expect(registry.search().ok).toBe(false);
        expect((await registry.stop()).ok).toBe(false);
        return ok([]);
      },
      commit: (s) => Promise.resolve(ok(s)),
    },
  });
  take(await registry.initialize());
  take(await registry.register(equity()));
});
it("sparse and extra-property arrays cannot silently change import meaning", async () => {
  const { registry } = await setup();
  const sparse: unknown[] = [];
  sparse.length = 3;
  sparse[0] = equity();
  sparse[2] = equity("B");
  expect((await registry.importRecords(sparse)).ok).toBe(false);
  const extra = [equity()];
  Object.defineProperty(extra, "extra", { value: equity("B"), enumerable: true });
  expect((await registry.importRecords(extra)).ok).toBe(false);
  expect(registry.diagnostics().generation).toBe(0);
});
it("symbol metadata cannot be silently stripped from registry evidence", async () => {
  const { registry } = await setup();
  const d = equity();
  Object.defineProperty(d, Symbol("hidden"), { value: "uninterpreted" });
  expect((await registry.register(d)).ok).toBe(false);
});
