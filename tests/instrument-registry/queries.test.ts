import { mustParseUtc } from "@ate/time";
import { it, expect } from "vitest";
import { setup, equity, index, take } from "./fixtures.js";
it.each([{ offset: -1 }, { limit: 0 }, { limit: 65 }, { offset: 1.1 }, { limit: NaN }])(
  "invalid pagination %j rejects",
  async (q) => {
    const { registry } = await setup();
    take(await registry.register(equity()));
    expect(registry.search(q).ok).toBe(false);
  },
);
it("ordered pages compose stable full result", async () => {
  const { registry } = await setup();
  for (const c of ["C", "A", "B"]) take(await registry.register(equity(c)));
  const all = take(registry.search());
  expect([
    ...take(registry.search({ limit: 1 })),
    ...take(registry.search({ offset: 1, limit: 2 })),
  ]).toEqual(all);
  expect(take(registry.search())).toEqual(all);
});
it("family query is explicitly scoped", async () => {
  const { registry } = await setup();
  take(await registry.register(equity()));
  take(await registry.register(index()));
  expect(take(registry.search({ family: "INDEX" }))).toHaveLength(1);
});
it("subtype query has no silent family fallback", async () => {
  const { registry } = await setup();
  take(await registry.register(equity()));
  expect(take(registry.search({ subtype: "CALL" }))).toHaveLength(0);
});
it("exact snapshot returns historical definition", async () => {
  const { registry } = await setup();
  const row = take(await registry.register(equity()));
  const s = take(registry.snapshot())!;
  take(
    await registry.revise(
      row.instrumentId,
      row.revisionId,
      { ...equity(), displayName: "new" },
      "rename",
    ),
  );
  expect(take(registry.get(row.instrumentId, s.fingerprint))).toEqual(row);
});
it("read results cannot mutate owner", async () => {
  const { registry } = await setup();
  take(await registry.register(equity()));
  expect(() => {
    Array.prototype.pop.call(take(registry.search()));
  }).toThrow();
  expect(registry.diagnostics().generation).toBe(1);
});
it("unknown revision and snapshot remain explicit", async () => {
  const { registry } = await setup();
  expect(take(registry.revision("sha256:" + "0".repeat(64)))).toBeUndefined();
  expect(registry.snapshotAt("sha256:" + "0".repeat(64)).ok).toBe(false);
});
it("semantic export identity excludes governed recording-time differences", async () => {
  const a = await setup(),
    b = await setup();
  expect(b.clock.advanceTo(mustParseUtc("2026-10-09T10:00:00.000Z")).ok).toBe(true);
  const ar = take(await a.registry.register(equity())),
    br = take(await b.registry.register(equity()));
  expect(ar.revisionId).toBe(br.revisionId);
  expect(ar.recordedAt).not.toBe(br.recordedAt);
  expect(take(a.registry.exportManifest())).toEqual(take(b.registry.exportManifest()));
});
