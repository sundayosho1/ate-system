import { beforeAll, it, expect } from "vitest";
import { mustParseUtc } from "@ate/time";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fingerprint } from "@ate/configuration";
import { createReplayInputManifest, immutableReplayInputs } from "@ate/market-replay";
import {
  InstrumentEligibility,
  FilesystemEligibilityRepository,
  snapshotSchema,
  type Stage,
  type Policy,
} from "@ate/instrument-eligibility";
import { originOwners, research, take, root, checker, time } from "./origin-fixtures.js";
import { configuration } from "./fixtures.js";
let owners: Awaited<ReturnType<typeof originOwners>>;
beforeAll(async () => {
  owners = await originOwners();
});
async function preview(f: Awaited<ReturnType<typeof research>>, destination: Stage = "VALIDATED") {
  return take(
    await f.service.evaluateTransition({
      instrumentId: f.context.instrumentId,
      context: f.context,
      destination,
    }),
  );
}
for (const count of [1, 2, 3])
  it(`complete genuine ${count}-origin research promotes and physically recovers`, async () => {
    const path = root(),
      f = await research(owners, count, new FilesystemEligibilityRepository(path));
    await f.toResearch();
    take((await f.attest()).result);
    expect((await preview(f)).allowed).toBe(true);
    await f.promote("VALIDATED");
    await f.promote("SIMULATION");
    take(await f.service.stop());
    const reader = new InstrumentEligibility("origin-lab", {
      ...f.ports,
      repository: new FilesystemEligibilityRepository(path),
    });
    take(await reader.initialize());
    expect(take(await reader.getEligibility(f.context.instrumentId)).current.allowed).toBe(true);
    take(await reader.stop());
  });
for (const [actual, declared] of [
  [2, 1],
  [3, 2],
  [1, 2],
  [2, 3],
] as const)
  it(`actual ${actual} declared ${declared} denies attestation and preview unchanged predicates`, async () => {
    const f = await research(owners, actual);
    f.context.datasets = owners.bindings.slice(0, declared);
    await f.toResearch();
    const before = f.service.diagnostics().history;
    expect((await f.attest()).result.ok).toBe(false);
    expect(f.service.diagnostics().history).toBe(before);
    const a = await preview(f);
    expect(a.replayReproducible).toBe(false);
    expect(a.allowed).toBe(false);
    expect(a.reasons).toContain("REPLAY_ORIGIN_INCOMPLETE");
    expect((await f.service.requestTransition(f.request("VALIDATED"))).ok).toBe(false);
  });
for (const reverse of [false, true])
  it(`complete dataset ordering is independent of origin ordering ${reverse}`, async () => {
    const f = await research(owners, 3);
    if (reverse) f.context.datasets.reverse();
    await f.toResearch();
    take((await f.attest()).result);
    expect((await preview(f)).allowed).toBe(true);
  });
it("duplicate declaration cannot inflate complete origin coverage", async () => {
  const f = await research(owners, 2);
  await f.toResearch();
  f.context.datasets = [owners.bindings[0]!, owners.bindings[0]!];
  expect((await f.attest()).result.ok).toBe(false);
  expect((await preview(f)).replayReproducible).toBe(false);
});
for (const field of [
  "versionId",
  "versionFingerprint",
  "contentFingerprint",
  "qualityReportId",
  "qualityFingerprint",
  "associationFingerprint",
] as const)
  it(`declared ${field} substitution cannot qualify`, async () => {
    const f = await research(owners);
    await f.toResearch();
    f.context.datasets = f.context.datasets.map((d, i) =>
      i
        ? d
        : {
            ...d,
            [field]:
              field === "versionId" || field === "qualityReportId"
                ? "missing-owner"
                : "sha256:" + "0".repeat(64),
          },
    );
    expect((await preview(f)).allowed).toBe(false);
    expect((await f.attest()).result.ok).toBe(false);
  });
