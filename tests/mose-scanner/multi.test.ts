import { beforeAll, it, expect } from "vitest";
import { fixture, take } from "./fixtures.js";
import { multiOwners } from "../mose-core/multi-owners.js";
let pair: Awaited<ReturnType<typeof multiOwners>>;
beforeAll(async () => {
  pair = await multiOwners();
});
async function mixed() {
  pair.faults.qualityUnavailable = false;
  const f = await fixture(pair.a),
    a = pair.a,
    b = pair.b;
  f.mose.ports.datasets = {
    getVersion: (id) =>
      id === b.context.datasets[0]!.versionId
        ? b.ports.datasets.getVersion(id)
        : a.ports.datasets.getVersion(id),
  };
  f.mose.ports.quality = {
    getReport: (id) =>
      id === b.context.datasets[0]!.qualityReportId
        ? b.ports.quality.getReport(id)
        : a.ports.quality.getReport(id),
  };
  f.mose.ports.historical = {
    getManifest: (id) =>
      b.ports.historical
        .getManifest(id)
        .then((r) => (r.ok ? r : a.ports.historical.getManifest(id))),
  };
  f.mose.ports.eligibility = {
    getEligibility: (id) =>
      id === b.context.instrumentId ? b.service.getEligibility(id) : a.service.getEligibility(id),
  };
  f.mose.ports.replayEvidence = (session, checkpoint) =>
    b.ports.replayEvidence(session, checkpoint) ?? a.ports.replayEvidence(session, checkpoint);
  f.ports.replayEvidence = f.mose.ports.replayEvidence;
  const replay = b.context.replay!,
    command = f.mose.create("session-B", {
      instruments: [
        {
          instrumentId: b.context.instrumentId,
          source: { sessionId: replay.leftSession, checkpoint: replay.leftCheckpoint },
        },
      ],
    });
  const cp = take(await f.mose.service.dispatch(command)),
    universe = cp.state.sessions.find((s) => s.universe.sessionId === "session-B")!.universe;
  take(await f.mose.service.dispatch({ kind: "START", id: "start-B", sessionId: "session-B" }));
  await f.plan([
    f.subscription(),
    f.subscription({
      id: "second",
      sessionId: "session-B",
      universe: universe.fingerprint,
      instrumentId: b.context.instrumentId,
    }),
  ]);
  take(await f.start());
  const event = universe.plan[0]!,
    p = take(f.scanner.preview("second", f.clock.now(), event.eventId));
  const t = {
    id: "request-B",
    subscriptionId: "second",
    boundary: f.clock.now(),
    kind: "EVENT" as const,
    actor: null,
    cause: event.eventId,
    evidence: p.evidence,
  };
  return { ...f, second: t };
}
it("J14 genuine independent instruments receive bounded round-robin service", async () => {
  const f = await mixed();
  take(await f.scanner.request(f.trigger()));
  take(await f.scanner.request(f.second));
  const a = take(await f.scanner.dispatch("one", 1));
  const b = take(await f.scanner.dispatch("two", 1));
  expect(a[0]!.subscription.instrumentId).not.toBe(b[0]!.subscription.instrumentId);
  expect([a[0]!.status, b[0]!.status]).toEqual(["COMPLETED", "COMPLETED"]);
});
it("one actual quality owner outage preserves healthy peer and both obligations", async () => {
  const f = await mixed();
  take(await f.scanner.request(f.trigger()));
  take(await f.scanner.request(f.second));
  pair.faults.qualityUnavailable = true;
  const outputs = take(await f.scanner.dispatch("mixed", 2));
  expect(outputs.map((w) => w.status).sort()).toEqual(["COMPLETED", "DEFERRED"]);
  expect(f.scanner.coverage()).toMatchObject({ uniqueObligations: 2, completed: 1, pending: 1 });
  expect(f.scanner.diagnostics().health).toBe("DEGRADED");
  pair.faults.qualityUnavailable = false;
});
it("real owner restoration permits exact retained peer work retry", async () => {
  const f = await mixed();
  take(await f.scanner.request(f.second));
  pair.faults.qualityUnavailable = true;
  const failed = take(await f.scanner.dispatch("offline", 1))[0]!;
  expect(failed.status).toBe("DEFERRED");
  pair.faults.qualityUnavailable = false;
  const restored = take(await f.scanner.dispatch("restored", 1))[0]!;
  expect(restored.status).toBe("COMPLETED");
  expect(restored.key).toBe(failed.key);
  expect(restored.attempts).toBe(2);
});
it("independent source scopes cannot share same event evidence", async () => {
  const f = await mixed();
  expect((await f.scanner.request({ ...f.second, evidence: f.trigger().evidence })).ok).toBe(false);
  expect(f.scanner.coverage().uniqueObligations).toBe(0);
});
