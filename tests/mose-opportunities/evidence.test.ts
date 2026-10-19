import { captureOpportunityContext as attachCapture } from "@ate/mose-opportunities";
import { it, expect } from "vitest";
import {
  fixture,
  observation,
  evidence as watermark,
  t,
  unwrap,
} from "../multitimeframe/fixtures.js";
import { defaultOpportunityPolicy as policy } from "../../packages/mose-opportunities/src/policy.js";
import {
  originFingerprint,
  subjectFingerprint,
  policyFingerprint,
  makeOpportunityKey,
} from "../../packages/mose-opportunities/src/identity.js";
import {
  metadata,
  admitEvidence,
  captureNativeResult,
} from "../../packages/mose-opportunities/src/evidence.js";
import {
  evidenceSchema,
  digest,
  subjectSchema,
  type CapturedEvidence,
  type CapturedContext,
  type EvaluationInput,
  type NativeCapture,
} from "../../packages/mose-opportunities/src/contracts.js";
import { Budget } from "../../packages/mose-opportunities/src/validation.js";
const hash = "sha256:" + "1".repeat(64);
function nativeBar() {
  const f = fixture(["M1"]);
  unwrap(f.engine.ingest(f.streamId, observation(t("11:59:05"), 1)));
  watermark(f, t("12:00:00"));
  const revision = f.engine.readRevision(
    unwrap(f.engine.publishWindow(f.streamId, "M1", t("11:59:00"), true)),
  );
  if (!revision) throw Error("genuine P18 revision missing");
  const origin = {
    owner: "@ate/market-replay",
    version: "0.19.0-market-replay.1",
    namespace: "offline",
    runtimeId: "replay",
    manifestId: "manifest",
    manifestFingerprint: hash.slice(7),
    inputFingerprint: hash.slice(7),
    sourceScope: "fixture",
  };
  const subject = {
    researchSessionId: "session-1",
    universeSnapshotId: "universe",
    universeFingerprint: hash,
    canonicalInstrumentId: revision.stream.instrumentId,
    registryGeneration: 1,
    registryFingerprint: hash,
    sourceOriginFingerprint: originFingerprint(origin),
    calendarFingerprint: revision.window.calendarFingerprint,
    timeframes: ["M1"],
    hypothesisRef: null,
    watchDeclarationId: "watch",
    lifecycleGeneration: 1,
    predecessorGenerationKey: null,
  };
  const ref: CapturedEvidence = {
    owner: "@ate/multitimeframe",
    ownerVersion: "0.18.0-multitimeframe.1",
    namespace: "bars",
    runtimeId: "aggregation",
    recordId: revision.revisionId,
    generation: revision.generation,
    fingerprint: revision.contentFingerprint,
    sourceOriginFingerprint: subject.sourceOriginFingerprint,
    subjectFingerprint: subjectFingerprint(subject),
    policyFingerprint: policyFingerprint(policy),
    eventAt: revision.eventAt,
    availableAt: revision.availableAt,
    qualityReferences: [],
    finality: "FINAL",
    correctionOf: null,
    nativeResultStatus: "UNSUPPORTED",
    originalReceiptRef: null,
    family: "BAR",
    native: revision,
  };
  const capture: NativeCapture = { origin, evidence: [ref], scanner: null };
  const context: CapturedContext = {
    schema: "ate.opportunity-context/1",
    historicalState: null,
    previousEventFingerprint: null,
    subject,
    sourceManifestRef: "manifest",
    policyRef: policy.id,
    predicateManifests: [],
    actorEvidenceRef: "actor",
    scopeConsistencyEvidenceRef: "bounded-scope",
    nativeEvidenceRefs: [metadata(ref)],
    trustedCaptureRef: "fixture",
  };
  const input: EvaluationInput = {
    schema: "ate.opportunity-evaluate/1",
    key: makeOpportunityKey(subject, policy, origin),
    commandId: "command",
    actorAuthorityRef: "actor",
    configurationReleaseRef: "configuration",
    expectedHead: null,
    requestedState: "DORMANT",
    capturedClock: {
      mode: "REPLAY",
      clockId: "clock",
      source: "REPLAY",
      quality: "SYNCHRONIZED",
      now: t("12:00:00"),
    },
    decisionCutoff: t("12:00:00"),
    knowledgeCutoff: t("12:00:00"),
    policyFingerprint: policyFingerprint(policy),
    evidence: [metadata(ref)],
    consistency: "ESTABLISHED_SCOPE",
    authorityBasis: "HISTORICAL_AS_KNOWN",
  };
  return { revision, ref, capture, context, input };
}
function admitted(f: ReturnType<typeof nativeBar>) {
  f.context.nativeEvidenceRefs = f.capture.evidence.map(metadata);
  f.input.evidence = f.context.nativeEvidenceRefs;
  const captured = attachCapture(f.context, f.capture, policy);
  return admitEvidence(f.input, captured, f.capture, policy, new Budget(policy.limits));
}
it("genuine P18 bare content and calendar fingerprints remain byte-identical", () => {
  const f = nativeBar();
  const result = admitted(f);
  expect(result[0]?.fingerprint).toBe(f.revision.contentFingerprint);
  expect(subjectSchema.parse(f.context.subject).calendarFingerprint).toBe(
    f.revision.window.calendarFingerprint,
  );
  const roundtrip: unknown = JSON.parse(JSON.stringify(result));
  expect(roundtrip).toMatchObject([{ fingerprint: f.revision.contentFingerprint }]);
});
it("generic P28 digests continue rejecting bare native hashes", () =>
  expect(digest.safeParse("a".repeat(64)).success).toBe(false));
