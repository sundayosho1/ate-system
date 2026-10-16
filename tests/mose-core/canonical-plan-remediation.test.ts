import { beforeAll, expect, it } from "vitest";
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fingerprint } from "@ate/configuration";
import { mustParseUtc } from "@ate/time";
import {
  FilesystemMOSERepository,
  MOSECoreRuntime,
  type Checkpoint,
  type Universe,
} from "@ate/mose-core";
import {
  createReplayInputManifest,
  createReplaySpecification,
  resolveHistoricalReplayInputs,
  ReplayController,
  FilesystemReplayCheckpointRepository,
} from "@ate/market-replay";
import { fixture, owners, eligibilityFixture, root, take, type Owners } from "./fixtures.js";
import { copy, rehash, stored } from "./remediation-helpers.js";
import { temporalOwners } from "./temporal-owners.js";
import { replayFixture } from "../market-replay/fixtures.js";
import { originOwners, research } from "../instrument-eligibility/origin-fixtures.js";
let base: Owners;
let htf: Owners;
let pointInTime: Owners;
beforeAll(async () => {
  base = await owners();
  htf = await temporalOwners("available");
  const o = await eligibilityFixture();
  const input = await resolveHistoricalReplayInputs({
    ...o.h.options,
    availability: () => ({
      kind: "SOURCE_PUBLICATION",
      availableAt: o.h.clock.now(),
      qualityAvailableAt: o.h.clock.now(),
      fingerprint: fingerprint({ synthetic: "trusted-publication-evidence" }),
    }),
  });
  o.replays.clear();
  for (const sessionId of ["D-pit-left", "D-pit-right"]) {
    const { fingerprint: ignored, ...body } = replayFixture("VERIFIED_POINT_IN_TIME").spec;
    void ignored;
    const specification = createReplaySpecification({
      ...body,
      replayMode: "VERIFIED_POINT_IN_TIME",
      sessionId,
      sourceManifestIds: input.manifests.map((m) => m.manifestId),
      datasetFingerprints: input.manifests.map((m) => m.contentFingerprint),
    });
    const c = new ReplayController(
      specification,
      input,
      new FilesystemReplayCheckpointRepository(root(), o.h.clock, specification.resourceLimits),
    );
    const ready = await c.initialize();
    if (!ready.ok) throw Error(ready.code);
    const done = await c.runToEnd();
    if (!done.ok) throw Error(done.code);
    o.replays.set(sessionId, { specification, checkpoint: done.checkpoint, inputs: input });
  }
  o.context.replay = {
    leftSession: "D-pit-left",
    leftCheckpoint: o.replays.get("D-pit-left")!.checkpoint.fingerprint,
    rightSession: "D-pit-right",
    rightCheckpoint: o.replays.get("D-pit-right")!.checkpoint.fingerprint,
  };
  await o.toResearch();
  pointInTime = o;
});
const hashUniverse = (u: Universe) => {
  const { fingerprint: ignored, ...body } = u;
  void ignored;
  u.fingerprint = fingerprint(body);
};
async function seed(owner = base, policy = {}) {
  const path = root(),
    repository = new FilesystemMOSERepository(path);
  const f = await fixture(owner, policy, repository);
  await f.setup();
  return { f, path, repository };
}
function fileBytes(path: string) {
  return Object.fromEntries(readdirSync(path).map((n) => [n, readFileSync(join(path, n), "utf8")]));
}
function writeRows(path: string, rows: Checkpoint[]) {
  for (const n of readdirSync(path)) unlinkSync(join(path, n));
  let previous: string | null = null;
  for (const [i, row] of rows.entries()) {
    row.generation = i + 1;
    row.previous = previous;
    rehash(row);
    previous = row.fingerprint;
    writeFileSync(
      join(path, `generation-${String(i + 1).padStart(8, "0")}.json`),
      JSON.stringify(row),
    );
  }
}
const faults: [string, (u: Universe) => void][] = [
  [
    "empty plan",
    (u) => {
      u.plan = [];
    },
  ],
  [
    "missing first",
    (u) => {
      u.plan.shift();
    },
  ],
  [
    "missing middle",
    (u) => {
      u.plan.splice(1, 1);
    },
  ],
  [
    "missing last",
    (u) => {
      u.plan.pop();
    },
  ],
  [
    "coherent empty count",
    (u) => {
      u.plan = [];
      u.members[0]!.expected = 0;
    },
  ],
  [
    "coherent subset count",
    (u) => {
      u.plan.splice(1, 1);
      u.members[0]!.expected = 2;
    },
  ],
  [
    "equal-count foreign event",
    (u) => {
      u.plan[1]!.eventId = "foreign-event";
      u.plan[1]!.key = fingerprint({
        instrumentId: u.plan[1]!.instrumentId,
        source: u.plan[1]!.source,
        event: "foreign-event",
      });
    },
  ],
  [
    "duplicate event",
    (u) => {
      u.plan.push(copy(u.plan[0]!));
      u.members[0]!.expected = 4;
    },
  ],
  [
    "extra event",
    (u) => {
      const p = copy(u.plan[0]!);
      p.eventId = "extra";
      p.key = fingerprint({ instrumentId: p.instrumentId, source: p.source, event: p.eventId });
      p.ownerOrdinal = 3;
      u.plan.push(p);
      u.members[0]!.expected = 4;
    },
  ],
  [
    "expected too low",
    (u) => {
      u.members[0]!.expected = 2;
    },
  ],
  [
    "expected too high",
    (u) => {
      u.members[0]!.expected = 4;
    },
  ],
  [
    "unknown expected count",
    (u) => {
      u.members[0]!.expected = null;
    },
  ],
  [
    "incorrect member identity",
    (u) => {
      u.members[0]!.instrumentId = "foreign-instrument";
    },
  ],
  [
    "reordered plan",
    (u) => {
      u.plan.reverse();
    },
  ],
  [
    "incorrect owner ordinal",
    (u) => {
      u.plan[0]!.ownerOrdinal = 999;
    },
  ],
  [
    "future event timestamp",
    (u) => {
      u.plan[0]!.eventAt = mustParseUtc("2090-01-01T00:00:00.000Z");
    },
  ],
  [
    "past event timestamp",
    (u) => {
      u.plan[0]!.eventAt = mustParseUtc("2000-01-01T00:00:00.000Z");
    },
  ],
  [
    "early availability boundary",
    (u) => {
      u.plan[0]!.boundaryAt = mustParseUtc("2020-01-01T00:00:00.000Z");
    },
  ],
  [
    "late availability boundary",
    (u) => {
      u.plan[0]!.boundaryAt = mustParseUtc("2090-01-01T00:00:00.000Z");
    },
  ],
  [
    "incorrect timeframe",
    (u) => {
      u.plan[0]!.timeframe = "H4";
    },
  ],
  [
    "upgraded evidence class",
    (u) => {
      u.plan[0]!.evidenceClass = "VERIFIED_POINT_IN_TIME";
    },
  ],
  [
    "mismatched payload",
    (u) => {
      u.plan[0]!.payloadFingerprint = "b".repeat(64);
    },
  ],
  [
    "mismatched replay identity",
    (u) => {
      u.members[0]!.source.sessionId = "foreign-replay";
      for (const p of u.plan) p.source.sessionId = "foreign-replay";
    },
  ],
  [
    "mismatched replay checkpoint",
    (u) => {
      u.members[0]!.source.checkpoint = "c".repeat(64);
    },
  ],
  [
    "mismatched input fingerprint",
    (u) => {
      u.members[0]!.inputFingerprint = "d".repeat(64);
    },
  ],
  [
    "mismatched manifest identity",
    (u) => {
      u.plan[0]!.manifestId = "foreign-manifest";
    },
  ],
  [
    "mismatched manifest fingerprint",
    (u) => {
      u.plan[0]!.manifestFingerprint = "e".repeat(64);
    },
  ],
  [
    "mismatched dataset version",
    (u) => {
      u.plan[0]!.datasetVersion = "foreign-version";
    },
  ],
  [
    "mismatched dataset identity",
    (u) => {
      u.plan[0]!.datasetId = "foreign-dataset";
    },
  ],
  [
    "mismatched quality identity",
    (u) => {
      u.plan[0]!.qualityReportId = "foreign-report";
    },
  ],
  [
    "mismatched quality fingerprint",
    (u) => {
      u.plan[0]!.qualityFingerprint = "f".repeat(64);
    },
  ],
  [
    "mismatched source cursor",
    (u) => {
      u.plan[0]!.sourceCursor = "foreign-cursor";
    },
  ],
];
for (const physical of [true, false])
  for (const [name, mutate] of faults)
    it(`canonical ${physical ? "physical" : "memory"} recovery rejects ${name} before any new ACK`, async () => {
      const { f, path } = await seed();
      const rows = copy(take(await f.repository.load())) as Checkpoint[];
      mutate(rows[0]!.state.sessions[0]!.universe);
      hashUniverse(rows[0]!.state.sessions[0]!.universe);
      writeRows(path, rows);
      const before = fileBytes(path);
      let writes = 0;
      const repository = physical
        ? f.repository
        : {
            load: () => Promise.resolve({ ok: true as const, value: rows }),
            commit: () => {
              writes++;
              return Promise.reject(Error("INVALID_HISTORY_MUST_NOT_WRITE"));
            },
          };
      for (let attempt = 0; attempt < 2; attempt++) {
        const s = new MOSECoreRuntime("mose-lab", { ...f.ports, repository });
        expect((await s.initialize()).ok).toBe(false);
        expect(s.diagnostics()).toMatchObject({
          lifecycle: "RECOVERY_REQUIRED",
          readiness: "NOT_READY",
          health: "DEGRADED",
          pendingAcknowledgments: 1,
        });
        expect((await s.health()).ok).toBe(false);
        for (const kind of ["START", "COMPLETE"] as const)
          expect(
            (await s.dispatch({ kind, id: `invalid-${kind}`, sessionId: "session-A" })).ok,
          ).toBe(false);
        const p = rows[0]!.state.sessions[0]!.universe.plan[0];
        expect(
          (
            await s.dispatch({
              kind: "RECEIVE",
              id: "invalid-receive",
              sessionId: "session-A",
              instrumentId: base.context.instrumentId,
              eventId: p?.eventId ?? "missing",
              universeSnapshot: rows[0]!.state.sessions[0]!.universe.fingerprint,
            })
          ).ok,
        ).toBe(false);
        expect(
          (
            await s.dispatch({
              kind: "PROCESS",
              id: "invalid-process",
              sessionId: "session-A",
              limit: 1,
            })
          ).ok,
        ).toBe(false);
        expect(s.getSessionSummary("session-A").ok).toBe(false);
        expect((await s.stop()).ok).toBe(false);
        expect((await s.stop()).ok).toBe(false);
        expect(fileBytes(path)).toEqual(before);
      }
      expect(writes).toBe(0);
    });

