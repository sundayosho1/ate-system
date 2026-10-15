import { z } from "zod";
import { schemas } from "@ate/domain";
import { canonicalId, digest } from "@ate/instrument-registry";
import { code, text, clockSchema } from "@ate/broker-symbol-catalogue";
import { calendarSchema } from "@ate/multitimeframe";
export { code, text, digest, clockSchema };
export const decimalSchema = z.string().regex(/^-?(0|[1-9][0-9]{0,53})(\.[0-9]{1,18})?$/);
export const field = <T extends z.ZodType>(value: T) =>
  z
    .object({
      state: z.enum(["DECLARED", "ABSENT", "UNKNOWN", "UNSUPPORTED", "CONTRADICTORY"]),
      value: value.optional(),
      alternatives: z.array(value).max(8).optional(),
      evidence: text,
    })
    .strict()
    .superRefine((v, ctx) => {
      if ((v.state === "DECLARED") !== (v.value !== undefined))
        ctx.addIssue({ code: "custom", message: "FIELD_STATE_VALUE" });
      if (
        (v.state === "CONTRADICTORY") !==
        (v.alternatives !== undefined && v.alternatives.length >= 2)
      )
        ctx.addIssue({ code: "custom", message: "FIELD_ALTERNATIVES" });
    });
const d = field(decimalSchema),
  c = field(code),
  t = field(schemas.timestamp);
const positiveCount = z.number().int().min(1).max(10000);
export const policySchema = z
  .object({
    version: z.literal(1),
    maxSpecifications: positiveCount,
    maxRevisions: positiveCount,
    maxFields: positiveCount,
    maxPriceTiers: positiveCount,
    maxQuantityTiers: positiveCount,
    maxSessionIntervals: positiveCount,
    maxLifecycleEvents: positiveCount,
    maxComparisons: positiveCount,
    maxDiagnostics: positiveCount,
    maxHistoryDepth: positiveCount,
    maxSnapshotBytes: z.number().int().min(4096).max(67108864),
    maxRetainedBytes: z.number().int().min(4096).max(1073741824),
    maxInputBytes: z.number().int().min(1024).max(16777216),
    maxInputDepth: z.number().int().min(1).max(20),
    maxQueryResults: positiveCount,
    maxSourceAgeMs: z.number().int().positive().max(31536000000),
    compatibleHistoryPolicies: z.array(digest).max(128),
  })
  .strict();
export type Policy = z.infer<typeof policySchema>;
const tier = z
  .object({
    lower: decimalSchema,
    upper: decimalSchema,
    increment: decimalSchema,
    lowerInclusive: z.boolean(),
    upperInclusive: z.boolean(),
    unit: code,
  })
  .strict();
// Calendar owner defaults govern aggregation policy, not missing broker declarations.
// Require the source to state every policy component before delegating to its schema.
const calendarEvidenceSchema = z
  .unknown()
  .superRefine((raw, ctx) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      ctx.addIssue({ code: "custom", message: "EXPLICIT_CALENDAR_REQUIRED" });
      return;
    }
    for (const key of [
      "id",
      "version",
      "kind",
      "timezone",
      "fold",
      "weekStart",
      "weekdays",
      "holidays",
      "sessions",
    ])
      if (!Object.hasOwn(raw, key))
        ctx.addIssue({ code: "custom", message: `CALENDAR_DECLARATION_REQUIRED_${key}` });
    const sessions = (raw as Record<string, unknown>)["sessions"];
    if (Array.isArray(sessions))
      for (const session of sessions as unknown[])
        if (!session || typeof session !== "object" || !Object.hasOwn(session, "breaks"))
          ctx.addIssue({ code: "custom", message: "EXPLICIT_BREAKS_REQUIRED" });
  })
  .pipe(calendarSchema);