it("P18 prefixed content hash is rejected", () => {
  const f = nativeBar();
  expect(
    evidenceSchema.safeParse({ ...metadata(f.ref), fingerprint: "sha256:" + f.ref.fingerprint })
      .success,
  ).toBe(false);
});
for (const [name, change] of [
  [
    "wrong owner",
    (f: ReturnType<typeof nativeBar>) => {
      f.ref.owner = "@ate/mose-core";
    },
  ],
  [
    "wrong version",
    (f: ReturnType<typeof nativeBar>) => {
      f.ref.ownerVersion = "0.18.0-other";
    },
  ],
  [
    "wrong revision",
    (f: ReturnType<typeof nativeBar>) => {
      f.ref.recordId = "other";
    },
  ],
  [
    "wrong generation",
    (f: ReturnType<typeof nativeBar>) => {
      f.ref.generation++;
    },
  ],
  [
    "wrong content fingerprint",
    (f: ReturnType<typeof nativeBar>) => {
      f.ref.fingerprint = "a".repeat(64);
    },
  ],
  [
    "wrong origin",
    (f: ReturnType<typeof nativeBar>) => {
      f.ref.sourceOriginFingerprint = "sha256:" + "2".repeat(64);
    },
  ],
  [
    "wrong subject",
    (f: ReturnType<typeof nativeBar>) => {
      f.ref.subjectFingerprint = "sha256:" + "2".repeat(64);
    },
  ],
  [
    "wrong policy",
    (f: ReturnType<typeof nativeBar>) => {
      f.ref.policyFingerprint = "sha256:" + "2".repeat(64);
    },
  ],
  [
    "provisional",
    (f: ReturnType<typeof nativeBar>) => {
      f.ref.finality = "PROVISIONAL";
    },
  ],
  [
    "unknown native result",
    (f: ReturnType<typeof nativeBar>) => {
      f.ref.nativeResultStatus = "UNKNOWN";
    },
  ],
  [
    "future availability",
    (f: ReturnType<typeof nativeBar>) => {
      f.ref.availableAt = t("12:01:00");
    },
  ],
  [
    "unbound correction",
    (f: ReturnType<typeof nativeBar>) => {
      f.ref.correctionOf = "parent";
    },
  ],
  [
    "wrong family",
    (f: ReturnType<typeof nativeBar>) => {
      Reflect.set(f.ref, "family", "DECLARATION");
    },
  ],
] as const)
  it(`native P18 rejects ${name}`, () => {
    const f = nativeBar();
    change(f);
    expect(() => admitted(f)).toThrow();
  });
for (const [name, response] of [
  ["missing discriminator", {}],
  ["null discriminator", { ok: null }],
  ["numeric discriminator", { ok: 0 }],
  ["string discriminator", { ok: "false" }],
  ["contradictory success", { ok: true, value: 1, error: { code: "X", commitment: "NONE" } }],
  ["contradictory failure", { ok: false, value: 1, error: { code: "X", commitment: "NONE" } }],
  ["missing error", { ok: false }],
  ["null error", { ok: false, error: null }],
  ["non-string code", { ok: false, error: { code: 2, commitment: "NONE" } }],
  ["missing commitment", { ok: false, error: { code: "X" } }],
  ["invalid commitment", { ok: false, error: { code: "X", commitment: "ACK" } }],
] as const)
  it(`native Result rejects ${name}`, () => expect(() => captureNativeResult(response)).toThrow());