it("genuine point-in-time source admits with its original classification", async () => {
  const { f } = await seed(pointInTime);
  take(await f.start());
  take(await f.receive(0));
  const o = take(await f.process()).state.sessions[0]!.observations[0]!;
  expect(o.outcome).toBe("ADMITTED");
  expect(o.plan.evidenceClass).toBe("VERIFIED_POINT_IN_TIME");
});
it("point-in-time classification cannot be downgraded in physical recovery", async () => {
  const { f, path } = await seed(pointInTime),
    rows = copy(take(await f.repository.load())) as Checkpoint[];
  const u = rows[0]!.state.sessions[0]!.universe;
  u.plan[0]!.evidenceClass = "EVENT_TIME_RECONSTRUCTION";
  hashUniverse(u);
  writeRows(path, rows);
  const s = new MOSECoreRuntime("mose-lab", f.ports);
  expect(await s.initialize()).toMatchObject({
    ok: false,
    error: { code: "CANONICAL_PLAN_MISMATCH" },
  });
});
for (const field of [
  "ownerOrdinal",
  "eventAt",
  "boundaryAt",
  "timeframe",
  "evidenceClass",
] as const)
  it(`available final HTF evidence cannot bless substituted ${field}`, async () => {
    const { f, path } = await seed(htf, { requiredTimeframes: ["M1"] });
    const rows = copy(take(await f.repository.load())) as Checkpoint[],
      u = rows[0]!.state.sessions[0]!.universe;
    const mutate = faults.find(
      ([n]) =>
        n ===
        {
          ownerOrdinal: "incorrect owner ordinal",
          eventAt: "future event timestamp",
          boundaryAt: "early availability boundary",
          timeframe: "incorrect timeframe",
          evidenceClass: "upgraded evidence class",
        }[field],
    )![1];
    mutate(u);
    hashUniverse(u);
    writeRows(path, rows);
    expect((await new MOSECoreRuntime("mose-lab", f.ports).initialize()).ok).toBe(false);
  });

