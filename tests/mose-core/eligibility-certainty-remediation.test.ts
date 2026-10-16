import { beforeAll, expect, it } from "vitest";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  FilesystemMOSERepository,
  MemoryMOSERepository,
  MOSECoreRuntime,
  type Repository,
  type MOSEPorts,
  type Checkpoint,
} from "@ate/mose-core";
import { fixture, owners, root, take, type Owners } from "./fixtures.js";
import { copy } from "./remediation-helpers.js";
import { multiOwners } from "./multi-owners.js";
let base: Owners;
let pair: Awaited<ReturnType<typeof multiOwners>>;
beforeAll(async () => {
  base = await owners();
  pair = await multiOwners();
});
type Fixture = Awaited<ReturnType<typeof fixture>>;
const unavailable = (code = "SOURCE_UNAVAILABLE", commitment: "NONE" | "UNKNOWN" = "NONE") => ({
  ok: false as const,
  error: { code, commitment, auditCorrelationId: "H-controlled-offline-fault" },
});
const unknownModes = [
  "unavailable",
  "timeout",
  "exception",
  "null",
  "malformed",
  "wrong-subject",
  "future",
  "bad-fingerprint",
  "thrown-denial",
  "thrown-success",
] as const;
type UnknownMode = (typeof unknownModes)[number];
function eligibilityFault(f: Fixture, mode: UnknownMode | "not-found", only?: string) {
  const original = f.ports.eligibility;
  const lookup = async (id: string): Promise<unknown> => {
    if (only && id !== only) return original.getEligibility(id);
    if (mode === "not-found") return original.getEligibility("actually-unregistered-H");
    if (mode === "unavailable" || mode === "timeout")
      return unavailable(mode === "timeout" ? "TIMEOUT" : "SOURCE_UNAVAILABLE");
    if (mode === "exception") throw Error("temporary owner outage");
    if (mode === "thrown-denial") throw Error("INSTRUMENT_INELIGIBLE");
    if (mode === "thrown-success") throw Error("OBSERVED");
    if (mode === "null") return null;
    if (mode === "malformed") return { ok: true, value: null };
    const v = take(await original.getEligibility(id));
    if (mode === "wrong-subject")
      return {
        ok: true,
        value: { ...v, recorded: { ...v.recorded, instrumentId: "wrong-subject" } },
      };
    if (mode === "future")
      return {
        ok: true,
        value: { ...v, current: { ...v.current, evaluatedAt: "2090-01-01T00:00:00.000Z" } },
      };
    return {
      ok: true,
      value: { ...v, current: { ...v.current, fingerprint: "sha256:" + "e".repeat(64) } },
    };
  };
  // Explicit native-boundary injection; the real accepted owner supplies every unaffected response.
  f.ports.eligibility = { getEligibility: lookup as MOSEPorts["eligibility"]["getEligibility"] };
  return () => {
    f.ports.eligibility = original;
  };
}
const sourceModes = [
  "datasets",
  "quality",
  "historical",
  "replay",
  "exception",
  "malformed",
] as const;
type SourceMode = (typeof sourceModes)[number];
function sourceFault(f: Fixture, mode: SourceMode) {
  const original = {
    datasets: f.ports.datasets,
    quality: f.ports.quality,
    historical: f.ports.historical,
    replayEvidence: f.ports.replayEvidence,
  };
  let held = true;
  if (mode === "datasets")
    f.ports.datasets = {
      getVersion: (id) =>
        held
          ? original.datasets.getVersion("H-held-unavailable" as typeof id)
          : original.datasets.getVersion(id),
    };
  if (mode === "quality")
    f.ports.quality = {
      getReport: (id) =>
        held
          ? original.quality.getReport("H-held-unavailable" as typeof id)
          : original.quality.getReport(id),
    };
  if (mode === "historical")
    f.ports.historical = {
      getManifest: (id) =>
        held
          ? original.historical.getManifest("H-held-unavailable" as typeof id)
          : original.historical.getManifest(id),
    };
  if (mode === "replay")
    f.ports.replayEvidence = (session, checkpoint) =>
      held ? undefined : original.replayEvidence(session, checkpoint);
  if (mode === "exception")
    f.ports.datasets = {
      getVersion: (id) =>
        held
          ? Promise.reject(Error("temporary dataset owner outage"))
          : original.datasets.getVersion(id),
    };
  if (mode === "malformed")
    f.ports.datasets = {
      getVersion: ((id: Parameters<MOSEPorts["datasets"]["getVersion"]>[0]) =>
        held
          ? Promise.resolve(null)
          : original.datasets.getVersion(id)) as unknown as MOSEPorts["datasets"]["getVersion"],
    };
  // Both original and freshly recovered services hold this same callback interface.
  return () => {
    held = false;
  };
}
const rows = async (r: Repository) => copy(take(await r.load())) as Checkpoint[];
const summary = (f: Fixture) => take(f.service.getSessionSummary("session-A"));
const unknownSummary = (s: MOSECoreRuntime, id = "session-A") => {
  expect(take(s.getSessionSummary(id))).toMatchObject({
    canonicalVerification: "UNVERIFIED",
    expectedObligations: null,
    coverageComplete: false,
    unresolvedEligibility: 1,
    excluded: 0,
  });
};
async function fresh(f: Fixture, repository = f.repository) {
  const s = new MOSECoreRuntime("mose-lab", { ...f.ports, repository });
  take(await s.initialize());
  return s;
}
async function completeDenied(s: MOSECoreRuntime, id = "session-A") {
  expect(
    await s.dispatch({ kind: "COMPLETE", id: "H-complete-direct-" + id, sessionId: id }),
  ).toMatchObject({ ok: false, error: { commitment: "NONE" } });
  expect(
    (
      await s.dispatchJson(
        JSON.stringify({ kind: "COMPLETE", id: "H-complete-json-" + id, sessionId: id }),
      )
    ).ok,
  ).toBe(false);
}
function diskBytes(path: string) {
  return Object.fromEntries(readdirSync(path).map((n) => [n, readFileSync(join(path, n), "utf8")]));
}
async function mixed() {
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
// 12 classification cases, including two genuine accepted negative results.
for (const mode of [...unknownModes, "not-found", "revoked"] as const)
  it(`H eligibility certainty: ${mode}`, async () => {
    const owner = mode === "revoked" ? await owners() : base;
    if (mode === "revoked") await owner.promote("RESEARCH", { disposition: "REVOKED" });
    const f = await fixture(owner);
    if (mode !== "revoked") eligibilityFault(f, mode);
    const u = await f.setup();
    expect(u.members[0]!.eligible).toBe(false);
    const denial = mode === "not-found" || mode === "revoked";
    if (denial) {
      expect(u.members[0]!.reasons).toEqual(["INSTRUMENT_INELIGIBLE"]);
      expect(summary(f)).toMatchObject({
        excluded: 1,
        unresolvedEligibility: 0,
        expectedObligations: 0,
        coverageComplete: true,
      });
    } else {
      unknownSummary(f.service);
      expect(take(await f.service.health()).health).toBe("DEGRADED");
      expect(f.service.diagnostics().memberClassifications[0]!.classification).toBe(
        "ELIGIBILITY_UNRESOLVED",
      );
    }
    expect(f.service.diagnostics().pendingAcknowledgments).toBe(0);
  });
// 10 whole-universe COMPLETE barriers, with genuinely processed peer observations.
for (const mixedSources of [false, true])
  for (const mode of [
    "unavailable",
    "exception",
    "future",
    "wrong-subject",
    "thrown-denial",
  ] as const)
    it(`H COMPLETE cannot certify ${mixedSources ? "mixed" : "single"} ${mode}`, async () => {
      const m = mixedSources ? await mixed() : null,
        f = m?.f ?? (await fixture(base));
      eligibilityFault(f, mode, mixedSources ? pair.b.context.instrumentId : undefined);
      if (m) take(await f.service.dispatch(m.command));
      else await f.setup();
      take(await f.start());
      if (mixedSources) {
        for (let i = 0; i < 3; i++) take(await f.receive(i));
        take(await f.process(3));
        expect(summary(f).admitted).toBe(3);
      }
      const before = await rows(f.repository);
      await completeDenied(f.service);
      expect(await rows(f.repository)).toEqual(before);
      unknownSummary(f.service);
      const s = await fresh(f);
      unknownSummary(s);
      await completeDenied(s);
      expect(await rows(f.repository)).toEqual(before);
    });
// 12 continuity cases, both supported repositories and all source-failure boundaries.
for (const physical of [false, true])
  for (const mode of sourceModes)
    it(`H partial-source live/fresh health ${mode}/${physical ? "filesystem" : "memory"}`, async () => {
      const path = root(),
        repo = physical ? new FilesystemMOSERepository(path) : new MemoryMOSERepository(),
        f = await fixture(base, {}, repo);
      sourceFault(f, mode);
      const u = await f.setup();
      expect(u.members[0]).toMatchObject({
        eligible: true,
        sourceReady: false,
        included: false,
        expected: null,
      });
      expect(take(await f.service.health()).health).toBe("DEGRADED");
      const before = await rows(repo),
        raw = diskBytes(path),
        s = await fresh(f);
      expect(s.diagnostics().health).toBe("DEGRADED");
      for (let n = 0; n < 3; n++) expect(take(await s.health()).health).toBe("DEGRADED");
      expect(s.diagnostics().sourceReadinessAxes[0]!.dataSourceReady).toBe(false);
      expect(take(s.getSessionSummary("session-A"))).toMatchObject({
        expectedObligations: null,
        canonicalVerification: "UNVERIFIED",
        coverageComplete: false,
        unresolvedEligibility: 0,
      });
      expect(await rows(repo)).toEqual(before);
      expect(diskBytes(path)).toEqual(raw);
    });
// 8 genuine restoration cases: health proof can improve without historical inclusion.
for (const recovered of [false, true])
  for (const mode of ["datasets", "quality", "historical", "replay"] as const)
    it(`H accepted owner restoration ${mode}/${recovered ? "fresh" : "same"}`, async () => {
      const f = await fixture(base),
        restore = sourceFault(f, mode),
        u = await f.setup(),
        before = await rows(f.repository),
        s = recovered ? await fresh(f) : f.service;
      expect(take(await s.health()).health).toBe("DEGRADED");
      restore();
      expect(take(await s.health()).health).toBe("HEALTHY");
      expect(s.diagnostics().sourceReadinessAxes[0]).toMatchObject({
        dataSourceReady: true,
        eligibilityReady: true,
        universeAuthority: true,
      });
      expect(take(s.getUniverse("session-A"))).toEqual(u);
      expect(take(s.getSessionSummary("session-A"))).toMatchObject({
        expectedObligations: null,
        canonicalVerification: "UNVERIFIED",
        coverageComplete: false,
      });
      expect(await rows(f.repository)).toEqual(before);
    });
// 6 lifecycle/immutable-history cases.
for (const stage of ["READY", "RUNNING", "PAUSED", "STOPPED", "SECOND", "RESTORED"] as const)
  it(`H historical unknown stays unknown through ${stage}`, async () => {
    const path = root(),
      f = await fixture(base, {}, new FilesystemMOSERepository(path)),
      restore = eligibilityFault(f, "unavailable");
    await f.setup();
    if (stage !== "READY") take(await f.start());
    if (stage === "PAUSED" || stage === "SECOND")
      take(await f.send({ kind: "PAUSE", sessionId: "session-A" }));
    if (stage === "STOPPED") take(await f.service.dispatch({ kind: "STOP", id: f.next() }));
    if (stage === "SECOND") take(await f.service.dispatch(f.create("session-B")));
    if (stage === "RESTORED") restore();
    const before = await rows(f.repository),
      raw = diskBytes(path);
    for (let n = 0; n < 2; n++) {
      const s = await fresh(f);
      unknownSummary(s);
      expect(take(s.getUniverse("session-A")).members[0]!.reasons).toEqual(["SOURCE_UNAVAILABLE"]);
      await completeDenied(s);
      expect(await rows(f.repository)).toEqual(before);
      expect(diskBytes(path)).toEqual(raw);
    }
  });
// 6 durable publication outcomes, distinct from classification/source uncertainty.
for (const partial of [false, true])
  for (const outcome of ["NONE", "UNKNOWN", "LOST"] as const)
    it(`H ${partial ? "partial-source" : "unknown-eligibility"} retains ${outcome} acknowledgement semantics`, async () => {
      const repo = new MemoryMOSERepository(),
        f = await fixture(base, {}, repo);
      if (partial) sourceFault(f, "replay");
      else eligibilityFault(f, "unavailable");
      f.ports.repository = {
        load: () => repo.load(),
        commit: async (c) => {
          if (outcome === "LOST") {
            take(await repo.commit(c));
            throw Error("ACK_LOST");
          }
          return unavailable("STORAGE_UNAVAILABLE", outcome);
        },
      };
      const command = f.create();
      expect((await f.service.dispatch(command)).ok).toBe(false);
      expect(f.service.diagnostics().pendingAcknowledgments).toBe(outcome === "NONE" ? 0 : 1);
      expect(await rows(repo)).toHaveLength(outcome === "LOST" ? 1 : 0);
      if (outcome !== "NONE") {
        expect((await f.service.stop()).ok).toBe(false);
        expect((await f.service.stop()).ok).toBe(false);
      } else {
        expect(take(await f.service.health()).health).toBe("HEALTHY");
        f.ports.repository = repo;
        take(await f.service.dispatch(command));
      }
      const s = await fresh(f, repo);
      if (outcome !== "UNKNOWN") {
        expect(take(s.getSessionSummary("session-A"))).toMatchObject({
          expectedObligations: null,
          canonicalVerification: "UNVERIFIED",
          coverageComplete: false,
        });
        take(await s.dispatch({ kind: "START", id: "H-after-ack", sessionId: "session-A" }));
        await completeDenied(s);
      }
    });
// 6 exact/one-over repository boundaries; no runtime budget is enlarged.
for (const resource of ["retained", "checkpoint", "count"] as const)
  for (const over of [false, true])
    it(`H unknown history ${resource} ${over ? "one-over" : "exact"} boundary`, async () => {
      const path = root(),
        f = await fixture(base, {}, new FilesystemMOSERepository(path));
      eligibilityFault(f, "unavailable");
      await f.setup();
      take(await f.service.dispatch(f.create("session-B")));
      const before = diskBytes(path),
        sizes = Object.values(before).map((v) => Buffer.byteLength(v)),
        total = sizes.reduce((a, b) => a + b, 0),
        max = Math.max(...sizes),
        n = sizes.length;
      const repo = new FilesystemMOSERepository(
        path,
        resource === "checkpoint" ? max - (over ? 1 : 0) : f.policy.maxCheckpointBytes,
        resource === "count" ? n - (over ? 1 : 0) : f.policy.maxHistory,
        resource === "retained" ? total - (over ? 1 : 0) : f.policy.maxRetainedBytes,
      );
      const s = new MOSECoreRuntime("mose-lab", { ...f.ports, repository: repo }),
        result = await s.initialize();
      expect(result.ok).toBe(!over);
      if (!over) {
        unknownSummary(s);
        expect(s.diagnostics().health).toBe("DEGRADED");
      } else expect(s.diagnostics().readiness).toBe("NOT_READY");
      expect(diskBytes(path)).toEqual(before);
    });
// 6 public views agree without upgrading historical authority.
for (const view of ["summary", "historical", "universe", "diagnostics", "health", "json"] as const)
  it(`H uncertainty is visible through ${view}`, async () => {
    const f = await fixture(base);
    eligibilityFault(f, "exception");
    const u = await f.setup();
    take(await f.start());
    const before = await rows(f.repository);
    if (view === "summary") unknownSummary(f.service);
    if (view === "historical") {
      const q = take(
        f.service.query({
          kind: "SUMMARY",
          sessionId: "session-A",
          offset: 0,
          limit: 1,
          asOf: f.clock.now(),
        }),
      );
      expect(q).toMatchObject({
        currentAuthorityNotEstablishedByHistoricalQuery: true,
        value: {
          canonicalVerification: "UNVERIFIED",
          expectedObligations: null,
          coverageComplete: false,
          unresolvedEligibility: 1,
        },
      });
    }
    if (view === "universe") expect(take(f.service.getUniverse("session-A"))).toEqual(u);
    if (view === "diagnostics")
      expect(f.service.diagnostics()).toMatchObject({
        health: "DEGRADED",
        pendingAcknowledgments: 0,
        memberClassifications: [{ classification: "ELIGIBILITY_UNRESOLVED" }],
      });
    if (view === "health") expect(take(await f.service.health()).health).toBe("DEGRADED");
    if (view === "json")
      expect(
        (
          await f.service.dispatchJson(
            JSON.stringify({ kind: "COMPLETE", id: "H-json-unknown", sessionId: "session-A" }),
          )
        ).ok,
      ).toBe(false);
    expect(await rows(f.repository)).toEqual(before);
  });
// Eight named integration journeys complement the focused invariants above.
it("H J1 genuine accepted denial can complete without replay reconstruction", async () => {
  const f = await fixture(base);
  eligibilityFault(f, "not-found");
  f.ports.replayEvidence = () => {
    throw Error("NO_REPLAY_DUTY");
  };
  await f.setup();
  take(await f.start());
  take(await f.send({ kind: "COMPLETE", sessionId: "session-A" }));
  expect(summary(f)).toMatchObject({
    expectedObligations: 0,
    coverageComplete: true,
    excluded: 1,
    unresolvedEligibility: 0,
  });
});
it("H J2 single-source unknown CREATE START COMPLETE and fresh recovery", async () => {
  const f = await fixture(base);
  eligibilityFault(f, "unavailable");
  await f.setup();
  take(await f.start());
  await completeDenied(f.service);
  unknownSummary(await fresh(f));
});
it("H J3 mixed-source unknown cannot hide behind three genuinely admitted receipts", async () => {
  const { f, command } = await mixed();
  eligibilityFault(f, "unavailable", pair.b.context.instrumentId);
  take(await f.service.dispatch(command));
  take(await f.start());
  for (let n = 0; n < 3; n++) take(await f.receive(n));
  take(await f.process(3));
  expect(summary(f).admitted).toBe(3);
  await completeDenied(f.service);
  unknownSummary(await fresh(f));
});
it("H J4 restoration permits a new verified universe without rewriting old uncertainty", async () => {
  const f = await fixture(base),
    restore = eligibilityFault(f, "unavailable");
  const old = await f.setup();
  take(await f.start());
  take(await f.send({ kind: "PAUSE", sessionId: "session-A" }));
  const prefix = await rows(f.repository);
  restore();
  take(await f.service.dispatch(f.create("new-verified", { previousUniverse: old.fingerprint })));
  take(await f.service.dispatch({ kind: "START", id: f.next(), sessionId: "new-verified" }));
  const u = take(f.service.getUniverse("new-verified"));
  for (const p of u.plan)
    take(
      await f.service.dispatch({
        kind: "RECEIVE",
        id: f.next(),
        sessionId: "new-verified",
        instrumentId: p.instrumentId,
        eventId: p.eventId,
        universeSnapshot: u.fingerprint,
      }),
    );
  take(
    await f.service.dispatch({
      kind: "PROCESS",
      id: f.next(),
      sessionId: "new-verified",
      limit: 3,
    }),
  );
  take(await f.service.dispatch({ kind: "COMPLETE", id: f.next(), sessionId: "new-verified" }));
  expect(take(f.service.getSessionSummary("new-verified")).coverageComplete).toBe(true);
  unknownSummary(f.service);
  expect((await rows(f.repository)).slice(0, prefix.length)).toEqual(prefix);
  unknownSummary(await fresh(f));
});
it("H J5 source-unready live and fresh health remain degraded on identical ports", async () => {
  const f = await fixture(base);
  sourceFault(f, "datasets");
  await f.setup();
  expect(take(await f.service.health()).health).toBe("DEGRADED");
  const s = await fresh(f);
  expect(take(await s.health()).health).toBe("DEGRADED");
  expect(take(s.getSessionSummary("session-A")).canonicalVerification).toBe("UNVERIFIED");
});
it("H J6 supported source restoration proves current health, not historical completion", async () => {
  const f = await fixture(base),
    restore = sourceFault(f, "quality"),
    u = await f.setup(),
    s = await fresh(f);
  expect(take(await s.health()).health).toBe("DEGRADED");
  restore();
  expect(take(await s.health()).health).toBe("HEALTHY");
  expect(take(s.getUniverse("session-A"))).toEqual(u);
  take(await s.dispatch({ kind: "START", id: "J6-start", sessionId: "session-A" }));
  await completeDenied(s);
  expect(take(s.getSessionSummary("session-A")).expectedObligations).toBeNull();
});
it("H J7 earlier unknown survives multiple acknowledged lifecycle transitions", async () => {
  const f = await fixture(base);
  eligibilityFault(f, "timeout");
  await f.setup();
  take(await f.start());
  take(await f.send({ kind: "PAUSE", sessionId: "session-A" }));
  take(await f.start());
  const before = await rows(f.repository);
  const s = await fresh(f);
  unknownSummary(s);
  await completeDenied(s);
  expect(await rows(f.repository)).toEqual(before);
});
it("H J8 lost ACK recovery retains genuine unknown eligibility without phantom completion", async () => {
  const repo = new MemoryMOSERepository(),
    f = await fixture(base, {}, repo);
  eligibilityFault(f, "unavailable");
  f.ports.repository = {
    load: () => repo.load(),
    commit: async (c) => {
      take(await repo.commit(c));
      throw Error("LOST_J8_ACK");
    },
  };
  expect((await f.service.dispatch(f.create())).ok).toBe(false);
  expect(f.service.diagnostics().pendingAcknowledgments).toBe(1);
  expect((await f.service.stop()).ok).toBe(false);
  const s = await fresh(f, repo);
  unknownSummary(s);
  take(await s.dispatch({ kind: "START", id: "J8-start", sessionId: "session-A" }));
  await completeDenied(s);
});

// Exact G CONF-H01 bytes, not a synthetic current-service completion or migration.
const legacy = JSON.parse(
  readFileSync(new URL("./legacy-unknown-completion.json", import.meta.url), "utf8"),
) as { files: Record<string, string>; sha256: Record<string, string> };
for (const view of ["history", "idempotent-ack"] as const)
  it(`H legacy acknowledged unknown COMPLETE remains evidence, not fresh authority: ${view}`, async () => {
    const path = root(),
      entries = Object.entries(legacy.files);
    for (const [name, raw] of entries) {
      expect(createHash("sha256").update(raw).digest("hex")).toBe(legacy.sha256[name]);
      writeFileSync(join(path, name), raw);
    }
    const first = JSON.parse(entries[0]![1]) as Checkpoint,
      last = JSON.parse(entries.at(-1)![1]) as Checkpoint;
    const repository = new FilesystemMOSERepository(path),
      f = await fixture(base, first.state.sessions[0]!.universe.policy, repository, false),
      s = new MOSECoreRuntime(first.runtimeId, f.ports),
      before = diskBytes(path);
    take(await s.initialize());
    expect(take(s.getSessionSummary("audit-session"))).toMatchObject({
      sessionStatus: "COMPLETED",
      canonicalVerification: "UNVERIFIED",
      expectedObligations: null,
      coverageComplete: false,
      unresolvedEligibility: 1,
    });
    expect(s.diagnostics().health).toBe("DEGRADED");
    if (view === "history")
      expect(
        take(
          s.query({
            kind: "SUMMARY",
            sessionId: "audit-session",
            offset: 0,
            limit: 1,
            asOf: last.at,
          }),
        ),
      ).toMatchObject({
        currentAuthorityNotEstablishedByHistoricalQuery: true,
        value: { coverageComplete: false, canonicalVerification: "UNVERIFIED" },
      });
    else expect(take(await s.dispatch(last.command))).toEqual(last);
    expect(
      (
        await s.dispatch({
          kind: "COMPLETE",
          id: "new-legacy-completion",
          sessionId: "audit-session",
        })
      ).ok,
    ).toBe(false);
    expect(diskBytes(path)).toEqual(before);
    expect(await rows(repository)).toHaveLength(3);
  });

it("H health scopes cannot alias unknown and verified session/instrument tuples", async () => {
  const f = await fixture(base),
    real = base.context.instrumentId,
    unknown = "B:" + real;
  eligibilityFault(f, "unavailable", unknown);
  const a = f.create();
  a.sessionId = "A";
  a.instruments[0]!.instrumentId = unknown;
  take(await f.service.dispatch(a));
  const b = f.create();
  b.id = "H-collision-peer";
  b.sessionId = "A:B";
  take(await f.service.dispatch(b));
  for (const service of [f.service, await fresh(f)]) {
    expect(take(await service.health()).health).toBe("DEGRADED");
    const scopes = service.diagnostics().sourceReadiness;
    expect(scopes).toHaveLength(2);
    expect(new Set(scopes.map((x) => x.scope)).size).toBe(2);
    expect(scopes.filter((x) => !x.ready)).toHaveLength(1);
    expect(take(service.getSessionSummary("A")).expectedObligations).toBeNull();
    expect(take(service.getSessionSummary("A:B")).expectedObligations).toBe(3);
    await completeDenied(service, "A");
  }
  take(await f.service.dispatch({ kind: "START", id: "H-peer-start", sessionId: "A:B" }));
  for (let i = 0; i < 3; i++) {
    const u = take(f.service.getUniverse("A:B")),
      event = u.plan[i]!;
    take(
      await f.service.dispatch({
        kind: "RECEIVE",
        id: f.next(),
        sessionId: "A:B",
        eventId: event.eventId,
        instrumentId: event.instrumentId,
        universeSnapshot: u.fingerprint,
      }),
    );
  }
  take(
    await f.service.dispatch({ kind: "PROCESS", id: "H-peer-process", sessionId: "A:B", limit: 3 }),
  );
  take(await f.service.dispatch({ kind: "COMPLETE", id: "H-peer-complete", sessionId: "A:B" }));
  expect(take(await f.service.health()).health).toBe("DEGRADED");
});
