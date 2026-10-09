import { it, expect } from "vitest";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fingerprint, stableStringify } from "@ate/configuration";
import { VirtualClock } from "@ate/time";
import {
  defaultPolicy,
  normalize,
  prepare,
  compare,
  identityId,
  validateNormalizedDefinition,
  validateNormalizationTrace,
  FilesystemRegistryRepository,
  InstrumentRegistry,
  type InstrumentDefinition,
  type Normalization,
  type Policy,
  type Revision,
  type Result,
} from "@ate/instrument-registry";
import { root, setup, disk, equity, evidence, take, time } from "./fixtures.js";

const operations = ["register", "revise", "importRecords", "importJson"] as const;
type Operation = (typeof operations)[number];
function submit(
  registry: InstrumentRegistry,
  operation: Operation,
  d: InstrumentDefinition,
  before: Revision,
): Promise<Result<unknown>> {
  switch (operation) {
    case "register":
      return registry.register(d);
    case "revise":
      return registry.revise(
        before.instrumentId,
        before.revisionId,
        d,
        "normalization remediation",
      );
    case "importRecords":
      return registry.importRecords([d]);
    case "importJson":
      return registry.importJson(JSON.stringify([d]));
  }
}
function expanded(d: InstrumentDefinition): InstrumentDefinition {
  return {
    ...d,
    aliases: Array.from({ length: 6 }, (_, i) => ({
      kind: "DISPLAY",
      scope: `AUDIT${i}`,
      rule: "CASE",
      value: "\u0390".repeat(80),
      evidence: evidence(`unicode${i}`),
    })),
  };
}
async function counted(policy: Policy = defaultPolicy) {
  const path = root(),
    backing = new FilesystemRegistryRepository(path, policy.maxSnapshotBytes, policy.maxSnapshots);
  let calls = 0;
  const f = await setup(policy, {
    load: () => backing.load(),
    commit: (s) => {
      calls++;
      return backing.commit(s);
    },
  });
  return { ...f, path, backing, calls: () => calls };
}
function none(result: Result<unknown>) {
  expect(result).toEqual({ ok: false, error: { code: "INVALID_INPUT", commitment: "NONE" } });
}
for (const operation of operations) {
  it.each(["CASE", "NFC"] as const)(
    `H01 ${operation} rejects %s expansion before entry and preserves history/retry`,
    async (kind) => {
      const f = await counted(),
        before = take(await f.registry.register(equity()));
      const d = equity(operation === "revise" ? "A" : "B");
      if (kind === "CASE")
        d.aliases = [
          {
            kind: "DISPLAY",
            scope: "AUDIT",
            rule: "CASE",
            value: "ß".repeat(129),
            evidence: evidence(),
          },
        ];
      else d.displayName = "\u0344".repeat(129);
      const snapshot = take(f.registry.snapshot()),
        files = readdirSync(f.path).map((name) => [name, readFileSync(join(f.path, name), "utf8")]);
      none(await submit(f.registry, operation, d, before));
      expect(f.calls()).toBe(1);
      expect(
        readdirSync(f.path).map((name) => [name, readFileSync(join(f.path, name), "utf8")]),
      ).toEqual(files);
      expect(take(f.registry.snapshot())).toEqual(snapshot);
      expect(take(f.registry.get(before.instrumentId))).toEqual(before);
      expect(f.registry.diagnostics()).toMatchObject({
        readiness: "READY",
        health: "HEALTHY",
        recoveryRequired: false,
        generation: 1,
      });
      const fresh = await setup(defaultPolicy, new FilesystemRegistryRepository(f.path));
      expect(take(fresh.registry.snapshot())).toEqual(snapshot);
      const retry = equity(operation === "revise" ? "A" : "B");
      retry.displayName = "Valid retry";
      take(await submit(f.registry, operation, retry, before));
      expect(f.calls()).toBe(2);
      const recovered = await setup(defaultPolicy, new FilesystemRegistryRepository(f.path));
      expect(take(recovered.registry.snapshot())).toEqual(take(f.registry.snapshot()));
      take(await f.registry.stop());
      take(await f.registry.stop());
    },
  );
  it(`H02 ${operation} rejects field-valid cumulative byte expansion before entry`, async () => {
    const p = { ...defaultPolicy, maxRecordBytes: 4096 },
      f = await counted(p);
    const before = take(await f.registry.register(equity())),
      d = expanded(equity(operation === "revise" ? "A" : "B"));
    expect(Buffer.byteLength(JSON.stringify(d))).toBeLessThan(p.maxRecordBytes);
    const final = prepare(d, defaultPolicy).definition;
    expect(final.aliases.every((a) => a.value.length <= 256)).toBe(true);
    expect(Buffer.byteLength(stableStringify(final))).toBeGreaterThan(p.maxRecordBytes);
    const prior = take(f.registry.snapshot());
    none(await submit(f.registry, operation, d, before));
    expect(f.calls()).toBe(1);
    expect(readdirSync(f.path)).toHaveLength(1);
    expect(take(f.registry.snapshot())).toEqual(prior);
    expect(f.registry.diagnostics()).toMatchObject({ readiness: "READY", recoveryRequired: false });
    const fresh = await setup(p, new FilesystemRegistryRepository(f.path));
    expect(take(fresh.registry.snapshot())).toEqual(prior);
    const retry = equity(operation === "revise" ? "A" : "B");
    retry.displayName = "Valid retry";
    take(await submit(f.registry, operation, retry, before));
    expect(f.calls()).toBe(2);
    const recovered = await setup(p, new FilesystemRegistryRepository(f.path));
    expect(take(recovered.registry.snapshot())).toEqual(take(f.registry.snapshot()));
  });
}
for (const operation of operations) {
  it.each([-1, 0, 1])(`H02 ${operation} final UTF-8 boundary delta=%i`, async (delta) => {
    const d = equity(operation === "revise" ? "A" : "B");
    d.description = "x".repeat(1000);
    d.aliases = [
      {
        kind: "DISPLAY",
        scope: "AUDIT",
        rule: "CASE",
        value: "ß".repeat(20),
        evidence: evidence(),
      },
    ];
    const size = Buffer.byteLength(stableStringify(prepare(d, defaultPolicy).definition));
    const p = { ...defaultPolicy, maxRecordBytes: size },
      f = await counted(p);
    const before = take(await f.registry.register(equity()));
    d.description = "x".repeat(1000 + delta);
    expect(Buffer.byteLength(stableStringify(prepare(d, defaultPolicy).definition))).toBe(
      size + delta,
    );
    const result = await submit(f.registry, operation, d, before);
    if (delta > 0) {
      none(result);
      expect(f.calls()).toBe(1);
      expect(readdirSync(f.path)).toHaveLength(1);
    } else {
      take(result);
      expect(f.calls()).toBe(2);
    }
    const fresh = await setup(p, new FilesystemRegistryRepository(f.path));
    expect(take(fresh.registry.snapshot())).toEqual(take(f.registry.snapshot()));
  });
}
it.each(["\u0390", "ß", "cafe\u0301", " \u212b ", "eur/usd"])(
  "N1 output is idempotent and preserves original %s",
  (original) => {
    const n = normalize(original, "CASE");
    expect(n.original).toBe(original);
    expect(n.status).not.toBe("INVALID");
    expect(normalize(n.value, "CASE")).toMatchObject({ value: n.value, status: "UNCHANGED" });
  },
);
it.each(["ß".repeat(129), "\u0344".repeat(129)])(
  "N1 oversized transformation rejects without truncation %s",
  (original) => {
    const n = normalize(original, original.startsWith("ß") ? "CASE" : "EXACT");
    expect(n.status).toBe("INVALID");
    expect(n.original).toBe(original);
    expect(n.value).toBe("");
  },
);
it("shared final boundary checks optional metadata and does not treat character count as bytes", () => {
  const d = equity();
  d.description = "é".repeat(400);
  const p = { ...defaultPolicy, maxRecordBytes: Buffer.byteLength(stableStringify(d)) - 1 };
  expect(JSON.stringify(d).length).toBeLessThan(p.maxRecordBytes);
  expect(() => validateNormalizedDefinition(d, p)).toThrow();
});

