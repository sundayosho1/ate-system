import { z } from "zod";
import type { MarketObservation } from "@ate/domain";
import type { Revision } from "./types.js";
import { freeze, hash } from "./primitives.js";

// Self-contained immutable evidence: no parallel quality scorer or untrusted resolver.
// Canonical metadata permits 16 chunks of at most 256 characters each.
const schema = z
  .object({
    schemaVersion: z.literal(1),
    revisionId: z.string().regex(/^[a-f0-9]{64}$/u),
    sourceFingerprint: z.string().regex(/^(sha256:)?[a-f0-9]{64}$/u),
    lineageFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    coverage: z.enum(["COMPLETE_COVERAGE", "INCOMPLETE", "UNKNOWN"]),
    availability: z.enum(["VERIFIED", "UNKNOWN"]),
    quality: z.array(z.string().max(768)).max(128),
    suppressed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    suppressionEvidence: z
      .record(
        z.string().regex(/^[a-f0-9]{64}$/u),
        z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      )
      .refine((value) => Object.keys(value).length <= 128),
  })
  .strict()
  .refine(
    (value) =>
      Number.isSafeInteger(value.suppressed) &&
      Object.values(value.suppressionEvidence).reduce((a, b) => a + b, 0) === value.suppressed,
  );
export type InheritedQuality = z.infer<typeof schema>;
export function qualityHandoff(revision: Revision) {
  const parsed = schema.safeParse({
    schemaVersion: 1,
    revisionId: revision.revisionId,
    sourceFingerprint: revision.stream.sourceFingerprint,
    lineageFingerprint: revision.lineageFingerprint,
    coverage: revision.coverage,
    availability: revision.availability,
    quality: revision.quality,
    suppressed: revision.suppressedEvidence,
    suppressionEvidence:
      revision.suppressionEvidence ??
      (revision.suppressedEvidence
        ? { [hash({ legacyRevisionId: revision.revisionId })]: revision.suppressedEvidence }
        : {}),
  });
  if (!parsed.success) throw Error("QUALITY_HANDOFF_BOUNDS");
  const manifest = parsed.data;
  const encoded = JSON.stringify(manifest);
  if (Buffer.byteLength(encoded) > 4096) throw Error("QUALITY_HANDOFF_BOUNDS");
  const chunks: string[] = [];
  for (let i = 0; i < encoded.length; i += 256) chunks.push(encoded.slice(i, i + 256));
  if (chunks.length > 16) throw Error("QUALITY_HANDOFF_BOUNDS");
  return freeze({
    "aggregation.qualitymanifest": chunks,
    "aggregation.qualitymanifestfingerprint": hash(manifest),
  });
}
export function inheritedQuality(observation: MarketObservation): InheritedQuality | undefined {
  if (observation.observationKind !== "BAR") return undefined;
  const metadata = observation.metadata;
  // Any aggregate evidence marker makes the handoff mandatory. Legacy/missing payloads
  // cannot silently downgrade known evidence to unassessed.
  if (
    observation.provenance.transformation?.transformationId !==
      "@ate/multitimeframe/aggregation-v1" &&
    metadata["aggregation.revision"] === undefined &&
    !Object.keys(metadata).some((key) => key.startsWith("aggregation.quality"))
  )
    return undefined;
  try {
    const chunks = z
      .array(z.string().max(256))
      .min(1)
      .max(16)
      .parse(metadata["aggregation.qualitymanifest"]);
    const encoded = chunks.join("");
    if (Buffer.byteLength(encoded) > 4096) throw Error("bounds");
    const manifest = schema.parse(JSON.parse(encoded));
    if (
      hash(manifest) !== metadata["aggregation.qualitymanifestfingerprint"] ||
      hash(manifest.quality) !== metadata["aggregation.qualityfingerprint"] ||
      String(manifest.quality.length) !== metadata["aggregation.evidencecount"] ||
      manifest.revisionId !== metadata["aggregation.revision"] ||
      manifest.lineageFingerprint !== metadata["aggregation.lineagefingerprint"] ||
      manifest.coverage !== metadata["aggregation.coverage"]
    )
      throw Error("integrity");
    return freeze(manifest);
  } catch {
    throw Error("INHERITED_QUALITY_INTEGRITY");
  }
}

export function validateQualityReference(reference: {
  fingerprint: string;
  manifest: InheritedQuality;
}): void {
  const manifest = schema.parse(reference.manifest);
  if (
    hash(manifest) !== reference.fingerprint ||
    Buffer.byteLength(JSON.stringify(manifest)) > 4096
  )
    throw Error("INHERITED_QUALITY_INTEGRITY");
}
