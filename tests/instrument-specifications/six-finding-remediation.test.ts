import { it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fingerprint } from "@ate/configuration";
import { calendarSchema, utcCalendar } from "@ate/multitimeframe";
import { mustParseUtc } from "@ate/time";
import {
  InstrumentSpecifications,
  FilesystemSpecificationRepository,
  MemorySpecificationRepository,
  defaultPolicy,
  fail,
  type Snapshot,
  type Policy,
  type Request,
  type Prepared,
} from "@ate/instrument-specifications";
import { fixture, take, root, declared as D, effective } from "./fixtures.js";
const day = (s: string) => mustParseUtc(s + "T00:00:00.000Z");
const classification = (s: Snapshot, profile: Prepared["completeness"][number]["profile"]) =>
  s.prepared.completeness.find((x) => x.profile === profile)!.classification;
function sessions(r: Request) {
  r.metadata.sessions.calendar = D(
    calendarSchema.parse({ ...utcCalendar, id: "remediation-calendar" }),
  );
  r.metadata.sessions.effectiveFrom = D(day("2026-10-01"));
}
const interval = (start: string, end: string) => ({ start: day(start), end: day(end) });
const tier = (i: number, unit = "USD") => ({
  lower: String(i),
  upper: String(i + 1),
  increment: "1",
  lowerInclusive: true,
  upperInclusive: false,
  unit,
});
async function reader(f: Awaited<ReturnType<typeof fixture>>, p?: Policy) {
  const configuration = p ? await effective(p) : f.ports.configuration();
  return new InstrumentSpecifications("spec-lab", {
    ...f.ports,
    configuration: () => configuration,
  });
}
it.each(["reversed", "equal", "valid", "multiple", "break"] as const)(
  "H01 maintenance %s with profile isolation",
  async (mode) => {
    const f = await fixture(),
      r = f.request();
    sessions(r);
    const valid = interval("2026-10-10", "2026-10-11");
    r.metadata.sessions.maintenance = D(
      mode === "multiple"
        ? [valid, interval("2026-10-11", "2026-10-10")]
        : [
            mode === "equal"
              ? interval("2026-10-10", "2026-10-10")
              : mode === "reversed"
                ? interval("2026-10-11", "2026-10-10")
                : valid,
          ],
    );
    if (mode === "break")
      r.metadata.sessions.calendar = D(
        calendarSchema.parse({
          ...utcCalendar,
          kind: "EXPLICIT_SESSION_SCHEDULE",
          sessions: [
            {
              id: "s",
              date: "2026-10-10",
              open: "2026-10-10T08:00:00.000Z",
              close: "2026-10-10T12:00:00.000Z",
              breaks: [{ start: "2026-10-10T09:00:00.000Z", end: "2026-10-10T10:00:00.000Z" }],
            },
          ],
        }),
      );
    const s = take(await f.service.publish(r));
    expect(classification(s, "SESSION_HISTORY")).toBe(
      ["valid", "break"].includes(mode) ? "INTERNALLY_CONSISTENT" : "CONTRADICTORY",
    );
    expect(classification(s, "CONTRACT_COMPARISON")).toBe("INTERNALLY_CONSISTENT");
    expect(s.prepared.request.metadata.sessions.maintenance).toEqual(
      r.metadata.sessions.maintenance,
    );
  },
);
it("H01 multi-rule ownership does not infer categories from arbitrary evidence", async () => {
  const f = await fixture(),
    r = f.request();
  sessions(r);
  r.metadata.sessions.maintenance = D([interval("2026-10-11", "2026-10-10")]);
  r.metadata.sessions.weeklyTemplate = {
    state: "UNSUPPORTED",
    evidence: "contract.size is deliberately unrelated human evidence",
  };
  const s = take(await f.service.publish(r));
  expect(classification(s, "SESSION_HISTORY")).toBe("CONTRADICTORY");
  expect(classification(s, "CONTRACT_COMPARISON")).toBe("INTERNALLY_CONSISTENT");
});
it.each([
  ["expiry", "2026-09-01", false],
  ["expiry", "2026-10-01", true],
  ["expiry", "2026-12-01", true],
  ["maturity", "2026-09-01", false],
  ["maturity", "2026-10-01", true],
  ["maturity", "2026-12-01", true],
  ["lastTrading", "2026-09-01", false],
  ["lastTrading", "2026-10-01", true],
  ["retirement", "2026-09-01", false],
  ["retirement", "2026-10-01", true],
] as const)("H02 effective start versus %s %s", async (field, date, valid) => {
  const f = await fixture(),
    r = f.request();
  r.metadata.lifecycle[field] = D(day(date));
  const s = take(await f.service.publish(r));
  expect(classification(s, "LIFECYCLE_HISTORY")).toBe(
    valid ? "INTERNALLY_CONSISTENT" : "CONTRADICTORY",
  );
  expect(s.prepared.request.metadata.lifecycle.lastTrading).toEqual(
    r.metadata.lifecycle.lastTrading,
  );
});
it.each([
  "all",
  "no-lastTrading",
  "no-expiry",
  "only-expiry-maturity",
  "equal",
  "reversed-last-maturity",
  "exclusive-end",
] as const)("H02 optional chronology combination %s", async (mode) => {
  const f = await fixture(),
    r = f.request();
  r.metadata.lifecycle.lastTrading = D(day("2026-11-01"));
  r.metadata.lifecycle.expiry = D(day("2026-11-02"));
  r.metadata.lifecycle.maturity = D(day("2026-11-03"));
  r.metadata.lifecycle.retirement = D(day("2026-12-01"));
  if (mode === "no-lastTrading") delete r.metadata.lifecycle.lastTrading;
  if (mode === "no-expiry") delete r.metadata.lifecycle.expiry;
  if (mode === "only-expiry-maturity") {
    delete r.metadata.lifecycle.lastTrading;
    r.metadata.lifecycle.expiry = D(day("2026-09-01"));
    r.metadata.lifecycle.maturity = D(day("2026-09-02"));
  }
  if (mode === "equal") {
    r.metadata.lifecycle.lastTrading = D(day("2026-10-01"));
    r.metadata.lifecycle.expiry = D(day("2026-10-01"));
    r.metadata.lifecycle.maturity = D(day("2026-10-01"));
  }
  if (mode === "reversed-last-maturity") {
    delete r.metadata.lifecycle.expiry;
    r.metadata.lifecycle.maturity = D(day("2026-10-02"));
  }
  if (mode === "exclusive-end") r.metadata.lifecycle.effectiveTo = D(day("2026-10-01"));
  const s = take(await f.service.publish(r));
  expect(classification(s, "LIFECYCLE_HISTORY")).toBe(
    ["only-expiry-maturity", "reversed-last-maturity", "exclusive-end"].includes(mode)
      ? "CONTRADICTORY"
      : "INTERNALLY_CONSISTENT",
  );
});
it.each([
  ["0.001", "1.001", 2, "0.05", false],
  ["0.05", "1.05", 2, "0.05", true],
  ["0", "1.05", 2, "0.05", true],
  ["0", "1.001", 2, "0.05", false],
  ["0.001", "1.05", 2, "0.05", false],
  ["0", "1.01", 2, "0.05", false],
  ["0.0500", "1.0500", 2, "0.0500", true],
  ["0.000000000000000001", "0.000000000000000003", 18, "0.000000000000000001", true],
  ["0", "9".repeat(54), 0, "1", true],
] as const)(
  "H03 exact grid origin=%s sample=%s precision=%s",
  async (origin, sample, precision, tick, valid) => {
    const f = await fixture(),
      r = f.request();
    r.metadata.price = {
      precision: D(precision),
      point: D(precision === 0 ? "1" : precision === 18 ? "0.000000000000000001" : "0.01"),
      tick: D(tick),
      gridOrigin: D(origin),
      samplePrice: D(sample),
      quotation: D("DECIMAL"),
    };
    const s = take(await f.service.publish(r));
    expect(classification(s, "PRICE_GRID_RESEARCH")).toBe(
      valid ? "INTERNALLY_CONSISTENT" : "CONTRADICTORY",
    );
    expect(s.prepared.request.metadata.price.gridOrigin!.value).toBe(origin);
  },
);
it.each(["missing", "unsupported", "tier-off-precision"] as const)(
  "H03 precision convention %s",
  async (mode) => {
    const f = await fixture(),
      r = f.request();
    if (mode === "missing") delete r.metadata.price.precision;
    if (mode === "unsupported") r.metadata.price.quotation = D("FRACTIONAL");
    if (mode === "tier-off-precision")
      r.metadata.price.tiers = D([{ ...tier(0), lower: "0.001", upper: "10.001" }]);
    const s = take(await f.service.publish(r));
    expect(classification(s, "PRICE_GRID_RESEARCH")).toBe(
      mode === "missing" ? "INCOMPLETE" : mode === "unsupported" ? "UNSUPPORTED" : "CONTRADICTORY",
    );
  },
);
it.each(["maintenance", "lifecycle", "price"] as const)(
  "physical ACK and fresh exact recovery of corrected %s history",
  async (mode) => {
    const path = root(),
      repo = new FilesystemSpecificationRepository(path),
      f = await fixture(defaultPolicy, repo),
      r = f.request();
    sessions(r);
    if (mode === "maintenance")
      r.metadata.sessions.maintenance = D([interval("2026-10-11", "2026-10-10")]);
    if (mode === "lifecycle") {
      r.metadata.lifecycle.expiry = D(day("2026-09-01"));
      r.metadata.lifecycle.maturity = D(day("2026-09-02"));
    }
    if (mode === "price") {
      r.metadata.price.gridOrigin = D("0.001");
      r.metadata.price.samplePrice = D("1.001");
    }
    const profile =
      mode === "maintenance"
        ? "SESSION_HISTORY"
        : mode === "lifecycle"
          ? "LIFECYCLE_HISTORY"
          : "PRICE_GRID_RESEARCH";
    const a = take(await f.service.publish(r)),
      body = await readFile(join(path, "generation-00000001.json"), "utf8");
    expect(classification(a, profile)).toBe("CONTRADICTORY");
    take(await f.service.stop());
    const fresh = await reader(f);
    expect(take(await fresh.initialize())).toEqual(a);
    expect(
      take(
        fresh.query({
          kind: "PROFILES",
          snapshotFingerprint: a.fingerprint,
          profile,
          offset: 0,
          limit: 1,
        }),
      ).records[0],
    ).toMatchObject({ value: { classification: "CONTRADICTORY" } });
    const next = f.request("revision");
    sessions(next);
    const b = take(await fresh.publish(next));
    expect(b.parentVersion).toBe(a.fingerprint);
    expect(take(fresh.snapshot(a.fingerprint))).toEqual(a);
    expect(await readFile(join(path, "generation-00000001.json"), "utf8")).toBe(body);
    take(await fresh.stop());
  },
);
it.each(["price", "volume", "margin"] as const)(
  "M01 %s ordinary and asymmetric alternative tables obey per-table bounds",
  async (category) => {
    let calls = 0;
    const repo = new MemorySpecificationRepository(),
      f = await fixture(
        { ...defaultPolicy, maxPriceTiers: 1, maxQuantityTiers: 1 },
        {
          load: () => repo.load(),
          commit: (s) => {
            calls++;
            return repo.commit(s);
          },
        },
      );
    for (const lengths of [[0], [1], [2], [0, 1], [1, 1], [1, 2], [2, 1]]) {
      const r = f.request("tiers-" + lengths.join("-"), "tiers-" + lengths.join("-")),
        unit = category === "volume" ? "SHARES" : "USD",
        tables = lengths.map((n) => Array.from({ length: n }, (_, i) => tier(i, unit)));
      r.metadata[category].tiers =
        tables.length === 1
          ? D(tables[0]!)
          : { state: "CONTRADICTORY", alternatives: tables, evidence: "Retain all alternatives" };
      const before = calls,
        result = await f.service.publish(r);
      expect(result.ok).toBe(!lengths.some((n) => n > 1));
      expect(calls - before).toBe(lengths.some((n) => n > 1) ? 0 : 1);
      if (result.ok)
        expect(result.value.prepared.request.metadata[category].tiers).toEqual(
          r.metadata[category].tiers,
        );
    }
    take(await f.service.publish(f.request("valid-retry", "valid-retry")));
  },
);
it.each(["price", "volume", "margin"] as const)(
  "M01 %s retained alternatives recover at equal and reject tighter budget",
  async (category) => {
    const f = await fixture({ ...defaultPolicy, maxPriceTiers: 2, maxQuantityTiers: 2 }),
      r = f.request();
    r.metadata[category].tiers = {
      state: "CONTRADICTORY",
      alternatives: [[tier(0)], [tier(0), tier(1)]],
      evidence: "Asymmetric historical alternatives",
    };
    const s = take(await f.service.publish(r));
    take(await f.service.stop());
    for (const cap of [2, 1]) {
      const p = {
          ...defaultPolicy,
          maxPriceTiers: cap,
          maxQuantityTiers: cap,
          compatibleHistoryPolicies: [s.prepared.policyFingerprint],
        },
        fresh = await reader(f, p);
      expect((await fresh.initialize()).ok).toBe(cap === 2);
      if (cap === 1) expect(fresh.diagnostics().readiness).toBe("NOT_READY");
    }
    expect(take(await f.repository.load())[0]).toEqual(s);
  },
);
it.each(["ASCII", "é漢🙂", 'quoted " and slash \\'])(
  "M02 native/serialized exact physical-byte boundaries %s",
  async (text) => {
    const f = await fixture(),
      r = f.request();
    r.rawEvidence = text;
    const size = Buffer.byteLength(JSON.stringify(r));
    for (const delta of [-1, 0, 1])
      for (const json of [false, true]) {
        const g = await fixture({ ...defaultPolicy, maxInputBytes: size + delta });
        const same = g.request();
        same.rawEvidence = text;
        expect(Buffer.byteLength(JSON.stringify(same))).toBe(size);
        expect(
          (json ? await g.service.publishJson(JSON.stringify(same)) : await g.service.publish(same))
            .ok,
        ).toBe(delta >= 0);
        expect(take(await g.repository.load())).toHaveLength(delta >= 0 ? 1 : 0);
        if (delta < 0) {
          const retry = g.request("retry");
          retry.rawEvidence = "ok";
          take(await g.service.publish(retry));
          expect(g.service.diagnostics().pending).toBe(0);
        }
      }
  },
);
it.each(["getter", "proxy", "cycle"] as const)(
  "M02 byte measurement does not invoke hostile %s",
  async (mode) => {
    const f = await fixture(),
      r = f.request();
    let calls = 0;
    let input: unknown = r;
    if (mode === "getter")
      Object.defineProperty(r, "rawEvidence", {
        enumerable: true,
        get() {
          calls++;
          throw Error("HOSTILE");
        },
      });
    if (mode === "proxy")
      input = new Proxy(r, {
        ownKeys() {
          calls++;
          throw Error("HOSTILE");
        },
      });
    if (mode === "cycle") (r as unknown as { loop: unknown }).loop = r;
    expect((await f.service.publish(input)).ok).toBe(false);
    expect(calls).toBe(0);
    expect(take(await f.repository.load())).toHaveLength(0);
    take(await f.service.publish(f.request()));
  },
);
it("M02 fresh compatible history rejects physical input one byte above current budget", async () => {
  const f = await fixture(),
    s = take(await f.service.publish(f.request())),
    size = Buffer.byteLength(JSON.stringify(s.prepared.request));
  take(await f.service.stop());
  for (const delta of [-1, 0, 1]) {
    const fresh = await reader(f, {
      ...defaultPolicy,
      maxInputBytes: size + delta,
      compatibleHistoryPolicies: [s.prepared.policyFingerprint],
    });
    expect((await fresh.initialize()).ok).toBe(delta >= 0);
  }
  expect(take(await f.repository.load())[0]).toEqual(s);
});
it.each(["memory", "filesystem"] as const)(
  "M03 %s recovery applies current diagnostics without rewriting history",
  async (mode) => {
    const path = root(),
      repo =
        mode === "filesystem"
          ? new FilesystemSpecificationRepository(path)
          : new MemorySpecificationRepository(),
      f = await fixture(defaultPolicy, repo),
      s = take(await f.service.publish(f.request())),
      count = s.prepared.validations.length;
    const physical =
      mode === "filesystem" ? await readFile(join(path, "generation-00000001.json"), "utf8") : null;
    take(await f.service.stop());
    for (const cap of [1, count - 1, count, count + 1]) {
      const fresh = await reader(f, {
        ...defaultPolicy,
        maxDiagnostics: cap,
        compatibleHistoryPolicies: [s.prepared.policyFingerprint],
      });
      const result = await fresh.initialize();
      expect(result.ok).toBe(cap >= count);
      if (cap < count) {
        expect(result).toMatchObject({ error: { code: "DIAGNOSTIC_CAPACITY" } });
        expect(fresh.diagnostics()).toMatchObject({ readiness: "NOT_READY", health: "DEGRADED" });
        expect(fresh.snapshot().ok).toBe(false);
      } else {
        expect(take(result)).toEqual(s);
        take(await fresh.stop());
      }
    }
    const incompatible = await reader(f, { ...defaultPolicy, maxDiagnostics: count + 1 });
    expect((await incompatible.initialize()).ok).toBe(false);
    expect(fingerprint(take(await repo.load())[0])).toBe(fingerprint(s));
    if (physical !== null)
      expect(await readFile(join(path, "generation-00000001.json"), "utf8")).toBe(physical);
  },
);
it("M03 simultaneous compatible current resource limits cannot bypass diagnostics", async () => {
  const f = await fixture(),
    s = take(await f.service.publish(f.request()));
  take(await f.service.stop());
  const fresh = await reader(f, {
    ...defaultPolicy,
    maxDiagnostics: 1,
    maxRevisions: 1,
    maxSpecifications: 1,
    maxHistoryDepth: 1,
    maxInputBytes: Buffer.byteLength(JSON.stringify(s.prepared.request)),
    compatibleHistoryPolicies: [s.prepared.policyFingerprint],
  });
  expect((await fresh.initialize()).ok).toBe(false);
  expect(fresh.diagnostics().readiness).toBe("NOT_READY");
  expect(take(await f.repository.load())[0]).toEqual(s);
});
it("reentrant shutdown and dishonest ACK preserve real publication uncertainty", async () => {
  const memory = new MemorySpecificationRepository();
  let stop: unknown;
  const f = await fixture(defaultPolicy, {
    load: () => memory.load(),
    commit: async (s) => {
      stop = await f.service.stop();
      take(await memory.commit(s));
      return fail("LOST_ACK", "UNKNOWN");
    },
  });
  expect((await f.service.publish(f.request())).ok).toBe(false);
  expect(stop).toMatchObject({ ok: false, error: { code: "BUSY" } });
  expect(f.service.diagnostics()).toMatchObject({ pending: 1, readiness: "NOT_READY" });
  expect((await f.service.stop()).ok).toBe(false);
  expect((await f.service.stop()).ok).toBe(false);
  const fresh = await reader(f);
  expect(take(await fresh.initialize())?.fingerprint).toBe(
    (take(await memory.load())[0] as Snapshot).fingerprint,
  );
  take(await fresh.stop());
});

it("M02 original 4100-byte native and serialized payload reject budget 4099 before commit", async () => {
  const base = await fixture(),
    original = base.request();
  const missing = 4100 - Buffer.byteLength(JSON.stringify(original));
  expect(missing).toBeGreaterThan(0);
  original.rawEvidence += "x".repeat(missing);
  expect(Buffer.byteLength(JSON.stringify(original))).toBe(4100);
  for (const json of [false, true]) {
    let calls = 0;
    const repo = new MemorySpecificationRepository();
    const f = await fixture(
      { ...defaultPolicy, maxInputBytes: 4099 },
      {
        load: () => repo.load(),
        commit: (s) => {
          calls++;
          return repo.commit(s);
        },
      },
    );
    expect(
      (json
        ? await f.service.publishJson(JSON.stringify(original))
        : await f.service.publish(original)
      ).ok,
    ).toBe(false);
    expect(calls).toBe(0);
    expect(take(await repo.load())).toHaveLength(0);
    take(await f.service.publish(f.request()));
  }
});
