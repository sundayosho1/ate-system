import { beforeAll, afterAll, it, expect } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { durationMs } from "@ate/time";
import {
  FilesystemScanRepository,
  MultiSpeedScannerRuntime,
  defaultScannerPolicy,
  failure,
  checkedCheckpoint,
  fingerprint,
  type ScanSubscription,
  type ScannerPolicy,
  type ScanTrigger,
} from "@ate/mose-scanner";
import { fixture, owners, take } from "./fixtures.js";
let base: Awaited<ReturnType<typeof owners>>;
const roots: string[] = [];
beforeAll(async () => {
  base = await owners();
});
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});
async function setup(
  mode: "SECONDS" | "SCHEDULE" = "SECONDS",
  policy: Partial<ScannerPolicy> = {},
  cadence = 10,
  patch: Partial<ScanSubscription> = {},
  missed: "CATCH_UP" | "SKIP" = "CATCH_UP",
) {
  const root = await mkdtemp(join(tmpdir(), "scanner-cadence-"));
  roots.push(root);
  const repo = new FilesystemScanRepository(root, { ...defaultScannerPolicy, ...policy });
  const f = await fixture(base, policy, repo);
  const at = f.clock.now();
  const sub = f.subscription({
    mode,
    cadenceMs: cadence,
    ...patch,
    schedule:
      mode === "SCHEDULE"
        ? {
            id: "schedule",
            calendarFingerprint: f.calendar.fingerprint,
            end: new Date(Date.parse(at) + 1000).toISOString(),
            missed,
          }
        : null,
  });
  await f.plan([sub]);
  take(await f.start());
  const boundary = (n: number) => new Date(Date.parse(at) + n * cadence).toISOString();
  const direct = (n: number, id = "direct-" + n): ScanTrigger => ({
    id,
    subscriptionId: sub.id,
    boundary: boundary(n),
    kind: "DEADLINE",
    actor: null,
    cause: sub.schedule?.id ?? sub.id,
    evidence: take(f.scanner.preview(sub.id, boundary(n))).evidence,
  });
  const advanceTime = (n: number) => take(f.clock.advanceBy(durationMs(n * cadence)));
  const recover = async () => {
    const service = new MultiSpeedScannerRuntime({
      ...f.ports,
      repository: new FilesystemScanRepository(root, f.policy),
    });
    take(await service.initialize());
    return service;
  };
  const receipts = (service = f.scanner) =>
    take(service.query(0, 100)).requests.map((q) => q.trigger.boundary);
  return { ...f, root, sub, boundary, direct, advanceTime, recover, receipts };
}
for (const mode of ["SECONDS", "SCHEDULE"] as const) {
  for (const variant of ["first", "late", "prefix-before-late", "reverse", "duplicate"] as const) {
    it(`prefix ${mode} ${variant}: direct requests cannot certify missing slots`, async () => {
      const f = await setup(mode);
      f.advanceTime(2);
      if (variant === "first") take(await f.scanner.request(f.direct(0)));
      if (variant === "late") take(await f.scanner.request(f.direct(2)));
      if (variant === "prefix-before-late")
        for (const n of [0, 1, 2]) take(await f.scanner.request(f.direct(n)));
      if (variant === "reverse") for (const n of [2, 0]) take(await f.scanner.request(f.direct(n)));
      if (variant === "duplicate") {
        const t = f.direct(2);
        take(await f.scanner.request(t));
        take(await f.scanner.request(t));
      }
      const before = f.receipts();
      expect(f.scanner.coverage().unrepresentedCadenceDue).toBe(3 - new Set(before).size);
      take(await f.scanner.advance());
      expect(new Set(f.receipts())).toEqual(new Set([0, 1, 2].map(f.boundary)));
      expect(f.receipts()).toHaveLength(3);
      expect(f.scanner.coverage().cadence[0]?.contiguousThrough).toBe(f.boundary(2));
    });
  }
  for (const variant of ["pending", "paused", "reverse", "lost-ack", "repeat"] as const) {
    it(`recovery ${mode} ${variant}: immutable physical receipts preserve gaps`, async () => {
      const f = await setup(mode);
      f.advanceTime(2);
      if (variant === "lost-ack") {
        f.ports.repository = {
          load: () => f.repository.load(),
          commit: async (c) => {
            take(await f.repository.commit(c));
            return failure("ACK_LOST", "UNKNOWN");
          },
        };
        expect(await f.scanner.request(f.direct(2))).toMatchObject({
          ok: false,
          error: { commitment: "UNKNOWN" },
        });
      } else take(await f.scanner.request(f.direct(2)));
      if (variant === "reverse") take(await f.scanner.request(f.direct(0)));
      if (variant === "paused") take(await f.scanner.transition("pause", "PAUSE"));
      const records = take(await f.repository.load()).map((c) => checkedCheckpoint(c, f.policy));
      const bytes = await Promise.all(
        records.map((c) =>
          readFile(
            join(f.root, `generation-${String(c.generation).padStart(8, "0")}.json`),
            "utf8",
          ),
        ),
      );
      let service = await f.recover();
      if (variant === "repeat") service = await f.recover();
      expect(service.coverage().unrepresentedCadenceDue).toBe(variant === "reverse" ? 1 : 2);
      expect(service.diagnostics().readiness).toBe("NOT_READY");
      if (variant === "paused") take(await service.transition("resume", "RESUME"));
      take(await service.advance());
      expect(new Set(f.receipts(service))).toEqual(new Set([0, 1, 2].map(f.boundary)));
      for (const [i, c] of records.entries())
        expect(
          await readFile(
            join(f.root, `generation-${String(c.generation).padStart(8, "0")}.json`),
            "utf8",
          ),
        ).toBe(bytes[i]);
    });
  }
}
for (const fault of [
  "unknown",
  "none",
  "capacity",
  "owner",
  "catchup",
  "future",
  "paused",
  "busy",
  "stop",
  "restored",
] as const) {
  it(`continuation ${fault}: due remainder and native child outcome stay truthful`, async () => {
    const f = await setup(
      "SECONDS",
      fault === "capacity" ? { maxQueue: 1 } : fault === "catchup" ? { maxCatchup: 1 } : {},
    );
    if (fault !== "future") f.advanceTime(2);
    if (["unknown", "none", "busy", "stop"].includes(fault)) {
      const repo = f.repository;
      f.ports.repository = {
        load: () => repo.load(),
        commit: async (c) => {
          if (fault === "unknown") {
            take(await repo.commit(c));
            return failure("ACK_LOST", "UNKNOWN");
          }
          if (fault === "none") return failure("WRITE_REFUSED", "NONE");
          const nested = fault === "busy" ? await f.scanner.advance() : await f.scanner.stop();
          expect(nested.ok).toBe(false);
          return repo.commit(c);
        },
      };
    }
    if (fault === "owner" || fault === "restored") take(await f.mose.service.stop());
    if (fault === "paused") take(await f.scanner.transition("pause", "PAUSE"));
    const result = await f.scanner.advance();
    if (fault === "paused") {
      expect(result.ok).toBe(false);
      expect(f.scanner.coverage().unrepresentedCadenceDue).toBe(3);
      return;
    }
    const batch = take(result);
    if (fault === "future" || fault === "busy") expect(batch.remainingNotProcessed).toBe(false);
    else expect(batch.remainingNotProcessed).toBe(true);
    if (fault === "unknown") {
      expect(batch.results[0]).toMatchObject({ ok: false, error: { commitment: "UNKNOWN" } });
      expect(f.scanner.diagnostics().uncertainty).not.toBeNull();
    }
    if (fault === "none")
      expect(batch.results[0]).toMatchObject({ ok: false, error: { commitment: "NONE" } });
    if (fault === "owner" || fault === "restored") expect(f.receipts()).toHaveLength(0);
    if (fault === "capacity") expect(f.receipts()).toHaveLength(1);
    if (fault === "restored") {
      const fresh = await f.recover();
      expect(take(await fresh.advance()).remainingNotProcessed).toBe(true);
    }
  });
}
for (const variant of [
  "missing-stop",
  "repeat-stop",
  "health",
  "drain-stop",
  "stopped-cutoff",
] as const) {
  it(`shutdown ${variant}: no successful STOP over missing cadence obligations`, async () => {
    const f = await setup();
    f.advanceTime(2);
    take(await f.scanner.request(f.direct(2)));
    if (variant === "health")
      expect(take(await f.scanner.health())).toMatchObject({
        readiness: "NOT_READY",
        health: "DEGRADED",
        unrepresentedCadenceDue: 2,
      });
    else expect((await f.scanner.stop()).ok).toBe(false);
    if (variant === "repeat-stop") expect((await f.scanner.stop()).ok).toBe(false);
    expect(f.scanner.coverage().unrepresentedCadenceDue).toBe(2);
    take(await f.scanner.advance());
    for (let i = 0; i < f.universe.plan.length; i++) take(await f.mose.receive(i));
    take(await f.mose.process());
    const work = take(await f.scanner.dispatch("drain", 3));
    expect(work.every((w) => w.status === "COMPLETED")).toBe(true);
    expect(work.every((w) => w.ownerAck && w.observationId)).toBe(true);
    take(await f.scanner.stop());
    take(await f.scanner.stop());
    if (variant === "stopped-cutoff") f.advanceTime(3);
    const fresh = await f.recover();
    expect(fresh.coverage().unrepresentedCadenceDue).toBe(0);
    take(await fresh.stop());
  });
}
for (const cadence of [1, 7, 100, 1000, 60000]) {
  it(`integration cadence ${cadence}: nonzero UTC anchor, repeated bounded catchup`, async () => {
    const f = await setup(cadence % 2 ? "SECONDS" : "SCHEDULE", { maxCatchup: 1 }, cadence);
    // SCHEDULE has an explicit endpoint; test only slots at or before that end.
    f.advanceTime(2);
    const last = Math.min(2, Math.floor(1000 / cadence));
    take(await f.scanner.request(f.direct(last)));
    let result = take(await f.scanner.advance()),
      calls = 1;
    while (result.remainingNotProcessed) {
      expect(calls++).toBeLessThan(5);
      result = take(await f.scanner.advance());
    }
    const expected = cadence % 2 ? 3 : last + 1;
    expect(f.receipts()).toHaveLength(expected);
    expect(f.scanner.coverage().unrepresentedCadenceDue).toBe(0);
  });
}
for (const variant of [
  "request-limit",
  "coalescing",
  "duplicate-ack",
  "large-jump",
  "none-retry",
] as const) {
  it(`resource ${variant}: bounded accounting retains exact obligations`, async () => {
    const f = await setup(
      "SECONDS",
      variant === "request-limit"
        ? { maxRequests: 3, maxQueue: 3 }
        : variant === "large-jump"
          ? { maxCatchup: 1 }
          : {},
    );
    f.advanceTime(variant === "large-jump" ? 1000000 : 2);
    if (variant === "none-retry") {
      f.ports.repository = {
        load: () => f.repository.load(),
        commit: () => Promise.resolve(failure("NO_WRITE", "NONE")),
      };
      expect(take(await f.scanner.advance()).remainingNotProcessed).toBe(true);
      f.ports.repository = f.repository;
    }
    if (variant === "duplicate-ack") {
      const t = f.direct(2);
      const a = take(await f.scanner.request(t));
      expect(take(await f.scanner.request(t))).toEqual(a);
    }
    const r = take(await f.scanner.advance());
    if (variant === "large-jump") {
      expect(r.remainingNotProcessed).toBe(true);
      expect(f.scanner.coverage().unrepresentedCadenceDue).toBe(1000000);
    } else {
      expect(r.remainingNotProcessed).toBe(false);
      expect(f.receipts()).toHaveLength(3);
    }
    expect(f.scanner.coverage().pending).toBeLessThanOrEqual(f.policy.maxQueue);
  });
}

