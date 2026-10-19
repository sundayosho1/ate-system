import { join } from "node:path";
import { it, expect } from "vitest";
import { VirtualClock, mustParseUtc } from "@ate/time";
import { StateAuthorityRegistry } from "@ate/persistence";
import { schemas } from "@ate/domain";
import { qualityEvidence } from "@ate/multitimeframe";
import {
  DeterministicReplaySequencer,
  createReplayInputManifest,
  immutableReplayInputs,
} from "@ate/market-replay";
import type { DataQualityReportId } from "@ate/data-quality";
import { fingerprint as ownerFingerprint } from "@ate/configuration";
import { associateResearchEvidence, associateLegacyInstrument } from "@ate/instrument-registry";
import { DefaultDatasetCatalogueService } from "@ate/dataset-catalogue";
import {
  resolveHistoricalReplayInputs,
  createReplaySpecification,
  ReplayController,
  FilesystemReplayCheckpointRepository,
} from "@ate/market-replay";
import { fixture as eligibilityFixture, take, root } from "../instrument-eligibility/fixtures.js";
import { historicalFixture } from "../market-replay/historical-fixture.js";
import { replayFixture, stream } from "../market-replay/fixtures.js";
import { fixture as scannerFixture } from "../mose-scanner/fixtures.js";
import { seed } from "../mose-scanner/bar-helper.js";
import {
  captureOpportunityContext,
  OpportunityRuntime,
  MemoryOpportunityRepository,
  FilesystemOpportunityRepository,
  defaultOpportunityPolicy,
  opportunityStateOwnership,
  evaluateOpportunity,
  makeOpportunityKey,
} from "@ate/mose-opportunities";
import { observationSchema } from "@ate/mose-core";
import { captureOpportunityClock } from "../../packages/mose-opportunities/src/time-policy.js";
import {
  originFingerprint,
  subjectFingerprint,
  policyFingerprint,
} from "../../packages/mose-opportunities/src/identity.js";
import { fingerprint } from "../../packages/mose-opportunities/src/canonical.js";
import { metadata } from "../../packages/mose-opportunities/src/evidence.js";
import type {
  CapturedEvidence,
  CapturedContext,
  EvaluationInput,
  NativeCapture,
  OpportunityState,
  PredicateManifest,
  TrustedHostAuthorization,
  JournalRecord,
} from "../../packages/mose-opportunities/src/contracts.js";

