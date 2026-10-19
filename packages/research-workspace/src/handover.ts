import { promptOwners } from "@ate/research-reporting";
import { guard, array, object, demand, freeze } from "./validation.js";
import { snapshot } from "./serialization.js";
import type { WorkspacePolicy } from "./contracts.js";
import { readWorkspace } from "./workspace.js";
/** UI-neutral descriptors only. No component, listener, endpoint or action grant. */
export function buildHandoverDescriptors(raw: unknown, policy?: WorkspacePolicy) {
  return guard(() => {
    const { view, work, policy: p } = readWorkspace(raw, policy);
    const report = view.report === null ? null : object(view.report!);
    const result = {
      schema: "ate.workspace.handover/1",
      originalWorkspaceFingerprint: view.fingerprint!,
      originalReportFingerprint: view.reportFingerprint!,
      baselines: {
        knowledge: view.knowledgeBaseline!,
        reporting: view.reportingValidationBaseline!,
        governance: view.governanceRelease!,
      },
      groups: [
        "FOUNDATIONS",
        "MARKET_RESEARCH",
        "INSTRUMENT_INTELLIGENCE",
        "SURVEILLANCE",
        "ENHANCEMENTS",
      ],
      modules: promptOwners.map((owner, i) => ({
        prompt: i + 1,
        owner,
        ownerVersion: "UNESTABLISHED",
        currentHealth: "UNESTABLISHED",
        currentReadiness: "UNESTABLISHED",
      })),
      navigation: [
        "KNOWLEDGE",
        "REPORTS",
        "DIAGNOSTICS",
        "CONFIGURATION_GUIDANCE",
        "IMPROVEMENT_PROPOSALS",
        "QUALIFICATIONS",
      ],
      hierarchy: [
        "SOURCE_AND_RELEASE_IDENTITY",
        "EVIDENCE_AVAILABILITY_AND_CONSISTENCY",
        "OWNER_QUALIFIED_AXES",
        "OBLIGATIONS_AND_QUALIFIED_COVERAGE",
        "HELP_AND_QUALIFICATIONS",
      ],
      helpRefs: array(object(view.knowledge!).entries).map((v) => {
        const e = object(v);
        return { entryId: e.id!, revision: e.revision!, namespace: e.namespace! };
      }),
      tableColumns: [
        "OWNER",
        "SOURCE_VERSION",
        "EFFECTIVE_AT",
        "AVAILABLE_AT",
        "AXIS",
        "NATIVE_STATUS",
        "UNIT",
        "EVIDENCE_ID",
        "QUALIFICATIONS",
      ],
      unitPolicy: "OWNER_DECLARED_NO_INFERRED_UNIT_CONVERSION",
      chartRefs:
        report === null
          ? []
          : array(report.charts).map((v) => {
              const c = object(v);
              return {
                chartId: c.id!,
                kind: c.kind!,
                originalReportFingerprint: view.reportFingerprint!,
                dataTableAlternative: true,
              };
            }),
      emptyStates: {
        missingReport: "UNKNOWN_NOT_ABSENT",
        emptyRows: "SUPPLIED_SUBSET_ONLY",
        consistency: "CONSISTENCY_UNESTABLISHED",
        currentAuthority: "UNKNOWN",
        approval: "NOT_ESTABLISHED",
      },
      accessibility: {
        keyboard: true,
        textAlternatives: true,
        colorOnlyStatus: false,
        semanticTables: true,
        focusRestoration: true,
      },
      frontendImplemented: false,
      transport: "NONE",
      ownerReadRoutes: [],
    };
    const checked = snapshot(result, work);
    demand(
      Buffer.byteLength(JSON.stringify(checked)) <= p.maxOutputBytes,
      "WORKSPACE:BUDGET_EXHAUSTED",
    );
    return freeze(result);
  });
}
