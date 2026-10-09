import { it, expect } from "vitest";
import { normalize, prepare, defaultPolicy, validateIdentifier } from "@ate/instrument-registry";
import { equity, evidence } from "./fixtures.js";
it.each([
  [" whitespace ", "EXACT", "whitespace"],
  ["cafe\u0301", "EXACT", "café"],
  ["eur", "CASE", "EUR"],
  ["eur/usd", "PAIR", "EURUSD"],
  ["EUR-USD", "PAIR", "EURUSD"],
  ["BTC/USD", "EXACT", "BTC/USD"],
  [" abc ", "CASE", "ABC"],
  ["a.b", "CASE", "A.B"],
  ["USD/EUR", "PAIR", "USDEUR"],
  ["Wrapped Token", "EXACT", "Wrapped Token"],
] as const)("scoped normalization %s/%s", (input, rule, expected) => {
  const r = normalize(input, rule);
  expect(r.value).toBe(expected);
  expect(r.original).toBe(input);
  expect(normalize(r.value, rule).value).toBe(expected);
});
it.each(["", "  ", "\0hostile", "x".repeat(257), null])(
  "rejects malformed normalization %j",
  (v) => {
    expect(normalize(v, "CASE").status).toBe("INVALID");
  },
);
it("normalized claims retain original source assertions", () => {
  const d = equity();
  d.aliases = [
    { value: " abc ", scope: "XTEST", kind: "SYMBOL", rule: "CASE", evidence: evidence(" abc ") },
  ];
  const p = prepare(d, defaultPolicy);
  expect(p.definition.aliases[0]!.value).toBe("ABC");
  expect(p.definition.aliases[0]!.evidence.originalValue).toBe(" abc ");
  expect(p.normalization.some((n) => n.original === " abc ")).toBe(true);
});
it("ISIN formatting never overrides checksum qualification", () => {
  expect(() => validateIdentifier("ISIN", "US0378331005", defaultPolicy)).not.toThrow();
  expect(() => validateIdentifier("ISIN", "US0378331004", defaultPolicy)).toThrow();
});
it("synthetic FIGI checksum verifies formatting without proving identity", () => {
  expect(() => validateIdentifier("FIGI", "ZZG000000008", defaultPolicy)).not.toThrow();
});
it.each(["ZZG000000009", "ZZG000000A08", "BSG000000008"])(
  "malformed synthetic FIGI %s rejects",
  (value) => {
    expect(() => validateIdentifier("FIGI", value, defaultPolicy)).toThrow();
  },
);
