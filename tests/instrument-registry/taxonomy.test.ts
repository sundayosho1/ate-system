import { taxonomyVersionFingerprint } from "@ate/instrument-registry";
import { setup, take } from "./fixtures.js";
import { it, expect } from "vitest";
import {
  validatePolicy,
  validateTaxonomy,
  defaultPolicy,
  defaultTaxonomy,
  prepare,
  policyFingerprint,
} from "@ate/instrument-registry";
import { equity } from "./fixtures.js";
const mutations: [string, (p: typeof defaultPolicy) => void][] = [
  [
    "cycle",
    (p) => {
      p.taxonomies[0]!.categories[0]!.parent = "FX";
    },
  ],
  [
    "undefined parent",
    (p) => {
      p.taxonomies[0]!.categories[0]!.parent = "NONE";
    },
  ],
  [
    "duplicate code",
    (p) => {
      p.taxonomies[0]!.categories.push(p.taxonomies[0]!.categories[0]!);
    },
  ],
  [
    "duplicate version",
    (p) => {
      p.taxonomies.push(p.taxonomies[0]!);
    },
  ],
  [
    "duplicate subtype",
    (p) => {
      p.taxonomies[0]!.categories[0]!.kinds.push("SPOT");
    },
  ],
  [
    "cross family parent",
    (p) => {
      p.taxonomies[0]!.categories[0]!.parent = "EQUITY";
    },
  ],
  [
    "unknown family",
    (p) => {
      p.supportedFamilies.push("ALIEN" as "FX");
    },
  ],
  [
    "duplicate family",
    (p) => {
      p.supportedFamilies.push("FX");
    },
  ],
];
it.each(mutations)("taxonomy rejects %s", (_name, edit) => {
  const p = structuredClone(defaultPolicy);
  edit(p);
  expect(() => validatePolicy(p)).toThrow();
});
it("historical taxonomy versions keep distinct meanings", () => {
  const p = structuredClone(defaultPolicy),
    t = structuredClone(defaultTaxonomy);
  t.version = "T2";
  t.categories[0]!.meaning = "Governed revised description";
  p.taxonomies.push(t);
  const verified = validatePolicy(p);
  expect(verified.taxonomies[0]).toEqual(defaultTaxonomy);
  expect(policyFingerprint(p)).not.toBe(policyFingerprint(defaultPolicy));
});
it("immutable returned policy cannot be mutated", () => {
  const p = validatePolicy(defaultPolicy);
  expect(() => p.taxonomies[0]!.categories.pop()).toThrow();
});
it("unsupported classification never coerces", () => {
  expect(() => prepare({ ...equity(), classification: "ALIEN" }, defaultPolicy)).toThrow(
    "CLASSIFICATION",
  );
});
it("deprecated classification requires explicit deprecated administration", () => {
  const p = structuredClone(defaultPolicy);
  p.taxonomies[0]!.categories.find((c) => c.code === "EQUITY")!.deprecated = true;
  expect(() => prepare(equity(), p)).toThrow("DEPRECATED");
  expect(prepare({ ...equity(), status: "DEPRECATED" }, p).definition.status).toBe("DEPRECATED");
});
it("valid hierarchy is accepted without market permission", () => {
  const t = structuredClone(defaultTaxonomy);
  t.categories.push({ ...t.categories[1]!, code: "ORDINARY_SUB", parent: "EQUITY" });
  expect(() => validateTaxonomy(t)).not.toThrow();
});

it("taxonomy version fingerprints bind meanings independently of category iteration order", async () => {
  const { registry } = await setup();
  const first = take(registry.taxonomy("T1"))!;
  expect(first.fingerprint).toBe(taxonomyVersionFingerprint(defaultTaxonomy));
  const changed = structuredClone(defaultTaxonomy);
  changed.categories.reverse();
  expect(taxonomyVersionFingerprint(changed)).toBe(first.fingerprint);
  changed.categories[0]!.meaning = "Different governed meaning";
  expect(taxonomyVersionFingerprint(changed)).not.toBe(first.fingerprint);
});
