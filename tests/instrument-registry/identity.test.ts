import { it, expect } from "vitest";
import {
  identityId,
  identitySchema,
  prepare,
  defaultPolicy,
  type Identity,
} from "@ate/instrument-registry";
import { equity, index, setup, take, time } from "./fixtures.js";
const id = identityId(index().identity);
const changes: Identity[] = [
  { ...equity().identity, shareClass: "B" } as Identity,
  { ...equity().identity, venue: "OTHER" } as Identity,
  { ...equity().identity, issuer: "other" } as Identity,
  { family: "FX", kind: "SPOT", base: "EUR", quote: "USD", settlement: "SPOT" },
  { family: "FX", kind: "SPOT", base: "USD", quote: "EUR", settlement: "SPOT" },
  {
    family: "BOND",
    kind: "CORPORATE",
    issuer: "issuer",
    issuance: "ONE",
    maturity: time,
    currency: "USD",
    coupon: "2.5",
    seniority: "SENIOR",
  },
  {
    family: "FUTURE",
    kind: "EXPIRING",
    underlying: id,
    venue: "XTEST",
    contract: "F1",
    expiry: time,
  },
  {
    family: "FUTURE",
    kind: "CONTINUOUS",
    underlying: id,
    venue: "XTEST",
    contract: "F1",
    seriesRule: "ROLL1",
  },
  {
    family: "OPTION",
    kind: "CALL",
    underlying: id,
    venue: "XTEST",
    contract: "O1",
    expiry: time,
    currency: "USD",
    strike: "100",
  },
  {
    family: "OPTION",
    kind: "PUT",
    underlying: id,
    venue: "XTEST",
    contract: "O1",
    expiry: time,
    currency: "USD",
    strike: "100",
  },
  { family: "DIGITAL", kind: "NATIVE", network: "NET1", asset: "TOKEN" },
  { family: "DIGITAL", kind: "WRAPPED", network: "NET2", asset: "TOKEN" },
];
it.each(changes)("identity discriminators remain independent: %j", (identity) => {
  const parsed = identitySchema.parse(identity);
  expect(identityId(parsed)).toBe(identityId({ ...parsed }));
  expect(identityId(parsed)).not.toBe(id);
  expect(new Set(changes.map(identityId)).size).toBe(changes.length);
});
it("display rename leaves opaque identity stable through a real revision", async () => {
  const { registry } = await setup();
  const before = take(await registry.register(equity()));
  const d = { ...equity(), displayName: "Renamed synthetic share" };
  const after = take(
    await registry.revise(before.instrumentId, before.revisionId, d, "display metadata correction"),
  );
  expect(after.instrumentId).toBe(before.instrumentId);
  expect(after.revisionId).not.toBe(before.revisionId);
});
it("partial candidate cannot be falsely verified", () => {
  expect(() =>
    prepare(
      {
        ...equity(),
        identity: { family: "OTHER", kind: "PROVISIONAL", namespace: "research", key: "candidate" },
        classification: "OTHER",
        qualification: "VERIFIED",
      },
      defaultPolicy,
    ),
  ).toThrow("PROVISIONAL");
});
it("ticker alone cannot form economic identity", () => {
  expect(() => identitySchema.parse({ family: "EQUITY", ticker: "ABC" })).toThrow();
});
