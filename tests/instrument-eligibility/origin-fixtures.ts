// Genuine public historical/quality/catalogue/registry/replay owners; isolated P24 instances.
import { VirtualClock } from "@ate/time";
import { schemas } from "@ate/domain";
import { StaticApprovalAuthorityResolver } from "@ate/configuration";
import { DefaultDatasetCatalogueService, createDatasetFamilyId } from "@ate/dataset-catalogue";
import { associateResearchEvidence } from "@ate/instrument-registry";
import {
  ReplayController,
  FilesystemReplayCheckpointRepository,
  resolveHistoricalReplayInputs,
  immutableReplayInputs,
  createReplaySpecification,
  type ReplayInputManifest,
  type ReplayComparisonInput,
  type ReplayResolvedInputs,
} from "@ate/market-replay";
import {
  InstrumentEligibility,
  MemoryEligibilityRepository,
  createAttestation,
  type EligibilityPorts,
  type Context,
  type Repository,
  type Stage,
  type Action,
} from "@ate/instrument-eligibility";
import { fixture, configuration, take, root, maker, checker, issuer, time } from "./fixtures.js";
import { historicalFixture } from "../market-replay/historical-fixture.js";
import { replayFixture, stream } from "../market-replay/fixtures.js";
export { take, root, maker, checker, time };
export type Participant = ReplayComparisonInput & { inputs: ReplayResolvedInputs };
export async function originOwners() {
  const base = await fixture();
  const histories = [base.h];
  const entries = [base.h.registration.entry];
  const services = [base.ports.catalogue];
  for (const n of [2, 3]) {
    const h = await historicalFixture({
      rows: `2026-10-08T10:00:00.000Z,TEST,${n},${n}\n2026-10-08T10:01:00.000Z,TEST,${n}.01,${n}.01\n2026-10-08T10:02:00.000Z,TEST,${n}.02,${n}.02`,
    });
    const service = new DefaultDatasetCatalogueService({
      clock: h.clock,
      repository: h.catalogueRepository,
      historicalRepository: h.repository,
      qualityRepository: h.qualityRepository,
      requireVerifiedIntegrity: true,
      requireQualityForQualification: false,
    });
    const registration = take(
      await service.registerDataset({
        family: {
          familyId: createDatasetFamilyId({
            audit: n === 2 ? "C-second-origin" : "D-third-origin",
          }),
        },
        historicalDatasetId: h.options.datasetId,
        qualityReportIds: [h.report.reportId],
        intendedUses: ["RESEARCH_EXPLORATION"],
        setActive: true,
        reason: n === 2 ? "Independent C multiset positive control" : "D third origin",
        actor: { actorType: "SYSTEM" },
        runtimeMode: "RESEARCH",
      }),
    );
    histories.push(h);
    entries.push(registration.entry);
    services.push(service);
  }
  const alternate = take(
    await base.ports.catalogue.registerDataset({
      family: { familyId: createDatasetFamilyId({ audit: "D-second-version" }) },
      historicalDatasetId: base.h.options.datasetId,
      qualityReportIds: [base.h.report.reportId],
      intendedUses: ["RESEARCH_EXPLORATION"],
      setActive: true,
      reason: "Genuine alternate catalogue binding for same historical dataset",
      actor: { actorType: "SYSTEM" },
      runtimeMode: "RESEARCH",
    }),
  );
  histories.push(base.h);
  entries.push(alternate.entry);
  services.push(base.ports.catalogue);
  // Use the original C registration's exact reason because it participates in immutable identity.
  const inputs = await Promise.all(
    histories.map((h, i) =>
      resolveHistoricalReplayInputs({
        ...h.options,
        manifestId: [
          "C-origin-one",
          "C-origin-two",
          "D-origin-three",
          "D-second-catalogue-version",
        ][i]!,
        catalogue: {
          repository: h.catalogueRepository,
          versionId: entries[i]!.version.versionId,
          expectedVersionFingerprint: entries[i]!.version.versionFingerprint,
        },
      }),
    ),
  );
  const bindings: Context["datasets"] = entries.map(({ version }, i) => {
    const association = take(
      associateResearchEvidence(base.ports.registry, {
        schemaVersion: 1,
        owner: "DATASET_CATALOGUE",
        ownerReference: version.versionId,
        ownerFingerprint: version.versionFingerprint,
        registryId: base.ports.registry.diagnostics().registryId,
        instrumentId: base.context.instrumentId,
        revisionId: base.context.revisionId,
        registrySnapshot: base.spec.set.prepared.request.registrySnapshot,
      }),
    );
    return {
      versionId: version.versionId,
      versionFingerprint: version.versionFingerprint,
      contentFingerprint: version.content.contentFingerprint,
      instrumentId: schemas.instrumentId.parse(stream.instrumentId),
      associationFingerprint: association.fingerprint,
      qualityReportId: histories[i]!.report.reportId,
      qualityFingerprint: histories[i]!.report.reportFingerprint,
    };
  });
  const ports = { ...base.ports };
  ports.datasets = Object.assign(
    Object.create(base.ports.datasets) as EligibilityPorts["datasets"],
    {
      getVersion: (id: Parameters<EligibilityPorts["datasets"]["getVersion"]>[0]) =>
        histories[
          Math.max(
            0,
            entries.findIndex((e) => e.version.versionId === id),
          )
        ]!.catalogueRepository.getVersion(id),
      getActiveVersion: (id: Parameters<EligibilityPorts["datasets"]["getActiveVersion"]>[0]) =>
        histories[
          Math.max(
            0,
            entries.findIndex((e) => e.version.familyId === id),
          )
        ]!.catalogueRepository.getActiveVersion(id),
    },
  );
  ports.quality = Object.assign(Object.create(base.ports.quality) as EligibilityPorts["quality"], {
    getReport: (id: Parameters<EligibilityPorts["quality"]["getReport"]>[0]) =>
      (
        histories.find((h) => h.report.reportId === id) ?? histories[0]!
      ).qualityRepository.getReport(id),
  });
  ports.historical = Object.assign(
    Object.create(base.ports.historical) as EligibilityPorts["historical"],
    {
      getManifest: (id: Parameters<EligibilityPorts["historical"]["getManifest"]>[0]) =>
        (histories.find((h) => h.options.datasetId === id) ?? histories[0]!).repository.getManifest(
          id,
        ),
    },
  );
  ports.catalogue = Object.assign(
    Object.create(base.ports.catalogue) as EligibilityPorts["catalogue"],
    {
      explainEligibility: (
        id: Parameters<EligibilityPorts["catalogue"]["explainEligibility"]>[0],
        use: Parameters<EligibilityPorts["catalogue"]["explainEligibility"]>[1],
      ) =>
        services[
          Math.max(
            0,
            entries.findIndex((e) => e.version.versionId === id),
          )
        ]!.explainEligibility(id, use),
    },
  );
  async function pair(manifests: readonly ReplayInputManifest[], names = ["D-left", "D-right"]) {
    const source = immutableReplayInputs(manifests, async () => {
      for (const input of inputs) await input.verify();
    });
    const result: Participant[] = [];
    for (const sessionId of names) {
      const { fingerprint: ignored, ...body } = replayFixture().spec;
      void ignored;
      const specification = createReplaySpecification({
        ...body,
        sessionId,
        sourceManifestIds: source.manifests.map((m) => m.manifestId),
        datasetFingerprints: source.manifests.map((m) => m.contentFingerprint),
      });
      const controller = new ReplayController(
        specification,
        source,
        new FilesystemReplayCheckpointRepository(
          root(),
          histories[0]!.clock,
          specification.resourceLimits,
        ),
      );
      const initialized = await controller.initialize();
      if (!initialized.ok) throw Error(initialized.code);
      const completed = await controller.runToEnd();
      if (!completed.ok) throw Error(completed.code);
      result.push({ specification, checkpoint: completed.checkpoint, inputs: source });
    }
    return result;
  }
  const pairs = await Promise.all(
    [1, 2, 3].map((n) => pair(inputs.slice(0, n).flatMap((i) => i.manifests))),
  );
  return { base, ports, bindings, inputs, pair, pairs, histories, entries };
}
export async function research(
  o: Awaited<ReturnType<typeof originOwners>>,
  count = 2,
  repository: Repository = new MemoryEligibilityRepository(),
) {
  const clock = new VirtualClock(time);
  const policy = o.base.policy;
  const conf = await configuration(policy, clock);
  let participants = o.pairs[count - 1]!;
  const ports: EligibilityPorts = {
    ...o.ports,
    clock,
    repository,
    configuration: () => conf,
    authorityResolver: new StaticApprovalAuthorityResolver({
      clock,
      grants: {
        [issuer.actorId]: ["CONFIGURATION_CHECKER"],
        [checker.actorId]: ["CONFIGURATION_CHECKER"],
      },
    }),
    replayEvidence: (s, c) =>
      participants.find((p) => p.specification.sessionId === s && p.checkpoint.fingerprint === c),
  };
  const context = structuredClone(o.base.context);
  context.datasets = o.bindings.slice(0, count);
  context.replay = {
    leftSession: participants[0]!.specification.sessionId,
    leftCheckpoint: participants[0]!.checkpoint.fingerprint,
    rightSession: participants[1]!.specification.sessionId,
    rightCheckpoint: participants[1]!.checkpoint.fingerprint,
  };
  const service = new InstrumentEligibility("origin-lab", ports);
  take(await service.initialize());
  let seq = 0;
  const request = (destination: Stage): Extract<Action, { kind: "REQUEST" }> => ({
    kind: "REQUEST",
    id: "origin-r-" + ++seq,
    instrumentId: context.instrumentId,
    context: structuredClone(context),
    destination,
    maker: { ...maker, actorId: schemas.actorId.parse(maker.actorId) },
    occurredAt: time,
    effectiveAt: time,
    disposition: null,
    reason: "Synthetic governed offline origin test",
  });
  const promote = async (destination: Stage) => {
    const r = request(destination);
    take(await service.requestTransition(r));
    const approval = take(
      await service.approveTransition({
        kind: "APPROVE",
        id: "origin-a-" + ++seq,
        requestId: r.id,
        checker,
      }),
    );
    return take(
      await service.commitTransition({
        kind: "COMMIT",
        id: "origin-c-" + ++seq,
        requestId: r.id,
        approvalId: approval.action.id,
      }),
    );
  };
  const attest = async (extra: Record<string, unknown> = {}) => {
    const {
      fingerprint: oldFingerprint,
      evidenceFingerprint: oldEvidence,
      ...body
    } = o.base.attestation();
    void oldFingerprint;
    void oldEvidence;
    const attestation = createAttestation({
      ...body,
      datasets: context.datasets,
      replay: context.replay,
      ...extra,
    });
    const action = { kind: "ATTEST", id: "origin-t-" + ++seq, attestation, checker };
    const result = await service.recordAttestation(action);
    if (result.ok) context.attestation = attestation.fingerprint;
    return { result, attestation };
  };
  const toResearch = async () => {
    take(
      await service.discover({
        kind: "DISCOVER",
        id: "origin-discover",
        instrumentId: context.instrumentId,
        context: structuredClone(context),
        maker,
        occurredAt: time,
        effectiveAt: time,
      }),
    );
    for (const s of ["MAPPED", "DATA_QUALIFIED", "RESEARCH"] as const) await promote(s);
  };
  return {
    service,
    ports,
    clock,
    context,
    request,
    promote,
    attest,
    toResearch,
    setParticipants: (p: Participant[]) => (participants = p),
  };
}
