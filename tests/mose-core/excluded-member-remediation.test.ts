import { beforeAll, expect, it } from "vitest";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fingerprint } from "@ate/configuration";
import { mustParseUtc } from "@ate/time";
import {
  FilesystemMOSERepository,
  MemoryMOSERepository,
  MOSECoreRuntime,
  type Checkpoint,
  type Universe,
  type Repository,
} from "@ate/mose-core";
import { fixture, owners, root, take, type Owners } from "./fixtures.js";
import { copy, rehash } from "./remediation-helpers.js";
import { multiOwners } from "./multi-owners.js";
let base: Owners;
let pair: Awaited<ReturnType<typeof multiOwners>>;
beforeAll(async () => {
  base = await owners();
  pair = await multiOwners();
});
type Member = Universe["members"][number];
const hashUniverse = (u: Universe) => {
  const { fingerprint: ignored, ...body } = u;
  void ignored;
  u.fingerprint = fingerprint(body);
};
const exclude = (m: Member) => {
  m.eligible = false;
  m.included = false;
  m.sourceReady = false;
  m.context = null;
  m.eligibilityVersion = null;
  m.eligibilityAssessment = null;
  m.inputFingerprint = null;
  m.expected = null;
  m.reasons = ["INSTRUMENT_INELIGIBLE"];
};
const faults: [string, (m: Member) => void][] = [
  [
    "F1 retained source readiness and count",
    (m) => {
      m.eligible = false;
      m.included = false;
      m.reasons = ["INSTRUMENT_INELIGIBLE"];
    },
  ],
  [
    "F2 retained context and authority",
    (m) => {
      m.eligible = false;
      m.included = false;
      m.sourceReady = false;
      m.expected = null;
      m.reasons = ["INSTRUMENT_INELIGIBLE"];
    },
  ],
  [
    "F3 expected count without context",
    (m) => {
      exclude(m);
      m.expected = 3;
    },
  ],
  [
    "ineligible source-ready with null count",
    (m) => {
      exclude(m);
      m.sourceReady = true;
    },
  ],
  [
    "ineligible retained context certificate",
    (m) => {
      const context = m.context;
      exclude(m);
      m.context = context;
    },
  ],
  [
    "ineligible retained version",
    (m) => {
      const version = m.eligibilityVersion;
      exclude(m);
      m.eligibilityVersion = version;
    },
  ],
  [
    "ineligible retained assessment",
    (m) => {
      const assessment = m.eligibilityAssessment;
      exclude(m);
      m.eligibilityAssessment = assessment;
    },
  ],
  [
    "ineligible retained input fingerprint",
    (m) => {
      const input = m.inputFingerprint;
      exclude(m);
      m.inputFingerprint = input;
    },
  ],
  [
    "ineligible affirmative reason",
    (m) => {
      exclude(m);
      m.reasons = ["OBSERVED"];
    },
  ],
  [
    "ineligible no reason",
    (m) => {
      exclude(m);
      m.reasons = [];
    },
  ],
  [
    "ineligible multiple reasons",
    (m) => {
      exclude(m);
      m.reasons.push("SOURCE_UNAVAILABLE");
    },
  ],
  [
    "ineligible downstream provenance reason",
    (m) => {
      exclude(m);
      m.reasons = ["PROVENANCE_INCOMPLETE"];
    },
  ],
  [
    "eligible-ready exclusion",
    (m) => {
      m.included = false;
    },
  ],
  [
    "eligible missing context",
    (m) => {
      m.context = null;
      m.sourceReady = false;
      m.included = false;
      m.expected = null;
      m.reasons = ["SOURCE_UNAVAILABLE"];
    },
  ],
  [
    "eligible missing authority version",
    (m) => {
      m.eligibilityVersion = null;
      m.sourceReady = false;
      m.included = false;
      m.expected = null;
      m.reasons = ["SOURCE_UNAVAILABLE"];
    },
  ],
  [
    "eligible missing authority assessment",
    (m) => {
      m.eligibilityAssessment = null;
      m.sourceReady = false;
      m.included = false;
      m.expected = null;
      m.reasons = ["SOURCE_UNAVAILABLE"];
    },
  ],
  [
    "unavailable source retains zero count",
    (m) => {
      m.sourceReady = false;
      m.included = false;
      m.expected = 0;
      m.reasons = ["SOURCE_UNAVAILABLE"];
    },
  ],
  [
    "unavailable source affirmative reason",
    (m) => {
      m.sourceReady = false;
      m.included = false;
      m.expected = null;
      m.reasons = ["OBSERVED"];
    },
  ],
  [
    "eligible with ineligible reason",
    (m) => {
      m.sourceReady = false;
      m.included = false;
      m.expected = null;
      m.reasons = ["INSTRUMENT_INELIGIBLE"];
    },
  ],
  [
    "unavailable source without reason",
    (m) => {
      m.sourceReady = false;
      m.included = false;
      m.expected = null;
      m.reasons = [];
    },
  ],
];
function bytes(path: string) {
  return Object.fromEntries(readdirSync(path).map((n) => [n, readFileSync(join(path, n), "utf8")]));
}
function writeRows(path: string, rows: Checkpoint[]) {
  let previous: string | null = null;
  for (const row of rows) {
    row.previous = previous;
    rehash(row);
    previous = row.fingerprint;
    writeFileSync(
      join(path, `generation-${String(row.generation).padStart(8, "0")}.json`),
      JSON.stringify(row),
    );
  }
}
async function seed(stage = "READY") {
  const path = root(),
    repository = new FilesystemMOSERepository(path),
    f = await fixture(base, {}, repository);
  await f.setup();
  if (stage !== "READY") take(await f.start());
  if (stage === "PAUSED") take(await f.send({ kind: "PAUSE", sessionId: "session-A" }));
  if (stage === "STOPPED") take(await f.service.stop());
  if (stage === "SECOND") take(await f.service.dispatch(f.create("session-B")));
  return { path, f, rows: copy(take(await repository.load())) as Checkpoint[] };
}
async function denied(f: Awaited<ReturnType<typeof fixture>>, repository: Repository) {
  const s = new MOSECoreRuntime("mose-lab", { ...f.ports, repository });
  expect(await s.initialize()).toMatchObject({
    ok: false,
    error: { code: "CANONICAL_PLAN_MISMATCH", commitment: "UNKNOWN" },
  });
  expect(s.diagnostics()).toMatchObject({
    lifecycle: "RECOVERY_REQUIRED",
    readiness: "NOT_READY",
    health: "DEGRADED",
    pendingAcknowledgments: 1,
  });
  expect((await s.health()).ok).toBe(false);
  for (const kind of ["START", "PAUSE", "COMPLETE"] as const) {
    const command = { kind, id: `blocked-${kind}`, sessionId: "session-A" };
    expect((await s.dispatch(command)).ok).toBe(false);
    expect((await s.dispatchJson(JSON.stringify(command))).ok).toBe(false);
  }
  expect(
    (
      await s.dispatch({
        kind: "RECEIVE",
        id: "blocked-r",
        sessionId: "session-A",
        instrumentId: base.context.instrumentId,
        eventId: "blocked",
        universeSnapshot: "sha256:" + "0".repeat(64),
      })
    ).ok,
  ).toBe(false);
  expect(
    (await s.dispatch({ kind: "PROCESS", id: "blocked-p", sessionId: "session-A", limit: 1 })).ok,
  ).toBe(false);
  expect(s.getUniverse("session-A").ok).toBe(false);
  expect(s.getSessionSummary("session-A").ok).toBe(false);
  for (const asOf of [null, "2026-10-10T09:00:00.000Z"])
    expect(s.query({ kind: "SUMMARY", sessionId: "session-A", offset: 0, limit: 1, asOf }).ok).toBe(
      false,
    );
  expect((await s.stop()).ok).toBe(false);
  expect((await s.stop()).ok).toBe(false);
  return s;
}
for (const physical of [true, false])
  for (const [name, mutate] of faults)
    it(`excluded state ${physical ? "physical" : "memory"}: ${name}`, async () => {
      const { f, path, rows } = await seed();
      const u = rows[0]!.state.sessions[0]!.universe;
      mutate(u.members[0]!);
      u.plan = [];
      hashUniverse(u);
      writeRows(path, rows);
      let commits = 0;
      const target: Repository = physical
        ? new FilesystemMOSERepository(path)
        : new MemoryMOSERepository();
      if (!physical) for (const row of rows) take(await target.commit(row));
      const repository: Repository = {
        load: () => target.load(),
        commit: (c) => {
          commits++;
          return target.commit(c);
        },
      };
      const before = bytes(path);
      // Reject known contradictions before any external owner is consulted.
      f.ports.replayEvidence = () => {
        throw Error("OWNER_UNAVAILABLE");
      };
      for (let attempt = 0; attempt < 2; attempt++) await denied(f, repository);
      expect(commits).toBe(0);
      expect(bytes(path)).toEqual(before);
    });
