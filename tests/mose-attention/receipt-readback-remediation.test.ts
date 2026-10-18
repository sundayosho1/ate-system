import { beforeAll, expect, it } from "vitest";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FilesystemScanRepository,
  MultiSpeedScannerRuntime,
  checkpointSchema as scannerCheckpointSchema,
} from "@ate/mose-scanner";
import {
  AdaptiveSurveillanceRuntime,
  FilesystemAttentionRepository,
  fail,
  ok,
  checkpointSchema,
  snapshotScanReceipt,
  type AttentionPolicy,
} from "@ate/mose-attention";
import { fixture, owners, checker, take } from "./fixtures.js";
let base: Awaited<ReturnType<typeof owners>>;
beforeAll(async () => {
  base = await owners();
});
async function setup(changes: Partial<AttentionPolicy> = {}) {
  const f = await fixture(
    base,
    {
      submissionEnabled: true,
      actor: checker.actorId,
      maxQueryResults: 2,
      maxQueryPages: 2,
      ...changes,
    },
    undefined,
    undefined,
    1,
  );
  const parent = process.env.ATE_READBACK_EVIDENCE_ROOT ?? tmpdir();
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "attention-readback-"));
  const storage = new FilesystemAttentionRepository(join(root, "attention"), f.policy);
  const scannerStorage = new FilesystemScanRepository(join(root, "scanner"), f.scanner.policy);
  for (const cp of take(await f.repository.load()))
    take(await storage.commit(checkpointSchema.parse(cp)));
  for (const cp of take(await f.scanner.repository.load()))
    take(await scannerStorage.commit(scannerCheckpointSchema.parse(cp)));
  f.ports.repository = storage;
  f.scanner.ports.repository = scannerStorage;
  take(await f.assess());
  const allocated = take(await f.allocate());
  const rec = allocated.state.recommendations[0]!;
  return {
    ...f,
    storage,
    scannerStorage,
    root,
    rec,
    fresh: () => new AdaptiveSurveillanceRuntime({ ...f.ports, repository: storage }),
  };
}
type F = Awaited<ReturnType<typeof setup>>;
const submit = (f: F, id = "submit", runtime = f.runtime) =>
  runtime.dispatch({ kind: "SUBMIT", id, recommendationId: f.rec.id });
const reconcile = (f: F, runtime = f.runtime) =>
  runtime.dispatch({ kind: "RECONCILE", id: "reconcile", recommendationId: f.rec.id });
async function prefill(f: F, count = 1) {
  const preview = take(f.ports.scanner.preview("rescan", f.clock.now()));
  for (let i = 0; i < count; i++)
    take(
      await f.ports.scanner.request({
        id: "prefill-" + i,
        subscriptionId: "rescan",
        boundary: f.clock.now(),
        kind: "RESEARCH_RESCAN",
        actor: checker.actorId,
        cause: preview.cause,
        evidence: preview.evidence,
      }),
    );
}
const malformed = [
  "oversized",
  "later-oversized",
  "non-array",
  "negative-total",
  "fractional-total",
  "missing-total",
  "short-page",
  "bad-after-match",
  "invalid-reason",
  "duplicate-after-match",
  "conflict-after-match",
  "throwing-requests",
  "changing-invalid-first",
  "owner-outage",
  "owner-timeout",
] as const;
for (const stage of ["SUBMIT", "RECONCILE", "RECOVER"] as const)
  for (const mode of malformed) {
    it(`${stage} rejects the entire malformed page: ${mode}`, async () => {
      const f = await setup(mode === "later-oversized" ? { maxQueryResults: 1 } : {});
      if (mode === "later-oversized") await prefill(f);
      const request = f.ports.scanner.request.bind(f.ports.scanner);
      const query = f.ports.scanner.query.bind(f.ports.scanner);
      let armed = false;
      f.ports.scanner.request = async (payload) => {
        const receipt = await request(payload);
        if (stage === "SUBMIT") armed = true;
        return stage === "RECONCILE" ? fail("LOST_ACK", "UNKNOWN") : receipt;
      };
      f.ports.scanner.query = (offset, limit) => {
        const actual = query(offset, limit);
        if (!armed || (mode === "later-oversized" && offset === 0)) return actual;
        if (mode === "owner-outage") return fail("OWNER_OFFLINE");
        if (mode === "owner-timeout") throw Error("OWNER_TIMEOUT");
        const page = JSON.parse(JSON.stringify(take(actual))) as Record<string, unknown>;
        const receipts = page.requests as Record<string, unknown>[];
        const first = receipts[0]!;
        if (mode === "oversized" || mode === "later-oversized")
          page.requests = [...receipts, first, first];
        if (mode === "non-array") page.requests = { 0: first, length: 1 };
        if (mode === "negative-total") page.totalRequests = -1;
        if (mode === "fractional-total") page.totalRequests = 1.5;
        if (mode === "missing-total") delete page.totalRequests;
        if (mode === "short-page") page.totalRequests = 2;
        if (mode === "bad-after-match") {
          page.requests = [first, null];
          page.totalRequests = 2;
        }
        if (mode === "invalid-reason") first.reason = 8;
        if (mode === "duplicate-after-match") {
          page.requests = [first, first];
          page.totalRequests = 2;
        }
        if (mode === "conflict-after-match") {
          page.requests = [first, { ...first, reason: "CONFLICT" }];
          page.totalRequests = 2;
        }
        if (mode === "throwing-requests")
          Object.defineProperty(page, "requests", {
            get() {
              throw Error("HOSTILE_GETTER");
            },
          });
        if (mode === "changing-invalid-first") {
          let reads = 0;
          Object.defineProperty(page, "requests", {
            get() {
              return reads++ === 0 ? null : receipts;
            },
          });
        }
        // Intentional native query-boundary injection. Real receipt existence is filesystem-backed.
        return ok(page) as ReturnType<typeof query>;
      };
      if (stage !== "SUBMIT") {
        take(await submit(f));
        armed = true;
      }
      const before = take(await f.storage.load());
      if (stage === "SUBMIT") {
        const cp = take(await submit(f));
        expect(cp.state.recommendations[0]).toMatchObject({
          status: "UNRESOLVED",
          receiptId: null,
        });
        expect(cp.state.floors[0]!.settledBy).toBeNull();
        expect(f.runtime.diagnostics()).toMatchObject({
          readiness: "NOT_READY",
          pendingSubmissions: 1,
          floorDebt: 1,
        });
        expect((await f.runtime.stop()).ok).toBe(false);
      } else if (stage === "RECONCILE") {
        expect((await reconcile(f)).ok).toBe(false);
        expect(take(await f.storage.load())).toEqual(before);
        expect(f.runtime.diagnostics()).toMatchObject({
          readiness: "NOT_READY",
          pendingSubmissions: 1,
          floorDebt: 1,
        });
      } else {
        const fresh = f.fresh();
        expect((await fresh.initialize()).ok).toBe(false);
        expect(fresh.diagnostics().readiness).toBe("NOT_READY");
        expect((await fresh.stop()).ok).toBe(false);
        expect(take(await f.storage.load())).toEqual(before);
      }
      f.ports.scanner.query = query;
      const restored = f.fresh();
      take(await restored.initialize());
      if (stage !== "RECOVER") take(await reconcile(f, restored));
      expect(restored.diagnostics().settledFloors).toBe(1);
      expect((await restored.stop()).ok).toBe(true);
    });
  }
