import { wellFormed, hasControl } from "./boundary.js";
import { z } from "zod";
import { actorSchema, schemas } from "@ate/domain";
import { canonicalId, digest, families } from "@ate/instrument-registry";
export { canonicalId, digest };
export const text = z
  .string()
  .min(1)
  .max(256)
  .refine((s) => wellFormed(s) && !!s.trim() && !hasControl(s));
export const code = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u);
export const decimal = z.string().regex(/^(0|[1-9][0-9]{0,15})(\.[0-9]{1,12})?$/u);
export const clockSchema = z
  .object({
    source: z.enum([
      "SYSTEM_UTC",
      "MONOTONIC",
      "EXTERNAL_SOURCE",
      "BROKER",
      "MARKET_DATA_PROVIDER",
      "MARKET",
      "SIMULATION",
      "REPLAY",
      "TEST",
      "DERIVED",
    ]),
    clockId: code,
    quality: z.enum(["SYNCHRONIZED", "ACCEPTABLE", "DEGRADED", "UNTRUSTED", "UNKNOWN"]),
  })
  .strict();
export const namespaceSchema = z
  .object({
    brokerNamespaceId: code,
    sourceSystem: z.enum(["SYNTHETIC", "RECORDED_MT5_EXPORT", "RECORDED_OTHER"]),
    brokerLabel: text,
    serverDescriptor: text.optional(),
    terminalFixtureId: code,
    catalogueSourceId: code,
  })
  .strict();
export const sourceSchema = z
  .object({
    reference: text,
    contentFingerprint: digest,
    quality: z.enum(["SYNTHETIC", "UNVERIFIED_RECORDED", "EVIDENCED_RECORDED"]),
    completeness: z.enum(["COMPLETE", "PARTIAL"]),
    observedAt: schemas.timestamp.optional(),
    timeQuality: z.enum(["UNKNOWN", "SOURCE_ASSERTED", "EVIDENCED"]),
    sourceUpdatedAt: schemas.timestamp.optional(),
  })
  .strict()
  .superRefine((s, c) => {
    if ((s.timeQuality === "UNKNOWN") !== (s.observedAt === undefined))
      c.addIssue({ code: "custom", message: "SOURCE_TIME_QUALITY" });
  });
export const identifierSchema = z
  .object({
    scheme: z.enum([
      "ISIN",
      "FIGI",
      "CFI",
      "CURRENCY",
      "EXCHANGE",
      "RESEARCH",
      "PROVIDER",
      "BROKER",
      "TERMINAL",
    ]),
    scope: code,
    authority: code.optional(),
    value: text,
  })
  .strict();
export const symbolSchema = z
  .object({
    rawSymbol: text,
    description: text.optional(),
    path: text.optional(),
    sourceNativeId: code.optional(),
    declaredAssetCategory: text.optional(),
    declaredFamily: z.enum([...families, "UNKNOWN"]).optional(),
    baseCurrency: code.optional(),
    quoteCurrency: code.optional(),
    profitCurrency: code.optional(),
    marginCurrency: code.optional(),
    underlyingReference: text.optional(),
    venue: code.optional(),
    contractReference: text.optional(),
    expiry: schemas.timestamp.optional(),
    digits: z.number().int().min(0).max(15).optional(),
    point: decimal.optional(),
    tickSize: decimal.optional(),
    quotationUnit: text.optional(),
    minimumPriceIncrement: decimal.optional(),
    contractSize: decimal.optional(),
    volumeStep: decimal.optional(),
    minimumVolume: decimal.optional(),
    maximumVolume: decimal.optional(),
    volumeLimit: decimal.optional(),
    calculationMode: code.optional(),
    listed: z.boolean().optional(),
    visible: z.boolean().optional(),
    tradeMode: z
      .enum(["DISABLED", "CLOSE_ONLY", "FULL", "LONG_ONLY", "SHORT_ONLY", "UNKNOWN"])
      .optional(),
    sessionMarker: text.optional(),
    observedAt: schemas.timestamp.optional(),
    identifiers: z.array(identifierSchema).max(16).optional(),
  })
  .strict();
export const batchSchema = z
  .object({
    schemaVersion: z.literal(1),
    namespace: namespaceSchema,
    batchId: code,
    source: sourceSchema,
    records: z.array(symbolSchema).max(10000),
  })
  .strict();
export const keySchema = z
  .object({
    ruleId: code,
    version: z.literal("B1"),
    n1Version: z.literal("N1"),
    raw: text,
    value: text,
    removedSuffix: text.nullable(),
  })
  .strict();
export const observationSchema = z
  .object({
    raw: symbolSchema,
    keys: z.array(keySchema).min(1).max(16),
    classification: z
      .object({
        family: z.enum([...families, "UNKNOWN"]),
        basis: z.enum(["BROKER_DECLARED", "UNKNOWN"]),
      })
      .strict(),
    quality: z
      .object({
        completeness: z.enum(["MINIMAL", "PARTIAL", "DECLARED_COMPLETE"]),
        flags: z.array(code).max(32),
        verification: z.enum(["SOURCE_ASSERTED", "EVIDENCED"]),
      })
      .strict(),
    fingerprint: digest,
  })
  .strict();