for (const owner of ["datasets", "quality", "historical"] as const)
  it(`unavailable ${owner} preserves unverified history; restoration authenticates without publication`, async () => {
    const { f, path } = await seed();
    take(await f.start());
    for (let i = 0; i < 3; i++) take(await f.receive(i));
    take(await f.process());
    take(await f.send({ kind: "COMPLETE", sessionId: "session-A" }));
    const before = fileBytes(path),
      original = f.ports[owner];
    if (owner === "datasets")
      f.ports.datasets = { getVersion: (id) => originalMethod("datasets", id) };
    if (owner === "quality") f.ports.quality = { getReport: (id) => originalMethod("quality", id) };
    if (owner === "historical")
      f.ports.historical = { getManifest: (id) => originalMethod("historical", id) };
    // Only availability changes, not stored evidence or identity. Restore the exact original port for a fresh reader.
    function originalMethod(kind: string, id: string): never {
      void kind;
      void id;
      throw Error("UNAVAILABLE");
    }
    const s = new MOSECoreRuntime("mose-lab", f.ports);
    take(await s.initialize());
    expect(s.diagnostics()).toMatchObject({ readiness: "NOT_READY", health: "DEGRADED" });
    expect(s.diagnostics().canonicalVerificationObligations).toHaveLength(1);
    expect(take(s.getSessionSummary("session-A"))).toMatchObject({
      admitted: 3,
      coverageComplete: false,
      canonicalVerification: "UNVERIFIED",
      expectedObligations: null,
    });
    expect((await s.health()).ok).toBe(true);
    expect(fileBytes(path)).toEqual(before);
    // New instance permits exact same-root bounded revalidation; old blocked history remains untouched.
    Object.assign(f.ports, { [owner]: original });

    const reader = new MOSECoreRuntime("mose-lab", f.ports);
    take(await reader.initialize());
    expect(take(await reader.health()).health).toBe("HEALTHY");
    expect(take(reader.getSessionSummary("session-A"))).toMatchObject({
      admitted: 3,
      coverageComplete: true,
      canonicalVerification: "VERIFIED",
      expectedObligations: 3,
    });
    expect(fileBytes(path)).toEqual(before);
  });