export const metadataSchema = z
  .object({
    price: z
      .object({
        precision: field(z.number().int().min(0).max(18)).optional(),
        point: d.optional(),
        tick: d.optional(),
        minimumIncrement: d.optional(),
        tickValue: d.optional(),
        profitTickValue: d.optional(),
        lossTickValue: d.optional(),
        tickCurrency: c.optional(),
        quotation: c.optional(),
        gridOrigin: d.optional(),
        samplePrice: d.optional(),
        tiers: field(z.array(tier).max(256)).optional(),
      })
      .strict(),
    volume: z
      .object({
        minimum: d.optional(),
        maximum: d.optional(),
        increment: d.optional(),
        origin: d.optional(),
        unit: c.optional(),
        convention: c.optional(),
        limit: d.optional(),
        minimumNotional: d.optional(),
        scope: c.optional(),
        minimumInclusive: field(z.boolean()).optional(),
        maximumInclusive: field(z.boolean()).optional(),
        sampleQuantity: d.optional(),
        tiers: field(z.array(tier).max(256)).optional(),
      })
      .strict(),
    contract: z
      .object({
        size: d.optional(),
        unit: c.optional(),
        underlyingUnit: c.optional(),
        quoteCurrency: c.optional(),
        profitCurrency: c.optional(),
        marginCurrency: c.optional(),
        type: c.optional(),
        settlement: c.optional(),
        delivery: c.optional(),
        multiplier: d.optional(),
        venue: c.optional(),
        family: c.optional(),
        expiry: t.optional(),
        maturity: t.optional(),
        rollover: field(text).optional(),
      })
      .strict(),
    sessions: z
      .object({
        calendar: field(calendarEvidenceSchema).optional(),
        weeklyTemplate: field(text).optional(),
        tradingDayConvention: c.optional(),
        maintenance: field(
          z.array(z.object({ start: schemas.timestamp, end: schemas.timestamp }).strict()).max(366),
        ).optional(),
        effectiveFrom: t.optional(),
        effectiveTo: t.optional(),
      })
      .strict(),
    lifecycle: z
      .object({
        effectiveFrom: t.optional(),
        effectiveTo: t.optional(),
        expiry: t.optional(),
        lastTrading: t.optional(),
        maturity: t.optional(),
        replacement: c.optional(),
        retirement: t.optional(),
        corporateActions: field(z.array(text).max(256)).optional(),
        status: c.optional(),
      })
      .strict(),
    margin: z
      .object({
        mode: c.optional(),
        currency: c.optional(),
        initial: d.optional(),
        maintenance: d.optional(),
        hedged: d.optional(),
        tiers: field(z.array(tier).max(256)).optional(),
        accountClass: c.optional(),
        jurisdiction: c.optional(),
        effectiveFrom: t.optional(),
        effectiveTo: t.optional(),
        leverageCategory: c.optional(),
        qualification: field(text).optional(),
      })
      .strict(),
    constraints: z
      .object({
        minimumIncrement: d.optional(),
        quantityIncrement: d.optional(),
        priceLower: d.optional(),
        priceUpper: d.optional(),
        accountClass: c.optional(),
        effectiveFrom: t.optional(),
        effectiveTo: t.optional(),
        declarations: field(
          z
            .array(
              z
                .object({
                  name: code,
                  value: text,
                  support: z.enum(["SOURCE_DECLARED", "UNSUPPORTED"]),
                })
                .strict(),
            )
            .max(256),
        ).optional(),
      })
      .strict(),
  })
  .strict();
export type Metadata = z.infer<typeof metadataSchema>;
export const requestSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: code,
    specificationId: code,
    mappingSet: digest,
    mappingFingerprint: digest,
    sourceDeclaredAt: schemas.timestamp,
    sourceQuality: z.enum(["SYNTHETIC", "UNVERIFIED_RECORDED", "EVIDENCED_RECORDED"]),
    importBatchId: code,
    rawEvidence: text,
    metadata: metadataSchema,
  })
  .strict();
