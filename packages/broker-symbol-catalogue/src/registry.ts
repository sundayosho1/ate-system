import {
  InstrumentRegistry,
  fail as registryFail,
  ok as registryOk,
  type Snapshot as RegistrySnapshot,
} from "@ate/instrument-registry";
import { fingerprint, type EffectiveConfiguration } from "@ate/configuration";
import type { Clock } from "@ate/time";
import type { StateOwnershipEntry } from "@ate/persistence";
import { stateDomain, stateOwner } from "@ate/persistence";
import { freeze } from "@ate/multitimeframe";
import type { Proposal, Observation } from "./contracts.js";
/** Reuse P20's resolver on its actual retained history; do not reproduce economic matching locally. */
export async function registryView(
  registry: InstrumentRegistry,
  configuration: () => EffectiveConfiguration,
  clock: Clock,
  snapshotFingerprint: string,
  maxHistory: number,
): Promise<InstrumentRegistry> {
  const chain: RegistrySnapshot[] = [];
  let ref: string | null = snapshotFingerprint;
  while (ref !== null) {
    if (chain.length >= maxHistory) throw Error("REGISTRY_HISTORY_CAPACITY");
    const s = registry.snapshotAt(ref);
    if (!s.ok) throw Error("REGISTRY_HISTORY_UNAVAILABLE");
    chain.unshift(s.value);
    ref = s.value.previous;
  }
  const view = new InstrumentRegistry(registry.diagnostics().registryId, {
    clock,
    configuration,
    repository: {
      load: () => Promise.resolve(registryOk(chain)),
      commit: () => Promise.resolve(registryFail("READ_ONLY_VIEW")),
    },
  });
  const result = await view.initialize();
  if (!result.ok) throw Error("REGISTRY_HISTORY_NOT_QUALIFIED");
  const s = view.snapshot();
  if (!s.ok || s.value?.fingerprint !== snapshotFingerprint) throw Error("REGISTRY_VIEW_MISMATCH");
  return view;
}
export function mappingQuery(
  o: Observation,
  selector: Proposal["selector"],
  namespaceId: string,
): Record<string, unknown> {
  if (selector.kind === "IDENTIFIER") {
    const i = o.raw.identifiers?.[selector.index];
    if (!i) throw Error("IDENTIFIER_NOT_SUPPLIED");
    return { ...i };
  }
  const k = o.keys.find((k) => k.ruleId === selector.ruleId);
  if (!k) throw Error("RULE_NOT_GOVERNED");
  // Keys are already transformed; EXACT queries prevent P20 from changing B1's comparison key.
  return { aliasKind: selector.aliasKind, scope: namespaceId, rule: "EXACT", value: k.value };
}
export function brokerCatalogueStateOwnership(): StateOwnershipEntry {
  return freeze({
    stateDomain: stateDomain("broker.catalogue"),
    owner: stateOwner("broker.catalogue"),
    authorityType: "DERIVED",
    writeAuthority: "broker.catalogue",
    readers: ["broker.catalogue"],
    durable: true,
    historyRequired: true,
    reconciliationRequired: true,
    runtimeModes: ["RESEARCH"],
    description:
      "Immutable offline broker declarations and research mapping decisions; no canonical economic identity or financial authority.",
  });
}
export const proposalContent = (p: Proposal) => {
  const { proposalId: _id, ...content } = p;
  return content;
};
export const proposalFingerprint = (p: Proposal): string => fingerprint(proposalContent(p));
