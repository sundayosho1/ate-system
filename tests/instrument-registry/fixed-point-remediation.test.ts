import { it, expect } from "vitest";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fingerprint, stableStringify } from "@ate/configuration";
import { VirtualClock, mustParseUtc } from "@ate/time";
import {
  defaultPolicy,
  normalize,
  prepare,
  identityId,
  compare,
  FilesystemRegistryRepository,
  InstrumentRegistry,
  type InstrumentDefinition,
  type Repository,
  type Policy,
  type Revision,
  type Result,
  type Snapshot,
} from "@ate/instrument-registry";
import { root, setup, equity, evidence, take, time } from "./fixtures.js";

const operations = ["register", "revise", "importRecords", "importJson"] as const;
type Operation = (typeof operations)[number];
const alias = (value: string) => ({
  kind: "DISPLAY" as const,
  scope: "FIXED_POINT",
  rule: "PAIR" as const,
  value,
  evidence: evidence(value),
});
function submit(
  r: InstrumentRegistry,
  op: Operation,
  d: InstrumentDefinition,
  old: Revision,
): Promise<Result<unknown>> {
  if (op === "register") return r.register(d);
  if (op === "revise")
    return r.revise(old.instrumentId, old.revisionId, d, "fixed-point regression");
  return op === "importRecords"
    ? r.importRecords([equity("C"), d])
    : r.importJson(JSON.stringify([equity("C"), d]));
}
const files = (path: string) =>
  readdirSync(path)
    .sort()
    .map((name) => [name, readFileSync(join(path, name), "utf8")]);
