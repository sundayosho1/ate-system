import { beforeAll, it, expect } from "vitest";
import { fixture, owners, take } from "./fixtures.js";
let base: Awaited<ReturnType<typeof owners>>;
beforeAll(async () => {
  base = await owners();
});
it("genuine P25 event becomes acknowledged observation, separate from scan request", async () => {
  const f = await fixture(base);
  await f.plan();
  take(await f.start());
  const request = take(await f.scanner.request(f.trigger()));
  expect(request.disposition).toBe("DUE");
  expect(f.scanner.diagnostics().completed).toBe(0);
  const out = take(await f.scanner.dispatch("execute", 1));
  expect(out[0]?.status).toBe("COMPLETED");
  expect(out[0]?.ownerAck).toMatch(/^sha256:/);
  expect(f.scanner.diagnostics().completed).toBe(1);
});
