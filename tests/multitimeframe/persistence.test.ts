import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AggregationEngine,
  FilesystemAggregationRepository,
  MemoryAggregationRepository,
  TimeframeRegistry,
  utcCalendar,
  defaultOptions,
  failure,
} from "@ate/multitimeframe";
import { fixture, observation, unwrap, t, evidence, set, config } from "./fixtures.js";
const fresh = (
  f: ReturnType<typeof fixture>,
  repo = f.repository,
  configurationFingerprint = config,
) =>
  new AggregationEngine({
    clock: f.clock,
    repository: repo,
    registry: new TimeframeRegistry(),
    calendar: utcCalendar,
    configurationFingerprint,
    options: { ...defaultOptions, enabled: true },
    directTimeframes: ["M1"],
  });
describe("Prompt 18 failure atomicity and lifecycle", () => {
  it.each(["structured", "exception"] as const)(
    "preserves post-commit %s failure obligation across repeated stop and recovery",
    (kind) => {
      let fail = false;
      let memory: MemoryAggregationRepository;
      const f = fixture(["M1"], {}, (clock) => {
        memory = new MemoryAggregationRepository(clock);
        return {
          commit: (...args) => {
            const result = memory.commit(...args);
            if (fail) {
              if (kind === "exception") throw Error("injected");
              return failure(clock, "INJECTED");
            }
            return result;
          },
          publish: (...args) => memory.publish(...args),
          recover: () => memory.recover(),
        };
      });
      fail = true;
      expect(f.engine.ingest(f.streamId, observation(t("10:00:05"), 1)).ok).toBe(false);
      expect(f.engine.diagnostics().recovery).toMatchObject({ commitment: "UNKNOWN_COMMITMENT" });
      expect(f.engine.stop().ok).toBe(false);
      expect(f.engine.stop().ok).toBe(false);
      fail = false;
      set(f, t("12:00:01"));
      const recovered = fresh(f);
      unwrap(recovered.start());
      expect(recovered.diagnostics().windowCount).toBe(1);
      expect(recovered.diagnostics().watermarks[f.streamId]!.status).toBe("FENCED");
    },
  );
  it("certified pre-write failure creates no false recovery obligation", () => {
    let fail = false;
    const f = fixture(["M1"], {}, (clock) => {
      const memory = new MemoryAggregationRepository(clock);
      return {
        commit: (...args) =>
          fail
            ? {
                ok: false,
                error: { code: "PREWRITE", timestamp: clock.now() },
                commitment: "CONFIRMED_NOT_COMMITTED",
              }
            : memory.commit(...args),
        publish: (...args) => memory.publish(...args),
        recover: () => memory.recover(),
      };
    });
    fail = true;
    expect(f.engine.ingest(f.streamId, observation(t("10:00:05"), 1)).ok).toBe(false);
    expect(f.engine.diagnostics().recovery).toBeNull();
    expect(f.engine.diagnostics().windowCount).toBe(0);
  });
  it("reentrant stop cannot conceal a committed operation or permit recursive creation", () => {
    let reenter = false;
    const f = fixture(["M1"], {}, (clock) => {
      const memory = new MemoryAggregationRepository(clock);
      return {
        commit: (...args) => {
          const r = memory.commit(...args);
          if (reenter) {
            expect(f.engine.stop()).toMatchObject({
              ok: false,
              error: { code: "SHUTDOWN_IN_PROGRESS" },
            });
            expect(
              f.engine.registerStream(Object.values(f.engine.diagnostics().streams)[0]!).ok,
            ).toBe(false);
          }
          return r;
        },
        publish: (...args) => memory.publish(...args),
        recover: () => memory.recover(),
      };
    });
    reenter = true;
    expect(f.engine.ingest(f.streamId, observation(t("10:00:05"), 1)).ok).toBe(false);
    expect(f.engine.diagnostics().recovery).toMatchObject({ commitment: "COMMITTED" });
    expect(f.engine.stop().ok).toBe(false);
  });
  it("publication failure remains unavailable until recovery publishes at the current clock", () => {
    let fail = false;
    const f = fixture(["M1"], {}, (clock) => {
      const memory = new MemoryAggregationRepository(clock);
      return {
        commit: (...args) => memory.commit(...args),
        publish: (...args) =>
          fail ? failure(clock, "INJECTED_PUBLICATION") : memory.publish(...args),
        recover: () => memory.recover(),
      };
    });
    unwrap(f.engine.ingest(f.streamId, observation(t("10:00:05"), 1)));
    evidence(f, t("12:00:00"));
    fail = true;
    expect(f.engine.publishWindow(f.streamId, "M1", t("10:00:00"), true).ok).toBe(false);
    expect(f.engine.diagnostics().revisionCount).toBe(0);
    set(f, t("12:00:05"));
    fail = false;
    const recovered = fresh(f);
    unwrap(recovered.start());
    const before = unwrap(
      recovered.snapshot({
        streamId: f.streamId,
        timeframes: ["M1"],
        asOf: f.clock.now(),
        cutoff: t("12:00:00"),
      }),
    );
    expect(before.selected).toEqual({});
    const after = unwrap(
      recovered.snapshot({
        streamId: f.streamId,
        timeframes: ["M1"],
        asOf: f.clock.now(),
        cutoff: f.clock.now(),
      }),
    );
    expect(after.selected.M1?.availableAt).toBe(t("12:00:05"));
  });
  it("successful stop repeats idempotently and prohibits late callbacks", () => {
    const f = fixture(["M1"]);
    unwrap(f.engine.stop());
    unwrap(f.engine.stop());
    expect(f.engine.ingest(f.streamId, observation(t("10:00:05"), 1)).ok).toBe(false);
  });
  it("incompatible configuration rejects recovered state", () => {
    const f = fixture(["M1"]);
    const recovered = fresh(f, f.repository, "f".repeat(64));
    expect(recovered.start().ok).toBe(false);
    expect(recovered.diagnostics().state).toBe("FAILED");
  });
});
describe("Prompt 18 real filesystem commit markers", () => {
  it("recovers content, immutable revisions and original publication without duplicating history", () => {
    const root = mkdtempSync(join(tmpdir(), "ate-aggregate-"));
    try {
      const f = fixture(["M1"], {}, (clock) => new FilesystemAggregationRepository(root, clock));
      unwrap(f.engine.ingest(f.streamId, observation(t("10:00:05"), 1)));
      evidence(f, t("12:00:00"));
      const id = unwrap(f.engine.publishWindow(f.streamId, "M1", t("10:00:00"), true));
      const original = f.engine.readRevision(id);
      set(f, t("12:00:05"));
      const r = fresh(f, new FilesystemAggregationRepository(root, f.clock));
      unwrap(r.start());
      expect(r.readRevision(id)).toEqual(original);
      expect(unwrap(r.history(original!.barId))).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it.each(["content", "marker", "temporary", "unknown"] as const)(
    "fails closed on %s corruption without deleting evidence",
    (kind) => {
      const root = mkdtempSync(join(tmpdir(), "ate-aggregate-"));
      try {
        const f = fixture(["M1"], {}, (clock) => new FilesystemAggregationRepository(root, clock));
        const entries = readdirSync(root);
        const name = entries.find((e) => e.endsWith(kind === "marker" ? ".visible" : ".json"))!;
        if (kind === "content" || kind === "marker")
          writeFileSync(
            join(root, name),
            readFileSync(join(root, name), "utf8").replace("fingerprint", "badFingerprint"),
          );
        else
          writeFileSync(
            join(root, kind === "temporary" ? "f".repeat(64) + ".json.tmp" : "hostile"),
            "{}",
          );
        const before = readdirSync(root);
        const r = fresh(f, new FilesystemAggregationRepository(root, f.clock));
        expect(r.start().ok).toBe(false);
        expect(readdirSync(root)).toEqual(before);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});

describe("Prompt 18 delayed commit and publication accounting", () => {
  it("never selects computation before actual delayed publication", () => {
    let delay = false;
    const f = fixture(["M1"], {}, (clock) => {
      const memory = new MemoryAggregationRepository(clock);
      return {
        commit: (...args) => {
          if (delay) set({ clock }, t("12:00:02"));
          return memory.commit(...args);
        },
        publish: (...args) => {
          if (delay) set({ clock }, t("12:00:04"));
          return memory.publish(...args);
        },
        recover: () => memory.recover(),
      };
    });
    unwrap(f.engine.ingest(f.streamId, observation(t("10:00:05"), 1)));
    evidence(f, f.clock.now());
    delay = true;
    const id = unwrap(f.engine.publishWindow(f.streamId, "M1", t("10:00:00"), true));
    expect(f.engine.readRevision(id)).toMatchObject({
      computedAt: t("12:00:00"),
      committedAt: t("12:00:02"),
      publishedAt: t("12:00:04"),
      availableAt: t("12:00:04"),
    });
    expect(
      unwrap(
        f.engine.snapshot({
          streamId: f.streamId,
          timeframes: ["M1"],
          asOf: f.clock.now(),
          cutoff: t("12:00:03"),
        }),
      ).selected,
    ).toEqual({});
    expect(
      unwrap(
        f.engine.snapshot({
          streamId: f.streamId,
          timeframes: ["M1"],
          asOf: f.clock.now(),
          cutoff: f.clock.now(),
        }),
      ).selected.M1!.revisionId,
    ).toBe(id);
  });
  it("stable operation retries and duplicate publication preserve original timestamps", () => {
    const f = fixture(["M1"]);
    const stored = unwrap(f.repository.recover())!;
    set(f, t("12:00:05"));
    expect(
      unwrap(f.repository.commit(stored.operationId, stored.checkpoint, stored.newRevisionIds))
        .committedAt,
    ).toBe(stored.committedAt);
    expect(unwrap(f.repository.publish(stored.operationId)).publishedAt).toBe(stored.publishedAt);
    expect(unwrap(f.repository.recover())!.checkpoint.generation).toBe(
      stored.checkpoint.generation,
    );
  });
});
