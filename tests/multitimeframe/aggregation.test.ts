import { describe, it, expect } from "vitest";
import { marketObservationSchema } from "@ate/domain";
import {
  hash,
  AggregationEngine,
  TimeframeRegistry,
  utcCalendar,
  defaultOptions,
  type Stream,
} from "@ate/multitimeframe";
import { fixture, observation, unwrap, t, evidence, set, config, stream } from "./fixtures.js";
const final = (f: ReturnType<typeof fixture>, code = "M1", event = t("10:00:00")) => {
  evidence(f, t("12:00:00"));
  return unwrap(f.engine.publishWindow(f.streamId, code, event, true));
};
describe("Prompt 18 direct construction, numeric and finality contracts", () => {
  it("orders OHLC by event sequence rather than arrival and sums quote counts exactly", () => {
    const f = fixture(["M1"]);
    for (const [time, id, price] of [
      ["10:00:40", 4, "3"],
      ["10:00:05", 1, "1.000000000000000001"],
      ["10:00:20", 2, "5"],
      ["10:00:30", 3, "-1"],
    ] as const)
      unwrap(f.engine.ingest(f.streamId, observation(t(time), id, price)));
    const r = f.engine.readRevision(final(f))!;
    expect([r.open, r.high, r.low, r.close, r.volume, r.count]).toEqual([
      "1.000000000000000001",
      "5",
      "-1",
      "3",
      "4",
      4,
    ]);
    expect(r.ordering).toBe("VERIFIED");
    expect(r.tradingAuthorized).toBe(false);
  });
  it("discloses uncertainty for equal-time inputs without trustworthy sequence", () => {
    const f = fixture(["M1"]);
    for (const id of [2, 1]) {
      const { orderingSequence: _sequence, ...input } = observation(t("10:00:05"), id, String(id));
      unwrap(f.engine.ingest(f.streamId, input));
    }
    const r = f.engine.readRevision(final(f))!;
    expect(r.ordering).toBe("UNCERTAIN");
    expect(r.quality).toContain("ORDERING_UNCERTAIN");
  });
  it("rejects empty windows instead of fabricating prices", () => {
    const f = fixture(["M1"]);
    expect(f.engine.publishWindow(f.streamId, "M1", t("10:00:00"), true)).toMatchObject({
      ok: false,
      error: { code: "EMPTY_WINDOW" },
    });
  });
  it("duplicates are idempotent and conflicts fence the affected stream", () => {
    const f = fixture(["M1"]),
      x = observation(t("10:00:05"), 1);
    unwrap(f.engine.ingest(f.streamId, x));
    unwrap(f.engine.ingest(f.streamId, x));
    expect(f.engine.readRevision(final(f))!.count).toBe(1);
    expect(f.engine.ingest(f.streamId, observation(t("10:01:05"), 1, "2")).ok).toBe(false);
    expect(f.engine.diagnostics().watermarks[f.streamId]!.status).toBe("FENCED");
  });
  it("elapsed windows remain provisional without justified watermark evidence", () => {
    const f = fixture(["M1"]);
    unwrap(f.engine.ingest(f.streamId, observation(t("10:00:05"), 1)));
    const provisional = unwrap(f.engine.publishWindow(f.streamId, "M1", t("10:00:00")));
    expect(f.engine.readRevision(provisional)).toMatchObject({
      state: "WINDOW_ELAPSED",
      final: false,
    });
    expect(f.engine.publishWindow(f.streamId, "M1", t("10:00:00"), true).ok).toBe(false);
    expect(
      unwrap(
        f.engine.snapshot({
          streamId: f.streamId,
          timeframes: ["M1"],
          asOf: f.clock.now(),
          cutoff: f.clock.now(),
        }),
      ).selected,
    ).toEqual({});
  });
  it("finalized incomplete coverage and numerical validity remain independent of quality", () => {
    const f = fixture(["M1"]);
    unwrap(
      f.engine.ingest(f.streamId, {
        ...observation(t("10:00:05"), 1),
        warnings: ["POOR_SOURCE_QUALITY"],
      }),
    );
    evidence(f, t("12:00:00"), "INCOMPLETE");
    const r = f.engine.readRevision(
      unwrap(f.engine.publishWindow(f.streamId, "M1", t("10:00:00"), true)),
    )!;
    expect(r.final).toBe(true);
    expect(r.coverage).toBe("INCOMPLETE");
    expect(r.quality).toContain("POOR_SOURCE_QUALITY");
    expect(r).not.toHaveProperty("score");
    const q = {
      streamId: f.streamId,
      timeframes: ["M1"],
      asOf: f.clock.now(),
      cutoff: f.clock.now(),
    };
    expect(unwrap(f.engine.snapshot(q)).missing.M1).toBe("INCOMPLETE_COVERAGE");
    expect(
      unwrap(f.engine.snapshot({ ...q, includeIncomplete: true })).selected.M1?.revisionId,
    ).toBe(r.revisionId);
  });
  it.each(["NaN", "Infinity", "1e5", "1.1234567890123456789"])(
    "rejects malformed or overprecision price %s",
    (price) => {
      const f = fixture(["M1"]),
        x = observation(t("10:00:05"), 1);
      const hostile = { ...x, observation: { ...x.observation, bid: { value: price } } };
      expect(f.engine.ingest(f.streamId, hostile as typeof x).ok).toBe(false);
    },
  );
  it("midpoint reuses canonical derivation with explicit transformation basis", () => {
    const f = fixture(["M1"]);
    const id = unwrap(f.engine.registerStream({ ...stream, basis: "MIDPOINT" }));
    const x = observation(t("10:00:05"), 1);
    const canonical = marketObservationSchema.parse({
      ...x.observation,
      bid: { value: "1.1", quoteCurrency: "USD" },
      ask: { value: "1.3", quoteCurrency: "USD" },
    });
    unwrap(f.engine.ingest(id, { ...x, observation: canonical }));
    unwrap(
      f.engine.watermark(id, {
        sessionId: "session-1",
        through: t("12:00:00"),
        observedAt: f.clock.now(),
        coverage: "COMPLETE_COVERAGE",
        kind: "END_OF_STREAM",
        evidenceId: "mid",
        reconciled: true,
      }),
    );
    const r = f.engine.readRevision(unwrap(f.engine.publishWindow(id, "M1", t("10:00:00"), true)))!;
    expect(r.open).toBe("1.2");
    expect(r.stream.basis).toBe("MIDPOINT");
  });
  it("trade volume retains units and exact decimal summation", () => {
    const f = fixture(["M1"]),
      s: Stream = {
        ...stream,
        basis: "LAST_TRADE",
        volumeType: "TRADE_VOLUME",
        volumeUnit: "ASSET_UNITS",
      },
      id = unwrap(f.engine.registerStream(s));
    for (const n of [1, 2]) {
      const x = observation(t("10:00:05"), n);
      const {
        bid: _bid,
        ask: _ask,
        ...base
      } = x.observation as Extract<typeof x.observation, { observationKind: "QUOTE" }>;
      const canonical = marketObservationSchema.parse({
        ...base,
        observationKind: "TRADE",
        price: { value: String(n), instrumentId: s.instrumentId, quoteCurrency: "USD" },
        quantity: { value: "0.1", unit: "ASSET_UNITS" },
      });
      unwrap(f.engine.ingest(id, { ...x, observation: canonical }));
    }
    unwrap(
      f.engine.watermark(id, {
        sessionId: "session-1",
        through: t("12:00:00"),
        observedAt: f.clock.now(),
        coverage: "COMPLETE_COVERAGE",
        kind: "END_OF_STREAM",
        evidenceId: "trade",
        reconciled: true,
      }),
    );
    expect(
      f.engine.readRevision(unwrap(f.engine.publishWindow(id, "M1", t("10:00:00"), true)))!.volume,
    ).toBe("0.2");
  });
  it("quality report pointers, suppression and historical availability uncertainty propagate", () => {
    const f = fixture(["M1"]);
    unwrap(
      f.engine.ingest(f.streamId, {
        ...observation(t("10:00:05"), 1),
        origin: "HISTORICAL",
        availability: "VERIFIED",
        quality: {
          reportId: "quality-1",
          reportFingerprint: hash("quality"),
          findings: [
            { findingId: "finding-1" as never, category: "COVERAGE_GAP", severity: "WARNING" },
          ],
          suppressed: 3,
        },
      }),
    );
    const r = f.engine.readRevision(final(f))!;
    expect(r.availability).toBe("UNKNOWN");
    expect(r.suppressedEvidence).toBe(3);
    expect(r.quality.some((s) => s.includes("finding-1"))).toBe(true);
    const req = {
      streamId: f.streamId,
      timeframes: ["M1"],
      asOf: f.clock.now(),
      cutoff: f.clock.now(),
    };
    expect(unwrap(f.engine.snapshot(req)).missing.M1).toBe("UNVERIFIED_AVAILABILITY");
    expect(
      unwrap(f.engine.snapshot({ ...req, evidenceClass: "EVENT_TIME_RECONSTRUCTION" })).selected.M1
        ?.revisionId,
    ).toBe(r.revisionId);
  });
  it("generated permutations preserve content/lineage fingerprints under compatible ordering", () => {
    const xs = Array.from({ length: 20 }, (_, i) =>
      observation(t(`10:00:${String(i).padStart(2, "0")}`), i + 1, String(i - 5)),
    );
    const hashes: string[] = [];
    for (const list of [xs, [...xs].reverse(), [...xs.slice(10), ...xs.slice(0, 10)]]) {
      const f = fixture(["M1"]);
      for (const x of list) unwrap(f.engine.ingest(f.streamId, x));
      const r = f.engine.readRevision(final(f))!;
      hashes.push(r.contentFingerprint + ":" + r.lineageFingerprint);
    }
    expect(new Set(hashes).size).toBe(1);
  });
});
describe("Prompt 18 corrections and hierarchical coverage", () => {
  it("late input creates immutable parented correction and preserves old cutoff", () => {
    const f = fixture(["M1"]);
    unwrap(f.engine.ingest(f.streamId, observation(t("10:00:05"), 1)));
    const initial = final(f),
      r1 = f.engine.readRevision(initial)!;
    const before = unwrap(
      f.engine.snapshot({
        streamId: f.streamId,
        timeframes: ["M1"],
        asOf: f.clock.now(),
        cutoff: f.clock.now(),
      }),
    );
    const oldCutoff = f.clock.now();
    set(f, t("12:00:01"));
    unwrap(f.engine.ingest(f.streamId, observation(t("10:00:00"), 2, "5")));
    const history = unwrap(f.engine.history(r1.barId));
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({
      state: "CORRECTED",
      parentRevisionId: initial,
      open: "5",
      high: "5",
    });
    expect(history[0]).toEqual(r1);
    expect(
      unwrap(
        f.engine.snapshot({
          streamId: f.streamId,
          timeframes: ["M1"],
          asOf: oldCutoff,
          cutoff: oldCutoff,
        }),
      ).contentFingerprint,
    ).toBe(before.contentFingerprint);
    expect(unwrap(f.engine.recompute(f.streamId, "M1", t("10:00:00")))).toBe(
      history[1]!.revisionId,
    );
  });
  it("correction horizon rejects changes and exposes continuity loss", () => {
    const f = fixture(["M1"], { correctionHorizonMs: 6000 });
    unwrap(f.engine.ingest(f.streamId, observation(t("11:59:05"), 1)));
    final(f, "M1", t("11:59:00"));
    set(f, t("12:00:10"));
    expect(f.engine.ingest(f.streamId, observation(t("11:59:10"), 2)).ok).toBe(false);
    expect(f.engine.diagnostics().errors).toContain("CORRECTION_HORIZON");
  });
  it("missing M1 inside M15 cannot establish complete constituent coverage", () => {
    const f = fixture(["M1"], {}, undefined, [{ child: "M1", parent: "M15" }]);
    for (let i = 0; i < 15; i++) {
      if (i === 7) continue;
      const at = t(`10:${String(i).padStart(2, "0")}:05`);
      unwrap(f.engine.ingest(f.streamId, observation(at, i + 1)));
      evidence(f, t("12:00:00"));
      unwrap(f.engine.publishWindow(f.streamId, "M1", at, true));
    }
    const parent = f.engine.readRevision(
      unwrap(f.engine.publishWindow(f.streamId, "M15", t("10:00:00"), true)),
    )!;
    expect(parent.coverage).toBe("INCOMPLETE");
    expect(parent.constituents).toHaveLength(14);
  });
  it("only actual dependent M5/M15/H1/H4 revisions change after M1 correction", () => {
    const edges = [
      { child: "M1", parent: "M5" },
      { child: "M5", parent: "M15" },
      { child: "M15", parent: "H1" },
      { child: "H1", parent: "H4" },
    ];
    const f = fixture(["M1"], {}, undefined, edges);
    unwrap(f.engine.ingest(f.streamId, observation(t("08:00:05"), 1)));
    evidence(f, t("12:00:00"));
    const ids = new Map<string, string>();
    for (const code of ["M1", "M5", "M15", "H1", "H4"])
      ids.set(code, unwrap(f.engine.publishWindow(f.streamId, code, t("08:00:05"), true)));
    const before = unwrap(
      f.engine.snapshot({
        streamId: f.streamId,
        timeframes: ["H4", "H1", "M15"],
        asOf: f.clock.now(),
        cutoff: f.clock.now(),
        includeIncomplete: true,
      }),
    );
    set(f, t("12:00:01"));
    unwrap(f.engine.ingest(f.streamId, observation(t("08:00:01"), 2, "7")));
    for (const [code, id] of ids) {
      const r = f.engine.readRevision(id)!;
      const history = unwrap(f.engine.history(r.barId));
      expect(history).toHaveLength(2);
      expect(history[1]!.parentRevisionId).toBe(id);
      expect(history[1]!.high).toBe("7");
      expect(history[1]!.timeframe).toBe(code);
    }
    expect(
      unwrap(
        f.engine.snapshot({
          streamId: f.streamId,
          timeframes: ["H4", "H1", "M15"],
          asOf: t("12:00:00"),
          cutoff: t("12:00:00"),
          includeIncomplete: true,
        }),
      ).contentFingerprint,
    ).toBe(before.contentFingerprint);
  });
  it("watermarks are isolated and cannot move backward or reconcile implicitly", () => {
    const f = fixture(["M1"]);
    const other = unwrap(
      f.engine.registerStream({ ...stream, instrumentId: "40000000-0000-4000-8000-000000000003" }),
    );
    evidence(f, t("12:00:00"));
    expect(f.engine.diagnostics().watermarks[other]!.through).toBeNull();
    unwrap(f.engine.fence(f.streamId, "reconnect"));
    expect(
      f.engine.watermark(f.streamId, {
        sessionId: "session-2",
        through: t("12:00:00"),
        observedAt: f.clock.now(),
        coverage: "COMPLETE_COVERAGE",
        kind: "END_OF_STREAM",
        evidenceId: "bad",
        reconciled: false,
      }).ok,
    ).toBe(false);
    expect(
      f.engine.watermark(f.streamId, {
        sessionId: "session-1",
        through: t("11:59:00"),
        observedAt: f.clock.now(),
        coverage: "COMPLETE_COVERAGE",
        kind: "END_OF_STREAM",
        evidenceId: "back",
        reconciled: true,
      }).ok,
    ).toBe(false);
  });
  it("source mixing and construction graph conflicts are rejected", () => {
    const f = fixture(["M1"]);
    const x = observation(t("10:00:05"), 1);
    expect(f.engine.ingest(f.streamId, { ...x, sourceFingerprint: hash("different") }).ok).toBe(
      false,
    );
    expect(
      () =>
        new AggregationEngine({
          clock: f.clock,
          repository: f.repository,
          registry: new TimeframeRegistry(),
          calendar: utcCalendar,
          configurationFingerprint: config,
          options: { ...defaultOptions, enabled: true },
          directTimeframes: ["M1", "M5"],
          edges: [{ child: "M1", parent: "M5" }],
        }),
    ).toThrow("GRAPH_INCOMPATIBLE");
  });
});

