import { parseCanonicalUtc, temporalSources, type Clock } from "@ate/time";
import { demand } from "./validation.js";
import type { EvaluationInput, Evidence, Policy } from "./contracts.js";
export function milliseconds(raw: string): number {
  const t = parseCanonicalUtc(raw);
  demand(t.ok, "CLOCK_UNTRUSTED");
  return Date.parse(t.value);
}
export function captureOpportunityClock(clock: Clock) {
  const mode = clock.mode,
    provenance = clock.provenance;
  demand(mode === "REPLAY" || mode === "SIMULATION", "CLOCK_UNTRUSTED");
  const now = clock.now();
  milliseconds(now);
  demand(
    ["SYNCHRONIZED", "ACCEPTABLE"].includes(provenance.quality) && provenance.clockId.length > 0,
    "CLOCK_UNTRUSTED",
  );
  return {
    mode,
    clockId: provenance.clockId,
    source: provenance.source,
    quality: provenance.quality,
    now,
  };
}
export function checkCutoffs(input: EvaluationInput) {
  const d = milliseconds(input.decisionCutoff),
    k = milliseconds(input.knowledgeCutoff),
    n = milliseconds(input.capturedClock.now);
  demand(k <= d && d <= n, "LOOKAHEAD");
  demand(
    ["SYNCHRONIZED", "ACCEPTABLE"].includes(input.capturedClock.quality) &&
      (temporalSources as readonly string[]).includes(input.capturedClock.source),
    "CLOCK_UNTRUSTED",
  );
}
export function checkEvidenceTime(e: Evidence, input: EvaluationInput, policy: Policy) {
  const d = milliseconds(input.decisionCutoff),
    k = milliseconds(input.knowledgeCutoff);
  demand(milliseconds(e.eventAt) <= d && milliseconds(e.availableAt) <= k, "LOOKAHEAD");
  demand(d - milliseconds(e.eventAt) <= policy.limits.defaultEvidenceMaxAgeMs, "EVIDENCE_STALE");
}
export function expiryAt(birth: string, policy: Policy) {
  return new Date(milliseconds(birth) + policy.limits.defaultExpiryMs).toISOString();
}
