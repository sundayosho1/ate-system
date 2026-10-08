import { describe, it, expect } from "vitest";
import {
  ReplayAggregationPipeline,
  createReplayCheckpoint,
  compareReplayCheckpoints,
} from "@ate/market-replay";
import { replayFixture } from "./fixtures.js";
import { hash } from "@ate/multitimeframe";
function fixture() {
  const f = replayFixture();
  const p = new ReplayAggregationPipeline(f.spec);
  const aggregate = p.engine.exportReplayCheckpoint();
  if (!aggregate.ok) throw Error(aggregate.error.code);
  const cp = createReplayCheckpoint({
    schemaVersion: 1,
    specificationFingerprint: f.spec.fingerprint,
    sessionId: f.spec.sessionId,
    inputFingerprint: f.inputs.fingerprint,
    generation: 1,
    cursor: 0,
    lastEventId: null,
    logicalTime: f.spec.startTime,
    state: "READY",
    timestampComplete: true,
    pendingTasks: [],
    executedTaskIds: [],
    aggregation: aggregate.value,
    snapshots: [],
    children: [],
    evidence: [],
  });
  return { ...f, p, cp };
}
describe("validated complete semantic comparison", () => {
  it("separates lifecycle/generation metadata from semantic outputs", () => {
    const f = fixture();
    expect(
      compareReplayCheckpoints(
        { specification: f.spec, checkpoint: f.cp },
        {
          specification: f.spec,
          checkpoint: createReplayCheckpoint({ ...f.cp, generation: 2, state: "PAUSED" }),
        },
      ).classification,
    ).toBe("IDENTICAL");
  });
  it("classifies unexplained source continuity divergence", () => {
    const f = fixture();
    expect(f.p.engine.fence(hash(f.spec.streams[0]), "UNKNOWN_GAP").ok).toBe(true);
    const aggregate = f.p.engine.exportReplayCheckpoint();
    if (!aggregate.ok) throw Error(aggregate.error.code);
    const cp = createReplayCheckpoint({ ...f.cp, aggregation: aggregate.value });
    expect(
      compareReplayCheckpoints(
        { specification: f.spec, checkpoint: f.cp },
        { specification: f.spec, checkpoint: cp },
      ).classification,
    ).toBe("UNEXPLAINED_DIVERGENCE");
  });
  it("rejects different source content identity", () => {
    const f = fixture();
    const cp = createReplayCheckpoint({ ...f.cp, inputFingerprint: hash("other-input") });
    expect(
      compareReplayCheckpoints(
        { specification: f.spec, checkpoint: f.cp },
        { specification: f.spec, checkpoint: cp },
      ).classification,
    ).toBe("INCOMPARABLE");
  });
  it("rejects missing/corrupt checkpoint evidence", () => {
    const f = fixture();
    expect(
      compareReplayCheckpoints(
        { specification: f.spec, checkpoint: f.cp },
        { specification: f.spec, checkpoint: { ...f.cp, fingerprint: hash("corrupt") } },
      ).classification,
    ).toBe("INCOMPARABLE");
  });
});
