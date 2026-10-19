import { operationBudget, inOperation } from "./validation.js";
import {
  states,
  inputSchema,
  contextSchema,
  type Policy,
  type DecisionProposal,
  type OpportunityState,
  type CapturedContext,
} from "./contracts.js";
import { demand, guarded, freeze } from "./validation.js";
import { canonical, fingerprint } from "./canonical.js";
import { makeOpportunityKey, policyFingerprint } from "./identity.js";
import { checkCutoffs, milliseconds } from "./time-policy.js";
import {
  admitEvidence,
  nativePayload,
  requireCapture,
  contextDto,
  metadata,
  sealProposal,
} from "./evidence.js";
import { object } from "./validation.js";
import { evaluatePredicate } from "./predicates.js";
import { O1, defaultOpportunityPolicy, effectivePolicy } from "./policy.js";
export const transitionRules = freeze([
  ["I", "T1", "DENY", "DENY", "DENY", "DENY", "T8", "T9"],
  ["T7", "I", "T2", "DENY", "DENY", "DENY", "T8", "T9"],
  ["DENY", "T6", "I", "T3", "DENY", "DENY", "T8", "T9"],
  ["DENY", "DENY", "T6", "I", "T4", "DENY", "T8", "T9"],
  ["DENY", "DENY", "DENY", "T6", "I", "T5", "T8", "T9"],
  ["DENY", "DENY", "DENY", "DENY", "T6", "I", "T8", "T9"],
  ["DENY", "DENY", "DENY", "DENY", "DENY", "DENY", "I", "DENY"],
  ["DENY", "DENY", "DENY", "DENY", "DENY", "DENY", "DENY", "I"],
]);
export function transitionRule(from: OpportunityState, to: OpportunityState): string {
  const r = transitionRules[states.indexOf(from)]?.[states.indexOf(to)];
  demand(r, "TRANSITION_DENIED");
  return r;
}

