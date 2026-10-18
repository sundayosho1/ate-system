import { ok, fail, domainIssue, parseUtcTimestamp, type DomainResult } from "@ate/domain";
import type { InsightRecord, JsonValue } from "./facts.js";
import { R1 } from "./resource-profile.js";
export const contractDefinitions = {
  EvidenceReference: [
    "evidence",
    {
      id: "id",
      owner: "id",
      ownerVersion: "id",
      sourceCommit: "commit",
      artifactType: "id",
      nativeIdentity: "json",
      nativeFingerprint: "fingerprintFact",
      immutable: "boolean",
      locator: "fact",
      accessScope: "id",
      sourceTimes: "times",
      policyRefs: "ids",
    },
  ],
  OwnerReadObservation: [
    "observation",
    {
      id: "id",
      adapterVersion: "id",
      allowlistEntry: "id",
      ownerContext: "json",
      queryFingerprint: "hash",
      readStart: "utc",
      readEnd: "utc",
      mode: "mode",
      nativeResultRef: "fact",
      disposition: "disposition",
      evidenceIds: "ids",
      qualifications: "ids",
      consistencyId: "id",
    },
  ],
  NativeResultEvidence: [
    "native-result",
    {
      owner: "id",
      schemaVersion: "id",
      operation: "id",
      phase: "id",
      selectedDiscriminator: "boolean",
      nativeCommitment: "commitmentFact",
      auditCorrelation: "fact",
      representationDigest: "fingerprintFact",
    },
  ],
  ConsistencyEvidence: [
    "consistency",
    {
      id: "id",
      scope: "id",
      mode: "consistencyMode",
      identityVector: "array",
      readInterval: "interval",
      completeness: "fact",
      reasons: "ids",
      barrierRef: "fact",
    },
  ],
  DiagnosticFacet: [
    "diagnostic",
    {
      id: "id",
      owner: "id",
      subjectTuple: "array",
      axis: "axis",
      nativeStatus: "fact",
      observationId: "id",
      temporalScope: "temporal",
      currentAuthority: "fact",
      qualifications: "ids",
    },
  ],
  ReasonReference: [
    "reason",
    {
      id: "id",
      owner: "id",
      nativeCode: "id",
      schemaVersion: "id",
      operation: "id",
      phase: "id",
      severitySource: "severitySource",
      consequence: "text",
      helpEntryId: "id",
      safeNextStep: "text",
      evidenceIds: "ids",
    },
  ],
  ObligationReference: [
    "obligation",
    {
      owner: "id",
      operation: "id",
      originalIdentity: "id",
      subjectTuple: "array",
      originalPayloadFingerprint: "fingerprintFact",
      nativeCommitment: "commitmentFact",
      state: "id",
      historicalAckRefs: "ids",
      currentCheckRef: "fact",
    },
  ],
  CoverageStatement: [
    "coverage",
    {
      owner: "id",
      scope: "id",
      numerator: "countFact",
      denominator: "countFact",
      unit: "id",
      evidenceVector: "array",
      suppression: "countFact",
      consistencyId: "id",
      temporalScope: "temporal",
      claim: "coverageClaim",
    },
  ],
  ReportManifest: [
    "report",
    {
      id: "id",
      baseline: "commit",
      projectionVersion: "id",
      requestFingerprint: "hash",
      generatedAt: "utc",
      sourceObservationIds: "ids",
      exactEvidenceVector: "array",
      requestedFacets: "ids",
      missingFacets: "ids",
      budgetUsage: "json",
      qualifications: "ids",
      exportStatus: "exportStatus",
      reportFingerprint: "hash",
    },
  ],
  KnowledgeEntry: [
    "knowledge",
    {
      id: "id",
      type: "entryType",
      namespace: "id",
      revision: "count",
      contentVersion: "id",
      sourceRefs: "nonemptyIds",
      temporalScope: "knowledgeTemporal",
      definition: "text",
      relatedEntryIds: "ids",
      qualifications: "ids",
      reviewStatus: "reviewStatus",
      personaTags: "personas",
    },
  ],
  ConfigurationGuide: [
    "configuration",
    {
      owner: "id",
      key: "id",
      schemaRef: "id",
      fieldPath: "id",
      type: "id",
      unit: "id",
      default: "fact",
      bounds: "fact",
      scope: "ids",
      overrides: "text",
      dependencies: "ids",
      risk: "text",
      restart: "text",
      authority: "text",
      activeVersion: "fact",
      sourceRefs: "nonemptyIds",
    },
  ],
  ImprovementProposal: [
    "improvement",
    {
      id: "id",
      revision: "count",
      evidenceIds: "nonemptyIds",
      affectedOwners: "nonemptyIds",
      findingRefs: "ids",
      hypothesis: "text",
      boundedChange: "text",
      qualificationImpact: "text",
      suggestedTests: "nonemptyIds",
      workflowStatus: "workflow",
      decisionRef: "fact",
      supersedes: "fact",
    },
  ],
} as const;
export type InsightKind = "Fact" | keyof typeof contractDefinitions;
const enums: Record<string, readonly string[]> = {
  mode: ["STATIC_SOURCE_METADATA", "HISTORICAL_IMMUTABLE_EVIDENCE", "OWNER_SCOPED_OBSERVATION"],
  disposition: ["OBSERVED", "OWNER_REJECTED", "UNAVAILABLE", "INVALID", "OVER_BUDGET", "CANCELLED"],
  consistencyMode: [
    "OWNER_IMMUTABLE_PIN",
    "OWNER_SUPPORTED_BARRIER",
    "SEQUENTIAL_UNESTABLISHED",
    "NOT_APPLICABLE",
  ],
  axis: ["LIFECYCLE", "HEALTH", "READINESS", "QUALITY", "AUTHORITY", "COVERAGE", "OBLIGATION"],
  temporal: ["CURRENT", "HISTORICAL", "UNESTABLISHED"],
  knowledgeTemporal: ["CURRENT_EXPLANATION", "HISTORICAL_SOURCE", "FUTURE_RESERVED"],
  coverageClaim: ["OWNER_DECLARED_ONLY", "QUALIFIED_PARTIAL", "UNESTABLISHED", "UNSUPPORTED"],
  exportStatus: ["REQUESTED_FACETS_EXPORTED", "PARTIAL", "BLOCKED"],
  entryType: ["MODULE", "TERM", "TASK", "CONFIG", "REASON", "RUNBOOK", "STATUS"],
  reviewStatus: ["SOURCE_EXTRACTED", "SOURCE_REVIEWED", "OWNER_DECISION_REFERENCED"],
  severitySource: ["OWNER", "AUDIT", "PROJECTION"],
  workflow: [
    "DRAFT",
    "EVIDENCE_LINKED",
    "OWNER_REVIEW_REQUESTED",
    "OWNER_AUTHORIZED",
    "DEFERRED",
    "REJECTED",
    "IMPLEMENTED_WITH_SOURCE_REF",
    "TECHNICAL_RECOMMENDATION",
    "GOVERNANCE_DISPOSITION",
  ],
};
export function issue(code: string, message = code): DomainResult<never> {
  return fail(domainIssue(code, message));
}
export function frozen<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) frozen(v);
    Object.freeze(value);
  }
  return value;
}
/** Projection data only. Never invokes accessors/hooks or serializes native owner objects. */
export function snapshot(
  raw: unknown,
  maxBytes: number = R1.request.maxBytes,
  maxDepth: number = R1.request.maxDepth,
  maxNodes: number = R1.request.maxNodes,
  cancelled: boolean = false,
): DomainResult<JsonValue> {
  let bytes = 0,
    nodes = 0;
  const ancestors = new Set<object>();
  const add = (n: number) => {
    bytes += n;
    if (bytes > maxBytes) throw Error("INSIGHT_INPUT_BOUNDS");
  };
  const visit = (v: unknown, depth: number): JsonValue => {
    if (nodes % R1.cancellation.serializationBatchNodes === 0 && cancelled)
      throw Error("INSIGHT_CANCELLED");
    if (++nodes > maxNodes || depth > maxDepth) throw Error("INSIGHT_INPUT_BOUNDS");
    if (v === null) {
      add(4);
      return null;
    }
    if (typeof v === "string") {
      if (Buffer.byteLength(v, "utf8") > maxBytes) throw Error("INSIGHT_INPUT_BOUNDS");
      add(Buffer.byteLength(JSON.stringify(v)));
      return v;
    }
    if (typeof v === "boolean") {
      add(v ? 4 : 5);
      return v;
    }
    if (typeof v === "number" && Number.isFinite(v)) {
      add(Buffer.byteLength(JSON.stringify(v)));
      return Object.is(v, -0) ? 0 : v;
    }
    if (typeof v !== "object") throw Error("INSIGHT_SCHEMA_INVALID");
    if (ancestors.has(v)) throw Error("INSIGHT_CYCLIC_INPUT");
    ancestors.add(v);
    try {
      const proto: unknown = Object.getPrototypeOf(v);
      if (!Array.isArray(v) && proto !== Object.prototype && proto !== null)
        throw Error("INSIGHT_SCHEMA_INVALID");
      const keys = Reflect.ownKeys(v);
      if (keys.length > maxNodes - nodes + 1) throw Error("INSIGHT_INPUT_BOUNDS");
      if (
        keys.some(
          (k) => typeof k !== "string" || ["__proto__", "constructor", "prototype"].includes(k),
        )
      )
        throw Error("INSIGHT_SCHEMA_INVALID");
      add(2);
      if (Array.isArray(v)) {
        const len = Object.getOwnPropertyDescriptor(v, "length")?.value as unknown;
        if (typeof len !== "number" || len > maxNodes - nodes || keys.length !== len + 1)
          throw Error("INSIGHT_INPUT_BOUNDS");
        const result: JsonValue[] = [];
        for (let i = 0; i < len; i++) {
          const d = Object.getOwnPropertyDescriptor(v, String(i));
          if (!d || !("value" in d) || !d.enumerable) throw Error("INSIGHT_ACCESSOR_REJECTED");
          if (i) add(1);
          result.push(visit(d.value, depth + 1));
        }
        return result;
      }
      const result: Record<string, JsonValue> = {};
      let first = true;
      for (const k of (keys as string[]).sort()) {
        const d = Object.getOwnPropertyDescriptor(v, k);
        if (!d || !("value" in d) || !d.enumerable) throw Error("INSIGHT_ACCESSOR_REJECTED");
        if (!first) add(1);
        first = false;
        add(Buffer.byteLength(JSON.stringify(k)) + 1);
        result[k] = visit(d.value, depth + 1);
      }
      return result;
    } finally {
      ancestors.delete(v);
    }
  };
  try {
    if (cancelled) return issue("INSIGHT_CANCELLED");
    const value = frozen(visit(raw, 0));
    if (cancelled) return issue("INSIGHT_CANCELLED");
    return ok(value);
  } catch (e) {
    return issue(
      e instanceof Error && e.message.startsWith("INSIGHT_")
        ? e.message
        : "INSIGHT_ACCESSOR_REJECTED",
    );
  }
}
const object = (v: JsonValue | undefined): v is Record<string, JsonValue> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: JsonValue | undefined, max = 256): v is string =>
  typeof v === "string" && v.length > 0 && Buffer.byteLength(v) <= max;
