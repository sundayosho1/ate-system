import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AggregationEngine,
  FilesystemAggregationRepository,
  TimeframeRegistry,
  utcCalendar,
  defaultOptions,
  failure,
  canonicalBar,
  hash,
  type Options,
} from "@ate/multitimeframe";
import { fixture, observation, unwrap, t, evidence, set, config } from "./fixtures.js";
const restart = (
  f: ReturnType<typeof fixture>,
  repository = f.repository,
  options: Partial<Options> = {},
  edges: readonly { child: string; parent: string }[] = [],
) =>
  new AggregationEngine({
    clock: f.clock,
    repository,
    registry: new TimeframeRegistry(),
    calendar: utcCalendar,
    configurationFingerprint: config,
    options: { ...defaultOptions, enabled: true, ...options },
    directTimeframes: ["M1"],
    edges,
  });
const final = (f: ReturnType<typeof fixture>, tf = "M1", at = t("11:59:00")) => {
  evidence(f, f.clock.now());
  return unwrap(f.engine.publishWindow(f.streamId, tf, at, true));
};
const temporary = (action: (root: string) => void) => {
  const root = mkdtempSync(join(tmpdir(), "ate-003B-"));
  try {
    action(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};
describe("CODEX-003B H03 actual filesystem capacity", () => {
  it.each([1, 2, 3] as const)(
    "capacity %s acknowledges only recoverable operations and reserves markers",
    (limit) =>
      temporary((root) => {
        const f = fixture(
          ["M1"],
          {},
          (clock) => new FilesystemAggregationRepository(root, clock, 10485760, limit),
        );
        for (let n = 1; n < limit; n++)
          unwrap(f.engine.ingest(f.streamId, observation(t("10:00:05"), n)));
        expect(readdirSync(root)).toHaveLength(limit * 2);
        const restored = restart(
          f,
          new FilesystemAggregationRepository(root, f.clock, 10485760, limit),
        );
        unwrap(restored.start());
        const stored = unwrap(f.repository.recover())!;
        const draft = structuredClone(stored.checkpoint);
        draft.generation++;
        const before = readdirSync(root);
        const denied = f.repository.commit("f".repeat(64), draft, []);
        expect(denied).toMatchObject({ ok: false, commitment: "CONFIRMED_NOT_COMMITTED" });
        expect(readdirSync(root)).toEqual(before);
        expect(unwrap(f.repository.publish(stored.operationId)).publishedAt).toBe(
          stored.publishedAt,
        );
        expect(unwrap(f.repository.recover())!.operationId).toBe(stored.operationId);
        for (const name of before) {
          const artifact: unknown = JSON.parse(readFileSync(join(root, name), "utf8"));
          expect(artifact).toHaveProperty("fingerprint");
        }
      }),
  );
  it("reproduces maxOperations=1 registration plus excess ingestion without poisoning stored state", () =>
    temporary((root) => {
      const f = fixture(
        ["M1"],
        {},
        (clock) => new FilesystemAggregationRepository(root, clock, 10485760, 1),
      );
      expect(f.engine.ingest(f.streamId, observation(t("10:00:05"), 1))).toMatchObject({
        ok: false,
        commitment: "CONFIRMED_NOT_COMMITTED",
      });
      expect(f.engine.diagnostics().state).toBe("FAILED");
      expect(f.engine.stop().ok).toBe(false);
      expect(readdirSync(root)).toHaveLength(2);
      const restored = restart(f, new FilesystemAggregationRepository(root, f.clock, 10485760, 1));
      unwrap(restored.start());
      expect(restored.diagnostics().windowCount).toBe(0);
    }));
  it("rejects smaller restart capacity and preserves files; larger capacity remains compatible", () =>
    temporary((root) => {
      const f = fixture(
        ["M1"],
        {},
        (clock) => new FilesystemAggregationRepository(root, clock, 10485760, 2),
      );
      unwrap(f.engine.ingest(f.streamId, observation(t("10:00:05"), 1)));
      const files = readdirSync(root);
      expect(
        restart(f, new FilesystemAggregationRepository(root, f.clock, 10485760, 1)).start().ok,
      ).toBe(false);
      expect(readdirSync(root)).toEqual(files);
      unwrap(restart(f, new FilesystemAggregationRepository(root, f.clock, 10485760, 3)).start());
    }));
  it.each(["commit-structured", "commit-throw", "marker-structured", "marker-throw"] as const)(
    "retains %s obligations at exactly full capacity with fresh/repeated recovery",
    (mode) =>
      temporary((root) => {
        let inject = false;
        let real!: FilesystemAggregationRepository;
        const f = fixture(["M1"], {}, (clock) => {
          real = new FilesystemAggregationRepository(root, clock, 10485760, 2);
          return {
            commit: (...args) => {
              const r = real.commit(...args);
              if (inject && mode.startsWith("commit")) {
                if (mode.endsWith("throw")) throw Error("post-content");
                return failure(clock, "POST_CONTENT");
              }
              return r;
            },
            publish: (...args) => {
              const r = real.publish(...args);
              if (inject && mode.startsWith("marker")) {
                if (mode.endsWith("throw")) throw Error("post-marker");
                return failure(clock, "POST_MARKER");
              }
              return r;
            },
            recover: (context) => real.recover(context),
          };
        });
        inject = true;
        expect(f.engine.ingest(f.streamId, observation(t("10:00:05"), 1)).ok).toBe(false);
        expect(f.engine.diagnostics().recovery).not.toBeNull();
        expect(f.engine.stop().ok).toBe(false);
        expect(f.engine.stop().ok).toBe(false);
        const files = readdirSync(root);
        expect(files.filter((x) => x.endsWith(".json"))).toHaveLength(2);
        expect(files.filter((x) => x.endsWith(".visible"))).toHaveLength(
          mode.startsWith("marker") ? 2 : 1,
        );
        inject = false;
        set(f, t("12:00:05"));
        const restored = restart(
          f,
          new FilesystemAggregationRepository(root, f.clock, 10485760, 2),
        );
        unwrap(restored.start());
        expect(restored.diagnostics().windowCount).toBe(1);
        const first = unwrap(real.recover())!,
          second = unwrap(real.recover())!;
        expect(first).toEqual(second);
        expect(readdirSync(root)).toHaveLength(4);
        const marker: unknown = JSON.parse(
          readFileSync(join(root, first.operationId + ".visible"), "utf8"),
        );
        expect(marker).toMatchObject({
          publishedAt: mode.startsWith("marker") ? t("12:00:00") : t("12:00:05"),
        });
      }),
  );
  it.each(["orphan-temp", "orphan-marker", "unknown"] as const)(
    "fails closed on %s without deleting evidence",
    (mode) =>
      temporary((root) => {
        const f = fixture(
          ["M1"],
          {},
          (clock) => new FilesystemAggregationRepository(root, clock, 10485760, 2),
        );
        const name =
          mode === "unknown"
            ? "unknown"
            : "f".repeat(64) + (mode === "orphan-temp" ? ".json.tmp" : ".visible");
        writeFileSync(join(root, name), "{}");
        const before = readdirSync(root);
        expect(f.repository.recover().ok).toBe(false);
        expect(readdirSync(root)).toEqual(before);
      }),
  );
  it("temporary paths belonging to a committed operation do not consume a second slot", () =>
    temporary((root) => {
      const f = fixture(
          ["M1"],
          {},
          (clock) => new FilesystemAggregationRepository(root, clock, 10485760, 1),
        ),
        stored = unwrap(f.repository.recover())!;
      writeFileSync(join(root, stored.operationId + ".json.tmp"), "interrupted retry");
      writeFileSync(join(root, stored.operationId + ".visible.tmp"), "interrupted retry");
      const before = readdirSync(root);
      expect(before).toHaveLength(4);
      expect(unwrap(f.repository.recover())!.operationId).toBe(stored.operationId);
      expect(readdirSync(root)).toEqual(before);
    }));
  it("a reserved unpublished operation can create its marker when all operation slots are used", () =>
    temporary((root) => {
      let blocked = false;
      const f = fixture(["M1"], {}, (clock) => {
        const real = new FilesystemAggregationRepository(root, clock, 10485760, 2);
        return {
          commit: (...args) => real.commit(...args),
          publish: (...args) => (blocked ? failure(clock, "BEFORE_MARKER") : real.publish(...args)),
          recover: (context) => real.recover(context),
        };
      });
      blocked = true;
      expect(f.engine.ingest(f.streamId, observation(t("10:00:05"), 1)).ok).toBe(false);
      expect(readdirSync(root)).toHaveLength(3);
      blocked = false;
      unwrap(restart(f, new FilesystemAggregationRepository(root, f.clock, 10485760, 2)).start());
      expect(readdirSync(root)).toHaveLength(4);
    }));
  it("capacity reached during correction preserves published history and cannot report healthy shutdown", () =>
    temporary((root) => {
      const f = fixture(
        ["M1"],
        {},
        (clock) => new FilesystemAggregationRepository(root, clock, 10485760, 4),
      );
      unwrap(f.engine.ingest(f.streamId, observation(t("11:59:05"), 1)));
      const id = final(f);
      const original = f.engine.readRevision(id);
      expect(readdirSync(root)).toHaveLength(8);
      set(f, t("12:00:01"));
      expect(f.engine.ingest(f.streamId, observation(t("11:59:06"), 2, "99")).ok).toBe(false);
      expect(f.engine.readRevision(id)).toEqual(original);
      expect(f.engine.stop().ok).toBe(false);
      expect(f.engine.stop().ok).toBe(false);
      const restored = restart(f, new FilesystemAggregationRepository(root, f.clock, 10485760, 4));
      unwrap(restored.start());
      expect(restored.readRevision(id)).toEqual(original);
    }));
});
describe("CODEX-003B H04 finalized-history correction horizon", () => {
  it.each([false, true])("blocks invalidation bypass including hierarchy=%s", (hierarchical) => {
    const edges = hierarchical ? [{ child: "M1", parent: "H1" }] : [];
    const f = fixture(["M1"], { correctionHorizonMs: 6000 }, undefined, edges);
    unwrap(f.engine.ingest(f.streamId, observation(t("11:59:05"), 1)));
    const initial = final(f);
    if (hierarchical) final(f, "H1");
    set(f, t("12:00:01"));
    unwrap(
      f.engine.ingest(f.streamId, { ...observation(t("11:59:06"), 2, "2"), warnings: ["STALE"] }),
    );
    expect(unwrap(f.engine.history(f.engine.readRevision(initial)!.barId)).at(-1)!.state).toBe(
      "INVALIDATED",
    );
    set(f, t("12:00:10"));
    expect(f.engine.ingest(f.streamId, observation(t("11:59:07"), 3, "99"))).toMatchObject({
      ok: false,
      error: { code: "CORRECTION_HORIZON" },
    });
    evidence(f, f.clock.now());
    for (const tf of hierarchical ? ["M1", "H1"] : ["M1"]) {
      expect(f.engine.publishWindow(f.streamId, tf, t("11:59:00"), true)).toMatchObject({
        ok: false,
        error: { code: "CORRECTION_HORIZON" },
      });
      expect(f.engine.recompute(f.streamId, tf, t("11:59:00"))).toMatchObject({
        ok: false,
        error: { code: "CORRECTION_HORIZON" },
      });
    }
    expect(f.engine.readRevision(initial)!.high).toBe("1");
    expect(f.engine.diagnostics().revisionCount).toBe(hierarchical ? 4 : 2);
  });
  it("retains the expired horizon after restart and repeated invalidation", () => {
    const f = fixture(["M1"], { correctionHorizonMs: 6000 });
    unwrap(f.engine.ingest(f.streamId, observation(t("11:59:05"), 1)));
    final(f);
    set(f, t("12:00:01"));
    unwrap(f.engine.ingest(f.streamId, { ...observation(t("11:59:06"), 2), warnings: ["STALE"] }));
    set(f, t("12:00:02"));
    unwrap(f.engine.ingest(f.streamId, { ...observation(t("11:59:07"), 3), warnings: ["STALE"] }));
    set(f, t("12:00:10"));
    const r = restart(f, f.repository, { correctionHorizonMs: 6000 });
    unwrap(r.start());
    expect(r.ingest(f.streamId, observation(t("11:59:08"), 4, "99"))).toMatchObject({
      ok: false,
      error: { code: "CORRECTION_HORIZON" },
    });
    expect(r.publishWindow(f.streamId, "M1", t("11:59:00"), true).ok).toBe(false);
  });
  it("still permits legitimate initial construction of an old historical window", () => {
    const f = fixture(["M1"], { correctionHorizonMs: 6000 });
    unwrap(f.engine.ingest(f.streamId, { ...observation(t("10:00:05"), 1), origin: "HISTORICAL" }));
    const id = final(f, "M1", t("10:00:00"));
    expect(f.engine.readRevision(id)!.availability).toBe("UNKNOWN");
    expect(f.engine.readRevision(id)!.final).toBe(true);
  });
  it("valid in-horizon correction and refinalization preserve immutable history", () => {
    const f = fixture(["M1"], { correctionHorizonMs: 6000 });
    unwrap(f.engine.ingest(f.streamId, observation(t("11:59:05"), 1)));
    const id = final(f);
    set(f, t("12:00:01"));
    unwrap(
      f.engine.ingest(f.streamId, { ...observation(t("11:59:06"), 2, "7"), warnings: ["STALE"] }),
    );
    set(f, t("12:00:05"));
    const revised = final(f);
    expect(f.engine.readRevision(revised)!.high).toBe("7");
    expect(f.engine.readRevision(id)!.high).toBe("1");
  });
  it("expired canonical replacement cannot bypass invalidated finalized history", () => {
    const source = fixture(["M1"]);
    unwrap(source.engine.ingest(source.streamId, observation(t("11:59:05"), 1)));
    const sourceId = final(source),
      target = fixture(["M5"], { correctionHorizonMs: 6000 }),
      bar = canonicalBar(source.engine.readRevision(sourceId)!);
    const input = {
      ...observation(t("11:59:00"), 99),
      observation: bar,
      identity: bar.observationId,
    };
    unwrap(target.engine.ingest(target.streamId, input));
    const first = final(target, "M5");
    set(source, t("12:00:01"));
    unwrap(source.engine.ingest(source.streamId, observation(t("11:59:06"), 2, "99")));
    const replacement = canonicalBar(
      unwrap(source.engine.history(source.engine.readRevision(sourceId)!.barId)).at(-1)!,
    );
    set(target, t("12:00:10"));
    expect(
      target.engine.ingest(target.streamId, {
        ...input,
        identity: replacement.observationId,
        observation: replacement,
      }),
    ).toMatchObject({ ok: false, error: { code: "CORRECTION_HORIZON" } });
    expect(target.engine.readRevision(first)!.high).toBe("1");
  });
  it("a source-gap invalidation cannot reset the parent's horizon on reconciliation", () => {
    const f = fixture(["M1"], { correctionHorizonMs: 6000 }, undefined, [
      { child: "M1", parent: "H1" },
    ]);
    unwrap(f.engine.ingest(f.streamId, observation(t("11:59:05"), 1)));
    final(f);
    const parent = final(f, "H1");
    set(f, t("12:00:01"));
    unwrap(f.engine.fence(f.streamId, "SOURCE_GAP"));
    unwrap(f.engine.ingest(f.streamId, { ...observation(t("11:59:06"), 2), continuity: "GAP" }));
    set(f, t("12:00:10"));
    evidence(f, f.clock.now());
    expect(f.engine.publishWindow(f.streamId, "H1", t("11:59:00"), true)).toMatchObject({
      ok: false,
      error: { code: "CORRECTION_HORIZON" },
    });
    expect(f.engine.readRevision(parent)!.final).toBe(true);
  });
  it("recovery plus publication does not reset first finalized history", () => {
    const f = fixture(["M1"], { correctionHorizonMs: 6000 });
    unwrap(f.engine.ingest(f.streamId, observation(t("11:59:05"), 1)));
    const id = final(f);
    set(f, t("12:00:10"));
    const r = restart(f, f.repository, { correctionHorizonMs: 6000 });
    unwrap(r.start());
    expect(r.recompute(f.streamId, "M1", t("11:59:00"))).toMatchObject({
      ok: false,
      error: { code: "CORRECTION_HORIZON" },
    });
    expect(r.readRevision(id)!.finalityAt).toBe(t("12:00:00"));
  });
});

describe("CODEX-003B admission/recovery operation identity", () => {
  it.each(["identity", "generation", "fingerprint"] as const)(
    "rejects invalid %s before attempting storage mutation",
    (mode) =>
      temporary((root) => {
        const f = fixture(
            ["M1"],
            {},
            (clock) => new FilesystemAggregationRepository(root, clock, 10485760, 2),
          ),
          old = unwrap(f.repository.recover())!,
          checkpoint = structuredClone(old.checkpoint);
        checkpoint.generation = mode === "generation" ? 3 : 2;
        const { fingerprint: _old, ...body } = checkpoint;
        checkpoint.fingerprint = hash(body);
        if (mode === "fingerprint") checkpoint.fingerprint = hash("wrong-state");
        const id =
          mode === "identity"
            ? hash("wrong-operation")
            : hash({ generation: checkpoint.generation, fingerprint: checkpoint.fingerprint });
        const before = readdirSync(root);
        expect(f.repository.commit(id, checkpoint, [])).toMatchObject({
          ok: false,
          commitment: "CONFIRMED_NOT_COMMITTED",
        });
        expect(readdirSync(root)).toEqual(before);
        expect(unwrap(f.repository.recover())!.operationId).toBe(old.operationId);
      }),
  );
});
