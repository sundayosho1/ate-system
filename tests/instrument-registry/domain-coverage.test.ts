import { mustParseUtc } from "@ate/time";
import { it, expect } from "vitest";
import { identityId, type Identity, type InstrumentDefinition } from "@ate/instrument-registry";
import { setup, equity, index, take, time, evidence } from "./fixtures.js";
const underlying = identityId(index().identity);
const identities: Identity[] = [
  { family: "FX", kind: "SPOT", base: "EUR", quote: "USD", settlement: "SPOT" },
  { family: "OTHER", kind: "CURRENCY", namespace: "ISO", key: "EUR" },
  { family: "FX", kind: "FORWARD", base: "EUR", quote: "USD", settlement: "2026-12-01" },
  {
    family: "EQUITY",
    kind: "DEPOSITARY_RECEIPT",
    issuer: "synthetic-issuer",
    shareClass: "ADR",
    venue: "XTEST",
  },
  { family: "COMMODITY", kind: "PHYSICAL", reference: "GOLD", grade: "999", location: "SYN" },
  { family: "COMMODITY", kind: "SYNTHETIC", reference: "GOLD", grade: "999", location: "SYN" },
  { family: "FUTURE", kind: "EXPIRING", underlying, venue: "X", contract: "GOLD", expiry: time },
  {
    family: "FUTURE",
    kind: "EXPIRING",
    underlying,
    venue: "X",
    contract: "GOLD",
    expiry: mustParseUtc("2026-12-01T00:00:00.000Z"),
  },
  {
    family: "FUTURE",
    kind: "CONTINUOUS",
    underlying,
    venue: "X",
    contract: "GOLD",
    seriesRule: "ROLL1",
  },
  { family: "DIGITAL", kind: "PAIR", network: "N1", asset: "TOKEN", quote: "USD", venue: "X1" },
  { family: "DIGITAL", kind: "PAIR", network: "N1", asset: "TOKEN", quote: "USD", venue: "X2" },
  { family: "DIGITAL", kind: "TOKEN", network: "N2", asset: "TOKEN" },
  {
    family: "BOND",
    kind: "GOVERNMENT",
    issuer: "SYN",
    issuance: "ISSUE1",
    maturity: time,
    currency: "USD",
    coupon: "2",
    seniority: "SENIOR",
  },
  {
    family: "BOND",
    kind: "GOVERNMENT",
    issuer: "SYN",
    issuance: "ISSUE1",
    maturity: time,
    currency: "EUR",
    coupon: "2",
    seniority: "SENIOR",
  },
  {
    family: "BOND",
    kind: "GOVERNMENT",
    issuer: "SYN",
    issuance: "ISSUE1",
    maturity: time,
    currency: "USD",
    coupon: "3",
    seniority: "SENIOR",
  },
  {
    family: "BOND",
    kind: "GOVERNMENT",
    issuer: "SYN",
    issuance: "ISSUE1",
    maturity: time,
    currency: "USD",
    coupon: "2",
    seniority: "SUBORDINATE",
  },
  {
    family: "OPTION",
    kind: "CALL",
    underlying,
    venue: "X",
    contract: "O",
    expiry: time,
    currency: "USD",
    strike: "100",
  },
  {
    family: "OPTION",
    kind: "CALL",
    underlying,
    venue: "X",
    contract: "O",
    expiry: time,
    currency: "USD",
    strike: "101",
  },
  { family: "RATE", kind: "REFERENCE_RATE", administrator: "SYN", rate: "OVERNIGHT", tenor: "1D" },
  { family: "OTHER", kind: "EXTENSION", namespace: "RESEARCH", key: "NONPRODUCTION1" },
];
it.each(identities)("economic family coverage registers distinct %j", async (identity) => {
  const { registry } = await setup();
  take(await registry.register(index()));
  const d: InstrumentDefinition = { ...equity(), identity, classification: identity.family };
  const row = take(await registry.register(d));
  expect(row.instrumentId).toBe(identityId(identity));
  expect(row.instrumentId).not.toBe(underlying);
  expect(new Set(identities.map(identityId)).size).toBe(identities.length);
});
it("equivalent decimal spelling has one identity with original trace", async () => {
  const { registry } = await setup();
  take(await registry.register(index()));
  const identity = identities.find((i) => i.family === "OPTION")!;
  if (identity.family !== "OPTION") throw Error("FIXTURE");
  const d = { ...equity(), identity: { ...identity, strike: "100.00" }, classification: "OPTION" };
  const r = take(await registry.register(d));
  expect(r.instrumentId).toBe(identityId({ ...identity, strike: "100" }));
  expect(r.normalization.some((n) => n.original === "100.00" && n.value === "100")).toBe(true);
});
it("contradictory same-batch identity cannot silently select first candidate", async () => {
  const { registry } = await setup();
  expect(
    (await registry.importRecords([equity(), { ...equity(), displayName: "conflict" }])).ok,
  ).toBe(false);
  expect(take(registry.search())).toHaveLength(0);
  expect(registry.diagnostics().generation).toBe(0);
});
it("future-dated source evidence rejects before commitment", async () => {
  const { registry } = await setup();
  const d = equity();
  d.evidence = [
    {
      ...evidence(),
      timeAuthority: "SOURCE_ASSERTED",
      observedAt: mustParseUtc("2026-10-10T09:00:00.000Z"),
    },
  ];
  expect((await registry.register(d)).ok).toBe(false);
  expect(registry.diagnostics().generation).toBe(0);
});
it("offline JSON import rejects malformed then admits valid retry", async () => {
  const { registry } = await setup();
  expect((await registry.importJson("{")).ok).toBe(false);
  take(await registry.importJson(JSON.stringify([equity()])));
  expect(take(registry.search())).toHaveLength(1);
});
