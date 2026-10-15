import { fingerprint, type ApprovalAuthorityResolver } from "@ate/configuration";
import { mustParseUtc, type Clock } from "@ate/time";
import { associateResearchEvidence, type InstrumentRegistry } from "@ate/instrument-registry";
import type { CanonicalSymbolMapping } from "@ate/canonical-symbol-mapping";
import {
  context as specificationContext,
  buildQualification,
  type InstrumentSpecifications,
} from "@ate/instrument-specifications";
import type { BrokerSymbolCatalogue } from "@ate/broker-symbol-catalogue";
import type {
  DatasetCatalogueRepository,
  DatasetCatalogueService,
  DatasetVersionId,
} from "@ate/dataset-catalogue";
import type { HistoricalDatasetRepository } from "@ate/historical-data";
import type { DataQualityReportRepository, DataQualityReportId } from "@ate/data-quality";
import {
  CalendarBoundaryResolver,
  TimeframeRegistry,
  standardTimeframes,
  freeze,
  hash,
} from "@ate/multitimeframe";
import {
  compareReplayCheckpoints,
  DeterministicReplaySequencer,
  type ReplayComparisonInput,
  type ReplayResolvedInputs,
} from "@ate/market-replay";
import {
  capabilities,
  stages,
  type Assessment,
  type Attestation,
  type Context,
  type Policy,
  type RecordState,
  type Stage,
} from "./contracts.js";
export interface EvidencePorts {
  clock: Clock;
  registry: InstrumentRegistry;
  mapping: CanonicalSymbolMapping;
  specifications: InstrumentSpecifications;
  catalogues: ReadonlyMap<string, BrokerSymbolCatalogue>;
  catalogue: DatasetCatalogueService;
  datasets: DatasetCatalogueRepository;
  quality: DataQualityReportRepository;
  historical: HistoricalDatasetRepository;
  authorityResolver: ApprovalAuthorityResolver;
  /** Trusted owner adapter must resolve exact retained P19 checkpoints, not caller certificates. */
  replayEvidence(
    sessionId: string,
    checkpoint: string,
  ): (ReplayComparisonInput & { inputs: ReplayResolvedInputs }) | undefined;
}
export type AttestationState = Readonly<{
  declaration: Attestation;
  status: "CURRENT" | "REVOKED" | "SUPERSEDED";
  verified: boolean;
}>;
const bare = (s: string) => s.replace(/^sha256:/, " ").trim();
export async function assess(
  ports: EvidencePorts,
  p: Policy,
  c: Context,
  record: RecordState | undefined,
  destination: Stage,
  attestations: readonly AttestationState[],
  at: string,
  current: boolean,
): Promise<Assessment> {
  const dimensions: Record<string, string[]> = {
    identity: [],
    mapping: [],
    specification: [],
    data: [],
    temporal: [],
    validation: [],
    governance: [],
    operational: [],
  };
  const add = (dimension: string, reason: string) => {
    dimensions[dimension]!.push(reason);
  };
  const age = (value: string) => {
    const n = Date.parse(at) - Date.parse(value);
    return n < 0 ? "FUTURE_EVIDENCE" : n > p.maxEvidenceAgeMs ? "EVIDENCE_EXPIRED" : null;
  };
  const present: string[] = [];
  try {
    const r = ports.registry.revision(c.revisionId);
    if (!r.ok || r.value?.instrumentId !== c.instrumentId || mustParseUtc(r.value.recordedAt) > at)
      throw Error("IDENTITY_UNRESOLVED");
    if (current) {
      const latest = ports.registry.get(c.instrumentId);
      if (!latest.ok || latest.value?.revisionId !== c.revisionId)
        throw Error("IDENTITY_REVISION_CHANGED");
    }
    present.push("IDENTITY_RESOLVED");
  } catch {
    add("identity", "IDENTITY_UNRESOLVED");
  }
  let discoveryValid = false;
  try {
    const owner = ports.catalogues.get(c.source.ownerId),
      cat = owner?.catalogue(c.source.catalogueFingerprint);
    if (
      !cat?.ok ||
      !cat.value ||
      cat.value.publishedAt > at ||
      !cat.value.source.observedAt ||
      cat.value.source.observedAt > at ||
      !cat.value.observations.some((x) => x.fingerprint === c.source.observationFingerprint) ||
      age(cat.value.source.observedAt)
    )
      throw Error();
    discoveryValid = true;
    present.push("SOURCE_DISCOVERY_VERIFIED");
  } catch {
    add("identity", "SOURCE_PROVENANCE_FAILURE");
  }
  try {
    const s = ports.mapping.snapshot(c.mappingSet);
    if (!s.ok || !s.value) throw Error();
    const m = s.value.prepared.mappings.find((x) => x.fingerprint === c.mappingFingerprint);
    if (
      !m ||
      m.source.ownerId !== c.source.ownerId ||
      m.source.catalogueFingerprint !== c.source.catalogueFingerprint ||
      m.source.observationFingerprint !== c.source.observationFingerprint ||
      m.outcome !== "UNIQUE_QUALIFIED_CANDIDATE" ||
      m.target?.instrumentId !== c.instrumentId ||
      m.target.revisionId !== c.revisionId
    )
      throw Error();
    const owner = ports.catalogues.get(m.source.ownerId);
    if (!owner) throw Error();
    const cat = owner.catalogue(m.source.catalogueFingerprint);
    if (
      !cat.ok ||
      !cat.value?.observations.some((x) => x.fingerprint === m.source.observationFingerprint)
    )
      throw Error();
    if (s.value.publishedAt > at) throw Error();
    const stale = age(s.value.publishedAt);
    if (stale) add("mapping", stale);
    if (current) {
      const latest = ports.mapping.snapshot();
      const q = ports.mapping.query({
        kind: "MAPPINGS",
        scope: "CURRENT",
        snapshotFingerprint: c.mappingSet,
        ownerId: m.source.ownerId,
        catalogueFingerprint: m.source.catalogueFingerprint,
        observationFingerprint: m.source.observationFingerprint,
        qualifiedOnly: true,
        offset: 0,
        limit: 1,
      });
      if (!latest.ok || latest.value?.fingerprint !== c.mappingSet || !q.ok || q.value.total !== 1)
        throw Error();
    }
    present.push("MAPPING_QUALIFIED");
  } catch {
    add("mapping", "MAPPING_NOT_QUALIFIED");
  }
  const profiles = new Map<string, string>();
  const origins = new Map<string, string>();
  try {
    if (!c.specification) throw Error();
    const s = ports.specifications.snapshot(c.specification);
    if (!s.ok || !s.value || s.value.publishedAt > at) throw Error();
    const prepared = s.value.prepared;
    if (
      prepared.context.instrumentId !== c.instrumentId ||
      prepared.context.revisionId !== c.revisionId ||
      prepared.context.mappingSet !== c.mappingSet ||
      prepared.context.mappingFingerprint !== c.mappingFingerprint
    )
      throw Error();
    const rebuilt = buildQualification(
      ports,
      prepared.request,
      prepared.policy,
      prepared.configurationFingerprint,
      prepared.evaluatedAt,
      prepared.clockProvenance,
    );
    if (rebuilt.fingerprint !== prepared.fingerprint) throw Error();
    if (current) {
      specificationContext(ports, prepared.request, true);
      const rows = ports.specifications.query({
        kind: "HISTORY",
        scope: "STORED",
        specificationId: prepared.request.specificationId,
        offset: 0,
        limit: 1,
      });
      if (!rows.ok) throw Error();
      if (rows.value.total < 1) throw Error();
      const latest = ports.specifications.query({
        kind: "HISTORY",
        scope: "STORED",
        specificationId: prepared.request.specificationId,
        offset: rows.value.total - 1,
        limit: 1,
      });
      if (!latest.ok || latest.value.records.length !== 1) throw Error();
      const head = latest.value.records[0] as { version?: unknown; snapshot?: unknown };
      if (head.version !== s.value.specificationVersion || head.snapshot !== s.value.fingerprint)
        throw Error();
    }
    const stale = age(s.value.publishedAt);
    if (stale) add("specification", stale);
    for (const q of prepared.completeness) profiles.set(q.profile, q.classification);
    present.push("SPECIFICATION_BOUND");
  } catch {
    add("specification", "SPECIFICATION_EVIDENCE_INCOMPLETE");
  }
  if (!c.datasets.length) add("data", "DATASET_NOT_QUALIFIED");
  for (const d of c.datasets) {
    try {
      const mapping = ports.mapping.snapshot(c.mappingSet);
      if (!mapping.ok || !mapping.value) throw Error();
      const association = associateResearchEvidence(ports.registry, {
        schemaVersion: 1,
        owner: "DATASET_CATALOGUE",
        ownerReference: d.versionId,
        ownerFingerprint: d.versionFingerprint,
        registryId: ports.registry.diagnostics().registryId,
        instrumentId: c.instrumentId,
        revisionId: c.revisionId,
        registrySnapshot: mapping.value.prepared.request.registrySnapshot,
      });
      if (!association.ok || association.value.fingerprint !== d.associationFingerprint)
        throw Error();
      const read = await ports.datasets.getVersion(d.versionId as DatasetVersionId);
      if (!read.ok) throw Error();
      const v = read.value;
      if (
        v.versionFingerprint !== d.versionFingerprint ||
        v.content.contentFingerprint !== d.contentFingerprint ||
        !v.contentSummary.instrumentIds.includes(d.instrumentId) ||
        v.contentSummary.observationCount < 1 ||
        !v.provenance.sources.length ||
        v.registeredAt > at ||
        !v.contentSummary.firstEventTime ||
        !v.contentSummary.lastEventTime ||
        v.contentSummary.lastEventTime > at
      )
        throw Error();
      const q = await ports.quality.getReport(d.qualityReportId as DataQualityReportId);
      if (!q.ok) throw Error();
      const report = q.value;
      if (
        report.reportFingerprint !== d.qualityFingerprint ||
        !(
          report.score.qualification === "QUALIFIED" ||
          (p.allowQualityWarnings && report.score.qualification === "QUALIFIED_WITH_WARNINGS")
        ) ||
        report.findings.some((x) => x.severity === "ERROR" || x.severity === "CRITICAL") ||
        !report.score.intendedUses.includes("RESEARCH_EXPLORATION") ||
        report.datasetId !== v.content.historicalDatasetId ||
        report.datasetContentFingerprint !== d.contentFingerprint ||
        report.generatedAt > at ||
        !v.qualityReferences.some(
          (x) =>
            x.reportFingerprint === d.qualityFingerprint &&
            x.reportId === d.qualityReportId &&
            (x.qualification === "QUALIFIED" ||
              (p.allowQualityWarnings &&
                x.qualification === "QUALIFIED_WITH_WARNINGS" &&
                x.blockingFindingCount === 0)),
        )
      )
        throw Error();
      if (current) {
        const active = await ports.datasets.getActiveVersion(v.familyId);
        if (
          !active.ok ||
          active.value.versionId !== v.versionId ||
          ["QUARANTINED", "INVALIDATED", "RETIRED", "DEPRECATED", "SUPERSEDED"].includes(
            v.lifecycleState,
          ) ||
          v.integrity.status !== "VERIFIED"
        )
          throw Error();
        const eligible = await ports.catalogue.explainEligibility(
          v.versionId,
          "RESEARCH_EXPLORATION",
        );
        if (
          !eligible.ok ||
          !(
            eligible.value.status === "ELIGIBLE" ||
            (p.allowQualityWarnings && eligible.value.status === "ELIGIBLE_WITH_WARNINGS")
          )
        )
          throw Error();
      }
      const historical = await ports.historical.getManifest(v.content.historicalDatasetId);
      if (!historical.ok || historical.value.contentFingerprint !== d.contentFingerprint)
        throw Error();
      origins.set(
        historical.value.datasetId,
        hash({ manifest: historical.value, report, catalogueVersion: v }),
      );
      if (age(report.generatedAt)) add("data", "DATA_QUALITY_EXPIRED");
      present.push("DATASET_QUALIFIED");
    } catch {
      add("data", "DATASET_NOT_QUALIFIED");
    }
  }
  try {
    if (!c.calendar || !c.calendarFingerprint) throw Error();
    const resolver = new CalendarBoundaryResolver(c.calendar);
    const timeframes = new TimeframeRegistry(standardTimeframes());
    for (const tf of c.timeframes) resolver.resolve(timeframes.get(tf), mustParseUtc(at));
    if (bare(resolver.fingerprint) !== bare(c.calendarFingerprint)) throw Error();
    present.push("CALENDAR_BOUND");
  } catch {
    add("temporal", "CALENDAR_EVIDENCE_MISSING");
  }
  let replayReproducible = false;
  try {
    if (!c.replay) throw Error();
    const a = ports.replayEvidence(c.replay.leftSession, c.replay.leftCheckpoint),
      b = ports.replayEvidence(c.replay.rightSession, c.replay.rightCheckpoint);
    if (
      !a ||
      !b ||
      a.checkpoint.fingerprint !== c.replay.leftCheckpoint ||
      b.checkpoint.fingerprint !== c.replay.rightCheckpoint ||
      a.specification.sessionId === b.specification.sessionId ||
      a.checkpoint.logicalTime > at ||
      b.checkpoint.logicalTime > at ||
      a.checkpoint.state !== "COMPLETED" ||
      b.checkpoint.state !== "COMPLETED" ||
      c.datasets.some(
        (d) =>
          !a.specification.instrumentScope.includes(d.instrumentId) ||
          !b.specification.instrumentScope.includes(d.instrumentId),
      ) ||
      bare(a.specification.calendarFingerprint) !== bare(c.calendarFingerprint ?? "") ||
      bare(b.specification.calendarFingerprint) !== bare(c.calendarFingerprint ?? "")
    )
      throw Error();
    await a.inputs.verify();
    await b.inputs.verify();
    new DeterministicReplaySequencer(a.specification, a.inputs);
    new DeterministicReplaySequencer(b.specification, b.inputs);
    if (
      a.inputs.fingerprint !== a.checkpoint.inputFingerprint ||
      b.inputs.fingerprint !== b.checkpoint.inputFingerprint ||
      origins.size !== c.datasets.length ||
      [a, b].some((x) =>
        [...origins].some(
          ([id, fp]) =>
            !x.inputs.manifests.some(
              (m) =>
                m.kind === "HISTORICAL" && m.originReference === id && m.originFingerprint === fp,
            ),
        ),
      )
    )
      throw Error();
    replayReproducible = compareReplayCheckpoints(a, b).classification === "IDENTICAL";
  } catch {
    /* Explicit missing supporting evidence, never a validation declaration. */
  }
  if (!replayReproducible) add("validation", "REPLAY_EVIDENCE_MISSING");
  else present.push("REPLAY_REPRODUCIBLE");
  if (!c.subject || !c.hypothesis || !c.methodology || !c.methodologyVersion)
    add("validation", "RESEARCH_CONTEXT_MISSING");
  let validationAttested = false;
  const att = attestations.find((x) => x.declaration.fingerprint === c.attestation);
  if (!att) add("validation", "VALIDATION_EVIDENCE_MISSING");
  else {
    const a = att.declaration;
    if (
      !att.verified ||
      !p.validationSources.some(
        (x) =>
          x.sourceId === a.sourceId &&
          x.issuerId === a.issuer.actorId &&
          x.methodologyVersion === a.methodologyVersion,
      )
    )
      add("validation", "VALIDATION_AUTHORITY_MISSING");
    if (att.status !== "CURRENT") add("validation", `VALIDATION_${att.status}`);
    if (a.outcome !== "PASSED") add("validation", `VALIDATION_${a.outcome}`);
    if (a.issuedAt > at || a.effectiveAt > at) add("validation", "FUTURE_EVIDENCE");
    if ((a.expiresAt !== null && a.expiresAt <= at) || age(a.issuedAt))
      add("validation", "VALIDATION_EXPIRED");
    if (
      a.subject !== c.subject ||
      a.instrumentId !== c.instrumentId ||
      a.hypothesis !== c.hypothesis ||
      a.methodology !== c.methodology ||
      a.methodologyVersion !== c.methodologyVersion ||
      a.policyId !== p.policyId ||
      a.policyVersion !== p.version ||
      fingerprint(a.datasets) !== fingerprint(c.datasets) ||
      fingerprint(a.replay) !== fingerprint(c.replay)
    )
      add("validation", "VALIDATION_CONTEXT_MISMATCH");
    if (dimensions.validation!.length === 0) {
      validationAttested = true;
      present.push("VALIDATION_ATTESTED");
    }
  }
  const source = record?.stage ?? "DISCOVERED";
  if (destination === "LIVE_ELIGIBLE" || destination === "ACTIVE")
    add("operational", "LIVE_STAGE_PROHIBITED");
  if (
    record &&
    destination !== source &&
    stages.indexOf(destination) !== stages.indexOf(source) + 1
  )
    add("governance", "STAGE_SKIP_PROHIBITED");
  if (record && record.disposition !== "NONE") add("governance", "BLOCKING_DISPOSITION");
  const common = [...dimensions.identity!, ...dimensions.mapping!];
  const spec = (required: readonly string[]) => [
    ...dimensions.specification!,
    ...required
      .filter((x) => profiles.get(x) !== "INTERNALLY_CONSISTENT")
      .map(() => "SPECIFICATION_EVIDENCE_INCOMPLETE"),
  ];
  const data = [...common, ...dimensions.data!];
  const research = [
    ...data,
    ...spec(["IDENTITY_METADATA", "PRICE_GRID_RESEARCH"]),
    ...dimensions.temporal!,
    ...(c.subject && c.hypothesis && c.methodology && c.methodologyVersion
      ? []
      : ["RESEARCH_CONTEXT_MISSING"]),
  ];
  const validated = [...research, ...dimensions.validation!];
  const capabilityReasons: Record<(typeof capabilities)[number], string[]> = {
    CATALOGUE_INSPECTION: [...dimensions.identity!],
    HISTORICAL_DATA_RESEARCH: data,
    MULTI_TIMEFRAME_RESEARCH: [...data, ...spec(["PRICE_GRID_RESEARCH"]), ...dimensions.temporal!],
    SPECIFICATION_COMPARISON: [...common, ...spec(["CONTRACT_COMPARISON"])],
    STRATEGY_RESEARCH: ["CAPABILITY_NOT_SUPPORTED"],
    VALIDATION_REVIEW: research,
    OFFLINE_SIMULATION: [...validated, ...spec(["VOLUME_METADATA_RESEARCH"])],
  };
  const required =
    destination === "DISCOVERED"
      ? [...dimensions.identity!, ...(discoveryValid ? [] : ["SOURCE_PROVENANCE_FAILURE"])]
      : destination === "MAPPED"
        ? common
        : destination === "DATA_QUALIFIED"
          ? data
          : destination === "RESEARCH"
            ? research
            : destination === "VALIDATED"
              ? validated
              : capabilityReasons.OFFLINE_SIMULATION;
  const reasons = [
    ...new Set([...required, ...dimensions.governance!, ...dimensions.operational!]),
  ].sort();
  const requiredEvidence =
    destination === "DISCOVERED"
      ? ["CANONICAL_IDENTITY", "ACCEPTED_DISCOVERY"]
      : destination === "MAPPED"
        ? ["CANONICAL_IDENTITY", "ACCEPTED_DISCOVERY", "CURRENT_GOVERNED_MAPPING"]
        : destination === "DATA_QUALIFIED"
          ? [
              "CURRENT_GOVERNED_MAPPING",
              "QUALIFIED_DATASET",
              "BOUND_QUALITY_REPORT",
              "EXPLICIT_UUID_ASSOCIATION",
            ]
          : destination === "RESEARCH"
            ? [
                "CURRENT_GOVERNED_MAPPING",
                "QUALIFIED_DATASET",
                "IDENTITY_METADATA",
                "PRICE_GRID_RESEARCH",
                "P18_CALENDAR_TIMEFRAMES",
                "RESEARCH_SUBJECT_HYPOTHESIS_METHODOLOGY",
              ]
            : [
                "CURRENT_GOVERNED_MAPPING",
                "QUALIFIED_DATASET",
                "IDENTITY_METADATA",
                "PRICE_GRID_RESEARCH",
                "P18_CALENDAR_TIMEFRAMES",
                "REPLAY_REPRODUCIBLE",
                "GOVERNED_CURRENT_PASSED_ATTESTATION",
                ...(destination === "SIMULATION" ? ["VOLUME_METADATA_RESEARCH"] : []),
              ];
  const body = {
    required: requiredEvidence,
    requiredApprovals:
      destination === "DISCOVERED" ? [] : ["DISTINCT_AUTHORIZED_CONFIGURATION_CHECKER"],
    currentDisposition: record?.disposition ?? ("NONE" as const),
    commitAuthorized: false as const,
    source,
    destination,
    allowed: reasons.length === 0,
    reasons,
    present: [...new Set(present)].sort(),
    missing: reasons.filter((x) => /MISSING|INCOMPLETE|UNRESOLVED|NOT_QUALIFIED/.test(x)),
    contradictory: reasons.filter((x) => /MISMATCH|CHANGED/.test(x)),
    expired: reasons.filter((x) => /EXPIRED|REVOKED|SUPERSEDED/.test(x)),
    dimensions,
    capabilities: capabilities.map((capability) => {
      const blocked = record && record.disposition !== "NONE" ? ["BLOCKING_DISPOSITION"] : [];
      const minimum =
        capability === "OFFLINE_SIMULATION"
          ? "SIMULATION"
          : capability === "VALIDATION_REVIEW"
            ? "RESEARCH"
            : capability === "CATALOGUE_INSPECTION"
              ? "DISCOVERED"
              : capability === "SPECIFICATION_COMPARISON"
                ? "MAPPED"
                : "DATA_QUALIFIED";
      const r = [
        ...new Set([
          ...capabilityReasons[capability],
          ...blocked,
          ...(stages.indexOf(source) < stages.indexOf(minimum) ? ["STAGE_NOT_ADMITTED"] : []),
        ]),
      ].sort();
      return { capability, allowed: r.length === 0, reasons: r };
    }),
    replayReproducible,
    validationAttested,
    validationIndependentlyVerified: false as const,
    policyFingerprint: fingerprint(p),
    contextFingerprint: fingerprint(c),
    evaluatedAt: mustParseUtc(at),
  };
  return freeze({ ...body, fingerprint: fingerprint(body) });
}
