import type { WorkspacePolicy } from "./contracts.js";
import { guard, demand, freeze } from "./validation.js";
import { readWorkspace } from "./workspace.js";
import { snapshot, fingerprint } from "./serialization.js";
export function serializeWorkspaceExport(raw: unknown, policy?: WorkspacePolicy) {
  return guard(() => {
    const { view, work, policy: p } = readWorkspace(raw, policy);
    const safe = {
      schema: "ate.workspace.export/1",
      originalWorkspaceFingerprint: view.fingerprint!,
      originalReportFingerprint: view.reportFingerprint!,
      scope: view.scope!,
      currentAuthority: "UNKNOWN",
      qualifications: view.qualifications!,
      axes: ["LIFECYCLE", "HEALTH", "READINESS", "QUALITY", "AUTHORITY", "COVERAGE", "OBLIGATION"],
      redactionPolicy: "SAFE_METADATA_ONLY_V1",
    };
    const projectionFingerprint = fingerprint(safe, work),
      bytes = JSON.stringify(snapshot({ ...safe, projectionFingerprint }, work));
    demand(Buffer.byteLength(bytes) <= p.maxExportBytes, "WORKSPACE:BUDGET_EXHAUSTED");
    return freeze({
      bytes,
      projectionFingerprint,
      originalWorkspaceFingerprint: view.fingerprint!,
    });
  });
}
