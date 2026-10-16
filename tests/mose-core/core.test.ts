import { VirtualClock } from "@ate/time";
import { beforeAll, it, expect } from "vitest";
import {
  MOSECoreRuntime,
  MemoryMOSERepository,
  defaultPolicy,
  policySchema,
  moseConfigurationDefinitions,
  moseConfigurationSchemas,
  funnelStages,
  terminalDispositions,
  reasons,
  checkpointSchema,
  observationSchema,
  type Policy,
  type Repository,
} from "@ate/mose-core";
import { fingerprint } from "@ate/configuration";
import {
  owners,
  fixture,
  take,
  maker,
  checker,
  time,
  configuration,
  type Owners,
} from "./fixtures.js";
let base: Owners;
beforeAll(async () => {
  base = await owners();
});
it("starts CREATED without admitting an uninitialized command", async () => {
  const f = await fixture(base, {}, undefined, false);
  expect(f.service.diagnostics().lifecycle).toBe("CREATED");
  expect((await f.start()).ok).toBe(false);
  expect(f.service.diagnostics().history).toBe(0);
});
it("empty initialization is READY and repeated initialization is rejected", async () => {
  const f = await fixture(base);
  expect(f.service.diagnostics().readiness).toBe("READY");
  expect((await f.service.initialize()).ok).toBe(false);
});
it("a never initialized instance can stop without fabricating a checkpoint", async () => {
  const f = await fixture(base, {}, undefined, false);
  take(await f.service.stop());
  take(await f.service.stop());
  expect(f.service.diagnostics().history).toBe(0);
  expect((await f.service.initialize()).ok).toBe(false);
});
it("current eligibility and all full source identities bind the immutable universe", async () => {
  const f = await fixture(base),
    u = await f.setup();
  expect(u.members[0]!.context).toEqual(base.context);
  expect(u.members[0]!.eligibilityVersion).toBe(
    take(await base.service.getEligibility(base.context.instrumentId)).recorded.version,
  );
  expect(u.plan).toHaveLength(3);
  expect(u.members[0]!.included).toBe(true);
});
it("query results cannot externally mutate universe membership", async () => {
  const f = await fixture(base);
  await f.setup();
  const u = take(f.service.getUniverse("session-A"));
  expect(() => u.members.pop()).toThrow();
  expect(take(f.service.getUniverse("session-A")).members).toHaveLength(1);
});
it("same command identity returns exact acknowledged generation", async () => {
  const f = await fixture(base),
    a = f.create();
  const first = take(await f.service.dispatch(a));
  const second = take(await f.service.dispatch(a));
  expect(second.fingerprint).toBe(first.fingerprint);
  expect(f.service.diagnostics().history).toBe(1);
});
it("changed content under an acknowledged command identity is denied", async () => {
  const f = await fixture(base),
    a = f.create();
  take(await f.service.dispatch(a));
  expect(await f.service.dispatch({ ...a, sessionId: "different" })).toMatchObject({
    ok: false,
    error: { code: "IDEMPOTENCY_CONFLICT", commitment: "NONE" },
  });
});
it("universe requires distinct maker and checker", async () => {
  const f = await fixture(base);
  expect((await f.service.dispatch({ ...f.create(), checker: maker })).ok).toBe(false);
  expect(f.service.diagnostics().history).toBe(0);
});
it("existing authority resolver denies an ungranted checker", async () => {
  const f = await fixture(base);
  expect(
    (await f.service.dispatch({ ...f.create(), checker: { ...checker, actorId: maker.actorId } }))
      .ok,
  ).toBe(false);
});
it("duplicate canonical members cannot inflate universe denominators", async () => {
  const f = await fixture(base),
    a = f.create();
  expect(
    (await f.service.dispatch({ ...a, instruments: [...a.instruments, ...a.instruments] })).ok,
  ).toBe(false);
});
it("canonical/source session substitution is excluded with provenance reasons", async () => {
  const f = await fixture(base),
    a = f.create();
  const c = take(
    await f.service.dispatch({
      ...a,
      instruments: a.instruments.map((i) => ({
        ...i,
        source: { ...i.source, sessionId: "other" },
      })),
    }),
  );
  expect(c.state.sessions[0]!.universe.members[0]!.reasons).toContain("PROVENANCE_INCOMPLETE");
  expect(take(f.service.getSessionSummary("session-A")).completionCoverage.status).toBe(
    "UNAVAILABLE",
  );
});
it("unavailable actual replay source never reports complete coverage", async () => {
  const f = await fixture(base);
  f.ports.replayEvidence = () => undefined;
  await f.setup();
  const s = take(f.service.getSessionSummary("session-A"));
  expect(s.coverageComplete).toBe(false);
  expect(s.completionCoverage.value).toBeNull();
  expect(s.completionCoverage.status).toBe("UNAVAILABLE");
});
it("EVENT_TIME_RECONSTRUCTION requires explicit governed opt-in", async () => {
  const f = await fixture(base, { allowReconstruction: false }),
    u = await f.setup();
  expect(u.members[0]!.included).toBe(false);
  expect(u.members[0]!.reasons).toContain("TEMPORAL_INCONSISTENCY");
});
it("repeated session creation cannot overwrite original universe", async () => {
  const f = await fixture(base),
    u = await f.setup();
  expect((await f.service.dispatch(f.create())).ok).toBe(false);
  expect(take(f.service.getUniverse("session-A")).fingerprint).toBe(u.fingerprint);
});
it("RECEIVE requires an explicitly started research session", async () => {
  const f = await fixture(base);
  await f.setup();
  expect((await f.receive(0)).ok).toBe(false);
  expect(take(f.service.getSessionSummary("session-A")).received).toBe(0);
});
it("pause and resume retain all queued observations", async () => {
  const f = await fixture(base);
  await f.setup();
  take(await f.start());
  take(await f.send({ kind: "PAUSE", sessionId: "session-A" }));
  take(await f.receive(0));
  expect(take(f.service.getSessionSummary("session-A")).deferred).toBe(1);
  take(await f.start());
  take(await f.process());
  expect(take(f.service.getSessionSummary("session-A")).admitted).toBe(1);
});
it("processing while paused cannot silently advance work", async () => {
  const f = await fixture(base);
  await f.setup();
  take(await f.start());
  take(await f.receive(0));
  take(await f.send({ kind: "PAUSE", sessionId: "session-A" }));
  expect((await f.process()).ok).toBe(false);
  expect(take(f.service.getSessionSummary("session-A")).pending).toBe(1);
});
it("out-of-order receipt leaves the immutable next obligation unconsumed", async () => {
  const f = await fixture(base);
  await f.setup();
  take(await f.start());
  expect(await f.receive(1)).toMatchObject({
    ok: false,
    error: { code: "OUT_OF_ORDER_OBSERVATION" },
  });
  expect(take(f.service.getSessionSummary("session-A")).received).toBe(0);
  take(await f.receive(0));
});
it("a duplicate logical event with a new operation ID cannot inflate counters", async () => {
  const f = await fixture(base);
  await f.setup();
  take(await f.start());
  take(await f.receive(0));
  expect(await f.receive(0)).toMatchObject({ ok: false, error: { code: "DUPLICATE_OBSERVATION" } });
  expect(take(f.service.getSessionSummary("session-A")).received).toBe(1);
});
it("wrong universe fingerprint cannot authorize a receipt", async () => {
  const f = await fixture(base),
    u = await f.setup();
  take(await f.start());
  const e = u.plan[0]!;
  expect(
    (
      await f.service.dispatch({
        kind: "RECEIVE",
        id: f.next(),
        sessionId: u.sessionId,
        eventId: e.eventId,
        instrumentId: e.instrumentId,
        universeSnapshot: fingerprint("wrong"),
      })
    ).ok,
  ).toBe(false);
});
it("batch processing consumes only its declared number of pending receipts", async () => {
  const f = await fixture(base, { maxBatch: 1 });
  await f.setup();
  take(await f.start());
  for (let i = 0; i < 3; i++) take(await f.receive(i));
  take(await f.process(1));
  const s = take(f.service.getSessionSummary("session-A"));
  expect(s.admitted).toBe(1);
  expect(s.pending).toBe(2);
});
it("one-beyond processing batch fails without partial observation mutation", async () => {
  const f = await fixture(base, { maxBatch: 1 });
  await f.setup();
  take(await f.start());
  take(await f.receive(0));
  const h = f.service.diagnostics().history;
  expect((await f.process(2)).ok).toBe(false);
  expect(f.service.diagnostics().history).toBe(h);
  expect(take(f.service.getSessionSummary("session-A")).pending).toBe(1);
});
it("one-beyond audit batch cannot hide extra publication work", async () => {
  const f = await fixture(base, { maxAuditBatch: 1 });
  await f.setup();
  take(await f.start());
  take(await f.receive(0));
  expect((await f.process(2)).ok).toBe(false);
});
it("queue exact capacity succeeds and one beyond leaves prior debt intact", async () => {
  const f = await fixture(base, { maxQueued: 1 });
  await f.setup();
  take(await f.start());
  take(await f.receive(0));
  expect((await f.receive(1)).ok).toBe(false);
  expect(take(f.service.getSessionSummary("session-A")).pending).toBe(1);
  take(await f.process(1));
  take(await f.receive(1));
});
it("history capacity does not fabricate an acknowledged durable STOP checkpoint", async () => {
  const f = await fixture(base, { maxHistory: 1 });
  await f.setup();
  expect((await f.start()).ok).toBe(false);
  expect((await f.service.dispatch({ kind: "STOP", id: "capacity-stop" })).ok).toBe(false);
  take(await f.service.stop());
});
it("session capacity preserves existing immutable session", async () => {
  const f = await fixture(base, { maxSessions: 1 });
  await f.setup();
  expect((await f.service.dispatch(f.create("B"))).ok).toBe(false);
  expect(take(f.service.getUniverse("session-A")).sessionId).toBe("session-A");
});
it("instrument capacity applies before durable universe publication", async () => {
  const f = await fixture(base, { maxInstruments: 1 }),
    a = f.create();
  expect(
    (
      await f.service.dispatch({
        ...a,
        instruments: [...a.instruments, { ...a.instruments[0]!, instrumentId: "other" }],
      })
    ).ok,
  ).toBe(false);
  expect(f.service.diagnostics().history).toBe(0);
});
it("immutable plan size is bounded before active surveillance", async () => {
  const f = await fixture(base, { maxRetained: 2 });
  expect((await f.service.dispatch(f.create())).ok).toBe(false);
  expect(f.service.diagnostics().history).toBe(0);
});
it("completion refuses unreceived scheduled observations", async () => {
  const f = await fixture(base);
  await f.setup();
  take(await f.start());
  expect((await f.send({ kind: "COMPLETE", sessionId: "session-A" })).ok).toBe(false);
});
it("completion refuses unresolved pending observations", async () => {
  const f = await fixture(base);
  await f.setup();
  take(await f.start());
  for (let i = 0; i < 3; i++) take(await f.receive(i));
  expect((await f.send({ kind: "COMPLETE", sessionId: "session-A" })).ok).toBe(false);
});
it("zero evaluated denominator is explicitly NOT_APPLICABLE", async () => {
  const f = await fixture(base);
  await f.setup();
  expect(
    take(f.service.getSessionSummary("session-A")).evidenceQualificationCoverage,
  ).toMatchObject({ status: "NOT_APPLICABLE", value: null, denominator: 0 });
});
it("every terminal receipt reconciles the explicit completion denominator", async () => {
  const f = await fixture(base);
  await f.setup();
  take(await f.start());
  for (let i = 0; i < 3; i++) take(await f.receive(i));
  take(await f.process());
  const s = take(f.service.getSessionSummary("session-A"));
  expect(s.received).toBe(s.admitted + s.rejected + s.quarantined + s.pending);
  expect(s.completionCoverage).toMatchObject({ numerator: 3, denominator: 3, value: 1 });
});
it("OBSERVED is the only operational funnel stage", async () => {
  const f = await fixture(base);
  await f.setup();
  take(await f.start());
  take(await f.receive(0));
  const c = take(await f.process());
  const o = observationSchema.parse(c.state.sessions[0]!.observations[0]);
  expect(o.funnelEvent?.newStage).toBe("OBSERVED");
  expect(o.funnelEvent?.stageOwner).toBe("MOSE_CORE");
  expect(o.funnelEvent?.policyVersion).toBe(1);
  expect(o.funnelEvent?.evidenceVersions).toEqual([
    o.plan.datasetVersionFingerprint,
    o.plan.qualityFingerprint,
  ]);
  expect(o.funnelEvent?.outcome).toBe("RESEARCH_ONLY");
});
for (const stage of funnelStages.slice(1))
  it(`reserved funnel ${stage} has vocabulary but cannot be emitted`, async () => {
    const f = await fixture(base);
    expect((await f.service.dispatch({ kind: "FUNNEL", id: f.next(), newStage: stage })).ok).toBe(
      false,
    );
    expect(f.service.diagnostics().history).toBe(0);
  });
