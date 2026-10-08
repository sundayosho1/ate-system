import { describe, it, expect } from "vitest";
import { marketObservationSchema } from "@ate/domain";
import {
  AggregationEngine,
  TimeframeRegistry,
  utcCalendar,
  defaultOptions,
  canonicalBar,
  hash,
  type Input,
  type QualityEvidence,
  type Revision,
} from "@ate/multitimeframe";
import { fixture, observation, unwrap, t, evidence, set, config, stream } from "./fixtures.js";
const finalize = (f: ReturnType<typeof fixture>, code = "M1", at = t("10:00:00")) => {
  evidence(f, f.clock.now());
  return f.engine.readRevision(unwrap(f.engine.publishWindow(f.streamId, code, at, true)))!;
};
const quality = (id = "critical-report", suppressed = 7): QualityEvidence => ({
  reportId: id,
  reportFingerprint: "sha256:" + hash(id),
  findings: [
    { findingId: "critical-finding" as never, category: "COVERAGE_GAP", severity: "CRITICAL" },
  ],
  suppressed,
});
const child = (at = "10:00:05", id = 1, q = quality()) => {
  const f = fixture(["M1"]);
  unwrap(f.engine.ingest(f.streamId, { ...observation(t(at), id), quality: q }));
  return { f, revision: finalize(f, "M1", t(at)) };
};
const handoff = (r: Revision, id = r.revisionId): Input => ({
  ...observation(r.window.start, 99),
  observation: canonicalBar(r),
  identity: id,
});
describe("CODEX-003B H01 deterministic total ordering", () => {
  it.each(["equal", "missing", "mixed", "numeric-equal"] as const)(
    "preserves OHLC/content/lineage under %s sequence permutations and retains uncertainty",
    (mode) => {
      const xs = [1, 2, 3].map((id) => {
        const { orderingSequence: _seq, ...x } = observation(t("10:00:05"), id, String(id));
        return {
          ...x,
          ...(mode === "equal"
            ? { orderingSequence: "1" }
            : mode === "numeric-equal"
              ? { orderingSequence: id === 1 ? "01" : "1" }
              : mode === "mixed" && id !== 2
                ? { orderingSequence: String(id) }
                : {}),
        };
      });
      const outputs: Revision[] = [];
      for (const permutation of [
        [0, 1, 2],
        [2, 1, 0],
        [1, 0, 2],
        [0, 2, 1],
        [1, 2, 0],
        [2, 0, 1],
      ]) {
        const f = fixture(["M1"]);
        for (const i of permutation) unwrap(f.engine.ingest(f.streamId, xs[i]!));
        const r = finalize(f);
        outputs.push(r);
        expect(r.ordering).toBe("UNCERTAIN");
        expect(r.quality).toContain("ORDERING_UNCERTAIN");
      }
      expect(new Set(outputs.map((r) => r.contentFingerprint)).size).toBe(1);
      expect(new Set(outputs.map((r) => r.lineageFingerprint)).size).toBe(1);
      expect(new Set(outputs.map((r) => `${r.open}/${r.close}`)).size).toBe(1);
    },
  );
  it("reproduces the two-price audit case with identical results and uncertainty", () => {
    const outputs = [
      [1, 2],
      [2, 1],
    ].map((order) => {
      const f = fixture(["M1"]);
      for (const id of order)
        unwrap(
          f.engine.ingest(f.streamId, {
            ...observation(t("10:00:05"), id, String(id)),
            orderingSequence: "1",
          }),
        );
      return finalize(f);
    });
    expect(outputs.map((r) => [r.open, r.close, r.ordering])).toEqual([
      ["1", "2", "UNCERTAIN"],
      ["1", "2", "UNCERTAIN"],
    ]);
    expect(outputs[0]!.contentFingerprint).toBe(outputs[1]!.contentFingerprint);
    expect(outputs[0]!.lineageFingerprint).toBe(outputs[1]!.lineageFingerprint);
  });
  it("keeps canonical duplicates idempotent and conflicting identities fenced", () => {
    const f = fixture(["M1"]),
      x = observation(t("10:00:05"), 1);
    unwrap(f.engine.ingest(f.streamId, x));
    unwrap(f.engine.ingest(f.streamId, { ...x, identity: "another-envelope" }));
    expect(finalize(f).count).toBe(1);
    expect(f.engine.ingest(f.streamId, observation(t("10:00:05"), 1, "99"))).toMatchObject({
      ok: false,
      error: { code: "IDENTITY_CONFLICT" },
    });
    expect(f.engine.diagnostics().watermarks[f.streamId]!.status).toBe("FENCED");
  });
  it("does not suppress sequence gaps or mix another source into the stream", () => {
    const f = fixture(["M1"]);
    unwrap(f.engine.ingest(f.streamId, observation(t("10:00:05"), 1)));
    evidence(f, f.clock.now());
    unwrap(f.engine.ingest(f.streamId, observation(t("10:00:05"), 2)));
    unwrap(f.engine.ingest(f.streamId, observation(t("10:00:05"), 4)));
    expect(f.engine.diagnostics().watermarks[f.streamId]!.status).toBe("FENCED");
    const other = unwrap(
      f.engine.registerStream({ ...stream, sourceId: "40000000-0000-4000-8000-000000000010" }),
    );
    expect(f.engine.ingest(other, observation(t("10:00:05"), 5)).ok).toBe(false);
  });
});
describe("CODEX-003B H02 inherited quality handoff", () => {
  it("retains the CRITICAL finding, fingerprint and seven suppressed findings across canonical M1 to M5", () => {
    const { revision } = child(),
      f = fixture(["M5"]),
      bar = canonicalBar(revision);
    expect(marketObservationSchema.safeParse(bar).success).toBe(true);
    unwrap(f.engine.ingest(f.streamId, handoff(revision)));
    const r = finalize(f, "M5");
    expect(r.quality.join("|")).toContain(quality().reportFingerprint);
    expect(r.quality.join("|")).toContain("critical-finding:COVERAGE_GAP:CRITICAL");
    expect(r.suppressedEvidence).toBe(7);
    expect(r.constituents[0]!.provenance?.metadata).toMatchObject({
      "aggregation.lineagefingerprint": revision.lineageFingerprint,
    });
    expect(r.quality).not.toContain("QUALITY_UNASSESSED");
  });
  it("preserves multiple child reports and does not count a duplicated canonical child twice", () => {
    const a = child(),
      b = child("10:01:05", 2, quality("second-report", 3)),
      f = fixture(["M5"]);
    const input = handoff(a.revision);
    unwrap(f.engine.ingest(f.streamId, input));
    unwrap(f.engine.ingest(f.streamId, { ...input, identity: "duplicate-envelope" }));
    unwrap(f.engine.ingest(f.streamId, handoff(b.revision)));
    const r = finalize(f, "M5");
    expect(r.count).toBe(2);
    expect(r.suppressedEvidence).toBe(10);
    expect(
      r.quality.filter(
        (q) => q.includes(quality().reportFingerprint) && q.includes("critical-finding"),
      ),
    ).toHaveLength(1);
    expect(r.quality.join("|")).toContain(quality("second-report").reportFingerprint);
  });
  it.each(["missing", "fingerprint", "payload", "suppression", "source"] as const)(
    "rejects %s inherited evidence without admitting a contribution",
    (mode) => {
      const { revision } = child(),
        f = fixture(["M5"]),
        bar = canonicalBar(revision),
        metadata = { ...bar.metadata };
      if (mode === "missing") delete metadata["aggregation.qualitymanifest"];
      else if (mode === "fingerprint")
        metadata["aggregation.qualitymanifestfingerprint"] = hash("wrong");
      else {
        const chunks = metadata["aggregation.qualitymanifest"] as string[];
        const encoded = chunks.join("");
        const replacement =
          mode === "payload"
            ? encoded.replace("CRITICAL", "WARNING")
            : mode === "suppression"
              ? encoded.replace('"suppressed":7', '"suppressed":0')
              : encoded.replace(stream.sourceFingerprint, hash("another-source"));
        metadata["aggregation.qualitymanifest"] = Array.from(
          { length: Math.ceil(replacement.length / 256) },
          (_, i) => replacement.slice(i * 256, (i + 1) * 256),
        );
      }
      expect(
        f.engine.ingest(f.streamId, { ...handoff(revision), observation: { ...bar, metadata } }),
      ).toMatchObject({ ok: false, error: { code: "INHERITED_QUALITY_INTEGRITY" } });
      expect(f.engine.diagnostics().windowCount).toBe(0);
      expect(f.engine.publishWindow(f.streamId, "M5", t("10:00:00"), true).ok).toBe(false);
    },
  );
  it("rejects an oversized quality handoff rather than truncating original evidence", () => {
    const { revision } = child();
    const large = {
      ...revision,
      quality: Array.from({ length: 100 }, (_, i) => `${i}:` + "adverse".repeat(20)),
    };
    expect(() => canonicalBar(large)).toThrow("QUALITY_HANDOFF_BOUNDS");
    expect(large.quality).toHaveLength(100);
  });
  it("retains unknown evidence/availability across canonical projection", () => {
    const f = fixture(["M1"]);
    unwrap(f.engine.ingest(f.streamId, { ...observation(t("10:00:05"), 1), origin: "HISTORICAL" }));
    const original = finalize(f),
      target = fixture(["M5"]);
    unwrap(target.engine.ingest(target.streamId, handoff(original)));
    const r = finalize(target, "M5");
    expect(r.availability).toBe("UNKNOWN");
    expect(r.quality).toContain("UNVERIFIED_AVAILABILITY");
    expect(
      unwrap(
        target.engine.snapshot({
          streamId: target.streamId,
          timeframes: ["M5"],
          asOf: target.clock.now(),
          cutoff: target.clock.now(),
          includeIncomplete: true,
        }),
      ).selected,
    ).toEqual({});
  });
  it("propagates quality through M1 to M5 to M15 and revalidates it after restart", () => {
    const { revision } = child(),
      f = fixture(["M5"], {}, undefined, [{ child: "M5", parent: "M15" }]);
    unwrap(f.engine.ingest(f.streamId, handoff(revision)));
    finalize(f, "M5");
    const parent = finalize(f, "M15");
    expect(parent.quality.join("|")).toContain(quality().reportFingerprint);
    expect(parent.suppressedEvidence).toBe(7);
    const restart = new AggregationEngine({
      clock: f.clock,
      repository: f.repository,
      registry: new TimeframeRegistry(),
      calendar: utcCalendar,
      configurationFingerprint: config,
      options: { ...defaultOptions, enabled: true },
      directTimeframes: ["M5"],
      edges: [{ child: "M5", parent: "M15" }],
    });
    unwrap(restart.start());
    expect(restart.readRevision(parent.revisionId)).toEqual(parent);
    const next = fixture(["H1"]);
    unwrap(next.engine.ingest(next.streamId, handoff(restart.readRevision(parent.revisionId)!)));
    expect(finalize(next, "H1").suppressedEvidence).toBe(7);
  });
  it("combines equal-time uncertain ordering with adverse inherited quality without evidence loss", () => {
    const f = fixture(["M1"]);
    for (const id of [2, 1])
      unwrap(
        f.engine.ingest(f.streamId, {
          ...observation(t("10:00:05"), id, String(id)),
          orderingSequence: "1",
          quality: quality(`report-${id}`, id),
        }),
      );
    const r = finalize(f),
      target = fixture(["M5"]);
    unwrap(target.engine.ingest(target.streamId, handoff(r)));
    const next = finalize(target, "M5");
    expect(next.quality).toContain("ORDERING_UNCERTAIN");
    expect(next.quality.join("|")).toContain("CRITICAL");
    expect(next.suppressedEvidence).toBe(3);
  });
  it("canonical source replacements retain evidence and do not double volume", () => {
    const { f, revision } = child(),
      target = fixture(["M5"]);
    unwrap(target.engine.ingest(target.streamId, handoff(revision)));
    const first = finalize(target, "M5");
    set(f, t("12:00:01"));
    unwrap(
      f.engine.ingest(f.streamId, {
        ...observation(t("10:00:06"), 2, "3"),
        quality: quality("second", 2),
      }),
    );
    set(target, t("12:00:01"));
    const correction = unwrap(f.engine.history(revision.barId)).at(-1)!;
    unwrap(target.engine.ingest(target.streamId, handoff(correction)));
    const latest = unwrap(target.engine.history(first.barId)).at(-1)!;
    expect(latest.count).toBe(1);
    expect(latest.volume).toBe("2");
    expect(latest.suppressedEvidence).toBe(9);
    expect(latest.quality.join("|")).toContain(quality().reportFingerprint);
  });
});