for (const stage of ["RUNNING", "PAUSED", "STOPPED", "SECOND"])
  for (const [name, mutate] of faults.slice(0, 3))
    it(`all retained generations reject ${name} in ${stage}`, async () => {
      const { f, path, rows } = await seed(stage);
      for (const row of rows) {
        const u = row.state.sessions[0]!.universe;
        mutate(u.members[0]!);
        u.plan = [];
        hashUniverse(u);
      }
      writeRows(path, rows);
      const before = bytes(path);
      await denied(f, f.repository);
      expect(bytes(path)).toEqual(before);
    });
it("an impossible earlier generation is rejected even if the latest member is genuine", async () => {
  const { f, path, rows } = await seed("RUNNING"),
    u = rows[0]!.state.sessions[0]!.universe;
  faults[0]![1](u.members[0]!);
  u.plan = [];
  hashUniverse(u);
  writeRows(path, rows);
  const before = bytes(path);
  await denied(f, f.repository);
  expect(bytes(path)).toEqual(before);
});
for (const mode of ["not-found", "exception", "future"] as const)
  it(`live genuine ineligible exclusion remains valid after owner restoration: ${mode}`, async () => {
    const path = root(),
      repo = new FilesystemMOSERepository(path),
      f = await fixture(base, {}, repo),
      original = f.ports.eligibility;
    if (mode === "future")
      f.ports.eligibility = {
        getEligibility: async (id) => {
          const r = await original.getEligibility(id);
          return r.ok
            ? {
                ok: true,
                value: {
                  ...r.value,
                  current: {
                    ...r.value.current,
                    evaluatedAt: mustParseUtc("2090-01-01T00:00:00.000Z"),
                  },
                },
              }
            : r;
        },
      };
    else
      f.ports.eligibility = {
        getEligibility: (_id) =>
          mode === "not-found"
            ? original.getEligibility("missing-instrument")
            : Promise.reject(Error("owner-unavailable-early")),
      };
    const u = await f.setup();
    expect(u.members[0]).toMatchObject({
      eligible: false,
      included: false,
      sourceReady: false,
      context: null,
      expected: null,
      eligibilityVersion: null,
      eligibilityAssessment: null,
      inputFingerprint: null,
    });
    f.ports.eligibility = original;
    const reader = new MOSECoreRuntime("mose-lab", { ...f.ports, repository: repo }),
      before = bytes(path);
    take(await reader.initialize());
    expect(take(reader.getUniverse("session-A"))).toEqual(u);
    expect(bytes(path)).toEqual(before);
  });