async function genuineOwners(lateCorrection = false) {
  const o = await eligibilityFixture();
  const h = await historicalFixture({
    at: "2026-10-10T09:00:00.000Z",
    rows:
      "2026-10-10T08:58:00.000Z,TEST,1,1\n2026-10-10T08:59:00.000Z,TEST,1.01,1.01\n" +
      (lateCorrection ? "2026-10-10T08:59:30.000Z,TEST,0.999,0.999\n" : "") +
      "2026-10-10T09:00:00.000Z,TEST,1.02,1.02",
  });
  const v = h.registration.entry.version;
  const association = take(
    associateResearchEvidence(o.spec.ports.registry, {
      schemaVersion: 1,
      owner: "DATASET_CATALOGUE",
      ownerReference: v.versionId,
      ownerFingerprint: v.versionFingerprint,
      registryId: o.spec.ports.registry.diagnostics().registryId,
      instrumentId: o.context.instrumentId,
      revisionId: o.context.revisionId,
      registrySnapshot: o.spec.set.prepared.request.registrySnapshot,
    }),
  );
  o.context.datasets = [
    {
      versionId: v.versionId,
      versionFingerprint: v.versionFingerprint,
      contentFingerprint: v.content.contentFingerprint,
      instrumentId: schemas.instrumentId.parse(stream.instrumentId),
      associationFingerprint: association.fingerprint,
      qualityReportId: h.report.reportId,
      qualityFingerprint: h.report.reportFingerprint,
    },
  ];
  o.ports.datasets = h.catalogueRepository;
  o.ports.quality = h.qualityRepository;
  o.ports.historical = h.repository;
  o.ports.catalogue = new DefaultDatasetCatalogueService({
    clock: h.clock,
    repository: h.catalogueRepository,
    historicalRepository: h.repository,
    qualityRepository: h.qualityRepository,
    requireVerifiedIntegrity: true,
    requireQualityForQualification: false,
  });
  const resolved = await resolveHistoricalReplayInputs({
    ...h.options,
    availability: () => ({
      kind: "SOURCE_PUBLICATION",
      availableAt: h.clock.now(),
      qualityAvailableAt: h.clock.now(),
      fingerprint: ownerFingerprint({
        synthetic: "explicit-offline-publication-p28",
        availableAt: h.clock.now(),
      }),
    }),
  });
  // A separately declared public-factory historical source supplies explicit continuity
  // for all enumerated records in the controlled-delivery case. The original resolver
  // output is untouched; these new native manifest/input identities remain distinct.
  let inputs = resolved;
  if (lateCorrection) {
    const {
      fingerprint: oldFingerprint,
      contentFingerprint: oldContent,
      ...body
    } = resolved.manifests[0]!;
    void oldFingerprint;
    void oldContent;
    const manifest = createReplayInputManifest(
      {
        ...body,
        kind: "HISTORICAL",
        records: body.records.map((r) => ({
          ...r,
          input: { ...r.input, continuity: "CONTINUOUS" },
        })),
        continuity: "CONTINUOUS",
      },
      replayFixture().spec.resourceLimits,
    );
    inputs = immutableReplayInputs([manifest], resolved.verify);
  }
  o.h = h;
  o.replays.clear();
  for (const sessionId of ["p28-left", "p28-right"]) {
    const { fingerprint: old, ...body } = replayFixture("VERIFIED_POINT_IN_TIME").spec;
    void old;
    const specification = createReplaySpecification({
      ...body,
      sessionId,
      startTime: mustParseUtc("2026-10-10T08:57:00.000Z"),
      endTime: h.clock.now(),
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
    o.replays.set(sessionId, { specification, checkpoint: done.checkpoint, inputs });
  }
  o.context.replay = {
    leftSession: "p28-left",
    leftCheckpoint: o.replays.get("p28-left")!.checkpoint.fingerprint,
    rightSession: "p28-right",
    rightCheckpoint: o.replays.get("p28-right")!.checkpoint.fingerprint,
  };
  await o.toResearch();
  const f = await scannerFixture(o);
  await f.plan();
  take(await f.start());
  for (let i = 0; i < 3; i++) take(await f.scanner.request(f.trigger(i)));
  take(await f.scanner.dispatch("p28-dispatch", 3));
  const source = f.universe.members[0]!.source,
    replay = f.ports.replayEvidence(source.sessionId, source.checkpoint)!;
  const events = new DeterministicReplaySequencer(replay.specification, replay.inputs).events;
  let bars: Awaited<ReturnType<typeof seed>>;
  if (!lateCorrection) bars = await seed(f);
  else {
    // Explicit synthetic consumer-delivery delay, not an independent global-completeness certificate.
    const streamId = take(f.engine.registerStream(replay.inputs.manifests[0]!.scopes[0]!));
    const report = take(
      await f.mose.ports.quality.getReport(
        f.universe.plan[0]!.qualityReportId as DataQualityReportId,
      ),
    );
    const delayed = events.find((e) => e.eventAt.endsWith("08:59:30.000Z"))!;
    for (const event of events.filter((e) => e !== delayed))
      take(f.engine.ingest(streamId, { ...event.record.input, quality: qualityEvidence(report) }));
    take(
      f.engine.watermark(streamId, {
        sessionId: events[0]!.record.input.sessionId,
        through: f.clock.now(),
        observedAt: f.clock.now(),
        coverage: "COMPLETE_COVERAGE",
        kind: "END_OF_STREAM",
        evidenceId: "explicit-synthetic-observed-prefix",
        reconciled: true,
      }),
    );
    bars = {
      streamId,
      events,
      releaseLast: () =>
        take(
          f.engine.ingest(streamId, { ...delayed.record.input, quality: qualityEvidence(report) }),
        ),
      inspect: (timeframe: string) =>
        f.engine.snapshot({
          streamId,
          timeframes: [timeframe],
          asOf: f.clock.now(),
          cutoff: f.clock.now(),
        }),
      publish: (timeframe: string) =>
        take(f.engine.publishWindow(streamId, timeframe, events.at(-1)!.eventAt, true)),
    };
  }
  const revisionId = take(
    f.engine.publishWindow(bars.streamId, "M1", mustParseUtc("2026-10-10T08:59:00.000Z"), true),
  );
  const revision = f.engine.readRevision(revisionId);
  if (!revision) throw Error("P18 revision missing");
  return { f, o, inputs, revision, bars };
}

async function journeyFixture(filesystem = false, lateCorrection = false) {
  const { f, o, inputs, revision, bars } = await genuineOwners(lateCorrection);
  const policy = {
    ...defaultOpportunityPolicy,
    promotionsEnabled: true,
    filesystemEnabled: filesystem,
  };
  const clock = new VirtualClock(f.clock.now(), "REPLAY", "p28-genuine-journey");
  const authority = new StateAuthorityRegistry(clock);
  take(authority.register(opportunityStateOwnership()));
  const origin = {
    owner: "@ate/market-replay",
    version: "0.19.0-market-replay.1",
    namespace: "offline",
    runtimeId: "p28-left",
    manifestId: inputs.manifests[0]!.manifestId,
    manifestFingerprint: inputs.manifests[0]!.fingerprint,
    inputFingerprint: inputs.fingerprint,
    sourceScope: "explicit-offline-synthetic-journey",
  };
  const subject = {
    researchSessionId: "session-A",
    universeSnapshotId: f.universe.sessionId,
    universeFingerprint: f.universe.fingerprint,
    canonicalInstrumentId: o.context.instrumentId,
    registryGeneration: 1,
    registryFingerprint: o.spec.set.prepared.request.registrySnapshot,
    sourceOriginFingerprint: originFingerprint(origin),
    calendarFingerprint: revision.window.calendarFingerprint,
    timeframes: ["M1"],
    hypothesisRef: "offline-research-hypothesis",
    watchDeclarationId: "watch",
    lifecycleGeneration: 1,
    predecessorGenerationKey: null,
  };
  const registrySnapshot = o.spec.ports.registry.snapshotAt(subject.registryFingerprint);
  subject.registryGeneration = take(registrySnapshot).generation;
  const legacyInstrument = {
    schemaVersion: 1,
    instrumentId: revision.stream.instrumentId,
    canonicalSymbol: "SYN",
    displayName: "Explicit synthetic offline legacy instrument",
    assetClass: "EQUITY",
    status: "VALIDATED",
    metadata: {},
  };
  const instrumentBinding = {
    owner: "@ate/instrument-registry" as const,
    ownerVersion: "0.20.0-instrument-registry.1" as const,
    legacyInstrument,
    association: associateLegacyInstrument(o.spec.ports.registry, legacyInstrument, {
      instrumentId: subject.canonicalInstrumentId,
      revisionId: o.context.revisionId,
      registrySnapshot: subject.registryFingerprint,
    }),
    registrySnapshot,
    availableAt: clock.now(),
  };
  take(instrumentBinding.association);
  const actor = "40000000-0000-4000-8000-000000000003";
  const native = {
    watchDeclarationId: "watch",
    subjectFingerprint: subjectFingerprint(subject),
    policyFingerprint: policyFingerprint(policy),
    sourceOriginFingerprint: subject.sourceOriginFingerprint,
  };
  const ref = (
    family: CapturedEvidence["family"],
    recordId: string,
    fp: string,
    value: unknown,
    owner: string,
    version: string,
  ): CapturedEvidence => ({
    owner,
    ownerVersion: version,
    namespace: family,
    runtimeId: "genuine-journey",
    recordId,
    generation: 1,
    fingerprint: fp,
    sourceOriginFingerprint: subject.sourceOriginFingerprint,
    subjectFingerprint: subjectFingerprint(subject),
    policyFingerprint: policyFingerprint(policy),
    eventAt: clock.now(),
    availableAt: clock.now(),
    qualityReferences: [],
    finality: "NOT_APPLICABLE",
    correctionOf: null,
    nativeResultStatus: "ACK",
    originalReceiptRef: null,
    family,
    native: value,
  });
  const declaration = ref(
    "DECLARATION",
    "watch-record",
    fingerprint("ate.opportunity-native/1", native),
    { ok: true, value: native },
    "@ate/mose-opportunities",
    "0.28.0-opportunity-state.1",
  );
  const bar = {
    ...ref(
      "BAR",
      revision.revisionId,
      revision.contentFingerprint,
      revision,
      "@ate/multitimeframe",
      "0.18.0-multitimeframe.1",
    ),
    generation: revision.generation,
    eventAt: revision.eventAt,
    availableAt: revision.availableAt,
    finality: "FINAL" as const,
    nativeResultStatus: "UNSUPPORTED" as const,
  };
  const observations: CapturedEvidence[] = [];
  for (let i = 0; i < 3; i++) {
    const packetResult = f.mose.service.query({
      kind: "OBSERVATIONS",
      sessionId: "session-A",
      offset: i,
      limit: 1,
      asOf: clock.now(),
    });
    const packet = take(packetResult);
    if (packet.kind !== "OBSERVATIONS") throw Error("wrong P25 query");
    const value = packet.value;
    if (!("records" in value)) throw Error("P25 records missing");
    const observation = observationSchema.parse(value.records[0]);
    observations.push({
      ...ref(
        "OBSERVATION",
        observation.observationId,
        observation.observationId,
        packetResult,
        "@ate/mose-core",
        "0.25.0-mose-core.1",
      ),
      generation: 0,
      eventAt: observation.plan.eventAt,
      originalReceiptRef: f.trigger(i).id,
    });
  }
  const history = take(f.scanner.queryHistory(clock.now(), 0, 1));
  const scanner = {
    receipt: f.scanner.query(0, 3),
    checkpoint: f.scanner.queryHistory(clock.now(), history.total - 1, 1),
  };
  let capture: NativeCapture = { origin, evidence: [declaration], scanner: null };
  const host: TrustedHostAuthorization = {
    reviewReference: "synthetic-trusted-host-not-independent-certification",
    get captures() {
      return { journey: capture };
    },
    verify(request) {
      return {
        ok: true as const,
        value: {
          ...request,
          actor: { actorType: "USER" as const, actorId: actor },
          issuerRef: "test-issuer",
          approvalReferences: ["configuration", "predicate-approval"],
          issuedAt: clock.now(),
          expiresAt: new Date(Date.parse(clock.now()) + 3600000).toISOString(),
          scope: "HISTORICAL_RESEARCH" as const,
        },
      };
    },
  };
  const repository = filesystem
    ? new FilesystemOpportunityRepository(root(), policy)
    : new MemoryOpportunityRepository("genuine-journey-root", policy);
  const runtime = new OpportunityRuntime(repository, clock, authority, host, policy);
  take(await runtime.initialize());
  let prior: CapturedContext["historicalState"] = null;
  let previousEventFingerprint: string | null = null;

  const prepare = (index: number, state: OpportunityState) => {
    capture = {
      origin,
      evidence:
        index === 0
          ? [declaration]
          : [bar, ...observations.slice(0, index === 1 ? 1 : index === 5 ? 3 : 2)],
      scanner: index === 0 ? null : scanner,
      ...(index === 0 ? {} : { instrumentBinding }),
    };
    const manifests: PredicateManifest[] = [];
    if (index >= 2) {
      const body = {
        id: "predicate-" + index,
        version: "1",
        fromState: prior!.state,
        toState: state,
        hypothesisRef: subject.hypothesisRef,
        configurationReleaseRef: "configuration",
        approvalEvidenceRef: "predicate-approval",
        enabled: true,
        requiredDimensions: [bar.recordId],
        minimumDistinctConfirmations: index === 5 ? 3 : 2,
        maxAgeMs: 300000,
        clauses: [
          {
            dimensionRef: bar.recordId,
            field: "close" as const,
            operator: "GE" as const,
            decimalConstant: "0",
            unit: revision.stream.priceCurrency,
          },
        ],
      };
      manifests.push({ ...body, fingerprint: fingerprint("ate.opportunity-predicate/1", body) });
    }
    const context: CapturedContext = {
      schema: "ate.opportunity-context/1",
      historicalState: prior,
      previousEventFingerprint,
      subject,
      sourceManifestRef: origin.manifestId,
      policyRef: policy.id,
      predicateManifests: manifests,
      actorEvidenceRef: actor,
      scopeConsistencyEvidenceRef: "bounded-owner-fixture",
      nativeEvidenceRefs: capture.evidence.map(metadata),
      trustedCaptureRef: "journey",
    };
    const input: EvaluationInput = {
      schema: "ate.opportunity-evaluate/1",
      key: makeOpportunityKey(subject, policy, origin),
      commandId: "step-" + index,
      actorAuthorityRef: actor,
      configurationReleaseRef: "configuration",
      expectedHead: prior?.head ?? null,
      requestedState: state,
      capturedClock: captureOpportunityClock(clock),
      decisionCutoff: clock.now(),
      knowledgeCutoff: clock.now(),
      policyFingerprint: policyFingerprint(policy),
      evidence: context.nativeEvidenceRefs,
      consistency: "ESTABLISHED_SCOPE",
      authorityBasis: "HISTORICAL_AS_KNOWN",
    };

    return { input, context, capture };
  };
  const evaluate = (p: ReturnType<typeof prepare>) =>
    evaluateOpportunity(p.input, captureOpportunityContext(p.context, p.capture, policy), policy);
  const step = async (index: number, state: OpportunityState) => {
    const data = prepare(index, state),
      p = evaluate(data);
    expect(p.ok, "evaluation " + index + ": " + JSON.stringify(p)).toBe(true);
    if (!p.ok) throw Error(p.error.code);
    const ack = await runtime.commit(p.value);
    expect(ack.ok, "commit " + index + ": " + JSON.stringify(ack)).toBe(true);
    const loaded = take(await repository.load());
    prior = (loaded.at(-1) as JournalRecord).snapshot;
    previousEventFingerprint = (loaded.at(-1) as JournalRecord).proposal.eventFingerprint;
    expect(prior.state).toBe(state);
    return { data, proposal: p.value, ack };
  };
  return {
    f,
    o,
    inputs,
    revision,
    bars,
    origin,
    subject,
    policy,
    clock,
    authority,
    host,
    repository,
    runtime,
    instrumentBinding,
    bar,
    observations,
    declaration,
    ref,
    prepare,
    evaluate,
    step,
    sync: async () => {
      const rows = take(await repository.load());
      prior = (rows.at(-1) as JournalRecord).snapshot;
      previousEventFingerprint = (rows.at(-1) as JournalRecord).proposal.eventFingerprint;
    },
    get prior() {
      return prior;
    },
  };
}
const ordinaryStates: OpportunityState[] = [
  "DORMANT",
  "OBSERVING",
  "INTERESTING",
  "SETUP_FORMING",
  "CANDIDATE",
  "QUALIFIED",
];
it("J01 genuine P19/P24/P25/P26/P18 ordinary lifecycle and fresh historical recovery", async () => {
  const f = await journeyFixture();
  for (const [i, state] of ordinaryStates.entries()) await f.step(i, state);
  expect((await f.runtime.shutdown()).ok).toBe(true);
  const reader = new OpportunityRuntime(f.repository, f.clock, f.authority);
  const recovered = await reader.initialize();
  expect(recovered.ok, JSON.stringify(recovered)).toBe(true);
  if (recovered.ok) expect(recovered.value.map((r) => r.snapshot.state)).toEqual(ordinaryStates);
  expect(reader.diagnostics()).toMatchObject({
    ok: true,
    value: { currentReadiness: "NOT_READY", currentAuthority: "UNESTABLISHED" },
  });
  expect((await reader.shutdown()).ok).toBe(true);
  expect((await reader.shutdown()).ok).toBe(true);
});

import { object, Budget } from "../../packages/mose-opportunities/src/validation.js";
import { failure } from "../../packages/mose-opportunities/src/contracts.js";
const badBindings: [string, (b: Record<string, unknown>) => void][] = [
  [
    "forged association",
    (b) => {
      object(object(b.association).value).legacyInstrumentId =
        "40000000-0000-4000-8000-000000000099";
    },
  ],
  [
    "wrong legacy Instrument",
    (b) => {
      object(b.legacyInstrument).instrumentId = "40000000-0000-4000-8000-000000000099";
    },
  ],
  [
    "wrong canonical instrument",
    (b) => {
      object(object(object(b.association).value).reference).instrumentId = "ins-" + "3".repeat(64);
    },
  ],
  [
    "wrong owner",
    (b) => {
      b.owner = "@ate/multitimeframe";
    },
  ],
  [
    "wrong version",
    (b) => {
      b.ownerVersion = "0.20.0-forged";
    },
  ],
  [
    "missing Result discriminator",
    (b) => {
      Reflect.deleteProperty(object(b.association), "ok");
    },
  ],
  [
    "contradictory Result branches",
    (b) => {
      object(b.association).error = { code: "NOT_FOUND", commitment: "NONE" };
    },
  ],
  [
    "native NONE",
    (b) => {
      b.association = { ok: false, error: { code: "UNAVAILABLE", commitment: "NONE" } };
    },
  ],
  [
    "native UNKNOWN",
    (b) => {
      b.association = { ok: false, error: { code: "UNAVAILABLE", commitment: "UNKNOWN" } };
    },
  ],
  [
    "incorrect snapshot",
    (b) => {
      object(object(b.registrySnapshot).value).fingerprint = "sha256:" + "3".repeat(64);
    },
  ],
  [
    "incorrect revision",
    (b) => {
      const ref = object(object(object(b.association).value).reference);
      ref.revisionId = "sha256:" + "3".repeat(64);
      const { fingerprint: ignored, ...body } = ref;
      void ignored;
      ref.fingerprint = ownerFingerprint(body);
    },
  ],
  [
    "incorrect generation",
    (b) => {
      object(object(b.registrySnapshot).value).generation = 999;
    },
  ],
  [
    "contradictory reference fingerprint",
    (b) => {
      object(object(object(b.association).value).reference).fingerprint =
        "sha256:" + "3".repeat(64);
    },
  ],
  [
    "missing availability",
    (b) => {
      Reflect.deleteProperty(b, "availableAt");
    },
  ],
  [
    "future availability",
    (b) => {
      b.availableAt = "2026-10-10T09:00:00.001Z";
    },
  ],
];
for (const [name, change] of badBindings)
  it("BIND rejects " + name + " without a new ACK", async () => {
    const f = await journeyFixture();
    await f.step(0, "DORMANT");
    const data = f.prepare(1, "OBSERVING");
    const binding = object(structuredClone(data.capture.instrumentBinding));
    change(binding);
    Reflect.set(data.capture, "instrumentBinding", binding);
    const before = take(await f.repository.load()).map((r) => object(r).fingerprint);
    const rejected = (() => {
      try {
        return !f.evaluate(data).ok;
      } catch {
        return true;
      }
    })();
    expect(rejected).toBe(true);
    expect(take(await f.repository.load()).map((r) => object(r).fingerprint)).toEqual(before);
    if (name === "native UNKNOWN")
      expect(object(object(data.capture.instrumentBinding).association)).toMatchObject({
        ok: false,
        error: { commitment: "UNKNOWN" },
      });
  });
it("BIND missing explicit bridge cannot equate UUID and canonical identity", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  const data = f.prepare(1, "OBSERVING");
  Reflect.deleteProperty(data.capture, "instrumentBinding");
  expect(f.evaluate(data)).toMatchObject({
    ok: false,
    error: { code: "OPP:INSTRUMENT_BINDING_MISSING", commitment: "NONE" },
  });
});
it("BIND genuine identity and original native Results survive deterministic capture and serialization", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  const data = f.prepare(1, "OBSERVING");
  const a = f.evaluate(data),
    b = f.evaluate(data);
  expect(a).toEqual(b);
  expect(a.ok).toBe(true);
  const roundtrip: unknown = JSON.parse(JSON.stringify(data.capture.instrumentBinding));
  expect(roundtrip).toEqual(f.instrumentBinding);
  expect(object(object(object(roundtrip).association).value).legacyInstrumentId).toBe(
    f.revision.stream.instrumentId,
  );
  expect(object(object(object(object(roundtrip).association).value).reference).instrumentId).toBe(
    f.subject.canonicalInstrumentId,
  );
  expect(
    object(object(object(object(roundtrip).association).value).reference).instrumentId,
  ).not.toBe(object(object(object(roundtrip).association).value).legacyInstrumentId);
});
it("BIND caller mutation cannot rewrite an already materialized proposal", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  const data = f.prepare(1, "OBSERVING");
  const raw = structuredClone(data.capture);
  const captured = captureOpportunityContext(data.context, raw, f.policy);
  const original = evaluateOpportunity(data.input, captured, f.policy);
  expect(original.ok).toBe(true);
  object(object(object(object(raw.instrumentBinding).association).value).reference).fingerprint =
    "sha256:" + "9".repeat(64);
  expect(evaluateOpportunity(data.input, captured, f.policy)).toEqual(original);
});
it("BIND exact committed proof recovers and idempotency retains original ACK without new authority", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  const result = await f.step(1, "OBSERVING");
  const bytes = JSON.stringify(take(await f.repository.load()));
  await f.runtime.shutdown();
  const fresh = new OpportunityRuntime(f.repository, f.clock, f.authority, null, f.policy);
  expect((await fresh.initialize()).ok).toBe(true);
  expect(await fresh.commit(result.proposal)).toEqual(result.ack);
  expect(JSON.stringify(take(await f.repository.load()))).toBe(bytes);
  expect(fresh.diagnostics()).toMatchObject({
    ok: true,
    value: { currentReadiness: "NOT_READY", currentHealth: "DEGRADED" },
  });
});
it("BIND post-write interruption retains original operation through explicit recovery", async () => {
  const f = await journeyFixture();
  const data = f.prepare(0, "DORMANT"),
    p = f.evaluate(data);
  if (!p.ok) throw Error(p.error.code);
  const wrapper = {
    root: f.repository.root,
    storageMode: f.repository.storageMode,
    load: () => f.repository.load(),
    compareAppend: async (record: JournalRecord) => {
      const result = await f.repository.compareAppend(record);
      if (result.ok) throw Error("synthetic post-publication interruption");
      return result;
    },
  };
  const writer = new OpportunityRuntime(wrapper, f.clock, f.authority, f.host, f.policy);
  await writer.initialize();
  expect(await writer.commit(p.value)).toMatchObject({
    ok: false,
    error: { commitment: "UNKNOWN", operationRef: "step-0" },
  });
  expect((await writer.shutdown()).ok).toBe(false);
  expect((await writer.shutdown()).ok).toBe(false);
  expect(await writer.recover("step-0")).toMatchObject({
    ok: true,
    value: { operationId: "step-0" },
  });
  expect((await writer.shutdown()).ok).toBe(true);
});
it("BIND a valid native association cannot grant missing trusted-host authority", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  const data = f.prepare(1, "OBSERVING"),
    p = f.evaluate(data);
  if (!p.ok) throw Error(p.error.code);
  const reader = new OpportunityRuntime(
    f.repository,
    f.clock,
    f.authority,
    { ...f.host, verify: () => failure("AUTHORITY_UNESTABLISHED") },
    f.policy,
  );
  await reader.initialize();
  expect(await reader.commit(p.value)).toMatchObject({ ok: false, error: { commitment: "NONE" } });
  expect(take(await f.repository.load())).toHaveLength(1);
});
it("BIND native proof is charged under O1 and lower resource limits", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  const data = f.prepare(1, "OBSERVING");
  expect(() =>
    captureOpportunityContext(data.context, data.capture, {
      ...f.policy,
      limits: { ...f.policy.limits, maxOperationNodes: 100 },
    }),
  ).toThrow("BUDGET_EXHAUSTED");
  const meter = new Budget(f.policy.limits);
  meter.capture(data.capture);
  expect(meter.nodes).toBeGreaterThan(100);
});
it("BIND combined owner mismatch rejects even a rehashed hostile P25 observation", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  const data = f.prepare(1, "OBSERVING");
  const raw = structuredClone(data.capture),
    e = raw.evidence.find((e) => e.family === "OBSERVATION")!;
  const records = object(object(object(e.native).value).value).records;
  if (!Array.isArray(records)) throw Error("fixture");
  object(object(records[0]).plan).manifestFingerprint = "3".repeat(64);
  Reflect.set(e, "fingerprint", ownerFingerprint(records[0]));
  data.input.evidence = raw.evidence.map(metadata);
  data.context.nativeEvidenceRefs = data.input.evidence;
  Reflect.set(data, "capture", raw);
  expect(f.evaluate(data).ok).toBe(false);
});
it("BIND optional evidence cannot invoke automatic routes or confer execution certification", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  const data = f.prepare(1, "OBSERVING");
  const p = f.evaluate(data);
  expect(p).toMatchObject({
    ok: true,
    value: { currentUsability: "UNKNOWN", tradingAuthority: false },
  });
  expect(f.runtime.diagnostics()).toMatchObject({
    ok: true,
    value: {
      driverEnabled: false,
      passiveRoutes: ["DISABLED", "DISABLED", "DISABLED", "DISABLED"],
    },
  });
  let calls = 0;
  Reflect.set(data.capture.instrumentBinding!, "refresh", () => {
    calls++;
  });
  expect(() => f.evaluate(data)).toThrow();
  expect(calls).toBe(0);
});