describe("CODEX-003B quality reference accounting and recovery integrity", () => {
  it("deduplicates the same report's suppressed count across distinct child bars", () => {
    const a = child(),
      b = child("10:01:05", 2),
      target = fixture(["M5"]);
    unwrap(target.engine.ingest(target.streamId, handoff(a.revision)));
    unwrap(target.engine.ingest(target.streamId, handoff(b.revision)));
    const r = finalize(target, "M5");
    expect(r.count).toBe(2);
    expect(r.suppressedEvidence).toBe(7);
    expect(Object.keys(r.suppressionEvidence!)).toHaveLength(1);
  });
  it("retains an assessed report with zero emitted findings and known suppression", () => {
    const q = { ...quality(), findings: [] },
      a = child("10:00:05", 1, q),
      target = fixture(["M5"]);
    unwrap(target.engine.ingest(target.streamId, handoff(a.revision)));
    const r = finalize(target, "M5");
    expect(r.quality.join("|")).toContain(q.reportFingerprint);
    expect(r.suppressedEvidence).toBe(7);
    expect(r.quality).not.toContain("QUALITY_UNASSESSED");
  });
  it("rejects removal of every quality marker from a recognizable aggregate", () => {
    const { revision } = child(),
      target = fixture(["M5"]),
      bar = canonicalBar(revision),
      metadata = { ...bar.metadata };
    for (const key of Object.keys(metadata))
      if (key.startsWith("aggregation.quality")) delete metadata[key];
    expect(
      target.engine.ingest(target.streamId, {
        ...handoff(revision),
        observation: { ...bar, metadata },
      }),
    ).toMatchObject({ ok: false, error: { code: "INHERITED_QUALITY_INTEGRITY" } });
  });
  it.each(["corrupt", "missing"] as const)(
    "fails recovery for %s persisted inherited evidence rather than certifying legacy loss",
    (mode) => {
      const { revision } = child(),
        f = fixture(["M5"]);
      unwrap(f.engine.ingest(f.streamId, handoff(revision)));
      finalize(f, "M5");
      const stored = unwrap(f.repository.recover())!,
        checkpoint = structuredClone(stored.checkpoint),
        x = checkpoint.windows[0]!.contributions[0]!;
      if (mode === "corrupt")
        checkpoint.windows[0]!.contributions[0] = {
          ...x,
          inheritedQuality: { ...x.inheritedQuality!, fingerprint: hash("corrupt") },
        };
      else {
        const { inheritedQuality: _missing, ...legacy } = x;
        checkpoint.windows[0]!.contributions[0] = legacy;
      }
      const { fingerprint: _old, ...body } = checkpoint;
      checkpoint.fingerprint = hash(body);
      const repo = {
        commit: f.repository.commit.bind(f.repository),
        publish: f.repository.publish.bind(f.repository),
        recover: () => ({ ok: true as const, value: { ...stored, checkpoint } }),
      };
      const engine = new AggregationEngine({
        clock: f.clock,
        repository: repo,
        registry: new TimeframeRegistry(),
        calendar: utcCalendar,
        configurationFingerprint: config,
        options: { ...defaultOptions, enabled: true },
        directTimeframes: ["M5"],
      });
      expect(engine.start().ok).toBe(false);
      expect(engine.diagnostics().state).toBe("FAILED");
    },
  );
});