for (const phase of ["before-input", "after-input"] as const)
  it(`eligible unavailable source preserves honest partial context ${phase}`, async () => {
    const path = root(),
      f = await fixture(base, {}, new FilesystemMOSERepository(path));
    const replay = f.ports.replayEvidence,
      datasets = f.ports.datasets;
    if (phase === "before-input") f.ports.replayEvidence = () => undefined;
    else
      f.ports.datasets = {
        getVersion: (_id) => datasets.getVersion("missing-version" as typeof _id),
      };
    const u = await f.setup();
    expect(u.members[0]).toMatchObject({
      eligible: true,
      sourceReady: false,
      included: false,
      expected: null,
    });
    expect(u.members[0]!.context).not.toBeNull();
    expect(u.members[0]!.eligibilityAssessment).not.toBeNull();
    expect(u.members[0]!.inputFingerprint === null).toBe(phase === "before-input");
    f.ports.replayEvidence = replay;
    f.ports.datasets = datasets;
    const s = new MOSECoreRuntime("mose-lab", f.ports),
      before = bytes(path);
    take(await s.initialize());
    expect(take(s.getSessionSummary("session-A"))).toMatchObject({
      expectedObligations: null,
      canonicalVerification: "UNVERIFIED",
      coverageComplete: false,
      unresolvedSources: 1,
    });
    take(await s.dispatch({ kind: "START", id: "partial-start", sessionId: "session-A" }));
    expect(
      (await s.dispatch({ kind: "COMPLETE", id: "partial-complete", sessionId: "session-A" })).ok,
    ).toBe(false);
    expect(Object.keys(bytes(path))).toHaveLength(Object.keys(before).length + 1);
  });
