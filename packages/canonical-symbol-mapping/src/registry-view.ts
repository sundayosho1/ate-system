import {
  InstrumentRegistry,
  ok,
  fail,
  type Evidence,
  type InstrumentDefinition,
  type Snapshot,
} from "@ate/instrument-registry";
import { registryView } from "@ate/broker-symbol-catalogue";
import type { EffectiveConfiguration } from "@ate/configuration";
import type { Clock } from "@ate/time";
export type RegistryEvidenceVerifier = (
  evidence: Evidence,
  definition: InstrumentDefinition,
) => boolean;
/** Public P20 read-only reconstruction with its existing verifier contract. P21's helper has no
 * verifier parameter; default research views still delegate to that accepted helper. No matching,
 * identity or verifier authority is implemented here. The injected verifier remains trusted T01. */
export async function retainedRegistryView(
  registry: InstrumentRegistry,
  configuration: () => EffectiveConfiguration,
  clock: Clock,
  reference: string,
  maxHistory: number,
  verifyEvidence?: RegistryEvidenceVerifier,
): Promise<InstrumentRegistry> {
  if (!verifyEvidence) return registryView(registry, configuration, clock, reference, maxHistory);
  const chain: Snapshot[] = [];
  let ref: string | null = reference;
  while (ref !== null) {
    if (chain.length >= maxHistory) throw Error("REGISTRY_HISTORY_CAPACITY");
    const s = registry.snapshotAt(ref);
    if (!s.ok) throw Error("HISTORICAL_EVIDENCE_UNAVAILABLE");
    chain.unshift(s.value);
    ref = s.value.previous;
  }
  const view = new InstrumentRegistry(registry.diagnostics().registryId, {
    clock,
    configuration,
    verifyEvidence,
    repository: {
      load: () => Promise.resolve(ok(chain)),
      commit: () => Promise.resolve(fail("READ_ONLY_VIEW")),
    },
  });
  const result = await view.initialize();
  if (!result.ok) throw Error("REGISTRY_HISTORY_NOT_QUALIFIED");
  const current = view.snapshot();
  if (!current.ok || current.value?.fingerprint !== reference)
    throw Error("REGISTRY_VIEW_MISMATCH");
  return view;
}
