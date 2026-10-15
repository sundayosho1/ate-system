import { expect } from "vitest";
import {
  ConfigurationRegistry,
  ConfigurationResolver,
  StaticConfigurationSource,
  buildConfigurationSnapshot,
  configurationEntry,
  type ConfigurationSourceId,
  type EffectiveConfiguration,
} from "@ate/configuration";
import { mustParseUtc, VirtualClock } from "@ate/time";
import {
  InstrumentSpecifications,
  MemorySpecificationRepository,
  specificationConfigurationDefinitions,
  specificationStateOwnership,
  defaultPolicy,
  type Policy,
  type Repository,
  type Request,
  type Metadata,
  type SpecificationPorts,
} from "@ate/instrument-specifications";
import {
  fixture as mappingFixture,
  addIdentity,
  time,
} from "../canonical-symbol-mapping/fixtures.js";
export { take, root } from "../canonical-symbol-mapping/fixtures.js";
import { take } from "../canonical-symbol-mapping/fixtures.js";
export const declared = <T>(value: T) => ({
  state: "DECLARED" as const,
  value,
  evidence: "Synthetic offline source assertion",
});
export function metadata(): Metadata {
  return {
    price: {
      precision: declared(2),
      point: declared("0.01"),
      tick: declared("0.05"),
      minimumIncrement: declared("0.05"),
      gridOrigin: declared("0"),
      quotation: declared("DECIMAL"),
      samplePrice: declared("10.15"),
    },
    volume: {
      minimum: declared("0.1"),
      maximum: declared("100"),
      increment: declared("0.1"),
      origin: declared("0"),
      unit: declared("SHARES"),
      convention: declared("UNITS"),
      minimumInclusive: declared(true),
      maximumInclusive: declared(true),
    },
    contract: {
      size: declared("1"),
      unit: declared("SHARES"),
      family: declared("EQUITY"),
      type: declared("CASH_EQUITY"),
      settlement: declared("CASH"),
      quoteCurrency: declared("USD"),
    },
    sessions: {},
    lifecycle: {
      effectiveFrom: declared(mustParseUtc("2026-10-01T00:00:00.000Z")),
      status: declared("ACTIVE"),
    },
    margin: {},
    constraints: {},
  };
}
export async function effective(p: Policy) {
  const clock = new VirtualClock(time),
    reg = new ConfigurationRegistry(clock),
    defs = specificationConfigurationDefinitions(clock);
  for (const d of defs) take(reg.register(d));
  const source = new StaticConfigurationSource({
    clock,
    descriptor: {
      sourceId: "spec-test" as ConfigurationSourceId,
      sourceType: "TEST",
      name: "Specification research test",
      criticality: "REQUIRED",
      failurePolicy: "FAIL_CLOSED",
      priority: 1,
    },
    entries: [
      configurationEntry({ key: defs[0]!.key, scopeType: "SYSTEM", value: JSON.stringify(p) }),
    ],
  });
  const snapshot = take(
    await buildConfigurationSnapshot({ registry: reg, sources: [source], clock }),
  );
  return take(new ConfigurationResolver(reg, snapshot, clock).resolve({ runtimeMode: "RESEARCH" }));
}
export async function fixture(
  p: Policy = defaultPolicy,
  repository: Repository = new MemorySpecificationRepository(),
  initialize = true,
) {
  const mapping = await mappingFixture();
  await mapping.import();
  const set = take(await mapping.service.publish(mapping.request()));
  let configuration = await effective(p);
  take(mapping.base.ports.authority.register(specificationStateOwnership()));
  const ports: SpecificationPorts = {
    configuration: () => configuration,
    authority: mapping.base.ports.authority,
    clock: mapping.base.clock,
    registry: mapping.base.canonical.registry,
    mapping: mapping.service,
    repository,
  };
  const service = new InstrumentSpecifications("spec-lab", ports);
  if (initialize) take(await service.initialize());
  return {
    mapping,
    ports,
    repository,
    service,
    set,
    setConfig: (c: EffectiveConfiguration) => {
      configuration = c;
    },
    request(id = "spec-request", spec = "spec-A"): Request {
      return {
        schemaVersion: 1,
        requestId: id,
        specificationId: spec,
        mappingSet: set.fingerprint,
        mappingFingerprint: set.prepared.mappings[0]!.fingerprint,
        sourceDeclaredAt: time,
        sourceQuality: "SYNTHETIC",
        importBatchId: "synthetic-batch",
        rawEvidence: "Synthetic specification source",
        metadata: metadata(),
      };
    },
    async fx() {
      await addIdentity(
        mapping,
        "FX",
        { family: "FX", kind: "SPOT", base: "EUR", quote: "USD", settlement: "SPOT" },
        "fx",
      );
      await mapping.import("fx", "EURUSD", "fx-broker", ["fx"]);
      const set = take(await mapping.service.publish(mapping.request("fx-set")));
      expect(set.prepared.mappings.some((m) => m.target?.family === "FX")).toBe(true);
      return set;
    },
  };
}
