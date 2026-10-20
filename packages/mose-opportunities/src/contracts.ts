import { z } from "zod";
export const states = [
  "DORMANT",
  "OBSERVING",
  "INTERESTING",
  "SETUP_FORMING",
  "CANDIDATE",
  "QUALIFIED",
  "INVALIDATED",
  "EXPIRED",
] as const;
export type OpportunityState = (typeof states)[number];
export const id = z
  .string()
  .min(1)
  .max(128)
  .refine((v) => Buffer.byteLength(v) <= 128);
export const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
export const keySchema = z.string().regex(/^opp28:[a-f0-9]{64}$/u);
export const utc = z.string().datetime({ precision: 3 });
export const originSchema = z
  .object({
    owner: id,
    version: id,
    namespace: id,
    runtimeId: id,
    manifestId: id,
    manifestFingerprint: z.string().regex(/^(?:sha256:)?[a-f0-9]{64}$/u),
    inputFingerprint: z.string().regex(/^(?:sha256:)?[a-f0-9]{64}$/u),
    sourceScope: id,
  })
  .strict()
  .superRefine((origin, context) => {
    const nativeReplay =
      origin.owner === "@ate/market-replay" && origin.version === "0.19.0-market-replay.1";
    for (const field of ["manifestFingerprint", "inputFingerprint"] as const) {
      if (!(nativeReplay ? /^[a-f0-9]{64}$/u : /^sha256:[a-f0-9]{64}$/u).test(origin[field]))
        context.addIssue({
          code: "custom",
          path: [field],
          message: "NATIVE_ORIGIN_FINGERPRINT_ENCODING",
        });
    }
  });
export const subjectSchema = z
  .object({
    researchSessionId: id,
    universeSnapshotId: id,
    universeFingerprint: digest,
    canonicalInstrumentId: id,
    registryGeneration: z.number().int().positive(),
    registryFingerprint: digest,
    sourceOriginFingerprint: digest,
    calendarFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    timeframes: z.array(id).min(1).max(4),
    hypothesisRef: id.nullable(),
    watchDeclarationId: id,
    lifecycleGeneration: z.number().int().positive(),
    predecessorGenerationKey: keySchema.nullable(),
  })
  .strict();
export type Subject = z.infer<typeof subjectSchema>;
export const evidenceSchema = z
  .object({
    owner: id,
    ownerVersion: id,
    namespace: id,
    runtimeId: id,
    recordId: id,
    generation: z.number().int().nonnegative(),
    fingerprint: z.string().regex(/^(?:sha256:)?[a-f0-9]{64}$/u),
    sourceOriginFingerprint: digest,
    subjectFingerprint: digest,
    policyFingerprint: digest,
    eventAt: utc,
    availableAt: utc,
    qualityReferences: z.array(id).max(8),
    finality: z.enum(["FINAL", "NOT_APPLICABLE", "PROVISIONAL", "UNKNOWN"]),
    correctionOf: id.nullable(),
    nativeResultStatus: z.enum(["ACK", "NONE", "UNKNOWN", "UNSUPPORTED"]),
    originalReceiptRef: id.nullable(),
  })
  .strict()
  .superRefine((e, context) => {
    const p18 = e.owner === "@ate/multitimeframe" && e.ownerVersion === "0.18.0-multitimeframe.1";
    if (!(p18 ? /^[a-f0-9]{64}$/u : /^sha256:[a-f0-9]{64}$/u).test(e.fingerprint))
      context.addIssue({ code: "custom", message: "NATIVE_FINGERPRINT_ENCODING" });
  });
export type Evidence = z.infer<typeof evidenceSchema>;
export const headSchema = z
  .object({
    journalGeneration: z.number().int().min(1).max(256),
    eventSequence: z.number().int().min(1).max(256),
    stateGeneration: z.number().int().min(1).max(256),
    fingerprint: digest,
  })
  .strict();
export type Head = z.infer<typeof headSchema>;
export const stateSchema = z
  .object({
    key: keySchema,
    subject: subjectSchema,
    state: z.enum(states),
    head: headSchema,
    birthCutoff: utc,
    lastDecisionCutoff: utc,
    expiresAt: utc,
    governingPolicyFingerprint: digest,
    unresolvedOperationRef: id.nullable(),
  })
  .strict();