async function counted(p: Policy = defaultPolicy) {
  const path = root(),
    backing = new FilesystemRegistryRepository(
      path,
      p.maxSnapshotBytes,
      p.maxSnapshots,
      p.maxRetainedSnapshotBytes,
    );
  let calls = 0;
  const repository: Repository = {
    load: () => backing.load(),
    commit: (s) => {
      calls++;
      return backing.commit(s);
    },
  };
  return { ...(await setup(p, repository)), path, backing, calls: () => calls };
}
async function seeded(p: Policy = defaultPolicy) {
  const f = await counted(p);
  take(await f.registry.register(equity("BASE")));
  const first = take(await f.registry.register(equity()));
  const old = take(
    await f.registry.revise(
      first.instrumentId,
      first.revisionId,
      { ...equity(), displayName: "Earlier history" },
      "prior valid revision",
    ),
  );
  return { ...f, old };
}
function fresh(f: Awaited<ReturnType<typeof counted>>, p: Policy = defaultPolicy) {
  return setup(
    p,
    new FilesystemRegistryRepository(
      f.path,
      p.maxSnapshotBytes,
      p.maxSnapshots,
      p.maxRetainedSnapshotBytes,
    ),
  );
}
const accepted = [
  ["/ eur/usd /", "EURUSD"],
  ["/ a/", "A"],
  ["-- a /-", "A"],
  ["/\u2003e/\u0301\u00a0/", "É"],
  ["/ eur usd /", "EUR USD"],
  ["/\u0390/", "Ϊ\u0301"],
  ["/ß/", "SS"],
] as const;
for (const op of operations) {
  it.each(accepted)(`${op}: honest ACK and repeated recovery for %s`, async (raw, expected) => {
    const f = await seeded(),
      before = take(f.registry.snapshot())!,
      originalFiles = files(f.path);
    const d = equity(op === "revise" ? "A" : "B");
    d.aliases = [alias(raw)];
    take(await submit(f.registry, op, d, f.old));
    expect(f.calls()).toBe(4);
    const s = take(f.registry.snapshot())!;
    expect(s.generation).toBe(4);
    const { fingerprint: _hash, ...content } = s;
    expect(s.fingerprint).toBe(fingerprint(content));
    expect(s.revisions.slice(0, before.revisions.length)).toEqual(before.revisions);
    expect(files(f.path).slice(0, 3)).toEqual(originalFiles);
    const row = take(f.registry.get(identityId(d.identity)))!;
    expect(row.definition.aliases[0]!.value).toBe(expected);
    expect(row.normalization).toContainEqual({
      path: "aliases.0.value",
      original: raw,
      value: expected,
      rule: "PAIR",
      version: "N1",
      status: "NORMALIZED",
    });
    for (let i = 0; i < 3; i++) {
      const recovered = await fresh(f);
      expect(recovered.registry.diagnostics()).toMatchObject({
        readiness: "READY",
        health: "HEALTHY",
        generation: 4,
        recoveryRequired: false,
      });
      expect(take(recovered.registry.snapshot())).toEqual(s);
      expect(take(recovered.registry.get(row.instrumentId))).toEqual(row);
      expect(take(recovered.registry.snapshotAt(before.fingerprint))).toEqual(before);
      take(await recovered.registry.stop());
      take(await recovered.registry.stop());
    }
    expect(files(f.path).slice(0, 3)).toEqual(originalFiles);
  });
  it.each(["/ /", "-\u2003/-", "ß".repeat(128) + "a"])(
    `${op}: empty/overflow rejection %s preserves history and valid retry`,
    async (raw) => {
      const f = await seeded(),
        before = take(f.registry.snapshot()),
        originalFiles = files(f.path),
        d = equity(op === "revise" ? "A" : "B");
      d.aliases = [alias(raw)];
      expect(await submit(f.registry, op, d, f.old)).toEqual({
        ok: false,
        error: { code: "INVALID_INPUT", commitment: "NONE" },
      });
      expect(f.calls()).toBe(3);
      expect(files(f.path)).toEqual(originalFiles);
      expect(take(f.registry.snapshot())).toEqual(before);
      expect(f.registry.diagnostics()).toMatchObject({
        readiness: "READY",
        health: "HEALTHY",
        generation: 3,
      });
      d.aliases = [alias("/ good /")];
      take(await submit(f.registry, op, d, f.old));
      expect(f.calls()).toBe(4);
      expect(take((await fresh(f)).registry.snapshot())).toEqual(take(f.registry.snapshot()));
    },
  );
  it(`${op}: final multibyte expansion rejects before entry with exact-byte retry`, async () => {
    const d = equity(op === "revise" ? "A" : "B");
    d.description = "x".repeat(1000);
    d.aliases = [alias("ȿ".repeat(80))];
    const size = Buffer.byteLength(stableStringify(prepare(d, defaultPolicy).definition));
    expect(Buffer.byteLength(stableStringify(d))).toBeLessThan(size - 1);
    const p = { ...defaultPolicy, maxRecordBytes: size - 1 },
      f = await seeded(p),
      before = files(f.path);
    expect(await submit(f.registry, op, d, f.old)).toEqual({
      ok: false,
      error: { code: "INVALID_INPUT", commitment: "NONE" },
    });
    expect(files(f.path)).toEqual(before);
    expect(f.calls()).toBe(3);
    d.description = d.description.slice(1);
    expect(Buffer.byteLength(stableStringify(prepare(d, defaultPolicy).definition))).toBe(
      p.maxRecordBytes,
    );
    take(await submit(f.registry, op, d, f.old));
    expect(take((await fresh(f, p)).registry.snapshot())).toEqual(take(f.registry.snapshot()));
  });
}
it.each(["EXACT", "CASE", "PAIR"] as const)(
  "%s independent corpus reaches a fixed point without deleting interior spaces",
  (rule) => {
    const values = [
      ...accepted.map(([v]) => v),
      "a b",
      "a/\u0301",
      "\u0344",
      "ǰ",
      "ﬃ",
      "\u1f80",
      "Å",
      "ß".repeat(128),
      "ß".repeat(128) + "a",
      " / / ",
      "\u00a0x\u00a0",
      "-/- a --/",
      "\u212b",
      "EURUSD",
    ];
    for (const raw of values) {
      const n = normalize(raw, rule);
      if (n.status === "INVALID") {
        expect(n.value).toBe("");
        continue;
      }
      expect(n.value).toBe(n.value.normalize("NFC"));
      expect(n.value.length).toBeLessThanOrEqual(256);
      let value = n.value;
      for (let i = 0; i < 4; i++) {
        const again = normalize(value, rule);
        expect(again).toMatchObject({ status: "UNCHANGED", value });
        value = again.value;
      }
    }
    expect(normalize("a b", rule).value).toBe(rule === "EXACT" ? "a b" : "A B");
  },
);
it("all supported ECMAScript whitespace boundaries are stable after PAIR removal", () => {
  for (const ws of [
    " ",
    "\u00a0",
    "\u1680",
    ...Array.from({ length: 11 }, (_, i) => String.fromCharCode(0x2000 + i)),
    "\u2028",
    "\u2029",
    "\u202f",
    "\u205f",
    "\u3000",
    "\ufeff",
  ]) {
    expect(normalize(`/ ${ws}a${ws} /`, "PAIR")).toMatchObject({
      value: "A",
      status: "NORMALIZED",
    });
    expect(normalize(`/ ${ws} /`, "PAIR").status).toBe("INVALID");
  }
});
it("exact maximum PAIR field recovers; economic identity stays separate from aliases", async () => {
  const f = await counted(),
    d = equity();
  d.aliases = [alias("ß".repeat(128))];
  const row = take(await f.registry.register(d));
  expect(row.definition.aliases[0]!.value).toHaveLength(256);
  expect(row.instrumentId).toBe(identityId(equity().identity));
  expect(take((await fresh(f)).registry.get(row.instrumentId))).toEqual(row);
});
it.each([false, true])(
  "valid stable PAIR history survives with legacy=%s and further revision",
  async (legacy) => {
    const f = await counted(),
      d = equity();
    d.aliases = [alias("eur/usd")];
    const row = take(await f.registry.register(d));
    let expected = row.normalization;
    if (legacy) {
      expected = row.normalization
        .map(({ path: _path, ...n }) => n)
        .sort((a, b) => compare(fingerprint(a), fingerprint(b)));
      const s = take(f.registry.snapshot())!,
        { fingerprint: _old, ...content } = {
          ...s,
          revisions: [{ ...row, normalization: expected }],
        };
      writeFileSync(
        join(f.path, "generation-00000001.json"),
        stableStringify({ ...content, fingerprint: fingerprint(content) }),
      );
    }
    const oldFiles = files(f.path),
      recovered = await fresh(f);
    expect(take(recovered.registry.get(row.instrumentId))!.normalization).toEqual(expected);
    take(
      await recovered.registry.revise(
        row.instrumentId,
        row.revisionId,
        { ...d, displayName: "Updated stable history" },
        "retain trace",
      ),
    );
    const restarted = await fresh(f);
    expect(take(restarted.registry.history(row.instrumentId))[0]!.normalization).toEqual(expected);
    expect(files(f.path).slice(0, 1)).toEqual(oldFiles);
  },
);
it("contradictory rehashed trace stays fenced without rewriting files", async () => {
  const f = await counted(),
    d = equity();
  d.aliases = [alias("/ eur/usd /")];
  const row = take(await f.registry.register(d)),
    s = take(f.registry.snapshot())!;
  const trace = row.normalization
    .map((n) => (n.rule === "PAIR" ? { ...n, original: "/ gbp/usd /" } : n))
    .sort((a, b) => compare(fingerprint(a), fingerprint(b)));
  const { fingerprint: _old, ...content } = { ...s, revisions: [{ ...row, normalization: trace }] };
  writeFileSync(
    join(f.path, "generation-00000001.json"),
    stableStringify({ ...content, fingerprint: fingerprint(content) }),
  );
  const unchanged = files(f.path),
    registry = new InstrumentRegistry("synthetic-registry", {
      clock: new VirtualClock(time),
      repository: f.backing,
      configuration: () => f.config,
    });
  expect(await registry.initialize()).toEqual({
    ok: false,
    error: { code: "RECOVERY_VALIDATION_FAILED", commitment: "UNKNOWN" },
  });
  expect(registry.diagnostics()).toMatchObject({ readiness: "NOT_READY", health: "DEGRADED" });
  expect((await registry.stop()).ok).toBe(false);
  expect(files(f.path)).toEqual(unchanged);
});
it("old noncanonical acknowledged PAIR root is not migrated or silently repaired", async () => {
  const f = await counted(),
    d = equity();
  d.aliases = [alias("/ eur/usd /")];
  const row = take(await f.registry.register(d)),
    s = take(f.registry.snapshot())!;
  const definition = {
    ...row.definition,
    aliases: [{ ...row.definition.aliases[0]!, value: " EURUSD " }],
  };
  const normalization = row.normalization
    .map((n) => (n.rule === "PAIR" ? { ...n, value: " EURUSD " } : n))
    .sort((a, b) => compare(fingerprint(a), fingerprint(b)));
  const {
    revisionId: _r,
    fingerprint: _f,
    recordedAt: _t,
    clockProvenance: _c,
    normalization: _n,
    ...semantic
  } = row;
  const revisionId = fingerprint({ ...semantic, definition });
  const { fingerprint: _s, ...content } = {
    ...s,
    revisions: [{ ...row, definition, normalization, revisionId, fingerprint: revisionId }],
  };
  writeFileSync(
    join(f.path, "generation-00000001.json"),
    stableStringify({ ...content, fingerprint: fingerprint(content) }),
  );
  const before = files(f.path),
    registry = new InstrumentRegistry("synthetic-registry", {
      clock: new VirtualClock(time),
      repository: f.backing,
      configuration: () => f.config,
    });
  expect((await registry.initialize()).ok).toBe(false);
  expect(registry.diagnostics().recoveryRequired).toBe(true);
  expect((await registry.stop()).ok).toBe(false);
  expect(files(f.path)).toEqual(before);
});
it("lost genuine ACK retains UNKNOWN and actual canonical generation recovers", async () => {
  const path = root(),
    backing = new FilesystemRegistryRepository(path);
  const f = await setup(defaultPolicy, {
    load: () => backing.load(),
    commit: async (s) => {
      take(await backing.commit(s));
      return { ok: false, error: { code: "LOST_ACK", commitment: "UNKNOWN" } };
    },
  });
  const d = equity();
  d.aliases = [alias("/ eur/usd /")];
  expect(await f.registry.register(d)).toEqual({
    ok: false,
    error: { code: "LOST_ACK", commitment: "UNKNOWN" },
  });
  expect(f.registry.diagnostics()).toMatchObject({
    generation: 0,
    readiness: "NOT_READY",
    recoveryRequired: true,
  });
  expect((await f.registry.stop()).ok).toBe(false);
  expect((await f.registry.stop()).ok).toBe(false);
  const recovered = await setup(defaultPolicy, backing);
  expect(take(recovered.registry.get(identityId(d.identity)))!.definition.aliases[0]!.value).toBe(
    "EURUSD",
  );
});
it("cross-policy fresh recovery rejects instead of reinterpreting accepted history", async () => {
  const f = await counted();
  take(await f.registry.register(equity()));
  const before = files(f.path);
  const config = (await setup({ ...defaultPolicy, maxAliases: 31 })).config;
  const registry = new InstrumentRegistry("synthetic-registry", {
    clock: new VirtualClock(time),
    repository: f.backing,
    configuration: () => config,
  });
  expect((await registry.initialize()).ok).toBe(false);
  expect(files(f.path)).toEqual(before);
});
function bond(): InstrumentDefinition {
  return {
    ...equity(),
    identity: {
      family: "BOND",
      kind: "CORPORATE",
      issuer: "synthetic-issuer",
      issuance: "ONE",
      maturity: mustParseUtc("2031-01-01T00:00:00.000Z"),
      currency: "USD",
      coupon: "5",
      seniority: "SENIOR",
    },
    classification: "BOND",
  };
}
it.each([false, true])(
  "Q01-A canonical parsed definition authority; rehashRaw=%s",
  async (rehashRaw) => {
    const d = bond(),
      size = Buffer.byteLength(stableStringify(d)),
      p = { ...defaultPolicy, maxRecordBytes: size },
      f = await counted(p);
    const row = take(await f.registry.register(d)),
      s = take(f.registry.snapshot())!,
      file = join(f.path, "generation-00000001.json");
    const raw = JSON.parse(readFileSync(file, "utf8")) as Snapshot & {
      revisions: { definition: { identity: { coupon: string } } }[];
    };
    (raw.revisions[0]!.definition.identity as { coupon: string }).coupon = "5.000000000000";
    expect(Buffer.byteLength(stableStringify(raw.revisions[0]!.definition))).toBe(size + 13);
    if (rehashRaw) {
      const { fingerprint: _hash, ...content } = raw;
      writeFileSync(file, stableStringify({ ...content, fingerprint: fingerprint(content) }));
    } else writeFileSync(file, stableStringify(raw));
    const before = files(f.path),
      registry = new InstrumentRegistry("synthetic-registry", {
        clock: new VirtualClock(time),
        repository: f.backing,
        configuration: () => f.config,
      });
    const result = await registry.initialize();
    if (rehashRaw) {
      expect(result.ok).toBe(false);
      expect(registry.diagnostics().recoveryRequired).toBe(true);
    } else {
      take(result);
      expect(take(registry.get(row.instrumentId))).toEqual(row);
      expect(take(registry.snapshot())).toEqual(s);
      take(await registry.stop());
    }
    expect(files(f.path)).toEqual(before);
  },
);
it("Q01-A physical full-snapshot limit applies before canonical decimal parse", async () => {
  const f = await counted(),
    d = bond();
  take(await f.registry.register(d));
  const file = join(f.path, "generation-00000001.json"),
    raw = readFileSync(file, "utf8");
  writeFileSync(file, raw + " ".repeat(4097));
  const before = files(f.path),
    bounded = new FilesystemRegistryRepository(f.path, 4096),
    registry = new InstrumentRegistry("synthetic-registry", {
      clock: new VirtualClock(time),
      repository: bounded,
      configuration: () => f.config,
    });
  expect(await registry.initialize()).toEqual({
    ok: false,
    error: { code: "RECOVERY_REQUIRED", commitment: "UNKNOWN" },
  });
  expect(files(f.path)).toEqual(before);
});

