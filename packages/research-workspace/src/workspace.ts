import { types } from "node:util";
import { promptOwners } from "@ate/research-reporting";
import { baselines, scope, qualificationIds } from "./contracts.js";
import type {
  WorkspaceContext,
  WorkspacePolicy,
  JsonValue,
  WorkspaceResult,
  WorkspaceView,
} from "./contracts.js";
import { guard, object, array, exact, text, utc, demand, freeze } from "./validation.js";
import { snapshot, fingerprint, cost } from "./serialization.js";
import { W1, checkedPolicy, minima } from "./policy.js";
import { begin } from "./budgets.js";
import type { Budget } from "./budgets.js";
import { overlayWithin } from "./release-overlay.js";
import { knowledgeWithin } from "./knowledge-links.js";
import { reportWithin } from "./report-links.js";
import { diagnosticRows } from "./diagnostics.js";
import { improvementsWithin } from "./improvement-view.js";
import { consistency } from "./consistency.js";
import { administration } from "./administration.js";
function validateLinks(
  links: readonly JsonValue[],
  knowledge: ReturnType<typeof knowledgeWithin>,
  report: ReturnType<typeof reportWithin>,
  qualifications: readonly JsonValue[],
  work: Budget,
) {
  work.reserve(links, 2);
  const linkIds = new Set<string>();
  for (const v of links) {
    const l = object(v);
    exact(l, [
      "id",
      "knowledgeEntryId",
      "knowledgeRevision",
      "knowledgeFingerprint",
      "reportFingerprint",
      "facetId",
      "owner",
      "sourceCommit",
      "qualificationIds",
      "relationship",
    ]);
    text(l.id);
    demand(!linkIds.has(l.id));
    linkIds.add(l.id);
    text(l.owner);
    demand(typeof l.sourceCommit === "string" && /^[a-f0-9]{40}$/.test(l.sourceCommit));
    demand(array(l.qualificationIds).every((id) => qualifications.includes(id)));
    demand(
      l.relationship === "CONTEXT_ONLY" &&
        l.knowledgeFingerprint === knowledge.fingerprint &&
        report !== null &&
        l.reportFingerprint === report.originalReportFingerprint &&
        array(object(report.report).observations).some((v) => {
          const a = object(object(v).artifact!);
          return a.owner === l.owner && a.sourceCommit === l.sourceCommit;
        }),
      "WORKSPACE:REFERENCE_UNAVAILABLE",
    );
    if (l.facetId !== null)
      demand(
        report !== null &&
          array(object(report.report).facets).some((v) => {
            const f = object(object(v).facet!);
            return f.id === l.facetId && f.owner === l.owner;
          }),
        "WORKSPACE:REFERENCE_UNAVAILABLE",
      );
    demand(
      knowledge.catalogue.entries.some(
        (e) => e.id === l.knowledgeEntryId && e.revision === l.knowledgeRevision,
      ),
      "WORKSPACE:REFERENCE_UNAVAILABLE",
    );
  }
}

