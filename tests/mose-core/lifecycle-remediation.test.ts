import { beforeAll, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { fingerprint } from "@ate/configuration";
import { FilesystemMOSERepository } from "@ate/mose-core";
import { owners, fixture, take, root, type Owners } from "./fixtures.js";
import { recover, altered, started, stored, historicalArtifacts } from "./remediation-helpers.js";
import { multiOwners } from "./multi-owners.js";
let base: Owners;
beforeAll(async () => {
  base = await owners();
});
for (const id of ["D27", "D28", "D29"])
  it(`original ${id} physical bytes reject impossible recovery without rewriting`, async () => {
    const artifact = historicalArtifacts[id]!;
    for (const [name, raw] of Object.entries(artifact.files))
      expect(createHash("sha256").update(raw).digest("hex")).toBe(artifact.sha256[name]);
    const f = await stored(base, id);
    expect(f.result.ok).toBe(false);
    expect(f.reader.diagnostics()).toMatchObject({
      lifecycle: "RECOVERY_REQUIRED",
      health: "DEGRADED",
    });
    expect((await f.reader.stop()).ok).toBe(false);
  });
it("live and recovery reject a missing predecessor with a valid fingerprint", async () => {
  const f = await fixture(base);
  expect(
    (
      await f.service.dispatch(
        f.create("session-A", { previousUniverse: "sha256:" + "f".repeat(64) }),
      )
    ).ok,
  ).toBe(false);
  await f.setup();
  const x = await altered(f, (c) => {
    if (c.command.kind !== "CREATE") throw Error("FIXTURE");
    c.command.previousUniverse = "sha256:" + "f".repeat(64);
    const u = c.state.sessions[0]!.universe;
    u.previousUniverse = c.command.previousUniverse;
    const { fingerprint: ignored, ...body } = u;
    void ignored;
    u.fingerprint = fingerprint(body);
  });
  expect(x.result.ok).toBe(false);
});
it("running predecessor cannot authorize a new lineage", async () => {
  const f = await started(base),
    u = take(f.service.getUniverse("session-A"));
  expect((await f.service.dispatch(f.create("next", { previousUniverse: u.fingerprint }))).ok).toBe(
    false,
  );
  expect(f.service.diagnostics().history).toBe(2);
});
it("paused predecessor with a pending receipt cannot be replaced", async () => {
  const f = await started(base),
    u = take(f.service.getUniverse("session-A"));
  take(await f.receive(0));
  take(await f.send({ kind: "PAUSE", sessionId: "session-A" }));
  expect((await f.service.dispatch(f.create("next", { previousUniverse: u.fingerprint }))).ok).toBe(
    false,
  );
  expect(take(f.service.getSessionSummary("session-A")).pending).toBe(1);
});
it("new lineage referencing another universe identity is refused", async () => {
  const f = await started(base);
  take(await f.send({ kind: "PAUSE", sessionId: "session-A" }));
  expect(
    (await f.service.dispatch(f.create("next", { previousUniverse: "sha256:" + "0".repeat(64) })))
      .ok,
  ).toBe(false);
});
it("valid paused history recovers with no external authority replay", async () => {
  const f = await started(base);
  take(await f.send({ kind: "PAUSE", sessionId: "session-A" }));
  const r = await recover(f);
  take(r.result);
  expect(take(r.reader.getSessionSummary("session-A")).sessionStatus).toBe("PAUSED");
});
it("paused local shutdown drain remains recoverable without inventing durable intent", async () => {
  const f = await started(base);
  take(await f.receive(0));
  take(await f.send({ kind: "PAUSE", sessionId: "session-A" }));
  expect((await f.service.stop()).ok).toBe(false);
  take(await f.process(1));
  take(await f.service.stop());
  const r = await recover(f);
  take(r.result);
  expect(take(r.reader.getSessionSummary("session-A")).admitted).toBe(1);
});
it("valid durable STOP recovers and prohibits every new mutation", async () => {
  const f = await started(base);
  take(await f.service.dispatch({ kind: "STOP", id: f.next() }));
  const r = await recover(f);
  take(r.result);
  expect((await r.reader.dispatch(f.create("next"))).ok).toBe(false);
  expect(
    (await r.reader.dispatch({ kind: "PROCESS", id: "later", sessionId: "session-A", limit: 1 }))
      .ok,
  ).toBe(false);
  expect(r.reader.diagnostics().history).toBe(3);
});
it("valid completed-session recovery preserves complete accounting", async () => {
  const f = await started(base);
  for (let i = 0; i < 3; i++) take(await f.receive(i));
  take(await f.process());
  take(await f.send({ kind: "COMPLETE", sessionId: "session-A" }));
  const r = await recover(f);
  take(r.result);
  expect(take(r.reader.getSessionSummary("session-A"))).toMatchObject({
    sessionStatus: "COMPLETED",
    admitted: 3,
    coverageComplete: true,
  });
});
it("valid paused predecessor lineage physically recovers", async () => {
  const f = await fixture(base, {}, new FilesystemMOSERepository(root()));
  const u = await f.setup();
  take(await f.start());
  take(await f.send({ kind: "PAUSE", sessionId: "session-A" }));
  take(await f.service.dispatch(f.create("next", { previousUniverse: u.fingerprint })));
  const r = await recover(f);
  take(r.result);
  expect(take(r.reader.getUniverse("next")).previousUniverse).toBe(u.fingerprint);
});
it("valid completed predecessor accepts immutable successor", async () => {
  const f = await started(base),
    u = take(f.service.getUniverse("session-A"));
  for (let i = 0; i < 3; i++) take(await f.receive(i));
  take(await f.process());
  take(await f.send({ kind: "COMPLETE", sessionId: "session-A" }));
  take(await f.service.dispatch(f.create("next", { previousUniverse: u.fingerprint })));
  take((await recover(f)).result);
});
it("fresh recovery repeatedly preserves original full fingerprints", async () => {
  const f = await started(base);
  take(await f.receive(0));
  take(await f.process());
  const rows = take(await f.repository.load());
  for (let i = 0; i < 3; i++) {
    const r = await recover(f);
    take(r.result);
    expect(take(await f.repository.load())).toEqual(rows);
    take(await r.reader.stop());
  }
});
it("current eligibility withdrawal does not erase valid historical observations", async () => {
  const b = await owners(),
    f = await started(b);
  take(await f.receive(0));
  take(await f.process());
  const old = take(await f.repository.load());
  await b.promote("RESEARCH", { disposition: "REVOKED" });
  const r = await recover(f);
  take(r.result);
  expect(r.reader.diagnostics().health).toBe("DEGRADED");
  expect(take(await f.repository.load())).toEqual(old);
  expect(take(r.reader.getSessionSummary("session-A")).admitted).toBe(1);
});
it("recovery rejects a rehashed PAUSE from READY before accepting later receipts", async () => {
  const f = await started(base);
  take(await f.receive(0));
  const r = await altered(f, (c) => {
    if (c.command.kind === "START") {
      c.command.kind = "PAUSE";
      c.state.sessions[0]!.status = "PAUSED";
    }
  });
  expect(r.result.ok).toBe(false);
});
it("rehashed PROCESS cannot mutate receipts after immutable STOP", async () => {
  const f = await started(base);
  take(await f.receive(0));
  take(await f.process());
  const r = await altered(f, (c) => {
    if (c.generation > 1) {
      if (c.command.kind === "START") c.command = { kind: "STOP", id: c.command.id };
      c.state.sessions[0]!.status = "STOPPED";
    }
  });
  expect(r.result.ok).toBe(false);
});
it("completed-session cursor corruption cannot reopen receipt history", async () => {
  const f = await started(base);
  for (let i = 0; i < 3; i++) take(await f.receive(i));
  take(await f.process());
  take(await f.send({ kind: "COMPLETE", sessionId: "session-A" }));
  const r = await altered(f, (c) => {
    if (c.command.kind === "COMPLETE") c.state.sessions[0]!.cursor = 0;
  });
  expect(r.result.ok).toBe(false);
});
it("a genuine second-source universe remains recoverable", async () => {
  const m = await multiOwners();
  const f = await fixture(m.b as Owners);
  await f.setup();
  take(await f.start());
  take(await f.receive(0));
  take(await f.process());
  const r = await recover(f);
  take(r.result);
  expect(take(r.reader.getUniverse("session-A")).members[0]!.instrumentId).toBe(
    m.b.context.instrumentId,
  );
});
it("two genuine canonical sources and distinct origins physically recover together", async () => {
  const m = await multiOwners(),
    f = await fixture(m.a, {}, new FilesystemMOSERepository(root())),
    r = m.b.context.replay!;
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
      const result = await m.b.ports.historical.getManifest(id);
      return result.ok ? result : m.a.ports.historical.getManifest(id);
    },
  };
  f.ports.eligibility = {
    getEligibility: (id) =>
      id === m.b.context.instrumentId
        ? m.b.service.getEligibility(id)
        : m.a.service.getEligibility(id),
  };
  f.ports.replayEvidence = (s, c) =>
    m.b.ports.replayEvidence(s, c) ?? m.a.ports.replayEvidence(s, c);
  const a = f.create();
  take(
    await f.service.dispatch({
      ...a,
      instruments: [
        ...a.instruments,
        {
          instrumentId: m.b.context.instrumentId,
          source: { sessionId: r.leftSession, checkpoint: r.leftCheckpoint },
        },
      ],
    }),
  );
  take(await f.start());
  for (let i = 0; i < 6; i++) take(await f.receive(i));
  take(await f.process());
  const n = await recover(f);
  take(n.result);
  expect(take(n.reader.getSessionSummary("session-A")).admitted).toBe(6);
  expect(n.reader.diagnostics().sourceReadiness).toHaveLength(2);
});
it("a valid partitioned replay origin retains all source obligations on fresh recovery", async () => {
  const { originOwners, research } = await import("../instrument-eligibility/origin-fixtures.js"),
    { createReplayInputManifest } = await import("@ate/market-replay"),
    o = await originOwners(),
    original = o.inputs[0]!.manifests[0]!;
  const { fingerprint: ignored, contentFingerprint: ignoredContent, ...body } = original;
  void ignored;
  void ignoredContent;
  const parts = [body.records.slice(0, 1), body.records.slice(1)].map((records, i) =>
    createReplayInputManifest(
      { ...body, manifestId: "B-part-" + i, records },
      o.pairs[0]![0]!.specification.resourceLimits,
    ),
  );
  const pair = await o.pair(parts, ["B-part-left", "B-part-right"]),
    r = await research(o, 1);
  r.setParticipants(pair);
  r.context.replay = {
    leftSession: pair[0]!.specification.sessionId,
    leftCheckpoint: pair[0]!.checkpoint.fingerprint,
    rightSession: pair[1]!.specification.sessionId,
    rightCheckpoint: pair[1]!.checkpoint.fingerprint,
  };
  await r.toResearch();
  const f = await fixture(base, {}, new FilesystemMOSERepository(root()));
  f.ports.datasets = r.ports.datasets;
  f.ports.quality = r.ports.quality;
  f.ports.historical = r.ports.historical;
  f.ports.eligibility = r.service;
  f.ports.replayEvidence = (s, c) => r.ports.replayEvidence(s, c);
  take(
    await f.service.dispatch(
      f.create("session-A", {
        instruments: [
          {
            instrumentId: r.context.instrumentId,
            source: {
              sessionId: r.context.replay.leftSession,
              checkpoint: r.context.replay.leftCheckpoint,
            },
          },
        ],
      }),
    ),
  );
  take(await f.start());
  for (let i = 0; i < original.records.length; i++) take(await f.receive(i));
  take(await f.process());
  const n = await recover(f);
  take(n.result);
  expect(new Set(take(n.reader.getUniverse("session-A")).plan.map((p) => p.manifestId)).size).toBe(
    2,
  );
  expect(take(n.reader.getSessionSummary("session-A")).admitted).toBe(original.records.length);
});
it("RECEIVE immediately after CREATE without START is impossible in recovery", async () => {
  const { loadCheckpoints, copy, rehash } = await import("./remediation-helpers.js"),
    f = await started(base);
  take(await f.receive(0));
  const rows = await loadCheckpoints(f.repository),
    first = rows[0]!,
    next = copy(rows[2]!);
  next.generation = 2;
  next.previous = first.fingerprint;
  next.state.sessions[0]!.status = "READY";
  rehash(next);
  const repo = {
    load: () => Promise.resolve({ ok: true as const, value: [first, next] }),
    commit: () => Promise.reject(Error("NO_WRITE")),
  };
  const n = await recover(f, repo);
  expect(n.result).toMatchObject({ ok: false, error: { code: "UNIVERSE_NOT_AUTHORIZED" } });
});
it("PROCESS from READY cannot be recovered as a fabricated no-op", async () => {
  const { loadCheckpoints, copy, rehash } = await import("./remediation-helpers.js"),
    f = await fixture(base);
  await f.setup();
  const first = (await loadCheckpoints(f.repository))[0]!,
    next = copy(first);
  next.generation = 2;
  next.previous = first.fingerprint;
  next.command = { kind: "PROCESS", id: "fake-process", sessionId: "session-A", limit: 1 };
  rehash(next);
  const repo = {
    load: () => Promise.resolve({ ok: true as const, value: [first, next] }),
    commit: () => Promise.reject(Error("NO_WRITE")),
  };
  const n = await recover(f, repo);
  expect(n.result).toMatchObject({ ok: false, error: { code: "RESOURCE_BUDGET_EXCEEDED" } });
});