it("structural inherited success is captured once", () => {
  let reads = 0;
  const result: unknown = Object.create({
    get ok() {
      reads++;
      return true;
    },
    value: 42,
  });
  expect(captureNativeResult(result)).toEqual({ ok: true, value: 42 });
  expect(reads).toBe(1);
});
it("array structural representation is not rejected merely for being an array", () =>
  expect(captureNativeResult(Object.assign([], { ok: true, value: 42 }))).toEqual({
    ok: true,
    value: 42,
  }));
it("null-prototype negative preserves UNKNOWN", () =>
  expect(
    captureNativeResult(
      Object.assign(Object.create(null), {
        ok: false,
        error: { code: "MISSING", commitment: "UNKNOWN" },
      }),
    ),
  ).toEqual({ ok: false, error: { code: "MISSING", commitment: "UNKNOWN" } }));
it("throwing property reads propagate fail-closed", () =>
  expect(() =>
    captureNativeResult({
      get ok() {
        throw Error("fault");
      },
    }),
  ).toThrow("fault"));

it("public materializer does not freeze or mutate caller context", () => {
  const f = nativeBar();
  const before = JSON.stringify(f.context);
  const captured = attachCapture(f.context, f.capture, policy);
  expect(JSON.stringify(f.context)).toBe(before);
  expect(Object.isFrozen(f.context.subject)).toBe(false);
  f.context.subject.watchDeclarationId = "caller edit";
  expect(captured.subject.watchDeclarationId).toBe("watch");
});
it("public materializer makes repeated deterministic immutable captures", () => {
  const f = nativeBar();
  const a = attachCapture(f.context, f.capture, policy),
    b = attachCapture(f.context, f.capture, policy);
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  expect(Object.isFrozen(a)).toBe(true);
  expect(Object.isFrozen(a.subject)).toBe(true);
});
it("public materializer rejects a missing native body without fabricating an envelope", () => {
  const f = nativeBar();
  Reflect.set(f.ref, "native", undefined);
  expect(() => attachCapture(f.context, f.capture, policy)).toThrow();
});
it("public materializer rejects absent referenced evidence at admission", () => {
  const f = nativeBar();
  const capture = { ...f.capture, evidence: [] };
  const context = attachCapture(f.context, capture, policy);
  expect(() => admitEvidence(f.input, context, capture, policy, new Budget(policy.limits))).toThrow(
    "IMMUTABLE_CONFLICT",
  );
});
it("public materializer preserves exact bare calendar binding and rejects substitution", () => {
  const f = nativeBar();
  f.context.subject.calendarFingerprint = "3".repeat(64);
  f.ref.subjectFingerprint = subjectFingerprint(f.context.subject);
  expect(() => admitted(f)).toThrow("SOURCE_CONTEXT_MISMATCH");
});
it("public materializer enforces its shared node budget", () => {
  const f = nativeBar();
  expect(() =>
    attachCapture(f.context, f.capture, {
      ...policy,
      limits: { ...policy.limits, maxOperationNodes: 1 },
    }),
  ).toThrow("BUDGET_EXHAUSTED");
});
it("public materializer never executes a supplied native payload accessor", () => {
  const f = nativeBar();
  let reads = 0;
  const native = {
    get revisionId() {
      reads++;
      return "forged";
    },
  };
  Reflect.set(f.ref, "native", native);
  expect(() => attachCapture(f.context, f.capture, policy)).toThrow();
  expect(reads).toBe(0);
});
it("public materializer never executes an outer evidence accessor", () => {
  const f = nativeBar();
  let reads = 0;
  Object.defineProperty(f.ref, "native", {
    get() {
      reads++;
      return f.revision;
    },
    enumerable: true,
  });
  expect(() => attachCapture(f.context, f.capture, policy)).toThrow();
  expect(reads).toBe(0);
});
it("public materializer is not native source authentication", () => {
  const f = nativeBar();
  f.ref.fingerprint = "4".repeat(64);
  f.context.nativeEvidenceRefs = [metadata(f.ref)];
  f.input.evidence = f.context.nativeEvidenceRefs;
  const captured = attachCapture(f.context, f.capture, policy);
  expect(() =>
    admitEvidence(f.input, captured, f.capture, policy, new Budget(policy.limits)),
  ).toThrow("SOURCE_FINGERPRINT_MISMATCH");
});
it("P18 plain read data cannot be mislabeled as native ACK", () => {
  const f = nativeBar();
  f.ref.nativeResultStatus = "ACK";
  expect(() => admitted(f)).toThrow("SOURCE_UNRESOLVED");
});
it("P18 plain read data cannot be replaced with an invented success wrapper", () => {
  const f = nativeBar();
  Reflect.set(f.ref, "native", { ok: true, value: f.revision });
  expect(() => admitted(f)).toThrow();
});

