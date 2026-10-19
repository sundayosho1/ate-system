import type { JsonValue } from "@ate/research-insight-contracts";
import type { W1 } from "./policy.js";
import type { Clock } from "@ate/time";
export type { JsonValue };
export type ObjectValue = { readonly [key: string]: JsonValue };
export type WorkspaceResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; issues: readonly Readonly<{ code: string; message: string }>[] }>;
export type WorkspacePolicy = Readonly<Record<keyof typeof W1, number>>;
export interface WorkspaceContext {
  readonly releaseAuthentication: unknown;
  readonly clock: Clock;
  readonly cancelled: boolean;
}
export const baselines = Object.freeze({
  knowledge: "6307f53d4febe2bd731e00d73d429546fc29d5ee",
  reporting: "2cb81c1d33462f20ce15a4616eb971296d2d44ee",
  governance: "fe587fb12d9eefe41e4d2234b9d7962fb323bab9",
});
export const scope = "SUPPLIED_BOUNDED_INPUT_ONLY";
export const qualificationIds = Object.freeze([
  "A22-Q01",
  "A22-Q02",
  "A22-Q03",
  "A22-Q04",
  "A22-Q05",
  "A22-Q06",
  "F05",
  "F06",
  "T01",
  "M02",
  "O-C01",
  "O-C02",
  "Q01-A",
  "Q-HIST",
  "Q-TICK",
  "Q-SELECTOR",
  "Q-T01",
  "INHERITED-OTHER",
  "E-T01",
  "REVIEWER-PARTICIPATION",
  "A23-Q01",
  "A23-Q02",
  "A23-Q03",
  "HISTORICAL-EVIDENCE",
  "RESEARCH-SCOPE",
  "C-Q01",
  "C-Q02",
  "M-Q01 / L-Q01",
  "M-Q02",
  "A26-Q01",
  "A26C-L01",
  "Included-zero-event",
  "Missing native envelope",
  "V-R01",
  "V-R02",
  "V-R03",
  "V-R04",
  "V-R05",
  "V-R06",
  "V-R07",
  "V-R08",
  "AC01",
  "AC02",
  "AC03",
  "AC04",
  "AC05",
  "AC06",
  "AC07",
  "AC08",
  "B-R01",
  "B-R02",
  "B-R03",
  "B-R04",
  "B-R05",
  "B-R06",
  "B-R07",
  "B-R08",
  "B-R09",
  "B-R10",
  "B-R11",
  "B-R12",
  "D-R01",
  "D-R02",
  "D-R03",
  "D-R04",
  "D-R05",
  "D-R06",
  "D-R07",
  "D-R08",
  "D-R09",
  "D-R10",
  "D-R11",
  "D-R12",
  "C-Q03",
  "C-Q04",
  "C-OP01",
  "D-E-L01",
  "E-G01",
  "E-G02",
  "E-G03",
  "E-G04",
  "E-G05",
  "E-G06",
  "E-G07",
  "E-G08",
]);

export type ReleaseOverlay = ObjectValue &
  Readonly<{
    schema: "ate.workspace.release/1";
    id: string;
    revision: number;
    knowledgeSourceCommit: string;
    knowledgeManifestFingerprint: string;
    reportingValidationBaseline: string;
    acceptedGovernanceCommit: string;
    acceptedRecordRefs: readonly JsonValue[];
    scope: "OFFLINE_RESEARCH_ONLY";
    qualifications: readonly string[];
    sourceBindings: readonly JsonValue[];
    observedAt: string;
    authority: "NON_AUTHORITATIVE_RELEASE_METADATA";
    currentHealth: "UNESTABLISHED";
    currentReadiness: "UNESTABLISHED";
  }>;
export type KnowledgeReportLink = ObjectValue &
  Readonly<{
    id: string;
    knowledgeEntryId: string;
    knowledgeRevision: number;
    knowledgeFingerprint: string;
    reportFingerprint: string;
    facetId: string | null;
    owner: string;
    sourceCommit: string;
    qualificationIds: readonly string[];
    relationship: "CONTEXT_ONLY";
  }>;
export type WorkspaceQuery = Readonly<{
  schema: "ate.workspace.query/1";
  offset: number;
  limit?: number;
  owner?: string;
  prompt?: number;
  axis?: "LIFECYCLE" | "HEALTH" | "READINESS" | "QUALITY" | "AUTHORITY" | "COVERAGE" | "OBLIGATION";
  section?: "KNOWLEDGE" | "REPORT" | "DIAGNOSTICS" | "IMPROVEMENTS";
}>;
export type WorkspaceView = ObjectValue &
  Readonly<{
    schema: "ate.workspace.view/1";
    id: string;
    knowledgeBaseline: string;
    reportingValidationBaseline: string;
    governanceRelease: string;
    knowledgeFingerprint: string;
    reportFingerprint: string | null;
    report: JsonValue;
    knowledge: JsonValue;
    knowledgeSourceEvidence: JsonValue;
    links: readonly JsonValue[];
    diagnostics: readonly JsonValue[];
    qualifications: readonly JsonValue[];
    policy: WorkspacePolicy;
    generatedAt: string;
    scope: "SUPPLIED_BOUNDED_INPUT_ONLY";
    currentAuthority: "UNKNOWN";
    fingerprint: string;
  }>;
