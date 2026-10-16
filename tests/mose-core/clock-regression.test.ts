import { beforeAll, it, expect } from "vitest";
import { VirtualClock } from "@ate/time";
import { owners, fixture, take, type Owners, time } from "./fixtures.js";
let base: Owners;
beforeAll(async () => {
  base = await owners();
});
it("clock regression between commands cannot publish an unrecoverable history", async () => {
  const f = await fixture(base);
  await f.setup();
  const last = f.service.diagnostics().history;
  const previous = f.ports.clock;
  f.ports.clock = {
    mode: previous.mode,
    provenance: previous.provenance,
    now: () => "2026-10-09T09:00:00.000Z" as typeof time,
  };
  expect((await f.start()).ok).toBe(false);
  expect(f.service.diagnostics().history).toBe(last);
});
it("clock advancement during an owner check cannot backdate the new universe", async () => {
  const f = await fixture(base),
    original = f.ports.replayEvidence;
  f.ports.replayEvidence = (s, c) => {
    take(f.clock.advanceTo("2026-10-10T09:00:01.000Z" as typeof time));
    return original(s, c);
  };
  expect((await f.service.dispatch(f.create())).ok).toBe(false);
  expect(f.service.diagnostics().history).toBe(0);
});
it("clock identity substitution requires configuration restart rather than silent continuation", async () => {
  const f = await fixture(base);
  f.ports.clock = new VirtualClock(time, "REPLAY", "different-clock");
  expect((await f.service.dispatch(f.create())).ok).toBe(false);
  expect(f.service.diagnostics().history).toBe(0);
});
it("forward advancement between atomic operations remains supported", async () => {
  const f = await fixture(base);
  await f.setup();
  take(f.clock.advanceTo("2026-10-10T09:00:01.000Z" as typeof time));
  take(await f.start());
  expect(f.service.diagnostics().history).toBe(2);
});