import { beforeAll } from "vitest";
import { resolveHistoricalReplayInputs } from "@ate/market-replay";
import { fingerprint as ownerFingerprint } from "@ate/configuration";
import { historicalFixture } from "../market-replay/historical-fixture.js";
import { originSchema } from "../../packages/mose-opportunities/src/contracts.js";
import type { infer as ZodInfer } from "zod";
let nativeOrigin: ZodInfer<typeof originSchema>;
beforeAll(async () => {
  const h = await historicalFixture({
    rows: "2026-10-08T10:00:00.000Z,TEST,1,1\n2026-10-08T10:01:00.000Z,TEST,1.01,1.01",
  });
  const inputs = await resolveHistoricalReplayInputs({
    ...h.options,
    availability: () => ({
      kind: "SOURCE_PUBLICATION",
      availableAt: h.clock.now(),
      qualityAvailableAt: h.clock.now(),
      fingerprint: ownerFingerprint({
        synthetic: "explicit-offline-source-publication-for-P19-regressions",
      }),
    }),
  });
  nativeOrigin = {
    owner: "@ate/market-replay",
    version: "0.19.0-market-replay.1",
    namespace: "offline",
    runtimeId: "actual-P19-source",
    manifestId: inputs.manifests[0]!.manifestId,
    manifestFingerprint: inputs.manifests[0]!.fingerprint,
    inputFingerprint: inputs.fingerprint,
    sourceScope: "explicit-synthetic-fixture",
  };
});
for (const field of ["manifestFingerprint", "inputFingerprint"] as const) {
  it("P19 genuine native " + field + " remains bare and survives serialization", () => {
    expect(nativeOrigin[field]).toMatch(/^[a-f0-9]{64}$/u);
    expect(originSchema.parse(JSON.parse(JSON.stringify(nativeOrigin)))[field]).toBe(
      nativeOrigin[field],
    );
  });
  for (const value of [
    "",
    "3".repeat(63),
    "3".repeat(65),
    "g".repeat(64),
    "sha256:" + "3".repeat(64),
  ])
    it(
      "P19 rejects malformed native " +
        field +
        " length " +
        value.length +
        " value " +
        value.slice(0, 7),
      () => expect(originSchema.safeParse({ ...nativeOrigin, [field]: value }).success).toBe(false),
    );
}
for (const [field, value] of [
  ["owner", "@ate/multitimeframe"],
  ["version", "0.19.0-forged"],
  ["manifestId", ""],
] as const)
  it("P19 native origin rejects incorrectly bound " + field, () =>
    expect(originSchema.safeParse({ ...nativeOrigin, [field]: value }).success).toBe(false),
  );
it("P19 unsupported extra native fields cannot alter the accepted origin contract", () =>
  expect(originSchema.safeParse({ ...nativeOrigin, sourceAuthenticated: true }).success).toBe(
    false,
  ));
it("P19 native and P28 owned fingerprint namespaces remain separate", () => {
  expect(digest.safeParse(nativeOrigin.inputFingerprint).success).toBe(false);
  expect(
    originSchema.safeParse({
      ...nativeOrigin,
      owner: "@ate/other",
      manifestFingerprint: "sha256:" + nativeOrigin.manifestFingerprint,
      inputFingerprint: "sha256:" + nativeOrigin.inputFingerprint,
    }).success,
  ).toBe(true);
});
it("P19 native origin mutation cannot reuse the original subject binding", () => {
  const f = nativeBar();
  const subject = {
    ...f.context.subject,
    sourceOriginFingerprint: originFingerprint(nativeOrigin),
  };
  const key = makeOpportunityKey(subject, policy, nativeOrigin);
  expect(key).toMatch(/^opp28:/u);
  expect(() =>
    makeOpportunityKey(subject, policy, { ...nativeOrigin, inputFingerprint: "4".repeat(64) }),
  ).toThrow("SOURCE_CONTEXT_MISMATCH");
});
it("P19 receipt or public origin syntax does not grant automatic source authority", () => {
  expect(policy.compositionDriverEnabled).toBe(false);
  expect(policy.tradingAuthorized).toBe(false);
  expect(() =>
    attachCapture(
      nativeBar().context,
      {
        origin: nativeOrigin,
        evidence: [],
        scanner: null,
        ...{
          readOwner: () => {
            throw Error("must never run");
          },
        },
      },
      policy,
    ),
  ).toThrow("INPUT_INVALID");
});