import { readFile, writeFile } from "node:fs/promises";
it("J23 genuine filesystem full lifecycle recovers exact native identities without current authority", async () => {
  const f = await journeyFixture(true);
  for (const [i, state] of ordinaryStates.entries()) await f.step(i, state);
  const original = take(await f.repository.load());
  const physical = await Promise.all(
    original.map((_, i) =>
      readFile(join(f.repository.root, `journal-${String(i + 1).padStart(8, "0")}.json`), "utf8"),
    ),
  );
  await f.runtime.shutdown();
  for (let i = 0; i < 2; i++) {
    const repository = new FilesystemOpportunityRepository(f.repository.root, f.policy);
    const reader = new OpportunityRuntime(repository, f.clock, f.authority, null, f.policy);
    const recovered = await reader.initialize();
    expect(recovered.ok, JSON.stringify(recovered)).toBe(true);
    if (recovered.ok) {
      expect(recovered.value).toEqual(original);
      expect(
        await Promise.all(
          original.map((_, i) =>
            readFile(
              join(f.repository.root, `journal-${String(i + 1).padStart(8, "0")}.json`),
              "utf8",
            ),
          ),
        ),
      ).toEqual(physical);
      expect(recovered.value.at(-1)!.snapshot.state).toBe("QUALIFIED");
    }
    expect(reader.diagnostics()).toMatchObject({
      ok: true,
      value: { currentReadiness: "NOT_READY", currentAuthority: "UNESTABLISHED" },
    });
    expect((await reader.shutdown()).ok).toBe(true);
  }
});
it("J24 corrupt physical checkpoint fails recovery without repair or successful shutdown", async () => {
  const f = await journeyFixture(true);
  await f.step(0, "DORMANT");
  await f.runtime.shutdown();
  const path = join(f.repository.root, "journal-00000001.json");
  const before = await readFile(path, "utf8");
  await writeFile(path, before + " ");
  const reader = new OpportunityRuntime(
    new FilesystemOpportunityRepository(f.repository.root, f.policy),
    f.clock,
    f.authority,
    null,
    f.policy,
  );
  expect(await reader.initialize()).toMatchObject({ ok: false, error: { commitment: "UNKNOWN" } });
  expect((await reader.shutdown()).ok).toBe(false);
  expect((await reader.shutdown()).ok).toBe(false);
  expect(await readFile(path, "utf8")).toBe(before + " ");
});
it("J25 genuine filesystem append followed by lost callback retains obligation until exact recovery", async () => {
  const f = await journeyFixture(true),
    data = f.prepare(0, "DORMANT"),
    p = f.evaluate(data);
  if (!p.ok) throw Error(p.error.code);
  const wrapper = {
    root: f.repository.root,
    storageMode: f.repository.storageMode,
    load: () => f.repository.load(),
    compareAppend: async (record: JournalRecord) => {
      const result = await f.repository.compareAppend(record);
      if (result.ok) throw Error("synthetic callback loss after actual filesystem ACK");
      return result;
    },
  };
  const writer = new OpportunityRuntime(wrapper, f.clock, f.authority, f.host, f.policy);
  await writer.initialize();
  expect(await writer.commit(p.value)).toMatchObject({
    ok: false,
    error: { commitment: "UNKNOWN", operationRef: "step-0" },
  });
  expect(writer.diagnostics()).toMatchObject({
    ok: true,
    value: { obligation: { pending: 1, operationRef: "step-0" } },
  });
  expect((await writer.shutdown()).ok).toBe(false);
  expect((await writer.recover("other")).ok).toBe(false);
  expect(await writer.recover("step-0")).toMatchObject({
    ok: true,
    value: { operationId: "step-0", storageMode: "OFFLINE_FILESYSTEM" },
  });
  expect((await writer.shutdown()).ok).toBe(true);
  expect((await writer.shutdown()).ok).toBe(true);
});
function replaceEvidence(
  data: ReturnType<Awaited<ReturnType<typeof journeyFixture>>["prepare"]>,
  evidence: CapturedEvidence[],
) {
  Reflect.set(data.capture, "evidence", evidence);
  data.input.evidence = evidence.map(metadata);
  data.context.nativeEvidenceRefs = data.input.evidence;
}
async function correctedCase() {
  const f = await journeyFixture(false, true);
  await f.step(0, "DORMANT");
  await f.step(1, "OBSERVING");
  const initial = f.prepare(2, "INTERESTING"),
    manifest = initial.context.predicateManifests[0]!;
  manifest.clauses[0]!.decimalConstant = "1";
  const { fingerprint: ignored, ...body } = manifest;
  void ignored;
  manifest.fingerprint = fingerprint("ate.opportunity-predicate/1", body);
  const p = f.evaluate(initial);
  expect(p.ok, JSON.stringify(p)).toBe(true);
  if (!p.ok) throw Error(p.error.code);
  expect((await f.runtime.commit(p.value)).ok).toBe(true);
  await f.sync();
  const old = take(await f.repository.load());
  const at = mustParseUtc("2026-10-10T09:00:01.000Z");
  f.clock.advanceTo(at);
  f.f.clock.advanceTo(at);
  expect(f.bars.events.find((e) => e.eventAt.endsWith("08:59:30.000Z"))!.eligibilityAt).toBe(
    "2026-10-10T09:00:00.000Z",
  );
  f.bars.releaseLast();
  const history = take(f.f.engine.history(f.revision.barId)),
    revision = history.at(-1)!;
  expect(revision.state).toBe("CORRECTED");
  expect(revision.parentRevisionId).toBe(f.revision.revisionId);
  expect(revision.final).toBe(true);
  const correction: CapturedEvidence = {
    ...f.bar,
    recordId: revision.revisionId,
    generation: revision.generation,
    fingerprint: revision.contentFingerprint,
    eventAt: revision.eventAt,
    availableAt: revision.availableAt,
    correctionOf: revision.parentRevisionId ?? null,
    native: revision,
  };
  const data = f.prepare(3, "OBSERVING");
  data.context.predicateManifests = [manifest];
  replaceEvidence(data, [correction, ...f.observations.slice(0, 2)]);
  return { f, data, old, revision, manifest };
}
it("J13 genuine late correction weakens only forward with immutable parent lineage", async () => {
  const { f, data, old, revision } = await correctedCase();
  const p = f.evaluate(data);
  expect(p, JSON.stringify(p)).toMatchObject({
    ok: true,
    value: { to: "OBSERVING", reasonCodes: ["EVIDENCE_WEAKENED"] },
  });
  if (!p.ok) throw Error(p.error.code);
  expect((await f.runtime.commit(p.value)).ok).toBe(true);
  expect(take(await f.repository.load()).slice(0, old.length)).toEqual(old);
  expect(revision.contentFingerprint).not.toBe(f.revision.contentFingerprint);
});
it("J15 future-available native correction is invisible to the earlier cutoff", async () => {
  const { f, data, old } = await correctedCase();
  data.input.knowledgeCutoff = "2026-10-10T09:00:00.000Z";
  expect(f.evaluate(data)).toMatchObject({ ok: false, error: { code: "OPP:LOOKAHEAD" } });
  expect(take(await f.repository.load())).toEqual(old);
  data.input.knowledgeCutoff = f.clock.now();
  expect(f.evaluate(data).ok).toBe(true);
});

