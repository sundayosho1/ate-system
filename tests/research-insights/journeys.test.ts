import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as C from "@ate/research-insight-contracts";
import * as I from "@ate/research-insights";
import type { SourceManifest } from "@ate/research-insights";
import type { InsightKind, InsightRecord } from "@ate/research-insight-contracts";
const data = JSON.parse(
  readFileSync("tests/research-insights/fixtures/owner-evidence.json", "utf8"),
) as {
  samples: Record<string, Record<string, unknown>>;
  manifest: SourceManifest;
  generatedAt: string;
};
const rec = (k: string) => structuredClone(data.samples[k]!);
const known = (value: unknown) => ({ kind: "KNOWN", value, evidenceIds: ["synthetic/evidence"] });
const row = (kind: InsightKind, value: unknown) => C.validateInsightRecord(kind, value);
const plan = JSON.parse(
  readFileSync("tests/research-insights/fixtures/expected-projections.json", "utf8"),
) as { journeys: { id: string; title: string }[] };
const runbooks = JSON.parse(readFileSync("docs/knowledge/runbooks.json", "utf8")) as {
  id: string;
  sourceRefs: string[];
  adverseVariants: unknown[];
}[];
for (const j of plan.journeys)
  it(`${j.id} complete static foundation journey: ${j.title}`, () => {
    const b = runbooks.find((b) => b.id === j.id)!;
    expect(b).toBeDefined();
    expect(b.adverseVariants).toHaveLength(3);
    const manifest = JSON.parse(
      readFileSync("docs/knowledge/source-manifest.json", "utf8"),
    ) as SourceManifest;
    // No running owner ports supplied. Counters distinguish fixture setup from projection.

    const e = {
      ...rec("KnowledgeEntry"),
      id: "runbook/" + j.id,
      definition: JSON.stringify(b),
      sourceRefs: b.sourceRefs,
    };
    const c = I.createKnowledgeCatalogue({
      entries: [e],
      sourceManifest: manifest,
      qualificationIds: [],
      generatedAt: data.generatedAt,
    });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const q = I.searchKnowledge(c.value, { query: j.id });
    expect(q.ok).toBe(true);
    if (q.ok) expect(q.value).toMatchObject({ totalMatches: 1 });
    switch (j.id) {
      case "J01": {
        const s = JSON.parse(readFileSync("docs/knowledge/status-overlay.json", "utf8")) as unknown;
        expect(I.createStatusOverlay(s, manifest).ok).toBe(true);
        break;
      }
      case "J02": {
        const v = rec("EvidenceReference");
        expect(row("EvidenceReference", v).ok).toBe(true);
        v.nativeFingerprint = known("truncated");
        expect(row("EvidenceReference", v).ok).toBe(false);
        break;
      }
      case "J03": {
        const v = rec("ObligationReference");
        v.nativeCommitment = known("UNKNOWN");
        const result = row("ObligationReference", v);
        expect(result.ok).toBe(true);
        if (result.ok)
          expect((result.value as InsightRecord).nativeCommitment).toEqual(known("UNKNOWN"));
        break;
      }
      case "J04": {
        const v = rec("DiagnosticFacet");
        v.currentAuthority = known(true);
        expect(row("DiagnosticFacet", v).ok).toBe(false);
        break;
      }
      case "J05": {
        const v = rec("DiagnosticFacet");
        v.nativeStatus = known("VALIDATION_ATTESTED_NOT_INDEPENDENTLY_VERIFIED");
        expect(row("DiagnosticFacet", v).ok).toBe(true);
        v.currentAuthority = known(true);
        expect(row("DiagnosticFacet", v).ok).toBe(false);
        break;
      }
      case "J06": {
        const v = rec("ConsistencyEvidence");
        expect(row("ConsistencyEvidence", v).ok).toBe(true);
        v.mode = "OWNER_SUPPORTED_BARRIER";
        expect(row("ConsistencyEvidence", v).ok).toBe(false);
        break;
      }
      case "J07": {
        const v = rec("NativeResultEvidence");
        v.nativeCommitment = known("UNKNOWN");
        expect(row("NativeResultEvidence", v).ok).toBe(true);
        v.selectedDiscriminator = "false";
        expect(row("NativeResultEvidence", v).ok).toBe(false);
        break;
      }
      case "J08": {
        const v = rec("CoverageStatement");
        v.scope = "ACKNOWLEDGED_SCANNER_REQUESTS_ONLY";
        expect(row("CoverageStatement", v).ok).toBe(true);
        v.claim = "OWNER_DECLARED_ONLY";
        expect(row("CoverageStatement", v).ok).toBe(false);
        break;
      }
      case "J09": {
        const v = rec("ObligationReference");
        v.originalIdentity = "original-floor-1";
        expect(row("ObligationReference", v).ok).toBe(true);
        delete v.originalIdentity;
        expect(row("ObligationReference", v).ok).toBe(false);
        break;
      }
      case "J10": {
        const v = rec("ConfigurationGuide");
        expect(I.validateConfigurationGuides([v], data.manifest).ok).toBe(true);
        delete v.authority;
        expect(I.validateConfigurationGuides([v], data.manifest).ok).toBe(false);
        break;
      }
      case "J11": {
        const old = JSON.parse(
          readFileSync("tests/research-insights/fixtures/source-decisions.json", "utf8"),
        ) as { baseline: string };
        expect(old.baseline).toBe(data.manifest.baseline);
        break;
      }
      case "J12": {
        const v = rec("ReportManifest");
        v.missingFacets = ["unavailable-peer"];
        expect(row("ReportManifest", v).ok).toBe(true);
        v.exportStatus = "REQUESTED_FACETS_EXPORTED";
        expect(row("ReportManifest", v).ok).toBe(false);
        break;
      }
      default:
        throw Error("Unimplemented journey");
    }
    expect(Object.hasOwn(I, "dispatch")).toBe(false);
  });

