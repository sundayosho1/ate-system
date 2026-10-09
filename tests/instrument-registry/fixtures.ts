import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect } from "vitest";
import { VirtualClock, mustParseUtc } from "@ate/time";
import {
  fingerprint,
  ConfigurationRegistry,
  ConfigurationResolver,
  StaticConfigurationSource,
  buildConfigurationSnapshot,
  configurationEntry,
  instrumentRegistryConfigurationDefinitions,
  type ConfigurationSourceId,
  type EffectiveConfiguration,
} from "@ate/configuration";
import {
  defaultPolicy,
  MemoryRegistryRepository,
  FilesystemRegistryRepository,
  InstrumentRegistry,
  type Policy,
  type InstrumentDefinition,
  type Evidence,
  type Result,
  type Repository,
} from "@ate/instrument-registry";
export const roots: string[] = [];
afterEach(() => {
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
export const root = () => {
  const p = mkdtempSync(join(tmpdir(), "ate-instrument-"));
  roots.push(p);
  return p;
};
export const time = mustParseUtc("2026-10-09T09:00:00.000Z");
export function take<T>(r: Result<T>): T {
  expect(r.ok).toBe(true);
  if (!r.ok) throw Error(r.error.code);
  return r.value;
}
export function evidence(value = "synthetic identity"): Evidence {
  return {
    sourceType: "RESEARCH",
    sourceId: "fixture",
    contentFingerprint: fingerprint(value),
    originalValue: value,
    timeAuthority: "UNKNOWN",
    verification: "UNVERIFIED",
    evidenceReference: "fixture-1",
  };
}
export function equity(shareClass = "A"): InstrumentDefinition {
  return {
    schemaVersion: 1,
    identity: {
      family: "EQUITY",
      kind: "ORDINARY",
      issuer: "synthetic-issuer",
      shareClass,
      venue: "XTEST",
    },
    displayName: "Synthetic share " + shareClass,
    taxonomyVersion: "T1",
    classification: "EQUITY",
    status: "ACTIVE_IN_REGISTRY",
    qualification: "EVIDENCE_QUALIFIED",
    identifiers: [],
    aliases: [],
    relationships: [],
    evidence: [evidence()],
  };
}
export function index(): InstrumentDefinition {
  return {
    ...equity(),
    identity: {
      family: "INDEX",
      kind: "REFERENCE_INDEX",
      administrator: "synthetic-admin",
      index: "SYN100",
      variant: "TOTAL_RETURN",
    },
    classification: "INDEX",
    displayName: "Synthetic index",
  };
}
export async function effective(policy: Policy = defaultPolicy): Promise<EffectiveConfiguration> {
  const clock = new VirtualClock(time),
    registry = new ConfigurationRegistry(clock),
    definition = instrumentRegistryConfigurationDefinitions(clock)[0]!;
  expect(registry.register(definition).ok).toBe(true);
  const source = new StaticConfigurationSource({
    clock,
    descriptor: {
      sourceId: "fixture" as ConfigurationSourceId,
      sourceType: "TEST",
      name: "Synthetic governed policy",
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
  const resolved = new ConfigurationResolver(registry, snap.value, clock).resolve({
    runtimeMode: "RESEARCH",
  });
  if (!resolved.ok) throw Error(resolved.error.code);
  return resolved.value;
}
export async function setup(
  policy: Policy = defaultPolicy,
  repository: Repository = new MemoryRegistryRepository(),
  registryId = "synthetic-registry",
) {
  let config = await effective(policy);
  const clock = new VirtualClock(time),
    registry = new InstrumentRegistry(registryId, {
      clock,
      repository,
      configuration: () => config,
    });
  take(await registry.initialize());
  return {
    registry,
    clock,
    repository,
    setConfiguration: (v: EffectiveConfiguration) => {
      config = v;
    },
    config,
  };
}
export async function disk(policy: Policy = defaultPolicy) {
  const path = root();
  return {
    ...(await setup(
      policy,
      new FilesystemRegistryRepository(path, policy.maxSnapshotBytes, policy.maxSnapshots),
    )),
    path,
  };
}