it("terminal vocabulary does not implement strategy decisions", () => {
  expect(terminalDispositions).toContain("NO_ACTION");
  expect(Object.values(reasons).every((s) => s.length > 0)).toBe(true);
});
for (const kind of [
  "SUMMARY",
  "UNIVERSE",
  "OBSERVATIONS",
  "PENDING",
  "REASONS",
  "HISTORY",
  "SOURCE_QUALITY",
  "INCLUSION",
] as const)
  it(`bounded read-only ${kind} query leaves source state unchanged`, async () => {
    const f = await fixture(base);
    await f.setup();
    const h = f.service.diagnostics().history;
    take(f.service.query({ kind, sessionId: "session-A", offset: 0, limit: 10, asOf: null }));
    expect(f.service.diagnostics().history).toBe(h);
  });
it("queries cannot request future knowledge", async () => {
  const f = await fixture(base);
  await f.setup();
  expect(
    f.service.query({
      kind: "SUMMARY",
      sessionId: "session-A",
      offset: 0,
      limit: 10,
      asOf: "2099-01-01T00:00:00.000Z",
    }).ok,
  ).toBe(false);
});
it("query pagination rejects unbounded limits", async () => {
  const f = await fixture(base);
  await f.setup();
  expect(
    f.service.query({
      kind: "OBSERVATIONS",
      sessionId: "session-A",
      offset: 0,
      limit: 101,
      asOf: null,
    }).ok,
  ).toBe(false);
});
it("clock regression after an asynchronous operation cannot publish", async () => {
  const f = await fixture(base);
  const original = f.ports.replayEvidence;
  f.ports.replayEvidence = (s, c) => {
    const r = original(s, c);
    f.ports.clock = {
      ...f.clock,
      mode: f.clock.mode,
      provenance: f.clock.provenance,
      now: () => "2026-10-09T09:00:00.000Z" as ReturnType<typeof f.clock.now>,
    };
    return r;
  };
  expect((await f.service.dispatch(f.create())).ok).toBe(false);
  expect(f.service.diagnostics().history).toBe(0);
});
it("configuration drift denies all new work", async () => {
  const f = await fixture(base);
  f.setConfiguration(await configuration({ ...f.policy, maxQueued: 2 }, f.clock));
  expect((await f.service.dispatch(f.create())).ok).toBe(false);
});
it("future-effective policy cannot initialize", async () => {
  const f = await fixture(
    base,
    { effectiveAt: "2099-01-01T00:00:00.000Z" as Policy["effectiveAt"] },
    undefined,
    false,
  );
  expect((await f.service.initialize()).ok).toBe(false);
  expect(f.service.diagnostics().recoveryObligation).toBeNull();
});
it("policy and help definitions expose bounded governed controls", () => {
  expect(policySchema.parse(defaultPolicy).maxOutstandingAcknowledgments).toBe(1);
  const f = new VirtualClock(time);
  expect(moseConfigurationDefinitions(f)[0]!.domain).toBe("SURVEILLANCE");
  expect(moseConfigurationSchemas(f)).toHaveLength(1);
});
it("ordinary checkpoint bodies authenticate every command and outcome", async () => {
  const f = await fixture(base);
  const c = take(await f.service.dispatch(f.create()));
  expect(checkpointSchema.parse(c).fingerprint).toBe(c.fingerprint);
});
it("all observations refuse after successful shutdown", async () => {
  const f = await fixture(base);
  await f.setup();
  take(await f.service.stop());
  expect((await f.start()).ok).toBe(false);
  expect(f.service.getUniverse("session-A").ok).toBe(false);
  expect(f.service.diagnostics().readiness).toBe("NOT_READY");
});
it("ordinary checkpoint repository is an explicit injected owner boundary", async () => {
  const actual = new MemoryMOSERepository();
  const repository: Repository = { load: () => actual.load(), commit: (s) => actual.commit(s) };
  const f = await fixture(base, {}, repository);
  await f.setup();
  expect(take(await repository.load())).toHaveLength(1);
});
it("public service identity is constrained before runtime admission", async () => {
  const f = await fixture(base);
  expect(() => new MOSECoreRuntime("", f.ports)).toThrow();
});