export const collisionSchema = z
  .object({ ruleId: code, key: text, rawSymbols: z.array(text).min(2).max(10000) })
  .strict();
export const catalogueSchema = z
  .object({
    schemaVersion: z.literal(1),
    namespace: namespaceSchema,
    namespaceKey: digest,
    version: z.number().int().positive(),
    parent: digest.nullable(),
    batchId: code,
    source: sourceSchema,
    inputFingerprint: digest,
    importedAt: schemas.timestamp,
    publishedAt: schemas.timestamp,
    clockProvenance: clockSchema,
    observations: z.array(observationSchema).max(10000),
    collisions: z.array(collisionSchema).max(10000),
    fingerprint: digest,
  })
  .strict();
export const selectorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("IDENTIFIER"), index: z.number().int().min(0).max(15) }).strict(),
  z
    .object({
      kind: z.literal("NORMALIZED_KEY"),
      ruleId: code,
      aliasKind: z.enum([
        "SYMBOL",
        "DISPLAY",
        "HISTORICAL",
        "DATASET",
        "PROVIDER",
        "BROKER",
        "TERMINAL",
      ]),
    })
    .strict(),
]);
export const actor = actorSchema.refine(
  (a) => a.actorId !== undefined && a.actorType === "USER",
  "IDENTIFIED_USER_REQUIRED",
);
export const proposalSchema = z
  .object({
    proposalId: digest,
    catalogueFingerprint: digest,
    namespaceKey: digest,
    rawSymbol: text,
    observationFingerprint: digest,
    selector: selectorSchema,
    query: z.record(z.string(), z.unknown()),
    registryId: code,
    registrySnapshot: digest,
    registryVersion: z.literal("0.20.0-instrument-registry.1"),
    resolution: z.record(z.string(), z.unknown()),
    candidateIds: z.array(canonicalId).max(10000),
    contradictions: z.array(code).max(32),
    outcome: z.enum([
      "NO_CANDIDATE",
      "UNIQUE_CANDIDATE",
      "MULTIPLE_CANDIDATES",
      "INSUFFICIENT_EVIDENCE",
      "INVALID_SOURCE_OBSERVATION",
      "MAPPING_CONFLICT",
    ]),
    evidenceClass: z.enum(["SCOPED_IDENTIFIER", "LOOKUP_ONLY"]),
    initialState: z.enum(["PROPOSED", "NEEDS_REVIEW", "AMBIGUOUS"]),
    maker: actor,
    reason: text,
    createdAt: schemas.timestamp,
    clockProvenance: clockSchema,
    configurationFingerprint: digest,
  })
  .strict();
export const mappingStates = [
  "PROPOSED",
  "NEEDS_REVIEW",
  "AMBIGUOUS",
  "REJECTED",
  "APPROVED_FOR_RESEARCH_ASSOCIATION",
  "SUPERSEDED",
  "EXPIRED_OR_STALE",
] as const;
export const decisionSchema = z
  .object({
    decisionId: digest,
    proposalId: digest,
    sequence: z.number().int().positive(),
    previous: digest.nullable(),
    state: z.enum(mappingStates),
    selectedCandidate: canonicalId.nullable(),
    supersededBy: digest.nullable(),
    checker: actor,
    reason: text,
    authorityEvidence: z
      .object({
        actorId: schemas.actorId,
        authority: z.literal("CONFIGURATION_CHECKER"),
        authorized: z.literal(true),
        checkedAt: schemas.timestamp,
        evidence: text,
      })
      .strict(),
    policyFingerprint: digest,
    configurationFingerprint: digest,
    decidedAt: schemas.timestamp,
    clockProvenance: clockSchema,
  })
  .strict();
export const snapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    laboratoryId: code,
    generation: z.number().int().positive(),
    previous: digest.nullable(),
    policyFingerprint: digest,
    configurationFingerprint: digest,
    publishedAt: schemas.timestamp,
    clockProvenance: clockSchema,
    catalogues: z.array(catalogueSchema).max(10000),
    proposals: z.array(proposalSchema).max(10000),
    decisions: z.array(decisionSchema).max(10000),
    fingerprint: digest,
  })
  .strict();
export type Namespace = z.infer<typeof namespaceSchema>;
export type SymbolRecord = z.infer<typeof symbolSchema>;
export type Batch = z.infer<typeof batchSchema>;
export type Catalogue = z.infer<typeof catalogueSchema>;
export type Observation = z.infer<typeof observationSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
export type Decision = z.infer<typeof decisionSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type MappingState = (typeof mappingStates)[number];
export type Result<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: { code: string; commitment: "NONE" | "UNKNOWN" } }>;
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T = never>(
  code: string,
  commitment: "NONE" | "UNKNOWN" = "NONE",
): Result<T> => ({ ok: false, error: { code, commitment } });
export interface Repository {
  load(): Promise<Result<readonly unknown[]>>;
  commit(snapshot: Snapshot): Promise<Result<Snapshot>>;
}