export function validateOpportunityInput(raw: unknown, policy: Policy = defaultOpportunityPolicy) {
  return inOperation(O1, () =>
    guarded(() => {
      policy = effectivePolicy(policy);
      return inputSchema.parse(operationBudget(policy.limits).capture(raw));
    }),
  );
}
export function evaluateOpportunity(
  raw: unknown,
  rawContext: unknown,
  policy: Policy = defaultOpportunityPolicy,
) {
  return inOperation(O1, () =>
    guarded(() => {
      policy = effectivePolicy(policy);
      const meter = operationBudget(policy.limits);
      demand(rawContext !== null && typeof rawContext === "object", "INPUT_INVALID");
      const sourceContext = rawContext as CapturedContext;
      const capture = requireCapture(sourceContext);
      const input = inputSchema.parse(meter.capture(raw)),
        context = contextSchema.parse(meter.capture(contextDto(sourceContext)));
      demand(input.authorityBasis === "HISTORICAL_AS_KNOWN", "CURRENT_AUTHORITY_DISABLED");
      for (const value of [
        input.commandId,
        input.actorAuthorityRef,
        input.configurationReleaseRef,
        input.capturedClock.clockId,
        input.capturedClock.source,
        input.capturedClock.quality,
        context.actorEvidenceRef,
        context.trustedCaptureRef,
        context.scopeConsistencyEvidenceRef,
      ])
        demand(
          value === null || Buffer.byteLength(value) <= policy.limits.maxIdentifierBytes,
          "BUDGET_EXHAUSTED",
        );
      checkCutoffs(input);
      demand(
        input.key === makeOpportunityKey(context.subject, policy, capture.origin) &&
          input.policyFingerprint === policyFingerprint(policy),
        "SOURCE_CONTEXT_MISMATCH",
      );
      demand(
        context.sourceManifestRef === capture.origin.manifestId &&
          input.actorAuthorityRef === context.actorEvidenceRef &&
          context.policyRef === policy.id,
        "AUTHORITY_UNESTABLISHED",
      );
      demand(
        input.consistency === "ESTABLISHED_SCOPE" && context.scopeConsistencyEvidenceRef !== null,
        "CONSISTENCY_UNESTABLISHED",
      );
      demand(
        context.predicateManifests.length <= policy.limits.maxEdgeManifests,
        "BUDGET_EXHAUSTED",
      );
      demand(
        new Set(context.predicateManifests.map((m) => m.fromState + ":" + m.toState)).size ===
          context.predicateManifests.length,
        "INPUT_INVALID",
      );
      for (const manifest of context.predicateManifests) {
        const { fingerprint: suppliedFingerprint, ...manifestBody } = manifest;
        demand(
          suppliedFingerprint === fingerprint("ate.opportunity-predicate/1", manifestBody),
          "SOURCE_FINGERPRINT_MISMATCH",
        );
      }
      const previous = context.historicalState;
      demand(
        (previous === null) === (context.previousEventFingerprint === null),
        "STALE_PREDECESSOR",
      );
      demand(
        canonical(input.expectedHead) === canonical(previous?.head ?? null),
        "STALE_PREDECESSOR",
      );
      if (previous) {
        demand(
          previous.key === input.key &&
            previous.governingPolicyFingerprint === input.policyFingerprint &&
            canonical(previous.subject) === canonical(context.subject),
          "SOURCE_CONTEXT_MISMATCH",
        );
        demand(
          milliseconds(input.decisionCutoff) >= milliseconds(previous.lastDecisionCutoff),
          "OUT_OF_ORDER",
        );
      }
      const evidence = admitEvidence(input, context, capture, policy, meter);
      let secondaryExpiry = false;
      let to = input.requestedState,
        reason = "NO_ACTION";
      let disposition: DecisionProposal["disposition"] = "NO_ACTION";
      if (!previous) {
        demand(to === "DORMANT" && input.expectedHead === null, "TRANSITION_DENIED");
        demand(
          evidence.some(
            (e) =>
              e.family === "DECLARATION" &&
              object(nativePayload(e)).watchDeclarationId === context.subject.watchDeclarationId,
          ),
          "EVIDENCE_MISSING",
        );
        reason = "WATCH_DECLARED";
        disposition = "TRANSITION";
      } else {
        const terminal = previous.state === "INVALIDATED" || previous.state === "EXPIRED";
        if (!terminal) {
          if (evidence.some((e) => e.family === "REVOCATION")) {
            to = "INVALIDATED";
            secondaryExpiry =
              milliseconds(input.decisionCutoff) >= milliseconds(previous.expiresAt);
          } else if (milliseconds(input.decisionCutoff) >= milliseconds(previous.expiresAt))
            to = "EXPIRED";
        }
        const rule = transitionRule(previous.state, to);
        demand(rule !== "DENY", "TRANSITION_DENIED");
        if (to !== previous.state) {
          demand(!terminal, "TERMINAL_GENERATION");
          if (rule === "T1")
            demand(
              evidence.some((e) => e.family === "OBSERVATION") &&
                evidence.some((e) => e.family === "BAR"),
              "EVIDENCE_MISSING",
            );
          else if (["T2", "T3", "T4", "T5"].includes(rule)) {
            const manifest = context.predicateManifests.find(
              (m) => m.fromState === previous.state && m.toState === to,
            );
            demand(
              manifest &&
                context.subject.hypothesisRef !== null &&
                manifest.enabled &&
                manifest.hypothesisRef === context.subject.hypothesisRef &&
                manifest.configurationReleaseRef === input.configurationReleaseRef,
              "POLICY_DISABLED",
            );
            demand(
              evidence.every(
                (e) =>
                  milliseconds(input.decisionCutoff) - milliseconds(e.eventAt) <=
                  Math.min(manifest.maxAgeMs, policy.limits.defaultEvidenceMaxAgeMs),
              ),
              "EVIDENCE_STALE",
            );
            demand(evaluatePredicate(manifest, evidence, policy), "PREDICATE_UNSATISFIED");
          } else if (rule === "T8")
            demand(
              evidence.some((e) => e.family === "REVOCATION"),
              "EVIDENCE_MISSING",
            );
          else if (rule === "T9")
            demand(
              milliseconds(input.decisionCutoff) >= milliseconds(previous.expiresAt),
              "NOT_EXPIRED",
            );
          else if (rule === "T6") {
            const manifest = context.predicateManifests.find((m) => m.toState === previous.state);
            demand(
              manifest &&
                manifest.enabled &&
                manifest.hypothesisRef === context.subject.hypothesisRef,
              "EVIDENCE_MISSING",
            );
            const corrections = evidence.filter(
              (e) => e.family === "BAR" && e.correctionOf !== null,
            );
            demand(corrections.length > 0, "EVIDENCE_MISSING");
            const replacements = new Map(corrections.map((e) => [e.correctionOf, e.recordId]));
            demand(
              manifest.requiredDimensions.some((d) => replacements.has(d)),
              "CORRECTION_LINEAGE",
            );
            const reassessed = {
              ...manifest,
              requiredDimensions: manifest.requiredDimensions.map((d) => replacements.get(d) ?? d),
              clauses: manifest.clauses.map((c) => ({
                ...c,
                dimensionRef: replacements.get(c.dimensionRef) ?? c.dimensionRef,
              })),
            };
            demand(!evaluatePredicate(reassessed, evidence, policy), "PREDICATE_UNSATISFIED");
          } else if (rule === "T7")
            demand(
              evidence.some(
                (e) =>
                  e.family === "DECLARATION" && object(nativePayload(e)).watchDeactivated === true,
              ),
              "EVIDENCE_MISSING",
            );
          reason =
            rule === "T8"
              ? "INVALIDATED"
              : rule === "T9"
                ? "EXPIRED"
                : rule === "T6"
                  ? "EVIDENCE_WEAKENED"
                  : rule === "T7"
                    ? "WATCH_DEACTIVATED"
                    : rule === "T1"
                      ? "OBSERVATION_ADMITTED"
                      : rule === "T2"
                        ? "INTEREST_ESTABLISHED"
                        : rule === "T3"
                          ? "SETUP_FORMING_ESTABLISHED"
                          : rule === "T4"
                            ? "CANDIDATE_ESTABLISHED"
                            : "OPPORTUNITY_QUALIFIED";
          disposition = "TRANSITION";
        }
      }
      demand(policy.limits.maxReasons >= (secondaryExpiry ? 2 : 1), "BUDGET_EXHAUSTED");
      const normalizedInput = { ...input, evidence: evidence.map(metadata) };
      const normalizedContext = { ...context, nativeEvidenceRefs: evidence.map(metadata) };
      const normalizedCapture = { ...capture, evidence };
      const body = {
        schema: "ate.opportunity-decision/1" as const,
        disposition,
        key: input.key,
        from: previous?.state ?? null,
        to,
        expectedHead: input.expectedHead,
        reasonCodes: [reason, ...(secondaryExpiry ? ["EXPIRED"] : [])],
        evidence: evidence.map(metadata),
        authorityBasis: "HISTORICAL_AS_KNOWN" as const,
        currentUsability: "UNKNOWN" as const,
        tradingAuthority: false as const,
      };
      const proposal = {
        ...body,
        eventFingerprint: fingerprint("ate.opportunity-event/1", {
          key: input.key,
          sequence: (previous?.head.eventSequence ?? 0) + 1,
          previousEventFingerprint: context.previousEventFingerprint,
          commandId: input.commandId,
          payloadFingerprint: fingerprint("ate.opportunity-payload/1", {
            ...body,
            input: normalizedInput,
            context: normalizedContext,
            capture: normalizedCapture,
            policy,
          }),
          policyFingerprint: input.policyFingerprint,
          decisionCutoff: input.decisionCutoff,
        }),
      };
      meter.capture(proposal, policy.limits.maxOutputBytes);
      return sealProposal(proposal, {
        input: normalizedInput,
        context: normalizedContext,
        capture: normalizedCapture,
        policy,
      });
    }),
  );
}