for (const [size, pages, earlier] of [
  [1, 1, 0],
  [1, 2, 1],
  [2, 2, 3],
  [1, 1, 1],
  [2, 1, 2],
] as const) {
  it(`honest physical page capacity size=${size} pages=${pages} earlier=${earlier}`, async () => {
    const f = await setup({ maxQueryResults: size, maxQueryPages: pages });
    await prefill(f, earlier);
    const cp = take(await submit(f));
    const reachable = earlier + 1 <= size * pages;
    expect(cp.state.recommendations[0]!.status).toBe(reachable ? "ADMITTED" : "UNRESOLVED");
    const scanner = new MultiSpeedScannerRuntime({
      ...f.scanner.ports,
      repository: f.scannerStorage,
    });
    take(await scanner.initialize());
    f.ports.scanner = scanner;
    for (let i = 0; i < 2; i++) {
      const fresh = f.fresh();
      take(await fresh.initialize());
      expect(fresh.diagnostics().settledFloors).toBe(reachable ? 1 : 0);
      expect((await fresh.stop()).ok).toBe(reachable);
    }
  });
}
it("genuine publication with interrupted local outcome reconciles exact original identity", async () => {
  const f = await setup();
  f.ports.repository = {
    load: () => f.storage.load(),
    commit: async (cp) =>
      cp.command.id.endsWith(".outcome") ? fail("LOCAL_NONE") : f.storage.commit(cp),
  };
  expect((await submit(f)).ok).toBe(false);
  const originalScanner = take(await f.scannerStorage.load());
  const fresh = f.fresh();
  take(await fresh.initialize());
  const cp = take(await reconcile(f, fresh));
  expect(cp.state.recommendations[0]!.receiptId).toBe(cp.state.recommendations[0]!.payload!.id);
  expect(take(await f.scannerStorage.load())).toEqual(originalScanner);
  expect((await fresh.stop()).ok).toBe(true);
});
for (const selected of ["requests", "totalRequests", "trigger"] as const) {
  it(`selected query field ${selected} is captured once`, async () => {
    const f = await setup();
    const request = f.ports.scanner.request.bind(f.ports.scanner),
      query = f.ports.scanner.query.bind(f.ports.scanner);
    let armed = false,
      reads = 0;
    f.ports.scanner.request = async (p) => {
      const receipt = await request(p);
      armed = true;
      return receipt;
    };
    f.ports.scanner.query = (o, l) => {
      const actual = query(o, l);
      if (!armed) return actual;
      const page = JSON.parse(JSON.stringify(take(actual))) as Record<string, unknown>;
      const record = (page.requests as Record<string, unknown>[])[0]!;
      const target = selected === "trigger" ? record : page;
      const value = target[selected];
      Object.defineProperty(target, selected, {
        get() {
          return ++reads === 1 ? value : null;
        },
      });
      return ok(page) as ReturnType<typeof query>;
    };
    const cp = take(await submit(f));
    expect(cp.state.recommendations[0]!.status).toBe("ADMITTED");
    expect(reads).toBe(1);
    f.ports.scanner.query = query;
    take(await f.fresh().initialize());
  });
}
for (const mode of [
  "oversized-bytes",
  "proxy-array",
  "huge-total",
  "empty-collection",
  "inert-metadata",
  "custom-iterator",
] as const) {
  it(`bounded selected receipt-page resources: ${mode}`, async () => {
    const f = await setup();
    const request = f.ports.scanner.request.bind(f.ports.scanner),
      query = f.ports.scanner.query.bind(f.ports.scanner);
    let armed = false;
    f.ports.scanner.request = async (p) => {
      const receipt = await request(p);
      armed = true;
      return receipt;
    };
    f.ports.scanner.query = (o, l) => {
      const actual = query(o, l);
      if (!armed) return actual;
      const page = JSON.parse(JSON.stringify(take(actual))) as Record<string, unknown>;
      const requests = page.requests as Record<string, unknown>[];
      if (mode === "oversized-bytes")
        requests[0]!.reason = "x".repeat(f.policy.maxCheckpointBytes + 1);
      if (mode === "proxy-array") page.requests = new Proxy(requests, {});
      if (mode === "huge-total") page.totalRequests = Number.MAX_SAFE_INTEGER;
      if (mode === "empty-collection") {
        page.requests = [];
        page.totalRequests = 0;
      }
      if (mode === "inert-metadata")
        Object.defineProperty(page, "unrelated", {
          get() {
            throw Error("MUST_NOT_READ");
          },
        });
      if (mode === "custom-iterator")
        Object.defineProperty(requests, Symbol.iterator, {
          value() {
            throw Error("MUST_NOT_ITERATE_RAW");
          },
        });
      return ok(page) as ReturnType<typeof query>;
    };
    const cp = take(await submit(f));
    const valid = mode === "inert-metadata" || mode === "custom-iterator";
    expect(cp.state.recommendations[0]!.status).toBe(valid ? "ADMITTED" : "UNRESOLVED");
    expect(f.runtime.diagnostics().floorDebt).toBe(valid ? 0 : 1);
    f.ports.scanner.query = query;
    const fresh = f.fresh();
    take(await fresh.initialize());
    if (!valid) take(await reconcile(f, fresh));
    expect(fresh.diagnostics().settledFloors).toBe(1);
  });
}
it("NONE refund and same-floor aggregate retry budget survive physical restart", async () => {
  const f = await setup();
  let calls = 0;
  f.ports.scanner.request = () => {
    calls++;
    return Promise.resolve(fail("NONE"));
  };
  take(await submit(f, "one"));
  take(await submit(f, "two"));
  const fresh = f.fresh();
  take(await fresh.initialize());
  take(await fresh.dispatch({ kind: "ALLOCATE", id: "again", asOf: f.clock.now(), limit: 1 }));
  const state = take(fresh.query(0, 2)).state,
    rec = state.recommendations.at(-1)!;
  expect((await fresh.dispatch({ kind: "SUBMIT", id: "third", recommendationId: rec.id })).ok).toBe(
    false,
  );
  expect(calls).toBe(2);
  expect(fresh.diagnostics().floorDebt).toBe(1);
});
it("invalid public query offset cannot publish or conceal an unresolved obligation", async () => {
  const f = await setup();
  f.ports.scanner.request = () => Promise.resolve(fail("UNKNOWN", "UNKNOWN"));
  take(await submit(f));
  const before = take(await f.storage.load());
  expect(f.runtime.query(-1, 1).ok).toBe(false);
  expect(take(await f.storage.load())).toEqual(before);
  expect((await f.runtime.stop()).ok).toBe(false);
});
for (const delta of [-1, 0, 1]) {
  it(`canonical genuine receipt bytes at measured boundary ${delta}`, async () => {
    const f = await setup();
    take(await submit(f));
    const receipt = take(f.ports.scanner.query(0, 2)).requests[0]!;
    const measured = Buffer.byteLength(JSON.stringify(receipt));
    const read = () => snapshotScanReceipt(receipt, measured + delta, 20);
    if (delta < 0) expect(read).toThrow();
    else expect(read()).toEqual(receipt);
  });
}
for (const depth of [1, 2, 3]) {
  it(`genuine selected receipt depth at boundary ${depth}`, async () => {
    const f = await setup();
    take(await submit(f));
    const receipt = take(f.ports.scanner.query(0, 2)).requests[0]!;
    const read = () => snapshotScanReceipt(receipt, f.policy.maxCheckpointBytes, depth);
    if (depth < 2) expect(read).toThrow("INPUT_DEPTH");
    else expect(read()).toEqual(receipt);
  });
}
