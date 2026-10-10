import { it, expect } from "vitest";
import { fingerprint } from "@ate/configuration";
import {
  defaultPolicy,
  comparisonKeys,
  prepareBatch,
  type Policy,
} from "@ate/broker-symbol-catalogue";
import { setup, batch, take } from "./fixtures.js";
it("publishes immutable acknowledged observations and exact provenance", async () => {
  const { lab } = await setup();
  const b = batch(),
    c = take(await lab.importNative(b));
  expect(c.inputFingerprint).toBe(fingerprint(prepareBatch(b, defaultPolicy)));
  expect(c.observations[0]!.raw).toEqual(b.records[0]);
  expect(c.namespace).toEqual(b.namespace);
  expect(Object.isFrozen(c.observations[0]!.raw)).toBe(true);
  expect(lab.diagnostics()).toMatchObject({ readiness: "READY", health: "HEALTHY", generation: 1 });
  expect(take(lab.catalogue(c.fingerprint))).toEqual(c);
});
it("identical batch is idempotent while conflicting identity is atomic rejection", async () => {
  const { lab } = await setup();
  const c = take(await lab.importNative(batch()));
  expect(take(await lab.importNative(batch()))).toEqual(c);
  expect((await lab.importNative(batch("batch-1", ["DIFFERENT"]))).ok).toBe(false);
  expect(lab.diagnostics().generation).toBe(1);
});
it("record order produces deterministic fingerprints", async () => {
  const a = await setup(),
    b = await setup();
  const x = batch("batch-1", ["B", "A"]),
    y = batch("batch-1", ["A", "B"]);
  y.source = x.source;
  expect(take(await a.lab.importNative(x))).toEqual(take(await b.lab.importNative(y)));
});
it("same labels in different namespaces never merge", async () => {
  const { lab } = await setup();
  const a = take(await lab.importNative(batch()));
  const b = batch("batch-2");
  b.namespace.brokerNamespaceId = "another";
  const c = take(await lab.importNative(b));
  expect(c.namespaceKey).not.toBe(a.namespaceKey);
  expect(c.version).toBe(1);
  expect(take(lab.query({ kind: "NAMESPACES", offset: 0, limit: 10 })).total).toBe(2);
});
it("namespace display changes require a new identity rather than silent relabeling", async () => {
  const { lab } = await setup();
  take(await lab.importNative(batch()));
  const b = batch("batch-2");
  b.namespace.brokerLabel = "Changed";
  expect((await lab.importNative(b)).ok).toBe(false);
});
it("governed JSON and native imports agree", async () => {
  const a = await setup(),
    b = await setup();
  expect(take(await a.lab.importNative(batch()))).toEqual(
    take(await b.lab.importJson(JSON.stringify(batch()))),
  );
});
it("suffix collisions retain both raw symbols with no inferred economic identity", async () => {
  const p: Policy = {
    ...defaultPolicy,
    rules: [{ id: "suffix", version: "B1", case: "CASE", suffixes: [".M"] }],
  };
  const { lab } = await setup(p);
  const c = take(await lab.importNative(batch("batch-1", ["EURUSD", "EURUSD.m"])));
  expect(c.collisions).toEqual([
    { ruleId: "suffix", key: "EURUSD", rawSymbols: ["EURUSD", "EURUSD.m"] },
  ]);
  expect(c.observations.map((o) => o.raw.rawSymbol)).toEqual(["EURUSD", "EURUSD.m"]);
  expect(take(lab.snapshot())!.proposals).toHaveLength(0);
});
it.each([".M", "EURUSD.M.M", "EURUSD.M "])(
  "rejects empty or unstable suffix %s atomically",
  async (raw) => {
    const p: Policy = {
      ...defaultPolicy,
      rules: [{ id: "suffix", version: "B1", case: "CASE", suffixes: [".M"] }],
    };
    expect(() => comparisonKeys(raw, p)).toThrow();
    const { lab } = await setup(p);
    expect((await lab.importNative(batch("batch-1", [raw]))).ok).toBe(false);
    expect(lab.diagnostics().generation).toBe(0);
  },
);
it.each([
  ["point", "0"],
  ["volumeStep", "0"],
  ["contractSize", "0"],
  ["minimumVolume", "0"],
] as const)("retains contradictory %s without approving its quality", async (k, v) => {
  const { lab } = await setup(),
    b = batch();
  b.records[0]![k] = v;
  const o = take(await lab.importNative(b)).observations[0]!;
  expect(o.raw[k]).toBe(v);
  expect(o.quality.flags.length).toBeGreaterThan(0);
});
it("preserves decimal spelling and missing fields; no canonical-decimal invention", async () => {
  const { lab } = await setup(),
    b = batch();
  b.records[0]!.contractSize = "1.00";
  const c = take(await lab.importNative(b));
  expect(c.observations[0]!.raw.contractSize).toBe("1.00");
  expect(c.observations[0]!.raw.visible).toBeUndefined();
  expect(c.observations[0]!.classification.family).toBe("UNKNOWN");
});
it("conservative complete versus partial absence and native rename evidence", async () => {
  const { lab } = await setup();
  const a = batch("one", ["OLD", "KEEP"]);
  a.records[0]!.sourceNativeId = "stable";
  const before = take(await lab.importNative(a));
  const b = batch("two", ["NEW", "KEEP"]);
  b.records[0]!.sourceNativeId = "stable";
  const after = take(await lab.importNative(b));
  expect(
    take(lab.compare(before.fingerprint, after.fingerprint)).differences.some(
      (d) => d.kind === "RENAMED_BY_SOURCE_NATIVE_ID",
    ),
  ).toBe(true);
  const partial = batch("three", ["KEEP"]);
  partial.source.completeness = "PARTIAL";
  const p = take(await lab.importNative(partial));
  expect(
    take(lab.compare(after.fingerprint, p.fingerprint)).differences.some(
      (d) => d.kind === "NOT_OBSERVED_IN_PARTIAL_CATALOGUE",
    ),
  ).toBe(true);
});
it("historical misses never fallback to current", async () => {
  const { lab } = await setup();
  take(await lab.importNative(batch()));
  expect(lab.catalogue("0".repeat(64)).ok).toBe(false);
  expect(lab.snapshot("0".repeat(64)).ok).toBe(false);
  expect(
    lab.query({ kind: "OBSERVATIONS", catalogueFingerprint: "0".repeat(64), offset: 0, limit: 1 })
      .ok,
  ).toBe(false);
});
it("pagination rejects unbounded, invalid and hostile requests", async () => {
  const { lab } = await setup();
  take(await lab.importNative(batch("one", ["A", "B"])));
  const first = take(lab.query({ kind: "OBSERVATIONS", offset: 0, limit: 1 }));
  expect(first.total).toBe(2);
  expect(first.nextOffset).toBe(1);
  expect(take(lab.query({ kind: "OBSERVATIONS", offset: 1, limit: 1 })).nextOffset).toBeNull();
  for (const limit of [0, -1, 101, Infinity])
    expect(lab.query({ kind: "OBSERVATIONS", offset: 0, limit }).ok).toBe(false);
});

it("full comparison fingerprint binds provenance, snapshot context and mapping evidence", async () => {
  const f = await setup(),
    a = take(await f.lab.importNative(batch("one"))),
    b = take(await f.lab.importNative(batch("two", ["OTHER"]))),
    result = take(f.lab.compare(a.fingerprint, b.fingerprint));
  const { fingerprint: full, ...body } = result;
  expect(full).toBe(fingerprint(body));
  expect(result.laboratorySnapshot).toBe(take(f.lab.snapshot())!.fingerprint);
  expect(result.sourceEvidence.before).toEqual(a.source);
  expect(result.sourceEvidence.after).toEqual(b.source);
  expect(result.differenceFingerprint).not.toBe(full);
});