for (const kind of [
  "substituted-reference",
  "substituted-fingerprint",
  "unsupported-kind",
  "malformed-reference",
] as const)
  it(`actual immutable replay origin ${kind} rejected even with same count`, async () => {
    const original = owners.inputs[1]!.manifests[0]!;
    const { fingerprint: ignored, contentFingerprint: ignoredContent, ...body } = original;
    void ignored;
    void ignoredContent;
    if (kind === "malformed-reference") {
      expect(() =>
        createReplayInputManifest(
          { ...body, originReference: "" },
          owners.pairs[1]![0]!.specification.resourceLimits,
        ),
      ).toThrow();
      return;
    }
    const changed = createReplayInputManifest(
      {
        ...body,
        ...(kind === "substituted-reference"
          ? { originReference: "different-owner" }
          : kind === "substituted-fingerprint"
            ? { originFingerprint: "0".repeat(64) }
            : { kind: "FIXTURE" }),
      },
      owners.pairs[1]![0]!.specification.resourceLimits,
    );
    const pair = await owners.pair([owners.inputs[0]!.manifests[0]!, changed]);
    const f = await research(owners);
    f.setParticipants(pair);
    f.context.replay = {
      leftSession: pair[0]!.specification.sessionId,
      leftCheckpoint: pair[0]!.checkpoint.fingerprint,
      rightSession: pair[1]!.specification.sessionId,
      rightCheckpoint: pair[1]!.checkpoint.fingerprint,
    };
    await f.toResearch();
    expect((await f.attest()).result.ok).toBe(false);
    expect((await preview(f)).replayReproducible).toBe(false);
  });
it("duplicate manifest identity rejected by unchanged P19 owner", () => {
  const m = owners.inputs[0]!.manifests[0]!;
  expect(() => immutableReplayInputs([m, m])).toThrow("MANIFEST_IDENTITY_CONFLICT");
});
for (const stage of ["RESEARCH", "VALIDATED", "SIMULATION"] as const)
  it(`current ${stage} evidence loss preserves historical stage and denies current use`, async () => {
    const path = root(),
      f = await research(owners, 2, new FilesystemEligibilityRepository(path));
    await f.toResearch();
    take((await f.attest()).result);
    if (stage !== "RESEARCH") await f.promote("VALIDATED");
    if (stage === "SIMULATION") await f.promote("SIMULATION");
    const prior = take(await f.service.getEligibility(f.context.instrumentId)).recorded;
    const old = take(
      f.service.historicalEligibility({ instrumentId: f.context.instrumentId, asOf: time }),
    );
    take(f.clock.advanceTo(mustParseUtc(new Date(Date.parse(time) + 1000).toISOString())));
    const hashes = readdirSync(path).map((n) => [
      n,
      fingerprint(readFileSync(join(path, n), "utf8")),
    ]);
    f.setParticipants(owners.pairs[0]!);
    const current = take(await f.service.getEligibility(f.context.instrumentId));
    expect(current.recorded.version).toBe(prior.version);
    expect(current.current.replayReproducible).toBe(false);
    if (stage !== "RESEARCH") expect(current.current.allowed).toBe(false);
    expect(
      take(f.service.historicalEligibility({ instrumentId: f.context.instrumentId, asOf: time })),
    ).toEqual(old);
    for (const [n, h] of hashes) expect(fingerprint(readFileSync(join(path, n!), "utf8"))).toBe(h);
  });
for (const phase of ["APPROVE", "COMMIT"] as const)
  it(`pending ${phase} cannot retain authority when replay coverage changes`, async () => {
    const f = await research(owners);
    await f.toResearch();
    take((await f.attest()).result);
    const request = f.request("VALIDATED");
    take(await f.service.requestTransition(request));
    let approval: string | undefined;
    if (phase === "COMMIT")
      approval = take(
        await f.service.approveTransition({
          kind: "APPROVE",
          id: "pending-approval",
          requestId: request.id,
          checker,
        }),
      ).action.id;
    f.setParticipants(owners.pairs[0]!);
    const result =
      phase === "APPROVE"
        ? await f.service.approveTransition({
            kind: "APPROVE",
            id: "pending-approval",
            requestId: request.id,
            checker,
          })
        : await f.service.commitTransition({
            kind: "COMMIT",
            id: "pending-commit",
            requestId: request.id,
            approvalId: approval,
          });
    expect(result.ok).toBe(false);
    expect(take(await f.service.getEligibility(f.context.instrumentId)).recorded.stage).toBe(
      "RESEARCH",
    );
  });
