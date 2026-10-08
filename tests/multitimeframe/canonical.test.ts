import { describe, it, expect } from "vitest";
import { canonicalBar } from "@ate/multitimeframe";
import { marketObservationSchema } from "@ate/domain";
import { fixture, observation, unwrap, t, evidence, set } from "./fixtures.js";
describe("Prompt 18 canonical bar handoff and input correction", () => {
  it("publishes canonical transformation provenance, exact units and bounded evidence-manifest pointers", () => {
    const f = fixture(["M1"]);
    unwrap(f.engine.ingest(f.streamId, observation(t("10:00:05"), 1)));
    evidence(f, f.clock.now());
    const revision = f.engine.readRevision(
      unwrap(f.engine.publishWindow(f.streamId, "M1", t("10:00:00"), true)),
    )!;
    const bar = canonicalBar(revision);
    expect(marketObservationSchema.safeParse(bar).success).toBe(true);
    expect(bar).toMatchObject({
      completeness: "FINAL",
      provenance: {
        origin: "DERIVED",
        transformation: { transformationId: "@ate/multitimeframe/aggregation-v1" },
      },
      metadata: {
        "aggregation.pricebasis": "BID",
        "aggregation.lineagefingerprint": revision.lineageFingerprint,
      },
      volumes: [{ volumeType: "QUOTE_COUNT", quantity: { value: "1", unit: "TICKS" } }],
    });
  });
  it("aggregates nonoverlapping canonical M1 bars into M5 and follows source revisionOf without double volume", () => {
    const source = fixture(["M1"]);
    unwrap(source.engine.ingest(source.streamId, observation(t("10:00:05"), 1)));
    evidence(source, source.clock.now());
    const id = unwrap(source.engine.publishWindow(source.streamId, "M1", t("10:00:00"), true)),
      bar = canonicalBar(source.engine.readRevision(id)!);
    const target = fixture(["M5"]);
    const input = {
      ...observation(t("10:00:05"), 1),
      observation: bar,
      identity: bar.observationId,
    };
    unwrap(target.engine.ingest(target.streamId, input));
    evidence(target, target.clock.now());
    const first = unwrap(target.engine.publishWindow(target.streamId, "M5", t("10:00:00"), true));
    expect(target.engine.readRevision(first)!.coverage).toBe("INCOMPLETE");
    set(source, t("12:00:01"));
    unwrap(source.engine.ingest(source.streamId, observation(t("10:00:06"), 2, "3")));
    const replacement = canonicalBar(
      unwrap(source.engine.history(source.engine.readRevision(id)!.barId)).at(-1)!,
    );
    set(target, t("12:00:01"));
    unwrap(
      target.engine.ingest(target.streamId, {
        ...input,
        identity: replacement.observationId,
        observation: replacement,
      }),
    );
    const revisions = unwrap(target.engine.history(target.engine.readRevision(first)!.barId));
    expect(revisions.at(-1)).toMatchObject({
      parentRevisionId: first,
      count: 1,
      volume: "2",
      high: "3",
    });
    expect(revisions[0]!.volume).toBe("1");
  });
  it("does not mix canonical source bars and points inside a target window", () => {
    const f = fixture(["M1"]);
    unwrap(f.engine.ingest(f.streamId, observation(t("10:00:05"), 1)));
    evidence(f, f.clock.now());
    const r = f.engine.readRevision(
      unwrap(f.engine.publishWindow(f.streamId, "M1", t("10:00:00"), true)),
    )!;
    const target = fixture(["M5"]);
    unwrap(target.engine.ingest(target.streamId, observation(t("10:00:05"), 1)));
    expect(
      target.engine.ingest(target.streamId, {
        ...observation(t("10:00:05"), 2),
        observation: canonicalBar(r),
      }).ok,
    ).toBe(false);
  });
});