it("restored evidence can revalidate the same paused reader without inventing a storage ACK", async () => {
  const { f, path } = await seed();
  const actual = f.ports.quality;
  let unavailable = true;
  const ports = {
    ...f.ports,
    quality: {
      getReport: (id: Parameters<typeof actual.getReport>[0]) =>
        actual.getReport(unavailable ? ("missing" as typeof id) : id),
    },
  };
  const s = new MOSECoreRuntime("mose-lab", ports);
  take(await s.initialize());
  expect(s.diagnostics().canonicalVerificationObligations).toHaveLength(1);
  expect(
    (await s.dispatch({ kind: "START", id: "unverified-start", sessionId: "session-A" })).ok,
  ).toBe(false);
  expect(take(s.getSessionSummary("session-A")).coverageComplete).toBe(false);
  const before = fileBytes(path);
  unavailable = false;
  expect(take(await s.health())).toMatchObject({
    readiness: "READY",
    health: "HEALTHY",
    canonicalVerificationObligations: [],
    pendingAcknowledgments: 0,
  });
  expect(fileBytes(path)).toEqual(before);
  take(await s.dispatch({ kind: "START", id: "restored-start", sessionId: "session-A" }));
  take(await s.stop());
  take(await s.stop());
});
it("temporary owner loss cannot conceal a metadata substitution; restoration fails closed", async () => {
  const { f, path } = await seed(),
    rows = copy(take(await f.repository.load())) as Checkpoint[],
    u = rows[0]!.state.sessions[0]!.universe;
  u.plan[0]!.evidenceClass = "VERIFIED_POINT_IN_TIME";
  hashUniverse(u);
  writeRows(path, rows);
  const actual = f.ports.quality;
  let unavailable = true;
  const s = new MOSECoreRuntime("mose-lab", {
    ...f.ports,
    quality: { getReport: (id) => actual.getReport(unavailable ? ("missing" as typeof id) : id) },
  });
  take(await s.initialize());
  expect(s.diagnostics().readiness).toBe("NOT_READY");
  const before = fileBytes(path);
  unavailable = false;
  expect(await s.health()).toMatchObject({
    ok: false,
    error: { code: "CANONICAL_PLAN_MISMATCH", commitment: "UNKNOWN" },
  });
  expect(s.diagnostics()).toMatchObject({
    lifecycle: "RECOVERY_REQUIRED",
    readiness: "NOT_READY",
    health: "DEGRADED",
    pendingAcknowledgments: 1,
  });
  expect((await s.stop()).ok).toBe(false);
  expect(fileBytes(path)).toEqual(before);
});
it("static missing obligations reject even when the quality owner is unavailable", async () => {
  const { f, path } = await seed(),
    rows = copy(take(await f.repository.load())) as Checkpoint[],
    u = rows[0]!.state.sessions[0]!.universe;
  u.plan = [];
  hashUniverse(u);
  writeRows(path, rows);
  f.ports.quality = { getReport: () => Promise.reject(Error("UNAVAILABLE")) };
  expect(await new MOSECoreRuntime("mose-lab", f.ports).initialize()).toMatchObject({
    ok: false,
    error: { code: "CANONICAL_PLAN_MISMATCH" },
  });
});
it("genuine exact-capacity original G23 recovers with canonical authentication", async () => {
  const s = await stored(base, "G23");
  take(s.result);
  expect(take(s.reader.getSessionSummary("audit-session")).canonicalVerification).toBe("VERIFIED");
  expect(s.reader.diagnostics().history).toBe(1);
});
it("valid paused local shutdown drain preserves canonical identities after fresh recovery", async () => {
  const { f, path } = await seed();
  take(await f.start());
  take(await f.receive(0));
  take(await f.send({ kind: "PAUSE", sessionId: "session-A" }));
  expect((await f.service.stop()).ok).toBe(false);
  take(await f.process());
  take(await f.service.stop());
  const before = fileBytes(path);
  const s = new MOSECoreRuntime("mose-lab", f.ports);
  take(await s.initialize());
  expect(take(s.getSessionSummary("session-A"))).toMatchObject({
    admitted: 1,
    canonicalVerification: "VERIFIED",
  });
  expect(fileBytes(path)).toEqual(before);
});
it("valid historical observations survive genuine current eligibility revocation", async () => {
  const owner = await owners(),
    { f, path } = await seed(owner);
  take(await f.start());
  take(await f.receive(0));
  take(await f.process());
  const before = fileBytes(path);
  await owner.promote("RESEARCH", { disposition: "REVOKED" });
  const s = new MOSECoreRuntime("mose-lab", f.ports);
  take(await s.initialize());
  expect(take(s.getSessionSummary("session-A"))).toMatchObject({
    admitted: 1,
    canonicalVerification: "VERIFIED",
  });
  expect(take(await s.health()).health).toBe("DEGRADED");
  expect((await s.dispatch({ kind: "START", id: "revoked", sessionId: "session-A" })).ok).toBe(
    false,
  );
  expect(fileBytes(path)).toEqual(before);
});
for (const partitioned of [false, true])
  it(`genuine ${partitioned ? "distinct partitions of one origin" : "multiple immutable origins"} recovers every obligation`, async () => {
    const o = await originOwners();
    const r = await research(o, partitioned ? 1 : 2);
    if (partitioned) {
      const {
        fingerprint: ignored,
        contentFingerprint: other,
        ...body
      } = o.inputs[0]!.manifests[0]!;
      void ignored;
      void other;
      const manifests = [body.records.slice(0, 1), body.records.slice(1)].map((records, i) =>
        createReplayInputManifest(
          { ...body, manifestId: "D-partition-" + i, records },
          o.pairs[0]![0]!.specification.resourceLimits,
        ),
      );
      const pair = await o.pair(manifests, ["D-partition-left", "D-partition-right"]);
      r.setParticipants(pair);
      r.context.replay = {
        leftSession: pair[0]!.specification.sessionId,
        leftCheckpoint: pair[0]!.checkpoint.fingerprint,
        rightSession: pair[1]!.specification.sessionId,
        rightCheckpoint: pair[1]!.checkpoint.fingerprint,
      };
    }
    await r.toResearch();
    const path = root(),
      repository = new FilesystemMOSERepository(path);
    const f = await fixture(base, {}, repository);
    f.ports.datasets = r.ports.datasets;
    f.ports.quality = r.ports.quality;
    f.ports.historical = r.ports.historical;
    f.ports.eligibility = r.service;
    f.ports.replayEvidence = (s, c) => r.ports.replayEvidence(s, c);
    // A separate session binds the genuine origin-specific P24 context.
    take(
      await f.service.dispatch(
        f.create("origin-session", {
          instruments: [
            {
              instrumentId: r.context.instrumentId,
              source: {
                sessionId: r.context.replay!.leftSession,
                checkpoint: r.context.replay!.leftCheckpoint,
              },
            },
          ],
        }),
      ),
    );
    const u = take(f.service.getUniverse("origin-session"));
    expect(new Set(u.plan.map((p) => p.manifestId)).size).toBe(2);
    expect(u.members[0]!.expected).toBe(partitioned ? 3 : 6);
    const before = fileBytes(path),
      s = new MOSECoreRuntime("mose-lab", f.ports);
    take(await s.initialize());
    expect(take(s.getUniverse("origin-session"))).toEqual(u);
    expect(fileBytes(path)).toEqual(before);
  });