for (const j of plan.journeys)
  for (let variant = 0; variant < 3; variant++)
    it(`${j.id} adverse variant ${variant + 1} preserves qualified evidence`, () => {
      let v: Record<string, unknown>;
      let kind: InsightKind;
      let expected = true;
      switch (j.id) {
        case "J01":
          kind = "EvidenceReference";
          v = rec(kind);
          if (variant === 0) {
            v.sourceCommit = "missing-history";
            expected = false;
          } else if (variant === 1)
            v.nativeFingerprint = { kind: "UNKNOWN", reasonIds: ["ARCHIVE_UNAVAILABLE"] };
          else {
            v.schema = "ate.insights.evidence/99";
            expected = false;
          }
          break;
        case "J02":
          kind = "ReportManifest";
          v = rec(kind);
          if (variant === 0) v.missingFacets = ["quality-report-unavailable"];
          else if (variant === 1) {
            kind = "CoverageStatement";
            v = rec(kind);
            v.suppression = known(4);
          } else {
            kind = "EvidenceReference";
            v = rec(kind);
            v.nativeFingerprint = known("mismatched fingerprint");
            expected = false;
          }
          break;
        case "J03":
          kind = "ObligationReference";
          v = rec(kind);
          if (variant === 0) v.nativeCommitment = known("UNKNOWN");
          else if (variant === 1) {
            kind = "EvidenceReference";
            v = rec(kind);
            v.sourceTimes = {
              availableAt: known("2026-10-18T00:00:01.000Z"),
              asOf: known(data.generatedAt),
            };
            expected = false;
          } else {
            kind = "DiagnosticFacet";
            v = rec(kind);
            v.nativeStatus = known("CONSUMER_LOSS_UNRECONCILED");
          }
          break;
        case "J04":
          kind = "DiagnosticFacet";
          v = rec(kind);
          v.nativeStatus = known(
            ["ALIAS_AMBIGUOUS", "APPROVAL_REVOKED", "INDEPENDENT_CLAIMS_UNESTABLISHED"][variant],
          );
          break;
        case "J05":
          kind = "DiagnosticFacet";
          v = rec(kind);
          v.nativeStatus = known(
            ["ATTESTATION_EXPIRED", "ISSUER_UNVERIFIED", "LIVE_ELIGIBLE_PROHIBITED"][variant],
          );
          v.currentAuthority = known(false);
          break;
        case "J06":
          kind = "ConsistencyEvidence";
          v = rec(kind);
          v.reasons = [
            ["REFERENCE_READ_PENDING"],
            ["LOGICAL_BOUNDARY_MISMATCH"],
            ["REFERENCE_RECOVERY_REQUIRED"],
          ][variant];
          break;
        case "J07":
          kind = "NativeResultEvidence";
          v = rec(kind);
          if (variant === 0) {
            v.selectedFailure = null;
            expected = false;
          } else if (variant === 1) {
            kind = "DiagnosticFacet";
            v = rec(kind);
            v.currentAuthority = known(true);
            expected = false;
          } else {
            kind = "OwnerReadObservation";
            v = rec(kind);
            v.disposition = "UNAVAILABLE";
          }
          break;
        case "J08":
          kind = "ConsistencyEvidence";
          v = rec(kind);
          v.reasons = [
            ["CHANGING_REQUEST_TOTALS"],
            ["OPEN_A26_Q01"],
            ["ANCHOR_CADENCE_OBLIGATION_UNREPRESENTED"],
          ][variant];
          break;
        case "J09":
          kind = "ObligationReference";
          v = rec(kind);
          if (variant === 0) {
            v.originalIdentity = undefined;
            expected = false;
          } else if (variant === 1) {
            kind = "NativeResultEvidence";
            v = rec(kind);
            v.selectedDiscriminator = "true";
            expected = false;
          } else v.state = "ORIGINAL_RETRY_BUDGET_EXHAUSTED";
          break;
        case "J10":
          kind = "ConfigurationGuide";
          v = rec(kind);
          if (variant === 0) {
            delete v.schemaRef;
            expected = false;
          } else if (variant === 1) {
            delete v.authority;
            expected = false;
          } else
            v.activeVersion = { kind: "UNKNOWN", reasonIds: ["MISSING_PUBLIC_EFFECTIVE_VALUE"] };
          break;
        case "J11":
          kind = "EvidenceReference";
          v = rec(kind);
          if (variant === 0) v.locator = { kind: "UNKNOWN", reasonIds: ["OWNER_DECISION_MISSING"] };
          else if (variant === 1) {
            v.sourceCommit = "unauthorized-ledger-append";
            expected = false;
          } else {
            kind = "DiagnosticFacet";
            v = rec(kind);
            v.currentAuthority = known(true);
            expected = false;
          }
          break;
        case "J12":
          kind = "ReportManifest";
          v = rec(kind);
          v.missingFacets = [
            ["PAGE_BUDGET_EXHAUSTED"],
            ["READ_CANCELLED"],
            ["HISTORICAL_HEALTH_NOT_CURRENT_AUTHORITY"],
          ][variant];
          if (variant === 2) {
            v.exportStatus = "REQUESTED_FACETS_EXPORTED";
            expected = false;
          }
          break;
        default:
          throw Error("Missing journey");
      }
      const result = row(kind, v);
      expect(result.ok).toBe(expected);
      if (result.ok) expect(result.value).toEqual(v);
    });
it("projection rejects an owner-callback descriptor without invoking it", () => {
  let ownerCalls = 0;
  const request = {
    entries: [],
    sourceManifest: data.manifest,
    qualificationIds: [],
    generatedAt: data.generatedAt,
    get owner() {
      ownerCalls++;
      throw Error("MUST_NOT_INVOKE");
    },
  };
  expect(I.createKnowledgeCatalogue(request).ok).toBe(false);
  expect(ownerCalls).toBe(0);
});
