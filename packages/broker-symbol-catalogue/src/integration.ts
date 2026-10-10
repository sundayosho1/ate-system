import { z } from "zod";
import { fingerprint } from "@ate/configuration";
import {
  associateResearchEvidence,
  type InstrumentRegistry,
  type RegistryResearchReference,
} from "@ate/instrument-registry";
import { freeze } from "@ate/multitimeframe";
import { canonicalId, digest, text, ok, fail, type Result } from "./contracts.js";
import { safeClone } from "./boundary.js";
import type { BrokerSymbolCatalogue } from "./service.js";
const requestSchema = z
  .object({
    proposalId: digest,
    owner: z.enum([
      "MARKET_DATA",
      "HISTORICAL_DATA",
      "DATA_QUALITY",
      "DATASET_CATALOGUE",
      "REALTIME_CAPTURE",
      "MULTITIMEFRAME",
      "MARKET_REPLAY",
    ]),
    ownerReference: text,
    ownerFingerprint: digest,
  })
  .strict();
/** New opt-in research evidence only; historical owner payload is neither mutated nor re-certified. */
export function associateCatalogueResearchEvidence(
  lab: BrokerSymbolCatalogue,
  registry: InstrumentRegistry,
  raw: unknown,
): Result<
  Readonly<{
    proposalId: string;
    catalogueFingerprint: string;
    decisionId: string;
    reference: RegistryResearchReference;
    fingerprint: string;
  }>
> {
  try {
    const r = requestSchema.parse(safeClone(raw));
    const m = lab.mapping(r.proposalId);
    if (!m.ok) return m;
    if (m.value.state !== "APPROVED_FOR_RESEARCH_ASSOCIATION")
      return fail("APPROVED_CURRENT_RESEARCH_MAPPING_REQUIRED");
    const decision = m.value.decisions.at(-1)!,
      p = m.value.proposal,
      s = registry.snapshotAt(p.registrySnapshot);
    if (!s.ok) return fail("REGISTRY_HISTORY_REQUIRED");
    const evidence = z
      .array(z.object({ instrumentId: canonicalId, revisionId: digest }).passthrough())
      .parse(p.resolution["candidates"]);
    const selected = evidence.find((v) => v.instrumentId === decision.selectedCandidate);
    const candidate = s.value.revisions.find(
      (v) => v.instrumentId === selected?.instrumentId && v.revisionId === selected.revisionId,
    );
    if (!candidate) return fail("CANONICAL_REVISION_REQUIRED");
    const associated = associateResearchEvidence(registry, {
      schemaVersion: 1,
      owner: r.owner,
      ownerReference: r.ownerReference,
      ownerFingerprint: r.ownerFingerprint,
      registryId: p.registryId,
      registrySnapshot: p.registrySnapshot,
      instrumentId: candidate.instrumentId,
      revisionId: candidate.revisionId,
    });
    if (!associated.ok) return fail(associated.error.code);
    const content = {
      proposalId: p.proposalId,
      catalogueFingerprint: p.catalogueFingerprint,
      decisionId: decision.decisionId,
      reference: associated.value,
    };
    return ok(freeze({ ...content, fingerprint: fingerprint(content) }));
  } catch {
    return fail("INVALID_RESEARCH_REFERENCE");
  }
}