const sorted = (trace: readonly Normalization[]) =>
  [...trace].sort((a, b) => compare(fingerprint(a), fingerprint(b)));
const traceFaults: readonly [
  string,
  (trace: readonly Normalization[]) => readonly Normalization[],
][] = [
  [
    "P29 contradictory original/value",
    (t) =>
      sorted(
        t.map((n) =>
          n.path === "displayName"
            ? { ...n, original: "Unrelated Instrument", value: "Invented normalized value" }
            : n,
        ),
      ),
  ],
  [
    "S24 individually valid unrelated trace",
    (t) =>
      sorted(
        t.map((n) =>
          n.path === "displayName"
            ? { ...n, original: " Fake Name ", value: "Fake Name", status: "NORMALIZED" }
            : n,
        ),
      ),
  ],
  [
    "wrong field/path",
    (t) => sorted(t.map((n) => (n.path === "displayName" ? { ...n, path: "identity.issuer" } : n))),
  ],
  [
    "wrong supported rule",
    (t) =>
      sorted(
        t.map((n) =>
          n.path === "displayName"
            ? { ...n, rule: "CASE", original: " Actual Name ", value: "ACTUAL NAME" }
            : n,
        ),
      ),
  ],
  ["unsupported rule", (t) => sorted(t.map((n) => ({ ...n, rule: "UNSUPPORTED_RULE" })))],
  [
    "wrong status",
    (t) => sorted(t.map((n) => (n.path === "displayName" ? { ...n, status: "UNCHANGED" } : n))),
  ],
  ["missing required trace", (t) => t.filter((n) => n.path !== "displayName")],
  ["duplicate trace", (t) => sorted([...t, t[0]!])],
  ["conflicting path reuse", (t) => sorted(t.map((n) => ({ ...n, path: "displayName" })))],
  ["permuted defined fingerprint ordering", (t) => [...t].reverse()],
  [
    "mixed path and legacy association",
    (t) =>
      sorted(
        t.map((n, i) => {
          if (i) return n;
          const { path: _path, ...legacy } = n;
          return legacy;
        }),
      ),
  ],
];
it.each(traceFaults)(
  "M01 rehashed %s rejects with filesystem evidence retained",
  async (_name, alter) => {
    const f = await disk(),
      d = equity();
    d.displayName = " Actual Name ";
    d.aliases = [
      { kind: "DISPLAY", scope: "AUDIT", rule: "CASE", value: " abc ", evidence: evidence() },
    ];
    take(await f.registry.register(d));
    const path = join(f.path, readdirSync(f.path)[0]!);
    const body = JSON.parse(readFileSync(path, "utf8")) as {
      revisions: { normalization: Normalization[] }[];
      fingerprint: string;
    };
    body.revisions[0]!.normalization = [...alter(body.revisions[0]!.normalization)];
    const { fingerprint: _old, ...content } = body;
    const bytes = JSON.stringify({ ...content, fingerprint: fingerprint(content) });
    writeFileSync(path, bytes);
    const registry = new InstrumentRegistry("synthetic-registry", {
      clock: new VirtualClock(time),
      repository: new FilesystemRegistryRepository(f.path),
      configuration: () => f.config,
    });
    const result = await registry.initialize();
    expect(result).toEqual({
      ok: false,
      error: { code: "RECOVERY_VALIDATION_FAILED", commitment: "UNKNOWN" },
    });
    expect(registry.diagnostics()).toMatchObject({
      readiness: "NOT_READY",
      health: "DEGRADED",
      recoveryRequired: true,
    });
    expect(registry.snapshot().ok).toBe(false);
    expect((await registry.stop()).ok).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(bytes);
  },
);
it.each([false, true])(
  "M01 valid changed/unchanged traces recover with originals; legacy=%s",
  async (legacy) => {
    const f = await disk(),
      d = equity();
    d.displayName = " Actual Name ";
    d.aliases = [
      { kind: "DISPLAY", scope: "AUDIT", rule: "CASE", value: "ABC", evidence: evidence() },
    ];
    const row = take(await f.registry.register(d));
    let expected: readonly Normalization[] = row.normalization;
    if (legacy) {
      expected = sorted(expected.map(({ path: _path, ...n }) => n));
      const file = join(f.path, readdirSync(f.path)[0]!);
      const s = take(f.registry.snapshot()),
        { fingerprint: _hash, ...content } = {
          ...s,
          revisions: [{ ...row, normalization: expected }],
        };
      writeFileSync(file, stableStringify({ ...content, fingerprint: fingerprint(content) }));
    }
    const fresh = await setup(defaultPolicy, new FilesystemRegistryRepository(f.path));
    const recovered = take(fresh.registry.get(row.instrumentId));
    expect(recovered).toBeDefined();
    if (!recovered) throw Error("Missing recovered revision");
    expect(recovered.normalization).toEqual(expected);
    expect(recovered.revisionId).toBe(row.revisionId);
    expect(identityId(recovered.definition.identity)).toBe(row.instrumentId);
    expect(recovered.normalization).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          original: " Actual Name ",
          value: "Actual Name",
          status: "NORMALIZED",
        }),
        expect.objectContaining({ original: "ABC", value: "ABC", status: "UNCHANGED" }),
      ]),
    );
  },
);
it("M01 valid decimal originals remain separate from canonical economic identity", () => {
  const d = {
    ...equity(),
    identity: {
      family: "BOND",
      kind: "CORPORATE",
      issuer: "Issuer",
      issuance: "Bond",
      maturity: "2030-01-01T00:00:00.000Z",
      currency: "USD",
      coupon: "5.00",
      seniority: "SENIOR",
    },
    classification: "BOND",
  };
  const p = prepare(d, defaultPolicy);
  expect(p.normalization).toContainEqual(
    expect.objectContaining({
      path: "identity.coupon",
      original: "5.00",
      value: "5",
      rule: "DECIMAL",
    }),
  );
  expect(() =>
    validateNormalizationTrace(p.definition, p.normalization, defaultPolicy),
  ).not.toThrow();
  expect(identityId(p.definition.identity)).toBe(
    identityId({ ...p.definition.identity, coupon: "5.0" } as typeof p.definition.identity),
  );
});
it("L01 P30 matched verified certificate is summarized without promoting general evidence", async () => {
  const path = root(),
    config = (await setup()).config;
  const claim = {
    ...evidence("identifier-original"),
    sourceType: "RECOGNIZED_AUTHORITY" as const,
    sourceId: "identifier-authority",
    verification: "VERIFIED" as const,
  };
  const registry = new InstrumentRegistry("synthetic-registry", {
    clock: new VirtualClock(time),
    repository: new FilesystemRegistryRepository(path),
    configuration: () => config,
    verifyEvidence: (e) => e.sourceId === claim.sourceId,
  });
  take(await registry.initialize());
  const d = equity();
  d.identifiers = [
    {
      scheme: "RESEARCH",
      scope: "AUDIT",
      authority: "identifier-authority",
      value: "native-key",
      evidence: claim,
    },
    {
      scheme: "RESEARCH",
      scope: "OTHER",
      authority: "other",
      value: "unmatched",
      evidence: evidence("unrelated"),
    },
  ];
  take(await registry.register(d));
  const result = take(
    registry.resolve({
      scheme: "RESEARCH",
      scope: "AUDIT",
      authority: "identifier-authority",
      value: "native-key",
    }),
  );
  expect(result).toMatchObject({ status: "EXACT_MATCH", reason: "VERIFIED_SCOPED_IDENTIFIER" });
  expect(result.evidence).toContainEqual(claim);
  expect(result.evidence).toContainEqual(d.evidence[0]);
  expect(result.evidence).not.toContainEqual(d.identifiers[1]!.evidence);
  expect(d.evidence[0]!.verification).toBe("UNVERIFIED");
});
it("L01 matched alias evidence is deterministically deduplicated with general evidence", async () => {
  const f = await setup(),
    d = equity(),
    shared = evidence("shared"),
    unmatched = evidence("unmatched");
  d.evidence = [shared];
  d.aliases = [
    { kind: "DISPLAY", scope: "AUDIT", rule: "CASE", value: " abc ", evidence: shared },
    { kind: "DISPLAY", scope: "OTHER", rule: "CASE", value: "ABC", evidence: unmatched },
  ];
  const row = take(await f.registry.register(d));
  const q = { aliasKind: "DISPLAY", scope: "AUDIT", rule: "CASE", value: "ABC" };
  const a = take(f.registry.resolve(q)),
    b = take(f.registry.resolve(q));
  expect(a).toEqual(b);
  expect(a.status).toBe("QUALIFIED_MATCH");
  expect(a.evidence).toEqual([shared]);
  expect(take(f.registry.resolve({ canonicalId: row.instrumentId })).evidence).toEqual([shared]);
});
it("PAIR delimiter removal cannot produce a non-idempotent combining sequence", async () => {
  const original = "a/\u0301",
    n = normalize(original, "PAIR");
  expect(n).toMatchObject({ original, value: "Á", status: "NORMALIZED" });
  expect(normalize(n.value, "PAIR")).toMatchObject({ value: "Á", status: "UNCHANGED" });
  const f = await disk(),
    d = equity();
  d.aliases = [
    { kind: "DISPLAY", scope: "AUDIT", rule: "PAIR", value: original, evidence: evidence() },
  ];
  const row = take(await f.registry.register(d));
  const fresh = await setup(defaultPolicy, new FilesystemRegistryRepository(f.path));
  expect(take(fresh.registry.get(row.instrumentId))).toEqual(row);
});
it("normalization rejects empty PAIR output rather than publishing an empty alias", async () => {
  const f = await counted(),
    d = equity();
  d.aliases = [
    { kind: "DISPLAY", scope: "AUDIT", rule: "PAIR", value: "/-", evidence: evidence() },
  ];
  expect(normalize("/-", "PAIR").status).toBe("INVALID");
  none(await f.registry.register(d));
  expect(f.calls()).toBe(0);
  expect(readdirSync(f.path)).toEqual([]);
});
it("H01 identifier NFC expansion also rejects before repository entry", async () => {
  const f = await counted(),
    d = equity();
  d.identifiers = [
    {
      scheme: "RESEARCH",
      scope: "AUDIT",
      authority: "fixture",
      value: "\u0344".repeat(129),
      evidence: evidence(),
    },
  ];
  none(await f.registry.register(d));
  expect(f.calls()).toBe(0);
  expect(readdirSync(f.path)).toEqual([]);
  take(await f.registry.register(equity()));
});
it("exact final 256-character CASE output is acknowledged and freshly recoverable", async () => {
  const f = await disk(),
    d = equity();
  d.aliases = [
    { kind: "DISPLAY", scope: "AUDIT", rule: "CASE", value: "ß".repeat(128), evidence: evidence() },
  ];
  const row = take(await f.registry.register(d));
  expect(row.definition.aliases[0]!.value).toHaveLength(256);
  const fresh = await setup(defaultPolicy, new FilesystemRegistryRepository(f.path));
  expect(take(fresh.registry.get(row.instrumentId))).toEqual(row);
});
it("M01 duplicate legacy transformations legitimately belong to distinct equal-valued fields", async () => {
  const f = await disk(),
    d = equity();
  d.displayName = "SAME";
  d.aliases = [
    { kind: "DISPLAY", scope: "AUDIT", rule: "EXACT", value: "SAME", evidence: evidence() },
  ];
  const row = take(await f.registry.register(d));
  const legacy = sorted(row.normalization.map(({ path: _path, ...n }) => n));
  expect(legacy[0]).toEqual(legacy[1]);
  const s = take(f.registry.snapshot()),
    { fingerprint: _hash, ...content } = { ...s, revisions: [{ ...row, normalization: legacy }] };
  const file = join(f.path, readdirSync(f.path)[0]!);
  writeFileSync(file, stableStringify({ ...content, fingerprint: fingerprint(content) }));
  const fresh = await setup(defaultPolicy, new FilesystemRegistryRepository(f.path));
  expect(take(fresh.registry.get(row.instrumentId))?.normalization).toEqual(legacy);
  const revised = { ...d, displayName: "Updated" };
  take(
    await fresh.registry.revise(
      row.instrumentId,
      row.revisionId,
      revised,
      "retain original legacy evidence",
    ),
  );
  const recovered = await setup(defaultPolicy, new FilesystemRegistryRepository(f.path));
  expect(take(recovered.registry.history(row.instrumentId))[0]!.normalization).toEqual(legacy);
  expect(take(recovered.registry.history(row.instrumentId))).toHaveLength(2);
});
