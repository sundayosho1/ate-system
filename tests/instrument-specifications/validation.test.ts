import { mustParseUtc } from "@ate/time";
import { it, expect } from "vitest";
import { decimal, integer, aligned, type Metadata } from "@ate/instrument-specifications";
import { fixture, declared, take } from "./fixtures.js";
it.each([
  ["0.0100", "0.01"],
  ["-0.0", "0"],
  ["9007199254740993.01", "9007199254740993.01"],
  ["0.000000000000000001", "0.000000000000000001"],
])("normalizes %s exactly", (raw, expected) => {
  expect(decimal(raw)).toBe(expected);
});
it.each(["NaN", "Infinity", "1e2", "01", "+1", "1.0000000000000000001", "9".repeat(55)])(
  "rejects unsupported exact decimal %s",
  (raw) => {
    expect(() => integer(raw)).toThrow();
  },
);
it("distinguishes tick from point and preserves raw decimal provenance", async () => {
  const f = await fixture(),
    r = f.request();
  r.metadata.price.tick = declared("0.0500");
  const s = take(await f.service.publish(r));
  expect(s.prepared.request.metadata.price.tick?.value).toBe("0.0500");
  expect(s.prepared.normalized.price.tick?.value).toBe("0.05");
  expect(
    s.prepared.completeness.find((x) => x.profile === "PRICE_GRID_RESEARCH")?.classification,
  ).toBe("INTERNALLY_CONSISTENT");
  expect(aligned("9007199254740993.15", "0.05")).toBe(true);
});
const failures: [string, (m: Metadata) => void, string][] = [
  [
    "point mismatch",
    (m) => {
      m.price.point = declared("0.1");
    },
    "PRICE_PRECISION_POINT",
  ],
  [
    "unrepresentable tick",
    (m) => {
      m.price.tick = declared("0.005");
    },
    "PRICE_TICK_REPRESENTABILITY",
  ],
  [
    "off grid",
    (m) => {
      m.price.samplePrice = declared("10.12");
    },
    "PRICE_GRID",
  ],
  [
    "negative size",
    (m) => {
      m.contract.size = declared("-1");
    },
    "POSITIVE_CONTRACT_SIZE",
  ],
  [
    "zero step",
    (m) => {
      m.volume.increment = declared("0");
    },
    "POSITIVE_VOLUME_INCREMENT",
  ],
  [
    "reversed quantity",
    (m) => {
      m.volume.minimum = declared("101");
    },
    "VOLUME_BOUNDARIES",
  ],
  [
    "empty exclusive quantity",
    (m) => {
      m.volume.maximum = declared("0.1");
      m.volume.maximumInclusive = declared(false);
    },
    "VOLUME_BOUNDARIES",
  ],
  [
    "identity family substitution",
    (m) => {
      m.contract.family = declared("FX");
    },
    "IDENTITY_FAMILY",
  ],
  [
    "constraint increment conflict",
    (m) => {
      m.constraints.minimumIncrement = declared("0.01");
    },
    "CONSTRAINT_PRICE_INCREMENT",
  ],
  [
    "expiry mismatch",
    (m) => {
      m.contract.expiry = declared(mustParseUtc("2027-01-01T00:00:00.000Z"));
      m.lifecycle.expiry = declared(mustParseUtc("2028-01-01T00:00:00.000Z"));
    },
    "CONTRACT_EXPIRY",
  ],
  [
    "expiry chronology",
    (m) => {
      m.lifecycle.expiry = declared(mustParseUtc("2026-10-12T00:00:00.000Z"));
      m.lifecycle.lastTrading = declared(mustParseUtc("2026-10-13T00:00:00.000Z"));
    },
    "LIFECYCLE_LASTTRADING_EXPIRY",
  ],
  [
    "margin contradiction",
    (m) => {
      m.margin.mode = declared("FIXED_AMOUNT");
      m.margin.initial = declared("100");
      m.margin.maintenance = declared("101");
    },
    "MARGIN_MAINTENANCE",
  ],
  [
    "currency conflict",
    (m) => {
      m.margin.currency = declared("USD");
      m.contract.marginCurrency = declared("EUR");
    },
    "MARGIN_CURRENCY",
  ],
];
it.each(failures)("records %s without silently repairing source", async (_, change, rule) => {
  const f = await fixture(),
    r = f.request();
  change(r.metadata);
  const original = structuredClone(r.metadata),
    s = take(await f.service.publish(r));
  expect(s.prepared.validations.find((x) => x.ruleId === rule)?.classification).toBe(
    "CONTRADICTORY",
  );
  expect(s.prepared.request.metadata).toEqual(original);
  expect(s.prepared.tradingAuthority).toBe(false);
});
it.each(["ABSENT", "UNKNOWN", "UNSUPPORTED", "CONTRADICTORY"] as const)(
  "preserves explicit field state %s",
  async (state) => {
    const f = await fixture(),
      r = f.request();
    r.metadata.price.tick = {
      state,
      evidence: "Unresolved source field",
      ...(state === "CONTRADICTORY" ? { alternatives: ["0.01", "0.05"] } : {}),
    };
    const s = take(await f.service.publish(r));
    expect(s.prepared.normalized.price.tick?.state).toBe(state);
    expect(
      s.prepared.completeness.find((x) => x.profile === "PRICE_GRID_RESEARCH")?.classification,
    ).not.toBe("INTERNALLY_CONSISTENT");
  },
);
it("tick values need a currency and are never verified or derived", async () => {
  const f = await fixture(),
    r = f.request();
  r.metadata.price.tickValue = declared("1");
  const s = take(await f.service.publish(r));
  expect(
    s.prepared.validations.find((x) => x.ruleId === "TICK_VALUE_CURRENCY")?.classification,
  ).toBe("INCOMPLETE");
  expect(s.prepared.qualifications).toContain("UNVERIFIED_EXTERNAL_SOURCE");
  expect(s.prepared.normalized.price.profitTickValue).toBeUndefined();
});
it("missing applicability keeps declared margin incomplete", async () => {
  const f = await fixture(),
    r = f.request();
  r.metadata.margin.initial = declared("100");
  const s = take(await f.service.publish(r));
  expect(
    s.prepared.completeness.find((x) => x.profile === "DECLARED_MARGIN_RESEARCH")?.classification,
  ).toBe("INCOMPLETE");
});
it.each([true, false])("quantity sample honors minimum inclusive=%s", async (inclusive) => {
  const f = await fixture(),
    r = f.request();
  r.metadata.volume.minimumInclusive = declared(inclusive);
  r.metadata.volume.sampleQuantity = declared("0.1");
  const s = take(await f.service.publish(r));
  expect(s.prepared.validations.find((x) => x.ruleId === "VOLUME_SAMPLE")?.classification).toBe(
    inclusive ? "INTERNALLY_CONSISTENT" : "CONTRADICTORY",
  );
});
it.each([true, false])("tier boundary ownership is exact (valid=%s)", async (valid) => {
  const f = await fixture(),
    r = f.request();
  r.metadata.price.samplePrice = declared("10");
  r.metadata.price.tiers = declared([
    {
      lower: "0",
      upper: "10",
      increment: "0.01",
      lowerInclusive: true,
      upperInclusive: !valid,
      unit: "USD",
    },
    {
      lower: "10",
      upper: "20",
      increment: "0.05",
      lowerInclusive: true,
      upperInclusive: false,
      unit: "USD",
    },
  ]);
  const s = take(await f.service.publish(r));
  expect(
    s.prepared.validations.find((x) => x.ruleId === "PRICE_TIER_BOUNDARIES")?.classification,
  ).toBe(valid ? "INTERNALLY_CONSISTENT" : "CONTRADICTORY");
});

