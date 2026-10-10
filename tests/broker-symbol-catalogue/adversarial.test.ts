import type { time } from "./fixtures.js";
import { it, expect } from "vitest";
import {
  defaultPolicy,
  validatePolicy,
  MemoryCatalogueRepository,
  fail,
  ok,
  BrokerSymbolCatalogue,
  type Repository,
  type Snapshot,
} from "@ate/broker-symbol-catalogue";
import { fingerprint } from "@ate/configuration";
import { setup, batch, take, effective } from "./fixtures.js";
const hostile: readonly [string, () => unknown][] = [
  ["null", () => null],
  ["primitive", () => 1],
  ["function", () => () => 0],
  ["bigint", () => 1n],
  ["date", () => new Date(0)],
  ["prototype", () => Object.create({ prototypeMarker: 1 }) as unknown],
  [
    "getter",
    () => {
      const b = batch();
      Object.defineProperty(b, "records", {
        get() {
          throw Error("GETTER_EXECUTED");
        },
        enumerable: true,
      });
      return b;
    },
  ],
  [
    "proxy",
    () =>
      new Proxy(batch(), {
        ownKeys() {
          throw Error("TRAP_EXECUTED");
        },
      }),
  ],
  [
    "cycle",
    () => {
      const b: Record<string, unknown> = { ...batch() };
      b["self"] = b;
      return b;
    },
  ],
  ["sparse", () => ({ ...batch(), records: Array(1) as unknown[] })],
  ["symbol-member", () => ({ ...batch(), [Symbol("hidden")]: 1 })],
  ["undefined", () => ({ ...batch(), missing: undefined })],
  ["non-enumerable", () => Object.defineProperty(batch(), "secret", { value: 1 })],
  ["nonfinite", () => ({ ...batch(), records: [{ rawSymbol: "A", digits: Infinity }] })],
  ["invalid-unicode", () => batch("one", ["\ud800"])],
  ["control", () => batch("one", ["A\u0000B"])],
  ["injected-credentials", () => ({ ...batch(), login: "not-authorized" })],
  [
    "unknown-family",
    () => ({ ...batch(), records: [{ rawSymbol: "A", declaredFamily: "BROKER_INVENTED" }] }),
  ],
  ["duplicate-symbol", () => batch("one", ["A", "A"])],
];
it.each(hostile)("atomic hostile boundary %s", async (_name, input) => {
  let commits = 0;
  const base = new MemoryCatalogueRepository(),
    repository: Repository = {
      load: () => base.load(),
      commit: (s) => {
        commits++;
        return base.commit(s);
      },
    };
  const { lab } = await setup(defaultPolicy, repository);
  const result = await lab.importNative(input());
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.commitment).toBe("NONE");
  expect(commits).toBe(0);
  expect(lab.diagnostics()).toMatchObject({
    readiness: "READY",
    health: "HEALTHY",
    generation: 0,
    recoveryRequired: false,
  });
  take(await lab.importNative(batch("valid")));
  expect(commits).toBe(1);
});
it.each([
  '{"schemaVersion":1,"schemaVersion":1}',
  '{"a":1,"\\u0061":2}',
  "[1,]",
  '{"a":1,}',
  '{"a":NaN}',
  " ".repeat(1025),
])("invalid or duplicate-key JSON %s", async (input) => {
  const f = await setup({ ...defaultPolicy, maxSourceBytes: 1024 });
  expect((await f.lab.importJson(input)).ok).toBe(false);
  expect(f.lab.diagnostics().recoveryRequired).toBe(false);
  expect(f.lab.diagnostics().generation).toBe(0);
});
it("depth, per-record and batch byte limits reject before publication", async () => {
  const f = await setup({ ...defaultPolicy, maxRecordBytes: 256, maxSourceBytes: 1024 });
  const b = batch();
  b.records[0]!.description = "X".repeat(256);
  expect((await f.lab.importNative(b)).ok).toBe(false);
  expect((await f.lab.importJson("X".repeat(1025))).ok).toBe(false);
  let deep: unknown = 1;
  for (let i = 0; i < 22; i++) deep = { next: deep };
  expect((await f.lab.importNative(deep)).ok).toBe(false);
  expect(f.lab.diagnostics().generation).toBe(0);
});
it.each([
  "maxNamespaces",
  "maxCataloguesPerNamespace",
  "maxRecordsPerCatalogue",
  "maxSnapshots",
] as const)("exact %s capacity passes; one beyond rejects without uncertainty", async (field) => {
  const f = await setup({ ...defaultPolicy, [field]: 1 });
  take(await f.lab.importNative(batch("one")));
  const b = batch("two", field === "maxRecordsPerCatalogue" ? ["A", "B"] : ["A"]);
  if (field === "maxNamespaces") b.namespace.brokerNamespaceId = "second";
  expect((await f.lab.importNative(b)).ok).toBe(false);
  expect(f.lab.diagnostics()).toMatchObject({
    generation: 1,
    readiness: "READY",
    recoveryRequired: false,
  });
});
it.each([
  { ...defaultPolicy, rules: [] },
  { ...defaultPolicy, rules: [...defaultPolicy.rules, defaultPolicy.rules[0]!] },
  { ...defaultPolicy, rules: [{ id: "suffix", version: "B1", case: "CASE", suffixes: ["m"] }] },
  {
    ...defaultPolicy,
    rules: [{ id: "suffix", version: "B1", case: "EXACT", suffixes: ["M", ".M"] }],
  },
  { ...defaultPolicy, maxSnapshots: 0 },
  { ...defaultPolicy, maxSourceBytes: Infinity },
])("invalid governed normalization/resource policy fails closed", (p) => {
  expect(() => validatePolicy(p)).toThrow();
});
it("untrusted evidenced source declarations cannot self-certify", async () => {
  const { lab } = await setup({ ...defaultPolicy, allowedQuality: ["EVIDENCED_RECORDED"] });
  const b = batch();
  b.source.quality = "EVIDENCED_RECORDED";
  expect((await lab.importNative(b)).ok).toBe(false);
  expect(lab.diagnostics().generation).toBe(0);
});
it("staleness, future evidence and unknown time never establish availability", async () => {
  for (const kind of ["UNKNOWN", "STALE", "FUTURE"] as const) {
    const f = await setup({ ...defaultPolicy, staleAfterMs: 1 });
    const b = batch();
    if (kind === "UNKNOWN") {
      delete b.source.observedAt;
      b.source.timeQuality = "UNKNOWN";
    } else
      b.source.observedAt = (
        kind === "STALE" ? "2026-10-09T09:00:00.000Z" : "2026-10-11T09:00:00.000Z"
      ) as typeof time;
    const c = take(await f.lab.importNative(b));
    const r = take(
      f.lab.query({
        kind: "OBSERVATIONS",
        catalogueFingerprint: c.fingerprint,
        offset: 0,
        limit: 1,
      }),
    );
    expect(r.records[0]).toMatchObject({
      freshness:
        kind === "UNKNOWN" ? "UNKNOWN" : kind === "STALE" ? "STALE_EVIDENCE" : "FUTURE_EVIDENCE",
      availabilityNow: "NOT_ESTABLISHED",
    });
  }
});
it("state authority absence rejects admission without durable entry", async () => {
  const f = await setup(defaultPolicy, new MemoryCatalogueRepository(), false);
  f.ports.authority.require = () =>
    ({ ok: false, error: { code: "PERSISTENCE_NOT_READY" } }) as ReturnType<
      typeof f.ports.authority.require
    >;
  expect((await f.lab.initialize()).ok).toBe(false);
  expect(f.lab.diagnostics().generation).toBe(0);
});
it("load exceptions and malformed certificates retain genuine recovery obligation", async () => {
  for (const mode of ["throw", "bad"] as const) {
    const repository: Repository = {
      load: () =>
        mode === "throw"
          ? Promise.reject(Error("IO"))
          : Promise.resolve({ ok: true, value: null } as unknown as Awaited<
              ReturnType<Repository["load"]>
            >),
      commit: () => Promise.resolve(fail("UNUSED")),
    };
    const f = await setup(defaultPolicy, repository, false);
    expect((await f.lab.initialize()).ok).toBe(false);
    expect(f.lab.diagnostics().recoveryRequired).toBe(true);
    expect((await f.lab.stop()).ok).toBe(false);
  }
});
it("recovery rejects accepted snapshot under drifted governance, wrong lab and truncation", async () => {
  const f = await setup();
  take(await f.lab.importNative(batch()));
  const s = take(f.lab.snapshot())!;
  for (const mode of ["drift", "lab", "truncated"] as const) {
    const copy = JSON.parse(JSON.stringify(s)) as Snapshot;
    if (mode === "truncated") copy.catalogues = [];
    const repository: Repository = {
      load: () => Promise.resolve(ok([copy])),
      commit: () => Promise.resolve(ok(copy)),
    };
    const fresh = new BrokerSymbolCatalogue(mode === "lab" ? "other" : "offline-lab", {
      ...f.ports,
      repository,
      configuration:
        mode === "drift"
          ? () => ({ ...f.ports.configuration(), fingerprint: fingerprint("other") })
          : f.ports.configuration,
    });
    expect((await fresh.initialize()).ok).toBe(false);
    expect(fresh.diagnostics().recoveryRequired).toBe(true);
  }
});
it("governance read drift cannot clear durable history", async () => {
  const f = await setup();
  take(await f.lab.importNative(batch()));
  const before = take(await f.repository.load());
  f.setConfiguration(await effective({ ...defaultPolicy, maxSnapshots: 1 }));
  expect((await f.lab.importNative(batch("two"))).ok).toBe(false);
  expect(take(await f.repository.load())).toEqual(before);
});

it("record timestamp cannot promote UNKNOWN source time quality to fresh evidence", async () => {
  const f = await setup(),
    b = batch();
  delete b.source.observedAt;
  b.source.timeQuality = "UNKNOWN";
  b.records[0]!.observedAt = f.clock.now();
  const c = take(await f.lab.importNative(b));
  expect(c.observations[0]!.raw.observedAt).toBe(f.clock.now());
  expect(
    take(
      f.lab.query({
        kind: "OBSERVATIONS",
        catalogueFingerprint: c.fingerprint,
        offset: 0,
        limit: 1,
      }),
    ).records[0],
  ).toMatchObject({ freshness: "UNKNOWN", availabilityNow: "NOT_ESTABLISHED" });
});
