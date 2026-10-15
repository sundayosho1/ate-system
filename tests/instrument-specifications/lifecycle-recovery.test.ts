import { it, expect } from "vitest";
import {
  InstrumentSpecifications,
  MemorySpecificationRepository,
  FilesystemSpecificationRepository,
  defaultPolicy,
  ok,
  fail,
  type Repository,
  type Snapshot,
} from "@ate/instrument-specifications";
import { fingerprint } from "@ate/configuration";
import { readFile, writeFile, readdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { fixture, take, root, declared, effective } from "./fixtures.js";
function wrap(commit: Repository["commit"]): Repository {
  return { load: () => Promise.resolve(ok([])), commit };
}
it.each(["throw", "unknown", "malformed", "wrong-generation", "wrong-body"] as const)(
  "retains exact obligation after %s acknowledgement",
  async (mode) => {
    let sent: Snapshot | undefined;
    const f = await fixture(
      defaultPolicy,
      wrap(async (s) => {
        await Promise.resolve();

        sent = s;
        if (mode === "throw") throw Error("INJECTED");
        if (mode === "unknown") return fail("INJECTED", "UNKNOWN");
        if (mode === "malformed") return {} as never;
        if (mode === "wrong-generation") return ok({ ...s, generation: s.generation + 1 });
        return ok({ ...s, publishedAt: "2026-10-10T08:00:00.000Z" as Snapshot["publishedAt"] });
      }),
    );
    expect((await f.service.publish(f.request())).ok).toBe(false);
    expect(sent).toBeDefined();
    expect(f.service.diagnostics()).toMatchObject({
      readiness: "NOT_READY",
      health: "DEGRADED",
      pending: 1,
      recoveryRequired: true,
      unresolvedPublication: { generation: sent!.generation, fingerprint: sent!.fingerprint },
    });
    expect((await f.service.stop()).ok).toBe(false);
    expect((await f.service.stop()).ok).toBe(false);
    expect((await f.service.publish(f.request("retry"))).ok).toBe(false);
  },
);
it("provable NONE does not create a phantom obligation and exact retry succeeds", async () => {
  const memory = new MemorySpecificationRepository();
  let reject = true,
    calls = 0;
  const f = await fixture(defaultPolicy, {
    load: () => memory.load(),
    commit: async (s) => {
      await Promise.resolve();

      calls++;
      return reject ? fail("INJECTED_NONE") : memory.commit(s);
    },
  });
  expect((await f.service.publish(f.request())).ok).toBe(false);
  expect(calls).toBe(1);
  expect(f.service.diagnostics()).toMatchObject({ readiness: "READY", pending: 0, generation: 0 });
  reject = false;
  const s = take(await f.service.publish(f.request()));
  expect(s.generation).toBe(1);
  expect(take(await f.service.publish(f.request())).fingerprint).toBe(s.fingerprint);
  expect(calls).toBe(2);
  take(await f.service.stop());
  take(await f.service.stop());
});
it("acknowledged but parent-context failure remains a fenced obligation and can recover freshly", async () => {
  const memory = new MemorySpecificationRepository();
  const f = await fixture(defaultPolicy, {
    load: () => memory.load(),
    commit: async (s) => {
      const result = await memory.commit(s);
      await f.mapping.service.stop();
      return result;
    },
  });
  expect((await f.service.publish(f.request())).ok).toBe(false);
  expect(f.service.diagnostics().pending).toBe(1);
  expect((await f.service.stop()).ok).toBe(false);
  expect(take(await memory.load())).toHaveLength(1);
});
it("fresh same-governance recovery reproduces every immutable version", async () => {
  const repo = new MemorySpecificationRepository(),
    f = await fixture(defaultPolicy, repo);
  const a = take(await f.service.publish(f.request()));
  const r = f.request("second");
  r.metadata.contract.size = declared("2");
  const b = take(await f.service.publish(r));
  expect(b.parentVersion).toBe(a.fingerprint);
  expect(b.specificationVersion).toBe(2);
  take(await f.service.stop());
  const reader = new InstrumentSpecifications("spec-lab", f.ports);
  expect(take(await reader.initialize())?.fingerprint).toBe(b.fingerprint);
  expect(take(reader.snapshot(a.fingerprint))?.fingerprint).toBe(a.fingerprint);
  expect(reader.diagnostics().readiness).toBe("READY");
  take(await reader.stop());
  take(await reader.stop());
  expect(reader.query({ kind: "HISTORY", offset: 0, limit: 10 }).ok).toBe(false);
});
it.each(["hash", "rehash", "gap", "duplicate-request", "wrong-policy"] as const)(
  "rejects %s retained evidence",
  async (mode) => {
    const f = await fixture(),
      s = take(await f.service.publish(f.request())),
      bad = structuredClone(s);
    if (mode === "hash") bad.fingerprint = "sha256:" + "a".repeat(64);
    if (mode === "rehash") {
      bad.prepared.normalized.contract.size = declared("999");
      const { fingerprint: ignored, ...p } = bad.prepared;
      void ignored;
      bad.prepared.fingerprint = fingerprint(p);
      const { fingerprint: ignore, ...body } = bad;
      void ignore;
      bad.fingerprint = fingerprint(body);
    }
    if (mode === "gap") bad.generation = 2;
    if (mode === "wrong-policy") bad.prepared.policy.maxFields++;
    const rows = mode === "duplicate-request" ? [s, s] : [bad];
    const reader = new InstrumentSpecifications("spec-lab", {
      ...f.ports,
      repository: {
        load: () => Promise.resolve(ok(rows)),
        commit: () => Promise.resolve(fail("READ_ONLY")),
      },
    });
    expect((await reader.initialize()).ok).toBe(false);
    expect(reader.diagnostics().recoveryRequired).toBe(true);
    expect((await reader.stop()).ok).toBe(false);
  },
);
it("lost ACK after real publication recovers from an intact filesystem root", async () => {
  const path = root(),
    repo = new FilesystemSpecificationRepository(path),
    f = await fixture(defaultPolicy, {
      load: () => repo.load(),
      commit: async (s) => {
        take(await repo.commit(s));
        return fail("LOST_ACK", "UNKNOWN");
      },
    });
  expect((await f.service.publish(f.request())).ok).toBe(false);
  const expected = f.service.diagnostics().unresolvedPublication;
  expect(expected).not.toBeNull();
  const reader = new InstrumentSpecifications("spec-lab", {
    ...f.ports,
    repository: new FilesystemSpecificationRepository(path),
  });
  expect(take(await reader.initialize())?.fingerprint).toBe(expected!.fingerprint);
  expect(reader.diagnostics()).toMatchObject({ readiness: "READY", pending: 0 });
  take(await reader.stop());
});
it.each(["pending", "corrupt", "gap", "symlink"] as const)(
  "filesystem recovery fences %s physical evidence",
  async (mode) => {
    const path = root(),
      repo = new FilesystemSpecificationRepository(path),
      f = await fixture(defaultPolicy, repo);
    take(await f.service.publish(f.request()));
    take(await f.service.stop());
    const file = join(path, "generation-00000001.json");
    if (mode === "pending") await writeFile(join(path, "interrupted.pending"), "{}");
    if (mode === "corrupt") await writeFile(file, "{}");
    if (mode === "gap")
      await writeFile(join(path, "generation-00000003.json"), await readFile(file));
    if (mode === "symlink") await symlink(file, join(path, "generation-00000002.json"));
    const reader = new InstrumentSpecifications("spec-lab", {
      ...f.ports,
      repository: new FilesystemSpecificationRepository(path),
    });
    expect((await reader.initialize()).ok).toBe(false);
    expect(reader.diagnostics().readiness).toBe("NOT_READY");
    expect((await readdir(path)).length).toBeGreaterThan(0);
  },
);
it("reentrant repository callbacks cannot publish, query or conceal in-flight shutdown", async () => {
  let reentry: unknown[] = [];
  const repo = new MemorySpecificationRepository(),
    f = await fixture(defaultPolicy, {
      load: () => repo.load(),
      commit: async (s) => {
        reentry = [
          await f.service.publish(f.request("recursive")),
          f.service.query({ kind: "HISTORY", offset: 0, limit: 1 }),
          await f.service.stop(),
        ];
        return repo.commit(s);
      },
    });
  take(await f.service.publish(f.request()));
  for (const r of reentry) expect(r).toMatchObject({ ok: false, error: { code: "BUSY" } });
  expect(f.service.diagnostics().generation).toBe(1);
  take(await f.service.stop());
});
it("a held commit keeps lifecycle not-ready and repeated stop cannot pretend success", async () => {
  let release!: () => void;
  const held = new Promise<void>((r) => {
      release = r;
    }),
    memory = new MemorySpecificationRepository();
  let entered!: () => void;
  const barrier = new Promise<void>((r) => {
      entered = r;
    }),
    f = await fixture(defaultPolicy, {
      load: () => memory.load(),
      commit: async (s) => {
        entered();
        await held;
        return memory.commit(s);
      },
    });
  const publishing = f.service.publish(f.request());
  await barrier;
  expect(f.service.diagnostics()).toMatchObject({ readiness: "NOT_READY", pending: 1 });
  expect((await f.service.stop()).ok).toBe(false);
  release();
  take(await publishing);
  take(await f.service.stop());
});
it("policy drift fails closed without rewriting history", async () => {
  const f = await fixture();
  const s = take(await f.service.publish(f.request()));
  f.setConfig(await effective({ ...defaultPolicy, maxFields: 127 }));
  expect(f.service.query({ kind: "HISTORY", offset: 0, limit: 1 }).ok).toBe(false);
  expect(f.service.diagnostics().readiness).toBe("NOT_READY");
  expect(take(await f.repository.load())[0]).toEqual(s);
});
it("constructor and lifecycle reject unsupported service identity and premature work", async () => {
  const f = await fixture(defaultPolicy, new MemorySpecificationRepository(), false);
  expect(() => new InstrumentSpecifications("invalid id", f.ports)).toThrow();
  expect((await f.service.publish(f.request())).ok).toBe(false);
  take(await f.service.stop());
  expect((await f.service.initialize()).ok).toBe(false);
});

it("explicit compatible historical policy permits deterministic new-policy reconciliation without rewriting history", async () => {
  const f = await fixture(),
    old = take(await f.service.publish(f.request()));
  take(await f.service.stop());
  const policy = {
      ...defaultPolicy,
      maxSourceAgeMs: 172800000,
      compatibleHistoryPolicies: [old.prepared.policyFingerprint],
    },
    configuration = await effective(policy),
    reader = new InstrumentSpecifications("spec-lab", {
      ...f.ports,
      configuration: () => configuration,
    });
  expect(take(await reader.initialize())?.fingerprint).toBe(old.fingerprint);
  const r = f.request("policy-reconciled"),
    next = take(await reader.publish(r));
  expect(next.prepared.policyFingerprint).not.toBe(old.prepared.policyFingerprint);
  expect(next.parentVersion).toBe(old.fingerprint);
  expect(take(reader.snapshot(old.fingerprint))).toEqual(old);
  expect(
    take(reader.compare(old.fingerprint, next.fingerprint)).differences.some(
      (x) => x.field === "VALIDATION_POLICY",
    ),
  ).toBe(true);
  take(await reader.stop());
  const again = new InstrumentSpecifications("spec-lab", {
    ...f.ports,
    configuration: () => configuration,
  });
  expect(take(await again.initialize())?.fingerprint).toBe(next.fingerprint);
});
it("unapproved policy-history change fails closed at fresh recovery", async () => {
  const f = await fixture();
  take(await f.service.publish(f.request()));
  const c = await effective({ ...defaultPolicy, maxSourceAgeMs: 172800000 }),
    reader = new InstrumentSpecifications("spec-lab", { ...f.ports, configuration: () => c });
  expect((await reader.initialize()).ok).toBe(false);
  expect(reader.diagnostics().recoveryRequired).toBe(true);
});

it("fresh recovery rejects rehashed clock authority substitution", async () => {
  const f = await fixture(),
    s = structuredClone(take(await f.service.publish(f.request())));
  s.clockProvenance.clockId = "substituted-clock";
  const { fingerprint: ignored, ...body } = s;
  void ignored;
  s.fingerprint = fingerprint(body);
  const reader = new InstrumentSpecifications("spec-lab", {
    ...f.ports,
    repository: {
      load: () => Promise.resolve(ok([s])),
      commit: () => Promise.resolve(fail("READ_ONLY")),
    },
  });
  expect((await reader.initialize()).ok).toBe(false);
  expect(reader.diagnostics().readiness).toBe("NOT_READY");
});
