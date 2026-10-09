import { it, expect } from "vitest";
import { VirtualClock } from "@ate/time";
import {
  InstrumentRegistry,
  MemoryRegistryRepository,
  type InstrumentDefinition,
  type Evidence,
} from "@ate/instrument-registry";
import { effective, time, equity, evidence, take } from "./fixtures.js";
function verified(): InstrumentDefinition {
  const d = equity();
  d.evidence = [{ ...evidence(), sourceType: "RECOGNIZED_AUTHORITY", verification: "VERIFIED" }];
  d.qualification = "VERIFIED";
  return d;
}
it.each([false, true])(
  "trusted offline owner certificate result %s controls qualification",
  async (accepted) => {
    const cfg = await effective(),
      repo = new MemoryRegistryRepository();
    let calls = 0;
    const registry = new InstrumentRegistry("synthetic-registry", {
      clock: new VirtualClock(time),
      repository: repo,
      configuration: () => cfg,
      verifyEvidence: (e, d) => {
        calls++;
        expect(e.sourceId).toBe("fixture");
        expect(d.identity.family).toBe("EQUITY");
        return accepted;
      },
    });
    take(await registry.initialize());
    expect((await registry.register(verified())).ok).toBe(accepted);
    expect(calls).toBe(1);
    expect(registry.diagnostics().generation).toBe(accepted ? 1 : 0);
  },
);
it("verification callback rejection cannot create a provisional durable obligation", async () => {
  const cfg = await effective(),
    repo = new MemoryRegistryRepository(),
    registry = new InstrumentRegistry("synthetic-registry", {
      clock: new VirtualClock(time),
      repository: repo,
      configuration: () => cfg,
      verifyEvidence: () => {
        throw Error("MISSING_OFFLINE_CERTIFICATE");
      },
    });
  take(await registry.initialize());
  expect((await registry.register(verified())).ok).toBe(false);
  expect(registry.diagnostics().recoveryRequired).toBe(false);
  expect(take(await repo.load())).toHaveLength(0);
  take(await registry.register(equity()));
  take(await registry.stop());
});
it("verified stored claims require the trusted verifier again during fresh recovery", async () => {
  const cfg = await effective(),
    repo = new MemoryRegistryRepository();
  const ports = {
    clock: new VirtualClock(time),
    repository: repo,
    configuration: () => cfg,
    verifyEvidence: (_e: Evidence, _d: InstrumentDefinition) => true,
  };
  const registry = new InstrumentRegistry("synthetic-registry", ports);
  take(await registry.initialize());
  take(await registry.register(verified()));
  const without = new InstrumentRegistry("synthetic-registry", {
    clock: ports.clock,
    repository: repo,
    configuration: () => cfg,
  });
  expect((await without.initialize()).ok).toBe(false);
  expect(without.diagnostics().recoveryRequired).toBe(true);
  const fresh = new InstrumentRegistry("synthetic-registry", ports);
  take(await fresh.initialize());
  expect(take(fresh.search())).toHaveLength(1);
});
it("trusted verification receives frozen definitions during admission and recovery", async () => {
  const cfg = await effective(),
    repo = new MemoryRegistryRepository();
  let calls = 0;
  const ports = {
    clock: new VirtualClock(time),
    repository: repo,
    configuration: () => cfg,
    verifyEvidence: (e: Evidence, d: InstrumentDefinition) => {
      calls++;
      expect(Object.isFrozen(d)).toBe(true);
      expect(Object.isFrozen(d.identity)).toBe(true);
      expect(Object.isFrozen(e)).toBe(true);
      return true;
    },
  };
  const registry = new InstrumentRegistry("synthetic-registry", ports);
  take(await registry.initialize());
  take(await registry.register(verified()));
  const fresh = new InstrumentRegistry("synthetic-registry", ports);
  take(await fresh.initialize());
  expect(calls).toBe(2);
});
it("unverified identity cannot self-certify evidenced external timestamps", async () => {
  const cfg = await effective(),
    registry = new InstrumentRegistry("synthetic-registry", {
      clock: new VirtualClock(time),
      repository: new MemoryRegistryRepository(),
      configuration: () => cfg,
    });
  take(await registry.initialize());
  const d = equity();
  d.evidence = [{ ...evidence(), timeAuthority: "EVIDENCED", observedAt: time }];
  expect((await registry.register(d)).ok).toBe(false);
  expect(registry.diagnostics().generation).toBe(0);
});
