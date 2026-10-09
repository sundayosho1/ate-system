import { it, expect } from "vitest";
import { defaultPolicy, identityId } from "@ate/instrument-registry";
import { setup, equity, index, take, evidence, time } from "./fixtures.js";
it.each([null, {}, [], "[]", [null], [{}]])(
  "invalid import batch %j has no durable mutation",
  async (raw) => {
    const { registry } = await setup();
    expect((await registry.importRecords(raw)).ok).toBe(false);
    expect(registry.diagnostics().generation).toBe(0);
  },
);
it("permuted input yields identical manifests and outputs", async () => {
  const a = await setup(),
    b = await setup();
  const one = take(await a.registry.importRecords([equity(), equity("B")])),
    two = take(await b.registry.importRecords([equity("B"), equity()]));
  expect(two).toEqual(one);
  expect(take(a.registry.snapshot())).toEqual(take(b.registry.snapshot()));
});
it("idempotent import returns exact original manifest without generation", async () => {
  const { registry } = await setup();
  const first = take(await registry.importRecords([equity()]));
  expect(take(await registry.importRecords([equity()]))).toEqual(first);
  expect(registry.diagnostics().generation).toBe(1);
});
it("conflicting reimport records evidence without overwriting identity", async () => {
  const { registry } = await setup();
  const row = take(await registry.register(equity()));
  const manifest = take(
    await registry.importRecords([{ ...equity(), displayName: "conflicting" }]),
  );
  expect(manifest.outcomes[0]!.status).toBe("CONFLICT");
  expect(take(registry.get(row.instrumentId))).toEqual(row);
  expect(take(registry.conflicts())).toHaveLength(1);
});
it("exact batch capacity accepts and one beyond rejects", async () => {
  const { registry } = await setup({ ...defaultPolicy, maxImportBatch: 2 });
  take(await registry.importRecords([equity(), equity("B")]));
  expect((await registry.importRecords([equity("C"), equity("D"), equity("E")])).ok).toBe(false);
  expect(take(registry.search())).toHaveLength(2);
});
it("same-batch underlying is registered before derivative deterministically", async () => {
  const { registry } = await setup();
  const d = {
    ...equity(),
    identity: {
      family: "OPTION" as const,
      kind: "CALL" as const,
      underlying: identityId(index().identity),
      venue: "X",
      contract: "SYN",
      expiry: time,
      currency: "USD",
      strike: "1",
    },
    classification: "OPTION",
  };
  take(await registry.importRecords([d, index()]));
  expect(take(registry.search())).toHaveLength(2);
});
it("unresolved relation rolls back entire prepared batch", async () => {
  const { registry } = await setup();
  const bad = equity("B");
  bad.relationships = [
    { type: "REFERENCES", target: identityId(index().identity), evidence: evidence() },
  ];
  expect((await registry.importRecords([equity(), bad])).ok).toBe(false);
  expect(registry.diagnostics().generation).toBe(0);
});
