import { O1, effectivePolicy } from "./policy.js";
import type { JournalRecord, Policy } from "./contracts.js";
import { operationBudget, inOperation, demand, guarded, freeze } from "./validation.js";
export function buildOpportunityHandoff(record: JournalRecord, policy: Policy) {
  return inOperation(O1, () =>
    guarded(() => {
      policy = effectivePolicy(policy);
      const meter = operationBudget(policy.limits);
      meter.capture(record, policy.limits.maxRecordBytes);
      return freeze(
        meter.capture(
          {
            schema: "ate.opportunity-handoff/1",
            sourceOwner: "@ate/mose-opportunities",
            sourceVersion: "0.28.0-opportunity-state.1",
            key: record.snapshot.key,
            state: record.snapshot.state,
            head: record.fingerprint,
            journalGeneration: record.journalGeneration,
            stateGeneration: record.snapshot.head.stateGeneration,
            reasons: record.proposal.reasonCodes,
            subject: record.snapshot.subject,
            evidence: record.proposal.evidence,
            instrumentBinding: record.details.capture.instrumentBinding ?? null,
            decisionCutoff: record.details.input.decisionCutoff,
            knowledgeCutoff: record.details.input.knowledgeCutoff,
            expiresAt: record.snapshot.expiresAt,
            currentUsability: "UNKNOWN",
            authorityBasis: "HISTORICAL_AS_KNOWN",
            confidence: { status: "UNSUPPORTED", value: null },
            rankingOwner: "P29_UNAVAILABLE",
            currentEligibility: "UNESTABLISHED",
            tradingAuthority: false,
          },
          policy.limits.maxOutputBytes,
        ),
      );
    }),
  );
}
export function buildCoverageHandoff(records: readonly JournalRecord[], policy: Policy) {
  return inOperation(O1, () =>
    guarded(() => {
      policy = effectivePolicy(policy);
      const meter = operationBudget(policy.limits);
      meter.capture(records, policy.limits.maxRetainedJournalBytes);
      return freeze(
        meter.capture(
          {
            schema: "ate.opportunity-coverage-handoff/1",
            scope: "RETAINED_LOCAL_HISTORY",
            records: records.length,
            head: records.at(-1)?.fingerprint ?? null,
            sourceFreshness: "UNESTABLISHED",
            currentCoverage: "UNKNOWN",
            denominator: { status: "UNKNOWN", value: null },
            coverageOwner: "P30_UNAVAILABLE",
            tradingAuthority: false,
          },
          policy.limits.maxOutputBytes,
        ),
      );
    }),
  );
}
export function buildLocalOpportunityReport(records: readonly JournalRecord[], policy: Policy) {
  return inOperation(O1, () =>
    guarded(() => {
      policy = effectivePolicy(policy);
      const meter = operationBudget(policy.limits);
      meter.capture(records, policy.limits.maxRetainedJournalBytes);
      const latest = new Map(records.map((r) => [r.snapshot.key, r]));
      const candidate = [...latest.values()].filter((r) => r.snapshot.state === "CANDIDATE").length;
      const qualified = [...latest.values()].filter((r) => r.snapshot.state === "QUALIFIED").length;
      return freeze(
        meter.capture(
          {
            schema: "ate.opportunity-report/1",
            historicalHead: records.at(-1)?.fingerprint ?? null,
            scope: "RETAINED_LOCAL_KEYS",
            denominator: { status: "KNOWN_LOCAL", value: latest.size },
            counts: { candidate, qualified },
            instrumentBindings: [
              ...new Map(
                records
                  .filter((r) => r.details.capture.instrumentBinding)
                  .map((r) => [
                    JSON.stringify(r.details.capture.instrumentBinding),
                    r.details.capture.instrumentBinding,
                  ]),
              ).values(),
            ],
            candidateToQualified: {
              status: "UNSUPPORTED",
              value: null,
              reason: "COMPLETE_COHORT_DENOMINATOR_UNESTABLISHED",
            },
            currentHealth: "UNESTABLISHED",
            currentAuthority: "UNESTABLISHED",
            globalCoverage: "UNKNOWN",
            nativeP28FoundationIntegration: "UNSUPPORTED",
            chartMetadata: {
              categories: ["CANDIDATE", "QUALIFIED"],
              unit: "retained keys",
              unknownAsZero: false,
              textAlternative: true,
              colorOnly: false,
            },
            frontendImplemented: false,
            tradingAuthority: false,
          },
          policy.limits.maxOutputBytes,
        ),
      );
    }),
  );
}
export function serializeOpportunityExport(
  raw: unknown,
  policy: Policy,
  format: "JSON" | "CSV" = "JSON",
) {
  return inOperation(O1, () =>
    guarded(() => {
      policy = effectivePolicy(policy);
      const meter = operationBudget(policy.limits);
      const data = meter.capture(raw);
      const redact = (v: unknown): unknown => {
        meter.capture(0); // charge each derived logical node before constructing it
        if (Array.isArray(v)) return v.map(redact);
        if (v !== null && typeof v === "object")
          return Object.fromEntries(
            Object.entries(v).map(([k, value]) => [
              k,
              /secret|password|credential|token/iu.test(k) ? redact("[REDACTED]") : redact(value),
            ]),
          );
        return v;
      };
      const safe = redact(data);
      meter.capture(0); // charge the flat JSON representation before serialization
      let text = JSON.stringify(safe);
      if (format === "CSV") {
        meter.capture(0); // charge the additional flat CSV representation
        const cell = (s: string) =>
          '"' + (/^[-=+@]/u.test(s) ? "'" : "") + s.replaceAll('"', '""') + '"';
        text = '"supplied_evidence"\n' + cell(text);
      }
      demand(Buffer.byteLength(text) <= policy.limits.maxOutputBytes, "BUDGET_EXHAUSTED");
      return text;
    }),
  );
}