import {
  buildLocalReport,
  buildOpportunityHandoff,
  buildCoverageHandoff,
  buildOpportunityHelp,
  serializeOpportunityExport,
} from "@ate/mose-opportunities";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { inOperation, operationBudget } from "../../packages/mose-opportunities/src/validation.js";
import { recoverJournal } from "../../packages/mose-opportunities/src/recovery.js";
import { canonical } from "../../packages/mose-opportunities/src/canonical.js";
it("J02 no market evidence cannot promote a declared watch or establish absence", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  const data = f.prepare(1, "OBSERVING");
  replaceEvidence(data, []);
  Reflect.set(data.capture, "scanner", null);
  expect(f.evaluate(data)).toMatchObject({ ok: false, error: { code: "OPP:EVIDENCE_MISSING" } });
  expect(f.prior!.state).toBe("DORMANT");
  expect(f.runtime.diagnostics()).toMatchObject({
    ok: true,
    value: { coverage: { status: "UNKNOWN", denominator: null } },
  });
});
it("J03 genuine DUE receipt without completed work and owner ACK cannot admit observation", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  const data = f.prepare(1, "OBSERVING");
  const total = take(f.f.scanner.queryHistory(f.clock.now(), 0, 1)).total;
  let found = false;
  for (let i = 0; i < total; i++) {
    const result = f.f.scanner.queryHistory(f.clock.now(), i, 1),
      page = take(result);
    if (
      page.records[0]!.state.work.some(
        (w) => w.status === "DUE" && w.requests.includes(f.f.trigger(0).id),
      )
    ) {
      Reflect.set(data.capture, "scanner", {
        receipt: data.capture.scanner!.receipt,
        checkpoint: result,
      });
      found = true;
      break;
    }
  }
  expect(found).toBe(true);
  expect(f.evaluate(data)).toMatchObject({ ok: false, error: { code: "OPP:RECEIPT_MISSING" } });
  expect(take(await f.repository.load())).toHaveLength(1);
});
it("J04 stale genuine evidence remains stale regardless of context", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  const data = f.prepare(1, "OBSERVING");
  data.input.decisionCutoff = "2026-10-10T09:05:00.001Z";
  data.input.capturedClock.now = data.input.decisionCutoff;
  expect(f.evaluate(data)).toMatchObject({ ok: false, error: { code: "OPP:EVIDENCE_STALE" } });
});
it("J05 a serializable DTO with no admitted native capture cannot become source authority", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  const data = f.prepare(1, "OBSERVING");
  expect(
    evaluateOpportunity(data.input, JSON.parse(JSON.stringify(data.context)), f.policy),
  ).toMatchObject({ ok: false, error: { code: "OPP:SOURCE_UNVERIFIED" } });
});
it("J06 absent optional P27 assessment does not fabricate MINIMAL or block independent T1", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  const r = await f.step(1, "OBSERVING");
  expect(r.data.capture.evidence.some((e) => e.family === "ATTENTION")).toBe(false);
  expect(r.proposal).not.toHaveProperty("attentionTier");
  expect(r.proposal.currentUsability).toBe("UNKNOWN");
});
it("J07 a HIGH attention claim alone cannot promote a historical watch", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  const data = f.prepare(1, "OBSERVING");
  // Deliberately untrusted HIGH claim: a caller's tier and self-hash are not native owner authority.
  const claim = { tier: "HIGH", opportunityState: "UNSUPPORTED" };
  const e = {
    ...f.declaration,
    recordId: "untrusted-high",
    family: "ATTENTION" as const,
    owner: "@ate/mose-attention",
    ownerVersion: "0.27.0-adaptive-surveillance.1",
    native: { ok: true, value: claim },
    fingerprint: ownerFingerprint(claim),
  };
  replaceEvidence(data, [e]);
  const rejected = (() => {
    try {
      return !f.evaluate(data).ok;
    } catch {
      return true;
    }
  })();
  expect(rejected).toBe(true);
  expect(f.prior!.state).toBe("DORMANT");
});
it("J08 a genuine observation cannot authorize a multi-edge leap", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  const data = f.prepare(1, "QUALIFIED");
  expect(f.evaluate(data)).toMatchObject({ ok: false, error: { code: "OPP:TRANSITION_DENIED" } });
});
async function expiredCase() {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  f.clock.advanceTo(mustParseUtc(f.prior!.expiresAt));
  const data = f.prepare(1, "EXPIRED");
  replaceEvidence(data, []);
  Reflect.set(data.capture, "scanner", null);
  return { f, data };
}
it("J09 terminal absorption and explicit governed generation use distinct keys", async () => {
  const { f, data } = await expiredCase();
  const p = f.evaluate(data);
  if (!p.ok) throw Error(p.error.code);
  expect((await f.runtime.commit(p.value)).ok).toBe(true);
  await f.sync();
  const restart = f.prepare(1, "DORMANT");
  replaceEvidence(restart, []);
  expect(f.evaluate(restart).ok).toBe(false);
  const parent = f.prior!,
    next = f.prepare(0, "DORMANT");
  next.context.historicalState = null;
  next.context.previousEventFingerprint = null;
  next.context.subject = {
    ...next.context.subject,
    lifecycleGeneration: 2,
    predecessorGenerationKey: parent.key,
  };
  const native = {
    watchDeclarationId: next.context.subject.watchDeclarationId,
    subjectFingerprint: subjectFingerprint(next.context.subject),
    policyFingerprint: policyFingerprint(f.policy),
    sourceOriginFingerprint: next.context.subject.sourceOriginFingerprint,
  };
  const declaration = {
    ...f.declaration,
    recordId: "next-generation-watch",
    subjectFingerprint: native.subjectFingerprint,
    eventAt: f.clock.now(),
    availableAt: f.clock.now(),
    fingerprint: fingerprint("ate.opportunity-native/1", native),
    native: { ok: true, value: native },
  };
  next.input.key = makeOpportunityKey(next.context.subject, f.policy, f.origin);
  next.input.expectedHead = null;
  next.input.commandId = "next-generation";
  replaceEvidence(next, [declaration]);
  expect(next.input.key).not.toBe(parent.key);
  const birth = f.evaluate(next);
  expect(birth.ok, JSON.stringify(birth)).toBe(true);
  if (!birth.ok) throw Error(birth.error.code);
  expect((await f.runtime.commit(birth.value)).ok).toBe(true);
});
it("J10 duplicate command returns the original immutable ACK without journal growth", async () => {
  const f = await journeyFixture(),
    r = await f.step(0, "DORMANT");
  const before = canonical(take(await f.repository.load()));
  expect(await f.runtime.commit(r.proposal)).toEqual(r.ack);
  expect(canonical(take(await f.repository.load()))).toBe(before);
});
it("J11 conflicting same-command payload cannot replace a retained commitment", async () => {
  const f = await journeyFixture(),
    r = await f.step(0, "DORMANT");
  r.data.input.configurationReleaseRef = "different-release";
  const changed = f.evaluate(r.data);
  expect(changed.ok).toBe(true);
  if (!changed.ok) throw Error(changed.error.code);
  expect(await f.runtime.commit(changed.value)).toMatchObject({
    ok: false,
    error: { code: "OPP:COMMAND_CONFLICT", commitment: "NONE" },
  });
  expect(take(await f.repository.load())).toHaveLength(1);
});
it("J12 contradictory bytes under one immutable native identity reject", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  const data = f.prepare(1, "OBSERVING"),
    conflict = structuredClone(f.bar);
  Reflect.set(object(conflict.native), "close", "999");
  replaceEvidence(data, [f.bar, conflict, ...f.observations.slice(0, 1)]);
  expect(f.evaluate(data)).toMatchObject({ ok: false, error: { code: "OPP:IMMUTABLE_CONFLICT" } });
});
function revocation(
  f: Awaited<ReturnType<typeof journeyFixture>>,
  extra: Record<string, unknown> = {},
) {
  const native = {
    revoked: true,
    subjectFingerprint: subjectFingerprint(f.subject),
    policyFingerprint: policyFingerprint(f.policy),
    sourceOriginFingerprint: f.subject.sourceOriginFingerprint,
    ...extra,
  };
  return f.ref(
    "REVOCATION",
    "scoped-revocation",
    fingerprint("ate.opportunity-native/1", native),
    { ok: true, value: native },
    "@ate/mose-opportunities",
    "0.28.0-opportunity-state.1",
  );
}
it("J14 an explicit scoped retraction invalidates while preserving original evidence", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  await f.step(1, "OBSERVING");
  const old = take(await f.repository.load());
  const data = f.prepare(1, "OBSERVING");
  data.input.commandId = "explicit-retraction";
  replaceEvidence(data, [revocation(f, { reason: "explicit governed research retraction" })]);
  const p = f.evaluate(data);
  expect(p).toMatchObject({ ok: true, value: { to: "INVALIDATED" } });
  if (!p.ok) throw Error(p.error.code);
  expect((await f.runtime.commit(p.value)).ok).toBe(true);
  expect(take(await f.repository.load()).slice(0, old.length)).toEqual(old);
});
it("J16 unfinished M15 H1 H4 native windows cannot contaminate earlier decisions", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  for (const timeframe of ["M15", "H1", "H4"]) {
    const boundary = mustParseUtc("2026-10-10T09:00:00.000Z");
    expect(f.f.engine.publishWindow(f.bars.streamId, timeframe, boundary, true).ok).toBe(false);
    const id = take(f.f.engine.publishWindow(f.bars.streamId, timeframe, boundary, false)),
      native = f.f.engine.readRevision(id)!;
    expect(native.final).toBe(false);
    expect(native.window.end > f.clock.now()).toBe(true);
    const data = f.prepare(1, "OBSERVING"),
      bar = {
        ...f.bar,
        recordId: native.revisionId,
        generation: native.generation,
        fingerprint: native.contentFingerprint,
        eventAt: native.eventAt,
        availableAt: native.availableAt,
        finality: "PROVISIONAL" as const,
        native,
      };
    replaceEvidence(data, [bar, ...f.observations.slice(0, 1)]);
    expect(f.evaluate(data)).toMatchObject({
      ok: false,
      error: { code: "OPP:EVIDENCE_INCOMPLETE" },
    });
  }
});
it("J17 exact expiry boundary is local temporal evidence and not a market revocation", async () => {
  const { f, data } = await expiredCase(),
    at = data.input.decisionCutoff;
  data.input.decisionCutoff = new Date(Date.parse(at) - 1).toISOString();
  data.input.knowledgeCutoff = data.input.decisionCutoff;
  expect(f.evaluate(data)).toMatchObject({ ok: false, error: { code: "OPP:NOT_EXPIRED" } });
  data.input.decisionCutoff = at;
  data.input.knowledgeCutoff = at;
  const p = f.evaluate(data);
  expect(p).toMatchObject({ ok: true, value: { to: "EXPIRED", reasonCodes: ["EXPIRED"] } });
  if (!p.ok) throw Error(p.error.code);
  expect((await f.runtime.commit(p.value)).ok).toBe(true);
});
it("J18 immutable policy revisions produce distinct research keys", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  const before = canonical(take(await f.repository.load()));
  const next = { ...f.policy, version: "2" };
  expect(makeOpportunityKey(f.subject, next, f.origin)).not.toBe(f.prior!.key);
  expect(canonical(take(await f.repository.load()))).toBe(before);
});
it("J19 untrusted clock claims cannot authorize a transition", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  const data = f.prepare(1, "OBSERVING");
  data.input.capturedClock.quality = "UNKNOWN";
  expect(f.evaluate(data)).toMatchObject({ ok: false, error: { code: "OPP:CLOCK_UNTRUSTED" } });
});
it("J20 scanner outstanding work and admission-fairness restrictions survive P28 evaluation", async () => {
  const f = await journeyFixture(false, true);
  await f.step(0, "DORMANT");
  take(await f.f.scanner.request(f.f.trigger(3)));
  const before = take(f.f.scanner.query(0, 10));
  expect(before.work.some((w) => w.status === "DUE")).toBe(true);
  await f.step(1, "OBSERVING");
  expect(take(f.f.scanner.query(0, 10))).toEqual(before);
  expect(f.runtime.diagnostics()).toMatchObject({
    ok: true,
    value: { coverage: { status: "UNKNOWN", denominator: null }, driverEnabled: false },
  });
});
it("J21 original request-pagination limitation requires totalRequests and explicit offsets", async () => {
  const f = await journeyFixture();
  take(await f.f.scanner.request({ ...f.f.trigger(0), id: "extra-coalesced-request" }));
  const page = take(f.f.scanner.query(0, 3));
  expect(page.totalRequests).toBe(4);
  expect(page.nextOffset).toBe(null);
  expect(page.requests).toHaveLength(3);
  const tail = take(f.f.scanner.query(3, 1));
  expect(tail.requests).toHaveLength(1);
  expect(tail.requests[0]!.trigger.id).toBe("extra-coalesced-request");
});
it("J22 equal data never substitutes for established scope consistency", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  const data = f.prepare(1, "OBSERVING");
  data.input.consistency = "CONSISTENCY_UNESTABLISHED";
  data.context.scopeConsistencyEvidenceRef = null;
  expect(f.evaluate(data)).toMatchObject({
    ok: false,
    error: { code: "OPP:CONSISTENCY_UNESTABLISHED" },
  });
});
it("J26 feasible full recovery and exact cumulative node/record boundaries reject one beyond", async () => {
  const f = await journeyFixture();
  for (const [i, state] of ordinaryStates.entries()) await f.step(i, state);
  const records = take(await f.repository.load());
  let consumed = 0;
  inOperation(f.policy.limits, () => {
    expect(recoverJournal(records, f.repository.root, f.policy)).toHaveLength(6);
    consumed = operationBudget(f.policy.limits).nodes;
  });
  expect(consumed).toBeLessThanOrEqual(10000);
  const exact = {
    ...f.policy,
    limits: { ...f.policy.limits, maxJournalRecords: 6, maxReplayRecords: 6 },
  };
  expect(recoverJournal(records, f.repository.root, exact)).toHaveLength(6);
  expect(() =>
    recoverJournal(records, f.repository.root, {
      ...exact,
      limits: { ...exact.limits, maxJournalRecords: 5 },
    }),
  ).toThrow("BUDGET_EXHAUSTED");
  const nodes = new Budget(f.policy.limits);
  nodes.capture(Array.from({ length: 9999 }, () => 0));
  expect(nodes.nodes).toBe(10000);
  expect(() => nodes.capture(0)).toThrow("BUDGET_EXHAUSTED");
  expect(take(await f.repository.load())).toEqual(records);
});
it("J27 mismatched Actor grant is side-effect free and leaves no obligation", async () => {
  const f = await journeyFixture(),
    data = f.prepare(0, "DORMANT"),
    p = f.evaluate(data);
  if (!p.ok) throw Error(p.error.code);
  const host: TrustedHostAuthorization = {
    ...f.host,
    verify(request) {
      const result = f.host.verify(request);
      if (!result.ok) return result;
      return {
        ok: true,
        value: {
          ...result.value,
          actor: { actorType: "USER", actorId: "40000000-0000-4000-8000-000000000099" },
        },
      };
    },
  };
  const writer = new OpportunityRuntime(f.repository, f.clock, f.authority, host, f.policy);
  await writer.initialize();
  expect(await writer.commit(p.value)).toMatchObject({ ok: false, error: { commitment: "NONE" } });
  expect(take(await f.repository.load())).toEqual([]);
  expect(writer.diagnostics()).toMatchObject({ ok: true, value: { obligation: { pending: 0 } } });
});
it("J28 source-integrity guard rejects a changed identity module", () => {
  const directory = "packages/mose-opportunities/src",
    names = readdirSync(directory).sort(),
    expected = readFileSync("tests/mose-opportunities/architecture.test.ts", "utf8").match(
      /const expected = "([a-f0-9]{64})"/u,
    )![1];
  const digest = (mutate: boolean) => {
    const hash = createHash("sha256");
    for (const name of names)
      hash
        .update(name + "\n")
        .update(readFileSync(join(directory, name)))
        .update(mutate && name === "identity.ts" ? "\n// unauthorized identity mutation\n" : "")
        .update("\n");
    return hash.digest("hex");
  };
  expect(digest(false)).toBe(expected);
  expect(digest(true)).not.toBe(expected);
});
it("J29 local reporting retains actual binding proofs and refuses global completeness", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  await f.step(1, "OBSERVING");
  const records = take(await f.repository.load()) as readonly JournalRecord[];
  const report = buildLocalReport(records, f.policy);
  expect(report).toMatchObject({
    ok: true,
    value: {
      denominator: { status: "KNOWN_LOCAL", value: 1 },
      globalCoverage: "UNKNOWN",
      nativeP28FoundationIntegration: "UNSUPPORTED",
      candidateToQualified: { status: "UNSUPPORTED", value: null },
      instrumentBindings: [f.instrumentBinding],
    },
  });
  expect(serializeOpportunityExport(take(report), f.policy).ok).toBe(true);
});
it("J30 contextual help and all five static documents preserve offline research scope", () => {
  for (const term of [
    "DORMANT",
    "OBSERVING",
    "QUALIFIED",
    "INVALIDATED",
    "EXPIRED",
    "UNKNOWN",
    "NONE",
    "ACK",
  ]) {
    expect(buildOpportunityHelp(term)).toMatchObject({
      ok: true,
      value: {
        frontendImplemented: false,
        tradingAuthority: false,
        nativeP28FoundationIntegration: "UNSUPPORTED",
      },
    });
  }
  for (const path of [
    "docs/architecture/mose-opportunities.md",
    "docs/help/mose-opportunities.md",
    "docs/help/mose-opportunities-administration.md",
    "docs/help/mose-opportunities-developer.md",
    "docs/help/mose-opportunities-glossary.md",
  ]) {
    const text = readFileSync(path, "utf8");
    expect(text).toMatch(/offline/iu);
    expect(text).toMatch(/P29|Prompt 29|P29\/P30/u);
  }
});
it("J31 immutable P29/P30 pull artifacts fabricate neither rank nor coverage", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  await f.step(1, "OBSERVING");
  const records = take(await f.repository.load()) as readonly JournalRecord[];
  expect(buildOpportunityHandoff(records.at(-1)!, f.policy)).toMatchObject({
    ok: true,
    value: {
      rankingOwner: "P29_UNAVAILABLE",
      confidence: { status: "UNSUPPORTED", value: null },
      currentEligibility: "UNESTABLISHED",
      tradingAuthority: false,
      instrumentBinding: f.instrumentBinding,
    },
  });
  expect(buildCoverageHandoff(records, f.policy)).toMatchObject({
    ok: true,
    value: {
      coverageOwner: "P30_UNAVAILABLE",
      currentCoverage: "UNKNOWN",
      denominator: { status: "UNKNOWN", value: null },
    },
  });
});
it("J32 replayed evidence order and duplicate references preserve deterministic event identity", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  const data = f.prepare(1, "OBSERVING"),
    first = f.evaluate(data);
  expect(first.ok).toBe(true);
  replaceEvidence(data, [...data.capture.evidence].reverse());
  expect(f.evaluate(data)).toEqual(first);
  replaceEvidence(data, [...data.capture.evidence, data.capture.evidence[0]!]);
  expect(f.evaluate(data)).toEqual(first);
});
it("J33 real governed P24 revocation supports scoped T8 but grants no current authority", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  await f.step(1, "OBSERVING");
  await f.o.promote("RESEARCH", { disposition: "REVOKED" });
  const eligibility = f.o.service.getEligibility(f.subject.canonicalInstrumentId);
  const native = take(await eligibility);
  expect(native.recorded.disposition).toBe("REVOKED");
  expect(
    native.current.capabilities.find((c) => c.capability === "HISTORICAL_DATA_RESEARCH")!.allowed,
  ).toBe(false);
  const data = f.prepare(1, "OBSERVING");
  data.input.commandId = "actual-eligibility-revocation";
  replaceEvidence(data, [revocation(f, { eligibilityResult: await eligibility })]);
  const p = f.evaluate(data);
  expect(p).toMatchObject({ ok: true, value: { to: "INVALIDATED", currentUsability: "UNKNOWN" } });
  if (!p.ok) throw Error(p.error.code);
  expect((await f.runtime.commit(p.value)).ok).toBe(true);
});
it("J34 repository NONE and UNKNOWN retain distinct obligation semantics", async () => {
  for (const commitment of ["NONE", "UNKNOWN"] as const) {
    const f = await journeyFixture(),
      data = f.prepare(0, "DORMANT"),
      p = f.evaluate(data);
    if (!p.ok) throw Error(p.error.code);
    const wrapper = {
      root: f.repository.root,
      storageMode: f.repository.storageMode,
      load: () => f.repository.load(),
      compareAppend: () => Promise.resolve(failure("SYNTHETIC_REPOSITORY_OUTCOME", commitment)),
    };
    const writer = new OpportunityRuntime(wrapper, f.clock, f.authority, f.host, f.policy);
    await writer.initialize();
    expect(await writer.commit(p.value)).toMatchObject({ ok: false, error: { commitment } });
    expect(writer.diagnostics()).toMatchObject({
      ok: true,
      value: { obligation: { pending: commitment === "UNKNOWN" ? 1 : 0 } },
    });
    expect((await writer.shutdown()).ok).toBe(commitment === "NONE");
  }
});
it("J35 reentrant lifecycle calls cannot poison locks, duplicate ACKs or hide obligations", async () => {
  const f = await journeyFixture(),
    data = f.prepare(0, "DORMANT"),
    p = f.evaluate(data);
  if (!p.ok) throw Error(p.error.code);
  const nested: unknown[] = [];
  const wrapper = {
    root: f.repository.root,
    storageMode: f.repository.storageMode,
    load: () => f.repository.load(),
    compareAppend: async (record: JournalRecord) => {
      nested.push(
        await writer.commit(p.value),
        await writer.initialize(),
        await writer.shutdown(),
        writer.query({}),
      );
      return f.repository.compareAppend(record);
    },
  };
  const writer = new OpportunityRuntime(wrapper, f.clock, f.authority, f.host, f.policy);
  await writer.initialize();
  expect((await writer.commit(p.value)).ok).toBe(true);
  expect(nested).toHaveLength(4);
  for (const result of nested) expect(result).toMatchObject({ ok: false });
  expect(take(await f.repository.load())).toHaveLength(1);
  expect((await writer.shutdown()).ok).toBe(true);
  expect((await writer.shutdown()).ok).toBe(true);
});
it("J36 absent multi-dimensional owners yield unsupported evidence rather than invented classifiers", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  await f.step(1, "OBSERVING");
  const data = f.prepare(2, "INTERESTING"),
    m = data.context.predicateManifests[0]!;
  m.requiredDimensions = ["TRENDING-owner-unavailable", "VOLATILITY-owner-unavailable"];
  m.clauses = [
    {
      dimensionRef: m.requiredDimensions[0]!,
      field: "close",
      operator: "GE",
      decimalConstant: "1",
      unit: "USD",
    },
  ];
  const { fingerprint: ignored, ...body } = m;
  void ignored;
  m.fingerprint = fingerprint("ate.opportunity-predicate/1", body);
  expect(f.evaluate(data)).toMatchObject({
    ok: false,
    error: { code: "OPP:UNSUPPORTED_DIMENSION" },
  });
  expect(f.prior!.state).toBe("OBSERVING");
});

