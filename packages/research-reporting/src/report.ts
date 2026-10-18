import { reportQualifications } from "./contracts.js";
import { validateInsightRecord } from "@ate/research-insight-contracts";
import type { JsonValue, ReportManifest } from "@ate/research-insight-contracts";
import type {
  QualifiedObservation,
  ReportRequest,
  ReportBundle,
  ReportingContext,
  ReportingPolicy,
} from "./contracts.js";
import {
  array,
  validateRequestWithinBudget,
  data,
  object,
  exact,
  id,
  utc,
  guard,
  demand,
  freeze,
  digest,
  byteSize,
  unknownFact,
} from "./validation.js";
import { checkedPolicy, createReportingPolicy, effectivePolicy, embeddedPolicy } from "./policy.js";
import { ReadBudgetLedger, TraversalBudget } from "./budgets.js";
import { validateArtifact, qualifyEvidence, ensureConsistentEvidence } from "./evidence.js";
import { projectFacet } from "./projection.js";
import { consistencyEvidence } from "./consistency.js";
import { buildChartsWithinBudget } from "./charts.js";
import { projectImprovementRegister } from "./improvements.js";
const activeClocks = new WeakSet<object>();
export function composeReport(input: unknown, context: ReportingContext, policy?: ReportingPolicy) {
  return guard(() => {
    const defaults = createReportingPolicy();
    demand(defaults.ok);
    const p = checkedPolicy(policy ?? defaults.value);
    const work = new TraversalBudget(p);
    const envelope = object(
      data(input, Math.min(p.maxNativeBytes + 65536, 1114112), 32, 50000, work),
    );
    exact(envelope, ["request", "evidence", "charts", "improvements"]);
    const parsed = validateRequestWithinBudget(envelope.request, work, 1);
    demand(parsed.ok);
    const request: ReportRequest = parsed.value;
    demand(request.facets.length <= p.maxFacets, "REPORTING:BUDGET_EXHAUSTED");
    demand(!context.cancelled, "REPORTING:CANCELLED");
    demand(
      context.clock && typeof context.clock === "object" && !activeClocks.has(context.clock),
      "REPORTING:REENTRANT_READ",
    );
    const clock = context.clock;
    activeClocks.add(clock);
    try {
      const now = clock.now;
      demand(typeof now === "function");
      const budget = new ReadBudgetLedger(p);
      budget.clock();
      const start = now.call(clock);
      utc(start);
      demand(
        request.asOf <= start && request.knowledgeCutoff <= start,
        "REPORTING:FUTURE_BOUNDARY",
      );
      demand(
        Array.isArray(envelope.evidence) && envelope.evidence.length <= p.maxArtifacts,
        "REPORTING:BUDGET_EXHAUSTED",
      );
      budget.evidence(byteSize(envelope.evidence));
      const anchors = data(context.anchors, 65536, 16, 10000, work);
      demand(Array.isArray(anchors) && anchors.length <= 32);
      const ids = new Set<string>();
      const observations = envelope.evidence
        .map((raw) => {
          const a = validateArtifact(raw, work, 2);
          demand(!ids.has(a.id), "REPORTING:EVIDENCE_IDENTITY_CONFLICT");
          ids.add(a.id);
          return qualifyEvidence(a, request, anchors as ReportingContext["anchors"], work);
        })
        .sort((a, b) => (a.artifact.id < b.artifact.id ? -1 : 1));
      ensureConsistentEvidence(
        observations.map((o) => o.artifact),
        work,
      );
      const facets = request.facets
        .map((f) =>
          projectFacet(
            f,
            observations.find((o) => o.artifact.id === f.artifactId),
            request,
          ),
        )
        .sort((a, b) => (a.facet.id < b.facet.id ? -1 : 1));
      const charts = buildChartsWithinBudget(envelope.charts!, observations, p, work, 2, 1);
      demand(charts.ok);
      const improvements = projectImprovementRegister(
        data(envelope.improvements!, 1048576, 32, 50000, work, 1),
        observations
          .filter((o) => o.provenance === "TRUSTED_CONTEXT_ANCHOR")
          .map((o) => o.artifact.id),
      );
      demand(improvements.ok);
      demand(improvements.value.records.length <= p.maxImprovements, "REPORTING:BUDGET_EXHAUSTED");
      demand(observations.length <= p.maxEvidenceRefs, "REPORTING:BUDGET_EXHAUSTED");
      budget.clock();
      const end = now.call(clock);
      utc(end);
      demand(end >= start, "REPORTING:CLOCK_MOVED_BACKWARD");
      demand(!context.cancelled, "REPORTING:CANCELLED");
      const consistency = consistencyEvidence(observations, start, end),
        complete = facets.every((f) => f.status === "OBSERVED");
      const body = {
        schema: "ate.reporting.bundle/1" as const,
        request,
        policy: p,
        observations,
        facets,
        consistency,
        charts: charts.value,
        improvements: improvements.value.records,
        improvementAuthority: "SUPPLIED_RECORDS_NOT_AUTHENTICATED_DECISIONS" as const,
        projectionRequestComplete: complete,
        status: complete ? ("COMPLETE" as const) : ("PARTIAL" as const),
        currentAuthority: unknownFact("REPORTING:CURRENT_AUTHORITY_UNESTABLISHED"),
        budget: budget.snapshot(),
      };
      const reportFingerprint = digest({ body, generatedAt: end }, work);
      const manifest: ReportManifest = {
        schema: "ate.insights.report/1",
        id: reportFingerprint,
        baseline: request.baseline,
        projectionVersion: "0.1.0-reporting-projection.1",
        requestFingerprint: digest(request, work, 1),
        generatedAt: end,
        sourceObservationIds: observations.map((o) => o.artifact.id),
        exactEvidenceVector: observations.map((o) => ({
          id: o.artifact.id,
          digest: o.captureDigest,
          origin: o.provenance,
        })),
        requestedFacets: request.facets.map((f) => f.id),
        missingFacets: facets.filter((f) => f.status !== "OBSERVED").map((f) => f.facet.id),
        budgetUsage: budget.snapshot(),
        qualifications: reportQualifications,
        exportStatus: "BLOCKED",
        reportFingerprint,
      };
      demand(validateInsightRecord("ReportManifest", manifest).ok);
      for (const f of facets) demand(validateInsightRecord("DiagnosticFacet", f.facet).ok);
      demand(validateInsightRecord("ConsistencyEvidence", consistency).ok);
      const result = freeze({ ...body, manifest });
      data(result, p.maxReportBytes, 32, 50000, work);
      demand(byteSize(result) <= p.maxReportBytes - 4096, "REPORTING:BUDGET_EXHAUSTED");
      return result;
    } finally {
      activeClocks.delete(clock);
    }
  });
}
/** Verify all report bytes before any detached query/export; no re-import can acquire current authority. */
export function validateBundle(
  raw: unknown,
  operationPolicy?: ReportingPolicy,
  sharedWork?: TraversalBudget,
): ReportBundle {
  const originalPolicy = embeddedPolicy(raw);
  const p = effectivePolicy(originalPolicy, operationPolicy);
  const work = sharedWork ?? new TraversalBudget(p);
  const b = object(data(raw, 4194304, 32, 50000, work));
  exact(b, [
    "schema",
    "request",
    "policy",
    "observations",
    "facets",
    "consistency",
    "charts",
    "improvements",
    "improvementAuthority",
    "projectionRequestComplete",
    "status",
    "currentAuthority",
    "budget",
    "manifest",
  ]);
  demand(
    b.schema === "ate.reporting.bundle/1" &&
      b.improvementAuthority === "SUPPLIED_RECORDS_NOT_AUTHENTICATED_DECISIONS",
  );
  const m = object(b.manifest!);
  demand(validateInsightRecord("ReportManifest", m).ok);
  const { manifest: _manifest, ...body } = b;
  demand(
    m.reportFingerprint === digest({ body, generatedAt: m.generatedAt }, work) &&
      m.id === m.reportFingerprint,
    "REPORTING:FINGERPRINT_MISMATCH",
  );
  const parsed = validateRequestWithinBudget(b.request, work, 1);
  demand(parsed.ok);
  const r = parsed.value;
  demand(
    m.baseline === r.baseline &&
      m.requestFingerprint === digest(r, work) &&
      m.projectionVersion === "0.1.0-reporting-projection.1" &&
      m.exportStatus === "BLOCKED",
  );
  demand(digest(m.qualifications, work) === digest(reportQualifications, work));
  demand(
    JSON.stringify(b.currentAuthority) ===
      JSON.stringify(unknownFact("REPORTING:CURRENT_AUTHORITY_UNESTABLISHED")),
  );
  demand(
    array(b.observations).length <= p.maxArtifacts &&
      array(b.facets).length === r.facets.length &&
      r.facets.length <= p.maxFacets &&
      byteSize(b) <= p.maxReportBytes - 4096,
  );
  const observations = array(b.observations).map((raw) => {
    const o = object(raw);
    exact(o, [
      "artifact",
      "captureDigest",
      "provenance",
      "qualification",
      "anchorReference",
      "pointInTime",
    ]);
    const a = validateArtifact(o.artifact, work, 3);
    demand(o.captureDigest === digest(a, work, 3), "REPORTING:FINGERPRINT_MISMATCH");
    demand(o.provenance === "TRUSTED_CONTEXT_ANCHOR" || o.provenance === "UNESTABLISHED");
    demand(
      o.qualification === "SOURCE_DECLARED_AVAILABILITY_NOT_INDEPENDENTLY_VERIFIED" &&
        validateInsightRecord("Fact", o.anchorReference).ok,
    );
    const expected =
      o.provenance !== "TRUSTED_CONTEXT_ANCHOR"
        ? "UNESTABLISHED"
        : a.effectiveAt > r.asOf || (a.availableAt !== null && a.availableAt > r.knowledgeCutoff)
          ? "OUTSIDE_CUTOFF"
          : a.availableAt === null
            ? "UNESTABLISHED"
            : "ESTABLISHED";
    demand(o.pointInTime === expected);
    return o as unknown as QualifiedObservation;
  });
  demand(new Set(observations.map((o) => o.artifact.id)).size === observations.length);
  demand(
    digest(
      observations.map((o) => o.artifact.id),
      work,
    ) === digest([...observations.map((o) => o.artifact.id)].sort(), work),
  );
  ensureConsistentEvidence(
    observations.map((o) => o.artifact),
    work,
    4,
  );
  const expectedFacets = r.facets
    .map((f) =>
      projectFacet(
        f,
        observations.find((o) => o.artifact.id === f.artifactId),
        r,
      ),
    )
    .sort((a, b) => (a.facet.id < b.facet.id ? -1 : 1));
  demand(digest(b.facets, work) === digest(expectedFacets, work), "REPORTING:CONTEXT_MISMATCH");
  const complete = expectedFacets.every((f) => f.status === "OBSERVED");
  demand(
    b.projectionRequestComplete === complete && b.status === (complete ? "COMPLETE" : "PARTIAL"),
  );
  demand(
    digest(m.missingFacets, work) ===
      digest(
        expectedFacets.filter((f) => f.status !== "OBSERVED").map((f) => f.facet.id),
        work,
      ) &&
      digest(m.requestedFacets, work) ===
        digest(
          r.facets.map((f) => f.id),
          work,
        ),
  );
  demand(
    digest(m.sourceObservationIds, work) ===
      digest(
        observations.map((o) => o.artifact.id),
        work,
      ) && observations.length <= p.maxEvidenceRefs,
  );
  demand(
    digest(m.exactEvidenceVector, work) ===
      digest(
        observations.map((o) => ({
          id: o.artifact.id,
          digest: o.captureDigest,
          origin: o.provenance,
        })),
        work,
      ),
  );
  const consistency = object(b.consistency!),
    interval = object(consistency.readInterval!);
  utc(interval.start);
  utc(m.generatedAt);
  demand(
    interval.end === m.generatedAt && r.asOf <= m.generatedAt && r.knowledgeCutoff <= m.generatedAt,
  );
  demand(
    digest(consistency, work) ===
      digest(consistencyEvidence(observations, interval.start, m.generatedAt), work),
  );
  const budget = object(b.budget!);
  exact(budget, ["calls", "clockReads", "nativeBytes"]);
  demand(
    Number.isSafeInteger(budget.calls) &&
      budget.calls === budget.clockReads &&
      Number(budget.calls) >= 2 &&
      Number(budget.calls) <= originalPolicy.maxCalls &&
      Number(budget.clockReads) <= originalPolicy.maxClockReads,
  );
  demand(
    budget.nativeBytes === byteSize(observations.map((o) => o.artifact)) &&
      Number(budget.nativeBytes) <= p.maxNativeBytes &&
      digest(m.budgetUsage, work) === digest(budget, work),
  );
  demand(buildChartsWithinBudget(b.charts, observations, p, work, 3, 1).ok);
  const improvements = projectImprovementRegister(
    data(b.improvements, 1048576, 32, 50000, work, 1),
    observations.filter((o) => o.provenance === "TRUSTED_CONTEXT_ANCHOR").map((o) => o.artifact.id),
  );
  demand(improvements.ok && improvements.value.records.length <= p.maxImprovements);
  return b as unknown as ReportBundle;
}
export function queryReport(raw: unknown, query: unknown, policy?: ReportingPolicy) {
  return guard(() => {
    const effective = effectivePolicy(embeddedPolicy(raw), policy);
    const work = new TraversalBudget(effective);
    const b = validateBundle(raw, effective, work),
      q = object(data(query, 65536, 16, 10000, work));
    exact(q, ["offset", "limit", "owner"]);
    demand(
      Number.isSafeInteger(q.offset) &&
        Number(q.offset) >= 0 &&
        Number.isSafeInteger(q.limit) &&
        Number(q.limit) >= 1 &&
        Number(q.limit) <= 50,
    );
    if (q.owner !== null) id(q.owner);
    const rows = b.facets.filter((f) => q.owner === null || f.facet.owner === q.owner);
    const offset = Number(q.offset),
      limit = Number(q.limit);
    return freeze({
      scope: "SEALED_REPORT_FACETS_NOT_NATIVE_SOURCE_ENUMERATION",
      authenticity: "SELF_HASH_ONLY_NOT_OWNER_AUTHENTICATION",
      reportFingerprint: b.manifest.reportFingerprint,
      records: rows.slice(offset, offset + limit),
      total: rows.length,
      nextOffset: offset + limit < rows.length ? offset + limit : null,
      currentAuthority: unknownFact("REPORTING:HISTORICAL_REPORT_NOT_CURRENT_AUTHORITY"),
    });
  });
}
export type { JsonValue };
