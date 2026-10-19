import { it, expect } from "vitest";
import {
  opportunityHelp,
  opportunityDiagnostics,
} from "../../packages/mose-opportunities/src/diagnostics.js";
import {
  buildLocalOpportunityReport,
  buildCoverageHandoff,
  serializeOpportunityExport,
} from "../../packages/mose-opportunities/src/handover.js";
import { defaultOpportunityPolicy as policy } from "../../packages/mose-opportunities/src/policy.js";
for (const term of [
  "DORMANT",
  "OBSERVING",
  "INTERESTING",
  "SETUP_FORMING",
  "CANDIDATE",
  "QUALIFIED",
  "INVALIDATED",
  "EXPIRED",
  "ACK",
  "UNKNOWN",
  "CONSISTENCY_UNESTABLISHED",
  "OpportunityKey",
  "NONE",
])
  it(`help explains ${term} without financial authority`, () => {
    const r = opportunityHelp(term);
    expect(r).toBeDefined();
    expect(JSON.stringify(r)).toContain(term);
  });
it("empty local report does not invent market denominator", () =>
  expect(buildLocalOpportunityReport([], policy)).toMatchObject({
    ok: true,
    value: {
      globalCoverage: "UNKNOWN",
      denominator: { status: "KNOWN_LOCAL", value: 0 },
      candidateToQualified: { status: "UNSUPPORTED", value: null },
      nativeP28FoundationIntegration: "UNSUPPORTED",
    },
  }));
it("empty diagnostics keep current readiness separate from local runtime", () =>
  expect(opportunityDiagnostics([], policy, "READY", null)).toMatchObject({
    ok: true,
    value: {
      lifecycle: "READY",
      currentReadiness: "NOT_READY",
      currentHealth: "DEGRADED",
      coverage: { status: "UNKNOWN", denominator: null },
      passiveRoutes: ["DISABLED", "DISABLED", "DISABLED", "DISABLED"],
    },
  }));
it("P30 handoff cannot fabricate coverage", () =>
  expect(JSON.stringify(buildCoverageHandoff([], policy))).toContain("UNKNOWN"));
it("JSON export redacts nested sensitive fields and preserves Unicode", () => {
  const r = serializeOpportunityExport(
    {
      secret: "PLACEHOLDER_日本語é😀",
      label: "日本語é😀",
      nested: { password: "PLACEHOLDER_hidden" },
    },
    policy,
  );
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.value).not.toContain("PLACEHOLDER_");
    expect(r.value).toContain("日本語é😀");
    expect(r.value).toContain("[REDACTED]");
  }
});
it("export rejects oversized output under original governing ceiling", () => {
  const p = { ...policy, limits: { ...policy.limits, maxOutputBytes: 4 } };
  expect(serializeOpportunityExport({ x: "value" }, p).ok).toBe(false);
});
it("CSV format produces an escaped inert supplied-evidence cell", () => {
  const r = serializeOpportunityExport({ label: '=SUM(1,2)"' }, policy, "CSV");
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.value).toContain('"supplied_evidence"');
    expect(r.value).toContain('""');
  }
});
