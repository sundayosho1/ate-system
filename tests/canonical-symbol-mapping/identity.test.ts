import { it, expect } from "vitest";
import { mustParseUtc } from "@ate/time";
import { defaultPolicy } from "@ate/canonical-symbol-mapping";
import { fixture, addIdentity, take, proof, evidence } from "./fixtures.js";
it.each(["strike", "kind", "expiry", "underlying"])(
  "actual option %s material disagreement is conservative",
  async (field) => {
    const f = await fixture(),
      underlying = take(f.base.canonical.registry.search())[0]!.instrumentId;
    await addIdentity(
      f,
      "OPT",
      {
        family: "OPTION",
        kind: "CALL",
        underlying,
        venue: "XNAS",
        expiry: mustParseUtc("2027-01-01T00:00:00.000Z"),
        strike: "100",
        currency: "USD",
        contract: "OPT",
      },
      "option",
    );
    await f.import("option", "OPT", "options", ["option"]);
    const identity = {
      [field]:
        field === "strike"
          ? "101"
          : field === "kind"
            ? "PUT"
            : field === "expiry"
              ? "2027-02-01T00:00:00.000Z"
              : "ins-" + "0".repeat(64),
    };
    const r = f.request();
    r.assertions = [proof(identity, f)];
    const s = take(await f.service.publish(r));
    expect(s.prepared.mappings[0]!.outcome).toBe("SOURCE_METADATA_CONFLICT");
    expect(s.prepared.groups).toHaveLength(0);
  },
);
it("canonical decimal constraint comparison reuses P20 identity parsing", async () => {
  const f = await fixture(),
    underlying = take(f.base.canonical.registry.search())[0]!.instrumentId;
  await addIdentity(
    f,
    "OPT",
    {
      family: "OPTION",
      kind: "CALL",
      underlying,
      venue: "XNAS",
      expiry: mustParseUtc("2027-01-01T00:00:00.000Z"),
      strike: "100",
      currency: "USD",
      contract: "OPT",
    },
    "option",
  );
  await f.import("option", "OPT", "options", ["option"]);
  const r = f.request();
  r.assertions = [proof({ strike: "100.00", kind: "CALL" }, f)];
  expect(take(await f.service.publish(r)).prepared.mappings[0]!.outcome).toBe(
    "UNIQUE_QUALIFIED_CANDIDATE",
  );
});
it("digital network distinguishes same human token name", async () => {
  const f = await fixture();
  await addIdentity(
    f,
    "DIGITAL",
    { family: "DIGITAL", kind: "TOKEN", network: "ETHEREUM", asset: "TOKEN" },
    "digital",
  );
  await f.import("token", "TOKEN", "digital", ["digital"]);
  const r = f.request();
  r.assertions = [proof({ network: "OTHER_NETWORK" }, f)];
  const s = take(await f.service.publish(r));
  expect(s.prepared.mappings[0]!.target?.family).toBe("DIGITAL");
  expect(s.prepared.mappings[0]!.outcome).toBe("SOURCE_METADATA_CONFLICT");
});
it("normalized spellings of one identifier cannot inflate independent evidence", async () => {
  const f = await fixture({ ...defaultPolicy, minIndependentClaims: 2 }),
    old = take(f.base.canonical.registry.search())[0]!;
  const d = structuredClone(old.definition);
  d.identifiers.push({
    scheme: "ISIN",
    scope: "GLOBAL",
    authority: "fixture",
    value: "US0378331005",
    evidence: evidence("US0378331005"),
  });
  take(
    await f.base.canonical.registry.revise(
      old.instrumentId,
      old.revisionId,
      d,
      "Add declared standard identifier",
    ),
  );
  const c = await f.import();
  const raw = take(f.base.lab.catalogue(c.fingerprint));
  const b = {
    schemaVersion: 1,
    batchId: "spelling",
    namespace: raw.namespace,
    source: raw.source,
    records: [
      {
        rawSymbol: "SPELLING",
        identifiers: [
          { scheme: "ISIN", scope: "GLOBAL", authority: "fixture", value: "US0378331005" },
          { scheme: "ISIN", scope: "GLOBAL", authority: "fixture", value: "us0378331005" },
        ],
      },
    ],
  };
  const n = take(await f.base.lab.importNative(b));
  f.cats.splice(0, 1, n);
  const s = take(await f.service.publish(f.request()));
  expect(s.prepared.mappings[0]!.claims).toHaveLength(2);
  expect(new Set(s.prepared.mappings[0]!.claims.map((c) => c.evidenceIdentity)).size).toBe(1);
  expect(s.prepared.mappings[0]!.outcome).toBe("INSUFFICIENT_EVIDENCE");
});