export type OpportunitySnapshot = z.infer<typeof stateSchema>;
export const clauseSchema = z
  .object({
    dimensionRef: id,
    field: z.enum(["open", "high", "low", "close", "count"]),
    operator: z.enum(["EQ", "NE", "GT", "GE", "LT", "LE"]),
    decimalConstant: z.string().min(1).max(128),
    unit: id,
  })
  .strict();
export const manifestSchema = z
  .object({
    id,
    version: id,
    fingerprint: digest,
    enabled: z.boolean(),
    fromState: z.enum(states),
    toState: z.enum(states),
    hypothesisRef: id.nullable(),
    requiredDimensions: z.array(id).max(8),
    minimumDistinctConfirmations: z.number().int().min(1).max(32),
    maxAgeMs: z.number().int().min(0).max(86400000),
    clauses: z.array(clauseSchema).max(16),
    configurationReleaseRef: id,
    approvalEvidenceRef: id,
  })
  .strict();
export type PredicateManifest = z.infer<typeof manifestSchema>;
export const inputSchema = z
  .object({
    schema: z.literal("ate.opportunity-evaluate/1"),
    key: keySchema,
    commandId: id,
    actorAuthorityRef: id,
    configurationReleaseRef: id,
    expectedHead: headSchema.nullable(),
    requestedState: z.enum(states),
    capturedClock: z
      .object({
        mode: z.enum(["REPLAY", "SIMULATION"]),
        clockId: id,
        source: id,
        quality: id,
        now: utc,
      })
      .strict(),
    decisionCutoff: utc,
    knowledgeCutoff: utc,
    policyFingerprint: digest,
    evidence: z.array(evidenceSchema).max(32),
    consistency: z.enum(["ESTABLISHED_SCOPE", "CONSISTENCY_UNESTABLISHED"]),
    authorityBasis: z.enum(["HISTORICAL_AS_KNOWN", "CURRENT_VERIFIED", "UNESTABLISHED"]),
  })
  .strict();
export type EvaluationInput = z.infer<typeof inputSchema>;
export const contextSchema = z
  .object({
    schema: z.literal("ate.opportunity-context/1"),
    previousEventFingerprint: digest.nullable(),
    historicalState: stateSchema.nullable(),
    subject: subjectSchema,
    sourceManifestRef: id,
    policyRef: id,
    predicateManifests: z.array(manifestSchema).max(9),
    actorEvidenceRef: id,
    scopeConsistencyEvidenceRef: id.nullable(),
    nativeEvidenceRefs: z.array(evidenceSchema).max(32),
    trustedCaptureRef: id,
  })
  .strict();
export type CapturedContext = z.infer<typeof contextSchema>;
export type Commitment = "NONE" | "UNKNOWN";
export type Result<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false;
      error: {
        code: string;
        commitment: Commitment;
        reasonCodes: readonly string[];
        operationRef: string | null;
      };
    }>;
export const success = <T>(value: T): Result<T> => ({ ok: true, value });
export const failure = (
  code: string,
  commitment: Commitment = "NONE",
  operationRef: string | null = null,
): Result<never> => ({
  ok: false,
  error: { code: "OPP:" + code, commitment, reasonCodes: [code], operationRef },
});
export type Limits = {
  maxLiveKeys: number;
  maxJournalRecords: number;
  maxRecordBytes: number;
  maxRequestBytes: number;
  maxRetainedJournalBytes: number;
  maxOperationNodes: number;
  maxDepth: number;
  maxEvidenceRefs: number;
  maxTimeframes: number;
  maxDimensions: number;
  maxClausesPerManifest: number;
  maxEdgeManifests: number;
  maxIdentifierBytes: number;
  maxReasons: number;
  defaultPageSize: number;
  maxPageSize: number;
  maxOffset: number;
  maxOutputBytes: number;
  maxSnapshotsPerRecord: number;
  maxSnapshotBytesWithinRecord: number;
  maxReplayRecords: number;
  writerConcurrency: number;
  maxUnresolvedOperations: number;
  defaultOwnerReads: number;
  maxExplicitApprovedOwnerReads: number;
  ownerReadConcurrency: number;
  automaticRetries: number;
  explicitRecoveryAttemptsPerRequest: number;
  defaultEvidenceMaxAgeMs: number;
  defaultExpiryMs: number;
  maxExpiryMs: number;
};