export type Request = z.infer<typeof requestSchema>;
export const classifications = [
  "INTERNALLY_CONSISTENT",
  "INCOMPLETE",
  "CONTRADICTORY",
  "UNSUPPORTED",
  "STALE_CONTEXT",
] as const;
export type Classification = (typeof classifications)[number];
export const profiles = [
  "IDENTITY_METADATA",
  "PRICE_GRID_RESEARCH",
  "VOLUME_METADATA_RESEARCH",
  "CONTRACT_COMPARISON",
  "SESSION_HISTORY",
  "LIFECYCLE_HISTORY",
  "DECLARED_MARGIN_RESEARCH",
] as const;
export const validationSchema = z
  .object({
    ruleId: code,
    ruleVersion: z.literal(1),
    inputFingerprint: digest,
    classification: z.enum(classifications),
    evidence: z.array(text).max(128),
    explanation: text,
    policyFingerprint: digest,
    contextFingerprint: digest,
  })
  .strict();
export type Validation = z.infer<typeof validationSchema>;
export const preparedSchema = z
  .object({
    request: requestSchema,
    rawInputFingerprint: digest,
    normalizationVersion: z.literal("S1"),
    normalizedFingerprint: digest,
    normalized: metadataSchema,
    policy: policySchema,
    policyFingerprint: digest,
    configurationFingerprint: digest,
    evaluatedAt: schemas.timestamp,
    clockProvenance: clockSchema,
    context: z
      .object({
        mappingSet: digest,
        mappingFingerprint: digest,
        instrumentId: canonicalId,
        revisionId: digest,
        registrySnapshot: digest,
        ownerId: code,
        namespaceKey: digest,
        catalogueFingerprint: digest,
        observationFingerprint: digest,
        calendarFingerprint: digest.nullable(),
      })
      .strict(),
    validations: z.array(validationSchema).max(10000),
    completeness: z
      .array(
        z
          .object({
            profile: z.enum(profiles),
            version: z.literal(1),
            required: z.array(text).max(32),
            requiredRules: z.array(code).max(32),
            classification: z.enum(classifications),
          })
          .strict(),
      )
      .length(7),
    qualifications: z.array(text).max(32),
    tradingAuthority: z.literal(false),
    fingerprint: digest,
  })
  .strict();
export type Prepared = z.infer<typeof preparedSchema>;
export const snapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    serviceId: code,
    generation: z.number().int().positive(),
    previous: digest.nullable(),
    publishedAt: schemas.timestamp,
    clockProvenance: clockSchema,
    specificationVersion: z.number().int().positive(),
    parentVersion: digest.nullable(),
    prepared: preparedSchema,
    fingerprint: digest,
  })
  .strict();
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Result<T> = Readonly<
  | { ok: true; value: T }
  | { ok: false; error: Readonly<{ code: string; commitment: "NONE" | "UNKNOWN" }> }
>;
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T = never>(
  code: string,
  commitment: "NONE" | "UNKNOWN" = "NONE",
): Result<T> => ({ ok: false, error: { code, commitment } });
export interface Repository {
  load(): Promise<Result<readonly unknown[]>>;
  commit(snapshot: Snapshot): Promise<Result<Snapshot>>;
}

export type Comparison = Readonly<{
  before: string;
  after: string;
  classification: string;
  beforeContext: Readonly<{
    snapshot: string;
    generation: number;
    version: number;
    source: Prepared["context"];
    policyFingerprint: string;
    effectiveFrom: string | null;
    effectiveTo: string | null;
  }>;
  afterContext: Readonly<{
    snapshot: string;
    generation: number;
    version: number;
    source: Prepared["context"];
    policyFingerprint: string;
    effectiveFrom: string | null;
    effectiveTo: string | null;
  }>;
  differences: readonly {
    field: string;
    before: unknown;
    after: unknown;
    classification: string;
  }[];
  fingerprint: string;
  tradingAuthority: false;
}>;
