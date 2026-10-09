import { it, expect } from "vitest";
import {
  InstrumentRegistry,
  MemoryRegistryRepository,
  defaultPolicy,
  type Result,
  type Revision,
} from "@ate/instrument-registry";
import { VirtualClock } from "@ate/time";
import { setup, effective, time, equity, take } from "./fixtures.js";
it("configuration drift has truthful health without phantom durable uncertainty", async () => {
  const f = await setup();
  take(await f.registry.register(equity()));
  f.setConfiguration(await effective({ ...defaultPolicy, maxAliases: 1 }));
  expect((await f.registry.register(equity("B"))).ok).toBe(false);
  expect(f.registry.diagnostics().readiness).toBe("NOT_READY");
  expect(f.registry.diagnostics().health).toBe("DEGRADED");
  expect(f.registry.diagnostics().recoveryRequired).toBe(false);
  f.setConfiguration(f.config);
  take(await f.registry.register(equity("B")));
  take(await f.registry.stop());
  take(await f.registry.stop());
});
it("source-validation rejection before repository access permits exact governed retry", async () => {
  let config = await effective();
  const original = config;
  let reads = 0;
  const backing = new MemoryRegistryRepository(),
    registry = new InstrumentRegistry("synthetic-registry", {
      clock: new VirtualClock(time),
      configuration: () => config,
      repository: {
        load: () => {
          reads++;
          return backing.load();
        },
        commit: (s) => backing.commit(s),
      },
    });
  config = await effective({ ...defaultPolicy, maxAliases: 1 });
  expect((await registry.initialize()).ok).toBe(false);
  expect(reads).toBe(0);
  expect(registry.diagnostics().recoveryRequired).toBe(false);
  expect(registry.diagnostics().readiness).toBe("NOT_READY");
  config = original;
  take(await registry.initialize());
  take(await registry.register(equity()));
  take(await registry.stop());
  take(await registry.stop());
});
it("a read cannot admit mutation through a reentrant configuration callback", async () => {
  const config = await effective();
  const repository = new MemoryRegistryRepository();
  let hook = false,
    attempt: Promise<Result<Revision>> | undefined;
  const registry: InstrumentRegistry = new InstrumentRegistry("synthetic-registry", {
    clock: new VirtualClock(time),
    repository,
    configuration: () => {
      if (hook) {
        hook = false;
        attempt = registry.register(equity("B"));
      }
      return config;
    },
  });
  take(await registry.initialize());
  take(await registry.register(equity()));
  hook = true;
  expect(take(registry.search())).toHaveLength(1);
  expect(attempt).toBeDefined();
  expect((await attempt!).ok).toBe(false);
  expect(registry.diagnostics().generation).toBe(1);
});
it("reentrant stop during diagnostics rejects at invocation, not after guard release", async () => {
  const config = await effective();
  let hook = false,
    attempt: Promise<Result<void>> | undefined;
  const registry: InstrumentRegistry = new InstrumentRegistry("synthetic-registry", {
    clock: new VirtualClock(time),
    repository: new MemoryRegistryRepository(),
    configuration: () => {
      if (hook) {
        hook = false;
        attempt = registry.stop();
      }
      return config;
    },
  });
  take(await registry.initialize());
  hook = true;
  expect(registry.diagnostics().readiness).toBe("READY");
  expect((await attempt!).ok).toBe(false);
  expect(registry.diagnostics().lifecycle).toBe("READY");
  take(await registry.register(equity()));
});
it("pre-initialization and post-stop writes cannot create provisional artifacts", async () => {
  const config = await effective(),
    repo = new MemoryRegistryRepository(),
    registry = new InstrumentRegistry("synthetic-registry", {
      clock: new VirtualClock(time),
      repository: repo,
      configuration: () => config,
    });
  expect((await registry.register(equity())).ok).toBe(false);
  take(await registry.initialize());
  take(await registry.stop());
  expect((await registry.register(equity())).ok).toBe(false);
  expect(take(await repo.load())).toHaveLength(0);
});
