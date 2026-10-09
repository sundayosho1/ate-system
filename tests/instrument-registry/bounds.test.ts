import { it, expect } from "vitest";
import { validatePolicy, defaultPolicy } from "@ate/instrument-registry";
import { setup, equity, evidence, take, effective } from "./fixtures.js";
it.each([
  "maxAliases",
  "maxRelationships",
  "maxRevisions",
  "maxImportBatch",
  "maxCandidates",
  "maxQueryResults",
  "maxInstruments",
  "maxSnapshots",
  "maxConflicts",
  "maxImports",
] as const)("policy rejects zero %s", (key) => {
  expect(() => validatePolicy({ ...defaultPolicy, [key]: 0 })).toThrow();
});
it("registry capacity is reserved before write", async () => {
  const { registry } = await setup({ ...defaultPolicy, maxInstruments: 1 });
  take(await registry.register(equity()));
  expect((await registry.register(equity("B"))).ok).toBe(false);
  expect(registry.diagnostics().generation).toBe(1);
});
it("snapshot capacity failure preserves last ACK and clean shutdown", async () => {
  const { registry } = await setup({ ...defaultPolicy, maxSnapshots: 1 });
  take(await registry.register(equity()));
  expect((await registry.register(equity("B"))).ok).toBe(false);
  expect(registry.diagnostics().generation).toBe(1);
  take(await registry.stop());
});
it("alias bound rejects before persistence", async () => {
  const { registry } = await setup({ ...defaultPolicy, maxAliases: 1 });
  const d = equity();
  d.aliases = [
    { value: "A", scope: "X", kind: "SYMBOL", rule: "EXACT", evidence: evidence() },
    { value: "B", scope: "X", kind: "SYMBOL", rule: "EXACT", evidence: evidence() },
  ];
  expect((await registry.register(d)).ok).toBe(false);
  expect(registry.diagnostics().generation).toBe(0);
});
it("governed configuration drift never mutates existing registry", async () => {
  const f = await setup();
  take(await f.registry.register(equity()));
  f.setConfiguration(await effective({ ...defaultPolicy, maxAliases: 1 }));
  expect((await f.registry.register(equity("B"))).ok).toBe(false);
  expect(f.registry.diagnostics().generation).toBe(1);
});
it("total retained generations are bounded before ACK, preserving fresh recovery", async () => {
  const policy = { ...defaultPolicy, maxRetainedSnapshotBytes: 4096 };
  const f = await setup(policy);
  take(await f.registry.register(equity()));
  expect((await f.registry.register(equity("B"))).ok).toBe(false);
  expect(f.registry.diagnostics().generation).toBe(1);
  const fresh = await setup(policy, f.repository);
  expect(take(fresh.registry.search())).toHaveLength(1);
});