// Owner-approved event lineage amendment: event and physical ACK chains remain distinct.
import { proposalDetails } from "../../packages/mose-opportunities/src/evidence.js";
import { contextSchema } from "../../packages/mose-opportunities/src/contracts.js";
it("lineage birth captures no event predecessor", async () => {
  const f = await journeyFixture();
  const d = f.prepare(0, "DORMANT");
  expect(d.context.previousEventFingerprint).toBe(null);
  expect(f.evaluate(d).ok).toBe(true);
});
it("lineage event hash uses the actual previous event and preserves the ACK hash", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  await f.step(1, "OBSERVING");
  const rows = take(await f.repository.load()) as readonly JournalRecord[];
  const parent = rows.at(-1)!;
  const d = f.prepare(2, "INTERESTING"),
    p = take(f.evaluate(d));
  const { eventFingerprint, ...body } = p;
  const payloadFingerprint = fingerprint("ate.opportunity-payload/1", {
    ...body,
    ...proposalDetails(p),
  });
  const tuple = {
    key: d.input.key,
    sequence: parent.snapshot.head.eventSequence + 1,
    previousEventFingerprint: parent.proposal.eventFingerprint,
    commandId: d.input.commandId,
    payloadFingerprint,
    policyFingerprint: d.input.policyFingerprint,
    decisionCutoff: d.input.decisionCutoff,
  };
  expect(parent.fingerprint).not.toBe(parent.proposal.eventFingerprint);
  expect(d.context.historicalState!.head.fingerprint).toBe(parent.fingerprint);
  expect(eventFingerprint).toBe(fingerprint("ate.opportunity-event/1", tuple));
  expect(eventFingerprint).not.toBe(
    fingerprint("ate.opportunity-event/1", {
      ...tuple,
      previousEventFingerprint: parent.fingerprint,
    }),
  );
  expect((await f.runtime.commit(p)).ok).toBe(true);
});
for (const kind of ["wrong", "ACK_SUBSTITUTED"] as const)
  it(`lineage commit rejects ${kind} event predecessor despite correct ACK`, async () => {
    const f = await journeyFixture();
    await f.step(0, "DORMANT");
    const d = f.prepare(1, "OBSERVING");
    d.context.previousEventFingerprint =
      kind === "wrong" ? "sha256:" + "a".repeat(64) : f.prior!.head.fingerprint;
    const p = take(f.evaluate(d));
    const before = take(await f.repository.load());
    expect(await f.runtime.commit(p)).toMatchObject({
      ok: false,
      error: { commitment: "NONE", code: "OPP:STALE_PREDECESSOR" },
    });
    expect(await f.repository.load()).toEqual({ ok: true, value: before });
  });