describe("CODEX-003B canonical duplicate alias ordering", () => {
  it("opposite canonical-duplicate alias permutations preserve content and lineage", () => {
    const rs = [
      ["z-alias", "a-alias"],
      ["a-alias", "z-alias"],
    ].map((aliases) => {
      const f = fixture(["M1"]);
      for (const identity of aliases)
        unwrap(f.engine.ingest(f.streamId, { ...observation(t("10:00:05"), 1), identity }));
      return finalize(f);
    });
    expect(rs[0]!.count).toBe(1);
    expect(rs[0]!.contentFingerprint).toBe(rs[1]!.contentFingerprint);
    expect(rs[0]!.lineageFingerprint).toBe(rs[1]!.lineageFingerprint);
    expect(rs[0]!.constituents[0]!.identity).toBe("a-alias");
  });
  it("conflicting material evidence for the same canonical duplicate is rejected", () => {
    const f = fixture(["M1"]),
      x = observation(t("10:00:05"), 1);
    unwrap(f.engine.ingest(f.streamId, x));
    expect(
      f.engine.ingest(f.streamId, { ...x, identity: "other-alias", quality: quality() }),
    ).toMatchObject({ ok: false, error: { code: "DUPLICATE_EVIDENCE_CONFLICT" } });
    expect(f.engine.diagnostics().watermarks[f.streamId]!.status).toBe("FENCED");
  });
});

