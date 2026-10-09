import { it, expect } from "vitest";
import { prepare, defaultPolicy } from "@ate/instrument-registry";
import { equity, evidence, setup, take, time } from "./fixtures.js";
it.each([
  ["missing source", { sourceId: "" }],
  ["invalid fingerprint", { contentFingerprint: "fake" }],
  ["missing evidence reference", { evidenceReference: "" }],
  ["unqualified verified assertion", { verification: "VERIFIED" }],
  ["unknown timestamp with date", { observedAt: time }],
  ["source time without date", { timeAuthority: "SOURCE_ASSERTED" }],
  ["evidenced time without date", { timeAuthority: "EVIDENCED" }],
  ["naive timestamp", { observedAt: "2026-10-09", timeAuthority: "SOURCE_ASSERTED" }],
  ["unknown source type", { sourceType: "LIVE" }],
  ["empty original value", { originalValue: "" }],
])("reject provenance %s", (_name, patch) => {
  const d = equity();
  d.evidence = [{ ...evidence(), ...patch } as ReturnType<typeof evidence>];
  expect(() => prepare(d, defaultPolicy)).toThrow();
});
it("governed recording time does not invent source observation time", async () => {
  const { registry } = await setup();
  const row = take(await registry.register(equity()));
  expect(row.recordedAt).toBe(time);
  expect(row.definition.evidence[0]!.observedAt).toBeUndefined();
  expect(row.clockProvenance).toBeDefined();
});
it("trusted recognized evidence can qualify but is not external proof", () => {
  const d = equity();
  d.evidence = [{ ...evidence(), sourceType: "RECOGNIZED_AUTHORITY", verification: "VERIFIED" }];
  d.qualification = "VERIFIED";
  expect(prepare(d, defaultPolicy).definition.qualification).toBe("VERIFIED");
});
it("source labels and fingerprints alone cannot authorize verified registry claims", async () => {
  const { registry } = await setup();
  const d = equity();
  d.evidence = [{ ...evidence(), sourceType: "RECOGNIZED_AUTHORITY", verification: "VERIFIED" }];
  d.qualification = "VERIFIED";
  expect((await registry.register(d)).ok).toBe(false);
  expect(registry.diagnostics().generation).toBe(0);
});