async function paired() {
  const path = root(),
    f = await fixture(pair.a, {}, new FilesystemMOSERepository(path));
  f.ports.eligibility = {
    getEligibility: (id) =>
      id === pair.b.context.instrumentId
        ? pair.b.service.getEligibility(id)
        : pair.a.service.getEligibility(id),
  };
  f.ports.datasets = {
    getVersion: (id) =>
      id === pair.b.context.datasets[0]!.versionId
        ? pair.b.ports.datasets.getVersion(id)
        : pair.a.ports.datasets.getVersion(id),
  };
  f.ports.quality = {
    getReport: (id) =>
      id === pair.b.context.datasets[0]!.qualityReportId
        ? pair.b.ports.quality.getReport(id)
        : pair.a.ports.quality.getReport(id),
  };
  f.ports.historical = {
    getManifest: async (id) => {
      const b = await pair.b.ports.historical.getManifest(id);
      return b.ok ? b : pair.a.ports.historical.getManifest(id);
    },
  };
  f.ports.replayEvidence = (s, c) =>
    pair.a.ports.replayEvidence(s, c) ?? pair.b.ports.replayEvidence(s, c);
  const command = f.create();
  command.instruments.push({
    instrumentId: pair.b.context.instrumentId,
    source: {
      sessionId: pair.b.context.replay!.leftSession,
      checkpoint: pair.b.context.replay!.leftCheckpoint,
    },
  });
  return { f, path, command };
}
for (const index of [0, 1])
  it(`healthy source cannot hide impossible excluded peer ${index}`, async () => {
    const { f, path, command } = await paired();
    take(await f.service.dispatch(command));
    const rows = copy(take(await f.repository.load())) as Checkpoint[],
      u = rows[0]!.state.sessions[0]!.universe;
    faults[0]![1](u.members[index]!);
    u.plan = u.plan.filter((p) => p.instrumentId !== u.members[index]!.instrumentId);
    hashUniverse(u);
    writeRows(path, rows);
    await denied(f, f.repository);
  });
it("genuine excluded A plus healthy B retains B's full coverage", async () => {
  const { f, path, command } = await paired(),
    eligible = f.ports.eligibility;
  f.ports.eligibility = {
    getEligibility: (id) =>
      eligible.getEligibility(id === pair.a.context.instrumentId ? "unregistered-A" : id),
  };
  take(await f.service.dispatch(command));
  f.ports.eligibility = eligible;
  const s = new MOSECoreRuntime("mose-lab", f.ports),
    before = bytes(path);
  take(await s.initialize());
  expect(take(s.getSessionSummary("session-A"))).toMatchObject({
    expectedObligations: 3,
    coverageComplete: false,
  });
  const u = take(s.getUniverse("session-A"));
  expect(u.plan.every((p) => p.instrumentId === pair.b.context.instrumentId)).toBe(true);
  expect(bytes(path)).toEqual(before);
});
it("two genuine included sources survive repeated physical recovery", async () => {
  const { f, path, command } = await paired();
  take(await f.service.dispatch(command));
  const before = bytes(path);
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = new MOSECoreRuntime("mose-lab", f.ports);
    take(await s.initialize());
    expect(take(s.getSessionSummary("session-A"))).toMatchObject({
      expectedObligations: 6,
      coverageComplete: false,
    });
    expect(bytes(path)).toEqual(before);
  }
});
for (const excluded of [false, true])
  for (const outcome of ["NONE", "UNKNOWN", "LOST"] as const)
    it(`${excluded ? "excluded" : "included"} creation preserves ${outcome} commitment and recovery`, async () => {
      const repo = new MemoryMOSERepository(),
        f = await fixture(base, {}, repo);
      if (excluded) {
        const e = f.ports.eligibility;
        f.ports.eligibility = {
          getEligibility: () => e.getEligibility("genuine-unknown-instrument"),
        };
      }
      f.ports.repository = {
        load: () => repo.load(),
        commit: async (c) => {
          if (outcome === "LOST") {
            take(await repo.commit(c));
            throw Error("ACK_LOST");
          }
          return {
            ok: false,
            error: { code: "STORAGE_UNAVAILABLE", commitment: outcome, auditCorrelationId: "test" },
          };
        },
      };
      const command = f.create();
      expect((await f.service.dispatch(command)).ok).toBe(false);
      const debt = outcome !== "NONE";
      expect(f.service.diagnostics().pendingAcknowledgments).toBe(debt ? 1 : 0);
      expect(take(await repo.load())).toHaveLength(outcome === "LOST" ? 1 : 0);
      if (debt) {
        expect((await f.service.stop()).ok).toBe(false);
        expect((await f.service.stop()).ok).toBe(false);
      } else {
        f.ports.repository = repo;
        take(await f.service.dispatch(command));
      }
      const recovered = new MOSECoreRuntime("mose-lab", { ...f.ports, repository: repo });
      take(await recovered.initialize());
      expect(recovered.diagnostics().history).toBe(outcome === "UNKNOWN" ? 0 : 1);
      if (outcome === "LOST")
        expect(take(recovered.getUniverse("session-A")).members[0]!.included).toBe(!excluded);
    });
