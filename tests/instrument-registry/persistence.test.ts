import type { Result } from "@ate/instrument-registry";
import { it, expect } from "vitest";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fingerprint } from "@ate/configuration";
import {
  InstrumentRegistry,
  FilesystemRegistryRepository,
  MemoryRegistryRepository,
  fail,
  ok,
  type Snapshot,
  type Repository,
} from "@ate/instrument-registry";
import { disk, setup, equity, take, effective, time } from "./fixtures.js";
import { VirtualClock } from "@ate/time";
it("fresh filesystem instance verifies all revisions and queries", async () => {
  const f = await disk(),
    r = take(await f.registry.register(equity()));
  const fresh = await setup(undefined, new FilesystemRegistryRepository(f.path));
  expect(take(fresh.registry.get(r.instrumentId))).toEqual(r);
  expect(take(fresh.registry.snapshot())).toEqual(take(f.registry.snapshot()));
});
it.each([
  "fingerprint",
  "previous",
  "generation",
  "registryId",
  "configurationFingerprint",
  "policyFingerprint",
])("corrupt snapshot %s rejects fresh recovery", async (field) => {
  const f = await disk();
  take(await f.registry.register(equity()));
  const file = join(f.path, readdirSync(f.path)[0]!);
  const body = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  body[field] = field === "generation" ? 9 : "corrupt";
  writeFileSync(file, JSON.stringify(body));
  const registry = new InstrumentRegistry("synthetic-registry", {
    clock: new VirtualClock(time),
    repository: new FilesystemRegistryRepository(f.path),
    configuration: () => f.config,
  });
  expect((await registry.initialize()).ok).toBe(false);
  expect(registry.diagnostics().readiness).toBe("NOT_READY");
});
it("rehashed cross-instrument revision substitution still rejects", async () => {
  const f = await disk();
  take(await f.registry.register(equity()));
  const file = join(f.path, readdirSync(f.path)[0]!);
  const body = JSON.parse(readFileSync(file, "utf8")) as Snapshot;
  const altered = {
    ...body,
    revisions: [{ ...body.revisions[0]!, instrumentId: "ins-" + "0".repeat(64) }],
  };
  const { fingerprint: _hash, ...content } = altered;
  writeFileSync(file, JSON.stringify({ ...content, fingerprint: fingerprint(content) }));
  const registry = new InstrumentRegistry("synthetic-registry", {
    clock: new VirtualClock(time),
    repository: new FilesystemRegistryRepository(f.path),
    configuration: () => f.config,
  });
  expect((await registry.initialize()).ok).toBe(false);
});
it("genuine committed-but-response-lost preserves unknown and fresh recovery", async () => {
  const backing = new MemoryRegistryRepository();
  const repository: Repository = {
    load: () => backing.load(),
    commit: async (s) => {
      take(await backing.commit(s));
      return fail("LOST_ACK", "UNKNOWN");
    },
  };
  const f = await setup(undefined, repository);
  expect((await f.registry.register(equity())).ok).toBe(false);
  expect(f.registry.diagnostics().recoveryRequired).toBe(true);
  expect((await f.registry.stop()).ok).toBe(false);
  const fresh = await setup(undefined, backing);
  expect(take(fresh.registry.search())).toHaveLength(1);
});
it("throwing repository response never certifies no commitment", async () => {
  const f = await setup(undefined, {
    load: () => Promise.resolve(ok([])),
    commit: () => {
      throw Error("IO");
    },
  });
  expect((await f.registry.register(equity())).ok).toBe(false);
  expect(f.registry.diagnostics().health).toBe("DEGRADED");
  expect((await f.registry.stop()).ok).toBe(false);
});
it("mismatched ACK cannot advance authoritative service state", async () => {
  const f = await setup(undefined, {
    load: () => Promise.resolve(ok([])),
    commit: (s) => Promise.resolve(ok({ ...s, generation: s.generation + 1 })),
  });
  expect((await f.registry.register(equity())).ok).toBe(false);
  expect(f.registry.diagnostics().generation).toBe(0);
  expect(f.registry.diagnostics().recoveryRequired).toBe(true);
});
it("known prewrite rejection remains retryable", async () => {
  const backing = new MemoryRegistryRepository();
  let reject = true;
  const f = await setup(undefined, {
    load: () => backing.load(),
    commit: (s) => (reject ? Promise.resolve(fail("PREWRITE")) : backing.commit(s)),
  });
  expect((await f.registry.register(equity())).ok).toBe(false);
  expect(f.registry.diagnostics().generation).toBe(0);
  reject = false;
  take(await f.registry.register(equity()));
  take(await f.registry.stop());
  take(await f.registry.stop());
});
it("unknown pending file prevents successful recovery", async () => {
  const f = await disk();
  writeFileSync(join(f.path, "generation-00000001.json.pending"), "partial");
  const cfg = await effective(),
    registry = new InstrumentRegistry("synthetic-registry", {
      clock: new VirtualClock(time),
      repository: new FilesystemRegistryRepository(f.path),
      configuration: () => cfg,
    });
  expect((await registry.initialize()).ok).toBe(false);
});
it("rehashing import evidence cannot substitute another accepted revision", async () => {
  const f = await disk();
  take(await f.registry.importRecords([equity(), equity("B")]));
  const file = join(f.path, readdirSync(f.path)[0]!);
  const s = JSON.parse(readFileSync(file, "utf8")) as Snapshot;
  const manifest = s.imports[0]!;
  const bad = {
    ...s,
    imports: [
      {
        ...manifest,
        outcomes: [
          { ...manifest.outcomes[0]!, revisionId: manifest.outcomes[1]!.revisionId },
          manifest.outcomes[1]!,
        ],
      },
    ],
  };
  const { fingerprint: _hash, ...content } = bad;
  writeFileSync(file, JSON.stringify({ ...content, fingerprint: fingerprint(content) }));
  const registry = new InstrumentRegistry("synthetic-registry", {
    clock: new VirtualClock(time),
    repository: new FilesystemRegistryRepository(f.path),
    configuration: () => f.config,
  });
  expect((await registry.initialize()).ok).toBe(false);
  expect(registry.diagnostics().recoveryRequired).toBe(true);
});
it("recovery rejects native serialization callbacks without executing them", async () => {
  const cfg = await effective();
  let calls = 0;
  const hostile = {
    toJSON() {
      calls++;
      throw Error("HOSTILE_SERIALIZATION");
    },
  };
  const registry = new InstrumentRegistry("synthetic-registry", {
    clock: new VirtualClock(time),
    configuration: () => cfg,
    repository: {
      load: () => Promise.resolve(ok([hostile])),
      commit: (s) => Promise.resolve(ok(s)),
    },
  });
  expect((await registry.initialize()).ok).toBe(false);
  expect(calls).toBe(0);
  expect(registry.diagnostics().recoveryRequired).toBe(true);
});