it("contradictory multi-origin declarations still deny selected PASSED", async () => {
  const f = await research(owners);
  await f.toResearch();
  take((await f.attest()).result);
  take((await f.attest({ attestationId: "contradiction", outcome: "FAILED" })).result);
  const a = await preview(f);
  expect(a.allowed).toBe(false);
  expect(a.reasons).toContain("VALIDATION_DECLARATION_CONFLICT");
});
it("bounded depth diagnostic identifies current limit without a new schema", async () => {
  const path = root(),
    f = await research(owners, 1, new FilesystemEligibilityRepository(path));
  await f.toResearch();
  take(await f.service.stop());
  const p: Policy = {
    ...owners.base.policy,
    maxInputDepth: 3,
    compatibleHistoryPolicies: [fingerprint(owners.base.policy)],
  };
  const conf = await configuration(p, f.ports.clock);
  const reader = new InstrumentEligibility("origin-lab", {
    ...f.ports,
    repository: new FilesystemEligibilityRepository(path),
    configuration: () => conf,
  });
  expect((await reader.initialize()).ok).toBe(false);
  expect(reader.diagnostics()).toMatchObject({
    lastError: "INPUT_DEPTH_LIMIT_3",
    lifecycle: "RECOVERY_REQUIRED",
    readiness: "NOT_READY",
    health: "DEGRADED",
  });
  expect(reader.diagnostics().pending).not.toBeNull();
  expect((await reader.stop()).ok).toBe(false);
});
it("P19 rejects simultaneous catalogue versions sharing the same immutable content fingerprint", async () => {
  await expect(
    owners.pair([owners.inputs[0]!.manifests[0]!, owners.inputs[3]!.manifests[0]!]),
  ).rejects.toThrow("SPECIFICATION_DUPLICATE");
});
it("same dataset/version ID cannot substitute another genuine version fingerprint", async () => {
  const f = await research(owners, 1);
  await f.toResearch();
  f.context.datasets = [
    { ...owners.bindings[0]!, versionFingerprint: owners.bindings[3]!.versionFingerprint },
  ];
  expect((await f.attest()).result.ok).toBe(false);
  expect((await preview(f)).replayReproducible).toBe(false);
});
it("P19 rejects repeated origin content even under distinct manifest IDs", async () => {
  const original = owners.inputs[0]!.manifests[0]!;
  const { fingerprint: ignored, contentFingerprint: ignoredContent, ...body } = original;
  void ignored;
  void ignoredContent;
  const repeated = createReplayInputManifest(
    { ...body, manifestId: "D-same-origin-other-manifest" },
    owners.pairs[0]![0]!.specification.resourceLimits,
  );
  await expect(owners.pair([original, repeated])).rejects.toThrow("SPECIFICATION_DUPLICATE");
});
it("each participant must independently cover every declared origin", async () => {
  const f = await research(owners);
  const participants = [owners.pairs[1]![0]!, owners.pairs[0]![1]!];
  f.setParticipants(participants);
  f.context.replay = {
    leftSession: participants[0]!.specification.sessionId,
    leftCheckpoint: participants[0]!.checkpoint.fingerprint,
    rightSession: participants[1]!.specification.sessionId,
    rightCheckpoint: participants[1]!.checkpoint.fingerprint,
  };
  await f.toResearch();
  expect((await f.attest()).result.ok).toBe(false);
  const a = await preview(f);
  expect(a.reasons).toContain("REPLAY_ORIGIN_INCOMPLETE");
  expect(a.allowed).toBe(false);
});
it("VALIDATED cannot request SIMULATION with an under-declared context despite recorded PASSED", async () => {
  const f = await research(owners);
  await f.toResearch();
  take((await f.attest()).result);
  await f.promote("VALIDATED");
  f.context.datasets = f.context.datasets.slice(0, 1);
  expect((await preview(f, "SIMULATION")).allowed).toBe(false);
  expect((await f.service.requestTransition(f.request("SIMULATION"))).ok).toBe(false);
});
it("authentic legacy under-declared physical discovery is fenced without rewriting or clearing recovery obligation", async () => {
  const legacy = snapshotSchema.parse(
    JSON.parse(
      readFileSync(new URL("./fixtures/legacy-origin-discovery.json", import.meta.url), "utf8"),
    ),
  );
  if (legacy.action.kind !== "DISCOVER" || !legacy.action.context.replay)
    throw Error("LEGACY_FIXTURE_IDENTITY");
  const pair = await owners.pair(
    owners.inputs.slice(0, 2).flatMap((i) => i.manifests),
    ["C-multi-left", "C-multi-right"],
  );
  expect(pair[0]!.checkpoint.fingerprint).toBe(legacy.action.context.replay.leftCheckpoint);
  expect(pair[1]!.checkpoint.fingerprint).toBe(legacy.action.context.replay.rightCheckpoint);
  const path = root();
  const { writeFileSync } = await import("node:fs");
  const name = join(path, "generation-00000001.json");
  const data = JSON.stringify(legacy);
  writeFileSync(name, data);
  const f = await research(owners);
  const conf = await configuration(
    { ...owners.base.policy, compatibleHistoryPolicies: [legacy.policyFingerprint] },
    f.ports.clock,
  );
  const reader = new InstrumentEligibility(legacy.serviceId, {
    ...f.ports,
    configuration: () => conf,
    repository: new FilesystemEligibilityRepository(path),
    replayEvidence: (s, c) =>
      pair.find((p) => p.specification.sessionId === s && p.checkpoint.fingerprint === c),
  });
  const result = await reader.initialize();
  expect(result.ok).toBe(false);
  expect(reader.diagnostics()).toMatchObject({
    lastError: "HISTORICAL_REPLAY_ORIGIN_INCOMPLETE",
    lifecycle: "RECOVERY_REQUIRED",
    readiness: "NOT_READY",
    health: "DEGRADED",
  });
  expect(reader.diagnostics().pending).not.toBeNull();
  expect((await reader.stop()).ok).toBe(false);
  expect((await reader.stop()).ok).toBe(false);
  expect(readFileSync(name, "utf8")).toBe(data);
  expect(readdirSync(path)).toEqual(["generation-00000001.json"]);
});
it("reordered genuine replay manifests preserve complete immutable identity", async () => {
  const pair = await owners.pair(
    owners.inputs
      .slice(0, 3)
      .flatMap((i) => i.manifests)
      .reverse(),
  );
  expect(pair.map((p) => p.checkpoint.fingerprint)).toEqual(
    owners.pairs[2]!.map((p) => p.checkpoint.fingerprint),
  );
  const f = await research(owners, 3);
  f.setParticipants(pair);
  await f.toResearch();
  take((await f.attest()).result);
  expect((await preview(f)).allowed).toBe(true);
});
it("later multi-origin contradictory receipt restricts current eligibility without entering earlier as-of history", async () => {
  const path = root(),
    f = await research(owners, 2, new FilesystemEligibilityRepository(path));
  await f.toResearch();
  take((await f.attest()).result);
  await f.promote("VALIDATED");
  await f.promote("SIMULATION");
  const before = f.service.diagnostics().history;
  const recorded = take(
    f.service.historicalEligibility({ instrumentId: f.context.instrumentId, asOf: time }),
  );
  take(f.clock.advanceTo(mustParseUtc(new Date(Date.parse(time) + 1000).toISOString())));
  take((await f.attest({ attestationId: "later-multi-negative", outcome: "FAILED" })).result);
  expect(
    take(
      f.service.getEligibilityHistory({
        instrumentId: f.context.instrumentId,
        asOf: time,
        offset: 0,
        limit: 100,
      }),
    ).total,
  ).toBe(before);
  expect(
    take(
      f.service.getEligibilityHistory({
        instrumentId: f.context.instrumentId,
        asOf: f.clock.now(),
        offset: 0,
        limit: 100,
      }),
    ).total,
  ).toBe(before + 1);
  expect(
    take(f.service.historicalEligibility({ instrumentId: f.context.instrumentId, asOf: time })),
  ).toEqual(recorded);
  take(await f.service.stop());
  const reader = new InstrumentEligibility("origin-lab", {
    ...f.ports,
    repository: new FilesystemEligibilityRepository(path),
  });
  take(await reader.initialize());
  expect(take(await reader.getEligibility(f.context.instrumentId)).current.allowed).toBe(false);
  expect(
    take(reader.historicalEligibility({ instrumentId: f.context.instrumentId, asOf: time })),
  ).toEqual(recorded);
  take(await reader.stop());
});
it("valid non-overlapping public P19 partitions share one qualified origin without losing event multiplicity", async () => {
  const original = owners.inputs[0]!.manifests[0]!;
  const { fingerprint: ignored, contentFingerprint: ignoredContent, ...body } = original;
  void ignored;
  void ignoredContent;
  const parts = [body.records.slice(0, 1), body.records.slice(1)].map((records, i) =>
    createReplayInputManifest(
      { ...body, manifestId: "origin-part-" + i, records },
      owners.pairs[0]![0]!.specification.resourceLimits,
    ),
  );
  const pair = await owners.pair(parts);
  const path = root(),
    f = await research(owners, 1, new FilesystemEligibilityRepository(path));
  f.setParticipants(pair);
  f.context.replay = {
    leftSession: pair[0]!.specification.sessionId,
    leftCheckpoint: pair[0]!.checkpoint.fingerprint,
    rightSession: pair[1]!.specification.sessionId,
    rightCheckpoint: pair[1]!.checkpoint.fingerprint,
  };
  await f.toResearch();
  take((await f.attest()).result);
  expect((await preview(f)).allowed).toBe(true);
  expect(pair[0]!.inputs.manifests).toHaveLength(2);
  expect(pair[0]!.inputs.manifests.flatMap((m) => m.records)).toHaveLength(original.records.length);
  await f.promote("VALIDATED");
  await f.promote("SIMULATION");
  take(await f.service.stop());
  const reader = new InstrumentEligibility("origin-lab", {
    ...f.ports,
    repository: new FilesystemEligibilityRepository(path),
  });
  take(await reader.initialize());
  expect(take(await reader.getEligibility(f.context.instrumentId)).current.allowed).toBe(true);
  take(await reader.stop());
});
it("partitioned declared origin cannot hide an additional genuine undeclared origin", async () => {
  const original = owners.inputs[0]!.manifests[0]!;
  const { fingerprint: ignored, contentFingerprint: ignoredContent, ...body } = original;
  void ignored;
  void ignoredContent;
  const parts = [body.records.slice(0, 1), body.records.slice(1)].map((records, i) =>
    createReplayInputManifest(
      { ...body, manifestId: "extra-origin-part-" + i, records },
      owners.pairs[0]![0]!.specification.resourceLimits,
    ),
  );
  const pair = await owners.pair([...parts, owners.inputs[1]!.manifests[0]!]);
  const f = await research(owners, 1);
  f.setParticipants(pair);
  f.context.replay = {
    leftSession: pair[0]!.specification.sessionId,
    leftCheckpoint: pair[0]!.checkpoint.fingerprint,
    rightSession: pair[1]!.specification.sessionId,
    rightCheckpoint: pair[1]!.checkpoint.fingerprint,
  };
  await f.toResearch();
  expect((await f.attest()).result.ok).toBe(false);
  const a = await preview(f);
  expect(a.replayReproducible).toBe(false);
  expect(a.allowed).toBe(false);
  expect(a.reasons).toContain("REPLAY_ORIGIN_INCOMPLETE");
});