for (const delta of [0, -1])
  it(`genuine exclusion journal ${delta === 0 ? "exact bytes" : "one byte over"} retains byte bounds`, async () => {
    const path = root(),
      f = await fixture(base, {}, new FilesystemMOSERepository(path)),
      e = f.ports.eligibility;
    f.ports.eligibility = { getEligibility: () => e.getEligibility("actual-unregistered") };
    await f.setup();
    take(await f.start());
    const before = bytes(path),
      total = Object.values(before).reduce((n, b) => n + Buffer.byteLength(b), 0);
    const repository = new FilesystemMOSERepository(
      path,
      f.policy.maxCheckpointBytes,
      f.policy.maxHistory,
      total + delta,
    );
    const r = await repository.load();
    expect(r.ok).toBe(delta === 0);
    const reader = new MOSECoreRuntime("mose-lab", { ...f.ports, repository });
    expect((await reader.initialize()).ok).toBe(delta === 0);
    if (delta === 0)
      expect(take(reader.getSessionSummary("session-A"))).toMatchObject({
        expectedObligations: 0,
        coverageComplete: true,
      });
    else {
      expect(reader.diagnostics().readiness).toBe("NOT_READY");
      expect((await reader.stop()).ok).toBe(false);
    }
    expect(bytes(path)).toEqual(before);
  });
it("exact checkpoint capacity keeps genuine exclusion without inventing a START ACK", async () => {
  const f = await fixture(
      base,
      { maxHistory: 1 },
      new FilesystemMOSERepository(root(), 1048576, 1),
    ),
    e = f.ports.eligibility;
  f.ports.eligibility = { getEligibility: () => e.getEligibility("unregistered") };
  await f.setup();
  expect((await f.start()).ok).toBe(false);
  expect(take(await f.repository.load())).toHaveLength(1);
  const reader = new MOSECoreRuntime("mose-lab", f.ports);
  take(await reader.initialize());
  expect(reader.diagnostics()).toMatchObject({ history: 1, pendingAcknowledgments: 0 });
});
for (const eligible of [false, true])
  for (const injected of ["OBSERVED", eligible ? "INSTRUMENT_INELIGIBLE" : "PROVENANCE_INCOMPLETE"])
    it(`owner exception ${injected} cannot forge a ${eligible ? "source" : "eligibility"} reason`, async () => {
      const f = await fixture(base);
      if (eligible)
        f.ports.replayEvidence = () => {
          throw Error(injected);
        };
      else f.ports.eligibility = { getEligibility: () => Promise.reject(Error(injected)) };
      const u = await f.setup();
      expect(u.members[0]).toMatchObject({
        eligible,
        sourceReady: false,
        included: false,
        expected: null,
        reasons: ["REPLAY_EVIDENCE_INVALID"],
      });
      const reader = new MOSECoreRuntime("mose-lab", f.ports);
      take(await reader.initialize());
      expect(take(reader.getUniverse("session-A"))).toEqual(u);
    });
it("historically included member is not erased by current P24 revocation", async () => {
  const owner = await owners(),
    path = root(),
    f = await fixture(owner, {}, new FilesystemMOSERepository(path));
  const u = await f.setup();
  take(await f.start());
  await owner.promote("RESEARCH", { disposition: "REVOKED" });
  for (let i = 0; i < u.plan.length; i++) take(await f.receive(i));
  take(await f.process(u.plan.length));
  take(await f.send({ kind: "COMPLETE", sessionId: "session-A" }));
  const before = bytes(path),
    s = new MOSECoreRuntime("mose-lab", f.ports);
  take(await s.initialize());
  expect(take(s.getUniverse("session-A"))).toEqual(u);
  expect(take(s.getSessionSummary("session-A"))).toMatchObject({
    expectedObligations: 3,
    rejected: 3,
    admitted: 0,
    coverageComplete: true,
  });
  expect(take(await s.health()).health).toBe("DEGRADED");
  expect(bytes(path)).toEqual(before);
});
