import { it, expect } from "vitest";
import { temporalOwners } from "./temporal-owners.js";
import { fixture, take, owners } from "./fixtures.js";
it("actual owner FORMING M5 revision cannot be used as a completed higher timeframe", async () => {
  const b = await temporalOwners("forming"),
    f = await fixture(b, { requiredTimeframes: ["M5"] }),
    u = await f.setup();
  const cp = b.replays.get("mose-temporal-left")!.checkpoint;
  expect(cp.snapshots).toHaveLength(1);
  const revision = cp.aggregation.revisions.find((r) => r.timeframe === "M5");
  expect(revision).toBeDefined();
  expect(revision!.final).toBe(false);
  expect(cp.snapshots[0]!.aggregation.selected.M5).toBeUndefined();
  take(await f.start());
  take(await f.receive(0));
  const c = take(await f.process());
  expect(c.state.sessions[0]!.observations[0]).toMatchObject({
    outcome: "DEFERRED",
    reason: "TEMPORAL_INCONSISTENCY",
    funnelEvent: null,
  });
  expect(cp.snapshots[0]!.logicalTime <= u.plan[0]!.boundaryAt).toBe(true);
});
it("a genuine later owner snapshot cannot leak into the earlier research boundary", async () => {
  const b = await temporalOwners("future"),
    f = await fixture(b, { requiredTimeframes: ["M5"] }),
    u = await f.setup();
  const cp = b.replays.get("mose-temporal-left")!.checkpoint;
  expect(cp.snapshots[0]!.logicalTime > u.plan[0]!.boundaryAt).toBe(true);
  expect(cp.snapshots[0]!.aggregation.selected.M5).toMatchObject({
    final: true,
    coverage: "COMPLETE_COVERAGE",
  });
  take(await f.start());
  take(await f.receive(0));
  const c = take(await f.process());
  expect(c.state.sessions[0]!.observations[0]!.outcome).toBe("DEFERRED");
  expect(c.state.sessions[0]!.observations[0]!.funnelEvent).toBeNull();
});
it("source freshness is measured against the explicit owner knowledge boundary", async () => {
  const b = await owners(),
    f = await fixture(b, { maxEvidenceAgeMs: 1000 });
  await f.setup();
  take(await f.start());
  take(await f.receive(0));
  const c = take(await f.process());
  expect(c.state.sessions[0]!.observations[0]).toMatchObject({
    outcome: "QUARANTINED",
    reason: "DATA_STALE",
  });
});
it("funnel emission time is processing knowledge, not a backdated historical event time", async () => {
  const b = await owners(),
    f = await fixture(b);
  await f.setup();
  take(await f.start());
  take(await f.receive(0));
  const c = take(await f.process()),
    o = c.state.sessions[0]!.observations[0]!;
  expect(o.funnelEvent!.at).toBe(o.processingTime);
  expect(o.funnelEvent!.at >= c.state.sessions[0]!.universe.createdAt).toBe(true);
  expect(o.plan.eventAt < o.funnelEvent!.at).toBe(true);
});
it("an actual completed owner timeframe already available at the boundary remains usable", async () => {
  const b = await temporalOwners("available"),
    f = await fixture(b, { capability: "MULTI_TIMEFRAME_RESEARCH", requiredTimeframes: ["M1"] }),
    u = await f.setup();
  const cp = b.replays.get("mose-temporal-left")!.checkpoint;
  expect(cp.snapshots[0]!.aggregation.selected.M1).toMatchObject({
    final: true,
    coverage: "COMPLETE_COVERAGE",
  });
  expect(cp.snapshots[0]!.logicalTime <= u.plan[0]!.boundaryAt).toBe(true);
  take(await f.start());
  take(await f.receive(0));
  const c = take(await f.process());
  expect(c.state.sessions[0]!.observations[0]).toMatchObject({
    outcome: "ADMITTED",
    reason: "OBSERVED",
  });
});
