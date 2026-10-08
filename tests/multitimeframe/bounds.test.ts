import { describe, it, expect } from "vitest";
import { defaultOptions, validateOptions } from "@ate/multitimeframe";
import { fixture, observation, unwrap, t, evidence, stream } from "./fixtures.js";
describe("Prompt 18 bounded input, diagnostics and consumer isolation", () => {
  it.each([null, 1, "text", []])("rejects malformed input safely", (input) => {
    const f = fixture(["M1"]);
    expect(() => f.engine.ingest(f.streamId, input as never)).not.toThrow();
    expect(f.engine.diagnostics().windowCount).toBe(0);
  });
  it("rejects hostile accessors and proxies without invoking them", () => {
    const f = fixture(["M1"]);
    const x = {
      get observation() {
        throw Error("hostile");
      },
    };
    expect(() => f.engine.ingest(f.streamId, x as never)).not.toThrow();
    expect(() =>
      f.engine.ingest(
        f.streamId,
        new Proxy(
          {},
          {
            get() {
              throw Error("hostile");
            },
          },
        ) as never,
      ),
    ).not.toThrow();
  });
  it("isolates a source limit without truncating accepted constituents", () => {
    const f = fixture(["M1"], { maxContributions: 1 });
    unwrap(f.engine.ingest(f.streamId, observation(t("10:00:05"), 1)));
    expect(f.engine.ingest(f.streamId, observation(t("10:00:06"), 2)).ok).toBe(false);
    expect(f.engine.diagnostics().watermarks[f.streamId]!.status).toBe("FENCED");
    const other = unwrap(
      f.engine.registerStream({ ...stream, instrumentId: "40000000-0000-4000-8000-000000000003" }),
    );
    const input = observation(t("10:00:05"), 3);
    expect(
      f.engine.ingest(other, {
        ...input,
        observation: {
          ...input.observation,
          instrumentId: "40000000-0000-4000-8000-000000000003",
          bid: { value: "1" },
          ask: { value: "1" },
        },
      } as typeof input).ok,
    ).toBe(true);
  });
  it("bounds stream identities and rejects oversized query and correction history", () => {
    const f = fixture(["M1"], { maxStreams: 1 });
    expect(f.engine.registerStream({ ...stream, basis: "ASK" }).ok).toBe(false);
    expect(f.engine.history("unknown", 0, 101).ok).toBe(false);
    expect(
      f.engine.snapshot({
        streamId: f.streamId,
        timeframes: Array(17).fill("M1") as string[],
        asOf: f.clock.now(),
        cutoff: f.clock.now(),
      }).ok,
    ).toBe(false);
  });
  it("slow consumers expose overflow while durable revisions remain queryable", () => {
    const f = fixture(["M1"], { consumerCapacity: 1, maxEvidence: 2 });
    for (let i = 0; i < 3; i++) {
      const at = t(`10:0${i}:05`);
      unwrap(f.engine.ingest(f.streamId, observation(at, i + 1)));
      evidence(f, f.clock.now());
      const id = unwrap(f.engine.publishWindow(f.streamId, "M1", at, true));
      expect(f.engine.readRevision(id)).toBeDefined();
    }
    expect(f.engine.diagnostics()).toMatchObject({ deliveryDepth: 1, revisionCount: 3 });
    expect(f.engine.diagnostics().errors).toContain("CONSUMER_OVERFLOW");
    expect(f.engine.diagnostics().errors.length).toBeLessThanOrEqual(2);
  });
  it("enforces cross-field governed limits and late-data bounds", () => {
    expect(() =>
      validateOptions({ ...defaultOptions, correctionHorizonMs: 1000, allowedLatenessMs: 5000 }),
    ).toThrow();
    expect(() =>
      validateOptions({ ...defaultOptions, maxSnapshotTimeframes: 32, maxTimeframes: 16 }),
    ).toThrow();
  });
});
