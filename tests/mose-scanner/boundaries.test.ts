import { beforeAll, it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateAuthorityRegistry } from "@ate/persistence";
import {
  MultiSpeedScannerRuntime,
  FilesystemScanRepository,
  fingerprint,
  failure,
  bytes,
  boundedClone,
  type ScannerCheckpoint,
} from "@ate/mose-scanner";
import { fixture, owners, take } from "./fixtures.js";
let base: Awaited<ReturnType<typeof owners>>;
beforeAll(async () => {
  base = await owners();
});
for (const [name, response] of [
  ["missing discriminator", () => ({ error: { code: "DISK", commitment: "NONE" } })],
  ["string discriminator", () => ({ ok: "false", error: { code: "DISK", commitment: "NONE" } })],
  ["numeric discriminator", () => ({ ok: 0, error: { code: "DISK", commitment: "NONE" } })],
  ["missing error", () => ({ ok: false })],
  ["null error", () => ({ ok: false, error: null })],
  ["missing code", () => ({ ok: false, error: { commitment: "NONE" } })],
  ["numeric code", () => ({ ok: false, error: { code: 7, commitment: "NONE" } })],
  ["empty code", () => ({ ok: false, error: { code: "", commitment: "NONE" } })],
  ["missing commitment", () => ({ ok: false, error: { code: "DISK" } })],
  ["invalid commitment", () => ({ ok: false, error: { code: "DISK", commitment: "ACK" } })],
  [
    "contradictory negative",
    () => ({ ok: false, value: {}, error: { code: "DISK", commitment: "NONE" } }),
  ],
  [
    "throwing commitment",
    () => ({
      ok: false,
      error: {
        code: "DISK",
        get commitment() {
          throw Error("native getter");
        },
      },
    }),
  ],
] as const)
  it(`malformed native repository ${name} retains uncertainty`, async () => {
    const f = await fixture(base);
    await f.plan();
    take(await f.start());
    f.ports.repository = {
      load: () => f.repository.load(),
      commit: () => Promise.resolve(response() as never),
    };
    expect(await f.scanner.request(f.trigger())).toMatchObject({
      ok: false,
      error: { commitment: "UNKNOWN" },
    });
    expect(f.scanner.diagnostics().uncertainty).not.toBeNull();
    expect(f.scanner.coverage().uniqueObligations).toBe(0);
  });
for (const representation of ["array", "inherited", "null-prototype"] as const)
  it(`valid structural ${representation} NONE remains usable`, async () => {
    const f = await fixture(base);
    await f.plan();
    take(await f.start());
    const response = { ok: false, error: { code: "DISK", commitment: "NONE" } };
    let native: unknown;
    if (representation === "array") native = Object.assign([], response);
    else if (representation === "inherited") native = Object.create(response);
    else native = Object.assign(Object.create(null) as object, response);
    f.ports.repository = {
      load: () => f.repository.load(),
      commit: () => Promise.resolve(native as never),
    };
    expect(await f.scanner.request(f.trigger())).toMatchObject({
      ok: false,
      error: { commitment: "NONE" },
    });
    expect(f.scanner.diagnostics().uncertainty).toBeNull();
  });
