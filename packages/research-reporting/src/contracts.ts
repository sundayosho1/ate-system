import type {
  Fact,
  JsonValue,
  DiagnosticFacet,
  ConsistencyEvidence,
  ReportManifest,
  ImprovementProposal,
} from "@ate/research-insight-contracts";
import type { Clock } from "@ate/time";
export type ReportingResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; issues: readonly Readonly<{ code: string; message: string }>[] }>;
export const axes = [
  "LIFECYCLE",
  "HEALTH",
  "READINESS",
  "QUALITY",
  "AUTHORITY",
  "COVERAGE",
  "OBLIGATION",
] as const;
export type Axis = (typeof axes)[number];
export const families = ["DIRECT", "DOMAIN", "COMMITMENT", "MOSE"] as const;
export type NativeFamily = (typeof families)[number];
export type CapturedNative = Readonly<{
  family: NativeFamily;
  selected: "DIRECT" | "SUCCESS" | "FAILURE";
  value: JsonValue;
  valuePresence: "PRESENT" | "UNDEFINED";
  code: Fact;
  commitment: Fact;
  auditCorrelation: Fact;
  valueSemantics: "UNVERIFIED_NATIVE_CAPTURE";
}>;
export type EvidenceArtifact = Readonly<{
  id: string;
  prompt: number;
  owner: string;
  ownerVersion: string;
  sourceCommit: string;
  nativeIdentity: string;
  nativeFingerprint: Fact;
  subject: readonly string[];
  unit: string;
  effectiveAt: string;
  availableAt: string | null;
  captured: CapturedNative;
}>;
/** Trusted composition input, never a field accepted from a report request or a signature. */
export type EvidenceAnchor = Readonly<{
  artifactId: string;
  captureDigest: string;
  sourceCommit: string;
  owner: string;
  reference: string;
}>;
export type FacetRequest = Readonly<{
  id: string;
  prompt: number;
  owner: string;
  subject: readonly string[];
  axis: Axis;
  artifactId: string;
  field: string;
  unit: string;
}>;
export type ReportRequest = Readonly<{
  schema: "ate.reporting.request/1";
  id: string;
  baseline: string;
  purpose: string;
  mode: "HISTORICAL" | "CURRENT";
  asOf: string;
  knowledgeCutoff: string;
  facets: readonly FacetRequest[];
}>;
export type ReportingPolicy = Readonly<{
  schema: "ate.reporting.policy/1";
  maxArtifacts: number;
  maxNativeBytes: number;
  maxDepth: number;
  maxNodes: number;
  maxReportBytes: number;
  maxEvidenceRefs: number;
  maxFacets: number;
  maxClockReads: number;
  maxCalls: number;
  maxCharts: number;
  maxSeries: number;
  maxPointsPerChart: number;
  maxPoints: number;
  maxImprovements: number;
  maxExportBytes: number;
  ownerReads: false;
  refresh: false;
  retries: 0;
}>;
export type ReportingContext = Readonly<{
  clock: Clock;
  anchors: readonly EvidenceAnchor[];
  cancelled?: boolean;
}>;
export type QualifiedObservation = Readonly<{
  artifact: EvidenceArtifact;
  captureDigest: string;
  provenance: "TRUSTED_CONTEXT_ANCHOR" | "UNESTABLISHED";
  qualification: "SOURCE_DECLARED_AVAILABILITY_NOT_INDEPENDENTLY_VERIFIED";
  anchorReference: Fact;
  pointInTime: "ESTABLISHED" | "UNESTABLISHED" | "OUTSIDE_CUTOFF";
}>;
export type ProjectedFacet = Readonly<{
  facet: DiagnosticFacet;
  status: "OBSERVED" | "UNAVAILABLE" | "INVALID" | "UNSUPPORTED";
  reasons: readonly string[];
  unit: string;
}>;
export type ChartPoint = Readonly<{
  id: string;
  value: Fact;
  unit: string;
  at: string;
  availableAt: string | null;
  evidenceId: string;
  correctionOf: string | null;
  finality: "FINAL" | "PROVISIONAL" | "UNKNOWN";
}>;
export type Chart = Readonly<{
  schema: "ate.reporting.chart/1";
  id: string;
  kind: "TABLE" | "TIMESERIES" | "BAR" | "SCATTER" | "STATUS_TIMELINE";
  label: string;
  legend: string;
  series: readonly Readonly<{ id: string; points: readonly ChartPoint[] }>[];
}>;
export type ReportBundle = Readonly<{
  schema: "ate.reporting.bundle/1";
  request: ReportRequest;
  policy: ReportingPolicy;
  manifest: ReportManifest;
  observations: readonly QualifiedObservation[];
  facets: readonly ProjectedFacet[];
  consistency: ConsistencyEvidence;
  charts: readonly Chart[];
  improvements: readonly ImprovementProposal[];
  improvementAuthority: "SUPPLIED_RECORDS_NOT_AUTHENTICATED_DECISIONS";
  projectionRequestComplete: boolean;
  status: "COMPLETE" | "PARTIAL";
  currentAuthority: Fact;
  budget: Readonly<{ calls: number; clockReads: number; nativeBytes: number }>;
}>;

export const reportQualifications = Object.freeze([
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
]);
