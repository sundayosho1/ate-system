import { it, expect } from "vitest";
import { readFileSync } from "node:fs";

import * as I from "@ate/research-insights";

const rows = () =>
  (
    JSON.parse(readFileSync("docs/knowledge/capability-traceability.json", "utf8")) as {
      rows: Record<string, unknown>[];
    }
  ).rows;
it("all2092rows preserved", () => {
  const r = rows();
  expect(r).toHaveLength(2092);
  expect(
    I.validateCapabilityTraceability(
      r,
      r.map((x) => String(x.id)),
    ).ok,
  ).toBe(true);
});
for (const field of [
  "owner",
  "authoritativeContract",
  "documentation",
  "glossaryTerms",
  "configurationGuidance",
  "diagnosticEvidence",
  "reportingReadiness",
  "improvementIntegration",
  "frontendReadiness",
])
  it(`traceability ${field} required`, () => {
    const r = rows().slice(0, 1);
    delete r[0]![field];
    expect(I.validateCapabilityTraceability(r, []).ok).toBe(false);
  });
it("missing baseline identity rejects", () =>
  expect(
    I.validateCapabilityTraceability(
      rows().slice(1),
      rows().map((x) => String(x.id)),
    ).ok,
  ).toBe(false));
it("duplicate rejects", () => {
  const r = rows().slice(0, 1);
  expect(I.validateCapabilityTraceability([...r, ...r], []).ok).toBe(false);
});
it("all27prompts represented", () =>
  expect(rows().filter((r) => r.kind === "IMPLEMENTED_PROMPT_CAPABILITY")).toHaveLength(27));
it("allfive classes present", () =>
  expect(new Set(rows().map((r) => r.classification)).size).toBe(5));
