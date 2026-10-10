import { it, expect } from "vitest";
import {
  BrokerSymbolCatalogue,
  MemoryCatalogueRepository,
  FilesystemCatalogueRepository,
  defaultPolicy,
  fail,
  ok,
  type Repository,
  type Snapshot,
} from "@ate/broker-symbol-catalogue";
import { setup, batch, take, root, effective } from "./fixtures.js";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fingerprint } from "@ate/configuration";
it("rejects preinit and poststop mutation/query with repeated truthful stop", async () => {
  const { lab } = await setup(defaultPolicy, new MemoryCatalogueRepository(), false);
  expect((await lab.importNative(batch())).ok).toBe(false);
  expect(lab.snapshot().ok).toBe(false);
  take(await lab.initialize());
  take(await lab.stop());
  take(await lab.stop());
  expect((await lab.importNative(batch())).ok).toBe(false);
  expect(lab.snapshot().ok).toBe(false);
  expect(lab.diagnostics().readiness).toBe("NOT_READY");
});
it("configuration failure before repository entry permits valid initialization retry", async () => {
  let calls = 0;
  const repository: Repository = {
    load: () => {
      calls++;
      return Promise.resolve(ok([]));
    },
    commit: () => Promise.resolve(fail("UNUSED")),
  };
  const f = await setup(defaultPolicy, repository, false);
  f.setConfiguration({
    ...(await effective()),
    conflicts: [{}] as unknown as EffectiveConfiguration["conflicts"],
  });
  expect((await f.lab.initialize()).ok).toBe(false);
  expect(calls).toBe(0);
  f.setConfiguration(await effective());
  take(await f.lab.initialize());
  expect(calls).toBe(1);
  take(await f.lab.stop());
  take(await f.lab.stop());
});
it("trusted NONE rejection retains prior state and permits exact retry", async () => {
  const base = new MemoryCatalogueRepository();
  let reject = true;
  const f = await setup(defaultPolicy, {
    load: () => base.load(),
    commit: (s) => (reject ? Promise.resolve(fail("REJECTED")) : base.commit(s)),
  });
  const result = await f.lab.importNative(batch());
  expect(result).toEqual(fail("REJECTED"));
  expect(f.lab.diagnostics()).toMatchObject({ generation: 0, readiness: "READY" });
  reject = false;
  take(await f.lab.importNative(batch()));
  expect(f.lab.diagnostics().generation).toBe(1);
});
it.each(["unknown", "throw", "wrong-ack", "malformed"] as const)(
  "fences durable uncertainty %s without successful shutdown",
  async (mode) => {
    const base = new MemoryCatalogueRepository();
    const f = await setup(defaultPolicy, {
      load: () => base.load(),
      commit: async (s) => {
        take(await base.commit(s));
        if (mode === "throw") throw Error("LOST_ACK");
        if (mode === "unknown") return fail("LOST_ACK", "UNKNOWN");
        if (mode === "wrong-ack") return ok({ ...s, generation: s.generation + 1 });
        return { ok: true } as unknown as Awaited<ReturnType<Repository["commit"]>>;
      },
    });
    const result = await f.lab.importNative(batch());
    expect(result).toMatchObject({ ok: false, error: { commitment: "UNKNOWN" } });
    expect(f.lab.diagnostics()).toMatchObject({
      readiness: "NOT_READY",
      health: "DEGRADED",
      recoveryRequired: true,
      generation: 0,
    });
    expect(f.lab.snapshot().ok).toBe(false);
    expect(await f.lab.stop()).toEqual(fail("RECOVERY_REQUIRED", "UNKNOWN"));
    expect(await f.lab.stop()).toEqual(fail("RECOVERY_REQUIRED", "UNKNOWN"));
    const recovered = new BrokerSymbolCatalogue("offline-lab", { ...f.ports, repository: base });
    const s = take(await recovered.initialize());
    expect(s!.generation).toBe(1);
    expect(recovered.diagnostics().readiness).toBe("READY");
    take(await recovered.stop());
  },
);
it("pending commit cannot reentrantly stop, query or overwrite an obligation", async () => {
  let release: (value: ReturnType<typeof ok<Snapshot>>) => void = () => {
    throw Error("NOT_PENDING");
  };
  const base = new MemoryCatalogueRepository();
  const f = await setup(defaultPolicy, {
    load: () => base.load(),
    commit: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const pending = f.lab.importNative(batch());
  for (let i = 0; i < 20 && f.lab.diagnostics().pending === 0; i++) await Promise.resolve();
  expect(f.lab.diagnostics().pending).toBe(1);
  expect((await f.lab.stop()).ok).toBe(false);
  expect((await f.lab.importNative(batch("other"))).ok).toBe(false);
  expect(f.lab.snapshot().ok).toBe(false);
  const b = batch();
  const s = { schemaVersion: 1, generation: 1 } as unknown as Snapshot;
  release(ok(s));
  expect((await pending).ok).toBe(false);
  expect(f.lab.diagnostics().recoveryRequired).toBe(true);
  expect(b.batchId).toBe("batch-1");
});
it("immutable filesystem ACK recovers unchanged evidence in fresh service", async () => {
  const path = root(),
    repository = new FilesystemCatalogueRepository(path),
    f = await setup(defaultPolicy, repository);
  const c = take(await f.lab.importNative(batch()));
  const s = take(f.lab.snapshot());
  take(await f.lab.stop());
  const fresh = new BrokerSymbolCatalogue("offline-lab", f.ports);
  expect(take(await fresh.initialize())).toEqual(s);
  expect(take(fresh.catalogue(c.fingerprint))).toEqual(c);
  take(await fresh.stop());
});
it.each(["pending", "gap", "corrupt", "rehashed"] as const)(
  "fails closed on filesystem recovery %s",
  async (mode) => {
    const path = root(),
      repository = new FilesystemCatalogueRepository(path),
      f = await setup(defaultPolicy, repository);
    take(await f.lab.importNative(batch()));
    take(await f.lab.stop());
    if (mode === "pending")
      await writeFile(join(path, "generation-00000002.json.pending"), "unknown");
    else if (mode === "gap") await writeFile(join(path, "generation-00000003.json"), "{}");
    else if (mode === "corrupt") await writeFile(join(path, "generation-00000001.json"), "broken");
    else {
      const s = JSON.parse(
        await readFile(join(path, "generation-00000001.json"), "utf8"),
      ) as Snapshot;
      s.catalogues[0]!.observations[0]!.raw.rawSymbol = "TAMPERED";
      const { fingerprint: _fp, ...content } = s;
      s.fingerprint = fingerprint(content);
      await writeFile(join(path, "generation-00000001.json"), JSON.stringify(s));
    }
    const fresh = new BrokerSymbolCatalogue("offline-lab", f.ports);
    expect((await fresh.initialize()).ok).toBe(false);
    expect(fresh.diagnostics().recoveryRequired).toBe(true);
    expect((await fresh.stop()).ok).toBe(false);
  },
);
it("configuration drift immediately fences reads and writes without reinterpreting history", async () => {
  const f = await setup();
  take(await f.lab.importNative(batch()));
  f.setConfiguration(await effective({ ...defaultPolicy, staleAfterMs: 100 }));
  expect(f.lab.diagnostics().readiness).toBe("NOT_READY");
  expect(f.lab.snapshot().ok).toBe(false);
  expect((await f.lab.importNative(batch("next"))).ok).toBe(false);
});
import type { EffectiveConfiguration } from "@ate/configuration";

it("hostile thrown callback values cannot escape the structured failure boundary", async () => {
  let invoked = false;
  const hostile = Object.defineProperty(Error("hostile"), "message", {
    get() {
      invoked = true;
      throw Error("HOSTILE_ERROR_GETTER");
    },
  });
  for (const e of [
    hostile,
    new Proxy(Error("HIDDEN"), {
      get() {
        throw Error("HOSTILE_ERROR_PROXY");
      },
    }),
  ]) {
    const f = await setup(defaultPolicy, {
      load: () => Promise.resolve(ok([])),
      commit: () => Promise.reject(e),
    });
    await expect(f.lab.importNative(batch())).resolves.toMatchObject({
      ok: false,
      error: { commitment: "UNKNOWN" },
    });
    expect(f.lab.diagnostics().recoveryRequired).toBe(true);
    expect((await f.lab.stop()).ok).toBe(false);
  }
  expect(invoked).toBe(false);
});
