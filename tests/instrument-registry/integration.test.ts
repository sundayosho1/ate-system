import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fingerprint } from "@ate/configuration";
import { ReplayController, FilesystemReplayCheckpointRepository } from "@ate/market-replay";
import { VirtualClock } from "@ate/time";
import { associateResearchEvidence, associateLegacyInstrument } from "@ate/instrument-registry";
import { setup, equity, take, root, time } from "./fixtures.js";
import { acceptanceFixture } from "../market-replay/acceptance-fixture.js";
it.each([
  "MARKET_DATA",
  "HISTORICAL_DATA",
  "DATA_QUALITY",
  "DATASET_CATALOGUE",
  "REALTIME_CAPTURE",
  "MULTITIMEFRAME",
  "MARKET_REPLAY",
] as const)("versioned %s research association does not rewrite owner payload", async (owner) => {
  const { registry } = await setup(),
    row = take(await registry.register(equity())),
    snapshot = take(registry.snapshot())!;
  const ownerBody = { owner, legacyInstrument: "source-native", revision: 1 };
  const before = JSON.stringify(ownerBody);
  const reference = take(
    associateResearchEvidence(registry, {
      schemaVersion: 1,
      owner,
      ownerReference: "synthetic-owner-1",
      ownerFingerprint: fingerprint(ownerBody),
      registryId: "synthetic-registry",
      instrumentId: row.instrumentId,
      revisionId: row.revisionId,
      registrySnapshot: snapshot.fingerprint,
    }),
  );
  expect(reference.ownerFingerprint).toBe(fingerprint(ownerBody));
  expect(JSON.stringify(ownerBody)).toBe(before);
  expect(reference.registrySnapshot).toBe(snapshot.fingerprint);
});
it.each(["VERIFIED_POINT_IN_TIME", "EVENT_TIME_RECONSTRUCTION"] as const)(
  "legacy %s replay output remains identical with registry association",
  async (mode) => {
    const f = await acceptanceFixture(mode, false);
    const { registry } = await setup(),
      row = take(await registry.register(equity())),
      snapshot = take(registry.snapshot())!;
    const config = fingerprint(f.spec),
      input = fingerprint(f.inputs);
    const a = new ReplayController(
      f.spec,
      f.inputs,
      new FilesystemReplayCheckpointRepository(
        root(),
        new VirtualClock(time),
        f.spec.resourceLimits,
      ),
    );
    const b = new ReplayController(
      f.spec,
      f.inputs,
      new FilesystemReplayCheckpointRepository(
        root(),
        new VirtualClock(time),
        f.spec.resourceLimits,
      ),
    );
    expect((await a.initialize()).ok).toBe(true);
    expect((await b.initialize()).ok).toBe(true);
    take(
      associateResearchEvidence(registry, {
        schemaVersion: 1,
        owner: "MARKET_REPLAY",
        ownerReference: f.spec.sessionId,
        ownerFingerprint: fingerprint(f.spec),
        registryId: "synthetic-registry",
        instrumentId: row.instrumentId,
        revisionId: row.revisionId,
        registrySnapshot: snapshot.fingerprint,
      }),
    );
    for (let i = 0; i < 4; i++) {
      const one = await a.stepEvent(),
        two = await b.stepEvent();
      expect(two).toEqual(one);
    }
    expect(fingerprint(f.spec)).toBe(config);
    expect(fingerprint(f.inputs)).toBe(input);
  },
);
it("foreign registry reference fails closed", async () => {
  const { registry } = await setup(),
    row = take(await registry.register(equity())),
    snapshot = take(registry.snapshot())!;
  expect(
    associateResearchEvidence(registry, {
      schemaVersion: 1,
      owner: "MARKET_REPLAY",
      ownerReference: "legacy",
      ownerFingerprint: fingerprint("legacy"),
      registryId: "foreign",
      instrumentId: row.instrumentId,
      revisionId: row.revisionId,
      registrySnapshot: snapshot.fingerprint,
    }).ok,
  ).toBe(false);
});
it("revision not in historical snapshot cannot be retrospectively associated", async () => {
  const { registry } = await setup(),
    row = take(await registry.register(equity())),
    snapshot = take(registry.snapshot())!;
  const next = take(
    await registry.revise(
      row.instrumentId,
      row.revisionId,
      { ...equity(), displayName: "new" },
      "rename",
    ),
  );
  expect(
    associateResearchEvidence(registry, {
      schemaVersion: 1,
      owner: "HISTORICAL_DATA",
      ownerReference: "dataset",
      ownerFingerprint: fingerprint("dataset"),
      registryId: "synthetic-registry",
      instrumentId: row.instrumentId,
      revisionId: next.revisionId,
      registrySnapshot: snapshot.fingerprint,
    }).ok,
  ).toBe(false);
});
it("public API exposes no connector execution or eligibility authority", () => {
  const p = JSON.parse(
    readFileSync(
      join(import.meta.dirname, "../../packages/instrument-registry/package.json"),
      "utf8",
    ),
  ) as { exports: Record<string, string>; dependencies: Record<string, string> };
  expect(Object.keys(p.exports)).toEqual(["."]);
  expect(p.dependencies).not.toHaveProperty("broker");
  const source = readFileSync(
    join(import.meta.dirname, "../../packages/instrument-registry/src/index.ts"),
    "utf8",
  );
  expect(source).not.toMatch(/connector|execution|order/i);
});