describe("CODEX-003B ordering source/evidence permutations", () => {
  it("keeps multiple valid source scopes independent under interleaved permutations", () => {
    const runs = [
      [0, 1, 2, 3],
      [3, 2, 1, 0],
    ].map((order) => {
      const f = fixture(["M1"]),
        b = {
          ...stream,
          sourceId: "40000000-0000-4000-8000-000000000020",
          sourceFingerprint: hash("second-provider"),
        },
        bid = unwrap(f.engine.registerStream(b));
      const inputs = [1, 2, 3, 4].map((id, i) => {
        const x = { ...observation(t("10:00:05"), id, String(id)), orderingSequence: "1" };
        if (i % 2 === 0) return { streamId: f.streamId, input: x };
        const source = { ...x.observation.source, sourceId: b.sourceId };
        return {
          streamId: bid,
          input: {
            ...x,
            sourceFingerprint: b.sourceFingerprint,
            observation: marketObservationSchema.parse({
              ...x.observation,
              source,
              provenance: { ...x.observation.provenance, source },
            }),
          },
        };
      });
      for (const index of order)
        unwrap(f.engine.ingest(inputs[index]!.streamId, inputs[index]!.input));
      const results = [];
      for (const id of [f.streamId, bid]) {
        unwrap(
          f.engine.watermark(id, {
            sessionId: "session-1",
            through: f.clock.now(),
            observedAt: f.clock.now(),
            coverage: "COMPLETE_COVERAGE",
            kind: "END_OF_STREAM",
            evidenceId: "source-proof",
            reconciled: true,
          }),
        );
        results.push(
          f.engine.readRevision(unwrap(f.engine.publishWindow(id, "M1", t("10:00:00"), true)))!,
        );
      }
      return results;
    });
    for (const i of [0, 1]) {
      expect(runs[0]![i]!.contentFingerprint).toBe(runs[1]![i]!.contentFingerprint);
      expect(runs[0]![i]!.lineageFingerprint).toBe(runs[1]![i]!.lineageFingerprint);
      expect(runs[0]![i]!.count).toBe(2);
      expect(runs[0]![i]!.ordering).toBe("UNCERTAIN");
    }
  });
  it("equivalent quality excerpt order on a canonical duplicate does not change lineage", () => {
    const q = {
      ...quality(),
      findings: [
        ...quality().findings,
        { ...quality().findings[0]!, findingId: "second-finding" as never },
      ],
    };
    const results = [false, true].map((reverse) => {
      const f = fixture(["M1"]);
      const first = {
        ...observation(t("10:00:05"), 1),
        quality: { ...q, findings: reverse ? [...q.findings].reverse() : q.findings },
      };
      unwrap(f.engine.ingest(f.streamId, first));
      unwrap(
        f.engine.ingest(f.streamId, {
          ...first,
          quality: { ...q, findings: [...first.quality.findings].reverse() },
        }),
      );
      return finalize(f);
    });
    expect(results[0]!.lineageFingerprint).toBe(results[1]!.lineageFingerprint);
    expect(results[0]!.suppressedEvidence).toBe(7);
  });
});
