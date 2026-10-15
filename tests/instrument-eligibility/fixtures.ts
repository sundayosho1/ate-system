import { schemas } from "@ate/domain";
import { expect } from "vitest";
import {
  ConfigurationRegistry,
  ConfigurationResolver,
  StaticConfigurationSource,
  buildConfigurationSnapshot,
  configurationEntry,
  StaticApprovalAuthorityResolver,
  type ConfigurationSourceId,
  type EffectiveConfiguration,
} from "@ate/configuration";
import {
  InstrumentEligibility,
  MemoryEligibilityRepository,
  defaultPolicy,
  eligibilityConfigurationDefinitions,
  eligibilityStateOwnership,
  createAttestation,
  type Context,
  type Policy,
  type Repository,
  type EligibilityPorts,
  type Stage,
  type Action,
} from "@ate/instrument-eligibility";
import { CalendarBoundaryResolver, utcCalendar } from "@ate/multitimeframe";
import { associateResearchEvidence } from "@ate/instrument-registry";
import {
  ReplayController,
  FilesystemReplayCheckpointRepository,
  resolveHistoricalReplayInputs,
  createReplaySpecification,
  type ReplayComparisonInput,
  type ReplayResolvedInputs,
} from "@ate/market-replay";
import { fixture as specFixture, take, root } from "../instrument-specifications/fixtures.js";
import { maker, checker, time } from "../canonical-symbol-mapping/fixtures.js";
import { historicalFixture } from "../market-replay/historical-fixture.js";
import { replayFixture, stream } from "../market-replay/fixtures.js";
export { take, root, maker, checker, time };
export const issuer = {
  actorType: "USER" as const,
  actorId: "00000000-0000-4000-8000-000000000003",
};
export async function configuration(
  p: Policy,
  clock: EligibilityPorts["clock"],
): Promise<EffectiveConfiguration> {
  const registry = new ConfigurationRegistry(clock),
    defs = eligibilityConfigurationDefinitions(clock);
  for (const d of defs) take(registry.register(d));
  const source = new StaticConfigurationSource({
    clock,
    descriptor: {
      sourceId: "eligibility-test" as ConfigurationSourceId,
      sourceType: "TEST",
      name: "Offline governed eligibility fixture",
      criticality: "REQUIRED",
      failurePolicy: "FAIL_CLOSED",
      priority: 1,
    },
    entries: [
      configurationEntry({ key: defs[0]!.key, scopeType: "SYSTEM", value: JSON.stringify(p) }),
    ],
  });
  const snapshot = take(await buildConfigurationSnapshot({ registry, sources: [source], clock }));
  return take(
    new ConfigurationResolver(registry, snapshot, clock).resolve({ runtimeMode: "RESEARCH" }),
  );
}
export async function fixture(
  policy: Policy = {
    ...defaultPolicy,
    allowQualityWarnings: true,
    validationSources: [
      {
        sourceId: "synthetic-validation",
        issuerId: schemas.actorId.parse(issuer.actorId),
        methodologyVersion: "method-v1",
      },
    ],
  },
  repository: Repository = new MemoryEligibilityRepository(),
) {
  const spec = await specFixture();
  const specification = take(await spec.service.publish(spec.request()));
  const mapping = spec.set.prepared.mappings[0]!,
    target = mapping.target!;
  const h = await historicalFixture({
    rows: "2026-10-08T10:00:00.000Z,TEST,1,1\n2026-10-08T10:01:00.000Z,TEST,1.01,1.01\n2026-10-08T10:02:00.000Z,TEST,1.02,1.02",
  });
  const inputs = await resolveHistoricalReplayInputs(h.options),
    base = replayFixture().spec;
  const replays = new Map<string, ReplayComparisonInput & { inputs: ReplayResolvedInputs }>();
  for (const sessionId of ["eligibility-replay-a", "eligibility-replay-b"]) {
    const { fingerprint: ignored, ...body } = base;
    void ignored;
    const specification = createReplaySpecification({
      ...body,
      sessionId,
      sourceManifestIds: inputs.manifests.map((m) => m.manifestId),
      datasetFingerprints: inputs.manifests.map((m) => m.contentFingerprint),
    });
    const controller = new ReplayController(
      specification,
      inputs,
      new FilesystemReplayCheckpointRepository(root(), h.clock, specification.resourceLimits),
    );
    const init = await controller.initialize();
    if (!init.ok) throw Error(init.code);
    const done = await controller.runToEnd();
    if (!done.ok) throw Error(done.code);
    replays.set(sessionId, { specification, checkpoint: done.checkpoint, inputs });
  }
  const v = h.registration.entry.version;
  const association = take(
    associateResearchEvidence(spec.ports.registry, {
      schemaVersion: 1,
      owner: "DATASET_CATALOGUE",
      ownerReference: v.versionId,
      ownerFingerprint: v.versionFingerprint,
      registryId: spec.ports.registry.diagnostics().registryId,
      instrumentId: target.instrumentId,
      revisionId: target.revisionId,
      registrySnapshot: spec.set.prepared.request.registrySnapshot,
    }),
  );
  const context: Context = {
    source: {
      ownerId: mapping.source.ownerId,
      catalogueFingerprint: mapping.source.catalogueFingerprint,
      observationFingerprint: mapping.source.observationFingerprint,
    },
    timeframes: ["M1", "M5"],
    instrumentId: target.instrumentId,
    revisionId: target.revisionId,
    mappingSet: spec.set.fingerprint,
    mappingFingerprint: mapping.fingerprint,
    specification: specification.fingerprint,
    datasets: [
      {
        versionId: v.versionId,
        versionFingerprint: v.versionFingerprint,
        contentFingerprint: v.content.contentFingerprint,
        instrumentId: schemas.instrumentId.parse(stream.instrumentId),
        associationFingerprint: association.fingerprint,
        qualityReportId: h.report.reportId,
        qualityFingerprint: h.report.reportFingerprint,
      },
    ],
    calendar: utcCalendar,
    calendarFingerprint: new CalendarBoundaryResolver(utcCalendar).fingerprint,
    subject: "synthetic-subject",
    hypothesis: "synthetic-hypothesis",
    methodology: "synthetic-methodology",
    methodologyVersion: "method-v1",
    replay: {
      leftSession: "eligibility-replay-a",
      leftCheckpoint: replays.get("eligibility-replay-a")!.checkpoint.fingerprint,
      rightSession: "eligibility-replay-b",
      rightCheckpoint: replays.get("eligibility-replay-b")!.checkpoint.fingerprint,
    },
    attestation: null,
  };
  take(spec.ports.authority.register(eligibilityStateOwnership()));
  let config = await configuration(policy, spec.ports.clock);
  const ports: EligibilityPorts = {
    clock: spec.ports.clock,
    registry: spec.ports.registry,
    mapping: spec.ports.mapping,
    specifications: spec.service,
    catalogues: new Map([["offline-lab", spec.mapping.base.lab]]),
    catalogue: new (await import("@ate/dataset-catalogue")).DefaultDatasetCatalogueService({
      clock: h.clock,
      repository: h.catalogueRepository,
      historicalRepository: h.repository,
      qualityRepository: h.qualityRepository,
      requireVerifiedIntegrity: true,
      requireQualityForQualification: false,
    }),
    datasets: h.catalogueRepository,
    quality: h.qualityRepository,
    historical: h.repository,
    authorityResolver: new StaticApprovalAuthorityResolver({
      clock: spec.ports.clock,
      grants: {
        [issuer.actorId]: ["CONFIGURATION_CHECKER"],
        [checker.actorId]: ["CONFIGURATION_CHECKER"],
      },
    }),
    authority: spec.ports.authority,
    configuration: () => config,
    repository,
    replayEvidence: (session, cp) => {
      const r = replays.get(session);
      return r?.checkpoint.fingerprint === cp ? r : undefined;
    },
  };
  const service = new InstrumentEligibility("eligibility-lab", ports);
  take(await service.initialize());
  let seq = 0;
  const request = (
    destination: Stage,
    extra: Partial<Extract<Action, { kind: "REQUEST" }>> = {},
  ): Extract<Action, { kind: "REQUEST" }> => ({
    kind: "REQUEST",
    id: `request-${++seq}`,
    instrumentId: context.instrumentId,
    context,
    destination,
    maker: { ...maker, actorId: schemas.actorId.parse(maker.actorId) },
    occurredAt: time,
    effectiveAt: time,
    disposition: null,
    reason: "Synthetic offline research decision",
    ...extra,
  });
  const promote = async (
    destination: Stage,
    extra: Partial<Extract<Action, { kind: "REQUEST" }>> = {},
  ) => {
    const r = request(destination, extra);
    take(await service.requestTransition(r));
    const a = take(
      await service.approveTransition({
        kind: "APPROVE",
        id: `approval-${++seq}`,
        requestId: r.id,
        checker,
      }),
    );
    return take(
      await service.commitTransition({
        kind: "COMMIT",
        id: `commit-${++seq}`,
        requestId: r.id,
        approvalId: a.action.id,
      }),
    );
  };
  const discover = async () =>
    take(
      await service.discover({
        kind: "DISCOVER",
        id: "discover",
        instrumentId: context.instrumentId,
        context,
        maker,
        occurredAt: time,
        effectiveAt: time,
      }),
    );
  const attestation = (extra: Record<string, unknown> = {}) =>
    createAttestation({
      schemaVersion: 1,
      attestationId: "attestation-1",
      sourceId: "synthetic-validation",
      issuer,
      subject: "synthetic-subject",
      instrumentId: context.instrumentId,
      hypothesis: context.hypothesis,
      methodology: context.methodology,
      methodologyVersion: context.methodologyVersion,
      policyId: policy.policyId,
      policyVersion: 1,
      datasets: context.datasets,
      replay: context.replay,
      evidenceReferences: ["Synthetic offline experiment declaration"],
      outcome: "PASSED",
      status: "CURRENT",
      supersededBy: null,
      issuedAt: time,
      effectiveAt: time,
      expiresAt: null,
      provenance: "Synthetic trusted fixture; not scientific verification",
      ...extra,
    });
  return {
    service,
    ports,
    spec,
    h,
    context,
    policy,
    repository,
    replays,
    request,
    promote,
    discover,
    attestation,
    setConfiguration: (c: EffectiveConfiguration) => {
      config = c;
    },
    toResearch: async () => {
      await discover();
      for (const d of ["MAPPED", "DATA_QUALIFIED", "RESEARCH"] as const) await promote(d);
    },
    expectReady: () => expect(service.diagnostics().readiness).toBe("READY"),
  };
}