it("accepted P19 contract forbids empty input manifests rather than fabricating zero-event success", () => {
  const e = base.ports.replayEvidence(
    base.context.replay!.leftSession,
    base.context.replay!.leftCheckpoint,
  )!;
  const { fingerprint: ignored, contentFingerprint: other, ...body } = e.inputs.manifests[0]!;
  void ignored;
  void other;
  expect(() =>
    createReplayInputManifest({ ...body, records: [] }, e.specification.resourceLimits),
  ).toThrow();
  const { fingerprint: ignoredSpec, ...spec } = e.specification;
  void ignoredSpec;
  expect(() =>
    createReplaySpecification({ ...spec, sourceManifestIds: [], datasetFingerprints: [] }),
  ).toThrow();
});

it("same-byte exact-capacity physical substitution fails canonical recovery, not the byte gate", async () => {
  const f = await stored(base, "G23"),
    rows = copy(take(await f.f.repository.load())) as Checkpoint[];
  const u = rows[0]!.state.sessions[0]!.universe;
  u.plan[0]!.eventAt = mustParseUtc("2090-01-01T00:00:00.000Z");
  hashUniverse(u);
  writeRows(f.path, rows);
  expect(Buffer.byteLength(JSON.stringify(rows[0]))).toBe(8836);
  const s = new MOSECoreRuntime("independent-mose", f.f.ports);
  expect(await s.initialize()).toMatchObject({
    ok: false,
    error: { code: "CANONICAL_PLAN_MISMATCH" },
  });
});

