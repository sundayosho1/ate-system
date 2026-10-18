import { schemas } from "@ate/domain";
// Two independently genuine canonical instruments, specifications, datasets and P24 authorities.
import {
  InstrumentEligibility,
  MemoryEligibilityRepository,
  type EligibilityPorts,
} from "@ate/instrument-eligibility";
import { associateResearchEvidence } from "@ate/instrument-registry";
import { DefaultDatasetCatalogueService } from "@ate/dataset-catalogue";
import {
  ReplayController,
  FilesystemReplayCheckpointRepository,
  resolveHistoricalReplayInputs,
  createReplaySpecification,
} from "@ate/market-replay";
import { historicalFixture } from "../market-replay/historical-fixture.js";
import { replayFixture, stream } from "../market-replay/fixtures.js";
import { addIdentity } from "../canonical-symbol-mapping/fixtures.js";
import { owners, take, checker } from "./fixtures.js";
import { root, type Owners } from "../mose-core/fixtures.js";
import { fingerprint } from "@ate/configuration";
import type { ReplayOwnerEvidence } from "@ate/mose-core";
export async function multiOwners() {
  const a = await owners(),
    base = await owners(),
    mapping = base.spec.mapping;
  await addIdentity(mapping, "MOSE-B", undefined, "mose-B");
  await mapping.import("mose-B", "MOSE.B", "mose-B", ["mose-B"]);
  const set = take(await mapping.service.publish(mapping.request("mose-set-B")));
  const m = set.prepared.mappings.find(
    (m) => m.target?.instrumentId !== base.context.instrumentId,
  )!;
  const target = m.target!;
  const specification = take(
    await base.spec.service.publish({
      ...base.spec.request("mose-spec-B", "mose-spec-B"),
      mappingSet: set.fingerprint,
      mappingFingerprint: m.fingerprint,
    }),
  );
  const h = await historicalFixture({
      rows: "2026-10-08T10:00:00.000Z,TEST,2,2\n2026-10-08T10:01:00.000Z,TEST,2.01,2.01\n2026-10-08T10:02:00.000Z,TEST,2.02,2.02",
    }),
    v = h.registration.entry.version;
  const association = take(
    associateResearchEvidence(base.ports.registry, {
      schemaVersion: 1,
      owner: "DATASET_CATALOGUE",
      ownerReference: v.versionId,
      ownerFingerprint: v.versionFingerprint,
      registryId: base.ports.registry.diagnostics().registryId,
      instrumentId: target.instrumentId,
      revisionId: target.revisionId,
      registrySnapshot: set.prepared.request.registrySnapshot,
    }),
  );
  const context = {
    ...base.context,
    instrumentId: target.instrumentId,
    revisionId: target.revisionId,
    mappingSet: set.fingerprint,
    mappingFingerprint: m.fingerprint,
    source: {
      ownerId: m.source.ownerId,
      catalogueFingerprint: m.source.catalogueFingerprint,
      observationFingerprint: m.source.observationFingerprint,
    },
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
  };
  const inputs = await resolveHistoricalReplayInputs({
      ...h.options,
      manifestId: "mose-B-historical",
      availability: () => ({
        kind: "SOURCE_PUBLICATION",
        availableAt: h.clock.now(),
        qualityAvailableAt: h.clock.now(),
        fingerprint: fingerprint({ synthetic: "trusted-attention-B-publication" }),
      }),
    }),
    replays = new Map<string, ReplayOwnerEvidence>();
  for (const sessionId of ["mose-B-left", "mose-B-right"]) {
    const { fingerprint: ignored, ...body } = replayFixture("VERIFIED_POINT_IN_TIME").spec;
    void ignored;
    const spec = createReplaySpecification({
        ...body,
        sessionId,
        sourceManifestIds: inputs.manifests.map((m) => m.manifestId),
        datasetFingerprints: inputs.manifests.map((m) => m.contentFingerprint),
      }),
      controller = new ReplayController(
        spec,
        inputs,
        new FilesystemReplayCheckpointRepository(root(), h.clock, spec.resourceLimits),
      );
    const init = await controller.initialize();
    if (!init.ok) throw Error(init.code);
    const done = await controller.runToEnd();
    if (!done.ok) throw Error(done.code);
    replays.set(sessionId, { specification: spec, checkpoint: done.checkpoint, inputs });
  }
  context.replay = {
    leftSession: "mose-B-left",
    leftCheckpoint: replays.get("mose-B-left")!.checkpoint.fingerprint,
    rightSession: "mose-B-right",
    rightCheckpoint: replays.get("mose-B-right")!.checkpoint.fingerprint,
  };
  const faults = { qualityUnavailable: false };
  const ports: EligibilityPorts = {
    ...base.ports,
    datasets: h.catalogueRepository,
    quality: Object.assign(Object.create(h.qualityRepository) as EligibilityPorts["quality"], {
      getReport: (id: Parameters<EligibilityPorts["quality"]["getReport"]>[0]) =>
        h.qualityRepository.getReport(
          faults.qualityUnavailable ? ("unavailable" as typeof id) : id,
        ),
    }),
    historical: h.repository,
    catalogue: new DefaultDatasetCatalogueService({
      clock: h.clock,
      repository: h.catalogueRepository,
      historicalRepository: h.repository,
      qualityRepository: h.qualityRepository,
      requireVerifiedIntegrity: true,
      requireQualityForQualification: false,
    }),
    replayEvidence: (s, c) => {
      const p = replays.get(s);
      return p?.checkpoint.fingerprint === c ? p : undefined;
    },
    repository: new MemoryEligibilityRepository(),
  };
  const service = new InstrumentEligibility("mose-B-eligibility", ports);
  take(await service.initialize());
  let seq = 0;
  const request = (destination: "MAPPED" | "DATA_QUALIFIED" | "RESEARCH") => ({
    ...base.request(destination),
    id: "mose-B-request-" + ++seq,
    instrumentId: context.instrumentId,
    context,
  });
  const discovery = base.request("MAPPED");
  take(
    await service.discover({
      kind: "DISCOVER",
      id: "mose-B-discovery",
      instrumentId: context.instrumentId,
      context,
      maker: discovery.maker,
      occurredAt: discovery.occurredAt,
      effectiveAt: discovery.effectiveAt,
    }),
  );
  for (const stage of ["MAPPED", "DATA_QUALIFIED", "RESEARCH"] as const) {
    const r = request(stage);
    take(await service.requestTransition(r));
    const approval = take(
      await service.approveTransition({
        kind: "APPROVE",
        id: "mose-B-approval-" + ++seq,
        requestId: r.id,
        checker,
      }),
    );
    take(
      await service.commitTransition({
        kind: "COMMIT",
        id: "mose-B-commit-" + ++seq,
        requestId: r.id,
        approvalId: approval.action.id,
      }),
    );
  }
  return {
    a,
    b: { context, service, ports, replays } as Pick<
      Owners,
      "context" | "service" | "ports" | "replays"
    >,
    faults,
  };
}