it("Prompt16 catalogue and quality lineage remain unchanged by corrected PAIR association", async () => {
  const { historicalFixture } = await import("../market-replay/historical-fixture.js");
  const { associateResearchEvidence } = await import("@ate/instrument-registry");
  const owner = await historicalFixture({
    rows: "2026-10-08T10:00:00.000Z,TEST,10,11\n2026-10-08T10:01:00.000Z,TEST,12,13",
  });
  const beforeResult = await owner.catalogueRepository.createSnapshot();
  expect(beforeResult.ok).toBe(true);
  if (!beforeResult.ok) throw Error(beforeResult.error.code);
  const before = beforeResult.value,
    f = await counted(),
    d = equity();
  d.aliases = [alias("/ eur/usd /")];
  const row = take(await f.registry.register(d)),
    s = take(f.registry.snapshot())!,
    entry = owner.registration.entry;
  const reference = take(
    associateResearchEvidence(f.registry, {
      schemaVersion: 1,
      owner: "DATASET_CATALOGUE",
      ownerReference: entry.version.versionId,
      ownerFingerprint: entry.version.versionFingerprint,
      registryId: "synthetic-registry",
      instrumentId: row.instrumentId,
      revisionId: row.revisionId,
      registrySnapshot: s.fingerprint,
    }),
  );
  expect(reference.ownerFingerprint).toBe(entry.version.versionFingerprint);
  const afterResult = await owner.catalogueRepository.createSnapshot();
  expect(afterResult.ok).toBe(true);
  if (!afterResult.ok) throw Error(afterResult.error.code);
  expect(afterResult.value).toEqual(before);
  expect(take((await fresh(f)).registry.get(row.instrumentId))).toEqual(row);
});
it.each(["VERIFIED_POINT_IN_TIME", "EVENT_TIME_RECONSTRUCTION"] as const)(
  "Prompt19 %s replay and recovery stay identical with corrected PAIR revisions",
  async (mode) => {
    const { acceptanceFixture } = await import("../market-replay/acceptance-fixture.js");
    const { ReplayController, FilesystemReplayCheckpointRepository } =
      await import("@ate/market-replay");
    const owner = await acceptanceFixture(mode, false),
      spec = fingerprint(owner.spec),
      inputs = fingerprint(owner.inputs);
    const left = root(),
      right = root(),
      controller = (path: string) =>
        new ReplayController(
          owner.spec,
          owner.inputs,
          new FilesystemReplayCheckpointRepository(
            path,
            new VirtualClock(time),
            owner.spec.resourceLimits,
          ),
        );
    const a = controller(left),
      b = controller(right);
    expect((await a.initialize()).ok).toBe(true);
    expect((await b.initialize()).ok).toBe(true);
    const f = await counted(),
      d = equity();
    d.aliases = [alias("/ eur/usd /")];
    const row = take(await f.registry.register(d));
    for (let i = 0; i < 4; i++) {
      const one = await a.stepEvent(),
        two = await b.stepEvent();
      expect(one.ok).toBe(true);
      expect(two).toEqual(one);
    }
    take(
      await f.registry.revise(
        row.instrumentId,
        row.revisionId,
        { ...d, displayName: "Updated description" },
        "non-replay metadata",
      ),
    );
    expect(fingerprint(owner.spec)).toBe(spec);
    expect(fingerprint(owner.inputs)).toBe(inputs);
    const ar = controller(left),
      br = controller(right);
    expect((await ar.initialize()).ok).toBe(true);
    expect((await br.initialize()).ok).toBe(true);
    expect(await ar.stepEvent()).toEqual(await br.stepEvent());
  },
);
