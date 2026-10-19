import {
  subjectSchema,
  originSchema,
  keySchema,
  id,
  type Subject,
  type Policy,
} from "./contracts.js";
import { fingerprint } from "./canonical.js";
import { O1, effectivePolicy } from "./policy.js";
import { Budget, operationBudget, inOperation, demand, guarded } from "./validation.js";
export function makeOpportunityKey(raw: unknown, policy: Policy, rawOrigin: unknown) {
  return inOperation(O1, () => {
    policy = effectivePolicy(policy);
    const meter = operationBudget(policy.limits);
    const subject = subjectSchema.parse(meter.capture(raw)),
      origin = originSchema.parse(meter.capture(rawOrigin));
    demand(
      subject.timeframes.length <= policy.limits.maxTimeframes &&
        new Set(subject.timeframes).size === subject.timeframes.length,
    );
    demand(subject.timeframes.join() === subject.timeframes.slice().sort().join());
    for (const value of [
      subject.researchSessionId,
      subject.universeSnapshotId,
      subject.canonicalInstrumentId,
      subject.watchDeclarationId,
      subject.hypothesisRef,
      ...subject.timeframes,
      origin.owner,
      origin.version,
      origin.namespace,
      origin.runtimeId,
      origin.manifestId,
      origin.sourceScope,
      policy.id,
      policy.version,
    ])
      demand(
        value === null || Buffer.byteLength(value) <= policy.limits.maxIdentifierBytes,
        "BUDGET_EXHAUSTED",
      );
    demand((subject.lifecycleGeneration === 1) === (subject.predecessorGenerationKey === null));
    demand(
      subject.sourceOriginFingerprint === fingerprint("ate.opportunity-origin/1", origin),
      "SOURCE_CONTEXT_MISMATCH",
    );
    return keySchema.parse(
      "opp28:" + fingerprint("ate.opportunity-key/1", { subject, origin, policy }).slice(7),
    );
  });
}
export const subjectFingerprint = (s: Subject) => fingerprint("ate.opportunity-subject/1", s);
export const originFingerprint = (origin: unknown) =>
  fingerprint("ate.opportunity-origin/1", origin);
export const policyFingerprint = (p: Policy) => fingerprint("ate.opportunity-policy/1", p);
export function validateOpportunityIdentity(raw: unknown) {
  return guarded(() => subjectSchema.parse(new Budget(O1).capture(raw)));
}
export function commandFingerprint(
  principal: string,
  key: string,
  commandId: string,
  payload: unknown,
) {
  id.parse(principal);
  id.parse(commandId);
  keySchema.parse(key);
  return fingerprint("ate.opportunity-command/1", { principal, key, commandId, payload });
}