it("accepted legacy UUID instrument contract is explicitly associated without replacement", async () => {
  const { registry } = await setup(),
    row = take(await registry.register(equity())),
    snapshot = take(registry.snapshot())!;
  const legacy = {
    schemaVersion: 1,
    instrumentId: "40000000-0000-4000-8000-000000000010",
    canonicalSymbol: "SYN",
    displayName: "Synthetic legacy share",
    assetClass: "EQUITY",
    status: "VALIDATED",
    metadata: {},
  };
  const before = JSON.stringify(legacy);
  const association = take(
    associateLegacyInstrument(registry, legacy, {
      instrumentId: row.instrumentId,
      revisionId: row.revisionId,
      registrySnapshot: snapshot.fingerprint,
    }),
  );
  expect(association.legacyInstrumentId).toBe(legacy.instrumentId);
  expect(association.reference.instrumentId).not.toBe(legacy.instrumentId);
  expect(association.reference.ownerFingerprint).toBe(fingerprint(legacy));
  expect(JSON.stringify(legacy)).toBe(before);
});
it("invalid legacy UUID or broker reference cannot become canonical instrument evidence", async () => {
  const { registry } = await setup(),
    row = take(await registry.register(equity())),
    snapshot = take(registry.snapshot())!;
  expect(
    associateLegacyInstrument(
      registry,
      { instrumentId: "provider-ticker" },
      {
        instrumentId: row.instrumentId,
        revisionId: row.revisionId,
        registrySnapshot: snapshot.fingerprint,
      },
    ).ok,
  ).toBe(false);
  expect(registry.diagnostics().generation).toBe(1);
});
it("legacy selection cannot override authenticated owner identity or fingerprint", async () => {
  const { registry } = await setup(),
    row = take(await registry.register(equity())),
    snapshot = take(registry.snapshot())!;
  const legacy = {
    schemaVersion: 1,
    instrumentId: "40000000-0000-4000-8000-000000000010",
    canonicalSymbol: "SYN",
    displayName: "Synthetic",
    assetClass: "EQUITY",
    status: "VALIDATED",
    metadata: {},
  };
  const selection = {
    instrumentId: row.instrumentId,
    revisionId: row.revisionId,
    registrySnapshot: snapshot.fingerprint,
    ownerFingerprint: fingerprint("substituted"),
    ownerReference: "foreign",
  };
  expect(associateLegacyInstrument(registry, legacy, selection).ok).toBe(false);
  expect(registry.diagnostics().generation).toBe(1);
});
it("legacy selection rejects native accessors without executing callbacks", async () => {
  const { registry } = await setup();
  let calls = 0;
  const selection = {
    get instrumentId() {
      calls++;
      return "ins-" + "0".repeat(64);
    },
    revisionId: "sha256:" + "0".repeat(64),
    registrySnapshot: "sha256:" + "0".repeat(64),
  };
  expect(associateLegacyInstrument(registry, {}, selection).ok).toBe(false);
  expect(calls).toBe(0);
  expect(registry.diagnostics().generation).toBe(0);
});