const ids = (v: JsonValue | undefined, nonempty = false): v is string[] =>
  Array.isArray(v) &&
  (!nonempty || v.length > 0) &&
  v.length <= 10000 &&
  (v as readonly JsonValue[]).every((x) => text(x));
const hash = (v: JsonValue | undefined) => typeof v === "string" && /^sha256:[a-f0-9]{64}$/.test(v);
const utc = (v: JsonValue | undefined) =>
  typeof v === "string" &&
  (() => {
    const p = parseUtcTimestamp(v);
    return p.ok && p.value === v;
  })();
const count = (v: JsonValue | undefined) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
function fact(v: JsonValue | undefined, subtype = "json"): boolean {
  if (!object(v)) return false;
  if (v.kind === "KNOWN")
    return (
      Object.keys(v).sort().join(",") === "evidenceIds,kind,value" &&
      ids(v.evidenceIds, true) &&
      valid(subtype, v.value)
    );
  if (v.kind === "UNKNOWN" || v.kind === "UNSUPPORTED")
    return Object.keys(v).sort().join(",") === "kind,reasonIds" && ids(v.reasonIds, true);
  return (
    v.kind === "NOT_APPLICABLE" &&
    Object.keys(v).sort().join(",") === "justification,kind" &&
    text(v.justification, 32768)
  );
}
function valid(type: string, v: JsonValue | undefined): boolean {
  if (type.endsWith("Fact"))
    return fact(
      v,
      type.slice(0, -4) === "fingerprint"
        ? "hash"
        : type.slice(0, -4) === "commitment"
          ? "commitment"
          : type.slice(0, -4),
    );
  if (type === "fact") return fact(v);
  if (type === "json") return v !== undefined;
  if (type === "id") return text(v);
  if (type === "text") return text(v, 32768);
  if (type === "hash") return hash(v);
  if (type === "commit") return typeof v === "string" && /^[a-f0-9]{40}$/.test(v);
  if (type === "utc") return utc(v);
  if (type === "count") return count(v);
  if (type === "boolean") return typeof v === "boolean";
  if (type === "ids" || type === "nonemptyIds") return ids(v, type === "nonemptyIds");
  if (type === "personas")
    return (
      ids(v, true) &&
      new Set(v).size === v.length &&
      v.every((x) => ["user", "administrator", "developer", "troubleshooting"].includes(x))
    );
  if (type === "array") return Array.isArray(v);
  if (type === "commitment") return typeof v === "string" && ["ACK", "NONE", "UNKNOWN"].includes(v);
  if (type === "times") return object(v) && Object.values(v).every((x) => fact(x, "utc"));
  if (type === "interval")
    return (
      object(v) &&
      Object.keys(v).sort().join(",") === "end,start" &&
      utc(v.start) &&
      utc(v.end) &&
      (v.start as string) <= (v.end as string)
    );
  return typeof v === "string" && (enums[type]?.includes(v) ?? false);
}
export function validateInsightRecord(
  kind: InsightKind,
  raw: unknown,
): DomainResult<InsightRecord | JsonValue> {
  if (typeof kind !== "string" || (kind !== "Fact" && !Object.hasOwn(contractDefinitions, kind)))
    return issue("INSIGHT_SCHEMA_UNSUPPORTED");
  const snap = snapshot(
    raw,
    kind === "KnowledgeEntry" ? R1.knowledge.maxEntryBytes : R1.request.maxBytes,
  );
  if (!snap.ok) return snap;
  const v = snap.value;
  if (kind === "Fact") return fact(v) ? ok(v) : issue("INSIGHT_SCHEMA_INVALID");
  if (!object(v)) return issue("INSIGHT_SCHEMA_INVALID");
  const [slug, fields] = contractDefinitions[kind];
  if (v.schema !== `ate.insights.${slug}/1`) return issue("INSIGHT_SCHEMA_UNSUPPORTED");
  const extras = kind === "NativeResultEvidence" ? ["selectedValueRef", "selectedFailure"] : [];
  if (
    Object.keys(v).some((k) => k !== "schema" && !Object.hasOwn(fields, k) && !extras.includes(k))
  )
    return issue("INSIGHT_SCHEMA_INVALID");
  for (const [k, t] of Object.entries(fields))
    if (!valid(t, v[k])) return issue("INSIGHT_SCHEMA_INVALID", k);
  if (kind === "NativeResultEvidence") {
    if (v.selectedDiscriminator === true) {
      if (!fact(v.selectedValueRef) || Object.hasOwn(v, "selectedFailure"))
        return issue("INSIGHT_SCHEMA_INVALID");
    } else if (
      !object(v.selectedFailure) ||
      Object.keys(v.selectedFailure).sort().join(",") !== "code,detail,family" ||
      Object.hasOwn(v, "selectedValueRef") ||
      !text(v.selectedFailure.code) ||
      !text(v.selectedFailure.family) ||
      !Object.hasOwn(v.selectedFailure, "detail")
    )
      return issue("INSIGHT_SCHEMA_INVALID");
  }
  if (kind === "EvidenceReference") {
    const times = v.sourceTimes as Record<string, JsonValue>;
    const knownTime = (k: string) => {
      const f = times[k];
      return object(f) && f.kind === "KNOWN" ? (f.value as string) : undefined;
    };
    const available = knownTime("availableAt"),
      cutoff = knownTime("knowledgeCutoff") ?? knownTime("asOf");
    if (available && cutoff && available > cutoff) return issue("INSIGHT_TEMPORAL_INCONSISTENCY");
  }
  if (kind === "OwnerReadObservation" && (v.readStart as string) > (v.readEnd as string))
    return issue("INSIGHT_TEMPORAL_INCONSISTENCY");
  if (
    kind === "ConsistencyEvidence" &&
    ["OWNER_IMMUTABLE_PIN", "OWNER_SUPPORTED_BARRIER"].includes(v.mode as string) &&
    (!object(v.barrierRef) ||
      v.barrierRef.kind !== "KNOWN" ||
      !Array.isArray(v.identityVector) ||
      !v.identityVector.length)
  )
    return issue("INSIGHT_EVIDENCE_UNESTABLISHED");
  if (
    kind === "DiagnosticFacet" &&
    v.temporalScope !== "CURRENT" &&
    object(v.currentAuthority) &&
    v.currentAuthority.kind === "KNOWN" &&
    v.currentAuthority.value !== false
  )
    return issue("INSIGHT_AUTHORITY_UNESTABLISHED");
  if (kind === "CoverageStatement") {
    const n = v.numerator as Record<string, JsonValue>,
      d = v.denominator as Record<string, JsonValue>;
    if (n.kind === "KNOWN" && d.kind === "KNOWN" && Number(n.value) > Number(d.value))
      return issue("INSIGHT_COVERAGE_UNESTABLISHED");
    if (v.claim === "OWNER_DECLARED_ONLY" && (d.kind !== "KNOWN" || n.kind !== "KNOWN"))
      return issue("INSIGHT_COVERAGE_UNESTABLISHED");
  }
  if (kind === "ReportManifest") {
    if (
      (v.exactEvidenceVector as JsonValue[]).length > 1000 ||
      (v.requestedFacets as JsonValue[]).length > 2000
    )
      return issue("INSIGHT_INPUT_BOUNDS");
    if (v.exportStatus === "REQUESTED_FACETS_EXPORTED" && (v.missingFacets as JsonValue[]).length)
      return issue("INSIGHT_EVIDENCE_UNESTABLISHED");
  }
  return ok(v);
}
export function validateResourceProfile(raw: unknown): DomainResult<typeof R1> {
  const s = snapshot(raw);
  if (!s.ok) return s;
  const expected = snapshot(R1);
  if (!expected.ok) return expected;
  return JSON.stringify(s.value) === JSON.stringify(expected.value)
    ? ok(frozen(s.value) as typeof R1)
    : issue("INSIGHT_PROFILE_MISMATCH");
}
