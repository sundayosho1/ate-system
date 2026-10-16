import { beforeAll, it, expect } from "vitest";
import { FilesystemMOSERepository } from "@ate/mose-core";
import { owners, fixture, take, root, type Owners } from "./fixtures.js";
import { stored, recover } from "./remediation-helpers.js";
let base: Owners;
beforeAll(async () => {
  base = await owners();
});
it("B-J01 original exact-budget physical history recovers with truthful current binding health", async () => {
  const s = await stored(base, "G23");
  take(s.result);
  const prior = take(await s.f.repository.load()),
    actual = s.f.ports.quality;
  expect(take(await s.reader.health()).health).toBe("HEALTHY");
  s.f.ports.quality = { getReport: (_id) => actual.getReport("missing" as typeof _id) };
  expect(take(await s.reader.health()).health).toBe("DEGRADED");
  expect(take(await s.f.repository.load())).toEqual(prior);
  s.f.ports.quality = actual;
  expect(take(await s.reader.health()).health).toBe("HEALTHY");
});
it("B-J02 impossible physical lifecycle is rejected before any misleading healthy status", async () => {
  const s = await stored(base, "D29");
  expect(s.result.ok).toBe(false);
  expect(s.reader.diagnostics()).toMatchObject({
    health: "DEGRADED",
    readiness: "NOT_READY",
    lifecycle: "RECOVERY_REQUIRED",
  });
  expect((await s.reader.health()).ok).toBe(false);
  expect((await s.reader.stop()).ok).toBe(false);
});
it("B-J03 current binding loss preserves genuine acknowledged observations through fresh recovery", async () => {
  const f = await fixture(base, {}, new FilesystemMOSERepository(root()));
  await f.setup();
  take(await f.start());
  take(await f.receive(0));
  take(await f.process());
  const rows = take(await f.repository.load()),
    actual = f.ports.datasets;
  let unavailable = true;
  f.ports.datasets = {
    getVersion: (id) => actual.getVersion(unavailable ? ("missing" as typeof id) : id),
  };
  expect(take(await f.service.health()).health).toBe("DEGRADED");
  const n = await recover(f);
  take(n.result);
  expect(n.reader.diagnostics().health).toBe("DEGRADED");
  expect(take(n.reader.getSessionSummary("session-A")).admitted).toBe(1);
  unavailable = false;
  expect(take(await n.reader.health()).health).toBe("HEALTHY");
  const fresh = await recover(f);
  take(fresh.result);
  expect(take(await fresh.reader.health()).health).toBe("HEALTHY");
  expect(take(await f.repository.load())).toEqual(rows);
});
