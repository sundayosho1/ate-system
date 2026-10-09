import { instrumentSchema } from "@ate/domain";
import { safeClone } from "./boundary.js";
import { z } from "zod";
import { fingerprint } from "@ate/configuration";
import { freeze } from "@ate/multitimeframe";
import { canonicalId, digest, fail, ok, type Result } from "./contracts.js";
import type { InstrumentRegistry } from "./service.js";
const referenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    owner: z.enum([
      "MARKET_DATA",
      "HISTORICAL_DATA",
      "DATA_QUALITY",
      "DATASET_CATALOGUE",
      "REALTIME_CAPTURE",
      "MULTITIMEFRAME",
      "MARKET_REPLAY",
    ]),
    ownerReference: z.string().min(1).max(256),
    ownerFingerprint: digest,
    registryId: z.string().min(1).max(64),
    instrumentId: canonicalId,
    revisionId: digest,
    registrySnapshot: digest,
  })
  .strict();
export type RegistryResearchReference = z.infer<typeof referenceSchema> & {
  readonly fingerprint: string;
};
/** An explicit new association. Never edits, rehashes or certifies historical owner content. */
export function associateResearchEvidence(
  registry: InstrumentRegistry,
  raw: unknown,
): Result<RegistryResearchReference> {
  try {
    const ref = referenceSchema.parse(safeClone(raw));
    if (registry.diagnostics().registryId !== ref.registryId) return fail("FOREIGN_REGISTRY");
    const snap = registry.snapshotAt(ref.registrySnapshot);
    if (!snap.ok) return fail("UNKNOWN_REGISTRY_SNAPSHOT");
    if (
      !snap.value.revisions.some(
        (r) => r.instrumentId === ref.instrumentId && r.revisionId === ref.revisionId,
      )
    )
      return fail("REVISION_NOT_IN_SNAPSHOT");
    return ok(freeze({ ...ref, fingerprint: fingerprint(ref) }));
  } catch {
    return fail("INVALID_REFERENCE");
  }
}

/** Opt-in compatibility with accepted UUID Instrument records; no inferred economic equivalence. */
export function associateLegacyInstrument(
  registry: InstrumentRegistry,
  legacy: unknown,
  selection: { instrumentId: string; revisionId: string; registrySnapshot: string },
): Result<{ legacyInstrumentId: string; reference: RegistryResearchReference }> {
  try {
    const selected = z
      .object({ instrumentId: canonicalId, revisionId: digest, registrySnapshot: digest })
      .strict()
      .parse(safeClone(selection));
    const accepted = instrumentSchema.parse(safeClone(legacy));
    const result = associateResearchEvidence(registry, {
      schemaVersion: 1,
      owner: "MARKET_DATA",
      ownerReference: accepted.instrumentId,
      ownerFingerprint: fingerprint(accepted),
      registryId: registry.diagnostics().registryId,
      ...selected,
    });
    return result.ok
      ? ok(freeze({ legacyInstrumentId: accepted.instrumentId, reference: result.value }))
      : result;
  } catch {
    return fail("INVALID_LEGACY_INSTRUMENT");
  }
}
