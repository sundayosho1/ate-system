import { it, expect } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  InstrumentSpecifications,
  MemorySpecificationRepository,
  FilesystemSpecificationRepository,
  defaultPolicy,
  type Policy,
  type Repository,
  type Request,
} from "@ate/instrument-specifications";
import { fixture, take, declared as D, root, effective } from "./fixtures.js";
async function setup(
  p: Policy = defaultPolicy,
  repository: Repository = new MemorySpecificationRepository(),
) {
  const f = await fixture(p, repository);
  take(await f.service.stop());
  await f.mapping.import("dependency-source", "OTHER.A", "dependency-broker");
  const set = take(await f.mapping.service.publish(f.mapping.request("dependency-map")));
  const service = new InstrumentSpecifications("spec-lab", f.ports);
  take(await service.initialize());
  return {
    ...f,
    service,
    request(id: string, side = 0, specification = side === 0 ? "left" : "right"): Request {
      const r = f.request(id, specification);
      const mapping = set.prepared.mappings.find(
        (m) =>
          m.source.namespace.brokerNamespaceId ===
          (side === 0 ? "synthetic-broker" : "dependency-broker"),
      )!;
      expect(mapping.outcome).toBe("UNIQUE_QUALIFIED_CANDIDATE");
      return { ...r, mappingSet: set.fingerprint, mappingFingerprint: mapping.fingerprint };
    },
  };
}
type Lab = Awaited<ReturnType<typeof setup>>;
async function compare(f: Lab, a: Request, b: Request) {
  const left = take(await f.service.publish(a)),
    right = take(await f.service.publish(b));
  expect(left.prepared.context.instrumentId).toBe(right.prepared.context.instrumentId);
  expect(left.prepared.context.namespaceKey).not.toBe(right.prepared.context.namespaceKey);
  return { left, right, result: take(f.service.compare(left.fingerprint, right.fingerprint)) };
}
function unresolved(r: Request, state: string) {
  if (state === "omitted") delete r.metadata.price.tickCurrency;
  else
    r.metadata.price.tickCurrency = {
      state: state as "UNKNOWN" | "ABSENT",
      evidence: "Currency unresolved",
    };
}
const tier = (unit: string) => ({
  lower: "0",
  upper: "20",
  increment: "0.05",
  lowerInclusive: true,
  upperInclusive: true,
  unit,
});
it.each(["tickValue", "profitTickValue", "lossTickValue"] as const)(
  "%s requires currency on both/left/right with omitted/UNKNOWN/ABSENT states",
  async (field) => {
    const f = await setup();
    for (const side of ["both", "left", "right"])
      for (const state of ["omitted", "UNKNOWN", "ABSENT"]) {
        const a = f.request(field + side + state + "a", 0, field + side + state + "left"),
          b = f.request(field + side + state + "b", 1, field + side + state + "right");
        for (const r of [a, b]) {
          r.metadata.price[field] = D("12.5");
          r.metadata.price.tickCurrency = D("USD");
        }
        if (side !== "right") unresolved(a, state);
        if (side !== "left") unresolved(b, state);
        const { result } = await compare(f, a, b);
        expect(result.classification).toBe("INSUFFICIENT_EVIDENCE");
        const reason = result.differences.find(
          (d) => d.field === "COMPARISON_DEPENDENCY_TICK_VALUE_CURRENCY",
        );
        expect(reason).toMatchObject({ classification: "INSUFFICIENT_EVIDENCE" });
        expect(reason?.before).toMatchObject({
          missing: side === "right" ? [] : ["price.tickCurrency"],
        });
        expect(reason?.after).toMatchObject({
          missing: side === "left" ? [] : ["price.tickCurrency"],
        });
      }
  },
);
it.each(["tickValue", "profitTickValue", "lossTickValue"] as const)(
  "%s compares complete currency and preserves numeric material differences",
  async (field) => {
    const f = await setup();
    for (const mode of [
      "matching",
      "different-currency",
      "different-value",
      "missing-currency-different-value",
    ]) {
      const a = f.request(mode + "a", 0, mode + "left"),
        b = f.request(mode + "b", 1, mode + "right");
      for (const r of [a, b]) {
        r.metadata.price[field] = D("12.50");
        r.metadata.price.tickCurrency = D("USD");
      }
      b.metadata.price[field] = D(mode.includes("value") ? "13" : "12.5000");
      if (mode === "different-currency") b.metadata.price.tickCurrency = D("EUR");
      if (mode === "missing-currency-different-value") {
        delete a.metadata.price.tickCurrency;
        delete b.metadata.price.tickCurrency;
      }
      const { result } = await compare(f, a, b);
      if (mode.includes("value"))
        expect(result.differences.find((x) => x.field === `price.${field}`)?.classification).toBe(
          mode === "different-value" ? "MATERIAL_DIFFERENCE" : "INSUFFICIENT_EVIDENCE",
        );
      expect(result.classification).toBe(
        mode === "matching"
          ? "EXACT_MATCH_UNDER_RECORDED_POLICY"
          : mode === "different-currency"
            ? "INCOMPATIBLE_CONTRACT_SEMANTICS"
            : mode === "different-value"
              ? "MATERIAL_DIFFERENCE"
              : "INSUFFICIENT_EVIDENCE",
      );
    }
  },
);
it.each(["UNSUPPORTED", "CONTRADICTORY"] as const)(
  "unresolved dependency %s is insufficient rather than invented currency",
  async (state) => {
    const f = await setup(),
      a = f.request("a"),
      b = f.request("b", 1);
    for (const r of [a, b]) {
      r.metadata.price.tickValue = D("1");
      r.metadata.price.tickCurrency =
        state === "CONTRADICTORY"
          ? { state, alternatives: ["USD", "EUR"], evidence: "Conflicting currency" }
          : { state, evidence: "Currency convention not supported" };
    }
    expect((await compare(f, a, b)).result.classification).toBe("INSUFFICIENT_EVIDENCE");
  },
);
it.each(["minimum", "maximum", "increment", "origin", "limit", "sampleQuantity", "tiers"] as const)(
  "volume.%s requires its own unit on either side",
  async (field) => {
    const f = await setup();
    for (const missing of ["left", "right", "both"]) {
      const a = f.request(field + missing + "a", 0, missing + "left"),
        b = f.request(field + missing + "b", 1, missing + "right");
      for (const r of [a, b])
        r.metadata.volume = {
          unit: D("SHARES"),
          [field]: field === "tiers" ? D([tier("SHARES")]) : D("1"),
        };
      if (missing !== "right") delete a.metadata.volume.unit;
      if (missing !== "left") delete b.metadata.volume.unit;
      const { result } = await compare(f, a, b);
      expect(result.classification).toBe("INSUFFICIENT_EVIDENCE");
      expect(result.differences.some((d) => d.field === "COMPARISON_DEPENDENCY_VOLUME_UNIT")).toBe(
        true,
      );
    }
  },
);
it.each(["initial", "maintenance", "hedged", "tiers"] as const)(
  "margin.%s requires own currency including zero amount",
  async (field) => {
    const f = await setup();
    for (const missing of ["left", "right", "both"]) {
      const a = f.request(field + missing + "a", 0, missing + "left"),
        b = f.request(field + missing + "b", 1, missing + "right");
      for (const r of [a, b])
        r.metadata.margin = {
          mode: D("FIXED_AMOUNT"),
          currency: D("USD"),
          [field]: field === "tiers" ? D([tier("USD")]) : D("0"),
        };
      if (missing !== "right") delete a.metadata.margin.currency;
      if (missing !== "left") delete b.metadata.margin.currency;
      expect((await compare(f, a, b)).result.classification).toBe("INSUFFICIENT_EVIDENCE");
    }
  },
);
it.each(["left", "right", "both"] as const)(
  "margin mode must be explicit: missing %s",
  async (missing) => {
    const f = await setup(),
      a = f.request("a"),
      b = f.request("b", 1);
    for (const r of [a, b])
      r.metadata.margin = { initial: D("10"), currency: D("USD"), mode: D("FIXED_AMOUNT") };
    if (missing !== "right") delete a.metadata.margin.mode;
    if (missing !== "left") delete b.metadata.margin.mode;
    expect((await compare(f, a, b)).result.classification).toBe("INSUFFICIENT_EVIDENCE");
  },
);
it.each(["volume", "margin"] as const)(
  "complete %s units allow exact and differing units remain incompatible",
  async (category) => {
    const f = await setup();
    for (const different of [false, true]) {
      const a = f.request("a" + different, 0, "a" + different),
        b = f.request("b" + different, 1, "b" + different);
      if (category === "volume") {
        a.metadata.volume = { limit: D("2"), unit: D("SHARES") };
        b.metadata.volume = { limit: D("2"), unit: D(different ? "LOTS" : "SHARES") };
      } else {
        a.metadata.margin = { initial: D("10"), currency: D("USD"), mode: D("FIXED_AMOUNT") };
        b.metadata.margin = {
          initial: D("10"),
          currency: D(different ? "EUR" : "USD"),
          mode: D("FIXED_AMOUNT"),
        };
      }
      expect((await compare(f, a, b)).result.classification).toBe(
        different ? "INCOMPATIBLE_CONTRACT_SEMANTICS" : "EXACT_MATCH_UNDER_RECORDED_POLICY",
      );
    }
  },
);
it.each(["price", "volume", "margin", "sessions", "lifecycle", "constraints"] as const)(
  "genuinely absent optional %s category does not become a global completeness gate",
  async (category) => {
    const f = await setup(),
      a = f.request("a"),
      b = f.request("b", 1);
    for (const r of [a, b]) r.metadata[category] = {};
    expect((await compare(f, a, b)).result.classification).toBe(
      "EXACT_MATCH_UNDER_RECORDED_POLICY",
    );
  },
);
it("missing optional samples and account applicability do not imply invented requirements", async () => {
  const f = await setup(),
    a = f.request("a"),
    b = f.request("b", 1);
  for (const r of [a, b]) {
    delete r.metadata.price.samplePrice;
    delete r.metadata.volume.sampleQuantity;
    r.metadata.margin = { initial: D("10"), currency: D("USD"), mode: D("FIXED_AMOUNT") };
  }
  const { left, result } = await compare(f, a, b);
  expect(
    left.prepared.validations.some(
      (v) => v.ruleId === "MARGIN_APPLICABILITY" && v.classification === "INCOMPLETE",
    ),
  ).toBe(true);
  expect(result.classification).toBe("EXACT_MATCH_UNDER_RECORDED_POLICY");
});
it.each(["point", "tick", "minimumIncrement", "gridOrigin", "samplePrice", "tiers"] as const)(
  "price.%s must retain quotation interpretation",
  async (field) => {
    const f = await setup(),
      a = f.request("a"),
      b = f.request("b", 1);
    for (const r of [a, b])
      r.metadata.price = { [field]: field === "tiers" ? D([tier("USD")]) : D("1") };
    const { result } = await compare(f, a, b);
    expect(result.classification).toBe("INSUFFICIENT_EVIDENCE");
    expect(
      result.differences.some((d) => d.field === "COMPARISON_DEPENDENCY_PRICE_QUOTATION"),
    ).toBe(true);
  },
);
it.each(["minimumIncrement", "priceLower", "priceUpper", "quantityIncrement"] as const)(
  "constraint %s requires its actual measurement context",
  async (field) => {
    const f = await setup(),
      a = f.request("a"),
      b = f.request("b", 1);
    for (const r of [a, b]) {
      r.metadata.price = {};
      r.metadata.volume = {};
      r.metadata.constraints = { [field]: D("1") };
    }
    const { result } = await compare(f, a, b);
    expect(result.classification).toBe("INSUFFICIENT_EVIDENCE");
    expect(
      result.differences.some(
        (d) =>
          d.field ===
          `COMPARISON_DEPENDENCY_${field === "quantityIncrement" ? "CONSTRAINT_QUANTITY_UNIT" : "PRICE_QUOTATION"}`,
      ),
    ).toBe(true);
  },
);
it("minimumNotional cannot borrow a currency from canonical or contract metadata", async () => {
  const f = await setup(),
    a = f.request("a"),
    b = f.request("b", 1);
  for (const r of [a, b]) r.metadata.volume.minimumNotional = D("10");
  const { result } = await compare(f, a, b);
  expect(result.classification).toBe("INSUFFICIENT_EVIDENCE");
  expect(
    result.differences.find(
      (d) => d.field === "COMPARISON_DEPENDENCY_NOTIONAL_CURRENCY_UNSPECIFIED",
    ),
  ).toMatchObject({ before: { unbound: true }, after: { unbound: true } });
});
it.each(["size", "multiplier"] as const)(
  "contract.%s cannot borrow the volume unit",
  async (field) => {
    const f = await setup(),
      a = f.request("a"),
      b = f.request("b", 1);
    for (const r of [a, b]) {
      r.metadata.contract[field] = D("1");
      delete r.metadata.contract.unit;
    }
    const { result } = await compare(f, a, b);
    expect(result.classification).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.differences.some((d) => d.field === "COMPARISON_DEPENDENCY_CONTRACT_UNIT")).toBe(
      true,
    );
  },
);
it("price tiers require the category currency even when each tier states a unit", async () => {
  const f = await setup(),
    a = f.request("a"),
    b = f.request("b", 1);
  for (const r of [a, b]) {
    r.metadata.price.tiers = D([tier("USD")]);
    delete r.metadata.contract.quoteCurrency;
  }
  const { result } = await compare(f, a, b);
  expect(result.classification).toBe("INSUFFICIENT_EVIDENCE");
  expect(
    result.differences.some((d) => d.field === "COMPARISON_DEPENDENCY_PRICE_TIER_CURRENCY"),
  ).toBe(true);
});
it.each(["invalid-tick", "margin-contradiction", "unsupported-mode"] as const)(
  "relevant invalid evidence %s remains unqualified",
  async (mode) => {
    const f = await setup(),
      a = f.request("a"),
      b = f.request("b", 1);
    for (const r of [a, b]) {
      if (mode === "invalid-tick") r.metadata.price.tick = D("0.001");
      else
        r.metadata.margin = {
          initial: D("1"),
          maintenance: D("2"),
          currency: D("USD"),
          mode: D(mode === "unsupported-mode" ? "PERCENT" : "FIXED_AMOUNT"),
        };
    }
    expect((await compare(f, a, b)).result.classification).toBe(
      mode === "unsupported-mode" ? "UNSUPPORTED_COMPARISON" : "INSUFFICIENT_EVIDENCE",
    );
  },
);
it("immutable revision and historical CHANGES query use dependency-aware results deterministically", async () => {
  const f = await setup(),
    a = f.request("before", 0, "history"),
    b = f.request("after", 0, "history");
  a.metadata.price.tickValue = D("1");
  b.metadata.price.tickValue = D("2");
  const left = take(await f.service.publish(a)),
    right = take(await f.service.publish(b));
  expect(right.parentVersion).toBe(left.fingerprint);
  const result = take(f.service.compare(left.fingerprint, right.fingerprint));
  expect(result.classification).toBe("INSUFFICIENT_EVIDENCE");
  for (let i = 0; i < 3; i++)
    expect(take(f.service.compare(left.fingerprint, right.fingerprint))).toEqual(result);
  const page = take(
    f.service.query({
      kind: "CHANGES",
      snapshotFingerprint: right.fingerprint,
      offset: 0,
      limit: 1,
    }),
  );
  expect(page.records[0]).toMatchObject({ value: result });
  expect(take(f.service.snapshot(left.fingerprint))).toEqual(left);
  const valid = f.request("supported", 0, "history");
  valid.metadata.price.tickValue = D("2");
  valid.metadata.price.tickCurrency = D("USD");
  const next = take(await f.service.publish(valid));
  expect(take(f.service.compare(next.fingerprint, next.fingerprint)).classification).toBe(
    "EXACT_MATCH_UNDER_RECORDED_POLICY",
  );
  expect(take(f.service.snapshot(right.fingerprint))).toEqual(right);
});
it("dependency explanations consume the existing comparison capacity", async () => {
  const f = await setup({ ...defaultPolicy, maxComparisons: 1 }),
    a = f.request("a"),
    b = f.request("b", 1);
  for (const r of [a, b]) r.metadata.price.tickValue = D("1");
  const left = take(await f.service.publish(a)),
    right = take(await f.service.publish(b));
  expect(f.service.compare(left.fingerprint, right.fingerprint)).toMatchObject({
    ok: false,
    error: { code: "COMPARISON_CAPACITY" },
  });
});
it("physical ACK and fresh recovery preserve bodies while comparison and history remain corrected", async () => {
  const path = root(),
    repository = new FilesystemSpecificationRepository(path),
    f = await setup(defaultPolicy, repository),
    a = f.request("physical-a", 0, "physical"),
    b = f.request("physical-b", 0, "physical");
  for (const r of [a, b]) r.metadata.price.tickValue = D("10");
  const left = take(await f.service.publish(a)),
    right = take(await f.service.publish(b)),
    before = take(f.service.compare(left.fingerprint, right.fingerprint));
  expect(before.classification).toBe("INSUFFICIENT_EVIDENCE");
  const names = ["generation-00000001.json", "generation-00000002.json"],
    bodies = await Promise.all(names.map((n) => readFile(join(path, n), "utf8")));
  take(await f.service.stop());
  const fresh = new InstrumentSpecifications("spec-lab", f.ports);
  expect(take(await fresh.initialize())).toEqual(right);
  expect(take(fresh.compare(left.fingerprint, right.fingerprint))).toEqual(before);
  expect(
    take(
      fresh.query({ kind: "CHANGES", snapshotFingerprint: right.fingerprint, offset: 0, limit: 1 }),
    ).records[0],
  ).toMatchObject({ value: before });
  expect(take(fresh.snapshot(left.fingerprint))).toEqual(left);
  take(await fresh.stop());
  expect(await Promise.all(names.map((n) => readFile(join(path, n), "utf8")))).toEqual(bodies);
  await writeFile(join(path, names[1]!), "CORRUPT");
  const corrupt = new InstrumentSpecifications("spec-lab", f.ports);
  expect((await corrupt.initialize()).ok).toBe(false);
  expect(corrupt.diagnostics().readiness).toBe("NOT_READY");
  await writeFile(join(path, names[1]!), bodies[1]!);
  const configuration = await effective({
    ...defaultPolicy,
    maxDiagnostics: defaultPolicy.maxDiagnostics - 1,
  });
  const incompatible = new InstrumentSpecifications("spec-lab", {
    ...f.ports,
    configuration: () => configuration,
  });
  expect(await incompatible.initialize()).toMatchObject({
    ok: false,
    error: { code: "POLICY_INCOMPATIBLE" },
  });
  expect(await Promise.all(names.map((n) => readFile(join(path, n), "utf8")))).toEqual(bodies);
});
