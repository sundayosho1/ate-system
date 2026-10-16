import { it, expect } from "vitest";
import { multiOwners } from "./multi-owners.js";
import { fixture, take } from "./fixtures.js";
it("two genuine accepted instruments retain different public-owner datasets and isolated eligibility", async () => {
  const m = await multiOwners();
  expect(m.b.context.instrumentId).not.toBe(m.a.context.instrumentId);
  expect(m.b.context.datasets[0]!.versionId).not.toBe(m.a.context.datasets[0]!.versionId);
  const f = await fixture(m.a);
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
  const replay = m.b.context.replay!;
  const a = f.create();
  const cp = take(
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
  expect(cp.state.sessions[0]!.universe.members.every((m) => m.included)).toBe(true);
});