it("legacy STOPPED gaps stay readable as facts but cannot grant clean shutdown", async () => {
  const f = await setup();
  f.advanceTime(2);
  take(await f.scanner.request(f.direct(2)));
  for (let i = 0; i < f.universe.plan.length; i++) take(await f.mose.receive(i));
  take(await f.mose.process());
  take(await f.scanner.dispatch("legacy-real-ack", 1));
  const rows = take(await f.repository.load()).map((c) => checkedCheckpoint(c, f.policy)),
    last = rows.at(-1)!;
  const body = {
    ...last,
    generation: last.generation + 1,
    previous: last.fingerprint,
    at: f.clock.now(),
    state: { ...last.state, phase: "STOPPED" as const },
    operation: { id: "legacy-stop", kind: "STOP", payload: null },
  };
  const { fingerprint: old, ...unsigned } = body;
  expect(old).toBe(last.fingerprint);
  take(await f.repository.commit({ ...unsigned, fingerprint: fingerprint(unsigned) }));
  const physical = take(await f.repository.load()).map((c) => checkedCheckpoint(c, f.policy));
  for (let i = 0; i < 2; i++) {
    const reader = await f.recover();
    expect(reader.coverage().unrepresentedCadenceDue).toBe(2);
    expect(reader.diagnostics()).toMatchObject({ readiness: "NOT_READY", health: "DEGRADED" });
    expect((await reader.stop()).ok).toBe(false);
    expect(take(await f.repository.load()).map((c) => checkedCheckpoint(c, f.policy))).toEqual(
      physical,
    );
  }
});
it("explicit missed schedule slots are durable dispositions that close the prefix", async () => {
  const f = await setup("SCHEDULE", {}, 10, {}, "SKIP");
  f.advanceTime(2);
  expect(take(await f.scanner.advance()).remainingNotProcessed).toBe(false);
  expect(f.scanner.coverage()).toMatchObject({
    requests: 3,
    skipped: 2,
    unrepresentedCadenceDue: 0,
  });
  const fresh = await f.recover();
  expect(fresh.coverage().cadence[0]?.contiguousThrough).toBe(f.boundary(2));
});
it("multiple subscriptions retain independent contiguous prefixes", async () => {
  const root = await mkdtemp(join(tmpdir(), "scanner-multi-prefix-"));
  roots.push(root);
  const repo = new FilesystemScanRepository(root, defaultScannerPolicy),
    f = await fixture(base, {}, repo);
  const at = f.clock.now();
  await f.plan([
    f.subscription({ id: "a", mode: "SECONDS", cadenceMs: 7 }),
    f.subscription({ id: "z", mode: "SECONDS", cadenceMs: 11 }),
  ]);
  take(await f.start());
  take(f.clock.advanceBy(durationMs(22)));
  take(await f.scanner.advance());
  expect(f.scanner.coverage().cadence.map((x) => x.requiredDue)).toEqual([4, 3]);
  expect(f.scanner.coverage().unrepresentedCadenceDue).toBe(0);
  expect(take(f.scanner.query(0, 100)).requests.every((q) => q.trigger.boundary >= at)).toBe(true);
});
it("event-only plan creates no synthetic cadence obligation", async () => {
  const root = await mkdtemp(join(tmpdir(), "scanner-event-control-"));
  roots.push(root);
  const f = await fixture(base, {}, new FilesystemScanRepository(root, defaultScannerPolicy));
  await f.plan();
  take(await f.start());
  take(f.clock.advanceBy(durationMs(1000)));
  expect(take(await f.scanner.advance()).results).toHaveLength(0);
  expect(f.scanner.coverage().cadence).toEqual([]);
  take(await f.scanner.stop());
});