it("completeness profiles state exact required rules without inventing optional sample requirements", async () => {
  const f = await fixture(),
    r = f.request();
  delete r.metadata.price.samplePrice;
  const s = take(await f.service.publish(r));
  expect(s.prepared.normalizationVersion).toBe("S1");
  const profile = s.prepared.completeness.find((x) => x.profile === "PRICE_GRID_RESEARCH")!;
  expect(profile.requiredRules).toContain("PRICE_PRECISION_POINT");
  expect(profile.classification).toBe("INTERNALLY_CONSISTENT");
  expect(s.prepared.validations.find((v) => v.ruleId === "PRICE_GRID")?.classification).toBe(
    "INCOMPLETE",
  );
});
it("conflicting margin and price tier units remain contradictory", async () => {
  const f = await fixture(),
    r = f.request();
  r.metadata.price.tiers = declared([
    {
      lower: "0",
      upper: "20",
      increment: "0.05",
      lowerInclusive: true,
      upperInclusive: true,
      unit: "EUR",
    },
  ]);
  const s = take(await f.service.publish(r));
  expect(s.prepared.validations.find((v) => v.ruleId === "PRICE_TIER_UNITS")?.classification).toBe(
    "CONTRADICTORY",
  );
});
it("source observation contract values cannot be silently replaced in enrichment", async () => {
  const f = await fixture();
  const { batch } = await import("../broker-symbol-catalogue/fixtures.js");
  const b = batch("declared-contract", ["OTHER"]);
  b.records[0]!.identifiers = [
    { scheme: "RESEARCH", scope: "synthetic-broker", authority: "fixture", value: "economic-A" },
  ];
  b.records[0]!.contractSize = "1";
  const c = take(await f.mapping.base.lab.importNative(b));
  f.mapping.cats.push(c);
  const set = take(await f.mapping.service.publish(f.mapping.request("declared-contract-mapping"))),
    r = f.request();
  r.mappingSet = set.fingerprint;
  r.mappingFingerprint = set.prepared.mappings.find(
    (m) => m.source.catalogueFingerprint === c.fingerprint,
  )!.fingerprint;
  r.metadata.contract.size = declared("2");
  const s = take(await f.service.publish(r));
  expect(
    s.prepared.validations.find((v) => v.ruleId === "SOURCE_CONTRACTSIZE")?.classification,
  ).toBe("CONTRADICTORY");
});

it("unsupported margin modes do not inherit fixed-amount interpretations", async () => {
  const f = await fixture(),
    r = f.request();
  r.metadata.margin.mode = declared("UNKNOWN_PERCENT_CONVENTION");
  r.metadata.margin.initial = declared("10");
  r.metadata.margin.maintenance = declared("20");
  const s = take(await f.service.publish(r));
  expect(s.prepared.validations.find((v) => v.ruleId === "MARGIN_MODE")?.classification).toBe(
    "UNSUPPORTED",
  );
  expect(s.prepared.validations.some((v) => v.ruleId === "MARGIN_MAINTENANCE")).toBe(false);
});
