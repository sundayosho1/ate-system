import { it, expect } from "vitest";
import { canonical, fingerprint } from "../../packages/mose-opportunities/src/canonical.js";
import { Budget } from "../../packages/mose-opportunities/src/validation.js";
import { O1 } from "../../packages/mose-opportunities/src/policy.js";
import { digest, id, keySchema } from "../../packages/mose-opportunities/src/contracts.js";
import { createHash } from "node:crypto";
it("canonical ordering is codepoint based", () =>
  expect(canonical({ z: 1, a: 2 })).toBe('{"a":2,"z":1}'));
it("fingerprint agrees with independently assembled domain bytes", () =>
  expect(fingerprint("test", { b: 2, a: 1 })).toBe(
    "sha256:" + createHash("sha256").update('test\n{"a":1,"b":2}').digest("hex"),
  ));
it("different domains cannot alias", () =>
  expect(fingerprint("one", {})).not.toBe(fingerprint("two", {})));
it("canonical numbers do not coerce strings", () =>
  expect(fingerprint("test", 1)).not.toBe(fingerprint("test", "1")));
for (const [name, value] of [
  ["undefined", undefined],
  ["bigint", 1n],
  ["function", () => 1],
  ["symbol", Symbol("x")],
  ["NaN", NaN],
  ["positive infinity", Infinity],
  ["negative infinity", -Infinity],
  ["sparse array", Array(1)],
  ["date", new Date(0)],
  ["map", new Map()],
  ["set", new Set()],
] as const)
  it(`inert capture rejects ${name}`, () => expect(() => new Budget(O1).capture(value)).toThrow());
it("accessors reject without executing", () => {
  let reads = 0;
  const x = {
    get value() {
      reads++;
      return 1;
    },
  };
  expect(() => new Budget(O1).capture(x)).toThrow();
  expect(reads).toBe(0);
});
it("symbol properties reject", () =>
  expect(() => new Budget(O1).capture({ [Symbol("hidden")]: 1 })).toThrow());
it("cycles reject", () => {
  const x: unknown[] = [];
  x.push(x);
  expect(() => new Budget(O1).capture(x)).toThrow();
});
it("nonenumerable evidence rejects", () =>
  expect(() =>
    new Budget(O1).capture(Object.defineProperty({}, "hidden", { value: 1 })),
  ).toThrow());
it("null prototype is valid inert JSON", () =>
  expect(new Budget(O1).capture(Object.assign(Object.create(null), { a: 1 }))).toEqual({ a: 1 }));
it("UTF8 byte length bounds identifiers", () => {
  expect(id.safeParse("é".repeat(64)).success).toBe(true);
  expect(id.safeParse("é".repeat(65)).success).toBe(false);
});
for (const v of [
  "",
  "a".repeat(64),
  "SHA256:" + "a".repeat(64),
  "sha256:" + "A".repeat(64),
  "sha256:" + "0".repeat(63),
])
  it(`rejects noncanonical generic digest ${v.slice(0, 12)}`, () =>
    expect(digest.safeParse(v).success).toBe(false));
it("opportunity key is domain-specific", () => {
  expect(keySchema.safeParse("opp28:" + "a".repeat(64)).success).toBe(true);
  expect(keySchema.safeParse("sha256:" + "a".repeat(64)).success).toBe(false);
});
