import { expect } from "vitest";
import {
  ConfigurationRegistry,
  ConfigurationResolver,
  StaticConfigurationSource,
  buildConfigurationSnapshot,
  configurationEntry,
  fingerprint,
  type ConfigurationSourceId,
  type EffectiveConfiguration,
} from "@ate/configuration";
import {
  CanonicalSymbolMapping,
  MemoryMappingRepository,
  defaultPolicy,
  mappingConfigurationDefinitions,
  mappingStateOwnership,
  type Policy,
  type Repository,
  type Request,
  type MappingPorts,
} from "@ate/canonical-symbol-mapping";
import {
  registered,
  batch,
  maker,
  checker,
  equity,
  evidence,
  root,
  time,
} from "../broker-symbol-catalogue/fixtures.js";
import { VirtualClock } from "@ate/time";
export { maker, checker, equity, evidence, root, time };
export function take<T>(
  r: Readonly<{ ok: true; value: T } | { ok: false; error: { code: string } }>,
): T {
  expect(r.ok, r.ok ? "" : r.error.code).toBe(true);
  if (!r.ok) throw Error(r.error.code);
  return r.value;
}
export async function effective(p: Policy) {
  const clock = new VirtualClock(time),
    reg = new ConfigurationRegistry(clock),
    defs = mappingConfigurationDefinitions(clock);
  for (const d of defs) take(reg.register(d));
  const source = new StaticConfigurationSource({
    clock,
    descriptor: {
      sourceId: "mapping-test" as ConfigurationSourceId,
      sourceType: "TEST",
      name: "Mapping test policy",
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
  repository: Repository = new MemoryMappingRepository(),
  initialize = true,
) {
  const base = await registered();
  let config = await effective(p);
  take(base.ports.authority.register(mappingStateOwnership()));
  const ports: MappingPorts = {
    clock: base.clock,
    configuration: () => config,
    registryConfiguration: () => base.canonical.config,
    registry: base.canonical.registry,
    sources: new Map([["offline-lab", base.lab]]),
    repository,
    authority: base.ports.authority,
  };
  const service = new CanonicalSymbolMapping("mapping-lab", ports);
  if (initialize) take(await service.initialize());
  const cats: {
    fingerprint: string;
    namespaceKey: string;
    observations: { fingerprint: string; raw: { rawSymbol: string } }[];
  }[] = [];
  return {
    base,
    ports,
    service,
    p,
    repository,
    cats,
    setConfig: (c: EffectiveConfiguration) => {
      config = c;
    },
    async import(id = "one", raw = "SYN.A", ns = "synthetic-broker", claims = ["economic-A"]) {
      const b = batch(id, [raw]);
      b.namespace.brokerNamespaceId = ns;
      b.records[0]!.identifiers = claims.map((value) => ({
        scheme: "RESEARCH",
        scope: "synthetic-broker",
        authority: "fixture",
        value,
      }));
      const c = take(await base.lab.importNative(b));
      cats.push(c);
      return c;
    },
    request(id = "mapping-1"): Request {
      return {
        requestId: id,
        registrySnapshot: take(base.canonical.registry.snapshot())!.fingerprint,
        sources: cats.map((c) => ({
          ownerId: "offline-lab",
          ownerSnapshot: take(base.lab.snapshot())!.fingerprint,
          catalogueFingerprint: c.fingerprint,
        })),
        assertions: [],
        approvals: [],
      };
    },
  };
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;
export async function addIdentity(
  f: Fixture,
  name: string,
  identity?: ReturnType<typeof equity>["identity"],
  claim = "economic-" + name,
) {
  const d = equity(name);
  if (identity) d.identity = identity;
  d.classification = d.identity.family;
  d.identifiers = [
    {
      scheme: "RESEARCH",
      scope: "synthetic-broker",
      authority: "fixture",
      value: claim,
      evidence: evidence(claim),
    },
  ];
  return take(await f.base.canonical.registry.register(d));
}
export async function approve(f: Fixture, c: Fixture["cats"][number]) {
  const proposal = take(
    await f.base.lab.propose({
      catalogueFingerprint: c.fingerprint,
      rawSymbol: c.observations[0]!.raw.rawSymbol,
      selector: { kind: "IDENTIFIER", index: 0 },
      maker,
      reason: "Qualified research claim",
    }),
  );
  expect(proposal.candidateIds).toHaveLength(1);
  const decision = take(
    await f.base.lab.review(proposal.proposalId, {
      checker,
      state: "APPROVED_FOR_RESEARCH_ASSOCIATION",
      selectedCandidate: proposal.candidateIds[0],
      reason: "Separated research checker",
    }),
  );
  return { proposal, decision };
}
export const page = (
  kind: "MAPPINGS" | "GROUPS" | "CONFLICTS" | "HISTORY",
  extra: Record<string, unknown> = {},
) => ({ kind, scope: "STORED", offset: 0, limit: 100, ...extra });
export const proof = (identity: Record<string, string>, f: Fixture) => {
  const c = f.cats[0]!;
  const content = {
    ownerId: "offline-lab",
    catalogueFingerprint: c.fingerprint,
    observationFingerprint: c.observations[0]!.fingerprint,
    evidenceReference: "Recorded supplemental assertion",
    identity,
  };
  return { ...content, contentFingerprint: fingerprint(content) };
};
