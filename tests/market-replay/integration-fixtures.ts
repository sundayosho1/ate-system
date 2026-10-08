import { schemas } from "@ate/domain";
import { VirtualClock } from "@ate/time";
import {
  ConfigurationRegistry,
  ConfigurationResolver,
  StaticConfigurationSource,
  buildConfigurationSnapshot,
  configurationEntry,
  configurationSourceId,
  foundationalConfigurationKey,
  replayConfigurationDefinitions,
  multitimeframeConfigurationDefinitions,
} from "@ate/configuration";
import { EventRegistry, EventFactory, InternalEventBus } from "@ate/events";
import { StateAuthorityRegistry } from "@ate/persistence";
import {
  ReplayRuntimeService,
  createReplaySpecification,
  buildReplayResearchRuntime,
  replayFromEffective,
} from "@ate/market-replay";
import { replayFixture, t } from "./fixtures.js";
export function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: { code: string } }): T {
  if (!r.ok) throw Error(r.error.code);
  return r.value;
}
export async function governedFixture(enabled = true, overrides: Record<string, unknown> = {}) {
  const clock = new VirtualClock(t("13:00:00"));
  const configurationRegistry = new ConfigurationRegistry(clock);
  for (const definition of [
    ...replayConfigurationDefinitions(clock),
    ...multitimeframeConfigurationDefinitions(clock),
  ])
    unwrap(configurationRegistry.register(definition));
  const source = new StaticConfigurationSource({
    clock,
    descriptor: {
      sourceId: configurationSourceId("replay-test"),
      sourceType: "BUILT_IN",
      name: "Replay research fixture",
      criticality: "REQUIRED",
      failurePolicy: "FAIL_CLOSED",
      priority: 0,
    },
    entries: Object.entries({
      "research.replay.enabled": enabled,
      "data.multitimeframe.enabled": true,
      ...overrides,
    }).map(([key, value]) =>
      configurationEntry({
        key: foundationalConfigurationKey(key, clock),
        scopeType: "SYSTEM",
        value,
      }),
    ),
  });
  const snapshot = unwrap(
    await buildConfigurationSnapshot({ registry: configurationRegistry, sources: [source], clock }),
  );
  const configuration = unwrap(
    new ConfigurationResolver(configurationRegistry, snapshot, clock).resolve({
      runtimeMode: "RESEARCH",
    }),
  );
  const f = replayFixture(replayFromEffective(configuration).mode);
  const { fingerprint: _fp, ...spec } = f.spec;
  const governedSpec = createReplaySpecification({
    ...spec,
    configurationFingerprint: configuration.fingerprint,
    resourceLimits: replayFromEffective(configuration).limits,
  });
  const eventRegistry = new EventRegistry(clock);
  let id = 0;
  const eventFactory = new EventFactory(eventRegistry, {
    runtimeMode: "RESEARCH",
    source: {
      sourceId: schemas.sourceId.parse("40000000-0000-4000-8000-000000000099"),
      sourceType: "SYSTEM",
      name: "replay-fixture",
    },
    actor: { actorType: "SERVICE", displayName: "replay-fixture" },
    clock,
    idGenerator: () => `40000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    maxCausationDepth: 8,
  });
  const bus = new InternalEventBus({ registry: eventRegistry, factory: eventFactory, clock });
  bus.start();
  const authority = new StateAuthorityRegistry(clock);
  let effective = configuration;
  const service = new ReplayRuntimeService({
    clock,
    configuration: () => effective,
    authority,
    eventRegistry,
    eventFactory,
    eventBus: bus,
  });
  const runtime = buildReplayResearchRuntime(service, {
    runtimeInstanceId: "40000000-0000-4000-8000-000000000100",
    runtimeVersion: "0.19.0-market-replay.1",
    mode: "RESEARCH",
    clock,
  });
  if (!runtime.ok) throw Error(runtime.errors[0]?.message);
  return {
    ...f,
    spec: governedSpec,
    clock,
    configuration,
    authority,
    bus,
    eventRegistry,
    eventFactory,
    service,
    runtime: runtime.runtime,
    setConfiguration: (next: typeof configuration) => {
      effective = next;
    },
  };
}
