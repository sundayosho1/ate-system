import { it, expect } from "vitest";
import { identityId, type InstrumentDefinition } from "@ate/instrument-registry";
import { setup, equity, index, evidence, take, time } from "./fixtures.js";
it.each([
  "RELATED_INSTRUMENT",
  "REFERENCES",
  "DERIVED_FROM",
  "SHARE_CLASS_OF",
  "REPLACES",
] as const)("typed %s relations retain distinct identities", async (type) => {
  const { registry } = await setup();
  const a = take(await registry.register(equity()));
  const d = equity("B");
  d.relationships = [{ type, target: a.instrumentId, evidence: evidence() }];
  const b = take(await registry.register(d));
  expect(b.instrumentId).not.toBe(a.instrumentId);
  expect(take(registry.relationships(b.instrumentId))[0]!.target).toBe(a.instrumentId);
});
it("TRACKS_INDEX links a fund without conflating identities", async () => {
  const { registry } = await setup();
  const a = take(await registry.register(index()));
  const d: InstrumentDefinition = {
    ...equity(),
    identity: { family: "FUND", kind: "ETF", fund: "SYN", shareClass: "A", venue: "X" },
    classification: "FUND",
    relationships: [{ type: "TRACKS_INDEX", target: a.instrumentId, evidence: evidence() }],
  };
  expect(take(await registry.register(d)).instrumentId).not.toBe(a.instrumentId);
});
it("derivative identity requires a known underlying", async () => {
  const { registry } = await setup();
  const underlying = identityId(index().identity);
  const d: InstrumentDefinition = {
    ...equity(),
    identity: {
      family: "OPTION",
      kind: "CALL",
      underlying,
      venue: "X",
      contract: "SYN",
      expiry: time,
      currency: "USD",
      strike: "100",
    },
    classification: "OPTION",
  };
  expect((await registry.register(d)).ok).toBe(false);
  take(await registry.register(index()));
  expect(take(await registry.register(d)).instrumentId).not.toBe(underlying);
});
it("missing graph target fails without mutation", async () => {
  const { registry } = await setup();
  const d = equity();
  d.relationships = [
    { type: "REFERENCES", target: identityId(equity("B").identity), evidence: evidence() },
  ];
  expect((await registry.register(d)).ok).toBe(false);
  expect(take(registry.search())).toHaveLength(0);
});
it("invalid self reference rejects", async () => {
  const { registry } = await setup();
  const d = equity();
  d.relationships = [
    { type: "RELATED_INSTRUMENT", target: identityId(d.identity), evidence: evidence() },
  ];
  expect((await registry.register(d)).ok).toBe(false);
});
it("semantic derived cycle rejects while references cycle is allowed", async () => {
  const { registry } = await setup();
  const a = take(await registry.register(equity()));
  const b = equity("B");
  b.relationships = [{ type: "DERIVED_FROM", target: a.instrumentId, evidence: evidence() }];
  const br = take(await registry.register(b));
  const next = equity();
  next.relationships = [{ type: "DERIVED_FROM", target: br.instrumentId, evidence: evidence() }];
  expect((await registry.revise(a.instrumentId, a.revisionId, next, "cycle")).ok).toBe(false);
  next.relationships[0]!.type = "REFERENCES";
  const ar = take(await registry.revise(a.instrumentId, a.revisionId, next, "reference"));
  b.relationships[0]!.type = "REFERENCES";
  take(await registry.revise(br.instrumentId, br.revisionId, b, "reference"));
  expect(take(registry.get(ar.instrumentId))).toBeDefined();
});
it("incompatible relationship endpoints reject", async () => {
  const { registry } = await setup();
  const a = take(await registry.register(equity()));
  const b = equity("B");
  b.relationships = [{ type: "TRACKS_INDEX", target: a.instrumentId, evidence: evidence() }];
  expect((await registry.register(b)).ok).toBe(false);
});