it("unverified recovery prohibits no-op PROCESS, PAUSE, STOP, RECEIVE and COMPLETE publication", async () => {
  const { f, path } = await seed(),
    actual = f.ports.quality;
  const s = new MOSECoreRuntime("mose-lab", {
    ...f.ports,
    quality: { getReport: (_id) => actual.getReport("missing" as typeof _id) },
  });
  take(await s.initialize());
  const before = fileBytes(path),
    u = take(s.getUniverse("session-A"));
  for (const kind of ["PROCESS", "PAUSE", "STOP", "RECEIVE", "COMPLETE"] as const) {
    const a =
      kind === "STOP"
        ? { kind, id: kind }
        : kind === "PROCESS"
          ? { kind, id: kind, sessionId: "session-A", limit: 1 }
          : kind === "RECEIVE"
            ? {
                kind,
                id: kind,
                sessionId: "session-A",
                instrumentId: u.plan[0]!.instrumentId,
                eventId: u.plan[0]!.eventId,
                universeSnapshot: u.fingerprint,
              }
            : { kind, id: kind, sessionId: "session-A" };
    expect(await s.dispatch(a)).toMatchObject({
      ok: false,
      error: { code: "CANONICAL_PLAN_UNVERIFIED", commitment: "NONE" },
    });
  }
  expect((await s.stop()).ok).toBe(false);
  expect((await s.stop()).ok).toBe(false);
  expect(s.diagnostics().canonicalVerificationObligations).toHaveLength(1);
  expect(fileBytes(path)).toEqual(before);
});