export function composeWorkspace(
  raw: unknown,
  context: WorkspaceContext,
  policy: WorkspacePolicy = W1,
): WorkspaceResult<WorkspaceView> {
  return guard(() => {
    const work = begin(policy),
      p = work.policy,
      x = object(snapshot(raw, work));
    exact(x, [
      "schema",
      "id",
      "overlay",
      "knowledge",
      "report",
      "links",
      "improvementRecords",
      "handoverRequest",
    ]);
    demand(x.schema === "ate.workspace.compose/1");
    text(x.id);
    demand(context !== null && typeof context === "object" && !types.isProxy(context));
    const descriptors = Object.getOwnPropertyDescriptors(context);
    demand(
      Reflect.ownKeys(context).length === 3 &&
        Object.keys(descriptors).sort().join(",") === "cancelled,clock,releaseAuthentication" &&
        Object.values(descriptors).every((d) => "value" in d),
    );
    demand(typeof context.cancelled === "boolean");
    demand(context.cancelled === false, "WORKSPACE:CANCELLED");
    work.clock();
    const generatedAt = context.clock.now();
    utc(generatedAt);
    const overlay = overlayWithin(
      object(x.overlay!),
      object(snapshot(context.releaseAuthentication, work)),
      work,
    );
    demand(
      typeof overlay.observedAt === "string" && overlay.observedAt <= generatedAt,
      "WORKSPACE:SOURCE_BINDING_MISMATCH",
    );
    const knowledgeInput = object(x.knowledge!);
    const sourceGenerated = object(knowledgeInput.catalogue!).generatedAt;
    if (sourceGenerated !== undefined) {
      utc(sourceGenerated);
      demand(sourceGenerated <= generatedAt, "WORKSPACE:SOURCE_BINDING_MISMATCH");
    }
    const sources = object(object(knowledgeInput.sourceManifest!).sources!);
    const verified = array(object(snapshot(context.releaseAuthentication, work)).verifiedBindings);
    for (const rawSource of Object.values(sources)) {
      const source = object(rawSource);
      demand(
        verified.some((v) => {
          const b = object(v);
          return (
            b.path === source.path && b.sha256 === source.sha256 && b.commit === baselines.knowledge
          );
        }),
        "WORKSPACE:RELEASE_AUTHENTICATION_UNESTABLISHED",
      );
    }
    const knowledge = knowledgeWithin(knowledgeInput, generatedAt, work);
    demand(
      fingerprint(object(x.knowledge!).sourceManifest!, work) ===
        overlay.knowledgeManifestFingerprint,
      "WORKSPACE:SOURCE_BINDING_MISMATCH",
    );
    const report = reportWithin(x.report!, work),
      links = array(x.links);
    demand(links.length <= p.maxLinks, "WORKSPACE:BUDGET_EXHAUSTED");
    if (report !== null) {
      const m = object(object(report.report).manifest!);
      utc(m.generatedAt);
      demand(m.generatedAt <= generatedAt, "WORKSPACE:SOURCE_BINDING_MISMATCH");
    }
    validateLinks(links, knowledge, report, array(overlay.qualifications), work);
    exact(object(x.handoverRequest!), []);
    const reportValue = report?.report ?? null,
      diagnostics = diagnosticRows(reportValue);
    const evidenceIds =
      reportValue === null
        ? []
        : array(object(reportValue).observations)
            .filter((v) => object(v).provenance === "TRUSTED_CONTEXT_ANCHOR")
            .map((v) =>
              (() => {
                const id = object(object(v).artifact!).id;
                text(id);
                return id;
              })(),
            );
    const improvements = improvementsWithin(x.improvementRecords!, evidenceIds, work);
    const view = {
      schema: "ate.workspace.view/1" as const,
      id: x.id,
      releaseOverlayFingerprint: overlay.fingerprint!,
      knowledgeBaseline: baselines.knowledge,
      reportingValidationBaseline: baselines.reporting,
      governanceRelease: baselines.governance,
      knowledgeFingerprint: knowledge.fingerprint,
      reportFingerprint: report?.originalReportFingerprint ?? null,
      knowledge: knowledge.catalogue,
      knowledgeSourceEvidence: {
        catalogueFingerprint: knowledge.fingerprint,
        sourceManifest: knowledgeInput.sourceManifest!,
        qualificationIds: knowledgeInput.qualificationIds!,
        sourceBindings: Object.values(sources)
          .filter((v, i, all) => all.findIndex((x) => object(x).path === object(v).path) === i)
          .map((v) => {
            const source = object(v);
            return { path: source.path!, commit: baselines.knowledge, sha256: source.sha256! };
          }),
        linkQualificationIds: overlay.qualifications!,
      },
      report: reportValue,
      links,
      diagnostics,
      improvementViews: improvements,
      administration,
      consistency: consistency(),
      qualifications: [...new Set([...array(overlay.qualifications), ...qualificationIds])].sort(),
      scope: "SUPPLIED_BOUNDED_INPUT_ONLY" as const,
      policy: p,
      generatedAt,
      currentAuthority: "UNKNOWN" as const,
      budget: work.usage(),
    };
    work.charge(cost(view) * 3, (Buffer.byteLength(JSON.stringify(view)) + 128) * 3);
    view.budget = work.usage();
    const detached = snapshot(view);
    demand(
      Buffer.byteLength(JSON.stringify(detached)) <= p.maxOutputBytes,
      "WORKSPACE:BUDGET_EXHAUSTED",
    );
    const result = { ...detached, fingerprint: fingerprint(detached) };
    demand(
      Buffer.byteLength(JSON.stringify(result)) <= p.maxOutputBytes,
      "WORKSPACE:BUDGET_EXHAUSTED",
    );
    return freeze(result);
  });
}
export function readWorkspace(raw: unknown, policy?: WorkspacePolicy) {
  const work = begin(policy),
    v = object(snapshot(raw, work));
  work.reserve(v.policy!, 4);
  const p = minima(checkedPolicy(v.policy), policy);
  work.tighten(p);
  exact(v, [
    "schema",
    "id",
    "releaseOverlayFingerprint",
    "knowledgeBaseline",
    "reportingValidationBaseline",
    "governanceRelease",
    "knowledgeFingerprint",
    "reportFingerprint",
    "knowledge",
    "knowledgeSourceEvidence",
    "report",
    "links",
    "diagnostics",
    "improvementViews",
    "administration",
    "consistency",
    "qualifications",
    "scope",
    "policy",
    "generatedAt",
    "currentAuthority",
    "budget",
    "fingerprint",
  ]);
  const { fingerprint: stored, ...body } = v;
  demand(stored === fingerprint(body, work), "WORKSPACE:SOURCE_BINDING_MISMATCH");
  demand(
    v.schema === "ate.workspace.view/1" &&
      v.currentAuthority === "UNKNOWN" &&
      v.knowledgeBaseline === baselines.knowledge &&
      v.reportingValidationBaseline === baselines.reporting &&
      v.governanceRelease === baselines.governance,
  );
  demand(Buffer.byteLength(JSON.stringify(v)) <= p.maxOutputBytes, "WORKSPACE:BUDGET_EXHAUSTED");
  demand(
    array(object(v.knowledge!).entries).length <= p.maxKnowledge &&
      array(v.links).length <= p.maxLinks &&
      array(v.diagnostics).length <= p.maxFacets &&
      array(object(v.improvementViews!).records).length <= p.maxImprovements,
    "WORKSPACE:BUDGET_EXHAUSTED",
  );
  demand(
    fingerprint(v.consistency, work) === fingerprint(consistency(), work) &&
      fingerprint(v.administration, work) === fingerprint(administration, work),
  );
  demand(
    qualificationIds.every((id) => array(v.qualifications).includes(id)) &&
      array(v.qualifications).length === new Set(qualificationIds).size &&
      array(v.qualifications).every((q) => typeof q === "string" && qualificationIds.includes(q)),
  );
  text(v.id);
  for (const h of [v.releaseOverlayFingerprint, v.knowledgeFingerprint])
    demand(typeof h === "string" && /^sha256:[a-f0-9]{64}$/.test(h));
  utc(v.generatedAt);
  const historical = object(v.budget!);
  exact(historical, ["nodes", "bytes", "calls", "clockReads"]);
  const originalPolicy = checkedPolicy(v.policy);
  for (const [key, ceiling] of [
    ["nodes", originalPolicy.maxNodes],
    ["bytes", originalPolicy.maxInputBytes],
    ["calls", originalPolicy.maxCalls],
    ["clockReads", originalPolicy.maxClockReads],
  ] as const)
    demand(
      Number.isSafeInteger(historical[key]) &&
        Number(historical[key]) >= 0 &&
        Number(historical[key]) <= ceiling,
    );
  demand(
    Number(historical.clockReads) === 1 &&
      Number(historical.calls) >= Number(historical.clockReads),
  );
  const source = object(v.knowledgeSourceEvidence!);
  exact(source, [
    "catalogueFingerprint",
    "sourceManifest",
    "qualificationIds",
    "sourceBindings",
    "linkQualificationIds",
  ]);
  demand(
    source.catalogueFingerprint === v.knowledgeFingerprint,
    "WORKSPACE:SOURCE_BINDING_MISMATCH",
  );
  const catalogue = object(v.knowledge!);
  exact(catalogue, ["schema", "generatedAt", "baseline", "entries"]);
  demand(
    catalogue.schema === "ate.insights.catalogue/1" && catalogue.generatedAt === v.generatedAt,
  );
  const manifest = object(source.sourceManifest!);
  demand(catalogue.baseline === baselines.knowledge && manifest.baseline === baselines.knowledge);
  const bindings = array(source.sourceBindings),
    sources = object(manifest.sources!);
  work.reserve(source, 2);
  const bindingIds = new Set<string>();
  for (const rawBinding of bindings) {
    const b = object(rawBinding);
    exact(b, ["path", "commit", "sha256"]);
    demand(
      b.commit === baselines.knowledge &&
        typeof b.path === "string" &&
        typeof b.sha256 === "string",
    );
    demand(!bindingIds.has(b.path));
    bindingIds.add(b.path);
    demand(
      Object.values(sources).some((v) => {
        const s = object(v);
        return s.path === b.path && s.sha256 === b.sha256;
      }),
    );
  }
  for (const rawSource of Object.values(sources)) {
    const s = object(rawSource);
    demand(
      bindings.some((v) => {
        const b = object(v);
        return b.path === s.path && b.sha256 === s.sha256;
      }),
      "WORKSPACE:RELEASE_AUTHENTICATION_UNESTABLISHED",
    );
  }
  demand(array(source.qualificationIds).every((q) => typeof q === "string"));
  demand(
    array(source.linkQualificationIds).every(
      (q) => typeof q === "string" && qualificationIds.includes(q),
    ),
  );
  const knowledge = knowledgeWithin(
    { catalogue, sourceManifest: manifest, qualificationIds: source.qualificationIds! },
    v.generatedAt,
    work,
  );
  demand(knowledge.fingerprint === v.knowledgeFingerprint, "WORKSPACE:SOURCE_BINDING_MISMATCH");
  const report = reportWithin(v.report!, work);
  if (report !== null)
    demand(
      object(object(report.report).manifest!).generatedAt! <= v.generatedAt,
      "WORKSPACE:SOURCE_BINDING_MISMATCH",
    );
  validateLinks(array(v.links), knowledge, report, array(source.linkQualificationIds), work);
  demand(v.reportFingerprint === (report?.originalReportFingerprint ?? null));
  demand(fingerprint(v.diagnostics, work) === fingerprint(diagnosticRows(v.report!), work));
  demand(v.scope === scope);
  utc(v.generatedAt);
  demand(fingerprint(v.knowledge, work) === v.knowledgeFingerprint);
  const ids =
    v.report === null
      ? []
      : array(object(v.report!).observations)
          .filter((x) => object(x).provenance === "TRUSTED_CONTEXT_ANCHOR")
          .map((x) => {
            const id = object(object(x).artifact!).id;
            text(id);
            return id;
          });
  const improvements = improvementsWithin(object(v.improvementViews!).records!, ids, work);
  demand(fingerprint(improvements, work) === fingerprint(v.improvementViews, work));
  return { view: v, work, policy: p };
}
function querySection(
  raw: unknown,
  query: unknown,
  policy?: WorkspacePolicy,
  expectedSection?: string,
) {
  return guard(() => {
    const { view, work, policy: p } = readWorkspace(raw, policy),
      q = object(snapshot(query, work));
    exact(q, ["schema", "offset"], ["limit", "owner", "prompt", "axis", "section"]);
    demand(
      q.schema === "ate.workspace.query/1" &&
        Number.isSafeInteger(q.offset) &&
        Number(q.offset) >= 0,
    );
    if (expectedSection !== undefined)
      demand(q.section === undefined || q.section === expectedSection);
    const section = q.section ?? expectedSection;
    const limit = q.limit === undefined ? 20 : q.limit;
    demand(Number.isSafeInteger(limit) && Number(limit) >= 1 && Number(limit) <= p.maxQuery);
    if (q.prompt !== undefined)
      demand(Number.isSafeInteger(q.prompt) && Number(q.prompt) >= 1 && Number(q.prompt) <= 27);
    if (q.owner !== undefined) {
      text(q.owner);
      demand(
        [
          ...promptOwners,
          "research-insight-contracts",
          "research-insights",
          "research-reporting",
        ].includes(q.owner),
      );
    }
    if (q.owner !== undefined && q.prompt !== undefined)
      demand(promptOwners[Number(q.prompt) - 1] === q.owner);
    if (q.axis !== undefined) {
      text(q.axis);
      demand(
        [
          "LIFECYCLE",
          "HEALTH",
          "READINESS",
          "QUALITY",
          "AUTHORITY",
          "COVERAGE",
          "OBLIGATION",
        ].includes(q.axis),
      );
    }
    if (q.section !== undefined) {
      text(q.section);
      demand(["KNOWLEDGE", "REPORT", "DIAGNOSTICS", "IMPROVEMENTS"].includes(q.section));
    }
    let rows: readonly JsonValue[] = array(view.diagnostics);
    if (section !== undefined && section !== "DIAGNOSTICS")
      rows =
        section === "KNOWLEDGE"
          ? array(object(view.knowledge!).entries)
          : section === "IMPROVEMENTS"
            ? array(object(view.improvementViews!).records)
            : view.report === null
              ? []
              : array(object(view.report!).facets);
    if (section === "KNOWLEDGE" || section === "IMPROVEMENTS")
      demand(q.owner === undefined && q.prompt === undefined && q.axis === undefined);
    const requestFacets =
      view.report === null ? [] : array(object(object(view.report!).request!).facets);
    const keys = (value: JsonValue): Readonly<Record<string, JsonValue | undefined>> => {
      const row = object(value);
      if (section !== "REPORT") return row;
      const facet = object(row.facet!);
      const request = object(requestFacets.find((v) => object(v).id === facet.id)!);
      return {
        section: "REPORT",
        owner: facet.owner,
        prompt: request.prompt,
        axis: facet.axis,
        id: facet.id,
      };
    };
    // Explicit bounded charge for key extraction, comparisons and stable sorting.
    work.charge(cost(rows) * 2, Buffer.byteLength(JSON.stringify(rows)) * 2);
    rows = rows
      .filter((v) => {
        const k = keys(v);
        return (
          (q.owner === undefined || k.owner === q.owner) &&
          (q.prompt === undefined || k.prompt === q.prompt) &&
          (q.axis === undefined || k.axis === q.axis)
        );
      })
      .sort((a, b) => {
        const x = keys(a),
          y = keys(b);
        for (const key of ["section", "owner", "prompt", "id", "revision"]) {
          const av = x[key],
            bv = y[key];
          if (typeof av === "number" && typeof bv === "number") {
            if (av !== bv) return av - bv;
          } else {
            const aa = typeof av === "string" ? av : "",
              bb = typeof bv === "string" ? bv : "";
            if (aa !== bb) return aa < bb ? -1 : 1;
          }
        }
        return 0;
      });
    const offset = Number(q.offset);
    const result = {
      records: rows.slice(offset, offset + Number(limit)),
      totalRecords: rows.length,
      offset,
      nextOffset: offset + Number(limit) < rows.length ? offset + Number(limit) : null,
      scope,
      originalWorkspaceFingerprint: view.fingerprint!,
      currentAuthority: "UNKNOWN",
    };
    const checked = snapshot(result, work);
    demand(
      Buffer.byteLength(JSON.stringify(checked)) <= p.maxOutputBytes,
      "WORKSPACE:BUDGET_EXHAUSTED",
    );
    return freeze(result);
  });
}
export function queryWorkspace(raw: unknown, query: unknown, policy?: WorkspacePolicy) {
  return querySection(raw, query, policy);
}
export function projectWorkspaceDiagnostics(
  raw: unknown,
  query: unknown,
  policy?: WorkspacePolicy,
) {
  return querySection(raw, query, policy, "DIAGNOSTICS");
}
export function projectImprovementView(raw: unknown, query: unknown, policy?: WorkspacePolicy) {
  return querySection(raw, query, policy, "IMPROVEMENTS");
}
