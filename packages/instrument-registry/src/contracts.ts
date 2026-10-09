import { z } from "zod";
import { schemas } from "@ate/domain";
export const families = [
  "FX",
  "EQUITY",
  "FUND",
  "INDEX",
  "BOND",
  "COMMODITY",
  "FUTURE",
  "OPTION",
  "DIGITAL",
  "RATE",
  "OTHER",
] as const;
const text = z.string().min(1).max(256);
const code = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/);
export const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const canonicalId = z.string().regex(/^ins-[a-f0-9]{64}$/);
const decimal = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,15})(\.[0-9]{1,12})?$/)
  .transform((v) => (v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v));
export const evidenceSchema = z
  .object({
    sourceType: z.enum(["RESEARCH", "OFFLINE_IMPORT", "RECOGNIZED_AUTHORITY"]),
    sourceId: code,
    contentFingerprint: digest,
    originalValue: text,
    observedAt: schemas.timestamp.optional(),
    timeAuthority: z.enum(["UNKNOWN", "SOURCE_ASSERTED", "EVIDENCED"]),
    verification: z.enum(["UNVERIFIED", "VERIFIED"]),
    evidenceReference: code,
  })
  .strict()
  .superRefine((v, c) => {
    if ((v.timeAuthority === "UNKNOWN") !== (v.observedAt === undefined))
      c.addIssue({ code: "custom", message: "TIMESTAMP_EVIDENCE" });
    if (v.verification === "VERIFIED" && v.sourceType !== "RECOGNIZED_AUTHORITY")
      c.addIssue({ code: "custom", message: "VERIFICATION_AUTHORITY" });
  });
export type Evidence = z.infer<typeof evidenceSchema>;
export const identitySchema = z.discriminatedUnion("family", [
  z
    .object({
      family: z.literal("FX"),
      kind: z.enum(["SPOT", "FORWARD"]),
      base: code,
      quote: code,
      settlement: code,
    })
    .strict(),
  z
    .object({
      family: z.literal("EQUITY"),
      kind: z.enum(["ORDINARY", "PREFERRED", "DEPOSITARY_RECEIPT"]),
      issuer: code,
      shareClass: code,
      venue: code,
    })
    .strict(),
  z
    .object({
      family: z.literal("FUND"),
      kind: z.enum(["ETF", "UNIT"]),
      fund: code,
      shareClass: code,
      venue: code,
    })
    .strict(),
  z
    .object({
      family: z.literal("INDEX"),
      kind: z.enum(["EQUITY_INDEX", "VOLATILITY_INDEX", "REFERENCE_INDEX"]),
      administrator: code,
      index: code,
      variant: code,
    })
    .strict(),
  z
    .object({
      family: z.literal("BOND"),
      kind: z.enum(["GOVERNMENT", "CORPORATE", "OTHER_DEBT"]),
      issuer: code,
      issuance: code,
      maturity: schemas.timestamp,
      currency: code,
      coupon: decimal,
      seniority: code,
    })
    .strict(),
  z
    .object({
      family: z.literal("COMMODITY"),
      kind: z.enum(["PHYSICAL", "BENCHMARK", "SYNTHETIC"]),
      reference: code,
      grade: code,
      location: code,
    })
    .strict(),
  z
    .object({
      family: z.literal("FUTURE"),
      kind: z.enum(["EXPIRING", "CONTINUOUS"]),
      underlying: canonicalId,
      venue: code,
      contract: code,
      expiry: schemas.timestamp.optional(),
      seriesRule: code.optional(),
    })
    .strict()
    .refine(
      (v) =>
        v.kind === "EXPIRING"
          ? v.expiry !== undefined && v.seriesRule === undefined
          : v.seriesRule !== undefined && v.expiry === undefined,
      "FUTURE_DISCRIMINATORS",
    ),
  z
    .object({
      family: z.literal("OPTION"),
      kind: z.enum(["CALL", "PUT"]),
      underlying: canonicalId,
      venue: code,
      expiry: schemas.timestamp,
      strike: decimal,
      currency: code,
      contract: code,
    })
    .strict(),
  z
    .object({
      family: z.literal("DIGITAL"),
      kind: z.enum(["NATIVE", "TOKEN", "WRAPPED", "PAIR"]),
      network: code,
      asset: code,
      quote: code.optional(),
      venue: code.optional(),
    })
    .strict()
    .refine(
      (v) =>
        v.kind === "PAIR"
          ? v.quote !== undefined && v.venue !== undefined
          : v.quote === undefined && v.venue === undefined,
      "DIGITAL_DISCRIMINATORS",
    ),
  z
    .object({
      family: z.literal("RATE"),
      kind: z.literal("REFERENCE_RATE"),
      administrator: code,
      rate: code,
      tenor: code,
    })
    .strict(),
  z
    .object({
      family: z.literal("OTHER"),
      kind: z.enum(["CURRENCY", "EXTENSION", "PROVISIONAL"]),
      namespace: code,
      key: code,
    })
    .strict(),
]);
export type Identity = z.infer<typeof identitySchema>;
export const claimSchema = z
  .object({ scheme: code, value: text, scope: code, authority: code, evidence: evidenceSchema })
  .strict();