export type Policy = Readonly<{
  schema: "ate.opportunity-policy/1";
  id: string;
  version: string;
  limits: Readonly<Limits>;
  compositionDriverEnabled: false;
  filesystemEnabled: boolean;
  promotionsEnabled: boolean;
  tradingAuthorized: false;
}>;
export type CapturedEvidence = Evidence &
  Readonly<{
    family: "OBSERVATION" | "ATTENTION" | "BAR" | "DECLARATION" | "REVOCATION";
    native: unknown;
  }>;
export type NativeCapture = Readonly<{
  instrumentBinding?: Readonly<{
    owner: "@ate/instrument-registry";
    ownerVersion: "0.20.0-instrument-registry.1";
    legacyInstrument: unknown;
    association: unknown;
    registrySnapshot: unknown;
    availableAt: string;
  }> | null;
  origin: z.infer<typeof originSchema>;
  evidence: readonly CapturedEvidence[];
  scanner: Readonly<{ receipt: unknown; checkpoint: unknown }> | null;
}>;
export type DecisionProposal = Readonly<{
  schema: "ate.opportunity-decision/1";
  disposition: "TRANSITION" | "NO_ACTION" | "REJECT" | "HISTORICAL_REPLAY";
  key: string;
  from: OpportunityState | null;
  to: OpportunityState;
  expectedHead: Head | null;
  eventFingerprint: string;
  reasonCodes: readonly string[];
  evidence: readonly Evidence[];
  authorityBasis: "HISTORICAL_AS_KNOWN";
  currentUsability: "UNKNOWN";
  tradingAuthority: false;
}>;
export type ProposalDetails = Readonly<{
  input: EvaluationInput;
  context: CapturedContext;
  capture: NativeCapture;
  policy: Policy;
}>;
export type StorageMode = "MEMORY_VOLATILE" | "OFFLINE_FILESYSTEM";
export type JournalRecord = Readonly<{
  schema: "ate.opportunity-journal/1";
  root: string;
  journalGeneration: number;
  previous: string | null;
  operationId: string;
  commandFingerprint: string;
  proposal: DecisionProposal;
  details: ProposalDetails;
  snapshot: OpportunitySnapshot;
  fingerprint: string;
}>;
export type CommitAck = Readonly<{
  root: string;
  key: string;
  journalGeneration: number;
  eventSequence: number;
  fingerprint: string;
  previous: string | null;
  operationId: string;
  storageMode: StorageMode;
  durabilityQualification: string;
}>;
export interface OpportunityRepository {
  readonly root: string;
  readonly storageMode: StorageMode;
  load(): Promise<Result<readonly unknown[]>>;
  compareAppend(record: JournalRecord): Promise<Result<CommitAck>>;
}
export interface TrustedHostAuthorization {
  /** Optional reviewed-host attestation of an already acknowledged immutable legacy prefix.
   * The host must authenticate original receipt provenance, never infer it from journal hashes.
   * Historical read/retry evidence only: does not authorize any mutation or current readiness.
   */
  readonly verifyLegacyJournalPrefix?: (
    request: Readonly<{ root: string; sourceImplementation: string }>,
  ) => Result<
    Readonly<{
      root: string;
      sourceImplementation: string;
      journalGeneration: number;
      journalFingerprint: string;
      issuerRef: string;
      approvalReference: string;
      acknowledgementProofRef: string;
    }>
  >;
  readonly reviewReference: string;
  /** Already supplied, inert bounded evidence. Never an arbitrary owner invocation/read callback. */
  readonly captures: Readonly<Record<string, NativeCapture>>;
  verify(
    request: Readonly<{
      action: "BIRTH" | "COMMIT" | "RECOVER";
      root: string;
      principalRef: string;
      key: string;
      policyFingerprint: string;
      captureFingerprint: string;
      asOf: string;
    }>,
  ): Result<
    Readonly<{
      principalRef: string;
      actor: unknown;
      key: string;
      policyFingerprint: string;
      captureFingerprint: string;
      root: string;
      issuerRef: string;
      approvalReferences: readonly string[];
      issuedAt: string;
      expiresAt: string;
      scope: "HISTORICAL_RESEARCH";
    }>
  >;
}
