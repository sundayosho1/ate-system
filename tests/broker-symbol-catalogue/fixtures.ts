import { expect } from "vitest";
import { VirtualClock, mustParseUtc } from "@ate/time";
import {
  ConfigurationRegistry,
  ConfigurationResolver,
  StaticConfigurationSource,
  buildConfigurationSnapshot,
  configurationEntry,
  StaticApprovalAuthorityResolver,
  type ConfigurationSourceId,
  type EffectiveConfiguration,
  fingerprint,
} from "@ate/configuration";
import { StateAuthorityRegistry } from "@ate/persistence";
import {
  BrokerSymbolCatalogue,
  MemoryCatalogueRepository,
  brokerCatalogueStateOwnership,
  brokerCatalogueConfigurationDefinitions,
  defaultPolicy,
  type Policy,
  type Repository,
  type Result,
  type Batch,
  type LaboratoryPorts,
} from "@ate/broker-symbol-catalogue";
import { setup as registrySetup, equity, evidence, root } from "../instrument-registry/fixtures.js";
export { root, equity, evidence };
export const time = mustParseUtc("2026-10-10T09:00:00.000Z");
export function take<T>(r: Result<T>): T {
  expect(r.ok, r.ok ? "" : r.error.code).toBe(true);
  if (!r.ok) throw Error(r.error.code);
  return r.value;
}
export const maker = {
  actorType: "USER" as const,
  actorId: "00000000-0000-4000-8000-000000000001",
};
export const checker = {
  actorType: "USER" as const,
  actorId: "00000000-0000-4000-8000-000000000002",
};
export function batch(id = "batch-1", symbols = ["SYN.A"]): Batch {
  return {
    schemaVersion: 1,
    batchId: id,
    namespace: {
      brokerNamespaceId: "synthetic-broker",
      sourceSystem: "SYNTHETIC",
      brokerLabel: "Synthetic broker",
      terminalFixtureId: "fixture-1",
      catalogueSourceId: "catalogue-1",
    },
    source: {
      reference: "synthetic-fixture",
      contentFingerprint: fingerprint(symbols),
      quality: "SYNTHETIC",
      completeness: "COMPLETE",
      timeQuality: "SOURCE_ASSERTED",
      observedAt: time,
    },
    records: symbols.map((rawSymbol) => ({ rawSymbol })),
  };
}
export async function effective(policy: Policy = defaultPolicy): Promise<EffectiveConfiguration> {
  const clock = new VirtualClock(time),
    registry = new ConfigurationRegistry(clock),
    definition = brokerCatalogueConfigurationDefinitions(clock)[0]!;
  expect(registry.register(definition).ok).toBe(true);
  const source = new StaticConfigurationSource({
    clock,
    descriptor: {
      sourceId: "broker-fixture" as ConfigurationSourceId,
      sourceType: "TEST",
      name: "Offline governed fixture",
      criticality: "REQUIRED",
      failurePolicy: "FAIL_CLOSED",
      priority: 1,
    },
    entries: [
      configurationEntry({
        key: definition.key,
        scopeType: "SYSTEM",
        value: JSON.stringify(policy),
      }),
    ],
  });
  const snap = await buildConfigurationSnapshot({ registry, sources: [source], clock });
  if (!snap.ok) throw Error(snap.error.code);
  const c = new ConfigurationResolver(registry, snap.value, clock).resolve({
    runtimeMode: "RESEARCH",
  });
  if (!c.ok) throw Error(c.error.code);
  return c.value;
}
export async function setup(
  policy: Policy = defaultPolicy,
  repository: Repository = new MemoryCatalogueRepository(),
  initialize = true,
) {
  let config = await effective(policy);
  const clock = new VirtualClock(time),
    canonical = await registrySetup(),
    authority = new StateAuthorityRegistry(clock);
  expect(authority.register(brokerCatalogueStateOwnership()).ok).toBe(true);
  const resolver = new StaticApprovalAuthorityResolver({
    clock,
    grants: { "00000000-0000-4000-8000-000000000002": ["CONFIGURATION_CHECKER"] },
  });
  const ports: LaboratoryPorts = {
    clock,
    configuration: () => config,
    registryConfiguration: () => canonical.config,
    registry: canonical.registry,
    repository,
    authority,
    authorityResolver: resolver,
  };
  const lab = new BrokerSymbolCatalogue("offline-lab", ports);
  if (initialize) take(await lab.initialize());
  return {
    lab,
    ports,
    canonical,
    clock,
    repository,
    policy,
    setConfiguration: (next: EffectiveConfiguration) => {
      config = next;
    },
  };
}
export async function registered() {
  const fixture = await setup();
  const d = equity();
  d.identifiers.push({
    scheme: "RESEARCH",
    scope: "synthetic-broker",
    authority: "fixture",
    value: "economic-A",
    evidence: evidence("economic-A"),
  });
  const result = fixture.canonical.registry.register(d);
  take(await result);
  return fixture;
}