export const aliasSchema = z
  .object({
    value: text,
    scope: code,
    kind: z.enum(["SYMBOL", "DISPLAY", "HISTORICAL", "DATASET", "PROVIDER", "BROKER", "TERMINAL"]),
    rule: z.enum(["EXACT", "CASE", "PAIR"]),
    evidence: evidenceSchema,
  })
  .strict();
export const relationshipTypes = [
  "UNDERLYING_OF",
  "DERIVED_FROM",
  "REFERENCES",
  "SHARE_CLASS_OF",
  "TRACKS_INDEX",
  "REPRESENTS_ASSET",
  "REPLACES",
  "RELATED_INSTRUMENT",
] as const;
export const relationshipSchema = z
  .object({ type: z.enum(relationshipTypes), target: canonicalId, evidence: evidenceSchema })
  .strict();
export const definitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    identity: identitySchema,
    displayName: text,
    shortName: text.optional(),
    description: z.string().max(2048).optional(),
    jurisdiction: code.optional(),
    currency: code.optional(),
    taxonomyVersion: code,
    classification: code,
    status: z.enum([
      "CANDIDATE",
      "VALIDATED",
      "ACTIVE_IN_REGISTRY",
      "DEPRECATED",
      "RETIRED",
      "REJECTED",
    ]),
    qualification: z.enum(["PROVISIONAL", "EVIDENCE_QUALIFIED", "VERIFIED"]),
    identifiers: z.array(claimSchema).max(128),
    aliases: z.array(aliasSchema).max(128),
    relationships: z.array(relationshipSchema).max(128),
    evidence: z.array(evidenceSchema).min(1).max(128),
  })
  .strict();
export type InstrumentDefinition = z.infer<typeof definitionSchema>;
export type Alias = z.infer<typeof aliasSchema>;
export type Relationship = z.infer<typeof relationshipSchema>;
export const taxonomySchema = z
  .object({
    version: code,
    categories: z
      .array(
        z
          .object({
            code: code,
            family: z.enum(families),
            kinds: z.array(code).min(1).max(32),
            parent: code.optional(),
            meaning: text,
            deprecated: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(128),
  })
  .strict();
export type Taxonomy = z.infer<typeof taxonomySchema>;
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: { readonly code: string; readonly commitment: "NONE" | "UNKNOWN" };
    };
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (code: string, commitment: "NONE" | "UNKNOWN" = "NONE"): Result<never> => ({
  ok: false,
  error: { code, commitment },
});
export type Normalization = {
  /** Canonical field path in new traces; absent in legacy N1 evidence. */
  readonly path?: string;
  readonly status: "NORMALIZED" | "UNCHANGED" | "AMBIGUOUS" | "UNSUPPORTED" | "INVALID";
  readonly original: string;
  readonly value: string;
  readonly rule: string;
  readonly version: "N1";
};
export type Revision = {
  readonly instrumentId: string;
  readonly revisionId: string;
  readonly sequence: number;
  readonly previous: string | null;
  readonly definition: InstrumentDefinition;
  readonly normalization: readonly Normalization[];
  readonly changedFields: readonly string[];
  readonly justification: string;
  readonly configurationFingerprint: string;
  readonly recordedAt: string;
  readonly clockProvenance: unknown;
  readonly fingerprint: string;
};
export type Conflict = {
  readonly conflictId: string;
  readonly instrumentId: string;
  readonly reason: string;
  readonly evidenceFingerprint: string;
};
export type ImportManifest = {
  readonly importId: string;
  readonly inputFingerprint: string;
  readonly outcomes: readonly {
    readonly input: string;
    readonly status: "REGISTERED" | "IDEMPOTENT" | "CONFLICT";
    readonly revisionId: string | null;
  }[];
};
export type Snapshot = {
  readonly schemaVersion: 1;
  readonly registryId: string;
  readonly generation: number;
  readonly previous: string | null;
  readonly policyFingerprint: string;
  readonly configurationFingerprint: string;
  readonly revisions: readonly Revision[];
  readonly conflicts: readonly Conflict[];
  readonly imports: readonly ImportManifest[];
  readonly fingerprint: string;
};
export type Repository = {
  load: () => Promise<Result<readonly unknown[]>>;
  commit: (snapshot: Snapshot) => Promise<Result<Snapshot>>;
};
export type Resolution = {
  readonly status:
    | "EXACT_MATCH"
    | "QUALIFIED_MATCH"
    | "AMBIGUOUS"
    | "NOT_FOUND"
    | "INVALID_INPUT"
    | "UNSUPPORTED_SCHEME"
    | "INSUFFICIENT_EVIDENCE";
  readonly candidates: readonly Revision[];
  readonly evidence: readonly Evidence[];
  readonly normalization: Normalization | null;
  readonly reason: string;
  readonly snapshotFingerprint: string;
};