it("lineage strict context rejects a missing predecessor field", async () => {
  const f = await journeyFixture();
  const d = f.prepare(0, "DORMANT");
  const { previousEventFingerprint, ...missing } = d.context;
  void previousEventFingerprint;
  expect(contextSchema.safeParse(missing).success).toBe(false);
});
for (const [birth, value] of [
  [true, "sha256:" + "a".repeat(64)],
  [false, null],
] as const)
  it(`lineage rejects contradictory predecessor nullability birth=${birth}`, async () => {
    const f = await journeyFixture();
    if (!birth) await f.step(0, "DORMANT");
    const d = f.prepare(birth ? 0 : 1, birth ? "DORMANT" : "OBSERVING");
    d.context.previousEventFingerprint = value;
    expect(f.evaluate(d)).toMatchObject({ ok: false, error: { code: "OPP:STALE_PREDECESSOR" } });
  });
it("lineage duplicate event submission returns identical ACK without another record", async () => {
  const f = await journeyFixture();
  const p = take(f.evaluate(f.prepare(0, "DORMANT")));
  const first = await f.runtime.commit(p);
  expect(first.ok).toBe(true);
  expect(await f.runtime.commit(p)).toEqual(first);
  expect(take(await f.repository.load())).toHaveLength(1);
});
it("lineage repeated ACK survives fresh restart with exact identity", async () => {
  const f = await journeyFixture();
  const p = take(f.evaluate(f.prepare(0, "DORMANT")));
  const ack = await f.runtime.commit(p);
  await f.runtime.shutdown();
  const fresh = new OpportunityRuntime(f.repository, f.clock, f.authority, f.host, f.policy);
  expect((await fresh.initialize()).ok).toBe(true);
  expect(await fresh.commit(p)).toEqual(ack);
  expect(take(await f.repository.load())).toHaveLength(1);
});
it("lineage recovery rejects tampered previous-event data without rewriting history", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  await f.step(1, "OBSERVING");
  const rows = take(await f.repository.load()) as readonly JournalRecord[];
  const bad = structuredClone(rows);
  bad[1]!.details.context.previousEventFingerprint = "sha256:" + "a".repeat(64);
  expect(() => recoverJournal(bad, f.repository.root, f.policy)).toThrow();
  expect(take(await f.repository.load())).toEqual(rows);
});
it("lineage materialized context is immutable and detached from caller", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  const d = f.prepare(1, "OBSERVING");
  const c = captureOpportunityContext(d.context, d.capture, f.policy),
    original = d.context.previousEventFingerprint;
  d.context.previousEventFingerprint = "sha256:" + "a".repeat(64);
  expect(c.previousEventFingerprint).toBe(original);
  expect(Object.isFrozen(c)).toBe(true);
  expect(() => Reflect.set(c, "previousEventFingerprint", null)).not.toThrow();
  expect(c.previousEventFingerprint).toBe(original);
});
it("lineage fresh historical read grants no current source authority", async () => {
  const f = await journeyFixture();
  await f.step(0, "DORMANT");
  await f.step(1, "OBSERVING");
  const records = take(await f.repository.load());
  await f.runtime.shutdown();
  const fresh = new OpportunityRuntime(f.repository, f.clock, f.authority, undefined, f.policy);
  expect((await fresh.initialize()).ok).toBe(true);
  expect(take(await f.repository.load())).toEqual(records);
  expect(fresh.diagnostics()).toMatchObject({
    ok: true,
    value: { currentReadiness: "NOT_READY", currentAuthority: "UNESTABLISHED" },
  });
});
