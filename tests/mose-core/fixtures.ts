import { VirtualClock } from "@ate/time";
import { StateAuthorityRegistry } from "@ate/persistence";
import {
  ConfigurationRegistry,
  ConfigurationResolver,
  StaticConfigurationSource,
  buildConfigurationSnapshot,
  configurationEntry,
  configurationSourceId,
  StaticApprovalAuthorityResolver,
  type EffectiveConfiguration,
} from "@ate/configuration";
import {
  MOSECoreRuntime,
  MemoryMOSERepository,
  moseStateOwnership,
  moseConfigurationDefinitions,
  defaultPolicy,
  universeSchema,
  type MOSEPorts,
  type Policy,
  type Repository,
  type Command,
} from "@ate/mose-core";
import {
  fixture as eligibilityFixture,
  take,
  maker,
  checker,
  time,
  root,
} from "../instrument-eligibility/fixtures.js";
export { take, maker, checker, time, root, eligibilityFixture };
export type Owners = Awaited<ReturnType<typeof eligibilityFixture>>;
export async function owners() {
  const f = await eligibilityFixture();
  await f.toResearch();
  return f;
}
export async function configuration(policy: Policy, clock: VirtualClock) {
  const registry = new ConfigurationRegistry(clock),
    defs = moseConfigurationDefinitions(clock);
  for (const d of defs) take(registry.register(d));
  const source = new StaticConfigurationSource({
    clock,
    descriptor: {
      sourceId: configurationSourceId("mose-test"),
      sourceType: "TEST",
      name: "Explicit offline surveillance research policy",
      criticality: "REQUIRED",
      failurePolicy: "FAIL_CLOSED",
      priority: 1,
    },
    entries: [
      configurationEntry({ key: defs[0]!.key, scopeType: "SYSTEM", value: JSON.stringify(policy) }),
    ],
  });
  const snapshot = take(await buildConfigurationSnapshot({ registry, sources: [source], clock }));
  return take(
    new ConfigurationResolver(registry, snapshot, clock).resolve({ runtimeMode: "RESEARCH" }),
  );
}
export async function fixture(
  base: Owners,
  changes: Partial<Policy> = {},
  repository: Repository = new MemoryMOSERepository(),
  initialize = true,
) {
  const policy = { ...defaultPolicy, allowReconstruction: true, ...changes },
    clock = new VirtualClock(time),
    authority = new StateAuthorityRegistry(clock);
  take(authority.register(moseStateOwnership()));
  let config: EffectiveConfiguration = await configuration(policy, clock);
  const ports: MOSEPorts = {
    clock,
    configuration: () => config,
    authority,
    authorityResolver: new StaticApprovalAuthorityResolver({
      clock,
      grants: { [checker.actorId]: ["CONFIGURATION_CHECKER"] },
    }),
    datasets: base.ports.datasets,
    quality: base.ports.quality,
    historical: base.ports.historical,
    eligibility: base.service,
    replayEvidence: (s, c) => base.ports.replayEvidence(s, c),
    repository,
  };
  const service = new MOSECoreRuntime("mose-lab", ports);
  if (initialize) take(await service.initialize());
  let n = 0;
  const next = () => "mose-" + ++n;
  const replay = base.context.replay!;
  const source = { sessionId: replay.leftSession, checkpoint: replay.leftCheckpoint };
  const create = (
    sessionId = "session-A",
    patch: Partial<Extract<Command, { kind: "CREATE" }>> = {},
  ) => ({
    kind: "CREATE" as const,
    id: next(),
    sessionId,
    instruments: [{ instrumentId: base.context.instrumentId, source }],
    maker,
    checker,
    previousUniverse: null,
    ...patch,
  });
  const send = (a: Omit<Extract<Command, { kind: "START" | "PAUSE" | "COMPLETE" }>, "id">) =>
    service.dispatch({ ...a, id: next() });
  const setup = async () => {
    const c = take(await service.dispatch(create()));
    return universeSchema.parse(c.state.sessions[0]!.universe);
  };
  const start = () => send({ kind: "START", sessionId: "session-A" });
  const receive = (index: number) => {
    const u = take(service.getUniverse("session-A")),
      event = u.plan[index]!;
    return service.dispatch({
      kind: "RECEIVE",
      id: next(),
      sessionId: "session-A",
      eventId: event.eventId,
      instrumentId: event.instrumentId,
      universeSnapshot: u.fingerprint,
    });
  };
  const process = (limit = policy.maxBatch) =>
    service.dispatch({ kind: "PROCESS", id: next(), sessionId: "session-A", limit });
  return {
    service,
    ports,
    clock,
    policy,
    repository,
    next,
    create,
    send,
    setup,
    start,
    receive,
    process,
    setConfiguration: (c: EffectiveConfiguration) => (config = c),
  };
}
