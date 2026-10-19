import type { JournalRecord, Policy } from "./contracts.js";
import { Budget, guarded, freeze } from "./validation.js";
import { canonical } from "./canonical.js";
export function opportunityDiagnostics(
  records: readonly JournalRecord[],
  policy: Policy,
  lifecycle: string,
  pending: string | null,
) {
  return guarded(() => {
    const latest = new Map(records.map((r) => [r.snapshot.key, r.snapshot]));
    const distribution = Object.fromEntries(
      [
        "DORMANT",
        "OBSERVING",
        "INTERESTING",
        "SETUP_FORMING",
        "CANDIDATE",
        "QUALIFIED",
        "INVALIDATED",
        "EXPIRED",
      ].map((s) => [s, [...latest.values()].filter((v) => v.state === s).length]),
    );
    const result = {
      schema: "ate.opportunity-diagnostics/1",
      lifecycle,
      historicalHead: records.at(-1)?.fingerprint ?? null,
      currentReadiness: "NOT_READY",
      currentHealth: "DEGRADED",
      currentAuthority: "UNESTABLISHED",
      consistency: "CONSISTENCY_UNESTABLISHED",
      quality: "UNKNOWN",
      coverage: { status: "UNKNOWN", denominator: null },
      obligation: { pending: pending === null ? 0 : 1, operationRef: pending },
      localDistribution: distribution,
      instrumentBindings: [
        ...new Map(
          records
            .filter((r) => r.details.capture.instrumentBinding)
            .map((r) => [
              canonical(r.details.capture.instrumentBinding),
              r.details.capture.instrumentBinding,
            ]),
        ).values(),
      ],
      retainedRecords: records.length,
      retainedBytes: Buffer.byteLength(canonical(records)),
      driverEnabled: false,
      passiveRoutes: ["DISABLED", "DISABLED", "DISABLED", "DISABLED"],
      tradingAuthority: false,
    };
    return freeze(new Budget(policy.limits).capture(result, policy.limits.maxOutputBytes));
  });
}
export const opportunityGlossary = freeze({
  DORMANT: "Governed watch declaration; not confirmed market absence.",
  OBSERVING: "Accepted offline observation, not a setup or permission to trade.",
  INTERESTING: "Evidence-qualified interest under an approved finite manifest.",
  SETUP_FORMING: "Hypothesis-scoped lifecycle state; not a feature classifier.",
  CANDIDATE: "Potential opportunity under declared evidence, not a rank.",
  QUALIFIED: "Opportunity-lifecycle label only; not strategy profitability or trade authorization.",
  INVALIDATED: "Positive authoritative contradiction; not missing evidence.",
  EXPIRED: "Known P6 deadline elapsed; distinct from invalidation.",
  ACK: "Historical repository acknowledgement; never current eligibility.",
  UNKNOWN: "Unresolved evidence or commitment; never normalized to NONE.",
  CONSISTENCY_UNESTABLISHED: "No supported consistent cross-owner read has been proven.",
  OpportunityKey: "Domain-separated full SHA256; not the UUID OpportunityId or scanner receipt.",
  NONE: "Provably no P28 publication for this operation, not source absence.",
});
export function opportunityHelp(term: string) {
  return guarded(() => {
    const text: unknown = Reflect.get(opportunityGlossary, term);
    return freeze({
      schema: "ate.opportunity-help/1",
      term,
      text: typeof text === "string" ? text : "UNSUPPORTED_TERM",
      sourceOwner: "@ate/mose-opportunities",
      nativeP28FoundationIntegration: "UNSUPPORTED",
      frontendImplemented: false,
      tradingAuthority: false,
    });
  });
}