it("valid paused drain with coherently rehashed metadata still fails canonical authentication", async () => {
  const { f, path } = await seed();
  take(await f.start());
  take(await f.receive(0));
  take(await f.send({ kind: "PAUSE", sessionId: "session-A" }));
  expect((await f.service.stop()).ok).toBe(false);
  take(await f.process());
  const rows = copy(take(await f.repository.load())) as Checkpoint[];
  for (const c of rows) {
    const s = c.state.sessions[0]!,
      u = s.universe;
    u.plan[0]!.evidenceClass = "VERIFIED_POINT_IN_TIME";
    hashUniverse(u);
    if (c.command.kind === "RECEIVE") c.command.universeSnapshot = u.fingerprint;
    for (const o of s.observations) {
      o.plan = copy(u.plan[o.sequence - 1]!);
      o.universeSnapshot = u.fingerprint;
      o.observationId = fingerprint({
        sessionId: u.sessionId,
        universe: u.fingerprint,
        key: o.plan.key,
      });
      if (o.funnelEvent) {
        o.funnelEvent.eventId = fingerprint({ observation: o.observationId, stage: "OBSERVED" });
        o.funnelEvent.observationId = o.observationId;
        o.funnelEvent.opportunityCorrelationId = o.observationId;
      }
    }
  }
  writeRows(path, rows);
  const before = fileBytes(path);
  expect(await new MOSECoreRuntime("mose-lab", f.ports).initialize()).toMatchObject({
    ok: false,
    error: { code: "CANONICAL_PLAN_MISMATCH" },
  });
  expect(fileBytes(path)).toEqual(before);
});

for (const corrupt of [false, true])
  it(`genuine two-source recovery ${corrupt ? "cannot hide a corrupted B plan behind healthy A" : "preserves both canonical obligation sets"}`, async () => {
    const { multiOwners } = await import("./multi-owners.js"),
      m = await multiOwners();
    const { f, path } = await seed(m.a);
    f.ports.eligibility = {
      getEligibility: (id) =>
        id === m.b.context.instrumentId
          ? m.b.service.getEligibility(id)
          : m.a.service.getEligibility(id),
    };
    f.ports.datasets = {
      getVersion: (id) =>
        id === m.b.context.datasets[0]!.versionId
          ? m.b.ports.datasets.getVersion(id)
          : m.a.ports.datasets.getVersion(id),
    };
    f.ports.quality = {
      getReport: (id) =>
        id === m.b.context.datasets[0]!.qualityReportId
          ? m.b.ports.quality.getReport(id)
          : m.a.ports.quality.getReport(id),
    };
    f.ports.historical = {
      getManifest: async (id) => {
        const r = await m.b.ports.historical.getManifest(id);
        return r.ok ? r : m.a.ports.historical.getManifest(id);
      },
    };
    f.ports.replayEvidence = (s, c) =>
      m.b.ports.replayEvidence(s, c) ?? m.a.ports.replayEvidence(s, c);
    const a = f.create("two-source");
    a.instruments.push({
      instrumentId: m.b.context.instrumentId,
      source: {
        sessionId: m.b.context.replay!.leftSession,
        checkpoint: m.b.context.replay!.leftCheckpoint,
      },
    });
    take(await f.service.dispatch(a));
    const u = take(f.service.getUniverse("two-source"));
    expect(u.plan).toHaveLength(6);
    if (corrupt) {
      const rows = copy(take(await f.repository.load())) as Checkpoint[],
        u = rows.at(-1)!.state.sessions.at(-1)!.universe;
      u.plan.find((p) => p.instrumentId === m.b.context.instrumentId)!.timeframe = "H4";
      hashUniverse(u);
      writeRows(path, rows);
    }
    const before = fileBytes(path),
      s = new MOSECoreRuntime("mose-lab", f.ports),
      r = await s.initialize();
    if (corrupt) expect(r).toMatchObject({ ok: false, error: { code: "CANONICAL_PLAN_MISMATCH" } });
    else {
      take(r);
      expect(take(await s.health()).health).toBe("HEALTHY");
      expect(take(s.getUniverse("two-source"))).toEqual(u);
    }
    expect(fileBytes(path)).toEqual(before);
  });
