import { beforeAll, it, expect } from "vitest";
import {
  MOSECoreRuntime,
  FilesystemMOSERepository,
  type Checkpoint,
  type Repository,
} from "@ate/mose-core";
import { fingerprint } from "@ate/configuration";
import { writeFile, readFile, readdir } from "node:fs/promises";
import { multiOwners } from "./multi-owners.js";
import { fixture, take, owners, root, time } from "./fixtures.js";
let m: Awaited<ReturnType<typeof multiOwners>>;
beforeAll(async () => {
  m = await multiOwners();
});
async function mixed(changes: Parameters<typeof fixture>[1] = {}) {
  const f = await fixture(m.a, changes);
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
    getManifest: (id) =>
      m.b.ports.historical
        .getManifest(id)
        .then((r) => (r.ok ? r : m.a.ports.historical.getManifest(id))),
  };
  f.ports.eligibility = {
    getEligibility: (id) =>
      id === m.b.context.instrumentId
        ? m.b.service.getEligibility(id)
        : m.a.service.getEligibility(id),
  };
  f.ports.replayEvidence = (s, c) =>
    m.b.ports.replayEvidence(s, c) ?? m.a.ports.replayEvidence(s, c);
  const replay = m.b.context.replay!,
    a = f.create();
  const checkpoint = take(
    await f.service.dispatch({
      ...a,
      instruments: [
        ...a.instruments,
        {
          instrumentId: m.b.context.instrumentId,
          source: { sessionId: replay.leftSession, checkpoint: replay.leftCheckpoint },
        },
      ],
    }),
  );
  return { ...f, universe: checkpoint.state.sessions[0]!.universe };
}
async function receiveAll(f: Awaited<ReturnType<typeof fixture>>, count: number) {
  take(await f.start());
  for (let i = 0; i < count; i++) take(await f.receive(i));
}
it("J01 clean genuine historical session reaches exact complete research accounting", async () => {
  const f = await mixed();
  await receiveAll(f, f.universe.plan.length);
  const cp = take(await f.process());
  take(await f.send({ kind: "COMPLETE", sessionId: "session-A" }));
  const summary = take(f.service.getSessionSummary("session-A"));
  expect(summary).toMatchObject({ received: 6, admitted: 6, pending: 0, coverageComplete: true });
  expect(
    cp.state.sessions[0]!.observations.every((o) => o.funnelEvent?.newStage === "OBSERVED"),
  ).toBe(true);
  take(await f.service.stop());
});
it("J02 mixed eligibility preserves explicit canonical exclusions and denominator", async () => {
  const f = await fixture(m.a),
    a = f.create();
  const c = take(
    await f.service.dispatch({
      ...a,
      instruments: [
        ...a.instruments,
        { ...a.instruments[0]!, instrumentId: "unregistered-instrument" },
      ],
    }),
  );
  expect(
    c.state.sessions[0]!.universe.members.find((i) => i.instrumentId === "unregistered-instrument")
      ?.reasons,
  ).toContain("INSTRUMENT_INELIGIBLE");
  expect(take(f.service.getSessionSummary("session-A"))).toMatchObject({
    configured: 2,
    eligible: 1,
    excluded: 1,
  });
});
it("J03 real owner quality withdrawal rejects B while genuine A remains admitted", async () => {
  const f = await mixed();
  await receiveAll(f, 6);
  m.faults.qualityUnavailable = true;
  try {
    const c = take(await f.process()),
      observations = c.state.sessions[0]!.observations;
    expect(
      observations
        .filter((o) => o.instrumentId === m.a.context.instrumentId)
        .every((o) => o.outcome === "ADMITTED"),
    ).toBe(true);
    const b = observations.filter((o) => o.instrumentId === m.b.context.instrumentId);
    expect(b).toHaveLength(3);
    expect(
      b.every(
        (o) => o.outcome === "REJECTED" && o.eligibilityReasons.includes("DATASET_NOT_QUALIFIED"),
      ),
    ).toBe(true);
  } finally {
    m.faults.qualityUnavailable = false;
  }
});
it("J04 equivalent source/universe/policy/clock produces identical logical observations", async () => {
  const first = await fixture(m.a),
    second = await fixture(m.a);
  await first.setup();
  await second.setup();
  await receiveAll(first, 3);
  await receiveAll(second, 3);
  const a = take(await first.process()),
    b = take(await second.process());
  expect(a.state).toEqual(b.state);
  expect(a.fingerprint).toBe(b.fingerprint);
});
it("J05 absent or not-yet-complete higher-timeframe owner evidence is deferred", async () => {
  const f = await fixture(m.a, { requiredTimeframes: ["H1", "H4"] });
  await f.setup();
  await receiveAll(f, 1);
  const c = take(await f.process());
  expect(c.state.sessions[0]!.observations[0]).toMatchObject({
    outcome: "DEFERRED",
    reason: "TEMPORAL_INCONSISTENCY",
    funnelEvent: null,
  });
  expect(take(f.service.getSessionSummary("session-A")).completionCoverage.numerator).toBe(0);
});
it("J06 duplicate logical receipt cannot inflate counters or produce another funnel event", async () => {
  const f = await fixture(m.a);
  await f.setup();
  await receiveAll(f, 1);
  take(await f.process());
  const before = take(f.service.getSessionSummary("session-A"));
  expect((await f.receive(0)).ok).toBe(false);
  expect(take(f.service.getSessionSummary("session-A"))).toEqual(before);
});
it("J07 explicit new universe version preserves earlier immutable snapshot and obligations", async () => {
  const f = await fixture(m.a),
    first = await f.setup();
  take(await f.start());
  take(await f.send({ kind: "PAUSE", sessionId: "session-A" }));
  take(await f.service.dispatch(f.create("session-B", { previousUniverse: first.fingerprint })));
  expect(take(f.service.getUniverse("session-A"))).toEqual(first);
  expect(take(f.service.getUniverse("session-B")).previousUniverse).toBe(first.fingerprint);
  expect(take(f.service.getSessionSummary("session-A")).unreceived).toBe(3);
});
it("J08 queue resource exhaustion preserves exact accepted obligation and supports draining", async () => {
  const f = await fixture(m.a, { maxQueued: 1 });
  await f.setup();
  await receiveAll(f, 1);
  expect(await f.receive(1)).toMatchObject({
    ok: false,
    error: { code: "RESOURCE_BUDGET_EXCEEDED", commitment: "NONE" },
  });
  expect(take(f.service.getSessionSummary("session-A")).pending).toBe(1);
  take(await f.process(1));
  take(await f.receive(1));
});
it("J09 lost acknowledgement after real immutable publication retains debt and fresh recovery", async () => {
  const path = root(),
    actual = new FilesystemMOSERepository(path);
  let first = true;
  const repository: Repository = {
    load: () => actual.load(),
    commit: async (c) => {
      const r = await actual.commit(c);
      if (first) {
        first = false;
        throw Error("AFTER_REAL_COMMIT");
      }
      return r;
    },
  };
  const f = await fixture(m.a, {}, repository);
  expect((await f.service.dispatch(f.create())).ok).toBe(false);
  expect(f.service.diagnostics().recoveryObligation).not.toBeNull();
  expect((await f.service.stop()).ok).toBe(false);
  const reader = new MOSECoreRuntime("mose-lab", { ...f.ports, repository: actual });
  take(await reader.initialize());
  expect(take(reader.getUniverse("session-A")).members[0]!.included).toBe(true);
  take(await reader.stop());
});
it("J10 actual P24 revocation blocks current surveillance while recorded observations remain", async () => {
  const b = await owners(),
    f = await fixture(b);
  await f.setup();
  await receiveAll(f, 1);
  const prior = take(await f.process()).state.sessions[0]!.observations[0]!;
  await b.promote("RESEARCH", { disposition: "REVOKED", reason: "Governed research withdrawal" });
  take(await f.receive(1));
  const current = take(await f.process()).state.sessions[0]!.observations;
  expect(current[0]).toEqual(prior);
  expect(current[1]).toMatchObject({ outcome: "REJECTED", reason: "INSTRUMENT_INELIGIBLE" });
});
it("J11 unavailable A is deferred without corrupting B; exact retry preserves B identities", async () => {
  const f = await mixed();
  await receiveAll(f, 6);
  const original = f.ports.replayEvidence;
  f.ports.replayEvidence = (s, c) =>
    s === m.a.context.replay!.leftSession ? undefined : original(s, c);
  const c = take(await f.process()),
    b = c.state.sessions[0]!.observations.filter(
      (o) => o.instrumentId === m.b.context.instrumentId,
    );
  expect(b.every((o) => o.outcome === "ADMITTED")).toBe(true);
  expect(
    c.state.sessions[0]!.observations.filter(
      (o) => o.instrumentId === m.a.context.instrumentId,
    ).every((o) => o.outcome === "DEFERRED"),
  ).toBe(true);
  f.ports.replayEvidence = original;
  const recovered = take(await f.process()).state.sessions[0]!.observations;
  expect(recovered.filter((o) => o.instrumentId === m.b.context.instrumentId)).toEqual(b);
  expect(recovered.every((o) => o.outcome === "ADMITTED")).toBe(true);
});
it("J12 historical as-of reporting excludes later processing knowledge", async () => {
  const f = await fixture(m.a);
  await f.setup();
  await receiveAll(f, 1);
  f.clock.advanceTo("2026-10-10T09:00:01.000Z" as typeof time);
  take(await f.process());
  expect(
    f.service.query({ kind: "SUMMARY", sessionId: "session-A", offset: 0, limit: 10, asOf: time }),
  ).toMatchObject({
    ok: true,
    value: { scope: "RECORDED_AS_OF", value: { admitted: 0, pending: 1 } },
  });
  expect(take(f.service.getSessionSummary("session-A")).admitted).toBe(1);
});
it("J13 every durable receipt is reconciled without counting returned API refusals", async () => {
  const f = await mixed();
  await receiveAll(f, 6);
  take(await f.process());
  expect((await f.receive(0)).ok).toBe(false);
  const s = take(f.service.getSessionSummary("session-A"));
  expect(s.received).toBe(s.admitted + s.rejected + s.quarantined + s.pending);
  expect(s.received).toBe(6);
  expect(s.evidenceQualificationCoverage).toMatchObject({ numerator: 6, denominator: 6 });
});
it("J14 no reserved downstream stage owner can be impersonated", async () => {
  const f = await fixture(m.a);
  await f.setup();
  const before = f.service.diagnostics().history;
  expect(
    (
      await f.service.dispatch({
        kind: "FUNNEL",
        id: f.next(),
        stageOwner: "RISK",
        newStage: "RISK_ELIGIBLE",
      })
    ).ok,
  ).toBe(false);
  expect(f.service.diagnostics().history).toBe(before);
});
it("J15 fresh restart and repeated shutdown retain accepted identities and prohibit admission", async () => {
  const path = root(),
    repo = new FilesystemMOSERepository(path),
    f = await fixture(m.a, {}, repo);
  await f.setup();
  await receiveAll(f, 1);
  const original = take(await f.process());
  const reader = new MOSECoreRuntime("mose-lab", { ...f.ports, repository: repo });
  take(await reader.initialize());
  expect(take(reader.getUniverse("session-A")).fingerprint).toBe(
    original.state.sessions[0]!.universe.fingerprint,
  );
  take(await reader.stop());
  take(await reader.stop());
  expect(
    (await reader.dispatch({ kind: "START", id: "after-stop", sessionId: "session-A" })).ok,
  ).toBe(false);
});
it("J16 corrupt physical history fails closed without fabricated completion", async () => {
  const path = root(),
    repo = new FilesystemMOSERepository(path),
    f = await fixture(m.a, {}, repo);
  await f.setup();
  take(await f.service.stop());
  const name = (await readdir(path))[0]!,
    file = path + "/" + name,
    original = await readFile(file, "utf8"),
    c = JSON.parse(original) as Checkpoint;
  c.fingerprint = fingerprint("corrupt");
  await writeFile(file, JSON.stringify(c));
  const reader = new MOSECoreRuntime("mose-lab", { ...f.ports, repository: repo });
  expect((await reader.initialize()).ok).toBe(false);
  expect(reader.diagnostics()).toMatchObject({ readiness: "NOT_READY", health: "DEGRADED" });
  expect((await reader.stop()).ok).toBe(false);
  expect((await reader.stop()).ok).toBe(false);
  expect(reader.getUniverse("session-A").ok).toBe(false);
});
