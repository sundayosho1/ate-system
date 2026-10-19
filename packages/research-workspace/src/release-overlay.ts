import { baselines, qualificationIds } from "./contracts.js";
import { snapshot, fingerprint } from "./serialization.js";
import { object, array, exact, text, path, utc, demand, guard, freeze } from "./validation.js";
import type { ObjectValue, WorkspacePolicy } from "./contracts.js";
import type { Budget } from "./budgets.js";
import { begin } from "./budgets.js";
import { W1 } from "./policy.js";
export function overlayWithin(raw: ObjectValue, context: ObjectValue, work: Budget): ObjectValue {
  exact(raw, [
    "schema",
    "id",
    "revision",
    "knowledgeSourceCommit",
    "knowledgeManifestFingerprint",
    "reportingValidationBaseline",
    "acceptedGovernanceCommit",
    "acceptedRecordRefs",
    "scope",
    "qualifications",
    "sourceBindings",
    "observedAt",
    "authority",
    "currentHealth",
    "currentReadiness",
  ]);
  demand(raw.schema === "ate.workspace.release/1");
  text(raw.id);
  demand(Number.isSafeInteger(raw.revision) && Number(raw.revision) >= 1);
  demand(
    raw.knowledgeSourceCommit === baselines.knowledge &&
      raw.reportingValidationBaseline === baselines.reporting &&
      raw.acceptedGovernanceCommit === baselines.governance,
    "WORKSPACE:SOURCE_BINDING_MISMATCH",
  );
  demand(
    raw.scope === "OFFLINE_RESEARCH_ONLY" &&
      raw.authority === "NON_AUTHORITATIVE_RELEASE_METADATA" &&
      raw.currentHealth === "UNESTABLISHED" &&
      raw.currentReadiness === "UNESTABLISHED",
  );
  utc(raw.observedAt);
  exact(context, [
    "authenticatedCommit",
    "verifiedBindings",
    "qualificationRegisterFingerprint",
    "clock",
  ]);
  demand(
    context.authenticatedCommit === baselines.governance,
    "WORKSPACE:RELEASE_AUTHENTICATION_UNESTABLISHED",
  );
  for (const h of [raw.knowledgeManifestFingerprint, context.qualificationRegisterFingerprint])
    demand(typeof h === "string" && /^sha256:[a-f0-9]{64}$/.test(h));
  const bindings = array(raw.sourceBindings),
    records = array(raw.acceptedRecordRefs),
    verified = array(context.verifiedBindings);
  demand(bindings.length > 0 && records.length > 0);
  const ids = new Set<string>();
  for (const v of [...bindings, ...records]) {
    const b = object(v);
    exact(b, ["path", "commit", "sha256"]);
    path(b.path);
    demand(typeof b.commit === "string" && /^[a-f0-9]{40}$/.test(b.commit));
    demand(typeof b.sha256 === "string" && /^sha256:[a-f0-9]{64}$/.test(b.sha256));
    const id = String(b.commit) + ":" + String(b.path);
    demand(!ids.has(id), "WORKSPACE:SOURCE_BINDING_MISMATCH");
    ids.add(id);
    demand(
      verified.some((x) => fingerprint(x, work) === fingerprint(b, work)),
      "WORKSPACE:RELEASE_AUTHENTICATION_UNESTABLISHED",
    );
  }
  demand(
    array(raw.qualifications).length > 0 &&
      array(raw.qualifications).every((q) => typeof q === "string" && qualificationIds.includes(q)),
  );
  return freeze({ ...raw, fingerprint: fingerprint(raw, work) });
}
export function validateReleaseOverlay(
  raw: unknown,
  context: unknown,
  policy: WorkspacePolicy = W1,
) {
  return guard(() => {
    const work = begin(policy);
    return overlayWithin(object(snapshot(raw, work)), object(snapshot(context, work)), work);
  });
}