it.each([false, true])(
  "actual recognized-owner verified identifiers qualify only consistent claims (conflict=%s)",
  async (conflict) => {
    const f = await fixture({ ...defaultPolicy, requireVerifiedIdentifiers: true });
    const { InstrumentRegistry, MemoryRegistryRepository } =
      await import("@ate/instrument-registry");
    const { CanonicalSymbolMapping } = await import("@ate/canonical-symbol-mapping");
    const { fingerprint } = await import("@ate/configuration");
    const { equity } = await import("./fixtures.js");
    const verifyRegistryEvidence = (e: ReturnType<typeof evidence>) =>
      e.sourceType === "RECOGNIZED_AUTHORITY" &&
      e.sourceId === "trusted-test" &&
      e.contentFingerprint === fingerprint(e.originalValue);
    const registry = new InstrumentRegistry("verified-owner", {
      clock: f.base.clock,
      configuration: () => f.base.canonical.config,
      repository: new MemoryRegistryRepository(),
      verifyEvidence: verifyRegistryEvidence,
    });
    take(await registry.initialize());
    for (const name of ["A", "B"]) {
      const d = equity(name);
      const e = {
        ...evidence("economic-" + name),
        sourceType: "RECOGNIZED_AUTHORITY" as const,
        sourceId: "trusted-test",
        verification: "VERIFIED" as const,
      };
      d.qualification = "VERIFIED";
      d.evidence = [e];
      d.identifiers = [
        {
          scheme: "RESEARCH",
          scope: "synthetic-broker",
          authority: "fixture",
          value: "economic-" + name,
          evidence: e,
        },
      ];
      take(await registry.register(d));
    }
    await f.import(
      "verified",
      "SYN.A",
      "synthetic-broker",
      conflict ? ["economic-A", "economic-B"] : ["economic-A"],
    );
    take(await f.service.stop());
    const service = new CanonicalSymbolMapping("mapping-lab", {
      ...f.ports,
      registry,
      verifyRegistryEvidence,
    });
    take(await service.initialize());
    const r = f.request();
    r.registrySnapshot = take(registry.snapshot())!.fingerprint;
    const result = take(await service.publish(r));
    expect(result.prepared.mappings[0]!.claims.every((c) => c.status === "EXACT_MATCH")).toBe(true);
    expect(result.prepared.mappings[0]!.outcome).toBe(
      conflict ? "IDENTIFIER_CONFLICT" : "UNIQUE_QUALIFIED_CANDIDATE",
    );
    take(await service.stop());
  },
);

it("B1 governed suffixes are reused without implementing a prefix operation", async () => {
  const f = await fixture();
  const { effective: brokerEffective, batch } =
    await import("../broker-symbol-catalogue/fixtures.js");
  const { BrokerSymbolCatalogue, defaultPolicy: brokerPolicy } =
    await import("@ate/broker-symbol-catalogue");
  const { CanonicalSymbolMapping } = await import("@ate/canonical-symbol-mapping");
  take(await f.base.lab.stop());
  const config = await brokerEffective({
    ...brokerPolicy,
    rules: [{ id: "synthetic-suffix", version: "B1", case: "CASE", suffixes: [".A", "M", "-PRO"] }],
  });
  const lab = new BrokerSymbolCatalogue("offline-lab", {
    ...f.base.ports,
    configuration: () => config,
  });
  take(await lab.initialize());
  const b = batch("suffixes", ["EURUSD.a", "EURUSDm", "EURUSD-pro", ".EURUSD"]);
  for (const record of b.records)
    record.identifiers = [
      { scheme: "RESEARCH", scope: "synthetic-broker", authority: "fixture", value: "economic-A" },
    ];
  const c = take(await lab.importNative(b));
  take(await f.service.stop());
  const service = new CanonicalSymbolMapping("mapping-lab", {
    ...f.ports,
    sources: new Map([["offline-lab", lab]]),
  });
  take(await service.initialize());
  const r = {
    requestId: "suffix-mapping",
    registrySnapshot: take(f.base.canonical.registry.snapshot())!.fingerprint,
    sources: [
      {
        ownerId: "offline-lab",
        ownerSnapshot: take(lab.snapshot())!.fingerprint,
        catalogueFingerprint: c.fingerprint,
      },
    ],
    assertions: [],
    approvals: [],
  };
  const s = take(await service.publish(r));
  expect(
    s.prepared.mappings
      .filter((m) => m.observation.raw.rawSymbol !== ".EURUSD")
      .every((m) => m.observation.keys[0]!.value === "EURUSD"),
  ).toBe(true);
  expect(
    s.prepared.mappings.find((m) => m.observation.raw.rawSymbol === ".EURUSD")!.observation.keys[0]!
      .value,
  ).toBe(".EURUSD");
  expect(s.prepared.groups[0]!.members).toHaveLength(4);
});
