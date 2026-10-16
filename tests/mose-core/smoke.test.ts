import { it, expect } from "vitest";
import { owners, fixture, take } from "./fixtures.js";
it("real accepted owners bind, process and complete an offline research session", async () => {
  const o = await owners(),
    f = await fixture(o),
    u = await f.setup();
  expect(u.members[0]!.included).toBe(true);
  take(await f.start());
  for (let i = 0; i < u.plan.length; i++) take(await f.receive(i));
  take(await f.process());
  const summary = take(f.service.getSessionSummary("session-A"));
  expect(summary.admitted).toBe(u.plan.length);
  expect(summary.coverageComplete).toBe(true);
  take(await f.send({ kind: "COMPLETE", sessionId: "session-A" }));
  take(await f.service.stop());
});