describe("Prompt 18 continuity loss and conditional hierarchy equivalence", () => {
  it("a stale late correction invalidates current finality without deleting historical knowledge", () => {
    const f = fixture(["M1"]);
    unwrap(f.engine.ingest(f.streamId, observation(t("10:00:05"), 1)));
    const first = final(f);
    set(f, t("12:00:01"));
    unwrap(
      f.engine.ingest(f.streamId, { ...observation(t("10:00:06"), 2, "3"), warnings: ["STALE"] }),
    );
    const history = unwrap(f.engine.history(f.engine.readRevision(first)!.barId));
    expect(history.at(-1)).toMatchObject({
      state: "INVALIDATED",
      final: false,
      coverage: "UNKNOWN",
      parentRevisionId: first,
    });
    expect(
      unwrap(
        f.engine.snapshot({
          streamId: f.streamId,
          timeframes: ["M1"],
          asOf: f.clock.now(),
          cutoff: f.clock.now(),
        }),
      ).selected,
    ).toEqual({});
    expect(
      unwrap(
        f.engine.snapshot({
          streamId: f.streamId,
          timeframes: ["M1"],
          asOf: t("12:00:00"),
          cutoff: t("12:00:00"),
        }),
      ).selected.M1!.revisionId,
    ).toBe(first);
    evidence(f, f.clock.now());
    const corrected = unwrap(f.engine.publishWindow(f.streamId, "M1", t("10:00:00"), true));
    expect(f.engine.readRevision(corrected)).toMatchObject({
      final: true,
      high: "3",
      coverage: "COMPLETE_COVERAGE",
    });
  });
  it("matching complete direct and hierarchical M5 inputs give equal OHLC and volume, distinct construction lineage", () => {
    const direct = fixture(["M5"]),
      hier = fixture(["M1"], {}, undefined, [{ child: "M1", parent: "M5" }]);
    for (let i = 0; i < 5; i++) {
      const x = observation(t(`10:0${i}:05`), i + 1, String(i + 1));
      unwrap(direct.engine.ingest(direct.streamId, x));
      unwrap(hier.engine.ingest(hier.streamId, x));
      evidence(hier, hier.clock.now());
      unwrap(hier.engine.publishWindow(hier.streamId, "M1", t(`10:0${i}:00`), true));
    }
    const a = direct.engine.readRevision(final(direct, "M5"))!,
      b = hier.engine.readRevision(final(hier, "M5"))!;
    expect([a.open, a.high, a.low, a.close, a.volume, a.coverage]).toEqual([
      b.open,
      b.high,
      b.low,
      b.close,
      b.volume,
      b.coverage,
    ]);
    expect(a.constructionFingerprint).not.toBe(b.constructionFingerprint);
    expect(a.lineageFingerprint).not.toBe(b.lineageFingerprint);
  });
  it("duplicate canonical observation identity cannot be counted under a new envelope identity", () => {
    const f = fixture(["M1"]),
      x = observation(t("10:00:05"), 1);
    unwrap(f.engine.ingest(f.streamId, x));
    unwrap(f.engine.ingest(f.streamId, { ...x, identity: "alternate-envelope" }));
    expect(f.engine.readRevision(final(f))!.count).toBe(1);
    expect(f.engine.diagnostics().counters.accepted).toBe(2);
  });
});
