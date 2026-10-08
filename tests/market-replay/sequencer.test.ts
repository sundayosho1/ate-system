import { describe, it, expect } from "vitest";
import { hash } from "@ate/multitimeframe";
import {
  DeterministicReplaySequencer,
  immutableReplayInputs,
  createReplaySpecification,
  verifyReplaySpecification,
  createReplayInputManifest,
  defaultReplayLimits,
} from "@ate/market-replay";
import { replayFixture, t, observation } from "./fixtures.js";
describe("immutable deterministic replay input authority", () => {
  it("orders equal-time observations by numeric sequence independent of source arrival", () => {
    const records = [
      { input: observation(t("10:00:00"), 10) },
      { input: observation(t("10:00:00"), 2) },
    ];
    const a = replayFixture(undefined, records),
      b = replayFixture(undefined, [...records].reverse());
    expect(a.manifest).toEqual(b.manifest);
    const events = new DeterministicReplaySequencer(a.spec, a.inputs).events;
    expect(events.map((e) => e.record.input.orderingSequence)).toEqual(["2", "10"]);
  });
  it("retains missing sequence uncertainty and uses a transitive total order", () => {
    const without = (id: number) => {
      const { orderingSequence: _sequence, ...input } = observation(t("10:00:00"), id);
      return { input };
    };
    const a = replayFixture(undefined, [
      without(3),
      { input: observation(t("10:00:00"), 10) },
      without(1),
      { input: observation(t("10:00:00"), 2) },
    ]);
    const events = new DeterministicReplaySequencer(a.spec, a.inputs).events;
    expect(events.map((e) => e.record.input.identity)).toEqual(["2", "10", "1", "3"]);
    expect(events.every((e) => e.ordering === "SYNTHETIC_UNCERTAIN")).toBe(true);
  });
  it("does not infer availability from receipt metadata", () => {
    const f = replayFixture("VERIFIED_POINT_IN_TIME");
    expect(() => new DeterministicReplaySequencer(f.spec, f.inputs)).toThrow(
      "AVAILABILITY_UNVERIFIED",
    );
  });
  it("uses the latest recorded evidence in verified mode", () => {
    const f = replayFixture("VERIFIED_POINT_IN_TIME", [
      {
        input: observation(t("10:00:00"), 1, "1", t("10:05:00")),
        evidence: {
          kind: "CANONICAL_FIXTURE",
          availableAt: t("10:10:00"),
          fingerprint: hash("fixture-authority"),
        },
      },
    ]);
    expect(new DeterministicReplaySequencer(f.spec, f.inputs).events[0]?.eligibilityAt).toBe(
      t("10:10:00"),
    );
  });
  it("keeps receivedAt unchanged when reconstructing earlier event time", () => {
    const f = replayFixture(undefined, [
      { input: observation(t("10:00:00"), 1, "1", t("11:00:00")) },
    ]);
    const e = new DeterministicReplaySequencer(f.spec, f.inputs).events[0]!;
    expect(e.eligibilityAt).toBe(t("10:00:00"));
    expect(e.record.input.observation.receivedAt).toBe(t("11:00:00"));
  });
  it("rejects conflicting duplicates", () => {
    const f = replayFixture(undefined, [
      { input: observation(t("10:00:00"), 1, "1") },
      { input: observation(t("10:00:00"), 1, "2") },
    ]);
    expect(() => new DeterministicReplaySequencer(f.spec, f.inputs)).toThrow(
      "CONFLICTING_DUPLICATE",
    );
  });
  it("deduplicates exact identical source records", () => {
    const r = { input: observation(t("10:00:00"), 1) };
    const f = replayFixture(undefined, [r, r]);
    expect(new DeterministicReplaySequencer(f.spec, f.inputs).events).toHaveLength(1);
  });
  it("rejects manifest and specification tampering", () => {
    const f = replayFixture();
    expect(
      () =>
        new DeterministicReplaySequencer(
          f.spec,
          immutableReplayInputs([{ ...f.manifest, records: [] }]),
        ),
    ).toThrow();
    expect(() => verifyReplaySpecification({ ...f.spec, softwareIdentity: "tampered" })).toThrow(
      "SPECIFICATION_INTEGRITY",
    );
  });
  it("rejects hostile getters without invoking them", () => {
    let invoked = false;
    expect(() =>
      createReplaySpecification(
        Object.defineProperty({}, "sessionId", {
          enumerable: true,
          get() {
            invoked = true;
            throw Error("hostile");
          },
        }),
      ),
    ).toThrow();
    expect(invoked).toBe(false);
  });
  it("deeply freezes specs, manifests, records and envelopes", () => {
    const f = replayFixture();
    expect(Object.isFrozen(f.manifest.records[0]?.input.observation)).toBe(true);
    expect(Object.isFrozen(f.spec.aggregation)).toBe(true);
    expect(Object.isFrozen(new DeterministicReplaySequencer(f.spec, f.inputs).events)).toBe(true);
  });
  it("rejects a gap under the strict policy", () => {
    const f = replayFixture(undefined, [
      { input: { ...observation(t("10:00:00"), 1), continuity: "GAP" } },
    ]);
    const { fingerprint: _fp, ...s } = f.spec;
    expect(
      () =>
        new DeterministicReplaySequencer(
          createReplaySpecification({ ...s, continuityPolicy: "FAIL_ON_GAP" }),
          f.inputs,
        ),
    ).toThrow("SOURCE_GAP");
  });
  it("rejects an event-count limit before session admission", () => {
    const f = replayFixture();
    const { fingerprint: _fp, contentFingerprint: _content, ...body } = f.manifest;
    expect(() =>
      createReplayInputManifest(body, {
        ...defaultReplayLimits,
        maxEventsPerSession: 1,
        maxEventsPerBatch: 1,
      }),
    ).toThrow("INPUT_EVENT_LIMIT");
  });
});