it.each([1, "true", undefined])(
  "nonboolean repository ACK %j retains genuine committed uncertainty",
  async (flag) => {
    const backing = new MemoryRegistryRepository();
    const f = await setup(undefined, {
      load: () => backing.load(),
      commit: async (s) => {
        take(await backing.commit(s));
        return { ok: flag, value: s } as unknown as Result<Snapshot>;
      },
    });
    expect((await f.registry.register(equity())).ok).toBe(false);
    expect(f.registry.diagnostics().recoveryRequired).toBe(true);
    expect((await f.registry.stop()).ok).toBe(false);
    const fresh = await setup(undefined, backing);
    expect(take(fresh.registry.search())).toHaveLength(1);
  },
);
it("actual filesystem commitment survives lost ACK with truthful stop and fresh recovery", async () => {
  const f = await disk();
  const backing = f.repository;
  const wrapped = await setup(undefined, {
    load: () => backing.load(),
    commit: async (s) => {
      take(await backing.commit(s));
      return fail("LOST_DISK_ACK", "UNKNOWN");
    },
  });
  expect((await wrapped.registry.register(equity())).ok).toBe(false);
  expect((await wrapped.registry.stop()).ok).toBe(false);
  expect(readdirSync(f.path)).toEqual(["generation-00000001.json"]);
  const recovered = await setup(undefined, new FilesystemRegistryRepository(f.path));
  expect(take(recovered.registry.search())).toHaveLength(1);
  take(await recovered.registry.stop());
  take(await recovered.registry.stop());
});
it("rehashed future source evidence cannot bypass the recorded-time invariant on recovery", async () => {
  const f = await disk();
  take(await f.registry.register(equity()));
  const file = join(f.path, readdirSync(f.path)[0]!);
  const s = JSON.parse(readFileSync(file, "utf8")) as Snapshot,
    old = s.revisions[0]!;
  const definition = {
    ...old.definition,
    evidence: [
      {
        ...old.definition.evidence[0]!,
        timeAuthority: "SOURCE_ASSERTED" as const,
        observedAt: time,
      },
    ],
  };
  const recordedAt = "2026-10-08T09:00:00.000Z";
  const semantic = {
    instrumentId: old.instrumentId,
    sequence: old.sequence,
    previous: old.previous,
    definition,
    changedFields: old.changedFields,
    justification: old.justification,
    configurationFingerprint: old.configurationFingerprint,
  };
  const row = {
    ...old,
    definition,
    recordedAt,
    revisionId: fingerprint(semantic),
    fingerprint: fingerprint(semantic),
  };
  const { fingerprint: _fp, ...content } = s;
  const altered = { ...content, revisions: [row] };
  writeFileSync(file, JSON.stringify({ ...altered, fingerprint: fingerprint(altered) }));
  const registry = new InstrumentRegistry("synthetic-registry", {
    clock: new VirtualClock(time),
    repository: new FilesystemRegistryRepository(f.path),
    configuration: () => f.config,
  });
  expect((await registry.initialize()).ok).toBe(false);
  expect(registry.diagnostics().recoveryRequired).toBe(true);
});
