import { describe, it, expect } from "vitest";
import { hash } from "@ate/multitimeframe";
import {
  DeterministicReplaySequencer,
  createReplaySpecification,
  validateReplayLimits,
  defaultReplayLimits,
  createReplayBranchEvidence,
} from "@ate/market-replay";
import { replayFixture, t, observation } from "./fixtures.js";
import type { DataQualityFindingId } from "@ate/data-quality";
describe("temporal evidence and bounded policy", () => {
  it("honors known correction availability even in reconstruction", () => {
    const f = replayFixture(undefined, [
      {
        input: observation(t("10:00:00"), 1),
        evidence: {
          kind: "SOURCE_PUBLICATION",
          availableAt: t("11:00:00"),
          fingerprint: hash("correction-publication"),
        },
      },
    ]);
    expect(new DeterministicReplaySequencer(f.spec, f.inputs).events[0]?.eligibilityAt).toBe(
      t("11:00:00"),
    );
  });
  it("honors source publication metadata without elevating reconstruction", () => {
    const f = replayFixture(undefined, [
      { input: { ...observation(t("10:00:00"), 1), sourcePublishedAt: t("11:00:00") } },
    ]);
    expect(new DeterministicReplaySequencer(f.spec, f.inputs).events[0]?.eligibilityAt).toBe(
      t("11:00:00"),
    );
    expect(f.spec.replayMode).toBe("EVENT_TIME_RECONSTRUCTION");
  });
  it("rejects unknown direct-quality availability rather than attaching future reports", () => {
    const quality = {
      reportId: "quality-1",
      reportFingerprint: hash("quality"),
      findings: [
        {
          findingId: "finding-1" as DataQualityFindingId,
          category: "COVERAGE_GAP" as const,
          severity: "ERROR" as const,
        },
      ],
      suppressed: 0,
    };
    expect(() =>
      replayFixture(undefined, [{ input: { ...observation(t("10:00:00"), 1), quality } }]),
    ).toThrow("QUALITY_AVAILABILITY_UNKNOWN");
  });
  it("rejects publication beyond the immutable session end", () => {
    const f = replayFixture(undefined, [
      {
        input: observation(t("10:00:00"), 1),
        evidence: {
          kind: "SOURCE_PUBLICATION",
          availableAt: t("13:00:00"),
          fingerprint: hash("publication"),
        },
      },
    ]);
    expect(() => new DeterministicReplaySequencer(f.spec, f.inputs)).toThrow("INPUT_TIME_RANGE");
  });
  it("rejects capacity policies inconsistent with their operation units", () => {
    expect(() =>
      validateReplayLimits({
        ...defaultReplayLimits,
        maxEventsPerBatch: 1000,
        maxEventsPerSession: 1,
      }),
    ).toThrow("REPLAY_LIMIT_CONSTRAINT");
    expect(() =>
      validateReplayLimits({
        ...defaultReplayLimits,
        maxCheckpoints: 100,
        maxRepositoryOperations: 10,
      }),
    ).toThrow("REPLAY_LIMIT_CONSTRAINT");
  });
  it("rejects implicit mode-policy conversion", () => {
    const { fingerprint: _fingerprint, ...spec } = replayFixture().spec;
    expect(() =>
      createReplaySpecification({ ...spec, replayMode: "VERIFIED_POINT_IN_TIME" }),
    ).toThrow("REPLAY_SPECIFICATION");
  });
  it("rejects financial flags in the immutable specification", () => {
    const { fingerprint: _fingerprint, ...spec } = replayFixture().spec;
    expect(() => createReplaySpecification({ ...spec, submitOrders: true })).toThrow();
  });
  it("does not accept a fabricated branch parent checkpoint", () => {
    const f = replayFixture();
    expect(() =>
      createReplayBranchEvidence(
        {} as Parameters<typeof createReplayBranchEvidence>[0],
        f.spec,
        f.spec,
      ),
    ).toThrow();
  });
});
