import { afterEach, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stableStringify } from "@ate/configuration";
import {
  ConfigurationRegistry,
  ConfigurationResolver,
  StaticConfigurationSource,
  StaticApprovalAuthorityResolver,
  buildConfigurationSnapshot,
  configurationEntry,
  configurationSourceId,
} from "@ate/configuration";
import { StateAuthorityRegistry } from "@ate/persistence";
import { durationMs, VirtualClock } from "@ate/time";
import {
  attentionConfigurationDefinitions,
  attentionStateOwnership,
  defaultAttentionPolicy,
  AdaptiveSurveillanceRuntime,
  MemoryAttentionRepository,
  type AttentionPolicy,
  type AttentionPorts,
  type AttentionRepository,
} from "@ate/mose-attention";
import { scannerConfigurationDefinitions, type ScannerPolicy } from "@ate/mose-scanner";
import { fixture as scannerFixture, take } from "../mose-scanner/fixtures.js";
import { checker, eligibilityFixture, root, time } from "../mose-core/fixtures.js";
import {
  resolveHistoricalReplayInputs,
  createReplaySpecification,
  ReplayController,
  FilesystemReplayCheckpointRepository,
} from "@ate/market-replay";
import { fingerprint } from "@ate/configuration";
import { issuer } from "../instrument-eligibility/fixtures.js";
import { replayFixture } from "../market-replay/fixtures.js";
const captures: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  const pending = captures.splice(0),
    root = process.env.ATE_ATTENTION_EVIDENCE_ROOT,
    name = expect.getState().currentTestName ?? "";
  if (!root || !/^A[0-9]{2} /u.test(name)) return;
  mkdirSync(root, { recursive: true });
  let i = 0;
  for (const capture of pending)
    writeFileSync(
      join(root, name.slice(0, 3) + "-" + i++ + ".json"),
      stableStringify({ journey: name, capture: await capture() }),
    );
});
export async function owners() {
  const o = await eligibilityFixture();
  const inputs = await resolveHistoricalReplayInputs({
    ...o.h.options,
    availability: () => ({
      kind: "SOURCE_PUBLICATION",
      availableAt: o.h.clock.now(),
      qualityAvailableAt: o.h.clock.now(),
      fingerprint: fingerprint({ synthetic: "trusted-offline-publication-for-attention" }),
    }),
  });
  o.replays.clear();
  for (const sessionId of ["attention-left", "attention-right"]) {
    const { fingerprint: _ignored, ...body } = replayFixture("VERIFIED_POINT_IN_TIME").spec;
    void _ignored;
    const specification = createReplaySpecification({
      ...body,
      sessionId,
      sourceManifestIds: inputs.manifests.map((m) => m.manifestId),
      datasetFingerprints: inputs.manifests.map((m) => m.contentFingerprint),
    });
    const controller = new ReplayController(
      specification,
      inputs,
      new FilesystemReplayCheckpointRepository(root(), o.h.clock, specification.resourceLimits),
    );
    const ready = await controller.initialize();
    if (!ready.ok) throw Error(ready.code);
    const done = await controller.runToEnd();
    if (!done.ok) throw Error(done.code);
    o.replays.set(sessionId, { specification, checkpoint: done.checkpoint, inputs });
  }
  o.context.replay = {
    leftSession: "attention-left",
    leftCheckpoint: o.replays.get("attention-left")!.checkpoint.fingerprint,
    rightSession: "attention-right",
    rightCheckpoint: o.replays.get("attention-right")!.checkpoint.fingerprint,
  };
  await o.toResearch();
  return o;
}
export { take, checker, durationMs };
export async function fixture(
  base: Awaited<ReturnType<typeof owners>>,
  changes: Partial<AttentionPolicy> = {},
  repository: AttentionRepository = new MemoryAttentionRepository(),
  peer?: Pick<Awaited<ReturnType<typeof owners>>, "context" | "service" | "ports" | "replays">,
  initialEvents = 3,
  scannerChanges: Partial<ScannerPolicy> = {},
) {
  const bind = (
    o: Pick<Awaited<ReturnType<typeof owners>>, "ports">,
    clock: typeof base.ports.clock,
  ) => {
    o.ports.clock = clock;
    o.ports.authorityResolver = new StaticApprovalAuthorityResolver({
      clock,
      grants: {
        [checker.actorId]: ["CONFIGURATION_CHECKER"],
        [issuer.actorId]: ["CONFIGURATION_CHECKER"],
      },
    });
  };
  bind(base, new VirtualClock(time));
  if (peer) bind(peer, new VirtualClock(time));
  const scanner = await scannerFixture(base, {
    trustedTriggerActors: [checker.actorId],
    ...scannerChanges,
  });
  bind(base, scanner.clock);
  if (peer) bind(peer, scanner.clock);
  let secondSubject: {
    sessionId: string;
    universe: string;
    instrumentId: string;
    subscriptions: string[];
  } | null = null;
  if (peer) {
    const a = base,
      b = peer;
    scanner.mose.ports.datasets = {
      getVersion: (id) =>
        id === b.context.datasets[0]!.versionId
          ? b.ports.datasets.getVersion(id)
          : a.ports.datasets.getVersion(id),
    };
    scanner.mose.ports.quality = {
      getReport: (id) =>
        id === b.context.datasets[0]!.qualityReportId
          ? b.ports.quality.getReport(id)
          : a.ports.quality.getReport(id),
    };
    scanner.mose.ports.historical = {
      getManifest: (id) =>
        b.ports.historical
          .getManifest(id)
          .then((r) => (r.ok ? r : a.ports.historical.getManifest(id))),
    };
    scanner.mose.ports.eligibility = {
      getEligibility: (id) =>
        id === b.context.instrumentId ? b.service.getEligibility(id) : a.service.getEligibility(id),
    };
    scanner.mose.ports.replayEvidence = (s, c) =>
      b.ports.replayEvidence(s, c) ?? a.ports.replayEvidence(s, c);
    scanner.ports.replayEvidence = scanner.mose.ports.replayEvidence;
    const replay = b.context.replay!,
      cp = take(
        await scanner.mose.service.dispatch(
          scanner.mose.create("session-B", {
            instruments: [
              {
                instrumentId: b.context.instrumentId,
                source: { sessionId: replay.leftSession, checkpoint: replay.leftCheckpoint },
              },
            ],
          }),
        ),
      ),
      u = cp.state.sessions.find((s) => s.universe.sessionId === "session-B")!.universe;
    take(
      await scanner.mose.service.dispatch({ kind: "START", id: "start-B", sessionId: "session-B" }),
    );
    for (const [i, event] of u.plan.entries())
      take(
        await scanner.mose.service.dispatch({
          kind: "RECEIVE",
          id: "receive-B-" + i,
          sessionId: "session-B",
          instrumentId: b.context.instrumentId,
          universeSnapshot: u.fingerprint,
          eventId: event.eventId,
        }),
      );
    take(
      await scanner.mose.service.dispatch({
        kind: "PROCESS",
        id: "process-B",
        sessionId: "session-B",
        limit: 16,
      }),
    );
    secondSubject = {
      sessionId: "session-B",
      universe: u.fingerprint,
      instrumentId: b.context.instrumentId,
      subscriptions: ["rescan-B"],
    };
  }
  await scanner.plan([
    scanner.subscription({ id: "rescan", mode: "TRIGGER" }),
    scanner.subscription({ id: "periodic", mode: "SECONDS", cadenceMs: 60000 }),
    ...(secondSubject
      ? [
          scanner.subscription({
            id: "rescan-B",
            mode: "TRIGGER",
            sessionId: secondSubject.sessionId,
            universe: secondSubject.universe,
            instrumentId: secondSubject.instrumentId,
          }),
          scanner.subscription({
            id: "periodic-B",
            mode: "SECONDS",
            cadenceMs: 60000,
            sessionId: secondSubject.sessionId,
            universe: secondSubject.universe,
            instrumentId: secondSubject.instrumentId,
          }),
        ]
      : []),
  ]);
  take(await scanner.start());
  for (let i = 0; i < Math.min(initialEvents, scanner.universe.plan.length); i++)
    take(await scanner.mose.receive(i));
  take(await scanner.mose.process());
  const clock = scanner.clock,
    policy = { ...defaultAttentionPolicy, anchor: clock.now(), ...changes };
  const registry = new ConfigurationRegistry(clock),
    defs = [...attentionConfigurationDefinitions(clock), ...scannerConfigurationDefinitions(clock)];
  for (const d of defs) take(registry.register(d));
  const config = async (p: AttentionPolicy) => {
    const source = new StaticConfigurationSource({
      clock,
      descriptor: {
        sourceId: configurationSourceId("attention-test"),
        sourceType: "TEST",
        name: "Governed attention test",
        criticality: "REQUIRED",
        failurePolicy: "FAIL_CLOSED",
        priority: 1,
      },
      entries: defs.map((d, i) =>
        configurationEntry({
          key: d.key,
          scopeType: "SYSTEM",
          value: JSON.stringify([p, scanner.policy, scanner.configuredPlan()][i]),
        }),
      ),
    });
    const snap = take(await buildConfigurationSnapshot({ registry, sources: [source], clock }));
    return take(
      new ConfigurationResolver(registry, snap, clock).resolve({ runtimeMode: "RESEARCH" }),
    );
  };
  let configuration = await config(policy);
  const authority = new StateAuthorityRegistry(clock);
  take(authority.register(attentionStateOwnership()));
  const ports: AttentionPorts = {
    clock,
    configuration: () => configuration,
    authority,
    mose: scanner.mose.service,
    scanner: scanner.scanner,
    eligibility: scanner.mose.ports.eligibility,
    replayEvidence: scanner.ports.replayEvidence,
    repository,
    readBarrier: {
      async withRead(asOf, read) {
        return { value: await read(), asOf, id: "offline-single-writer-test-barrier" };
      },
    },
  };
  const runtime = new AdaptiveSurveillanceRuntime(ports);
  take(await runtime.initialize());
  take(await runtime.dispatch({ kind: "START", id: "start" }));
  const subject = {
    sessionId: scanner.universe.sessionId,
    universe: scanner.universe.fingerprint,
    instrumentId: base.context.instrumentId,
    subscriptions: ["rescan"],
  };
  const assess = (id = "assess") =>
    runtime.dispatch({ kind: "ASSESS", id, subject, asOf: clock.now() });
  const allocate = (id = "allocate", limit = 32) =>
    runtime.dispatch({ kind: "ALLOCATE", id, asOf: clock.now(), limit });
  const restart = async () => {
    const next = new AdaptiveSurveillanceRuntime(ports);
    take(await next.initialize());
    return next;
  };
  const evidenceNotes: unknown[] = [];
  captures.push(async () => {
    const attention = take(await repository.load());
    return {
      evidenceNotes,
      subject,
      secondSubject,
      policy,
      configurationFingerprint: configuration.fingerprint,
      attentionHistory: attention,
      attentionCanonicalBytes: attention.map((cp) => stableStringify(cp)),
      scannerHistory: take(await scanner.repository.load()),
      moseHistory: take(await scanner.mose.repository.load()),
      acceptedContext: base.context,
      replayIdentities: [...base.replays].map(([session, value]) => ({
        session,
        specification: value.specification.fingerprint,
        checkpoint: value.checkpoint.fingerprint,
        input: value.inputs.fingerprint,
      })),
      replayEvidence: [...base.replays.values()],
      peerReplayEvidence: peer ? [...peer.replays.values()] : [],
      peerContext: peer?.context ?? null,
    };
  });
  return {
    runtime,
    secondSubject,
    captureEvidence: (value: unknown) => evidenceNotes.push(value),
    ports,
    scanner,
    policy,
    clock,
    subject,
    assess,
    allocate,
    restart,
    repository,
    config,
    setConfig: (c: typeof configuration) => {
      configuration = c;
    },
  };
}