it("bounded raw inputs reject proxy without invoking accessors", () => {
  let calls = 0;
  const proxy = new Proxy(
    {},
    {
      get() {
        calls++;
        return 1;
      },
    },
  );
  expect(() => boundedClone(proxy, 1024, 5)).toThrow();
  expect(calls).toBe(0);
});
it("bounded raw inputs reject circular graph", () => {
  const x: { self?: unknown } = {};
  x.self = x;
  expect(() => boundedClone(x, 1024, 5)).toThrow();
});
it("bounded raw inputs reject hostile accessor before invocation", () => {
  let calls = 0;
  expect(() =>
    boundedClone(
      {
        get id() {
          calls++;
          return "x";
        },
      },
      1024,
      5,
    ),
  ).toThrow();
  expect(calls).toBe(0);
});
it("raw input depth exact bound accepted and one-over refused", () => {
  expect(boundedClone({ a: { b: 1 } }, 1024, 2)).toEqual({ a: { b: 1 } });
  expect(() => boundedClone({ a: { b: { c: 1 } } }, 1024, 2)).toThrow("INPUT_DEPTH");
});
it("raw input serialized byte boundary enforces escape expansion", () => {
  const raw = { x: '"'.repeat(20) };
  expect(() => boundedClone(raw, 30, 5)).toThrow("INPUT_BOUNDS");
});
it("missing state owner cannot initialize ready", async () => {
  const f = await fixture(base);
  const s = new MultiSpeedScannerRuntime({
    ...f.ports,
    authority: new StateAuthorityRegistry(f.clock),
  });
  expect((await s.initialize()).ok).toBe(false);
  expect(s.diagnostics().readiness).toBe("NOT_READY");
});
it("start is repeatable without a duplicate checkpoint", async () => {
  const f = await fixture(base);
  await f.plan();
  take(await f.start());
  const before = take(await f.repository.load()).length;
  take(await f.start());
  expect(take(await f.repository.load())).toHaveLength(before);
});
it("duplicate event with a different request id cannot inflate work when coalescing disabled", async () => {
  const f = await fixture(base, { coalescing: "DISABLED" });
  await f.plan();
  take(await f.start());
  const t = f.trigger();
  take(await f.scanner.request(t));
  expect(take(await f.scanner.request({ ...t, id: "new-request" }))).toMatchObject({
    disposition: "SKIPPED",
    reason: "DUPLICATE_REQUEST",
  });
  expect(f.scanner.coverage().uniqueObligations).toBe(1);
});
it("onEvent identifies actual dependent work without caller-supplied evidence", async () => {
  const f = await fixture(base);
  await f.plan();
  take(await f.start());
  const r = take(await f.scanner.onEvent("session-A", f.universe.plan[0]!.eventId, f.clock.now()));
  expect(r.results).toHaveLength(1);
  expect(f.scanner.coverage().pending).toBe(1);
});
it("onEvent rejects nonexistent canonical event", async () => {
  const f = await fixture(base);
  await f.plan();
  take(await f.start());
  expect((await f.scanner.onEvent("session-A", "forged", f.clock.now())).ok).toBe(false);
});
it("owner call limit is actually enforced without discarding pending work", async () => {
  const f = await fixture(base, { maxOwnerCalls: 4, maxBatch: 1 });
  await f.plan();
  take(await f.start());
  const t = f.trigger();
  take(await f.scanner.request(t));
  take(await f.scanner.dispatch("limited", 1));
  expect(f.scanner.diagnostics().ownerCallsLastOperation).toBe(4);
  expect(f.scanner.coverage().pending).toBe(1);
});
it("historical scanner query cannot read a future boundary", async () => {
  const f = await fixture(base);
  await f.plan();
  expect(f.scanner.queryHistory("2099-01-01T00:00:00.000Z").ok).toBe(false);
});
it("read-only historical query explicitly denies current authority", async () => {
  const f = await fixture(base);
  await f.plan();
  expect(take(f.scanner.queryHistory(f.clock.now(), 0, 1)).scope).toBe(
    "HISTORICAL_CHECKPOINTS_NOT_CURRENT_AUTHORITY",
  );
});
it("actual filesystem journal round-trips canonical checkpoint bytes", async () => {
  const f = await fixture(base);
  await f.plan();
  const c = take(await f.repository.load())[0] as ScannerCheckpoint,
    dir = await mkdtemp(join(tmpdir(), "scanner-disk-")),
    repo = new FilesystemScanRepository(dir, f.policy);
  take(await repo.commit(c));
  expect(take(await repo.load())).toEqual([c]);
  expect(Buffer.byteLength(await readFile(join(dir, "generation-00000001.json"), "utf8"))).toBe(
    bytes(c),
  );
});
it("physical retained bytes exact capacity succeeds and one-byte-over fails", async () => {
  const f = await fixture(base);
  await f.plan();
  const c = structuredClone(take(await f.repository.load())[0]) as ScannerCheckpoint;
  c.operation.payload = { padding: "x".repeat(5000) };
  const { fingerprint: _old, ...body } = c;
  c.fingerprint = fingerprint(body);
  const exact = bytes(c),
    a = await mkdtemp(join(tmpdir(), "scanner-exact-")),
    b = await mkdtemp(join(tmpdir(), "scanner-over-"));
  take(await new FilesystemScanRepository(a, { ...f.policy, maxRetainedBytes: exact }).commit(c));
  expect(
    (await new FilesystemScanRepository(b, { ...f.policy, maxRetainedBytes: exact - 1 }).commit(c))
      .ok,
  ).toBe(false);
});
it("physical history gap fails closed", async () => {
  const f = await fixture(base);
  await f.plan();
  const c = take(await f.repository.load())[0],
    dir = await mkdtemp(join(tmpdir(), "scanner-gap-"));
  await writeFile(join(dir, "generation-00000002.json"), JSON.stringify(c));
  expect((await new FilesystemScanRepository(dir, f.policy).load()).ok).toBe(false);
});
it("physical symbolic-link record fails closed", async () => {
  const f = await fixture(base);
  await f.plan();
  const dir = await mkdtemp(join(tmpdir(), "scanner-link-")),
    file = join(await mkdtemp(join(tmpdir(), "scanner-target-")), "outside.json");
  await writeFile(file, JSON.stringify(take(await f.repository.load())[0]));
  await symlink(file, join(dir, "generation-00000001.json"));
  expect((await new FilesystemScanRepository(dir, f.policy).load()).ok).toBe(false);
});
it("source health remains separate from historical completed work", async () => {
  const f = await fixture(base);
  await f.plan();
  take(await f.start());
  take(await f.scanner.request(f.trigger()));
  take(await f.scanner.dispatch("first", 1));
  f.mose.ports.replayEvidence = () => undefined;
  const health = take(await f.scanner.health());
  expect(health.health).toBe("DEGRADED");
  expect(f.scanner.coverage().completed).toBe(1);
});
it("noncanonical physical JSON cannot hide duplicate keys or extra retained bytes", async () => {
  const f = await fixture(base);
  await f.plan();
  const c = take(await f.repository.load())[0] as ScannerCheckpoint,
    dir = await mkdtemp(join(tmpdir(), "scanner-noncanonical-"));
  await writeFile(join(dir, "generation-00000001.json"), JSON.stringify(c, null, 2));
  expect((await new FilesystemScanRepository(dir, f.policy).load()).ok).toBe(false);
});
it("historical completion cannot substitute a different genuine source observation", async () => {
  const f = await fixture(base);
  await f.plan();
  take(await f.start());
  for (let i = 0; i < 2; i++) {
    take(await f.scanner.request(f.trigger(i)));
    take(await f.scanner.dispatch("complete-" + i, 1));
  }
  const records = structuredClone(take(await f.repository.load())) as ScannerCheckpoint[];
  const last = records.at(-1)!;
  last.state.work[0]!.observationId = last.state.work[1]!.observationId;
  const { fingerprint: _old, ...body } = last;
  last.fingerprint = fingerprint(body);
  const s = new MultiSpeedScannerRuntime({
    ...f.ports,
    repository: {
      load: () => Promise.resolve({ ok: true, value: records }),
      commit: () => Promise.resolve({ ok: false, error: { code: "NO_WRITE", commitment: "NONE" } }),
    },
  });
  expect((await s.initialize()).ok).toBe(false);
});
it("bar native content substitution fails even with identical source IDs and artifact labels", async () => {
  const f = await fixture(base),
    { seed } = await import("./bar-helper.js"),
    { marketObservationSchema } = await import("@ate/domain");
  const b = await seed(f, (input) => {
    const o = input.observation;
    if (o.observationKind !== "QUOTE") throw Error("EXPECTED_QUOTE_FIXTURE");
    return {
      ...input,
      observation: marketObservationSchema.parse({
        ...o,
        bid: { ...o.bid, value: "999" },
        ask: { ...o.ask, value: "999" },
      }),
    };
  });
  b.publish("M15");
  await f.plan([f.subscription({ mode: "BAR_CLOSE", streamId: b.streamId })]);
  take(await f.start());
  expect(f.scanner.preview("ticks", f.clock.now())).toMatchObject({
    ok: false,
    error: { code: "SOURCE_MISMATCH" },
  });
});
it("native negative discriminator is sampled once", async () => {
  const f = await fixture(base);
  await f.plan();
  take(await f.start());
  let reads = 0;
  f.ports.repository = {
    load: () => f.repository.load(),
    commit: () =>
      Promise.resolve({
        get ok() {
          reads++;
          return reads === 1 ? false : true;
        },
        error: { code: "DISK", commitment: "NONE" },
      } as never),
  };
  expect(await f.scanner.request(f.trigger())).toMatchObject({
    ok: false,
    error: { commitment: "NONE" },
  });
  expect(reads).toBe(1);
});
it("duplicate configuration JSON keys are rejected before value erasure", async () => {
  const { parsePolicyJson } = await import("@ate/mose-scanner");
  expect(() => parsePolicyJson('{"cadence":1,"cadence":999}')).toThrow("DUPLICATE_JSON_KEY");
  expect(() => parsePolicyJson('{"actor":"valid","\\u0061ctor":"forged"}')).toThrow(
    "DUPLICATE_JSON_KEY",
  );
  expect(parsePolicyJson('{"a":{"x":1},"b":{"x":2}}')).toEqual({ a: { x: 1 }, b: { x: 2 } });
});
it("recovered historical completion is NOT_READY until current source recheck", async () => {
  const f = await fixture(base);
  await f.plan();
  take(await f.start());
  take(await f.scanner.request(f.trigger()));
  take(await f.scanner.dispatch("one", 1));
  const recovered = new MultiSpeedScannerRuntime(f.ports);
  take(await recovered.initialize());
  expect(recovered.diagnostics()).toMatchObject({ health: "DEGRADED", readiness: "NOT_READY" });
  expect(take(await recovered.health())).toMatchObject({ health: "HEALTHY", readiness: "READY" });
});
it("STOPPING cannot be reported READY after drain and before final stop", async () => {
  const f = await fixture(base);
  await f.plan();
  take(await f.start());
  take(await f.scanner.request(f.trigger()));
  expect((await f.scanner.stop()).ok).toBe(false);
  take(await f.scanner.dispatch("drain", 1));
  expect(f.scanner.diagnostics()).toMatchObject({ readiness: "NOT_READY", lifecycle: "STOPPING" });
  take(await f.scanner.stop());
});
it("caller-only plan cannot bypass governed configuration", async () => {
  const f = await fixture(base);
  const { config } = await import("./fixtures.js");
  f.setConfiguration(
    await config(f.clock, f.policy, { ...f.configuredPlan(), id: "separately-configured-plan" }),
  );
  const result = await f.scanner.createPlan("unconfigured", {
    id: "plan",
    dependencies: [{ id: "source", parents: [] }],
    subscriptions: [f.subscription()],
  });
  expect(result).toMatchObject({ ok: false, error: { code: "PLAN_NOT_GOVERNED" } });
  expect(take(await f.repository.load())).toHaveLength(0);
});
it("configured plan fingerprint rejects a different cadence or priority", async () => {
  const f = await fixture(base),
    plan = {
      id: "plan",
      dependencies: [{ id: "source", parents: [] }],
      subscriptions: [f.subscription()],
    };
  const { config } = await import("./fixtures.js");
  f.setConfiguration(await config(f.clock, f.policy, plan));
  const result = await f.scanner.createPlan("substitute", {
    ...plan,
    subscriptions: [f.subscription({ priority: 99 })],
  });
  expect(result).toMatchObject({ ok: false, error: { code: "PLAN_NOT_GOVERNED" } });
  expect(take(await f.repository.load())).toHaveLength(0);
});
it("plan checkpoint binds the actual configuration-owner fingerprint", async () => {
  const f = await fixture(base);
  await f.plan();
  const checkpoint = take(await f.repository.load())[0] as ScannerCheckpoint;
  expect(checkpoint.configuration).toBe(f.ports.configuration().fingerprint);
  expect(take(await f.scanner.configure()).planFingerprint).toBe(
    fingerprint(checkpoint.state.plan),
  );
});
it("config callback reentrancy cannot fabricate current readiness or poison lock", async () => {
  const f = await fixture(base);
  await f.plan();
  const provider = f.ports.configuration;
  let nested: ReturnType<typeof f.scanner.diagnostics> | undefined;
  f.ports.configuration = () => {
    nested = f.scanner.diagnostics();
    return provider();
  };
  take(await f.scanner.configure());
  expect(nested?.readiness).toBe("NOT_READY");
  f.ports.configuration = provider;
  take(await f.start());
});
it("changed current configuration cannot leave historical completion READY", async () => {
  const f = await fixture(base);
  await f.plan();
  take(await f.start());
  take(await f.scanner.request(f.trigger()));
  take(await f.scanner.dispatch("complete", 1));
  const { config } = await import("./fixtures.js");
  f.setConfiguration(
    await config(f.clock, { ...f.policy, version: "unaccepted-current" }, f.configuredPlan()),
  );
  expect(f.scanner.diagnostics()).toMatchObject({ readiness: "NOT_READY", health: "DEGRADED" });
  expect(f.scanner.coverage().completed).toBe(1);
});
it("fresh post-recovery qualification enables new cache without trusting historical cache", async () => {
  const f = await fixture(base);
  await f.plan([f.subscription({ mode: "SECONDS", cadenceMs: 1 })]);
  take(await f.start());
  for (let i = 0; i < f.universe.plan.length; i++) take(await f.mose.receive(i));
  take(await f.mose.process());
  const t = f.trigger(0, "ticks", "DEADLINE");
  take(await f.scanner.request(t));
  take(await f.scanner.dispatch("old", 1));
  const recovered = new MultiSpeedScannerRuntime(f.ports);
  take(await recovered.initialize());
  expect(recovered.diagnostics().currentAuthenticatedCacheEntries).toBe(0);
  const { durationMs } = await import("@ate/time");
  take(f.clock.advanceBy(durationMs(1)));
  const first = take(
    await recovered.request({ ...t, id: "fresh-qualified", boundary: f.clock.now() }),
  );
  expect(first.disposition).toBe("DUE");
  take(await recovered.dispatch("qualify", 1));
  expect(recovered.diagnostics().currentAuthenticatedCacheEntries).toBe(1);
  take(f.clock.advanceBy(durationMs(1)));
  expect(
    take(await recovered.request({ ...t, id: "current-cache", boundary: f.clock.now() })).reason,
  ).toBe("UNCHANGED_DEPENDENCIES");
});
it("native history discriminator and selected array are sampled once", async () => {
  const f = await fixture(base);
  await f.plan();
  const records = take(await f.repository.load());
  let discriminator = 0,
    valueReads = 0;
  const s = new MultiSpeedScannerRuntime({
    ...f.ports,
    repository: {
      load: () =>
        Promise.resolve({
          get ok() {
            discriminator++;
            return true;
          },
          get value() {
            valueReads++;
            return valueReads === 1 ? records : [];
          },
        } as never),
      commit: () => Promise.resolve(failure("NO_WRITE")),
    },
  });
  take(await s.initialize());
  expect(discriminator).toBe(1);
  expect(valueReads).toBe(1);
  expect(take(s.queryHistory(f.clock.now(), 0, 1)).total).toBe(1);
});
it("history array accessors cannot bypass recovery limits", async () => {
  const f = await fixture(base);
  await f.plan();
  let reads = 0;
  const rows: unknown[] = [];
  Object.defineProperty(rows, "0", {
    get() {
      reads++;
      return take(f.scanner.queryHistory(f.clock.now(), 0, 1)).records[0];
    },
    enumerable: true,
  });
  const s = new MultiSpeedScannerRuntime({
    ...f.ports,
    repository: {
      load: () => Promise.resolve({ ok: true, value: rows }),
      commit: () => Promise.resolve(failure("NO_WRITE")),
    },
  });
  expect((await s.initialize()).ok).toBe(false);
  expect(reads).toBe(0);
});
